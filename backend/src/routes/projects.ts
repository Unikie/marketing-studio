import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

const router = Router();

// CREATE project
router.post('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const id = uuidv4();
  const name = req.body.name || 'Untitled Project';
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

// LIST projects
router.get('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 50').all();
  res.json(projects);
});

// GET single project with files
router.get('/:id', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const files = db.prepare('SELECT id, filename, name, analysis, created_at FROM files WHERE project_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ ...project as object, files });
});

// DELETE project
router.delete('/:id', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const dataDir = req.app.locals.dataDir as string;

  const files = db.prepare('SELECT filename FROM files WHERE project_id = ?').all(req.params.id) as { filename: string }[];
  for (const file of files) {
    const filePath = path.join(dataDir, 'uploads', file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM prompt_context WHERE prompt_id IN (SELECT id FROM prompts WHERE project_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM prompts WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM files WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export { router as projectsRouter };
