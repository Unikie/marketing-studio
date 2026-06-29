import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { api, type Project as ProjectData, Prompt as PromptData } from '../api';
import { useSSE } from '../hooks/useSSE';
import DebugView from '../components/DebugView';
import PromptBox, { type PromptHandle } from '../components/Prompt';
import { formatMessageDate } from '../date';

// --- Tree utilities for prompt_context-based branching ---

// Get the prompt-ref parent of a top-level prompt
function getParentId(p: PromptData): string | null {
  const ref = (p.context || []).find(c => c.type === 'prompt');
  return ref ? ref.id : null;
}

// Build children map: parentId -> children (siblings)
function buildChildrenMap(topLevel: PromptData[]): Map<string | null, PromptData[]> {
  const map = new Map<string | null, PromptData[]>();
  for (const p of topLevel) {
    const parentId = getParentId(p);
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId)!.push(p);
  }
  return map;
}

// Walk from a leaf up to root
function getPathToRoot(topLevel: PromptData[], leafId: string): PromptData[] {
  const byId = new Map(topLevel.map(p => [p.id, p]));
  const path: PromptData[] = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    const parentId = getParentId(current);
    current = parentId ? byId.get(parentId) : undefined;
  }
  return path;
}

function getNewestPromptId(topLevel: PromptData[]): string | null {
  if (topLevel.length === 0) return null;
  return [...topLevel].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].id;
}

function findNewestDescendant(childrenMap: Map<string | null, PromptData[]>, start: PromptData): string {
  let newest = start;
  const stack = [start.id];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    const children = childrenMap.get(currentId) || [];
    for (const child of children) {
      if (child.created_at.localeCompare(newest.created_at) > 0) newest = child;
      stack.push(child.id);
    }
  }

  return newest.id;
}

function formatPipelineStage(stage: PromptData): string {
  const skill = stage.skill?.trim();
  if (stage.type === 'tool') {
    const prompt = stage.prompt || '';
    if (prompt.startsWith('file_analysis:')) return `tool ${prompt}`;
    const toolName = prompt.split(/\s+/)[0] || 'tool';
    return `tool ${toolName.replace(/:$/, '')}`;
  }
  if (stage.type === 'llm') {
    if (skill) return `llm ${skill}`;
    return 'llm final response';
  }
  return skill ? `${stage.type} ${skill}` : stage.type;
}

type PipelineProgress = { label: string; error?: string };

