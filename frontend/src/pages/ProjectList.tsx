import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Project } from '../api';
import { formatDateTime } from '../date';

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim() || 'Untitled Project';
    const project = await api.createProject(name);
    setNewName('');
    navigate(`/projects/${project.id}`);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    setProjects(projects.filter(p => p.id !== id));
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="card">
        <h2>Create New Project</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            placeholder="Project name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <button className="primary" onClick={handleCreate}>Create</button>
        </div>
      </div>

      <div className="card">
        <h2>Recent Projects</h2>
        {projects.length === 0 ? (
          <p style={{ color: '#888' }}>No projects yet. Create one above.</p>
        ) : (
          projects.map(p => (
            <div
              key={p.id}
              className="project-list-item"
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div>
                <strong>{p.name}</strong>
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.2rem' }}>
                  Created: {formatDateTime(p.created_at)}
                </div>
              </div>
              <button className="danger" onClick={e => handleDelete(p.id, e)}>Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
