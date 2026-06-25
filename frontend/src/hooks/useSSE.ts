import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';

interface SSEEvent {
  type: string;
  [key: string]: any;
}

export function useSSE(projectId: string | undefined) {
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!projectId) return;

    const es = new EventSource(api.getSSEUrl(projectId));
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEvent(data);
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3s
      setTimeout(() => connect(), 3000);
    };
  }, [projectId]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { lastEvent };
}
