import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const router = Router();

// LIST all skills
router.get('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const skills = await db('skills').orderBy('created_at');
  res.json(skills);
});

// CREATE skill
router.post('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const id = uuidv4();
  const { name, description, system_prompt, tool_name } = req.body;

  if (!name || !system_prompt) {
    res.status(400).json({ error: 'name and system_prompt are required' });
    return;
  }

  await db('skills').insert({ id, name, description: description || '', system_prompt, tool_name: tool_name || null });
  const skill = await db('skills').where('id', id).first();
  res.status(201).json(skill);
});

// UPDATE skill
router.put('/:id', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const { name, description, system_prompt, tool_name } = req.body;
  const existing = await db('skills').where('id', req.params.id).first();
  if (!existing) { res.status(404).json({ error: 'Skill not found' }); return; }

  await db('skills').where('id', req.params.id).update({
    name: name ?? existing.name,
    description: description ?? existing.description,
    system_prompt: system_prompt ?? existing.system_prompt,
    tool_name: tool_name !== undefined ? (tool_name || null) : existing.tool_name,
  });

  const skill = await db('skills').where('id', req.params.id).first();
  res.json(skill);
});

// DELETE skill
router.delete('/:id', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  await db('skills').where('id', req.params.id).del();
  res.status(204).end();
});

export { router as skillsRouter };
