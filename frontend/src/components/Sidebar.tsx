import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { api, Project } from '../api';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
const STORAGE_KEY = 'sidebar-width';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.min(Math.max(Number(saved), SIDEBAR_MIN), SIDEBAR_MAX) : SIDEBAR_DEFAULT;
  });
  const dragging = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Extract active project ID from URL
  const match = location.pathname.match(/\/projects\/([^/]+)/);
  const activeId = match ? match[1] : null;

  useEffect(() => { loadProjects(); }, [location.pathname]);

  useEffect(() => {
    const handler = () => loadProjects();
    window.addEventListener('project-updated', handler);
    return () => window.removeEventListener('project-updated', handler);
  }, []);

  async function loadProjects() {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }

  function handleNewProject() {
    navigate('/');
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeId === id) navigate('/');
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(Math.max(ev.clientX, SIDEBAR_MIN), SIDEBAR_MAX);
      setWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setWidth(w => { localStorage.setItem(STORAGE_KEY, String(w)); return w; });
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={collapsed ? undefined : { width }}>
      <div className="sidebar-top">
        {collapsed ? (
          <>
            <button className="sidebar-toggle" onClick={onToggle} title="Expand sidebar">»</button>
            <button className="sidebar-toggle" onClick={handleNewProject} title="New">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
              </svg>
            </button>
          </>
        ) : (
          <>
            <div className="sidebar-top-row">
              <Link to="/settings" className="sidebar-header-settings" title="Settings">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 018.4 12 3.61 3.61 0 0112 8.4a3.61 3.61 0 013.6 3.6 3.61 3.61 0 01-3.6 3.6z"/>
                </svg>
              </Link>
              <button className="sidebar-toggle" onClick={onToggle} title="Collapse">«</button>
            </div>
            <span className="sidebar-new-link" onClick={handleNewProject} title="New">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
              </svg>
              New
            </span>
          </>
        )}
      </div>
      {!collapsed && (
        <nav className="sidebar-list">
          {projects.map(p => (
            <div
              key={p.id}
              className={`sidebar-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <span className="sidebar-item-name">{p.name}</span>
              <button className="sidebar-item-delete" onClick={e => handleDelete(p.id, e)} title="Delete">×</button>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="sidebar-empty">No projects yet</div>
          )}
        </nav>
      )}
      {!collapsed && <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />}
    </aside>
  );
}
