import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/runner.ts';
import { Bridge } from '../src/index.ts';

test('successful agent turn imports output and acknowledges handoff', async () => {
 const root = mkdtempSync(join(tmpdir(), 'run-test-')); const previous = process.env.CODEX_HOME;
 try {
  process.env.CODEX_HOME = join(root, 'codex');
  const fake = join(root, 'fake.cjs');
  writeFileSync(fake, `const fs=require('node:fs'),path=require('node:path'); const d=path.join(process.env.CODEX_HOME,'sessions');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'rollout-thread1.jsonl'),JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'done'}]}})+String.fromCharCode(10));process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'thread1'}));console.log(JSON.stringify({type:'turn.completed'}));});`);
  // Explicit .js is treated as a Node entry point by the runner.
  const fakeJs = join(root, 'fake.js'); writeFileSync(fakeJs, readFileSyncText(fake));
  const bridge = new Bridge(root, 'session');
  bridge.append({id:'before',sessionId:'session',agent:'claude',kind:'user',at:'now',content:'start'});
  const output = await runTurn({root,session:'session',agent:'codex',text:'continue',codexPath:fakeJs,cwd:root});
  assert.equal(output.sessionId,'thread1');
  assert.equal(bridge.prepare('codex').events.length,0);
  assert.equal(bridge.prepare('claude').events.length,1);
 } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME=previous; rmSync(root,{recursive:true,force:true}); }
});
function readFileSyncText(file: string): string { return readFileSync(file,'utf8'); }
import { readFileSync } from 'node:fs';
