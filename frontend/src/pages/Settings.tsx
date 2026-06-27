import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, Skill, Tool } from '../api';
import CodeEditor from '../components/CodeEditor';

type Tab = 'instructions' | 'tools' | 'skills';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [s, t] = await Promise.all([api.getSkills(), api.getTools()]);
      setSkills(s);
      setTools(t);
    } finally { setLoading(false); }
  }

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
        <button className={tab === 'instructions' ? 'tab active' : 'tab'} onClick={() => setTab('instructions')}>Instructions</button>
      </div>

      {/* ===== INSTRUCTIONS TAB ===== */}
      {tab === 'instructions' && (
        <div className="card">
          <h3>System Instructions</h3>
          <p className="hint">Base system prompt for all LLM calls.</p>
          <Link to="/instructions" className="primary btn-link">Edit System Instructions</Link>
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
