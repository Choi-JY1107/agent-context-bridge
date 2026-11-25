import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDelivery } from '../src/delivery.ts';
import { normalize } from '../src/adapters.ts';
import type { Batch, Event } from '../src/index.ts';

test('bounded handoff keeps full original and exports an image', () => {
 const root = mkdtempSync(join(tmpdir(), 'delivery-'));
 try {
  const events: Event[] = [
   { id:'a', sessionId:'s', agent:'claude', kind:'tool_result', at:'now', content:'x'.repeat(5000) },
   { id:'b', sessionId:'s', agent:'claude', kind:'attachment', at:'now', content:{ type:'image', source:{ type:'base64', media_type:'image/png', data:Buffer.from('image').toString('base64') } } },
   { id:'c', sessionId:'s', agent:'claude', kind:'assistant', at:'now', content:'latest' },
  ];
  const batch: Batch = { id:'batch', sessionId:'s', target:'codex', through:3, events };
  const result = buildDelivery(batch, root, 'continue', 2000);
  assert.equal(result.omitted, 1); assert.ok(result.prompt.includes('latest')); assert.ok(result.prompt.endsWith('continue'));
  assert.deepEqual(JSON.parse(readFileSync(result.archive, 'utf8')), batch);
  assert.equal(readFileSync(result.images[0], 'utf8'), 'image');
 } finally { rmSync(root, {recursive:true, force:true}); }
});

test('import removes previously injected handoff from the user message', () => {
 const text = '[agent-context-bridge:handoff]\nprevious\n[/agent-context-bridge:handoff]\nactual user request';
 const result = normalize('claude', {type:'user',message:{content:text}}, 's', 'source', '0');
 assert.equal(result?.[0].content, 'actual user request');
});
