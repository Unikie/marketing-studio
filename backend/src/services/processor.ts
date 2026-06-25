import Database from 'better-sqlite3';
import { callLLMStream } from './llm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// Broadcast function — injected by the worker
let broadcastFn: (projectId: string, event: object) => void = () => {};
export function setBroadcast(fn: (projectId: string, event: object) => void) { broadcastFn = fn; }
function broadcast(projectId: string, event: object) { broadcastFn(projectId, event); }

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
  skill_id: string | null; system_instruction_id: string | null;
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

async function analyzeFileViaWorker(filePath: string, originalName: string): Promise<unknown> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileBase64 = fileBuffer.toString('base64');

    const res = await fetch(`${PYWORKER_URL}/tools/file_analysis/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Caller': 'system' },
      body: JSON.stringify({ file: fileBase64, filename: originalName }),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) return { error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (err: any) {
    console.error(`[analyzer] Error for ${originalName}:`, err.message);
    return { error: err.message };
  }
}

// ----- Context unwinding -----

function unwindContext(db: Database.Database, promptId: string): unknown[] {
  const context: unknown[] = [];
  const visited = new Set<string>();

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const refs = db.prepare(
      "SELECT ref_type, ref_id FROM prompt_context WHERE prompt_id = ?"
    ).all(id) as { ref_type: string; ref_id: string }[];

    for (const ref of refs) {
      if (ref.ref_type === 'prompt') {
        const p = db.prepare('SELECT * FROM prompts WHERE id = ?').get(ref.ref_id) as PromptRow | undefined;
        if (p && p.status === 'completed') {
          // Recurse into this prompt's context first (depth-first)
          walk(p.id);
          const entry: { type: string; prompt?: string; response?: string } = { type: p.type };
          if (p.prompt) entry.prompt = p.prompt;
          if (p.response) entry.response = p.response;
          context.push(entry);
        }
      }
    }
  }

  walk(promptId);
  return context;
}

// Collect project-level history (top-level completed prompts before this one)
function getProjectContext(db: Database.Database, projectId: string, beforeDate: string): unknown[] {
  const rows = db.prepare(
    "SELECT * FROM prompts WHERE project_id = ? AND pipeline_id IS NULL AND status = 'completed' AND created_at < ? ORDER BY created_at"
  ).all(projectId, beforeDate) as PromptRow[];

  const context: unknown[] = [];
  for (const p of rows) {
    // For pipelines, get the last child's response
    if (p.type === 'pipeline') {
      const lastChild = db.prepare(
        "SELECT response FROM prompts WHERE pipeline_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1"
      ).get(p.id) as { response: string } | undefined;
      if (lastChild) {
        context.push({ type: 'pipeline', prompt: p.prompt, response: lastChild.response });
      }
    } else {
      const entry: { type: string; prompt?: string; response?: string } = { type: p.type };
      if (p.prompt) entry.prompt = p.prompt;
      if (p.response) entry.response = p.response;
      context.push(entry);
    }
  }
  return context;
}

// ----- Processing logic -----

function parsePrompt(prompt: string, db: Database.Database): { skills: SkillRow[]; userText: string } {
  const skillPattern = /\/([a-zA-Z0-9_-]+)/g;
  const foundNames: string[] = [];
  let match;
  while ((match = skillPattern.exec(prompt)) !== null) {
    foundNames.push(match[1].toLowerCase());
  }

  const allSkills = db.prepare('SELECT * FROM skills').all() as SkillRow[];
  const matchedSkills: SkillRow[] = [];
  for (const name of foundNames) {
    const skill = allSkills.find(s => s.name.toLowerCase() === name);
    if (skill) matchedSkills.push(skill);
  }

  const userText = prompt.replace(skillPattern, '').replace(/\s+/g, ' ').trim();
  return { skills: matchedSkills, userText };
}

function isCancelled(db: Database.Database, promptId: string): boolean {
  const row = db.prepare('SELECT status FROM prompts WHERE id = ?').get(promptId) as { status: string } | undefined;
  return row?.status === 'cancel_requested';
}

function getSystemInstruction(db: Database.Database): { id: string; text: string } {
  const row = db.prepare('SELECT id, text FROM system_instructions ORDER BY created_at DESC LIMIT 1').get() as { id: string; text: string } | undefined;
  return row || { id: 'default', text: '' };
}

function buildMessages(opts: { systemPrompt: string; context: unknown[]; userContent: string }): { role: string; content: string }[] {
  const msgs: { role: string; content: string }[] = [];
  if (opts.systemPrompt) msgs.push({ role: 'system', content: opts.systemPrompt });

  if (opts.context.length > 0) {
    const header = 'Context (items with "_current":true are results from the current request; others are from previous conversation history):\n';
    msgs.push({ role: 'system', content: header + JSON.stringify(opts.context) });
  }

  msgs.push({ role: 'user', content: opts.userContent });
  return msgs;
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
  db: Database.Database,
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

  const msgs = buildMessages({
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

export async function processPrompt(db: Database.Database, projectId: string, promptId: string): Promise<void> {
  db.prepare("UPDATE prompts SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(promptId);
  broadcast(projectId, { type: 'prompt-status', promptId, status: 'processing' });

  const currentPrompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId) as PromptRow | undefined;
  if (!currentPrompt) return;

  const abortController = new AbortController();
  activeAbortControllers.set(promptId, abortController);

  try {
    const { skills, userText } = parsePrompt(currentPrompt.prompt, db);
    const sysInstruction = getSystemInstruction(db);

    // Store system_instruction_id reference
    db.prepare("UPDATE prompts SET system_instruction_id = ? WHERE id = ?").run(sysInstruction.id, promptId);

    // Get files attached to this prompt (via prompt_context file refs)
    const fileRefs = db.prepare(
      "SELECT ref_id FROM prompt_context WHERE prompt_id = ? AND ref_type = 'file'"
    ).all(promptId) as { ref_id: string }[];

    const files: FileRow[] = [];
    for (const ref of fileRefs) {
      const f = db.prepare('SELECT * FROM files WHERE id = ?').get(ref.ref_id) as FileRow | undefined;
      if (f) files.push(f);
    }

    const hasFiles = files.length > 0;
    const hasSkills = skills.length > 0;
    const needsPipeline = hasFiles || hasSkills;

    // --- Project-level context (previous top-level prompts) ---
    const projectContext = getProjectContext(db, projectId, currentPrompt.created_at);

    if (!needsPipeline && !userText) {
      // Nothing to process
      db.prepare("UPDATE prompts SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(promptId);
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed' });
      return;
    }

    // ===== SIMPLE LLM (no files, no skills) =====
    if (!needsPipeline) {
      const context = projectContext;
      const msgs = buildMessages({ systemPrompt: sysInstruction.text, context, userContent: userText });

      db.prepare("UPDATE prompts SET messages = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(msgs), promptId);

      let fullContent = '';
      await callLLMStream(msgs, (chunk: string) => {
        fullContent += chunk;
        db.prepare("UPDATE prompts SET response = ?, updated_at = datetime('now') WHERE id = ?").run(fullContent, promptId);
        broadcast(projectId, { type: 'prompt-chunk', promptId, chunk, fullContent });
        if (isCancelled(db, promptId)) abortController.abort();
      }, abortController.signal);

      db.prepare("UPDATE prompts SET response = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?").run(fullContent, promptId);
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed', fullContent });
      return;
    }

    // ===== PIPELINE (has files OR skills) =====
    db.prepare("UPDATE prompts SET type = 'pipeline', updated_at = datetime('now') WHERE id = ?").run(promptId);

    let lastChildId: string | null = null;

    // Step 1: Tool calls for each file (only if files attached)
    if (hasFiles) {
      for (const file of files) {
        if (abortController.signal.aborted || isCancelled(db, promptId)) throw new Error('AbortError');

        const toolId = uuidv4();
        const filePath = path.resolve(dataDir, 'uploads', file.filename);
        const analysis = await analyzeFileViaWorker(filePath, file.name);
        const analysisJson = JSON.stringify(analysis);

        db.prepare("UPDATE files SET analysis = ? WHERE id = ?").run(analysisJson, file.id);

        db.prepare(
          "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, response, system_instruction_id, status) VALUES (?, ?, ?, 'tool', ?, ?, ?, 'completed')"
        ).run(toolId, projectId, promptId, file.name, analysisJson, sysInstruction.id);

        db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'file', ?)").run(toolId, file.id);
        if (lastChildId) {
          db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(toolId, lastChildId);
        }

        broadcast(projectId, { type: 'prompt-status', promptId: toolId, status: 'completed' });
        lastChildId = toolId;
      }
    }

    // Step 2: Skill LLM calls (only if skills in prompt)
    if (hasSkills) {
      for (const skill of skills) {
        if (abortController.signal.aborted || isCancelled(db, promptId)) throw new Error('AbortError');

        // --- If skill has a tool, run arg generation + tool execution first ---
        if (skill.tool_name) {
          const toolCallId = uuidv4();
          const { params_schema, description: toolDesc, error: schemaError } = await getToolSchema(skill.tool_name);

          if (schemaError) {
            // Tool not found or unreachable — fail this step
            db.prepare(
              "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, response, skill_id, system_instruction_id, status, error) VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, 'error', ?)"
            ).run(toolCallId, projectId, promptId, `${skill.tool_name} (arg-gen)`, '', skill.id, sysInstruction.id, schemaError);
            if (lastChildId) {
              db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(toolCallId, lastChildId);
            }
            broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'error', error: schemaError });
            lastChildId = toolCallId;
            continue; // skip this skill entirely
          }

          // Generate args via LLM
          const argGenId = uuidv4();
          const chainContextForArgs = lastChildId ? unwindContext(db, lastChildId) : [];
          // Include the lastChild itself in context (unwindContext gets its ancestors, not itself)
          if (lastChildId) {
            const lastChildRow = db.prepare('SELECT * FROM prompts WHERE id = ?').get(lastChildId) as PromptRow | undefined;
            if (lastChildRow && lastChildRow.status === 'completed') {
              const entry: { type: string; prompt?: string; response?: string } = { type: lastChildRow.type };
              if (lastChildRow.prompt) entry.prompt = lastChildRow.prompt;
              if (lastChildRow.response) entry.response = lastChildRow.response;
              chainContextForArgs.push(entry);
            }
          }
          const contextForArgs = [...projectContext, ...chainContextForArgs];
          const { args, messages: argGenMsgs, error: argError } = await generateToolArgs(
            db, skill.tool_name, toolDesc, params_schema, contextForArgs, userText, files
          );

          // Store arg generation as visible step
          const argGenPrompt = JSON.stringify({ tool: skill.tool_name, description: toolDesc, schema: params_schema });
          db.prepare(
            "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, response, messages, skill_id, system_instruction_id, status) VALUES (?, ?, ?, 'llm', ?, ?, ?, ?, ?, ?)"
          ).run(argGenId, projectId, promptId, argGenPrompt, JSON.stringify(args || argError), JSON.stringify(argGenMsgs), skill.id, sysInstruction.id, argError ? 'error' : 'completed');
          if (lastChildId) {
            db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(argGenId, lastChildId);
          }
          broadcast(projectId, { type: 'prompt-status', promptId: argGenId, status: argError ? 'error' : 'completed' });
          lastChildId = argGenId;

          if (argError || !args) {
            db.prepare(
              "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, response, skill_id, system_instruction_id, status, error) VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, 'error', ?)"
            ).run(toolCallId, projectId, promptId, `${skill.tool_name}`, JSON.stringify({ attempted_args: args }), skill.id, sysInstruction.id, argError || 'Failed to generate tool arguments');
            db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(toolCallId, lastChildId);
            broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'error', error: argError });
            lastChildId = toolCallId;
            continue;
          }

          // Resolve file base64 if args reference filenames
          const resolvedArgs = await resolveFileArgs(args, files);

          // Execute tool
          const toolResult = await executeToolViaWorker(skill.tool_name, resolvedArgs);
          const toolResultJson = JSON.stringify(toolResult);

          // Store which args were file-resolved
          const resolvedInfo = Object.keys(resolvedArgs).reduce((acc, k) => {
            if (typeof resolvedArgs[k] === 'string' && resolvedArgs[k] !== (args as any)[k]) {
              acc[k] = '[base64 file content]';
            } else {
              acc[k] = resolvedArgs[k];
            }
            return acc;
          }, {} as Record<string, unknown>);

          db.prepare(
            "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, response, skill_id, system_instruction_id, status) VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, 'completed')"
          ).run(toolCallId, projectId, promptId, `${skill.tool_name} ${JSON.stringify(resolvedInfo)}`, toolResultJson, skill.id, sysInstruction.id);
          db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(toolCallId, lastChildId);
          broadcast(projectId, { type: 'prompt-status', promptId: toolCallId, status: 'completed' });
          lastChildId = toolCallId;
        }

        // --- Skill LLM call (always runs) ---
        if (abortController.signal.aborted || isCancelled(db, promptId)) throw new Error('AbortError');

        const skillPromptId = uuidv4();
        db.prepare(
          "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, skill_id, system_instruction_id, status) VALUES (?, ?, ?, 'llm', ?, ?, ?, 'processing')"
        ).run(skillPromptId, projectId, promptId, skill.system_prompt, skill.id, sysInstruction.id);

        if (lastChildId) {
          db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(skillPromptId, lastChildId);
        }

        broadcast(projectId, { type: 'prompt-status', promptId: skillPromptId, status: 'processing' });

        const chainContext = unwindContext(db, skillPromptId).map((c: any) => ({ ...c, _current: true }));
        const fullContext = [...projectContext, ...chainContext];
        const systemPrompt = sysInstruction.text;
        const msgs = buildMessages({ systemPrompt, context: fullContext, userContent: skill.system_prompt });

        db.prepare("UPDATE prompts SET messages = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(msgs), skillPromptId);

        let output = '';
        await callLLMStream(msgs, (chunk: string) => {
          output += chunk;
          broadcast(projectId, { type: 'prompt-chunk', promptId: skillPromptId, chunk, fullContent: output });
          if (isCancelled(db, promptId)) abortController.abort();
        }, abortController.signal);

        db.prepare("UPDATE prompts SET response = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?").run(output, skillPromptId);
        broadcast(projectId, { type: 'prompt-status', promptId: skillPromptId, status: 'completed' });
        lastChildId = skillPromptId;
      }
    }

    // Step 3: Final LLM — the user's actual prompt with full context
    if (abortController.signal.aborted || isCancelled(db, promptId)) throw new Error('AbortError');

    const finalId = uuidv4();
    db.prepare(
      "INSERT INTO prompts (id, project_id, pipeline_id, type, prompt, system_instruction_id, status) VALUES (?, ?, ?, 'llm', ?, ?, 'processing')"
    ).run(finalId, projectId, promptId, currentPrompt.prompt, sysInstruction.id);

    if (lastChildId) {
      db.prepare("INSERT INTO prompt_context (prompt_id, ref_type, ref_id) VALUES (?, 'prompt', ?)").run(finalId, lastChildId);
    }

    broadcast(projectId, { type: 'prompt-status', promptId: finalId, status: 'processing' });

    const chainContext = unwindContext(db, finalId).map((c: any) => ({ ...c, _current: true }));
    const fullContext = [...projectContext, ...chainContext];
    const msgs = buildMessages({ systemPrompt: sysInstruction.text, context: fullContext, userContent: currentPrompt.prompt });

    db.prepare("UPDATE prompts SET messages = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(msgs), finalId);

    let finalOutput = '';
    await callLLMStream(msgs, (chunk: string) => {
      finalOutput += chunk;
      broadcast(projectId, { type: 'prompt-chunk', promptId: finalId, chunk, fullContent: finalOutput });
      if (isCancelled(db, promptId)) abortController.abort();
    }, abortController.signal);

    db.prepare("UPDATE prompts SET response = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?").run(finalOutput, finalId);
    broadcast(projectId, { type: 'prompt-status', promptId: finalId, status: 'completed' });

    // Pipeline parent done
    db.prepare("UPDATE prompts SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(promptId);
    broadcast(projectId, { type: 'prompt-status', promptId, status: 'completed' });

  } catch (err: any) {
    if (err.name === 'AbortError' || err.message === 'AbortError' || abortController.signal.aborted) {
      db.prepare("UPDATE prompts SET status = 'stopped', updated_at = datetime('now') WHERE id = ?").run(promptId);
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'stopped' });
    } else {
      const errorMsg = err.message || 'Unknown error';
      db.prepare("UPDATE prompts SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(errorMsg, promptId);
      broadcast(projectId, { type: 'prompt-status', promptId, status: 'error', error: errorMsg });
    }
  } finally {
    activeAbortControllers.delete(promptId);
  }
}
