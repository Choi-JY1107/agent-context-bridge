import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/index.ts';
import { importTranscript } from '../src/adapters.ts';

test('imports actual shaped records, full tool data, retries and an unfinished tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapters-'));
  try {
    const bridge = new Bridge(dir, 'session');
    const claude = join(dir, 'claude.jsonl');
    const records = [
      { type: 'user', message: { content: 'Original request' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'test' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'failure '.repeat(1000), is_error: true }] } },
    ];
    writeFileSync(claude, records.map(x => JSON.stringify(x)).join('\n') + '\n' + '{');
    assert.equal(importTranscript(bridge, 'claude', claude, 'session').incompleteTail, true);
    importTranscript(bridge, 'claude', claude, 'session');
    assert.equal(bridge.events().length, 3);
    const first = bridge.prepare('codex'); assert.equal(first.events.length, 3);
    assert.ok(JSON.stringify(first.events[2].content).includes('failure '.repeat(1000)));
    bridge.acknowledge('codex', first.id);
    const codex = join(dir, 'codex.jsonl');
    writeFileSync(codex, [
      { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'shell', input: 'run' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'result' } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
    importTranscript(bridge, 'codex', codex, 'session');
    const back = bridge.prepare('claude'); assert.deepEqual(back.events.map(x => x.kind), ['tool_call', 'tool_result']);
    bridge.acknowledge('claude', back.id);
    const newer = { type: 'assistant', message: { content: [{ type: 'text', text: 'Claude resumed' }] } };
    writeFileSync(claude, [...records, newer].map(x => JSON.stringify(x)).join('\n') + '\n');
    importTranscript(bridge, 'claude', claude, 'session');
    assert.equal(bridge.prepare('codex').events.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid completed record fails rather than skipping it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapters-'));
  try { const file = join(dir, 'bad'); writeFileSync(file, '{bad}\n'); assert.throws(() => importTranscript(new Bridge(dir, 's'), 'claude', file, 's'), /Invalid JSON/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
