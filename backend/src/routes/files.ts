import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

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
router.get('/', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projectId = req.params.projectId as string;
  const files = db.prepare('SELECT id, filename, name, analysis, created_at FROM files WHERE project_id = ? ORDER BY created_at').all(projectId);
  res.json(files);
});

// UPLOAD files
router.post('/', upload.array('files', 10), (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const projectId = req.params.projectId as string;

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { res.status(400).json({ error: 'No files uploaded' }); return; }

  const insertFile = db.prepare('INSERT INTO files (id, project_id, filename, name) VALUES (?, ?, ?, ?)');
  const results = [];
  for (const file of files) {
    const fileId = uuidv4();
    insertFile.run(fileId, projectId, file.filename, file.originalname);
    results.push({ id: fileId, filename: file.filename, name: file.originalname });
  }

  res.status(201).json(results);
});

// DELETE a file
router.delete('/:fileId', (req: Request, res: Response) => {
  const db = req.app.locals.db as Database.Database;
  const dataDir = req.app.locals.dataDir as string;
  const fileId = req.params.fileId as string;

  const file = db.prepare('SELECT filename FROM files WHERE id = ?').get(fileId) as { filename: string } | undefined;
  if (!file) { res.status(404).json({ error: 'File not found' }); return; }

  const filePath = path.join(dataDir, 'uploads', file.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  res.status(204).end();
});

export { router as filesRouter };
