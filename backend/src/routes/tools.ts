import { Router, Request, Response } from 'express';

const router = Router();

const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';

// LIST all tools
router.get('/', async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${PYWORKER_URL}/tools`, { headers: { 'X-Caller': 'system' } });
    const data = await r.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyworker unreachable: ${err.message}` });
  }
});

// GET single tool
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${PYWORKER_URL}/tools/${encodeURIComponent(req.params.name)}`, {
      headers: { 'X-Caller': 'system' },
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyworker unreachable: ${err.message}` });
  }
});

// CREATE tool
router.post('/', async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${PYWORKER_URL}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Caller': 'system' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyworker unreachable: ${err.message}` });
  }
});

// UPDATE tool
router.put('/:name', async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${PYWORKER_URL}/tools/${encodeURIComponent(req.params.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Caller': 'system' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyworker unreachable: ${err.message}` });
  }
});

// DELETE tool
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const r = await fetch(`${PYWORKER_URL}/tools/${encodeURIComponent(req.params.name)}`, {
      method: 'DELETE',
      headers: { 'X-Caller': 'system' },
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Pyworker unreachable: ${err.message}` });
  }
});

export { router as toolsRouter };
