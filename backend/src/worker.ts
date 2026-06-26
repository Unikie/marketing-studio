import 'dotenv/config';
import { initDb } from './db';
import { setBroadcast, setDataDir, processPrompt, cancelPrompt } from './services/processor';
import type { Knex } from 'knex';

const DATA_DIR = process.env.DATA_DIR || './data';
const WEB_PORT = process.env.PORT || '3001';
const WEB_BASE = `http://localhost:${WEB_PORT}`;
const POLL_INTERVAL_MS = 2000;

setDataDir(DATA_DIR);

function broadcastToWeb(projectId: string, event: object) {
  fetch(`${WEB_BASE}/api/events/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, event }),
  }).catch(err => {
    console.error('[worker] Failed to broadcast event:', err.message);
  });
}

setBroadcast(broadcastToWeb);

async function poll(db: Knex) {
  const pending = await db('prompts')
    .select('id', 'project_id')
    .where('status', 'pending')
    .whereNull('pipeline_id')
    .orderBy('created_at', 'asc')
    .first();

  if (pending) {
    console.log(`[worker] Processing prompt ${pending.id}`);
    await processPrompt(db, pending.project_id, pending.id);
  }

  // Handle cancel requests
  const cancelRequests = await db('prompts')
    .select('id', 'project_id')
    .where('status', 'cancel_requested')
    .whereNull('pipeline_id');

  for (const req of cancelRequests) {
    const cancelled = cancelPrompt(req.id);
    if (!cancelled) {
      await db('prompts').where('id', req.id).update({ status: 'stopped', updated_at: db.fn.now() });
      broadcastToWeb(req.project_id, { type: 'prompt-status', promptId: req.id, status: 'stopped' });
    }
  }
}

async function main() {
  const db = await initDb();

  console.log('[worker] Started, polling every', POLL_INTERVAL_MS, 'ms');
  while (true) {
    try {
      await poll(db);
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
