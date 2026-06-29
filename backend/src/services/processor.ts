import type { Knex } from 'knex';
import { callLLMStream } from './llm';
import { buildQuery, getPromptContext } from './content';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// Broadcast function — injected by the worker
let broadcastFn: (projectId: string, event: object) => void = () => {};
export function setBroadcast(fn: (projectId: string, event: object) => void) { broadcastFn = fn; }
function broadcast(projectId: string, event: object) { broadcastFn(projectId, event); }

function broadcastStage(projectId: string, pipelineId: string, stageId: string, status: string, label: string, error?: string) {
  broadcast(projectId, { type: 'pipeline-stage', pipelineId, stageId, status, label, error });
}

// Data directory — set by the worker
let dataDir = './data';
export function setDataDir(dir: string) { dataDir = dir; }

const PYWORKER_URL = process.env.PYWORKER_URL || 'http://localhost:3002';

// ----- Interfaces -----

interface SkillRow { id: string; name: string; system_prompt: string; tool_name: string | null; }
interface FileRow { id: string; filename: string; name: string; analysis: string | null; }
interface PromptRow {
  id: string; project_id: string; pipeline_id: string | null;
  type: string; prompt: string; response: string;
  skill_id: string | null; personality_id: string | null;
  status: string; created_at: string;
}

// ----- Cancellation -----

const activeAbortControllers = new Map<string, AbortController>();

export function cancelPrompt(promptId: string): boolean {
  const controller = activeAbortControllers.get(promptId);
  if (controller) { controller.abort(); activeAbortControllers.delete(promptId); return true; }
  return false;
}

// ----- Pyworker client (JSON, base64 file) -----

async function getToolSchema(toolName: string): Promise<{ params_schema: unknown | null; description: string; error?: string }> {
  try {
    const res = await fetch(`${PYWORKER_URL}/tools/${encodeURIComponent(toolName)}`, {
      headers: { 'X-Caller': 'system' },
    });
    if (!res.ok) return { params_schema: null, description: '', error: `Tool "${toolName}" not found (HTTP ${res.status})` };
    const data = await res.json() as any;
    const schema = data.params_schema ? (typeof data.params_schema === 'string' ? JSON.parse(data.params_schema) : data.params_schema) : null;
    return { params_schema: schema, description: data.description || '' };
  } catch (err: any) {
    return { params_schema: null, description: '', error: err.message };
  }
}

