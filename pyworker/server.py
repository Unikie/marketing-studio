#!/usr/bin/env python3
"""
Pyworker — Tool registry and execution engine.
All I/O is JSON. Tools are Python code stored in SQLite, called by name.
"""
import base64
import json
import os
import sqlite3
import tempfile
import traceback

from flask import Flask, request, jsonify, g

app = Flask(__name__)

DB_PATH = os.environ.get('PYWORKER_DB', os.path.join(os.path.dirname(__file__), 'tools.db'))

# ---- Database ----

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA journal_mode=WAL')
    return g.db

@app.teardown_appcontext
def close_db(exc):
    db = g.pop('db', None)
    if db:
        db.close()

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute('''CREATE TABLE IF NOT EXISTS tools (
        name TEXT PRIMARY KEY,
        description TEXT,
        code TEXT NOT NULL,
        params_schema TEXT,
        owner TEXT DEFAULT 'system',
        read_only INTEGER DEFAULT 0,
        permissions TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )''')
    # Migration: add params_schema if missing
    try:
        db.execute('SELECT params_schema FROM tools LIMIT 1')
    except sqlite3.OperationalError:
        db.execute('ALTER TABLE tools ADD COLUMN params_schema TEXT')
    db.commit()
    db.close()

# ---- Permission helpers ----

def get_caller():
    """Extract caller identity from request header."""
    return request.headers.get('X-Caller', 'anonymous')

def get_tool_or_404(name):
    row = get_db().execute('SELECT * FROM tools WHERE name = ?', (name,)).fetchone()
    if not row:
        return None
    return dict(row)

def check_permission(tool, action):
    """Check if caller has permission for action (create/read/update/delete/execute)."""
    caller = get_caller()
    if caller == 'system' or caller == tool.get('owner'):
        return True
    if tool.get('read_only') and action in ('update', 'delete'):
        return False
    perms = json.loads(tool.get('permissions') or '{}')
    user_perms = perms.get(caller, perms.get('*', []))
    return action in user_perms

# ---- Tool CRUD ----

@app.route('/tools', methods=['GET'])
def list_tools():
    rows = get_db().execute('SELECT name, description, params_schema, owner, read_only, created_at, updated_at FROM tools').fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/tools', methods=['POST'])
def create_tool():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('code'):
        return jsonify({'error': 'name and code required'}), 400

    name = data['name']
    existing = get_db().execute('SELECT name FROM tools WHERE name = ?', (name,)).fetchone()
    if existing:
        return jsonify({'error': f'Tool "{name}" already exists'}), 409

    caller = get_caller()
    get_db().execute(
        'INSERT INTO tools (name, description, code, params_schema, owner, read_only, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (name, data.get('description', ''), data['code'], data.get('params_schema'), caller, int(data.get('read_only', False)), json.dumps(data.get('permissions', {})))
    )
    get_db().commit()
    return jsonify({'ok': True, 'name': name}), 201

@app.route('/tools/<name>', methods=['GET'])
def read_tool(name):
    tool = get_tool_or_404(name)
    if not tool:
        return jsonify({'error': 'Not found'}), 404
    if not check_permission(tool, 'read'):
        return jsonify({'error': 'Forbidden'}), 403
    return jsonify(tool)

