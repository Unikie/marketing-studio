import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, Skill, Tool, Personality } from '../api';
import CodeEditor from '../components/CodeEditor';
import { formatMessageDate } from '../date';

type Tab = 'personality' | 'tools' | 'skills';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  // Personality state
  const [revisions, setRevisions] = useState<Personality[]>([]);
  const [revisionIndex, setRevisionIndex] = useState(0);
  const [personalityText, setPersonalityText] = useState('');
  const [isEditingPersonality, setIsEditingPersonality] = useState(false);
  const [isSavingPersonality, setIsSavingPersonality] = useState(false);
  const [revisionProjects, setRevisionProjects] = useState<{ id: string; name: string }[]>([]);
  const personalityEditorRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => { loadAll(); loadRevisions(); }, []);

  async function loadAll() {
    try {
      const [s, t] = await Promise.all([api.getSkills(), api.getTools()]);
      setSkills(s);
      setTools(t);
    } finally { setLoading(false); }
  }

  // ---- Personality ----
  async function loadRevisions() {
    try {
      const v = await api.getPersonalityVersions();
      setRevisions(v);
      if (v.length > 0) {
        const lastIdx = v.length - 1;
        setRevisionIndex(lastIdx);
        setPersonalityText(v[lastIdx].text);
        loadRevisionProjects(v[lastIdx].id);
      }
    } catch (err) { console.error('Failed to load personality:', err); }
  }

  async function loadRevisionProjects(versionId: string) {
    try {
      const p = await api.getPersonalityProjects(versionId);
      setRevisionProjects(p);
    } catch { setRevisionProjects([]); }
  }

  function navigateRevision(dir: number) {
    const newIdx = revisionIndex + dir;
    if (newIdx < 0 || newIdx >= revisions.length) return;
    setRevisionIndex(newIdx);
    setPersonalityText(revisions[newIdx].text);
    setIsEditingPersonality(false);
    loadRevisionProjects(revisions[newIdx].id);
  }

  async function savePersonality() {
    if (!personalityText.trim() || isSavingPersonality) return;
    setIsSavingPersonality(true);
    try {
      const created = await api.updatePersonality(personalityText.trim());
      const updated = [...revisions, created];
      setRevisions(updated);
      setRevisionIndex(updated.length - 1);
      setPersonalityText(created.text);
      setIsEditingPersonality(false);
      loadRevisionProjects(created.id);
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Failed to save personality');
    } finally { setIsSavingPersonality(false); }
  }

  function cancelPersonalityEdit() {
    setIsEditingPersonality(false);
    if (revisions[revisionIndex]) setPersonalityText(revisions[revisionIndex].text);
  }

  const currentRevision = revisions[revisionIndex];
  const hasPersonalityChanges = currentRevision && personalityText.trim() !== currentRevision.text;

  useEffect(() => {
    if (!isEditingPersonality) return;
    const el = personalityEditorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [isEditingPersonality]);

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
        <h2>Settings</h2>
      </div>

      <div className="settings-tabs">
        <button className={tab === 'skills' ? 'tab active' : 'tab'} onClick={() => setTab('skills')}>Skills</button>
        <button className={tab === 'tools' ? 'tab active' : 'tab'} onClick={() => setTab('tools')}>Tools</button>
        <button className={tab === 'personality' ? 'tab active' : 'tab'} onClick={() => setTab('personality')}>Personality</button>
      </div>

      {/* ===== PERSONALITY TAB ===== */}
      {tab === 'personality' && (
        <div className="personality-tab">
          <div className={`msg-turn personality-turn${isEditingPersonality ? ' personality-editing' : ''}`}>
            <div className="msg-bubble user-msg personality-bubble">
              {!isEditingPersonality && (
                <button className="personality-edit-icon" onClick={() => setIsEditingPersonality(true)} title="Edit (creates new revision)">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.33a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.83z"/></svg>
                </button>
              )}
              <div
                ref={personalityEditorRef}
                className="msg-body personality-body"
                contentEditable={isEditingPersonality}
                suppressContentEditableWarning
                onInput={e => setPersonalityText(e.currentTarget.textContent || '')}
              >
                {personalityText || (!isEditingPersonality ? <span className="hint">No personality yet.</span> : '')}
              </div>
            </div>
            <div className="msg-meta personality-meta">
              {currentRevision && (
                <span className="msg-time" title={formatMessageDate(currentRevision.created_at).full}>
                  {formatMessageDate(currentRevision.created_at).short}
                </span>
              )}
              {revisions.length > 1 && (
                <div className="revision-nav" aria-label="Personality revisions">
                  <button className="revision-nav-btn" disabled={revisionIndex === 0} onClick={() => navigateRevision(-1)}>{'<'}</button>
                  <span className="revision-nav-label">{revisionIndex + 1}/{revisions.length}</span>
                  <button className="revision-nav-btn" disabled={revisionIndex >= revisions.length - 1} onClick={() => navigateRevision(1)}>{'>'}</button>
                </div>
              )}
              {isEditingPersonality && (
                <div className="personality-edit-actions">
                  <button className="personality-save-btn" onClick={savePersonality} disabled={isSavingPersonality || !hasPersonalityChanges || !personalityText.trim()}>
                    {isSavingPersonality ? '…' : '✓'}
                  </button>
                  <button className="personality-cancel-btn" onClick={cancelPersonalityEdit}>✕</button>
                </div>
              )}
            </div>
          </div>

          {revisionProjects.length > 0 && (
            <div className="revision-projects">
              <span className="revision-projects-label">used in:</span>
              {revisionProjects.map(p => (
                <Link key={p.id} to={`/projects/${p.id}`} className="revision-project-link">{p.name}</Link>
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
