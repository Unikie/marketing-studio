import 'dotenv/config';
import { initDb } from './db';
import { setBroadcast, setDataDir, processPrompt, cancelPrompt } from './services/processor';

const DATA_DIR = process.env.DATA_DIR || './data';
const WEB_PORT = process.env.PORT || '3001';
const WEB_BASE = `http://localhost:${WEB_PORT}`;
const POLL_INTERVAL_MS = 2000;

const db = initDb(DATA_DIR);
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

async function poll() {
  const pending = db.prepare(
    "SELECT id, project_id FROM prompts WHERE status = 'pending' AND pipeline_id IS NULL ORDER BY created_at ASC LIMIT 1"
  ).get() as { id: string; project_id: string } | undefined;

  if (pending) {
    console.log(`[worker] Processing prompt ${pending.id}`);
    await processPrompt(db, pending.project_id, pending.id);
  }

  // Handle cancel requests
  const cancelRequests = db.prepare(
    "SELECT id, project_id FROM prompts WHERE status = 'cancel_requested' AND pipeline_id IS NULL"
  ).all() as { id: string; project_id: string }[];

  for (const req of cancelRequests) {
    const cancelled = cancelPrompt(req.id);
    if (!cancelled) {
      db.prepare("UPDATE prompts SET status = 'stopped', updated_at = datetime('now') WHERE id = ?").run(req.id);
      broadcastToWeb(req.project_id, { type: 'prompt-status', promptId: req.id, status: 'stopped' });
    }
  }
}

async function loop() {
  while (true) {
    try {
      await poll();
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

console.log('[worker] Started, polling every', POLL_INTERVAL_MS, 'ms');
loop();
