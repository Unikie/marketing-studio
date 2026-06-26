import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDb, getDb } from './db';
import { projectsRouter } from './routes/projects';
import { filesRouter } from './routes/files';
import { promptsRouter } from './routes/prompts';
import { eventsRouter } from './routes/events';
import { skillsRouter } from './routes/skills';
import { instructionsRouter } from './routes/instructions';
import { toolsRouter } from './routes/tools';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DATA_DIR = process.env.DATA_DIR || './data';

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
app.use('/api/instructions', instructionsRouter);
app.use('/api/tools', toolsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

async function start() {
  const db = await initDb();
  app.locals.db = db;

  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
