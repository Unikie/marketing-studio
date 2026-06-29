import { useState } from 'react';

interface JsonTreeProps {
  data: unknown;
  defaultExpanded?: number;
}

export default function JsonTree({ data, defaultExpanded = 1 }: JsonTreeProps) {
  return (
    <pre className="json-tree">
      <JsonNode value={data} depth={0} defaultExpanded={defaultExpanded} />
    </pre>
  );
}

function JsonNode({ value, depth, defaultExpanded }: { value: unknown; depth: number; defaultExpanded: number }) {
  if (value === null) return <span className="json-null">null</span>;
  if (value === undefined) return <span className="json-null">undefined</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'string') {
    if (value.length > 80) {
      return <LongString value={value} />;
    }
    return <span className="json-string">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return <Collapsible open={true} openBracket="[" closeBracket="]" count={value.length}>
      {value.map((item, i) => (
        <div key={i} className="json-line">
          <JsonNode value={item} depth={depth + 1} defaultExpanded={defaultExpanded} />
          {i < value.length - 1 && ','}
        </div>
      ))}
    </Collapsible>;
  }
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue);
    if (entries.length === 0) return <span>{'{}'}</span>;
    return <Collapsible open={depth < defaultExpanded} openBracket="{" closeBracket="}" count={entries.length} summary={objectSummary(objectValue)}>
      {entries.map(([k, v], i) => (
        <div key={k} className="json-line">
          <span className="json-key">"{k}"</span>: <JsonNode value={v} depth={depth + 1} defaultExpanded={defaultExpanded} />
          {i < entries.length - 1 && ','}
        </div>
      ))}
    </Collapsible>;
  }
  return <span>{String(value)}</span>;
}

function objectSummary(value: Record<string, unknown>): string | undefined {
  const role = typeof value.role === 'string' ? value.role : undefined;
  const content = typeof value.content === 'string' ? value.content : undefined;
  if (role && content !== undefined) {
    const normalizedContent = content.replace(/\s+/g, ' ').trim();
    const shortened = normalizedContent.length > 44 ? `${normalizedContent.slice(0, 41)}...` : normalizedContent;
    return `${role}: "${shortened}"`;
  }

  const type = typeof value.type === 'string' ? value.type : undefined;
  const skill = typeof value.skill === 'string' ? value.skill : undefined;
  const prompt = typeof value.prompt === 'string' ? value.prompt : undefined;
  if (!type && !prompt) return undefined;

  const label = [type, skill ? `/${skill}` : undefined].filter(Boolean).join(' ');
  if (!prompt) return label || undefined;

  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
  const shortened = normalizedPrompt.length > 80 ? `${normalizedPrompt.slice(0, 77)}...` : normalizedPrompt;
  return `${label || 'prompt'}: "${shortened}"`;
}

function LongString({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!expanded) {
    return (
      <span>
        <span className="json-string">"{value.slice(0, 60)}…"</span>
        <span className="json-toggle" onClick={() => setExpanded(true)}> +{value.length}</span>
      </span>
    );
  }
  return (
    <span>
      <span className="json-toggle" onClick={() => setExpanded(false)}>- </span>
      <span className="json-string">"{value}"</span>
    </span>
  );
}

function Collapsible({ open, openBracket, closeBracket, count, summary, children }: { open: boolean; openBracket: string; closeBracket: string; count: number; summary?: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  if (!expanded) {
    return (
      <span>
        <span className="json-toggle" onClick={() => setExpanded(true)}>+</span> {openBracket} <span className="json-hint">{summary || count}</span> {closeBracket}
      </span>
    );
  }
  return (
    <span>
      <span className="json-toggle" onClick={() => setExpanded(false)}>-</span> {openBracket}
      <div style={{ paddingLeft: '1rem' }}>{children}</div>
      {closeBracket}
    </span>
  );
}
