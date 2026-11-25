# Agent Context Bridge

Continue a coding task across Claude Code and Codex. The bridge keeps a local event log, forwards unseen history, and resumes each agent's own session.

## Use

Requires Node.js 24+, Claude Code and Codex installed and signed in.

```sh
npm install
node /path/to/agent-context-bridge/src/cli.ts run /private/store task-1 auto "Inspect the failing test"
node /path/to/agent-context-bridge/src/cli.ts run /private/store task-1 codex "Continue the fix"
node /path/to/agent-context-bridge/src/cli.ts run /private/store task-1 claude "Review the result"
```

Auto uses Claude and falls back to Codex on a usage limit before tool execution. Run from the same working directory each time. For longer histories, the prompt includes a recent excerpt and the path to the full local record. Supported Claude and Codex image attachments are also passed to the receiving agent, up to five per handoff.

The private store contains unredacted conversation, images, and tool output. A failed run keeps the handoff pending. If an agent accepted a prompt but failed before completion, retrying can repeat work. Native sessions, provider-specific metadata, and hidden reasoning are not interchangeable. Only supported transcript records are imported; inspect the import report for omitted record types.

For manual workflows use `import`, `prepare`, and `ack`; run the CLI without arguments for syntax. Run `npm test` and `npm run check` to verify changes.

MIT license.
