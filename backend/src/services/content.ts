import type { Knex } from 'knex';

export interface LlmMessage {
  role: string;
  content: string;
}

export interface ToolQuery {
  tool: string;
  args: Record<string, unknown>;
}

export interface ContentFileRef {
  id: string;
  name: string;
}

export interface ContentContextEntry {
  type: string;
  prompt?: string;
  response?: string;
}

export interface ContentPromptNode {
  id: string;
  pipeline_id: string | null;
  type: string;
  prompt: string;
  response: string;
  messages: string | null;
  skill_id: string | null;
  error: string | null;
  status: string;
  created_at: string | Date | number;
  updated_at: string | Date | number;
  latest_descendant_id: string;
  files?: ContentFileRef[];
  steps?: ContentPromptNode[];
  branch?: ContentPromptNode[];
}

interface PromptRow {
  id: string;
  pipeline_id: string | null;
  type: string;
  prompt: string;
  response: string;
  messages: string | null;
  skill_id: string | null;
  error: string | null;
  status: string;
  created_at: string | Date | number;
  updated_at: string | Date | number;
}

type TimestampValue = string | Date | number;

interface ContextRef {
  prompt_id: string;
  ref_type: string;
  ref_id: string;
}

interface FileRow {
  id: string;
  name: string;
}

type LlmQueryOptions = {
  kind: 'llm';
  systemPrompt: string;
  context: unknown[];
  userContent: string;
};

type ToolQueryOptions = {
  kind: 'tool';
  tool: string;
  args: Record<string, unknown>;
};

export function buildQuery(opts: LlmQueryOptions): LlmMessage[];
export function buildQuery(opts: ToolQueryOptions): ToolQuery;
export function buildQuery(opts: LlmQueryOptions | ToolQueryOptions): LlmMessage[] | ToolQuery {
  if (opts.kind === 'tool') return { tool: opts.tool, args: opts.args };

  const query: LlmMessage[] = [];
  if (opts.systemPrompt) query.push({ role: 'system', content: opts.systemPrompt });

  for (const item of opts.context) {
    const entry = item as Record<string, unknown>;
    const prompt = typeof entry.prompt === 'string' ? entry.prompt : (typeof entry.type === 'string' ? entry.type : '');
    const response = typeof entry.response === 'string' ? entry.response : (entry.response === undefined ? '' : JSON.stringify(entry.response));
    query.push({ role: 'user', content: prompt });
    query.push({ role: 'assistant', content: response });
  }

  query.push({ role: 'user', content: opts.userContent });
  return query;
}

export async function getContentTree(db: Knex, opts: { projectId: string; promptId?: string }): Promise<ContentPromptNode[]> {
  const prompts = await db('prompts')
    .where('project_id', opts.projectId)
    .orderBy('created_at') as PromptRow[];
  const topLevel = prompts.filter(prompt => !prompt.pipeline_id);
  if (topLevel.length === 0) return [];

  const refs = await db('prompt_context')
    .whereIn('prompt_id', prompts.map(prompt => prompt.id)) as ContextRef[];
  const refsByPromptId = new Map<string, ContextRef[]>();
  for (const ref of refs) {
    if (!refsByPromptId.has(ref.prompt_id)) refsByPromptId.set(ref.prompt_id, []);
    refsByPromptId.get(ref.prompt_id)!.push(ref);
  }

  const files = await db('files').select('id', 'name').where('project_id', opts.projectId) as FileRow[];
  const fileById = new Map(files.map(file => [file.id, file]));

  const topLevelById = new Map(topLevel.map(prompt => [prompt.id, prompt]));
  const parentIdByPromptId = new Map<string, string | null>();
  const siblingsByParentId = new Map<string | null, PromptRow[]>();
  const childrenByParentId = new Map<string, PromptRow[]>();
  const topLevelIds = new Set(topLevel.map(prompt => prompt.id));
  const stepsByPipelineId = new Map<string, PromptRow[]>();

  for (const prompt of prompts) {
    if (!prompt.pipeline_id) continue;
    if (!stepsByPipelineId.has(prompt.pipeline_id)) stepsByPipelineId.set(prompt.pipeline_id, []);
    stepsByPipelineId.get(prompt.pipeline_id)!.push(prompt);
  }

  for (const prompt of topLevel) {
    const parentId = getTopLevelParentId(prompt, refsByPromptId, topLevelIds);
    parentIdByPromptId.set(prompt.id, parentId);
    if (!siblingsByParentId.has(parentId)) siblingsByParentId.set(parentId, []);
    siblingsByParentId.get(parentId)!.push(prompt);
    if (parentId) {
      if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
      childrenByParentId.get(parentId)!.push(prompt);
    }
  }

  const leaf = opts.promptId
    ? topLevelById.get(opts.promptId)
    : [...topLevel].sort((a, b) => compareCreatedAtDesc(a, b))[0];
  if (!leaf) return [];

  const path: PromptRow[] = [];
  let current: PromptRow | undefined = leaf;
  while (current) {
    path.unshift(current);
    const parentId: string | null = parentIdByPromptId.get(current.id) || null;
    current = parentId ? topLevelById.get(parentId) : undefined;
  }

  return Promise.all(path.map(prompt => toNode(prompt, true)));

  async function toNode(prompt: PromptRow, includeBranches: boolean): Promise<ContentPromptNode> {
    const node: ContentPromptNode = {
      id: prompt.id,
      pipeline_id: prompt.pipeline_id,
      type: prompt.type,
      prompt: prompt.prompt,
      response: prompt.response,
      messages: prompt.messages,
      skill_id: prompt.skill_id,
      error: prompt.error,
      status: prompt.status,
      created_at: prompt.created_at,
      updated_at: prompt.updated_at,
      latest_descendant_id: getLatestDescendant(prompt).id,
    };

    const fileRefs = (refsByPromptId.get(prompt.id) || [])
      .filter(ref => ref.ref_type === 'file')
      .map(ref => fileById.get(ref.ref_id))
      .filter((file): file is FileRow => !!file)
      .map(file => ({ id: file.id, name: file.name }));
    if (fileRefs.length > 0) node.files = fileRefs;

    const steps = getOrderedPipelineSteps(prompt.id);
    if (steps.length > 0) node.steps = await Promise.all(steps.map(step => toNode(step, false)));

    if (includeBranches) {
      const parentId = parentIdByPromptId.get(prompt.id) || null;
      const branches = (siblingsByParentId.get(parentId) || []).filter(sibling => sibling.id !== prompt.id);
      if (branches.length > 0) node.branch = await Promise.all(branches.map(branch => toNode(branch, false)));
    }

    return node;
  }

  function getLatestDescendant(prompt: PromptRow): PromptRow {
    let latest = prompt;
    const stack = [...(childrenByParentId.get(prompt.id) || [])];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (compareCreatedAtAsc(current, latest) > 0) latest = current;
      stack.push(...(childrenByParentId.get(current.id) || []));
    }

    return latest;
  }

  function getOrderedPipelineSteps(pipelineId: string): PromptRow[] {
    const steps = stepsByPipelineId.get(pipelineId) || [];
    if (steps.length < 2) return steps;

    const stepIds = new Set(steps.map(step => step.id));
    const previousIdByStepId = new Map<string, string>();
    const nextStepsByPreviousId = new Map<string, PromptRow[]>();

    for (const step of steps) {
      const previousRef = (refsByPromptId.get(step.id) || []).find(ref => ref.ref_type === 'prompt' && stepIds.has(ref.ref_id));
      if (!previousRef) continue;
      previousIdByStepId.set(step.id, previousRef.ref_id);
      if (!nextStepsByPreviousId.has(previousRef.ref_id)) nextStepsByPreviousId.set(previousRef.ref_id, []);
      nextStepsByPreviousId.get(previousRef.ref_id)!.push(step);
    }

    const ordered: PromptRow[] = [];
    const seen = new Set<string>();

    function appendFrom(step: PromptRow) {
      if (seen.has(step.id)) return;
      seen.add(step.id);
      ordered.push(step);
      for (const next of nextStepsByPreviousId.get(step.id) || []) appendFrom(next);
    }

    for (const step of steps) {
      if (!previousIdByStepId.has(step.id)) appendFrom(step);
    }
    for (const step of steps) appendFrom(step);

    return ordered;
  }
}

