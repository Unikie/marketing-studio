import { Router } from 'express';
import type { Knex } from 'knex';

export const instructionsRouter = Router();

// GET /api/instructions — get the current (default) system instruction
instructionsRouter.get('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const row = await db('system_instructions').select('id', 'text', 'created_at').where('id', 'default').first();
  if (!row) return res.status(404).json({ error: 'No system instruction found' });
  res.json(row);
});

// PUT /api/instructions — update the default system instruction text
instructionsRouter.put('/', async (req, res) => {
  const db = req.app.locals.db as Knex;
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  await db('system_instructions').where('id', 'default').update({ text: text.trim() });
  const row = await db('system_instructions').select('id', 'text', 'created_at').where('id', 'default').first();
  res.json(row);
});
