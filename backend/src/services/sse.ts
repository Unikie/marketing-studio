import { Response } from 'express';

// SSE client registry — lives in the web process only
const sseClients = new Map<string, Set<Response>>();

export function addSSEClient(projectId: string, res: Response) {
  if (!sseClients.has(projectId)) {
    sseClients.set(projectId, new Set());
  }
  sseClients.get(projectId)!.add(res);
}

export function removeSSEClient(projectId: string, res: Response) {
  const clients = sseClients.get(projectId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(projectId);
  }
}

export function broadcast(projectId: string, event: object) {
  const clients = sseClients.get(projectId);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}
