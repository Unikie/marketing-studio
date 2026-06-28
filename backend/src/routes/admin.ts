import { Router } from 'express';
import { resetDb } from '../db';

export const adminRouter = Router();

const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';
const RESET_CONFIRMATION = 'NUKE DATABASE';

adminRouter.post('/reset-database', async (req, res) => {
  if (req.body?.confirmation !== RESET_CONFIRMATION) {
    return res.status(400).json({ error: `confirmation must be "${RESET_CONFIRMATION}"` });
  }

  try {
    await resetDb();

    const pyworkerResponse = await fetch(`${PYWORKER_URL}/admin/reseed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Caller': 'system' },
      body: JSON.stringify({ confirmation: RESET_CONFIRMATION }),
    });

    if (!pyworkerResponse.ok) {
      const text = await pyworkerResponse.text();
      return res.status(502).json({ error: `Database reset, but pyworker reseed failed: ${text}` });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Database reset failed' });
  }
});