async function executeToolViaWorker(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${PYWORKER_URL}/tools/${encodeURIComponent(toolName)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Caller': 'system' },
      body: JSON.stringify(args),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) return { error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (err: any) {
    console.error(`[tool] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ----- Processing logic -----

function parsePrompt(prompt: string, db: Knex): { skillNames: string[]; userText: string; getSkills: () => Promise<{ skills: SkillRow[]; }> } {
  const skillPattern = /\/([a-zA-Z0-9_-]+)/g;
  const foundNames: string[] = [];
  let match;
  while ((match = skillPattern.exec(prompt)) !== null) {
    foundNames.push(match[1].toLowerCase());
  }

  const userText = prompt.replace(skillPattern, '').replace(/\s+/g, ' ').trim();
  return {
    skillNames: foundNames,
    userText,
    getSkills: async () => {
      const allSkills = await db('skills').select('*') as SkillRow[];
      const matchedSkills: SkillRow[] = [];
      for (const name of foundNames) {
        const skill = allSkills.find(s => s.name.toLowerCase() === name);
        if (skill) matchedSkills.push(skill);
      }
      return { skills: matchedSkills };
    },
  };
}

async function isCancelled(db: Knex, promptId: string): Promise<boolean> {
  const row = await db('prompts').select('status').where('id', promptId).first();
  return row?.status === 'cancel_requested';
}

async function getPersonality(db: Knex): Promise<{ id: string; text: string }> {
  const row = await db('personality').select('id', 'text').orderBy('created_at', 'desc').first();
  return row || { id: 'default', text: '' };
}

// ----- Tool arg generation via LLM -----

const ARG_GEN_SYSTEM_PROMPT = `You are a tool argument generator. Given a tool's JSON Schema, available context (files, prior results), and the user's intent, produce a valid JSON object matching the schema.

Rules:
- Output ONLY the JSON object. No explanation, no markdown, no wrapping.
- Match property names and types exactly as specified in the schema.
- Use context to determine correct values. Look at file analysis results in context for actual content.
- When user refers to "the file" or "new file", they mean the file whose analysis appears in context. Use that file's content/data.
- For string parameters expecting content: use the extracted text from file analysis results in context.
- For file parameters that expect raw file data: use the exact filename from "Available files" — the caller will resolve it to base64.
- If a required field cannot be determined from context, use a reasonable default.`;

async function generateToolArgs(
  db: Knex,
  toolName: string,
  toolDescription: string,
  paramsSchema: unknown,
  context: unknown[],
  userText: string,
  files: FileRow[]
): Promise<{ args: Record<string, unknown> | null; messages: { role: string; content: string }[]; error?: string }> {
  const fileList = files.map(f => ({ id: f.id, filename: f.filename, name: f.name }));

  const userContent = [
    `Tool: ${toolName}`,
    toolDescription ? `Description: ${toolDescription}` : '',
    `Schema: ${JSON.stringify(paramsSchema)}`,
    `Available files: ${JSON.stringify(fileList)}`,
  ].filter(Boolean).join('\n');

  const msgs = buildQuery({
    kind: 'llm',
    systemPrompt: ARG_GEN_SYSTEM_PROMPT,
    context,
    userContent,
  });

  let output = '';
  await callLLMStream(msgs, (chunk: string) => { output += chunk; });

  // Strip markdown code fences if present
  output = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { args: null, messages: msgs, error: `LLM returned non-object: ${output}` };
    }
    return { args: parsed, messages: msgs };
  } catch {
    return { args: null, messages: msgs, error: `LLM returned invalid JSON: ${output}` };
  }
}

// Resolve file references in tool args: if a value matches a known filename, replace with base64
async function resolveFileArgs(args: Record<string, unknown>, files: FileRow[]): Promise<Record<string, unknown>> {
  const resolved = { ...args };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== 'string') continue;
    // Check if the value matches a file name or filename
    const file = files.find(f => f.name === value || f.filename === value);
    if (file) {
      const filePath = path.resolve(dataDir, 'uploads', file.filename);
      try {
        const buf = fs.readFileSync(filePath);
        resolved[key] = buf.toString('base64');
        // Ensure filename is also set if there's a 'filename' key
        if (!resolved['filename'] && key !== 'filename') {
          resolved['filename'] = file.name;
        }
      } catch {
        // Leave as-is if file can't be read
      }
    }
  }
  return resolved;
}

// ----- Main entry point -----

export async function processPrompt(db: Knex, projectId: string, promptId: string): Promise<void> {
  await db('prompts').where('id', promptId).update({ status: 'processing', updated_at: db.fn.now() });
  broadcast(projectId, { type: 'prompt-status', promptId, status: 'processing' });

  const currentPrompt = await db('prompts').where('id', promptId).first() as PromptRow | undefined;
  if (!currentPrompt) return;

  const abortController = new AbortController();
  activeAbortControllers.set(promptId, abortController);
  let activeChildId: string | null = null;
  let activeStageLabel: string | null = null;

  try {
    const parsed = parsePrompt(currentPrompt.prompt, db);
    const { skills } = await parsed.getSkills();
    const userText = parsed.userText;
    const personality = await getPersonality(db);

    // Store personality_id reference
    await db('prompts').where('id', promptId).update({ personality_id: personality.id });

    // Get files attached to this prompt (via prompt_context file refs)
    const fileRefs = await db('prompt_context').select('ref_id').where('prompt_id', promptId).where('ref_type', 'file');

    const files: FileRow[] = [];
    for (const ref of fileRefs) {
      const f = await db('files').where('id', ref.ref_id).first() as FileRow | undefined;
      if (f) files.push(f);
    }

    const hasFiles = files.length > 0;
    const hasSkills = skills.length > 0;
    const needsPipeline = hasFiles || hasSkills;

    if (!needsPipeline && !userText) {
      // Nothing to process
      await db('prompts').where('id', promptId).update({ status: 'completed', updated_at: db.fn.now() });
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed' });
      return;
    }

    // ===== SIMPLE LLM (no files, no skills) =====
    if (!needsPipeline) {
      const context = await getPromptContext(db, { projectId, promptId });
      const msgs = buildQuery({ kind: 'llm', systemPrompt: personality.text, context, userContent: userText });

      await db('prompts').where('id', promptId).update({ messages: JSON.stringify(msgs), updated_at: db.fn.now() });

      let fullContent = '';
      await callLLMStream(msgs, async (chunk: string) => {
        fullContent += chunk;
        await db('prompts').where('id', promptId).update({ response: fullContent, updated_at: db.fn.now() });
        broadcast(projectId, { type: 'prompt-chunk', promptId, chunk, fullContent });
        if (await isCancelled(db, promptId)) abortController.abort();
      }, abortController.signal);

      await db('prompts').where('id', promptId).update({ response: fullContent, status: 'completed', updated_at: db.fn.now() });
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed', fullContent });
      return;
    }

    // ===== PIPELINE (has files OR skills) =====
    await db('prompts').where('id', promptId).update({ type: 'pipeline', updated_at: db.fn.now() });

    let lastChildId: string | null = null;

    // Step 1: Tool calls for each file (only if files attached)
    if (hasFiles) {
      for (const file of files) {
        if (abortController.signal.aborted || await isCancelled(db, promptId)) throw new Error('AbortError');

        const toolId = uuidv4();
        const filePath = path.resolve(dataDir, 'uploads', file.filename);
        activeChildId = toolId;
        activeStageLabel = `tool file_analysis: ${file.name}`;
        await db('prompts').insert({
          id: toolId, project_id: projectId, pipeline_id: promptId, type: 'tool',
          prompt: `file_analysis: ${file.name}`, response: '', personality_id: personality.id, status: 'processing',
        });
        await db('prompt_context').insert({ prompt_id: toolId, ref_type: 'file', ref_id: file.id });
        if (lastChildId) {
          await db('prompt_context').insert({ prompt_id: toolId, ref_type: 'prompt', ref_id: lastChildId });
        }
        broadcast(projectId, { type: 'prompt-status', promptId: toolId, status: 'processing' });
        broadcastStage(projectId, promptId, toolId, 'processing', activeStageLabel);

        const fileBase64 = fs.readFileSync(filePath).toString('base64');
        const analysisQuery = buildQuery({ kind: 'tool', tool: 'file_analysis', args: { file: fileBase64, filename: file.name } });
        const analysis = await executeToolViaWorker(analysisQuery.tool, analysisQuery.args);
        const analysisJson = JSON.stringify(analysis);

        await db('files').where('id', file.id).update({ analysis: analysisJson });
        await db('prompts').where('id', toolId).update({ response: analysisJson, status: 'completed', updated_at: db.fn.now() });

        broadcast(projectId, { type: 'prompt-status', promptId: toolId, status: 'completed' });
          broadcastStage(projectId, promptId, toolId, 'completed', activeStageLabel);
        activeChildId = null;
          activeStageLabel = null;
        lastChildId = toolId;
      }
    }

    // Step 2: Skill LLM calls (only if skills in prompt)
    if (hasSkills) {
      for (const skill of skills) {
        if (abortController.signal.aborted || await isCancelled(db, promptId)) throw new Error('AbortError');

        // --- If skill has a tool, run arg generation + tool execution first ---
        if (skill.tool_name) {
          const toolCallId = uuidv4();
          const { params_schema, description: toolDesc, error: schemaError } = await getToolSchema(skill.tool_name);

          if (schemaError) {
            await db('prompts').insert({
              id: toolCallId, project_id: projectId, pipeline_id: promptId, type: 'tool',
              prompt: `${skill.tool_name} (arg-gen)`, response: '', skill_id: skill.id,
              personality_id: personality.id, status: 'error', error: schemaError,
            });
            if (lastChildId) {
              await db('prompt_context').insert({ prompt_id: toolCallId, ref_type: 'prompt', ref_id: lastChildId });
            }
            broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'error', error: schemaError });
            broadcastStage(projectId, promptId, toolCallId, 'error', `tool ${skill.tool_name}`, schemaError);
            lastChildId = toolCallId;
            continue;
          }

          // Generate args via LLM
          const argGenId = uuidv4();
          const argGenPrompt = JSON.stringify({ tool: skill.tool_name, description: toolDesc, schema: params_schema });
          activeChildId = argGenId;
          activeStageLabel = `llm ${skill.name} args`;
          await db('prompts').insert({
            id: argGenId, project_id: projectId, pipeline_id: promptId, type: 'llm',
            prompt: argGenPrompt, response: '', skill_id: skill.id,
            personality_id: personality.id, status: 'processing',
          });
          if (lastChildId) {
            await db('prompt_context').insert({ prompt_id: argGenId, ref_type: 'prompt', ref_id: lastChildId });
          }
          broadcast(projectId, { type: 'prompt-status', promptId: argGenId, status: 'processing' });
          broadcastStage(projectId, promptId, argGenId, 'processing', activeStageLabel);

          const contextForArgs = await getPromptContext(db, { projectId, promptId: argGenId });
          const { args, messages: argGenMsgs, error: argError } = await generateToolArgs(
            db, skill.tool_name, toolDesc, params_schema, contextForArgs, userText, files
          );

          await db('prompts').where('id', argGenId).update({
            response: JSON.stringify(args || argError), messages: JSON.stringify(argGenMsgs),
            status: argError ? 'error' : 'completed', error: argError || null, updated_at: db.fn.now(),
          });
          broadcast(projectId, { type: 'prompt-status', promptId: argGenId, status: argError ? 'error' : 'completed' });
          broadcastStage(projectId, promptId, argGenId, argError ? 'error' : 'completed', activeStageLabel, argError);
          activeChildId = null;
          activeStageLabel = null;
          lastChildId = argGenId;

          if (argError || !args) {
            await db('prompts').insert({
              id: toolCallId, project_id: projectId, pipeline_id: promptId, type: 'tool',
              prompt: `${skill.tool_name}`, response: JSON.stringify({ attempted_args: args }),
              skill_id: skill.id, personality_id: personality.id,
              status: 'error', error: argError || 'Failed to generate tool arguments',
            });
            await db('prompt_context').insert({ prompt_id: toolCallId, ref_type: 'prompt', ref_id: lastChildId });
            broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'error', error: argError });
            broadcastStage(projectId, promptId, toolCallId, 'error', `tool ${skill.tool_name}`, argError || 'Failed to generate tool arguments');
            lastChildId = toolCallId;
            continue;
          }

          // Resolve file base64 if args reference filenames
          const resolvedArgs = await resolveFileArgs(args, files);

          const resolvedInfo = Object.keys(resolvedArgs).reduce((acc, k) => {
            if (typeof resolvedArgs[k] === 'string' && resolvedArgs[k] !== (args as any)[k]) {
              acc[k] = '[base64 file content]';
            } else {
              acc[k] = resolvedArgs[k];
            }
            return acc;
          }, {} as Record<string, unknown>);

          activeChildId = toolCallId;
          activeStageLabel = `tool ${skill.tool_name}`;
          await db('prompts').insert({
            id: toolCallId, project_id: projectId, pipeline_id: promptId, type: 'tool',
            prompt: `${skill.tool_name} ${JSON.stringify(resolvedInfo)}`, response: '',
            skill_id: skill.id, personality_id: personality.id, status: 'processing',
          });
          await db('prompt_context').insert({ prompt_id: toolCallId, ref_type: 'prompt', ref_id: lastChildId });
          broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'processing' });
          broadcastStage(projectId, promptId, toolCallId, 'processing', activeStageLabel);

          // Execute tool
          const toolQuery = buildQuery({ kind: 'tool', tool: skill.tool_name, args: resolvedArgs });
          const toolResult = await executeToolViaWorker(toolQuery.tool, toolQuery.args);
          const toolResultJson = JSON.stringify(toolResult);

          await db('prompts').where('id', toolCallId).update({ response: toolResultJson, status: 'completed', updated_at: db.fn.now() });
          broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'completed' });
          broadcastStage(projectId, promptId, toolCallId, 'completed', activeStageLabel);
          activeChildId = null;
          activeStageLabel = null;
          lastChildId = toolCallId;
        }

        // --- Skill LLM call (always runs) ---
        if (abortController.signal.aborted || await isCancelled(db, promptId)) throw new Error('AbortError');

        const skillPromptId = uuidv4();
        activeChildId = skillPromptId;
        activeStageLabel = `llm ${skill.name}`;
        await db('prompts').insert({
          id: skillPromptId, project_id: projectId, pipeline_id: promptId, type: 'llm',
          prompt: skill.system_prompt, skill_id: skill.id,
          personality_id: personality.id, status: 'processing',
        });

        if (lastChildId) {
          await db('prompt_context').insert({ prompt_id: skillPromptId, ref_type: 'prompt', ref_id: lastChildId });
        }

        broadcast(projectId, { type: 'prompt-status', promptId: skillPromptId, status: 'processing' });
    broadcastStage(projectId, promptId, skillPromptId, 'processing', activeStageLabel);

        const fullContext = await getPromptContext(db, { projectId, promptId: skillPromptId });
        const systemPrompt = personality.text;
        const msgs = buildQuery({ kind: 'llm', systemPrompt, context: fullContext, userContent: skill.system_prompt });

        await db('prompts').where('id', skillPromptId).update({ messages: JSON.stringify(msgs), updated_at: db.fn.now() });

        let output = '';
        await callLLMStream(msgs, async (chunk: string) => {
          output += chunk;
          broadcast(projectId, { type: 'prompt-chunk', promptId: skillPromptId, chunk, fullContent: output });
          if (await isCancelled(db, promptId)) abortController.abort();
        }, abortController.signal);

        await db('prompts').where('id', skillPromptId).update({ response: output, status: 'completed', updated_at: db.fn.now() });
        broadcast(projectId, { type: 'prompt-status', promptId: skillPromptId, status: 'completed' });
          broadcastStage(projectId, promptId, skillPromptId, 'completed', activeStageLabel);
        activeChildId = null;
          activeStageLabel = null;
        lastChildId = skillPromptId;
      }
    }

    // Step 3: Final LLM — the user's actual prompt with full context
    if (abortController.signal.aborted || await isCancelled(db, promptId)) throw new Error('AbortError');

    const finalId = uuidv4();
    activeChildId = finalId;
    activeStageLabel = 'llm final response';
    await db('prompts').insert({
      id: finalId, project_id: projectId, pipeline_id: promptId, type: 'llm',
      prompt: currentPrompt.prompt, personality_id: personality.id, status: 'processing',
    });

    if (lastChildId) {
      await db('prompt_context').insert({ prompt_id: finalId, ref_type: 'prompt', ref_id: lastChildId });
    }

    broadcast(projectId, { type: 'prompt-status', promptId: finalId, status: 'processing' });
    broadcastStage(projectId, promptId, finalId, 'processing', activeStageLabel);

    const fullContext = await getPromptContext(db, { projectId, promptId: finalId });
    const msgs = buildQuery({ kind: 'llm', systemPrompt: personality.text, context: fullContext, userContent: currentPrompt.prompt });

    await db('prompts').where('id', finalId).update({ messages: JSON.stringify(msgs), updated_at: db.fn.now() });

    let finalOutput = '';
    await callLLMStream(msgs, async (chunk: string) => {
      finalOutput += chunk;
      broadcast(projectId, { type: 'prompt-chunk', promptId: finalId, pipelineId: promptId, chunk, fullContent: finalOutput });
      if (await isCancelled(db, promptId)) abortController.abort();
    }, abortController.signal);

    await db('prompts').where('id', finalId).update({ response: finalOutput, status: 'completed', updated_at: db.fn.now() });
    broadcast(projectId, { type: 'prompt-status', promptId: finalId, status: 'completed' });
    broadcastStage(projectId, promptId, finalId, 'completed', activeStageLabel);
    activeChildId = null;
    activeStageLabel = null;

    // Pipeline parent done
    await db('prompts').where('id', promptId).update({ status: 'completed', updated_at: db.fn.now() });
    broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed' });

  } catch (err: any) {
    if (err.name === 'AbortError' || err.message === 'AbortError' || abortController.signal.aborted) {
      if (activeChildId) {
        await db('prompts').where('id', activeChildId).update({ status: 'stopped', updated_at: db.fn.now() });
        broadcast(projectId, { type: 'prompt-status', promptId: activeChildId, status: 'stopped' });
        broadcastStage(projectId, promptId, activeChildId, 'stopped', activeStageLabel || 'stage stopped');
      }
      await db('prompts').where('id', promptId).update({ status: 'stopped', updated_at: db.fn.now() });
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'stopped' });
    } else {
      const errorMsg = err.message || 'Unknown error';
      if (activeChildId) {
        await db('prompts').where('id', activeChildId).update({ status: 'error', error: errorMsg, updated_at: db.fn.now() });
        broadcast(projectId, { type: 'prompt-status', promptId: activeChildId, status: 'error', error: errorMsg });
        broadcastStage(projectId, promptId, activeChildId, 'error', activeStageLabel || 'stage failed', errorMsg);
      }
      await db('prompts').where('id', promptId).update({ status: 'error', error: errorMsg, updated_at: db.fn.now() });
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'error', error: errorMsg });
    }
  } finally {
    activeAbortControllers.delete(promptId);
  }
}
