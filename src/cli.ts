#!/usr/bin/env node
import { Bridge, render, type Agent } from './index.ts';
import { importTranscript } from './adapters.ts';
import { runAuto, runTurn } from './runner.ts';

const usage = `Usage:
  node src/cli.ts run <store> <session> <auto|claude|codex> <prompt>
  node src/cli.ts import <store> <session> <claude|codex> <transcript.jsonl>
  node src/cli.ts prepare <store> <session> <claude|codex>
  node src/cli.ts ack <store> <session> <claude|codex> <batch-id>

Prepare prints the batch ID to stderr and the handoff to stdout. Save the ID and acknowledge only after the target accepted it.`;
const [command, root, session, rawAgent, argument] = process.argv.slice(2);
try {
  if (!root || !session || (rawAgent !== 'claude' && rawAgent !== 'codex' && !(command === 'run' && rawAgent === 'auto')) || !['run', 'import', 'prepare', 'ack'].includes(command ?? '')) throw new Error(usage);
  const agent: Agent = rawAgent === 'auto' ? 'claude' : rawAgent as Agent;
  const bridge = new Bridge(root, session);
  if (command === 'run') {
    if (!argument) throw new Error(usage);
    const opts = { root, session, text: argument, onOutput: (chunk: string) => process.stdout.write(chunk) };
    const result = rawAgent === 'auto' ? await runAuto(opts) : await runTurn({ ...opts, agent });
    process.stderr.write(`Completed: ${result.sessionId}, archived events: ${result.omitted}\n`);
  } else if (command === 'import') {
    if (!argument) throw new Error(usage);
    process.stdout.write(JSON.stringify(importTranscript(bridge, agent, argument, session), null, 2) + '\n');
  } else if (command === 'prepare') {
    const batch = bridge.prepare(agent);
    process.stderr.write(`Batch: ${batch.id} (${batch.events.length} events)\n`);
    process.stdout.write(render(batch) + '\n');
  } else {
    if (!argument) throw new Error(usage);
    bridge.acknowledge(agent, argument);
    process.stdout.write('Acknowledged.\n');
  }
} catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
