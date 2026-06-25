import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type Project as ProjectData, Prompt, Skill } from '../api';
import { useSSE } from '../hooks/useSSE';
import DebugView from '../components/DebugView';

function formatTime(iso: string): { short: string; full: string } {
  const d = new Date(iso);
  const now = new Date();
  const full = d.toLocaleString([], { hour12: false });
  const isToday = d.toDateString() === now.toDateString();
  const short = isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { short, full };
}

// --- Tree utilities for prompt_context-based branching ---

// Get the prompt-ref parent of a top-level prompt
function getParentId(p: Prompt): string | null {
  const ref = (p.context || []).find(c => c.type === 'prompt');
  return ref ? ref.id : null;
}

// Build children map: parentId -> children (siblings)
function buildChildrenMap(topLevel: Prompt[]): Map<string | null, Prompt[]> {
  const map = new Map<string | null, Prompt[]>();
  for (const p of topLevel) {
    const parentId = getParentId(p);
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId)!.push(p);
  }
  return map;
}

// Walk from a leaf up to root
function getPathToRoot(topLevel: Prompt[], leafId: string): Prompt[] {
  const byId = new Map(topLevel.map(p => [p.id, p]));
  const path: Prompt[] = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    const parentId = getParentId(current);
    current = parentId ? byId.get(parentId) : undefined;
  }
  return path;
}

