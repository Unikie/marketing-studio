import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Instructions() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadInstruction(); }, []);

  async function loadInstruction() {
    try {
      const instr = await api.getInstruction();
      setText(instr.text);
    } catch (err) {
      console.error('Failed to load instruction:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const updated = await api.updateInstruction(text.trim());
      setText(updated.text);
      setSaved(true);
    } catch (err) {
      console.error('Failed to save:', err);
      alert('Failed to save system instruction');
    } finally {
      setSaving(false);
    }
  }

  function handleChange(val: string) {
    setText(val);
    setSaved(false);
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Link to="/">← Back</Link>
        <h2>System Instructions</h2>
      </div>

      <div className="card">
        <p className="hint">
          This is the base system prompt sent to the LLM with every request.
          It defines the assistant's personality and behavior.
        </p>

        <textarea
          className="instruction-textarea"
          value={text}
          onChange={e => handleChange(e.target.value)}
          rows={12}
          placeholder="Enter system instructions..."
        />

        <div className="instruction-actions">
          <button className="primary" onClick={handleSave} disabled={saving || saved || !text.trim()}>
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </button>
          {!saved && <span className="unsaved-hint">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
