import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

const router = Router({ mergeParams: true });

// Helper: build clean prompt response object
function cleanPrompt(db: Database.Database, promptId: string): object {
  const p = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any;
  if (!p) return {};

  const rawContext = db.prepare('SELECT ref_type, ref_id FROM prompt_context WHERE prompt_id = ?').all(promptId) as { ref_type: string; ref_id: string }[];
  const context = rawContext.map(ref => {
    if (ref.ref_type === 'file') {
      const file = db.prepare('SELECT name FROM files WHERE id = ?').get(ref.ref_id) as { name: string } | undefined;
      return { type: 'file', name: file?.name || 'unknown' };
    }
    // Prompt ref — resolve to content, keep id for navigation
    const rp = db.prepare('SELECT type, prompt, response, status FROM prompts WHERE id = ?').get(ref.ref_id) as any;
    if (rp) {
      const entry: any = { type: 'prompt', id: ref.ref_id, prompt_type: rp.type, status: rp.status };
      if (rp.prompt) entry.prompt = rp.prompt;
      if (rp.response) entry.response = rp.response;
      return entry;
    }
    return { type: 'prompt', id: ref.ref_id };
  });

  const skill = p.skill_id ? (db.prepare('SELECT name FROM skills WHERE id = ?').get(p.skill_id) as { name: string } | undefined)?.name || null : null;

  const clean: any = {
    id: p.id,
    pipeline_id: p.pipeline_id || null,
    type: p.type,
    prompt: p.prompt,
    response: p.response,
    status: p.status,
    context,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
  if (p.error) clean.error = p.error;
  if (skill) clean.skill = skill;
  if (p.messages) clean.messages = JSON.parse(p.messages);
  return clean;
}

// GET all prompts for a project (includes pipeline children)
router.get('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projectId = req.params.projectId as string;

  const prompts = db.prepare(
    'SELECT * FROM prompts WHERE project_id = ? ORDER BY created_at'
  ).all(projectId) as any[];

  // Lookup helpers
  const getContext = db.prepare(
    'SELECT ref_type, ref_id FROM prompt_context WHERE prompt_id = ?'
  );
  const getFile = db.prepare('SELECT name FROM files WHERE id = ?');
  const getSkill = db.prepare('SELECT name FROM skills WHERE id = ?');
  const getPromptRef = db.prepare('SELECT type, prompt, response, status FROM prompts WHERE id = ?');

  const result = prompts.map(p => {
    // Resolve context refs
    const rawContext = getContext.all(p.id) as { ref_type: string; ref_id: string }[];
    const context = rawContext.map(ref => {
      if (ref.ref_type === 'file') {
        const file = getFile.get(ref.ref_id) as { name: string } | undefined;
        return { type: 'file', name: file?.name || 'unknown' };
      }
      const rp = getPromptRef.get(ref.ref_id) as any;
      if (rp) {
        const entry: any = { type: 'prompt', id: ref.ref_id, prompt_type: rp.type, status: rp.status };
        if (rp.prompt) entry.prompt = rp.prompt;
        if (rp.response) entry.response = rp.response;
        return entry;
      }
      return { type: 'prompt', id: ref.ref_id };
    });

    // Resolve skill
    const skill = p.skill_id ? (getSkill.get(p.skill_id) as { name: string } | undefined)?.name || null : null;

    // Clean object — no FK fields
    const clean: any = {
      id: p.id,
      pipeline_id: p.pipeline_id || null,
      type: p.type,
      prompt: p.prompt,
      response: p.response,
      status: p.status,
      context,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
    if (p.error) clean.error = p.error;
    if (skill) clean.skill = skill;
    return clean;
  });

  res.json(result);
});

// CREATE a new prompt (with optional file refs)
router.post('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projectId = req.params.projectId as string;

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const prompt = (req.body.prompt || '').trim();
  const fileIds: string[] = req.body.file_ids || [];

  if (!prompt) {
    res.status(400).json({ error: 'Prompt text is required' });
    return;
  }

  const promptId = uuidv4();
  db.prepare(
    "INSERT INTO prompts (id, project_id, type, prompt, status) VALUES (?, ?, 'llm', ?, 'pending')"
  ).run(promptId, projectId, prompt);

  // Add file context refs
  const insertCtx = db.prepare('INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, ?, ?)');
  for (const fileId of fileIds) {
    insertCtx.run(promptId, 'file', fileId);
  }

  // Add previous prompt as context (latest completed top-level prompt in this project)
  const prevPrompt = db.prepare(
    "SELECT id FROM prompts WHERE project_id = ? AND pipeline_id IS NULL AND status = 'completed' AND id != ? ORDER BY created_at DESC LIMIT 1"
  ).get(projectId, promptId) as { id: string } | undefined;
  if (prevPrompt) {
    insertCtx.run(promptId, 'prompt', prevPrompt.id);
  }

  const created = cleanPrompt(db, promptId);
  res.status(201).json(created);
});

// STOP a prompt
router.post('/:promptId/stop', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const promptId = req.params.promptId as string;

  const prompt = db.prepare('SELECT status FROM prompts WHERE id = ?').get(promptId) as any;
  if (prompt && (prompt.status === 'pending' || prompt.status === 'processing')) {
    db.prepare("UPDATE prompts SET status = 'cancel_requested', updated_at = datetime('now') WHERE id = ?").run(promptId);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'No active processing found' });
  }
});

// RETRY a prompt (creates a new one with same content/refs)
router.post('/:promptId/retry', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projectId = req.params.projectId as string;
  const promptId = req.params.promptId as string;

  const original = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as any;
  if (!original) { res.status(404).json({ error: 'Prompt not found' }); return; }

  // Allow overriding the prompt text (edit) or use original (retry)
  const newPromptText = req.body.prompt !== undefined ? (req.body.prompt || '').trim() : original.prompt;
  const additionalFileIds: string[] = req.body.file_ids || [];

  const newId = uuidv4();
  db.prepare(
    "INSERT INTO prompts (id, project_id, type, prompt, status) VALUES (?, ?, 'llm', ?, 'pending')"
  ).run(newId, projectId, newPromptText);

  // Copy context refs from original
  const refs = db.prepare('SELECT ref_type, ref_id FROM prompt_context WHERE prompt_id = ?').all(promptId) as { ref_type: string; ref_id: string }[];
  const insertCtx = db.prepare('INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, ?, ?)');
  for (const ref of refs) {
    insertCtx.run(newId, ref.ref_type, ref.ref_id);
  }

  // Add any new file refs
  const existingFileIds = new Set(refs.filter(r => r.ref_type === 'file').map(r => r.ref_id));
  for (const fileId of additionalFileIds) {
    if (!existingFileIds.has(fileId)) {
      insertCtx.run(newId, 'file', fileId);
    }
  }

  const created = cleanPrompt(db, newId);
  res.status(201).json(created);
});

export { router as promptsRouter };
