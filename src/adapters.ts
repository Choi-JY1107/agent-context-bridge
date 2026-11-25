import { readFileSync, realpathSync } from 'node:fs';
import { Bridge, sourceId, type Agent, type Event, type Kind } from './index.ts';

type ObjectRecord = Record<string, unknown>;
const object = (x: unknown): x is ObjectRecord => typeof x === 'object' && x !== null && !Array.isArray(x);

const START = '[agent-context-bridge:handoff]';
const END = '[/agent-context-bridge:handoff]';
function stripHandoff(text: string): string {
  if (!text.startsWith(START)) return text;
  const end = text.indexOf(END);
  return end < 0 ? text : text.slice(end + END.length).trimStart();
}

/** Convert a source record without reducing tool inputs or outputs. Unknown records are reported. */
export function normalize(agent: Agent, record: unknown, sessionId: string, source: string, position: string): Event[] | null {
  if (!object(record)) return null;
  const at = typeof record.timestamp === 'string' ? record.timestamp : '1970-01-01T00:00:00.000Z';
  const make = (kind: Kind, content: unknown, part: number): Event => ({ id: sourceId(source, `${position}:${part}`), sessionId, agent, kind, at, content });
  if (agent === 'claude') {
    if (record.isSidechain === true || record.isMeta === true) return [];
    if (record.isCompactSummary === true && object(record.message)) return [make('notice', { type: 'compact_summary', content: record.message.content }, 0)];
    if (record.type !== 'user' && record.type !== 'assistant') {
      if (record.type === 'system' && record.subtype === 'compact_boundary') return [make('notice', record, 0)];
      return null;
    }
    if (!object(record.message)) return null;
    const content = record.message.content;
    if (typeof content === 'string') return [make(record.type, stripHandoff(content), 0)];
    if (!Array.isArray(content)) return null;
    const injected = content.some((block: unknown) => object(block) && typeof block.text === 'string' && block.text.startsWith(START));
    return content.flatMap((block, index) => {
      if (!object(block) || typeof block.type !== 'string') return [];
      if (block.type === 'text') return [make(record.type as Kind, { ...block, text: typeof block.text === 'string' ? stripHandoff(block.text) : block.text }, index)];
      if (block.type === 'tool_use') return [make('tool_call', block, index)];
      if (block.type === 'tool_result') return [make('tool_result', block, index)];
      if (block.type === 'image' || block.type === 'document') return injected ? [] : [make('attachment', block, index)];
      return [];
    });
  }
  if (record.type !== 'response_item' || !object(record.payload)) return null;
  const payload = record.payload;
  if (payload.type === 'message') {
    if (payload.role !== 'user' && payload.role !== 'assistant') return [];
    const injected = Array.isArray(payload.content) && payload.content.some((block: unknown) => object(block) && typeof block.text === 'string' && block.text.startsWith(START));
    const blocks = Array.isArray(payload.content) ? payload.content.map((block: unknown) => object(block) && typeof block.text === 'string' ? { ...block, text: stripHandoff(block.text) } : block) : payload.content;
    const images = !injected && Array.isArray(blocks) ? blocks.flatMap((block: unknown, index: number) => {
      if (!object(block) || block.type !== 'input_image' || typeof block.image_url !== 'string') return [];
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s.exec(block.image_url);
      return match ? [make('attachment', { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }, index + 1)] : [];
    }) : [];
    return [make(payload.role, { ...payload, content: blocks }, 0), ...images];
  }
  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') return [make('tool_call', payload, 0)];
  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') return [make('tool_result', payload, 0)];
  return null;
}

export interface ImportReport { lines: number; events: number; unsupported: Record<string, number>; incompleteTail: boolean; }
/** A stable source path and byte offset make repeated imports idempotent. */
export function importTranscript(bridge: Bridge, agent: Agent, file: string, sessionId: string): ImportReport {
  const source = `${agent}:${realpathSync(file)}`;
  const input = readFileSync(file);
  const report: ImportReport = { lines: 0, events: 0, unsupported: {}, incompleteTail: false };
  const pending: Event[] = [];
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== 10) continue;
    const line = input.subarray(start, i).toString('utf8').trim();
    const position = String(start); start = i + 1;
    if (!line) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`Invalid JSON at byte ${position}`); }
    const events = normalize(agent, raw, sessionId, source, position);
    report.lines++;
    if (events === null) {
      const type = object(raw) && typeof raw.type === 'string' ? raw.type : 'unknown';
      report.unsupported[type] = (report.unsupported[type] ?? 0) + 1;
    } else for (const event of events) { pending.push(event); report.events++; }
  }
  bridge.appendMany(pending);
  report.incompleteTail = start < input.length;
  return report;
}
