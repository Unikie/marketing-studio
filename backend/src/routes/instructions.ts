import { Router } from 'express';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';

export const instructionsRouter = Router();

// GET /api/instructions — get the current (default) system instruction
instructionsRouter.get('/', (req, res) => {
  const db = req.app.locals.db as Database.Database;
  const row = db.prepare('SELECT id, text, created_at FROM system_instructions WHERE id = ?').get('default');
  if (!row) return res.status(404).json({ error: 'No system instruction found' });
  res.json(row);
});

// PUT /api/instructions — update the default system instruction text
instructionsRouter.put('/', (req, res) => {
  const db = req.app.locals.db as Database.Database;
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  db.prepare('UPDATE system_instructions SET text = ? WHERE id = ?').run(text.trim(), 'default');
  const row = db.prepare('SELECT id, text, created_at FROM system_instructions WHERE id = ?').get('default');
  res.json(row);
});