// Find the deepest leaf following the "newest" branch at each fork
function findNewestLeaf(topLevel: Prompt[], childrenMap: Map<string | null, Prompt[]>, startId?: string | null): string | null {
  if (topLevel.length === 0) return null;
  let currentId = startId ?? null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const children = childrenMap.get(currentId);
    if (!children || children.length === 0) return currentId;
    // Pick the child that has the newest descendant (approximated by latest created_at in subtree)
    children.sort((a, b) => b.created_at.localeCompare(a.created_at));
    currentId = children[0].id;
  }
}

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingPromptId, setStreamingPromptId] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState('');

  const [inputText, setInputText] = useState('');
  const [inputFiles, setInputFiles] = useState<File[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'chat' | 'debug'>('chat');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const { lastEvent } = useSSE(id);

  const filteredSkills = slashQuery !== null
    ? skills.filter(s => s.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
    : [];

  useEffect(() => { if (id) loadData(); }, [id]);

  async function loadData() {
    try {
      const [proj, p, s] = await Promise.all([
        api.getProject(id!),
        api.getPrompts(id!),
        api.getSkills(),
      ]);
      setProject(proj);
      setPrompts(p);
      setSkills(s);

      // Set active leaf to newest branch if not set
      const topLevel = p.filter(pr => pr.pipeline_id === null);
      const childrenMap = buildChildrenMap(topLevel);
      setActiveLeafId(prev => {
        if (prev && topLevel.find(pr => pr.id === prev)) return prev;
        return findNewestLeaf(topLevel, childrenMap);
      });
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'prompt-chunk') {
      setStreamingPromptId(lastEvent.promptId);
      setStreamContent(lastEvent.fullContent || '');
    }
    if (lastEvent.type === 'prompt-status') {
      if (lastEvent.status === 'completed' || lastEvent.status === 'error' || lastEvent.status === 'stopped') {
        setStreamingPromptId(null);
        setStreamContent('');
        setSending(false);
        loadData();
      }
    }
  }, [lastEvent]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }
  }, [inputText]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [prompts, streamContent, activeLeafId]);

  // Top-level prompts and tree structures
  const topLevelPrompts = prompts.filter(p => p.pipeline_id === null);
  const childrenMap = buildChildrenMap(topLevelPrompts);
  const currentPath = activeLeafId ? getPathToRoot(topLevelPrompts, activeLeafId) : [];

  // Get the "answer" for a top-level prompt
  function getResponse(p: Prompt): string {
    if (p.type === 'pipeline') {
      const children = prompts.filter(c => c.pipeline_id === p.id && c.type === 'llm' && c.status === 'completed');
      if (children.length === 0) return '';
      return children[children.length - 1].response;
    }
    return p.response;
  }

  async function handleSend() {
    if (!id || (!inputText.trim() && inputFiles.length === 0)) return;
    const prompt = inputText.trim();
    setSending(true);
    setInputText('');
    setSlashQuery(null);

    try {
      let fileIds: string[] = [];
      if (inputFiles.length > 0) {
        const uploaded = await api.uploadFiles(id, inputFiles);
        fileIds = uploaded.map(f => f.id);
        setInputFiles([]);
        const updatedProject = await api.getProject(id);
        setProject(updatedProject);
      }

      let newPrompt: Prompt;
      if (editingPromptId) {
        newPrompt = await api.retryPrompt(id, editingPromptId, prompt, fileIds.length > 0 ? fileIds : undefined);
        setEditingPromptId(null);
      } else {
        newPrompt = await api.createPrompt(id, prompt, fileIds);
      }

      setPrompts(prev => [...prev, newPrompt]);
      setActiveLeafId(newPrompt.id);
      setStreamingPromptId(newPrompt.id);
      setStreamContent('');
    } catch (err) {
      console.error('Failed to send:', err);
      setSending(false);
      alert('Failed to send message');
    }
  }

  async function handleStop() {
    if (!id || !streamingPromptId) return;
    try { await api.stopPrompt(id, streamingPromptId); }
    catch (err) { console.error('Failed to stop:', err); }
  }

  async function handleRetry(p: Prompt) {
    if (!id) return;
    setSending(true);
    try {
      const newPrompt = await api.retryPrompt(id, p.id);
      setPrompts(prev => [...prev, newPrompt]);
      setActiveLeafId(newPrompt.id);
      setStreamingPromptId(newPrompt.id);
      setStreamContent('');
    } catch (err) {
      console.error('Failed to retry:', err);
      setSending(false);
    }
  }

  function startEdit(p: Prompt) {
    setEditingPromptId(p.id);
    setInputText(p.prompt);
    textareaRef.current?.focus();
  }

  function cancelEdit() {
    setEditingPromptId(null);
    setInputText('');
    setInputFiles([]);
  }

  function switchBranch(p: Prompt, direction: number) {
    const parentId = getParentId(p);
    const siblings = topLevelPrompts.filter(s => getParentId(s) === parentId);
    siblings.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = siblings.findIndex(s => s.id === p.id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= siblings.length) return;
    const newSibling = siblings[newIdx];
    const deepest = findNewestLeaf(topLevelPrompts, childrenMap, newSibling.id);
    setActiveLeafId(deepest);
  }

  function handleInputDrop(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    setInputFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInputText(val);
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const slashMatch = textBeforeCursor.match(/\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) { setSlashQuery(slashMatch[1]); setSlashIndex(0); }
    else { setSlashQuery(null); }
  }

  function insertSkill(skillName: string) {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const slashMatch = textBeforeCursor.match(/\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) {
      const start = cursorPos - slashMatch[0].length;
      const newText = inputText.slice(0, start) + '/' + skillName + ' ' + inputText.slice(cursorPos);
      setInputText(newText);
      setSlashQuery(null);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + skillName.length + 2, start + skillName.length + 2); }, 0);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashQuery !== null && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, filteredSkills.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); insertSkill(filteredSkills[slashIndex].name); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (loading) return <div>Loading...</div>;
  if (!project) return <div>Project not found</div>;

  return (
    <div className="chat-page">
      <div className="chat-header">
        <Link to="/">← Projects</Link>
        <h2>{project.name}</h2>
        <div className="view-tabs">
          <button className={`view-tab ${viewMode === 'chat' ? 'active' : ''}`} onClick={() => setViewMode('chat')}>Chat</button>
          <button className={`view-tab ${viewMode === 'debug' ? 'active' : ''}`} onClick={() => setViewMode('debug')}>Debug</button>
        </div>
      </div>

      {viewMode === 'debug' ? (
        <DebugView prompts={prompts} />
      ) : (
      <div className="chat-messages" ref={scrollContainerRef} onScroll={handleScroll}>
        {currentPath.length === 0 && !sending && (
          <div className="chat-empty">No messages yet. Type a prompt below or attach files to get started.</div>
        )}

        {currentPath.map(p => {
          const parentId = getParentId(p);
          const siblings = topLevelPrompts.filter(s => getParentId(s) === parentId);
          siblings.sort((a, b) => a.created_at.localeCompare(b.created_at));
          const sibIdx = siblings.findIndex(s => s.id === p.id);
          const hasBranches = siblings.length > 1;
          const isLatestBranch = hasBranches && sibIdx === siblings.length - 1;

          const isStreaming = p.id === streamingPromptId;
          const response = isStreaming ? streamContent : getResponse(p);
          const fileRefs = (p.context || []).filter(c => c.type === 'file');

          return (
            <div key={p.id} className="chat-turn">
              <div className={`chat-msg user-msg${editingPromptId === p.id ? ' editing-highlight' : ''}`}>
                {hasBranches && !isLatestBranch && <span className="edited-badge" title="Edited">✎</span>}
                {p.prompt && <div className="msg-body">{p.prompt}</div>}
                {fileRefs.length > 0 && (
                  <div className="msg-files">
                    {fileRefs.map(ref => (
                      <span key={ref.id} className="file-chip">📎 {ref.name}</span>
                    ))}
                  </div>
                )}
                <div className="msg-footer">
                  <div className="msg-right">
                    <div className="msg-actions">
                      <button className="edit-btn" onClick={() => startEdit(p)} title="Edit (creates branch)">✎</button>
                      {(p.status === 'completed' || p.status === 'stopped' || p.status === 'error') && !isStreaming && (
                        <button className="retry-btn" onClick={() => handleRetry(p)} title="Retry (creates branch)">↻</button>
                      )}
                    </div>
                    <span className="msg-time" title={formatTime(p.updated_at || p.created_at).full}>
                      {formatTime(p.updated_at || p.created_at).short}
                    </span>
                  </div>
                </div>
              </div>
              {hasBranches && (
                <div className="branch-selector">
                  <button className="branch-btn" disabled={sibIdx === 0} onClick={() => switchBranch(p, -1)}>‹</button>
                  <span className="branch-label">{sibIdx + 1}/{siblings.length}</span>
                  <button className="branch-btn" disabled={sibIdx === siblings.length - 1} onClick={() => switchBranch(p, 1)}>›</button>
                </div>
              )}

              {(response || p.status === 'processing' || p.status === 'pending' || p.status === 'error' || p.status === 'stopped') && (
                <div className="chat-msg assistant-msg">
                  {(p.status === 'pending' || p.status === 'processing') && !response && (
                    <div className="msg-status"><span className="typing-indicator">⏳ Thinking...</span></div>
                  )}
                  {p.status === 'error' && <div className="msg-error">Error: {p.error}</div>}
                  {p.status === 'stopped' && !response && <div className="msg-stopped">⏹ Stopped</div>}
                  {response && (
                    <div className="msg-body response-text">
                      {response}
                      {isStreaming && <span className="cursor-blink">▌</span>}
                    </div>
                  )}
                  <div className="msg-footer">
                    {p.type === 'pipeline' && <span className="mode-tag">pipeline</span>}
                    <span className="msg-time" title={formatTime(p.updated_at || p.created_at).full}>
                      {formatTime(p.updated_at || p.created_at).short}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div ref={chatEndRef} />
      </div>
      )}

      <div
        className="chat-input-container"
        onDrop={handleInputDrop}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
        onDragLeave={e => e.currentTarget.classList.remove('dragover')}
      >
        {editingPromptId && (
          <div className="editing-banner">
            <span>✎ Editing prompt (will create a branch)</span>
            <button onClick={cancelEdit}>Cancel</button>
          </div>
        )}
        {inputFiles.length > 0 && (
          <div className="attached-files">
            {inputFiles.map((f, i) => (
              <span key={i} className="file-chip">
                📎 {f.name}
                <button className="remove-file" onClick={() => setInputFiles(prev => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <span className="attach-btn" title="Attach files" onClick={() => fileInputRef.current?.click()}>
            📎
          </span>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.ppt,.doc" style={{ position: 'absolute', left: '-9999px' }}
            onChange={e => { const files = Array.from(e.target.files || []); if (files.length > 0) setInputFiles(prev => [...prev, ...files]); e.target.value = ''; }} />
          <div className="textarea-wrapper">
            <textarea ref={textareaRef} className="chat-textarea" value={inputText} onChange={handleInputChange}
              onKeyDown={handleKeyDown} placeholder="Type / for skills, attach files, or type a prompt..." rows={1} disabled={sending} />
            {slashQuery !== null && filteredSkills.length > 0 && (
              <div className="slash-autocomplete">
                {filteredSkills.map((skill, i) => (
                  <div key={skill.id} className={`slash-item ${i === slashIndex ? 'active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); insertSkill(skill.name); }}>
                    <span className="slash-name">/{skill.name}</span>
                    {skill.description && <span className="slash-desc">{skill.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {streamingPromptId ? (
            <button className="stop-btn" onClick={handleStop} title="Stop">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            </button>
          ) : (
            <button className="send-btn" onClick={handleSend} disabled={sending || !inputText.trim()} title="Send">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
