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
- `getProjectContext(...)` -> previous completed top-level rows from `prompts`.
- web process -> does not pass a prepared context object.

## context construction

- `getProjectContext(db, projectId, beforeDate)` -> completed top-level prompts before `beforeDate`.
- previous pipeline prompt -> latest completed child response becomes the pipeline response.
- `unwindContext(db, promptId)` -> follows `prompt_context` rows where `ref_type = prompt`.
- `unwindContext(...)` -> recursively appends referenced context first -> appends completed referenced prompt as `{ type, prompt, response }`.

pipeline step chaining:

```ts
{ prompt_id: nextChildId, ref_type: 'prompt', ref_id: lastChildId }
```

## simple prompt path

condition:

```ts
files.length === 0 && skills.length === 0
```

- personality + project context + user text -> `buildMessages(...)`.
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
   - project context + `unwindContext(...)` -> LLM messages.
   - generated args or error -> child `response`.

3. skill tool execution, after successful arg generation.
   - filename args -> base64 file contents when matched.
   - insert child prompt: `type = tool`.
   - pyworker tool execution -> result JSON -> child `response`.

4. skill LLM, once per matched skill.
   - insert child prompt: `type = llm`, `prompt = skill.system_prompt`.
   - project context + `unwindContext(...)` entries marked `_current: true` -> LLM messages.
   - LLM messages -> child `messages`; output -> child `response`.

5. final LLM.
   - insert child prompt: `type = llm`, `prompt = original user prompt`.
   - project context + `unwindContext(...)` entries marked `_current: true` -> LLM messages.
   - LLM messages -> child `messages`; output -> child `response`.
   - top-level pipeline prompt -> `status = completed`.

## status and events

- prompt status values: `pending`, `processing`, `completed`, `error`, `stopped`, `cancel_requested`.
- events are emitted from `processPrompt(...)` through `broadcast(...)`; the worker posts them to `/api/events/broadcast`, and `eventsRouter` forwards them to `/api/events/:projectId` subscribers.
- stop request -> top-level prompt `status = cancel_requested`.
- cancellation check -> active child and top-level prompt `status = stopped`.