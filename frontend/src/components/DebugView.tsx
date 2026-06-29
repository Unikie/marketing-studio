import { useEffect, useState } from 'react';
import { api } from '../api';
import JsonTree from './JsonTree';

interface DebugViewProps {
  projectId: string;
  refreshSignal?: unknown;
}

export default function DebugView({ projectId, refreshSignal }: DebugViewProps) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getDebugTree(projectId)
      .then(tree => {
        if (!cancelled) {
          setData(tree);
          setError(null);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load debug tree');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId, refreshSignal]);

  return (
    <div className="debug-view">
      {loading && <div>Loading debug tree...</div>}
      {error && <div>{error}</div>}
      {!loading && !error && <JsonTree data={data} defaultExpanded={0} />}
    </div>
  );
}
