import { Router, Request, Response } from 'express';
import type { Knex } from 'knex';

const router = Router();

// GET draft by key
router.get('/:key', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const draft = await db('drafts').where('key', req.params.key).first();
  res.json({ text: draft?.text || '' });
});

// PUT (upsert) draft
router.put('/:key', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const { text } = req.body;
  if (typeof text !== 'string') { res.status(400).json({ error: 'text is required' }); return; }

  const existing = await db('drafts').where('key', req.params.key).first();
  if (existing) {
    await db('drafts').where('key', req.params.key).update({ text, updated_at: db.fn.now() });
  } else {
    await db('drafts').insert({ key: req.params.key, text });
  }
  res.json({ ok: true });
});

export { router as draftsRouter };
