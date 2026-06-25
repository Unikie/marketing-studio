import { Router, Request, Response } from 'express';
import { addSSEClient, removeSSEClient, broadcast } from '../services/sse';

const router = Router();

// SSE endpoint: GET /api/events/:projectId
router.get('/:projectId', (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`);

  addSSEClient(projectId, res);

  req.on('close', () => {
    removeSSEClient(projectId, res);
  });
});

// Internal endpoint: worker POSTs events here to broadcast to SSE clients
router.post('/broadcast', (req: Request, res: Response) => {
  const { projectId, event } = req.body;
  if (projectId && event) {
    broadcast(projectId, event);
  }
  res.status(204).end();
});

export { router as eventsRouter };
