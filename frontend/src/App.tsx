import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Project from './pages/Project';
import Settings from './pages/Settings';
import Sidebar from './components/Sidebar';
import Prompt from './components/Prompt';
import { api } from './api';

function NewPrompt() {
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);

  async function handleSend(text: string, files: File[]) {
    setSending(true);
    try {
      const project = await api.createProject(text.slice(0, 60) || 'Untitled Project');
      navigate(`/projects/${project.id}`, { replace: true, state: { prompt: text, files } });
    } catch (err) {
      console.error('Failed to create project:', err);
      setSending(false);
    }
  }

  return (
    <div className="new-prompt-page">
      <div className="new-prompt-center">
        <h2>What can I help with?</h2>
      </div>
      <div className="new-prompt-input-wrap">
        <Prompt onSend={handleSend} sending={sending} autoFocus className="new-prompt-input" draftKey="default" />
      </div>
    </div>
  );
}

function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const isProjectPage = /^\/projects\//.test(location.pathname);

  return (
    <div className="app-layout">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="app-main">
        {!isProjectPage && (
          <header className="app-header">
            <h1><a href="/">Marketing Paradice</a></h1>
          </header>
        )}
        <main>
          <Routes>
            <Route path="/" element={<NewPrompt />} />
            <Route path="/projects/:id" element={<Project />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;
