import { Prompt } from '../api';
import JsonTree from './JsonTree';

interface DebugViewProps {
  prompts: Prompt[];
}

function cleanForDebug(prompts: Prompt[]): unknown[] {
  // Build tree: nest pipeline children under parents
  const topLevel = prompts.filter(p => !p.pipeline_id);

  function parseJsonMaybe(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
    try { return JSON.parse(trimmed); }
    catch { return value; }
  }

  function cleanMessages(messages?: { role: string; content: string }[]) {
    if (!messages || messages.length === 0) return undefined;
    return messages.map(message => {
      if (message.role === 'system' && message.content.startsWith('Context ')) {
        const jsonStart = message.content.indexOf('\n');
        const rawContext = jsonStart >= 0 ? message.content.slice(jsonStart + 1) : '';
        return {
          role: message.role,
          context: parseJsonMaybe(rawContext),
        };
      }
      return {
        role: message.role,
        content: parseJsonMaybe(message.content),
      };
    });
  }

  function cleanContext(ctx: any[]) {
    if (!ctx || ctx.length === 0) return undefined;
    return ctx.map(c => {
      if (c.type === 'file') return c;
      // Prompt ref — show just the content
      const entry: any = {};
      if (c.prompt_type) entry.type = c.prompt_type;
      if (c.prompt) entry.prompt = c.prompt;
      if (c.response) entry.response = typeof c.response === 'string' ? parseJsonMaybe(c.response) : c.response;
      return entry;
    });
  }

  function cleanEntry(p: Prompt): any {
    const children = prompts.filter(c => c.pipeline_id === p.id);
    const entry: any = {};
    entry.type = p.type;
    if (p.skill) entry.skill = p.skill;
    if (p.prompt) entry.prompt = p.prompt;
    if (p.response) entry.response = typeof p.response === 'string' ? parseJsonMaybe(p.response) : p.response;
    if (p.status !== 'completed') entry.status = p.status;
    if (p.error) entry.error = p.error;
    const llmInput = cleanMessages((p as any).messages);
    if (llmInput) entry.llm_input = llmInput;
    const ctx = cleanContext(p.context as any[]);
    if (ctx) entry.context = ctx;
    if (children.length > 0) entry.steps = children.map(cleanEntry);
    entry.time = p.updated_at;
    return entry;
  }

  return topLevel.map(cleanEntry);
}

export default function DebugView({ prompts }: DebugViewProps) {
  const data = cleanForDebug(prompts);
  return (
    <div className="debug-view">
      <JsonTree data={data} defaultExpanded={0} />
    </div>
  );
}
