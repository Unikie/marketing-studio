import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb } from './db';
import { projectsRouter } from './routes/projects';
import { filesRouter } from './routes/files';
import { promptsRouter } from './routes/prompts';
import { eventsRouter } from './routes/events';
import { skillsRouter } from './routes/skills';
import { personalityRouter } from './routes/personality';
import { toolsRouter } from './routes/tools';
import { draftsRouter } from './routes/drafts';
import { adminRouter } from './routes/admin';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';
const STARTED_AT = Date.now();

fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const app = express();

app.use(cors());
app.use(express.json());

app.locals.dataDir = DATA_DIR;

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:projectId/files', filesRouter);
app.use('/api/projects/:projectId/prompts', promptsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/personality', personalityRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/drafts', draftsRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', async (req, res) => {
  const service = getServiceFlag(req.query);
  if (!service.ok) { res.status(400).json({ error: service.error }); return; }

  if (service.value === 'pyworker') {
    await proxyService(res, '/health', { status: 'error', uptime: 0 });
    return;
  }

  res.json({ status: 'ok', uptime: uptimeSeconds() });
});

app.get('/api/version', async (req, res) => {
  const service = getServiceFlag(req.query);
  if (!service.ok) { res.status(400).json({ error: service.error }); return; }

  if (service.value === 'pyworker') {
    await proxyService(res, '/version', { sha: 'unknown', time: 'unknown' });
    return;
  }

  res.json(buildVersion());
});

(async () => {
  const db = await initDb();
  app.locals.db = db;
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
})();

function uptimeSeconds(): number {
  return Math.floor((Date.now() - STARTED_AT) / 1000);
}

function buildVersion(): { sha: string; time: string } {
  return {
    sha: shortSha(process.env.BUILD_SHA || 'unknown'),
    time: process.env.BUILD_TIME || 'unknown',
  };
}

function shortSha(value: string): string {
  return value === 'unknown' ? value : value.slice(0, 7);
}

function getServiceFlag(query: Record<string, unknown>): { ok: true; value: 'backend' | 'pyworker' } | { ok: false; error: string } {
  const keys = Object.keys(query);
  if (keys.length === 0) return { ok: true, value: 'backend' };
  const allowed = keys.filter(key => key === 'backend' || key === 'pyworker');
  if (allowed.length !== keys.length) return { ok: false, error: 'Unknown service' };
  if (allowed.length > 1) return { ok: false, error: 'Choose one service' };
  return { ok: true, value: allowed[0] as 'backend' | 'pyworker' };
}

async function proxyService(res: express.Response, pathName: string, fallback: object): Promise<void> {
  try {
    const response = await fetch(`${PYWORKER_URL}${pathName}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch {
    res.status(502).json(fallback);
  }
}
