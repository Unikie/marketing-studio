import type { Knex } from 'knex';
import { buildQuery as buildContentQuery, getContentTree, getPromptContext, type ContentContextEntry, type ContentPromptNode, type LlmMessage, type ToolQuery } from './content';

interface PromptRow {
  id: string;
  pipeline_id: string | null;
  type: string;
  prompt: string;
  response: string;
  messages: string | null;
  skill_id: string | null;
  error: string | null;
  created_at: string;
}

interface ContextRef {
  prompt_id: string;
  ref_type: string;
  ref_id: string;
}

interface SkillRow { id: string; name: string; }
interface FileRow { id: string; filename: string; name: string; sha256: string | null; }

type DebugQuery = LlmMessage[] | ToolQuery;

interface DebugError {
  path: string;
  code: string;
  message: string;
}

interface DebugPrompt {
  type: string;
  skill?: string;
  prompt?: string;
  response?: string;
  error?: string;
  debug_errors?: DebugError[];
  context?: ContentContextEntry[];
  query?: DebugQuery;
  steps?: DebugPrompt[];
  branch?: DebugPrompt[];
}

export async function buildDebugTree(db: Knex, projectId: string): Promise<DebugPrompt[]> {
  const prompts = await db('prompts')
    .where('project_id', projectId)
    .orderBy('created_at') as PromptRow[];
  if (prompts.length === 0) return [];

  const refs = await db('prompt_context')
    .whereIn('prompt_id', prompts.map(prompt => prompt.id)) as ContextRef[];
  const skills = await db('skills').select('id', 'name') as SkillRow[];
  const files = await db('files').select('id', 'filename', 'name', 'sha256').where('project_id', projectId) as FileRow[];

  const skillNameById = new Map(skills.map(skill => [skill.id, skill.name]));
  const refsByPromptId = new Map<string, ContextRef[]>();
  for (const ref of refs) {
    if (!refsByPromptId.has(ref.prompt_id)) refsByPromptId.set(ref.prompt_id, []);
    refsByPromptId.get(ref.prompt_id)!.push(ref);
  }

  const contentTree = await getContentTree(db, { projectId });
  return Promise.all(contentTree.map(prompt => buildPrompt(prompt)));

  async function buildPrompt(prompt: ContentPromptNode): Promise<DebugPrompt> {
    const entry: DebugPrompt = { type: prompt.type };
    const skill = prompt.skill_id ? skillNameById.get(prompt.skill_id) : undefined;
    const { query, debugErrors } = buildQuery(prompt);

    if (skill) entry.skill = skill;
    if (prompt.prompt) entry.prompt = prompt.prompt;
    if (prompt.response) entry.response = prompt.response;
    if (prompt.error) entry.error = prompt.error;
    if (debugErrors.length > 0) entry.debug_errors = debugErrors;
    if (prompt.messages) {
      const context = await getPromptContext(db, { projectId, promptId: prompt.id });
      if (context.length > 0) entry.context = context;
    }
    if (query) entry.query = query;

    if (prompt.steps && prompt.steps.length > 0) entry.steps = await Promise.all(prompt.steps.map(step => buildPrompt(step)));
    if (prompt.branch && prompt.branch.length > 0) entry.branch = await Promise.all(prompt.branch.map(branch => buildPrompt(branch)));

    return entry;
  }

  function buildQuery(prompt: PromptRow | ContentPromptNode): { query?: DebugQuery; debugErrors: DebugError[] } {
    const debugErrors: DebugError[] = [];

    if (prompt.messages) {
      try {
        const query = JSON.parse(prompt.messages);
        if (!Array.isArray(query)) {
          debugErrors.push({ path: 'query', code: 'invalid_stored_llm_query', message: 'Stored LLM query is not an array.' });
          return { debugErrors };
        }
        return { query, debugErrors };
      } catch {
        debugErrors.push({ path: 'query', code: 'invalid_stored_llm_query_json', message: 'Stored LLM query is not valid JSON.' });
        return { debugErrors };
      }
    }

    if (prompt.type !== 'tool') return { debugErrors };
    if (!prompt.prompt.startsWith('file_analysis:')) return { debugErrors };

    const fileRef = (refsByPromptId.get(prompt.id) || []).find(ref => ref.ref_type === 'file');
    const file = fileRef ? files.find(item => item.id === fileRef.ref_id) : undefined;
    const filename = file?.name || prompt.prompt.replace(/^file_analysis:\s*/, '').trim();
    if (!file) {
      debugErrors.push({ path: 'query.args.file', code: 'missing_file_ref', message: 'Cannot show file sha because the file reference no longer resolves.' });
      return { query: buildContentQuery({ kind: 'tool', tool: 'file_analysis', args: { file: '', filename } }), debugErrors };
    }

    if (!file.sha256) {
      debugErrors.push({ path: 'query.args.file', code: 'missing_file_sha256', message: 'Cannot show file sha because no stored sha256 exists for this file.' });
      return { query: buildContentQuery({ kind: 'tool', tool: 'file_analysis', args: { file: '', filename: file.name } }), debugErrors };
    }

    return { query: buildContentQuery({ kind: 'tool', tool: 'file_analysis', args: { file: `file-sha256:${file.sha256}`, filename: file.name } }), debugErrors };
  }
}