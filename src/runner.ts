import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Bridge, type Agent } from './index.ts';
import { importTranscript } from './adapters.ts';
import { buildDelivery } from './delivery.ts';

type Sessions = { claude?: string; codex?: string; cwd?: string };
export interface RunOptions { root: string; session: string; agent: Agent; text: string; cwd?: string; claudePath?: string; codexPath?: string; onOutput?: (chunk: string) => void; }
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
function findCodex(dir: string, id: string): string | null {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { const found = findCodex(file, id); if (found) return found; }
    else if (entry.name.endsWith(`${id}.jsonl`)) return file;
  }
  return null;
}
function source(agent: Agent, id: string, cwd: string): string | null {
  if (agent === 'claude') {
    const file = join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    return existsSync(file) ? file : null;
  }
  return findCodex(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'), id);
}
function save(file: string, value: Sessions): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}

export class TurnError extends Error {
  readonly limit: boolean;
  readonly toolStarted: boolean;
  constructor(message: string, limit: boolean, toolStarted: boolean) { super(message); this.limit = limit; this.toolStarted = toolStarted; }
}

export const canFallback = (error: unknown): boolean => error instanceof TurnError && error.limit && !error.toolStarted;

/** Retry with Codex only for a Claude limit error before any tool was started. */
export async function runAuto(options: Omit<RunOptions, 'agent'>): Promise<{ sessionId: string; omitted: number; agent: Agent }> {
  try { return { ...await runTurn({ ...options, agent: 'claude' }), agent: 'claude' }; }
  catch (error) {
    if (!canFallback(error)) throw error;
    return { ...await runTurn({ ...options, agent: 'codex' }), agent: 'codex' };
  }
}

/** Run one turn, synchronizing local transcripts and acknowledging only successful runs. */
export async function runTurn(options: RunOptions): Promise<{ sessionId: string; omitted: number }> {
  // Validate the session ID before making any filesystem changes.
  new Bridge(options.root, options.session);
  const lock = join(resolve(options.root, options.session), '.run-lock');
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw new Error('A turn is already running or a stale run lock exists'); }
  try { return await runUnlocked(options); } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

async function runUnlocked(options: RunOptions): Promise<{ sessionId: string; omitted: number }> {
  const { agent, session, text } = options;
  if (!text.trim()) throw new Error('Prompt is empty');
  const cwd = resolve(options.cwd ?? process.cwd());
  const bridge = new Bridge(options.root, session);
  const dir = resolve(options.root, session); mkdirSync(dir, { recursive: true });
  const metaFile = join(dir, 'sessions.json');
  const meta: Sessions = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) as Sessions : {};
  if (meta.cwd && meta.cwd !== cwd) throw new Error(`Session belongs to another working directory: ${meta.cwd}`);
  meta.cwd = cwd;
  // Import both sides before every turn. This also recovers the previous run after restart.
  for (const side of ['claude', 'codex'] as const) {
    const id = meta[side]; if (!id) continue;
    const file = source(side, id, cwd);
    if (!file) throw new Error(`Cannot locate ${side} transcript for session ${id}`);
    importTranscript(bridge, side, file, session);
  }
  bridge.refresh(agent);
  const batch = bridge.prepare(agent);
  const delivery = buildDelivery(batch, options.root, text);
  const old = meta[agent];
  const windows = process.platform === 'win32';
  const codexPath = options.codexPath ?? (windows ? join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js') : 'codex');
  const claudePath = options.claudePath ?? (windows ? join(homedir(), '.local', 'bin', 'claude.exe') : 'claude');
  const codexArgs = ['exec', ...(old ? ['resume'] : []), '--json', '--skip-git-repo-check', ...delivery.images.map(file => `--image=${file}`), ...(old ? [old] : []), '-'];
  const isJs = codexPath.endsWith('.js');
  const executable = agent === 'claude' ? claudePath : isJs ? process.execPath : codexPath;
  const args = agent === 'claude'
    ? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...(old ? ['--resume', old] : [])]
    : [...(isJs ? [codexPath] : []), ...codexArgs];
  const imageBlocks = delivery.images.map(file => {
    const ext = file.split('.').at(-1); const media = ext === 'jpg' ? 'jpeg' : ext;
    return { type: 'image', source: { type: 'base64', media_type: `image/${media}`, data: readFileSync(file).toString('base64') } };
  });
  const input = agent === 'claude' ? JSON.stringify({ type: 'user', message: { role: 'user', content: [...imageBlocks, { type: 'text', text: delivery.prompt }] } }) + '\n' : delivery.prompt;
  const result = await new Promise<{ code: number | null; events: Record<string, unknown>[]; stderr: string }>((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
    let buffer = ''; let stderr = ''; const events: Record<string, unknown>[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8'); options.onOutput?.(text); buffer += text;
      let at: number; while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        try { const value: unknown = JSON.parse(line); if (obj(value)) events.push(value); } catch { /* non JSON output */ }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
    child.on('error', reject); child.on('close', code => resolveRun({ code, events, stderr }));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
  let id = old;
  for (const event of result.events) {
    if (agent === 'codex' && event.type === 'thread.started' && typeof event.thread_id === 'string') id = event.thread_id;
    if (agent === 'claude' && typeof event.session_id === 'string') id = event.session_id;
  }
  if (id) { meta[agent] = id; save(metaFile, meta); }
  const success = agent === 'codex'
    ? result.events.some(e => e.type === 'turn.completed') && !result.events.some(e => e.type === 'turn.failed')
    : result.events.some(e => e.type === 'result' && e.is_error !== true);
  if (result.code !== 0 || !success || !id) {
    const errors = result.events.filter(e => e.is_error === true || e.isApiErrorMessage === true || e.error);
    const details = `${result.stderr} ${JSON.stringify(errors)}`;
    const limit = agent === 'claude' && /usage[ _-]limit|hit your (?:(?:usage|\d+[- ]hour|weekly) )?limit|limit (?:reached|exceeded)|rate[ _-]?limit|out of (?:extra )?usage|\b429\b/i.test(details);
    const toolStarted = result.events.some(e => e.type === 'assistant' && obj(e.message) && Array.isArray(e.message.content) && e.message.content.some((b: unknown) => obj(b) && b.type === 'tool_use'));
    throw new TurnError(`${agent} did not complete successfully (exit ${result.code}): ${result.stderr}`, limit, toolStarted);
  }
  const transcript = source(agent, id, cwd);
  if (!transcript) throw new Error(`Cannot locate ${agent} transcript after run; batch remains pending`);
  // If import fails, retain the pending batch so an uncertain delivery is not lost.
  importTranscript(bridge, agent, transcript, session);
  bridge.acknowledge(agent, batch.id);
  return { sessionId: id, omitted: delivery.omitted };
}
