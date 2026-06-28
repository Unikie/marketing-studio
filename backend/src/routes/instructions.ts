import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export const instructionsRouter = Router();

// GET /api/instructions — get the current (latest) system instruction
instructionsRouter.get('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const row = await db('system_instructions').select('id', 'text', 'created_at').orderBy('created_at', 'desc').first();
  if (!row) return res.status(404).json({ error: 'No system instruction found' });
  res.json(row);
});

// PUT /api/instructions — create a new version of the system instruction
instructionsRouter.put('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  const id = uuidv4();
  await db('system_instructions').insert({ id, text: text.trim() });
  const row = await db('system_instructions').select('id', 'text', 'created_at').where('id', id).first();
  res.json(row);
});

// GET /api/instructions/versions — list all versions ordered by date
instructionsRouter.get('/versions', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const rows = await db('system_instructions').select('id', 'text', 'created_at').orderBy('created_at', 'asc');
  res.json(rows);
});

// GET /api/instructions/versions/:id/projects — projects that used this version
instructionsRouter.get('/versions/:id/projects', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const projects = await db('prompts')
    .join('projects', 'prompts.project_id', 'projects.id')
    .where('prompts.system_instruction_id', req.params.id)
    .select('projects.id', 'projects.name')
    .groupBy('projects.id')
    .orderBy('projects.created_at', 'desc');
  res.json(projects);
});
