import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge, render, sourceId, type Agent, type Event } from '../src/index.ts';

function fixture() { const dir = mkdtempSync(join(tmpdir(), 'bridge-')); return { dir, bridge: new Bridge(dir, 'session_1'), clean: () => rmSync(dir, { recursive: true, force: true }) }; }
function event(id: string, agent: Agent, kind: Event['kind'] = 'assistant', content: unknown = id): Event { return { id, sessionId: 'session_1', agent, kind, at: '2026-01-01T00:00:00Z', content }; }

test('round trips deliver only unseen foreign events and retain full tool results', () => {
  const f = fixture(); try {
    const result = 'error details '.repeat(500);
    f.bridge.append(event('a', 'claude', 'tool_result', result));
    const first = f.bridge.prepare('codex'); assert.equal(first.events[0].content, result); assert.ok(render(first).includes(result));
    f.bridge.acknowledge('codex', first.id);
    f.bridge.append(event('b', 'codex')); const back = f.bridge.prepare('claude'); assert.deepEqual(back.events.map(x => x.id), ['b']); f.bridge.acknowledge('claude', back.id);
    f.bridge.append(event('c', 'claude')); const again = f.bridge.prepare('codex'); assert.deepEqual(again.events.map(x => x.id), ['c']);
  } finally { f.clean(); }
});

test('retry is stable and acknowledges only the prepared boundary', () => {
  const f = fixture(); try {
    f.bridge.append(event('a', 'claude')); const first = f.bridge.prepare('codex');
    f.bridge.append(event('b', 'claude')); assert.deepEqual(f.bridge.prepare('codex'), first);
    assert.throws(() => f.bridge.acknowledge('codex', 'wrong')); f.bridge.acknowledge('codex', first.id);
    assert.deepEqual(f.bridge.prepare('codex').events.map(x => x.id), ['b']);
  } finally { f.clean(); }
});

test('idempotent source events and damaged logs fail closed', () => {
  const f = fixture(); try {
    f.bridge.append(event('a', 'claude')); f.bridge.append(event('a', 'claude')); assert.equal(f.bridge.events().length, 1);
    assert.throws(() => f.bridge.append(event('a', 'codex'))); assert.equal(sourceId('a', 'b'), sourceId('a', 'b'));
    appendFileSync(join(f.dir, 'session_1', 'events.jsonl'), '{'); assert.throws(() => f.bridge.prepare('codex'));
  } finally { f.clean(); }
});