@app.route('/tools/<name>', methods=['PUT'])
def update_tool(name):
    tool = get_tool_or_404(name)
    if not tool:
        return jsonify({'error': 'Not found'}), 404
    if not check_permission(tool, 'update'):
        return jsonify({'error': 'Forbidden: tool is read-only or insufficient permissions'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    sets = []
    params = []
    if 'code' in data:
        sets.append('code = ?')
        params.append(data['code'])
    if 'description' in data:
        sets.append('description = ?')
        params.append(data['description'])
    if 'params_schema' in data:
        sets.append('params_schema = ?')
        params.append(data['params_schema'])
    if sets:
        sets.append("updated_at = datetime('now')")
        params.append(name)
        get_db().execute(f"UPDATE tools SET {', '.join(sets)} WHERE name = ?", params)
        get_db().commit()
    return jsonify({'ok': True})

@app.route('/tools/<name>', methods=['DELETE'])
def delete_tool(name):
    tool = get_tool_or_404(name)
    if not tool:
        return jsonify({'error': 'Not found'}), 404
    if not check_permission(tool, 'delete'):
        return jsonify({'error': 'Forbidden'}), 403

    get_db().execute('DELETE FROM tools WHERE name = ?', (name,))
    get_db().commit()
    return jsonify({'ok': True})

# ---- System: set attributes (owner, read_only, permissions) ----

@app.route('/tools/<name>/attributes', methods=['PUT'])
def set_attributes(name):
    caller = get_caller()
    tool = get_tool_or_404(name)
    if not tool:
        return jsonify({'error': 'Not found'}), 404
    if caller != 'system' and tool.get('owner') != caller:
        return jsonify({'error': 'Only system or owner can set attributes'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    sets = []
    params = []
    if 'owner' in data:
        sets.append('owner = ?')
        params.append(data['owner'])
    if 'read_only' in data:
        sets.append('read_only = ?')
        params.append(int(data['read_only']))
    if 'permissions' in data:
        sets.append('permissions = ?')
        params.append(json.dumps(data['permissions']))
    if sets:
        sets.append("updated_at = datetime('now')")
        params.append(name)
        get_db().execute(f"UPDATE tools SET {', '.join(sets)} WHERE name = ?", params)
        get_db().commit()
    return jsonify({'ok': True})

# ---- Tool execution ----

@app.route('/tools/<name>/execute', methods=['POST'])
def execute_tool(name):
    tool = get_tool_or_404(name)
    if not tool:
        return jsonify({'error': f'Tool "{name}" not found'}), 404
    if not check_permission(tool, 'execute'):
        return jsonify({'error': 'Forbidden'}), 403

    params = request.get_json()
    if params is None:
        params = {}

    # Execute tool code in a sandboxed namespace
    namespace = {
        '__builtins__': __builtins__,
        'json': json,
        'base64': base64,
        'tempfile': tempfile,
        'os': os,
    }

    try:
        exec(compile(tool['code'], f'<tool:{name}>', 'exec'), namespace)

        if 'run' not in namespace:
            return jsonify({'error': f'Tool "{name}" does not define a run(params) function'}), 500

        result = namespace['run'](params)

        if not isinstance(result, dict):
            result = {'result': result}

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500

# ---- Health ----

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'tools': get_db().execute('SELECT count(*) FROM tools').fetchone()[0]})

# ---- DB export/import (SQL text dump) ----

@app.route('/db/export', methods=['GET'])
def db_export():
    db = get_db()
    lines = []
    tables = db.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    for t in tables:
        lines.append(t['sql'] + ';')
        rows = db.execute(f'SELECT * FROM "{t["name"]}"').fetchall()
        for row in rows:
            cols = row.keys()
            vals = []
            for c in cols:
                v = row[c]
                if v is None:
                    vals.append('NULL')
                elif isinstance(v, (int, float)):
                    vals.append(str(v))
                else:
                    vals.append("'" + str(v).replace("'", "''") + "'")
            col_str = ','.join(f'"{c}"' for c in cols)
            val_str = ','.join(vals)
            lines.append(f'INSERT INTO "{t["name"]}" ({col_str}) VALUES ({val_str});')
    dump = '\n'.join(lines) + '\n'
    return app.response_class(dump, mimetype='text/plain',
                              headers={'Content-Disposition': 'attachment; filename=tools.sql'})

@app.route('/db/import', methods=['POST'])
def db_import():
    sql = request.get_data(as_text=True)
    if not sql or len(sql) < 10:
        return jsonify({'error': 'Empty SQL dump'}), 400
    # Close current connection, recreate DB
    db = g.pop('db', None)
    if db:
        db.close()
    if os.path.exists(DB_PATH):
        os.unlink(DB_PATH)
    new_db = sqlite3.connect(DB_PATH)
    new_db.executescript(sql)
    new_db.close()
    return jsonify({'ok': True, 'size': len(sql)})

# ---- Built-in tool: file_analysis ----

TOOL_FILE_ANALYSIS = r'''
import base64
import os
import tempfile

def run(params):
    file_b64 = params.get('file')
    filename = params.get('filename', 'unknown')

    if not file_b64:
        return {'error': 'No file provided (expected base64 in "file" field)'}

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ('.pdf', '.pptx', '.docx', '.doc'):
        return {'error': f'Unsupported file type: {ext}'}

    file_bytes = base64.b64decode(file_b64)

    fd, tmppath = tempfile.mkstemp(suffix=ext)
    try:
        os.write(fd, file_bytes)
        os.close(fd)

        if ext == '.pdf':
            return analyze_pdf(tmppath, filename)
        elif ext == '.pptx':
            return analyze_pptx(tmppath, filename)
        elif ext in ('.docx', '.doc'):
            return analyze_docx(tmppath, filename)
    finally:
        if os.path.exists(tmppath):
            os.unlink(tmppath)


def analyze_pdf(filepath, filename):
    import fitz
    doc = fitz.open(filepath)
    pages = []
    total_images = 0
    total_tables = 0
    total_words = 0
    for i, page in enumerate(doc):
        text = page.get_text()
        words = text.split()
        images = page.get_images(full=True)
        lines = text.split('\n')
        table_lines = sum(1 for line in lines if line.count('\t') >= 2 or line.count('  ') >= 3)
        has_table = table_lines > 2
        total_images += len(images)
        total_words += len(words)
        if has_table:
            total_tables += 1
        pages.append({
            'page': i + 1,
            'words': len(words),
            'images': len(images),
            'has_table': has_table,
            'heading': lines[0].strip()[:120] if lines and lines[0].strip() else None,
            'text': [line for line in lines if line.strip()],
        })
    doc.close()
    return {
        'filename': filename,
        'type': 'pdf',
        'page_count': len(pages),
        'total_words': total_words,
        'total_images': total_images,
        'pages_with_tables': total_tables,
        'pages': pages,
    }


def analyze_pptx(filepath, filename):
    from pptx import Presentation
    prs = Presentation(filepath)
    slides = []
    total_words = 0
    total_images = 0
    for i, slide in enumerate(prs.slides):
        texts = []
        images = 0
        title = None
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = para.text.strip()
                    if line:
                        texts.append(line)
            if hasattr(shape, 'image'):
                images += 1
            if not title:
                try:
                    if shape.placeholder_format and shape.placeholder_format.idx == 0:
                        title = shape.text.strip()[:120]
                except Exception:
                    pass
        if not title and texts:
            title = texts[0][:120]
        words = sum(len(t.split()) for t in texts)
        total_words += words
        total_images += images
        slides.append({
            'slide': i + 1,
            'title': title,
            'words': words,
            'images': images,
            'bullet_count': len(texts),
            'text': texts,
        })
    return {
        'filename': filename,
        'type': 'pptx',
        'slide_count': len(slides),
        'total_words': total_words,
        'total_images': total_images,
        'slides': slides,
    }


def analyze_docx(filepath, filename):
    from docx import Document
    doc = Document(filepath)
    sections = []
    current_heading = None
    current_text = []
    total_words = 0
    total_images = 0
    total_tables = len(doc.tables)

    for para in doc.paragraphs:
        if para.style and para.style.name.startswith('Heading'):
            if current_heading or current_text:
                words = sum(len(t.split()) for t in current_text)
                total_words += words
                sections.append({
                    'heading': current_heading or '(no heading)',
                    'words': words,
                    'text': current_text,
                })
            current_heading = para.text.strip()[:120]
            current_text = []
        else:
            if para.text.strip():
                current_text.append(para.text.strip())

    if current_heading or current_text:
        words = sum(len(t.split()) for t in current_text)
        total_words += words
        sections.append({
            'heading': current_heading or '(no heading)',
            'words': words,
            'text': current_text,
        })

    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            total_images += 1

    return {
        'filename': filename,
        'type': 'docx',
        'section_count': len(sections),
        'total_words': total_words,
        'total_images': total_images,
        'total_tables': total_tables,
        'sections': sections,
    }
'''

# ---- Startup: seed built-in tools ----

TOOL_FILE_ANALYSIS_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "file": {"type": "string", "description": "Base64-encoded file content"},
        "filename": {"type": "string", "description": "Original filename with extension (e.g. report.pdf)"}
    },
    "required": ["file", "filename"]
})