export async function getPromptContext(db: Knex, opts: { projectId: string; promptId: string }): Promise<ContentContextEntry[]> {
  const prompt = await db('prompts')
    .select('id', 'pipeline_id')
    .where('id', opts.promptId)
    .where('project_id', opts.projectId)
    .first() as { id: string; pipeline_id: string | null } | undefined;
  if (!prompt) return [];

  const topLevelPromptId = prompt.pipeline_id || prompt.id;
  const tree = await getContentTree(db, { projectId: opts.projectId, promptId: topLevelPromptId });
  const branchContext = contentTreeToContext(tree, { excludeLast: true });
  if (!prompt.pipeline_id) return branchContext;

  const currentTopLevel = tree[tree.length - 1];
  return [
    ...branchContext,
    ...contentTreeToContext(currentTopLevel?.steps || [], { beforePromptId: prompt.id }),
  ];
}

export function contentTreeToContext(tree: ContentPromptNode[], opts: { excludeLast?: boolean; beforePromptId?: string } = {}): ContentContextEntry[] {
  const nodes = opts.excludeLast ? tree.slice(0, -1) : tree;
  const context: ContentContextEntry[] = [];
  const seen = new Set<string>();

  for (const node of nodes) appendNode(node);
  return context;

  function appendNode(node: ContentPromptNode): boolean {
    if (node.id === opts.beforePromptId) return false;

    if (node.type === 'pipeline') {
      for (const step of node.steps || []) {
        if (!appendNode(step)) return false;
      }
      return true;
    }

    if (seen.has(node.id)) return true;
    seen.add(node.id);
    if (node.status !== 'completed') return true;

    const entry: { type: string; prompt?: string; response?: string } = { type: node.type };
    if (node.prompt) entry.prompt = node.prompt;
    if (node.response) entry.response = node.response;
    context.push(entry);
    return true;
  }
}

function getTopLevelParentId(prompt: PromptRow, refsByPromptId: Map<string, ContextRef[]>, topLevelIds: Set<string>): string | null {
  const parentRef = (refsByPromptId.get(prompt.id) || []).find(ref => ref.ref_type === 'prompt' && topLevelIds.has(ref.ref_id));
  return parentRef?.ref_id || null;
}

function compareCreatedAtAsc(a: { created_at: TimestampValue }, b: { created_at: TimestampValue }): number {
  return timestampMs(a.created_at) - timestampMs(b.created_at);
}

function compareCreatedAtDesc(a: { created_at: TimestampValue }, b: { created_at: TimestampValue }): number {
  return timestampMs(b.created_at) - timestampMs(a.created_at);
}

function timestampMs(value: TimestampValue): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}