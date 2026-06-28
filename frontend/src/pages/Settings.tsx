import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, Skill, Tool, Personality } from '../api';
import CodeEditor from '../components/CodeEditor';

function formatDate(iso: string): { short: string; full: string } {
  const d = new Date(iso);
  const now = new Date();
  const full = d.toLocaleString([], { hour12: false });
  const isToday = d.toDateString() === now.toDateString();
  const short = isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { short, full };
}

type Tab = 'personality' | 'tools' | 'skills';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  // Personality state
  const [instrVersions, setInstrVersions] = useState<Personality[]>([]);
  const [instrIndex, setInstrIndex] = useState(0);
  const [instrText, setInstrText] = useState('');
  const [instrEditing, setInstrEditing] = useState(false);
  const [instrSaving, setInstrSaving] = useState(false);
  const [instrProjects, setInstrProjects] = useState<{ id: string; name: string }[]>([]);
  const instrTextareaRef = useRef<HTMLTextAreaElement>(null);

  // New skill form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newToolName, setNewToolName] = useState('');

  // Editing skill
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editToolName, setEditToolName] = useState('');

  // New tool form
  const [newToolFormName, setNewToolFormName] = useState('');
  const [newToolFormDesc, setNewToolFormDesc] = useState('');
  const [newToolFormCode, setNewToolFormCode] = useState('');
  const [newToolFormSchema, setNewToolFormSchema] = useState('');

  // Editing tool
  const [editingToolName, setEditingToolName] = useState<string | null>(null);
  const [editToolDesc, setEditToolDesc] = useState('');
  const [editToolCode, setEditToolCode] = useState('');
  const [editToolSchema, setEditToolSchema] = useState('');

  // Collapsible new forms
  const [showNewSkill, setShowNewSkill] = useState(false);
  const [showNewTool, setShowNewTool] = useState(false);

  useEffect(() => { loadAll(); loadInstrVersions(); }, []);

  async function loadAll() {
    try {
      const [s, t] = await Promise.all([api.getSkills(), api.getTools()]);
      setSkills(s);
      setTools(t);
    } finally { setLoading(false); }
  }

  // ---- Personality ----
  async function loadInstrVersions() {
    try {
      const v = await api.getPersonalityVersions();
      setInstrVersions(v);
      if (v.length > 0) {
        const lastIdx = v.length - 1;
        setInstrIndex(lastIdx);
        setInstrText(v[lastIdx].text);
        loadInstrProjects(v[lastIdx].id);
      }
    } catch (err) { console.error('Failed to load personality:', err); }
  }

  async function loadInstrProjects(versionId: string) {
    try {
      const p = await api.getPersonalityProjects(versionId);
      setInstrProjects(p);
    } catch { setInstrProjects([]); }
  }

  function instrNavigate(dir: number) {
    const newIdx = instrIndex + dir;
    if (newIdx < 0 || newIdx >= instrVersions.length) return;
    setInstrIndex(newIdx);
    setInstrText(instrVersions[newIdx].text);
    setInstrEditing(false);
    loadInstrProjects(instrVersions[newIdx].id);
  }

  async function instrSave() {
    if (!instrText.trim() || instrSaving) return;
    setInstrSaving(true);
    try {
      const created = await api.updatePersonality(instrText.trim());
      const updated = [...instrVersions, created];
      setInstrVersions(updated);
      setInstrIndex(updated.length - 1);
      setInstrText(created.text);
      setInstrEditing(false);
      loadInstrProjects(created.id);
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Failed to save personality');
    } finally { setInstrSaving(false); }
  }

  function instrCancelEdit() {
    setInstrEditing(false);
    if (instrVersions[instrIndex]) setInstrText(instrVersions[instrIndex].text);
  }

  const instrCurrent = instrVersions[instrIndex];
  const instrHasChanges = instrCurrent && instrText.trim() !== instrCurrent.text;

  useEffect(() => {
    const el = instrTextareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [instrText, instrEditing]);

  useEffect(() => {
    if (!instrEditing) return;
    const el = instrTextareaRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let prevWidth = container.clientWidth;
    const ro = new ResizeObserver(() => {
      const newWidth = container.clientWidth;
      if (newWidth !== prevWidth) {
        prevWidth = newWidth;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [instrEditing]);

  // ---- Skills ----
  async function handleCreateSkill() {
    if (!newName.trim() || !newPrompt.trim()) return;
    await api.createSkill(newName.trim(), newDesc.trim(), newPrompt.trim(), newToolName || undefined);
    setNewName(''); setNewDesc(''); setNewPrompt(''); setNewToolName('');
    setShowNewSkill(false);
    await loadAll();
  }

  async function handleDeleteSkill(id: string) {
    if (!confirm('Delete this skill?')) return;
    await api.deleteSkill(id);
    await loadAll();
  }

  function startEditSkill(skill: Skill) {
    setEditingId(skill.id);
    setEditName(skill.name);
    setEditDesc(skill.description);
    setEditPrompt(skill.system_prompt);
    setEditToolName(skill.tool_name || '');
  }

  async function handleSaveSkill() {
    if (!editingId || !editName.trim() || !editPrompt.trim()) return;
    await api.updateSkill(editingId, {
      name: editName.trim(), description: editDesc.trim(),
      system_prompt: editPrompt.trim(), tool_name: editToolName || '',
    });
    setEditingId(null);
    await loadAll();
  }

  // ---- Tools ----
  async function handleCreateTool() {
    if (!newToolFormName.trim() || !newToolFormCode.trim()) return;
    await api.createTool(newToolFormName.trim(), newToolFormCode.trim(),
      newToolFormDesc.trim() || undefined, newToolFormSchema.trim() || undefined);
    setNewToolFormName(''); setNewToolFormDesc(''); setNewToolFormCode(''); setNewToolFormSchema('');
    setShowNewTool(false);
    await loadAll();
  }

  async function handleDeleteTool(name: string) {
    if (!confirm(`Delete tool "${name}"?`)) return;
    await api.deleteTool(name);
    await loadAll();
  }

  async function startEditTool(name: string) {
    const tool = await api.getTool(name);
    setEditingToolName(name);
    setEditToolDesc(tool.description || '');
    setEditToolCode(tool.code || '');
    setEditToolSchema(tool.params_schema || '');
  }

  async function handleSaveTool() {
    if (!editingToolName) return;
    await api.updateTool(editingToolName, {
      description: editToolDesc.trim(),
      code: editToolCode,
      params_schema: editToolSchema.trim() || undefined,
    });
    setEditingToolName(null);
    await loadAll();
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Link to="/">← Back</Link>
        <h2>Settings</h2>
      </div>

      <div className="settings-tabs">
        <button className={tab === 'skills' ? 'tab active' : 'tab'} onClick={() => setTab('skills')}>Skills</button>
        <button className={tab === 'tools' ? 'tab active' : 'tab'} onClick={() => setTab('tools')}>Tools</button>
        <button className={tab === 'personality' ? 'tab active' : 'tab'} onClick={() => setTab('personality')}>Personality</button>
      </div>

      {/* ===== PERSONALITY TAB ===== */}
      {tab === 'personality' && (
        <div className="instr-tab">
          <div className="instr-version-bar">
            <div className="instr-nav">
              <button className="instr-nav-btn" disabled={instrIndex === 0} onClick={() => instrNavigate(-1)}>‹‹</button>
              <span className="instr-nav-label">{instrVersions.length > 0 ? `${instrIndex + 1}/${instrVersions.length}` : '0/0'}</span>
              <button className="instr-nav-btn" disabled={instrIndex >= instrVersions.length - 1} onClick={() => instrNavigate(1)}>››</button>
            </div>
            {instrEditing && (
              <div className="instr-edit-actions">
                <button className="instr-save-btn" onClick={instrSave} disabled={instrSaving || !instrHasChanges || !instrText.trim()}>
                  {instrSaving ? '…' : '✓'}
                </button>
                <button className="instr-cancel-btn" onClick={instrCancelEdit}>✕</button>
              </div>
            )}
          </div>

          <div className={`msg-turn instr-turn${instrEditing ? ' instr-editing' : ''}`}>
            <div className="msg-bubble user-msg instr-bubble">
              {!instrEditing && (
                <button className="instr-edit-icon" onClick={() => setInstrEditing(true)} title="Edit (creates new version)">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.33a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.83z"/></svg>
                </button>
              )}
              {instrEditing ? (
                <textarea
                  ref={instrTextareaRef}
                  className="instr-inline-textarea"
                  value={instrText}
                  onChange={e => setInstrText(e.target.value)}
                  autoFocus
                />
              ) : (
                <div className="msg-body instr-body">{instrText || <span className="hint">No personality yet.</span>}</div>
              )}
            </div>
            <div className="msg-meta">
              {instrCurrent && (
                <span className="msg-time" title={formatDate(instrCurrent.created_at).full}>
                  {formatDate(instrCurrent.created_at).short}
                </span>
              )}
            </div>
          </div>

          {instrProjects.length > 0 && (
            <div className="instr-projects">
              <span className="instr-projects-label">used in:</span>
              {instrProjects.map(p => (
                <Link key={p.id} to={`/projects/${p.id}`} className="instr-project-link">{p.name}</Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== TOOLS TAB ===== */}
      {tab === 'tools' && (
        <div className="card">
          <p className="hint">Python tools registered in the pyworker. Skills can bind to a tool for pre-processing.</p>

          {tools.map(tool => (
            <div key={tool.name} className="skill-item">
              {editingToolName === tool.name ? (
                <div className="skill-edit">
                  <strong>{tool.name}</strong>
                  <input value={editToolDesc} onChange={e => setEditToolDesc(e.target.value)} placeholder="Description" />
                  <textarea value={editToolSchema} onChange={e => setEditToolSchema(e.target.value)} placeholder="Params JSON Schema" rows={2} />
                  <CodeEditor value={editToolCode} onChange={setEditToolCode} minHeight="160px" />
                  <div className="skill-edit-actions">
                    <button className="primary" onClick={handleSaveTool}>Save</button>
                    <button onClick={() => setEditingToolName(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="skill-row">
                  <strong>{tool.name}</strong>
                  {tool.description && <span className="skill-desc">{tool.description}</span>}
                  {tool.read_only ? <span className="skill-tool">read-only</span> : null}
                  <div className="skill-actions">
                    {!tool.read_only && <button onClick={() => startEditTool(tool.name)}>✎</button>}
                    {!tool.read_only && <button className="delete-btn" onClick={() => handleDeleteTool(tool.name)}>×</button>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {!showNewTool ? (
            <button className="add-new-btn" onClick={() => setShowNewTool(true)}>+ New Tool</button>
          ) : (
            <div className="skill-add">
              <div className="skill-add-header">
                <h4>Register New Tool</h4>
                <button className="delete-btn" onClick={() => setShowNewTool(false)}>×</button>
              </div>
              <input value={newToolFormName} onChange={e => setNewToolFormName(e.target.value)} placeholder="Tool name (e.g. lowercase)" />
              <input value={newToolFormDesc} onChange={e => setNewToolFormDesc(e.target.value)} placeholder="Description (optional)" />
              <textarea value={newToolFormSchema} onChange={e => setNewToolFormSchema(e.target.value)}
                placeholder='Params JSON Schema (optional, e.g. {"type":"object","properties":{"text":{"type":"string"}},"required":["text"]})'
                rows={2} />
              <CodeEditor
                value={newToolFormCode}
                onChange={setNewToolFormCode}
                placeholder={'def run(params):\n    return {"result": params["text"].lower()}'}
                minHeight="100px"
              />
              <button className="primary" onClick={handleCreateTool} disabled={!newToolFormName.trim() || !newToolFormCode.trim()}>
                Register Tool
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== SKILLS TAB ===== */}
      {tab === 'skills' && (
        <div className="card">
          <p className="hint">Skills are system prompts invoked via /skillname in the prompt. Optionally bind a tool for pre-processing.</p>

          {skills.map(skill => (
            <div key={skill.id} className="skill-item">
              {editingId === skill.id ? (
                <div className="skill-edit">
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Skill name" />
                  <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description (optional)" />
                  <select value={editToolName} onChange={e => setEditToolName(e.target.value)}>
                    <option value="">No tool (LLM-only skill)</option>
                    {tools.map(t => (
                      <option key={t.name} value={t.name}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                    ))}
                  </select>
                  <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={4} />
                  <div className="skill-edit-actions">
                    <button className="primary" onClick={handleSaveSkill} disabled={!editName.trim() || !editPrompt.trim()}>Save</button>
                    <button onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="skill-row">
                  <strong>{skill.name}</strong>
                  {skill.tool_name && <span className="skill-tool">tool: {skill.tool_name}</span>}
                  {skill.description && <span className="skill-desc">{skill.description}</span>}
                  <div className="skill-actions">
                    <button onClick={() => startEditSkill(skill)}>✎</button>
                    <button className="delete-btn" onClick={() => handleDeleteSkill(skill.id)}>×</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {!showNewSkill ? (
            <button className="add-new-btn" onClick={() => setShowNewSkill(true)}>+ New Skill</button>
          ) : (
            <div className="skill-add">
              <div className="skill-add-header">
                <h4>Add New Skill</h4>
                <button className="delete-btn" onClick={() => setShowNewSkill(false)}>×</button>
              </div>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Skill name" />
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Short description (optional)" />
              <select value={newToolName} onChange={e => setNewToolName(e.target.value)}>
                <option value="">No tool (LLM-only skill)</option>
                {tools.map(t => (
                  <option key={t.name} value={t.name}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                ))}
              </select>
              <textarea value={newPrompt} onChange={e => setNewPrompt(e.target.value)} placeholder="System prompt (instructions for the LLM)..." rows={3} />
              <button className="primary" onClick={handleCreateSkill} disabled={!newName.trim() || !newPrompt.trim()}>
                Add Skill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
