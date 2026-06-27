import { Prompt } from '../api';
import JsonTree from './JsonTree';

interface DebugViewProps {
  prompts: Prompt[];
}

function cleanForDebug(prompts: Prompt[]): unknown[] {
  // Build tree: nest pipeline children under parents
  const topLevel = prompts.filter(p => !p.pipeline_id);

  function cleanContext(ctx: any[]) {
    if (!ctx || ctx.length === 0) return undefined;
    return ctx.map(c => {
      if (c.type === 'file') return { file: c.name };
      // Prompt ref — show just the content
      const entry: any = {};
      if (c.prompt_type) entry.type = c.prompt_type;
      if (c.prompt) entry.prompt = c.prompt;
      if (c.response) entry.response = c.response;
      return entry;
    });
  }

  function cleanEntry(p: Prompt): any {
    const children = prompts.filter(c => c.pipeline_id === p.id);
    const entry: any = {};
    entry.type = p.type;
    if (p.skill) entry.skill = p.skill;
    if (p.prompt) entry.prompt = p.prompt;
    if (p.response) entry.response = p.response;
    if (p.status !== 'completed') entry.status = p.status;
    if (p.error) entry.error = p.error;
    const ctx = cleanContext(p.context as any[]);
    if (ctx) entry.context = ctx;
    if ((p as any).messages) entry.messages = (p as any).messages;
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
      <JsonTree data={data} defaultExpanded={2} />
    </div>
  );
}