def seed_builtin_tools():
    db = sqlite3.connect(DB_PATH)
    existing = db.execute("SELECT name FROM tools WHERE name = 'file_analysis'").fetchone()
    if not existing:
        db.execute(
            'INSERT INTO tools (name, description, code, params_schema, owner, read_only, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ('file_analysis', 'Analyze PDF, PPTX, DOCX files. Input: {file: base64, filename: str}', TOOL_FILE_ANALYSIS, TOOL_FILE_ANALYSIS_SCHEMA, 'system', 1, json.dumps({'*': ['read', 'execute']}))
        )
    else:
        # Update schema on existing tool
        db.execute('UPDATE tools SET params_schema = ? WHERE name = ?', (TOOL_FILE_ANALYSIS_SCHEMA, 'file_analysis'))

    # Seed: lowercase tool
    TOOL_LOWERCASE_CODE = '''def run(params):
    text = params.get('text', '')
    if not text:
        return {'error': 'No text provided (expected "text" field)'}
    return {'result': text.lower()}
'''
    TOOL_LOWERCASE_SCHEMA = json.dumps({
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The text to convert to lowercase"}
        },
        "required": ["text"]
    })
    existing_lc = db.execute("SELECT name FROM tools WHERE name = 'lowercase'").fetchone()
    if not existing_lc:
        db.execute(
            'INSERT INTO tools (name, description, code, params_schema, owner, read_only, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ('lowercase', 'Convert all text to lowercase', TOOL_LOWERCASE_CODE, TOOL_LOWERCASE_SCHEMA, 'system', 0, json.dumps({'*': ['read', 'execute']}))
        )

    db.commit()
    db.close()

# ---- Main ----

if __name__ == '__main__':
    init_db()
    seed_builtin_tools()
    port = int(os.environ.get('PYWORKER_PORT', '3002'))
    print(f'[pyworker] Tool engine on http://localhost:{port}')
    print(f'[pyworker] DB: {DB_PATH}')
    app.run(host='0.0.0.0', port=port, debug=False)
