import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { api, Skill } from '../api';

export interface PromptHandle {
  setEditText: (text: string) => void;
}

interface PromptProps {
  onSend: (text: string, files: File[]) => Promise<void>;
  sending: boolean;
  autoFocus?: boolean;
  className?: string;
  showStop?: boolean;
  onStop?: () => void;
  editingBanner?: React.ReactNode;
  draftKey?: string;
}

const Prompt = forwardRef<PromptHandle, PromptProps>(function Prompt(
  { onSend, sending, autoFocus, className, showStop, onStop, editingBanner, draftKey },
  ref
) {
  const [inputText, setInputText] = useState('');
  const [inputFiles, setInputFiles] = useState<File[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  const filteredSkills = slashQuery !== null
    ? skills.filter(s => s.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
    : [];

  useEffect(() => { api.getSkills().then(setSkills).catch(() => {}); }, []);

  // Load draft on mount or when draftKey changes
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = false;
    setInputText('');
    if (!draftKey) return;
    api.getDraft(draftKey).then(d => { if (d.text) setInputText(d.text); }).catch(() => {});
  }, [draftKey]);

  // Debounce-save draft on text change (only if user edited)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftKey || !dirtyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.saveDraft(draftKey, inputText).catch(() => {});
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [inputText, draftKey]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }
  }, [inputText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    let prevWidth = container.clientWidth;
    const ro = new ResizeObserver(() => {
      const newWidth = container.clientWidth;
      if (newWidth !== prevWidth) {
        prevWidth = newWidth;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!plusMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setPlusMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [plusMenuOpen]);

  async function handleSend() {
    if (!inputText.trim() && inputFiles.length === 0) return;
    const text = inputText.trim();
    const files = [...inputFiles];
    setInputText('');
    setInputFiles([]);
    setSlashQuery(null);
    await onSend(text, files);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    dirtyRef.current = true;
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
      dirtyRef.current = true;
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

  function setEditText(text: string) {
    setInputText(text);
    textareaRef.current?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      setInputFiles(prev => [...prev, ...files]);
    }
  }

  useImperativeHandle(ref, () => ({ setEditText }));

  return (
    <div
      className={`prompt-container ${className || ''}`}
      onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); setInputFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
      onDragLeave={e => e.currentTarget.classList.remove('dragover')}
    >
      {editingBanner}
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
      <div className="prompt-row">
        <div className="plus-menu-wrapper" ref={plusMenuRef}>
          <button className="plus-menu-trigger" onClick={() => setPlusMenuOpen(!plusMenuOpen)} title="Add">+</button>
          {plusMenuOpen && (
            <div className="plus-menu">
              <div className="plus-menu-item" onClick={() => { fileInputRef.current?.click(); setPlusMenuOpen(false); }}>
                📎 Attach files
              </div>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.pptx,.ppt,.doc" style={{ position: 'absolute', left: '-9999px' }}
          onChange={e => { const files = Array.from(e.target.files || []); if (files.length > 0) setInputFiles(prev => [...prev, ...files]); e.target.value = ''; }} />
        <div className="textarea-wrapper">
          <textarea ref={textareaRef} className="prompt-textarea" value={inputText} onChange={handleInputChange}
            onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Type / for skills, attach files, or type a prompt..." rows={1} disabled={sending} autoFocus={autoFocus} />
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
        {showStop && onStop ? (
          <button className="stop-btn" onClick={onStop} title="Stop">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ) : (
          <button className="send-btn" onClick={handleSend} disabled={sending || (!inputText.trim() && inputFiles.length === 0)} title="Send">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        )}
      </div>
    </div>
  );
});

export default Prompt;
