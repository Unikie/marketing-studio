# pipeline processor

## start

- `POST /api/projects/:projectId/prompts` -> inserts top-level `prompts` row with `pipeline_id = null`, `status = pending`.
- attached files -> inserted into `prompt_context` as `ref_type = file`.
- branch parent -> inserted into `prompt_context` as `ref_type = prompt`.
- `src/worker.ts` -> polls oldest top-level pending prompt -> calls `processPrompt(db, projectId, promptId)`.

poll condition:

```sql
status = 'pending' and pipeline_id is null
```

## database reads

- `processPrompt(...)` -> current prompt from `prompts`.
- `processPrompt(...)` -> file refs from `prompt_context` -> file rows from `files`.
- `parsePrompt(...)` -> `/skill` tokens -> matching rows from `skills`.
- `getPersonality(...)` -> latest row from `personality`.
- `content.getContentTree(...)` -> current branch path from prompt-parent refs.
- web process -> does not pass a prepared context object.

## context construction

- `content.getContentTree(db, { projectId, promptId })` -> current top-level branch path.
- pipeline rows are wrappers only; they are not emitted as query context prompt/response messages.
- `content.getContentTree(...)` attaches pipeline child prompts as `steps`.
- `content.contentTreeToContext(...)` -> prompt/response entries from real prompt nodes in that branch path and pipeline steps.
- `content.getPromptContext(...)` -> the single context builder used by processor and debug output.
- context entries are deduplicated in `content.contentTreeToContext(...)`.

pipeline step chaining:

```ts
{ prompt_id: nextChildId, ref_type: 'prompt', ref_id: lastChildId }
```

## simple prompt path

condition:

```ts
files.length === 0 && skills.length === 0
```

- personality + branch context + user text -> `content.buildQuery(...)`.
- context is built by `content.getPromptContext(...)`.
- LLM query roles: personality is the only `system` message; context prompt/response entries become prior `user`/`assistant` messages; current prompt is the final `user` message.
- streamed LLM output -> top-level prompt `response`.
- LLM messages -> top-level prompt `messages`.
- top-level prompt -> `status = completed`.

## pipeline path

condition:

```ts
files.length > 0 || skills.length > 0
```

- top-level prompt -> `type = pipeline`.
- each pipeline step -> child `prompts` row with `pipeline_id = parentPromptId`.

## pipeline steps

1. file analysis, one step per file.
   - insert child prompt: `type = tool`, `status = processing`.
   - file -> child `prompt_context` ref with `ref_type = file`.
   - previous child -> child `prompt_context` ref with `ref_type = prompt`.
   - pyworker `file_analysis` -> result JSON -> `files.analysis` and child `response`.

2. skill tool argument generation, for skills with `tool_name`.
   - pyworker tool schema -> arg-generation LLM prompt.
   - insert child prompt: `type = llm`.
   - `content.getPromptContext(...)` -> LLM query.
   - generated args or error -> child `response`.

3. skill tool execution, after successful arg generation.
   - filename args -> base64 file contents when matched.
   - insert child prompt: `type = tool`.
   - pyworker tool execution -> result JSON -> child `response`.

4. skill LLM, once per matched skill.
   - insert child prompt: `type = llm`, `prompt = skill.system_prompt`.
   - `content.getPromptContext(...)` -> LLM query.
   - LLM query -> child `messages`; output -> child `response`.

5. final LLM.
   - insert child prompt: `type = llm`, `prompt = original user prompt`.
   - `content.getPromptContext(...)` -> LLM query.
   - LLM query -> child `messages`; output -> child `response`.
   - top-level pipeline prompt -> `status = completed`.

## status and events

- prompt status values: `pending`, `processing`, `completed`, `error`, `stopped`, `cancel_requested`.
- events are emitted from `processPrompt(...)` through `broadcast(...)`; the worker posts them to `/api/events/broadcast`, and `eventsRouter` forwards them to `/api/events/:projectId` subscribers.
- stop request -> top-level prompt `status = cancel_requested`.
- cancellation check -> active child and top-level prompt `status = stopped`.