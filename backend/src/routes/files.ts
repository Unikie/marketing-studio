import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const router = Router({ mergeParams: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dataDir = req.app.locals.dataDir as string;
    const uploadDir = path.join(dataDir, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/msword',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// LIST files for a project
router.get('/', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;
  const files = await db('files')
    .select('id', 'filename', 'name', 'analysis', 'created_at')
    .where('project_id', projectId)
    .orderBy('created_at');
  res.json(files);
});

// UPLOAD files
router.post('/', upload.array('files', 10), async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const projectId = req.params.projectId as string;

  const project = await db('projects').where('id', projectId).first();
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { res.status(400).json({ error: 'No files uploaded' }); return; }

  const results = [];
  for (const file of files) {
    const fileId = uuidv4();
    await db('files').insert({ id: fileId, project_id: projectId, filename: file.filename, name: file.originalname });
    results.push({ id: fileId, filename: file.filename, name: file.originalname });
  }

  res.status(201).json(results);
});

// DELETE a file
router.delete('/:fileId', async (req: Request, res: Response) => {
  const db = req.app.locals.db as Knex;
  const dataDir = req.app.locals.dataDir as string;
  const fileId = req.params.fileId as string;

  const file = await db('files').select('filename').where('id', fileId).first();
  if (!file) { res.status(404).json({ error: 'File not found' }); return; }

  const filePath = path.join(dataDir, 'uploads', file.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await db('files').where('id', fileId).del();
  res.status(204).end();
});

export { router as filesRouter };
