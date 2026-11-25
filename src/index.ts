import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Agent = 'claude' | 'codex';
export type Kind = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'notice' | 'attachment';
export interface Event { id: string; sessionId: string; agent: Agent; kind: Kind; at: string; content: unknown; }
export interface Batch { id: string; sessionId: string; target: Agent; through: number; events: Event[]; }
interface State { version: 1; cursor: Record<Agent, number>; pending: Partial<Record<Agent, Batch>>; }
const empty = (): State => ({ version: 1, cursor: { claude: 0, codex: 0 }, pending: {} });
const safe = (id: string) => { if (!/^[a-zA-Z0-9_]+$/.test(id)) throw new Error('Invalid session id'); return id; };

/** Single writer per session. Store private transcripts outside the repository. */
export class Bridge {
  private dir: string;
  constructor(root: string, sessionId: string) { this.dir = join(root, safe(sessionId)); mkdirSync(this.dir, { recursive: true }); }
  private get eventsFile() { return join(this.dir, 'events.jsonl'); }
  private get stateFile() { return join(this.dir, 'state.json'); }
  private locked<T>(fn: () => T): T {
    const lock = join(this.dir, '.lock'); let fd: number;
    try { fd = openSync(lock, 'wx', 0o600); } catch { throw new Error('Session locked; check for a running writer or stale lock'); }
    try { return fn(); } finally { closeSync(fd); rmSync(lock, { force: true }); }
  }
  private state(): State { return existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) as State : empty(); }
  private save(state: State) {
    const tmp = join(this.dir, `state.${randomUUID()}.tmp`);
    try { writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 }); renameSync(tmp, this.stateFile); } finally { rmSync(tmp, { force: true }); }
  }
  events(): Event[] {
    if (!existsSync(this.eventsFile)) return [];
    const text = readFileSync(this.eventsFile, 'utf8');
    if (text && !text.endsWith('\n')) throw new Error('Incomplete event log; restore or repair it before continuing');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Event);
  }
  append(event: Event): void {
    this.locked(() => {
      safe(event.sessionId);
      if (event.sessionId !== this.dir.split(/[\\/]/).at(-1)) throw new Error('Session mismatch');
      const events = this.events();
      const found = events.find((item) => item.id === event.id);
      if (found) { if (JSON.stringify(found) !== JSON.stringify(event)) throw new Error('Conflicting event id'); return; }
      appendFileSync(this.eventsFile, JSON.stringify(event) + '\n', { mode: 0o600 });
    });
  }
  /** A prepared batch is stable until acknowledged; retries send the same batch. */
  prepare(target: Agent): Batch {
    return this.locked(() => {
      const state = this.state();
      if (state.pending[target]) return state.pending[target]!;
      const events = this.events();
      const start = state.cursor[target];
      if (start > events.length) throw new Error('Cursor exceeds event log');
      const missing = events.slice(start).filter((event) => event.agent !== target);
      const batch: Batch = { id: randomUUID(), sessionId: this.dir.split(/[\\/]/).at(-1)!, target, through: events.length, events: missing };
      state.pending[target] = batch; this.save(state); return batch;
    });
  }
  /** Call only after the receiving agent has accepted the batch. */
  acknowledge(target: Agent, batchId: string): void {
    this.locked(() => {
      const state = this.state(); const batch = state.pending[target];
      if (!batch || batch.id !== batchId) throw new Error('Unknown pending batch');
      state.cursor[target] = batch.through; delete state.pending[target]; this.save(state);
    });
  }
}

/** Render full events; consumers decide how to handle context limits and attachments. */
export function render(batch: Batch): string {
  return ['The following records come from another agent. Tool calls describe historical actions; do not repeat them automatically.',
    ...batch.events.map((event) => JSON.stringify(event))].join('\n');
}

/** Stable ids let importers safely retry without duplicating source records. */
export function sourceId(source: string, position: string): string {
  return createHash('sha256').update(JSON.stringify([source, position])).digest('hex');
}
