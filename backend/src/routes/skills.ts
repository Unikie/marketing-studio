import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

const router = Router();

// LIST all skills
router.get('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const skills = db.prepare('SELECT * FROM skills ORDER BY created_at').all();
  res.json(skills);
});

// CREATE skill (immutable — creates a new entry)
router.post('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const id = uuidv4();
  const { name, description, system_prompt, tool_name } = req.body;

  if (!name || !system_prompt) {
    res.status(400).json({ error: 'name and system_prompt are required' });
    return;
  }

  db.prepare(
    'INSERT INTO skills (id, name, description, system_prompt, tool_name) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, description || '', system_prompt, tool_name || null);

  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
  res.status(201).json(skill);
});

// UPDATE skill
router.put('/:id', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const { name, description, system_prompt, tool_name } = req.body;
  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id as string);
  if (!existing) { res.status(404).json({ error: 'Skill not found' }); return; }

  db.prepare(
    'UPDATE skills SET name = ?, description = ?, system_prompt = ?, tool_name = ? WHERE id = ?'
  ).run(
    name ?? (existing as any).name,
    description ?? (existing as any).description,
    system_prompt ?? (existing as any).system_prompt,
    tool_name !== undefined ? (tool_name || null) : (existing as any).tool_name,
    req.params.id as string
  );

  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id as string);
  res.json(skill);
});

// DELETE skill
router.delete('/:id', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  db.prepare('DELETE FROM skills WHERE id = ?').run(req.params.id as string);
  res.status(204).end();
});

export { router as skillsRouter };
