import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { buildDebugTree } from '../services/debugTree';
import { getContentTree } from '../services/content';

const router = Router({ mergeParams: true });

// Helper: return the prompt node from the shared content tree.
async function cleanPrompt(db: Knex, projectId: string, promptId: string): Promise<object> {
  const tree = await getContentTree(db, { projectId, promptId });
  return tree[tree.length - 1] || {};
}

// GET all prompts for a project
router.get('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;

  const tree = await getContentTree(db, { projectId });
  res.json(tree);
});

// GET backend-built debug tree for a project
router.get('/debug-tree', async (req: Request, res: Response) => {
  try {
    const db = req.app.locals.db as Knex;
    const projectId = req.params.projectId as string;

    const project = await db('projects').where('id', projectId).first();
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const tree = await buildDebugTree(db, projectId);
    res.json(tree);
  } catch (err) {
    console.error('Failed to build debug tree:', err);
    res.status(500).json({ error: 'Failed to build debug tree' });
  }
});

// GET backend-built content tree for history display
router.get('/tree', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;
  const promptId = typeof req.query.prompt_id === 'string' && req.query.prompt_id.trim()
    ? req.query.prompt_id.trim()
    : undefined;

  const project = await db('projects').where('id', projectId).first();
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const tree = await getContentTree(db, { projectId, promptId });
  res.json(tree);
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

  const created = await cleanPrompt(db, projectId, promptId);
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

  const created = await cleanPrompt(db, projectId, newId);
  res.status(201).json(created);
});

export { router as promptsRouter };
