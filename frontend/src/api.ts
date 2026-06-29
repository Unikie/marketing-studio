const BASE_URL = import.meta.env.VITE_API_URL || await (async () => {
  try {
    const res = await fetch('/config.json');
    if (res.ok) {
      const data = await res.json();
      return data.apiUrl || '';
    }
  } catch {}
  return '';
})();

export interface Project {
  id: string;
  name: string;
  created_at: string;
  files?: ProjectFile[];
}

export interface ProjectFile {
  id: string;
  filename: string;
  name: string;
  analysis: string | null;
  created_at: string;
}

export interface Prompt {
  id: string;
  pipeline_id: string | null;
  type: string;
  prompt: string;
  response: string;
  messages?: unknown;
  skill?: string;
  skill_id?: string | null;
  status: string;
  error?: string;
  context?: { type: string; id: string; name?: string }[];
  files?: { id: string; name: string }[];
  steps?: Prompt[];
  branch?: Prompt[];
  latest_descendant_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tool_name: string | null;
  created_at: string;
}

export interface Personality {
  id: string;
  text: string;
  created_at: string;
}

export interface Tool {
  name: string;
  description: string;
  params_schema: string | null;
  owner: string;
  read_only: number;
  created_at: string;
  updated_at: string;
}

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listProjects: (): Promise<Project[]> => request('/api/projects'),

  createProject: (name: string): Promise<Project> =>
    request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  getProject: (id: string): Promise<Project> => request(`/api/projects/${id}`),

  renameProject: (id: string, name: string): Promise<Project> =>
    request(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),

  deleteProject: (id: string): Promise<void> =>
    request(`/api/projects/${id}`, { method: 'DELETE' }),

  uploadFiles: async (projectId: string, files: File[]): Promise<ProjectFile[]> => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch(`${BASE_URL}/api/projects/${projectId}/files`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },

  // Prompts API
  getPromptTree: (projectId: string, promptId?: string | null): Promise<Prompt[]> => {
    const query = promptId ? `?prompt_id=${encodeURIComponent(promptId)}` : '';
    return request(`/api/projects/${projectId}/prompts/tree${query}`);
  },

  getDebugTree: (projectId: string): Promise<unknown> => request(`/api/projects/${projectId}/prompts/debug-tree`),

  createPrompt: (projectId: string, prompt: string, fileIds: string[], parentPromptId?: string | null): Promise<Prompt> =>
    request(`/api/projects/${projectId}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, file_ids: fileIds, parent_prompt_id: parentPromptId || null }),
    }),

  stopPrompt: (projectId: string, promptId: string): Promise<{ ok: boolean }> =>
    request(`/api/projects/${projectId}/prompts/${promptId}/stop`, { method: 'POST' }),

  retryPrompt: (projectId: string, promptId: string, newPrompt?: string, fileIds?: string[]): Promise<Prompt> =>
    request(`/api/projects/${projectId}/prompts/${promptId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(newPrompt !== undefined ? { prompt: newPrompt } : {}),
        ...(fileIds?.length ? { file_ids: fileIds } : {}),
      }),
    }),

  // Skills API
  getSkills: (): Promise<Skill[]> => request('/api/skills'),

  createSkill: (name: string, description: string, system_prompt: string, tool_name?: string): Promise<Skill> =>
    request('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, system_prompt, tool_name: tool_name || null }),
    }),

  updateSkill: (id: string, data: { name?: string; description?: string; system_prompt?: string; tool_name?: string }): Promise<Skill> =>
    request(`/api/skills/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteSkill: (id: string): Promise<void> =>
    request(`/api/skills/${id}`, { method: 'DELETE' }),

  // Personality API
  getPersonality: (): Promise<Personality> => request('/api/personality'),

  updatePersonality: (text: string): Promise<Personality> =>
    request('/api/personality', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  getPersonalityVersions: (): Promise<Personality[]> => request('/api/personality/versions'),

  getPersonalityProjects: (id: string): Promise<{ id: string; name: string }[]> =>
    request(`/api/personality/versions/${encodeURIComponent(id)}/projects`),

  getSSEUrl: (projectId: string): string => `${BASE_URL}/api/events/${projectId}`,

  // Tools API (pyworker proxy)
  getTools: (): Promise<Tool[]> => request('/api/tools'),

  getTool: (name: string): Promise<Tool & { code: string }> => request(`/api/tools/${encodeURIComponent(name)}`),

  createTool: (name: string, code: string, description?: string, params_schema?: string): Promise<{ ok: boolean; name: string }> =>
    request('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code, description: description || '', params_schema: params_schema || null }),
    }),

  updateTool: (name: string, data: { code?: string; description?: string; params_schema?: string }): Promise<{ ok: boolean }> =>
    request(`/api/tools/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteTool: (name: string): Promise<{ ok: boolean }> =>
    request(`/api/tools/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Drafts API
  getDraft: (key: string): Promise<{ text: string }> => request(`/api/drafts/${encodeURIComponent(key)}`),

  saveDraft: (key: string, text: string): Promise<{ ok: boolean }> =>
    request(`/api/drafts/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
};
