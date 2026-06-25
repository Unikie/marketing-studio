import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb } from './db';
import { projectsRouter } from './routes/projects';
import { filesRouter } from './routes/files';
import { promptsRouter } from './routes/prompts';
import { eventsRouter } from './routes/events';
import { skillsRouter } from './routes/skills';
import { instructionsRouter } from './routes/instructions';
import { toolsRouter } from './routes/tools';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || './data';

fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = initDb(DATA_DIR);

const app = express();

app.use(cors());
app.use(express.json());

app.locals.db = db;
app.locals.dataDir = DATA_DIR;

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/files', filesRouter);
app.use('/api/projects/:projectId/prompts', promptsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/instructions', instructionsRouter);
app.use('/api/tools', toolsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// DB export — SQL text dump
app.get('/api/db/export', (req, res) => {
  const target = req.query.target as string | undefined;
  const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';

  if (target === 'pyworker') {
    // Proxy to pyworker
    fetch(`${PYWORKER_URL}/db/export`)
      .then(r => { if (!r.ok) throw new Error(`pyworker ${r.status}`); return r.text(); })
      .then(sql => { res.setHeader('Content-Type', 'text/plain'); res.send(sql); })
      .catch(err => res.status(502).json({ error: err.message }));
    return;
  }

  const currentDb = req.app.locals.db as import('better-sqlite3').Database;
  const tables = currentDb.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[];
  let dump = '';
  for (const t of tables) {
    dump += t.sql + ';\n';
    const rows = currentDb.prepare(`SELECT * FROM "${t.name}"`).all() as Record<string, unknown>[];
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map(c => {
        const v = row[c];
        if (v === null) return 'NULL';
        if (typeof v === 'number') return String(v);
        return "'" + String(v).replace(/'/g, "''") + "'";
      });
      dump += `INSERT INTO "${t.name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${vals.join(',')});\n`;
    }
  }
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="paradice.sql"');
  res.send(dump);
});

// DB import — SQL text restore
app.post('/api/db/import', express.text({ limit: '100mb', type: '*/*' }), (req: Request, res: Response) => {
  const target = req.query.target as string | undefined;
  const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';

  if (target === 'pyworker') {
    // Proxy to pyworker
    fetch(`${PYWORKER_URL}/db/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: req.body as string,
    })
      .then(r => r.json())
      .then(data => res.json(data))
      .catch(err => res.status(502).json({ error: err.message }));
    return;
  }

  const sql = req.body as string;
  if (!sql || sql.length < 10) { res.status(400).json({ error: 'Empty SQL dump' }); return; }

  const dbPath = path.join(DATA_DIR, 'paradice.db');
  const currentDb = req.app.locals.db as import('better-sqlite3').Database;
  currentDb.close();
  fs.unlinkSync(dbPath);
  const newDb = initDb(DATA_DIR);
  newDb.exec(sql);
  app.locals.db = newDb;
  res.json({ ok: true, size: sql.length });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
