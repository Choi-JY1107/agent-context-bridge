# Agent Context Bridge

A small TypeScript library for retaining shared conversation events and preparing incremental handoffs between Claude Code and Codex. It does not modify either agent's native session files or automatically intercept their streams.

## Requirements

Node.js 24 or later. Run `npm install`, `npm test`, and `npm run check`.

## Use

```ts
import { Bridge, render } from './src/index.ts';

const bridge = new Bridge('/private/agent-context', 'session_1');
bridge.append({ id: 'source_record_1', sessionId: 'session_1', agent: 'claude', kind: 'user', at: new Date().toISOString(), content: 'Fix the failing test' });
const batch = bridge.prepare('codex');
const prompt = render(batch);
// Send prompt to Codex using your application. Only after acceptance:
bridge.acknowledge('codex', batch.id);
```

Capture all user messages, assistant messages, tool calls and results in source order. Use a stable unique ID for each source record. Store full payloads in `content`; the bridge does not truncate them. Record attachments as references to durable private files or data managed by the host application. `render` includes references, not image bytes delivered as native image input.

Each target has its own cursor. `prepare` returns the same pending batch on retry. Acknowledging advances only that target through the prepared boundary, so events appended while sending remain for the next batch. A failed or uncertain delivery must not be acknowledged. Exactly once delivery is not guaranteed if the receiver accepted a batch but the acknowledgement was lost; integrations should deduplicate batch IDs.

## Boundaries

This is an integration library, not a CLI adapter. Your host must capture agent events and send the rendered handoff to the receiving process. Native agent state, hidden reasoning, permissions, and images are not transferred automatically. Long records can exceed a model's context window; hosts must implement a visible context budget, retrieval, and summarization policy. Do not call a handoff complete merely because it was prepared.

Transcripts may contain credentials and private source code. Keep the data directory private and outside version control. File permissions depend on the operating system. One writer operates at a time per session using a lock file; after a crash, remove a stale `.lock` only after confirming no writer is active. Avoid network filesystems. Back up the entire session directory consistently.

MIT license.
