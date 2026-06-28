import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

export const personalityRouter = Router();

// GET /api/personality — get the current (latest) personality
personalityRouter.get('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const row = await db('personality').select('id', 'text', 'created_at').orderBy('created_at', 'desc').first();
  if (!row) return res.status(404).json({ error: 'No personality found' });
  res.json(row);
});

// PUT /api/personality — create a new version of the personality
personalityRouter.put('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  const id = uuidv4();
  await db('personality').insert({ id, text: text.trim() });
  const row = await db('personality').select('id', 'text', 'created_at').where('id', id).first();
  res.json(row);
});

// GET /api/personality/versions — list all versions ordered by date
personalityRouter.get('/versions', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const rows = await db('personality').select('id', 'text', 'created_at').orderBy('created_at', 'asc');
  res.json(rows);
});

// GET /api/personality/versions/:id/projects — projects that used this version
personalityRouter.get('/versions/:id/projects', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const projects = await db('prompts')
    .join('projects', 'prompts.project_id', 'projects.id')
    .where('prompts.personality_id', req.params.id)
    .select('projects.id', 'projects.name')
    .groupBy('projects.id')
    .orderBy('projects.created_at', 'desc');
  res.json(projects);
});
