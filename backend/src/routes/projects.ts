import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const router = Router();

// CREATE project
router.post('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const id = uuidv4();
  const name = req.body.name || 'Untitled Project';
  await db('projects').insert({ id, name });
  const project = await db('projects').where('id', id).first();
  res.status(201).json(project);
});

// LIST projects
router.get('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projects = await db('projects').orderBy('created_at', 'desc').limit(50);
  res.json(projects);
});

// GET single project with files
router.get('/:id', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const project = await db('projects').where('id', req.params.id).first();
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const files = await db('files')
    .select('id', 'filename', 'name', 'analysis', 'created_at')
    .where('project_id', req.params.id)
    .orderBy('created_at');
  res.json({ ...project, files });
});

// DELETE project
router.delete('/:id', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const dataDir = req.app.locals.dataDir as string;

  const files = await db('files').select('filename').where('project_id', req.params.id);
  for (const file of files) {
    const filePath = path.join(dataDir, 'uploads', file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await db('prompt_context')
    .whereIn('prompt_id', db('prompts').select('id').where('project_id', req.params.id))
    .del();
  await db('prompts').where('project_id', req.params.id).del();
  await db('files').where('project_id', req.params.id).del();
  await db('projects').where('id', req.params.id).del();
  res.status(204).end();
});

export { router as projectsRouter };
