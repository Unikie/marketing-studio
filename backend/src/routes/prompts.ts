import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const router = Router({ mergeParams: true });

// Helper: build clean prompt response object
async function cleanPrompt(db: Knex, promptId: string): Promise<object> {
  const p = await db('prompts').where('id', promptId).first();
  if (!p) return {};

  const rawContext = await db('prompt_context').select('ref_type', 'ref_id').where('prompt_id', promptId);
  const context = [];
  for (const ref of rawContext) {
    if (ref.ref_type === 'file') {
      const file = await db('files').select('name').where('id', ref.ref_id).first();
      context.push({ type: 'file', name: file?.name || 'unknown' });
    } else {
      const rp = await db('prompts').select('type', 'prompt', 'response', 'status').where('id', ref.ref_id).first();
      if (rp) {
        const entry: any = { type: 'prompt', id: ref.ref_id, prompt_type: rp.type, status: rp.status };
        if (rp.prompt) entry.prompt = rp.prompt;
        if (rp.response) entry.response = rp.response;
        context.push(entry);
      } else {
        context.push({ type: 'prompt', id: ref.ref_id });
      }
    }
  }

  const skill = p.skill_id ? (await db('skills').select('name').where('id', p.skill_id).first())?.name || null : null;

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

// GET all prompts for a project
router.get('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;

  const prompts = await db('prompts').where('project_id', projectId).orderBy('created_at');

  const result = [];
  for (const p of prompts) {
    const rawContext = await db('prompt_context').select('ref_type', 'ref_id').where('prompt_id', p.id);
    const context = [];
    for (const ref of rawContext) {
      if (ref.ref_type === 'file') {
        const file = await db('files').select('name').where('id', ref.ref_id).first();
        context.push({ type: 'file', name: file?.name || 'unknown' });
      } else {
        const rp = await db('prompts').select('type', 'prompt', 'response', 'status').where('id', ref.ref_id).first();
        if (rp) {
          const entry: any = { type: 'prompt', id: ref.ref_id, prompt_type: rp.type, status: rp.status };
          if (rp.prompt) entry.prompt = rp.prompt;
          if (rp.response) entry.response = rp.response;
          context.push(entry);
        } else {
          context.push({ type: 'prompt', id: ref.ref_id });
        }
      }
    }

    const skill = p.skill_id ? (await db('skills').select('name').where('id', p.skill_id).first())?.name || null : null;

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
    result.push(clean);
  }

  res.json(result);
});

// CREATE a new prompt
router.post('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;

  const project = await db('projects').where('id', projectId).first();
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const prompt = (req.body.prompt || '').trim();
  const fileIds: string[] = req.body.file_ids || [];
  const parentPromptId = typeof req.body.parent_prompt_id === 'string' && req.body.parent_prompt_id.trim()
    ? req.body.parent_prompt_id.trim()
    : null;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt text is required' });
    return;
  }

  let parentPrompt: { id: string } | null = null;

  if (parentPromptId) {
    parentPrompt = await db('prompts')
      .select('id')
      .where('id', parentPromptId)
      .where('project_id', projectId)
      .whereNull('pipeline_id')
      .first();
    if (!parentPrompt) {
      res.status(400).json({ error: 'parent_prompt_id must reference a top-level prompt in this project' });
      return;
    }
  }

  const promptId = uuidv4();
  await db('prompts').insert({ id: promptId, project_id: projectId, type: 'llm', prompt, status: 'pending' });

  for (const fileId of fileIds) {
    await db('prompt_context').insert({ prompt_id: promptId, ref_type: 'file', ref_id: fileId });
  }

  if (parentPrompt) {
    await db('prompt_context').insert({ prompt_id: promptId, ref_type: 'prompt', ref_id: parentPrompt.id });
  }

  // Clear draft for this project
  await db('drafts').where('key', projectId).del();

  const created = await cleanPrompt(db, promptId);
  res.status(201).json(created);
});

// STOP a prompt
router.post('/:promptId/stop', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const promptId = req.params.promptId as string;

  const prompt = await db('prompts').select('status').where('id', promptId).first();
  if (prompt && (prompt.status === 'pending' || prompt.status === 'processing')) {
    await db('prompts').where('id', promptId).update({ status: 'cancel_requested', updated_at: db.fn.now() });
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'No active processing found' });
  }
});

// RETRY a prompt
router.post('/:promptId/retry', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;
  const promptId = req.params.promptId as string;

  const original = await db('prompts').where('id', promptId).first();
  if (!original) { res.status(404).json({ error: 'Prompt not found' }); return; }

  const newPromptText = req.body.prompt !== undefined ? (req.body.prompt || '').trim() : original.prompt;
  const additionalFileIds: string[] = req.body.file_ids || [];

  const newId = uuidv4();
  await db('prompts').insert({ id: newId, project_id: projectId, type: 'llm', prompt: newPromptText, status: 'pending' });

  const refs = await db('prompt_context').select('ref_type', 'ref_id').where('prompt_id', promptId);
  for (const ref of refs) {
    await db('prompt_context').insert({ prompt_id: newId, ref_type: ref.ref_type, ref_id: ref.ref_id });
  }

  const existingFileIds = new Set(refs.filter(r => r.ref_type === 'file').map(r => r.ref_id));
  for (const fileId of additionalFileIds) {
    if (!existingFileIds.has(fileId)) {
      await db('prompt_context').insert({ prompt_id: newId, ref_type: 'file', ref_id: fileId });
    }
  }

  const created = await cleanPrompt(db, newId);
  res.status(201).json(created);
});

export { router as promptsRouter };