function getPipelineProgress(parent: PromptData, prompts: PromptData[]): PipelineProgress | null {
  if (parent.type !== 'pipeline') return null;
  const children = prompts
    .filter(child => child.pipeline_id === parent.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latestChildren = [...children].reverse();

  if (parent.status === 'error') {
    const failed = latestChildren.find(child => child.status === 'error') || latestChildren[0];
    const label = failed ? formatPipelineStage(failed) : 'stage failed';
    return { label, error: failed?.error || parent.error || 'Pipeline failed' };
  }

  if (parent.status !== 'processing' && parent.status !== 'pending') return null;

  const current = latestChildren.find(child => child.status === 'processing' || child.status === 'pending');
  if (current) return { label: formatPipelineStage(current) };

  const failed = latestChildren.find(child => child.status === 'error');
  if (failed) return { label: formatPipelineStage(failed), error: failed.error || 'Stage failed' };

  return null;
}

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [prompts, setPrompts] = useState<PromptData[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingPromptId, setStreamingPromptId] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState('');
  const [pipelineStages, setPipelineStages] = useState<Record<string, PipelineProgress>>({});

  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'history' | 'debug'>('history');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [visiblePromptId, setVisiblePromptId] = useState<string | null>(null);

  const promptRef = useRef<PromptHandle>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const { lastEvent } = useSSE(id);
  const promptsRef = useRef<PromptData[]>([]);
  const pipelineClearTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const incomingHandled = useRef(false);

  useEffect(() => { promptsRef.current = prompts; }, [prompts]);

  useEffect(() => {
    return () => {
      Object.values(pipelineClearTimersRef.current).forEach(clearTimeout);
      pipelineClearTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    const state = location.state as { prompt?: string; files?: File[] } | null;
    if (state?.prompt && !incomingHandled.current) {
      // Fresh project — only fetch project metadata, skip history
      incomingHandled.current = true;
      navigate(location.pathname, { replace: true, state: null });
      api.getProject(id).then(setProject).catch(console.error).finally(() => setLoading(false));
      handleSend(state.prompt, state.files || []);
    } else {
      loadData();
    }
  }, [id]);

  async function loadData() {
    try {
      const [proj, p] = await Promise.all([
        api.getProject(id!),
        api.getPrompts(id!),
      ]);
      setProject(proj);
      setPrompts(p);

      // Set active leaf to newest branch if not set
      const topLevel = p.filter(pr => pr.pipeline_id === null);
      setActiveLeafId(prev => {
        if (prev && topLevel.find(pr => pr.id === prev)) return prev;
        return getNewestPromptId(topLevel);
      });
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'pipeline-stage') {
      const pipelineId = lastEvent.pipelineId as string | undefined;
      if (pipelineId) {
        const pendingClear = pipelineClearTimersRef.current[pipelineId];
        if (pendingClear) {
          clearTimeout(pendingClear);
          delete pipelineClearTimersRef.current[pipelineId];
        }
        setPipelineStages(prev => ({
          ...prev,
          [pipelineId]: {
            label: lastEvent.label || 'pipeline stage',
            error: lastEvent.status === 'error' ? lastEvent.error || 'Stage failed' : undefined,
          },
        }));
      }
    }
    if (lastEvent.type === 'prompt-chunk') {
      const eventPrompt = promptsRef.current.find(p => p.id === lastEvent.promptId);
      const isFinalPipelineChunk = lastEvent.pipelineId || (eventPrompt?.pipeline_id && eventPrompt.type === 'llm' && !eventPrompt.skill);
      if (!eventPrompt?.pipeline_id || isFinalPipelineChunk) {
        setStreamingPromptId(lastEvent.pipelineId || eventPrompt?.pipeline_id || lastEvent.promptId);
        setStreamContent(lastEvent.fullContent || '');
      }
    }
    if (lastEvent.type === 'prompt-status') {
      if (lastEvent.status === 'completed' || lastEvent.status === 'error' || lastEvent.status === 'stopped') {
        if (lastEvent.promptId === activeLeafId && lastEvent.status === 'completed') {
          const promptId = lastEvent.promptId;
          const pendingClear = pipelineClearTimersRef.current[promptId];
          if (pendingClear) clearTimeout(pendingClear);
          pipelineClearTimersRef.current[promptId] = setTimeout(() => {
            setPipelineStages(prev => {
              const next = { ...prev };
              delete next[promptId];
              return next;
            });
            delete pipelineClearTimersRef.current[promptId];
          }, 1500);
        }
        if (lastEvent.promptId === activeLeafId) {
          loadData();
          setStreamingPromptId(null);
          setStreamContent('');
          setSending(false);
        }
      }
    }
  }, [lastEvent, activeLeafId]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [prompts, streamContent, activeLeafId]);

  // Top-level prompts and tree structures
  const topLevelPrompts = prompts.filter(p => p.pipeline_id === null);
  const childrenMap = buildChildrenMap(topLevelPrompts);
  const currentPath = activeLeafId ? getPathToRoot(topLevelPrompts, activeLeafId) : [];

  // Track which user prompt is currently visible
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let latest: { id: string; top: number } | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pid = (entry.target as HTMLElement).dataset.promptId;
            if (pid) {
              const top = entry.boundingClientRect.top;
              if (!latest || top > latest.top) latest = { id: pid, top };
            }
          }
        }
        if (latest) setVisiblePromptId(latest.id);
      },
      { root: container, threshold: 0.3 }
    );
    const els = container.querySelectorAll('[data-prompt-id]');
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [currentPath]);

  // Get the "answer" for a top-level prompt
  function getResponse(p: PromptData): string {
    if (p.type === 'pipeline') {
      const children = prompts.filter(c => c.pipeline_id === p.id && c.type === 'llm' && c.status === 'completed');
      if (children.length === 0) return '';
      return children[children.length - 1].response;
    }
    return p.response;
  }

  async function handleSend(text: string, files: File[]) {
    if (!id) return;
    setSending(true);

    try {
      let fileIds: string[] = [];
      if (files.length > 0) {
        const uploaded = await api.uploadFiles(id, files);
        fileIds = uploaded.map(f => f.id);
        const updatedProject = await api.getProject(id);
        setProject(updatedProject);
      }

      let newPrompt: PromptData;
      if (editingPromptId) {
        newPrompt = await api.retryPrompt(id, editingPromptId, text, fileIds.length > 0 ? fileIds : undefined);
        setEditingPromptId(null);
      } else {
        newPrompt = await api.createPrompt(id, text, fileIds, activeLeafId);
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

  async function handleRetry(p: PromptData) {
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

  function startEdit(p: PromptData) {
    setEditingPromptId(p.id);
    promptRef.current?.setEditText(p.prompt);
  }

  function cancelEdit() {
    setEditingPromptId(null);
    promptRef.current?.setEditText('');
  }

  function switchBranch(p: PromptData, direction: number) {
    const parentId = getParentId(p);
    const siblings = topLevelPrompts.filter(s => getParentId(s) === parentId);
    siblings.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = siblings.findIndex(s => s.id === p.id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= siblings.length) return;
    const newSibling = siblings[newIdx];
    const deepest = findNewestDescendant(childrenMap, newSibling);
    setActiveLeafId(deepest);
  }

  if (loading) return <div>Loading...</div>;
  if (!project) return <div>Project not found</div>;

  return (
    <div className="project-page">
      <div className="project-header">
        {renaming ? (
          <input
            className="rename-input"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && renameValue.trim()) {
                const updated = await api.renameProject(id!, renameValue.trim());
                setProject(updated);
                setRenaming(false);
                window.dispatchEvent(new Event('project-updated'));
              }
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
            autoFocus
          />
        ) : (
          <h2 className="project-title">
            {project.name}
            <button className="rename-btn" onClick={() => { setRenameValue(project.name); setRenaming(true); }} title="Rename">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.33a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.83z"/></svg>
            </button>
          </h2>
        )}
        <div className="view-tabs">
          <button className={`view-tab ${viewMode === 'history' ? 'active' : ''}`} onClick={() => setViewMode('history')}>History</button>
          <button className={`view-tab ${viewMode === 'debug' ? 'active' : ''}`} onClick={() => setViewMode('debug')}>Debug</button>
        </div>
      </div>

      {viewMode === 'debug' ? (
        <DebugView prompts={prompts} />
      ) : (
      <div className="history-wrapper">
      <div className="history-messages" ref={scrollContainerRef} onScroll={handleScroll}>
        {currentPath.length === 0 && !sending && (
          <div className="history-empty">No messages yet. Type a prompt below or attach files to get started.</div>
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
          const pipelineProgress = pipelineStages[p.id] || getPipelineProgress(p, prompts);

          return (
            <div key={p.id} className="msg-turn" data-prompt-id={p.id}>
              <div className={`msg-bubble user-msg${editingPromptId === p.id ? ' editing-highlight' : ''}`}>
                {hasBranches && !isLatestBranch && <span className="edited-badge" title="Edited">✎</span>}
                {p.prompt && <div className="msg-body">{p.prompt}</div>}
                {fileRefs.length > 0 && (
                  <div className="msg-files">
                    {fileRefs.map(ref => (
                      <span key={ref.id} className="file-chip">📎 {ref.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="msg-meta history-meta">
                <span className="msg-time" title={formatMessageDate(p.updated_at || p.created_at).full}>
                  {formatMessageDate(p.updated_at || p.created_at).short}
                </span>
                {hasBranches && (
                  <div className="branch-selector" aria-label="Prompt branches">
                    <button className="branch-btn" disabled={sibIdx === 0} onClick={() => switchBranch(p, -1)}>{'<'}</button>
                    <span className="branch-label">{sibIdx + 1}/{siblings.length}</span>
                    <button className="branch-btn" disabled={sibIdx === siblings.length - 1} onClick={() => switchBranch(p, 1)}>{'>'}</button>
                  </div>
                )}
                <div className="msg-actions history-actions">
                  {(p.status === 'completed' || p.status === 'stopped' || p.status === 'error') && !isStreaming && (
                    <button className="retry-btn" onClick={() => handleRetry(p)} title="Retry (creates branch)">↻</button>
                  )}
                  <button className="edit-btn" onClick={() => startEdit(p)} title="Edit (creates branch)">✎</button>
                </div>
              </div>

              {(response || p.status === 'processing' || p.status === 'pending' || p.status === 'error' || p.status === 'stopped') && (
                <>
                <div className="msg-bubble assistant-msg">
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
                </div>
                <div className="msg-meta assistant-meta history-meta">
                  <span className="msg-time" title={formatMessageDate(p.updated_at || p.created_at).full}>
                    {formatMessageDate(p.updated_at || p.created_at).short}
                  </span>
                  {pipelineProgress && (
                    <span
                      className={`pipeline-progress${pipelineProgress.error ? ' error' : ''}`}
                      title={pipelineProgress.error || pipelineProgress.label}
                    >
                      {pipelineProgress.label}
                    </span>
                  )}
                </div>
                </>
              )}
            </div>
          );
        })}

        <div ref={endRef} />
      </div>
      {currentPath.length > 1 && (
        <div className="nav-dots">
          {currentPath.map(p => (
            <button
              key={p.id}
              className={`nav-dot ${p.id === visiblePromptId ? 'active' : ''}`}
              title={p.prompt?.slice(0, 40) || '...'}
              onClick={() => {
                const el = scrollContainerRef.current?.querySelector(`[data-prompt-id="${p.id}"]`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ))}
        </div>
      )}
      </div>
      )}

      <PromptBox
        ref={promptRef}
        onSend={handleSend}
        sending={sending}
        showStop={!!streamingPromptId}
        onStop={handleStop}
        draftKey={id}
        editingBanner={editingPromptId ? (
          <div className="editing-banner">
            <span>✎ Editing prompt (will create a branch)</span>
            <button onClick={cancelEdit}>Cancel</button>
          </div>
        ) : undefined}
      />
    </div>
  );
}
