# Agent Context Bridge

Continue a coding task across Claude Code and Codex while keeping a local record of the conversation and tool output.

## Requirements

Install Node.js 24 or later, Claude Code, and Codex. Sign in to both agents before starting.

## Install

```sh
git clone https://github.com/Choi-JY1107/agent-context-bridge.git
cd agent-context-bridge
npm install
```

Remember the absolute path to this directory. The examples below call it `<bridge>`.

## Start a conversation

Open a terminal in the project where the agent should work. Choose an absolute path for a private data directory and a session name:

```sh
node <bridge>/src/cli.ts run <private-store> task-1 auto "Inspect the failing test"
```

Replace `<bridge>` and `<private-store>` with real paths. Quote paths that contain spaces. The session name may contain letters, numbers, underscores, and hyphens.

## Continue with another agent

Use the same data directory, session name, and working directory for every turn:

```sh
node <bridge>/src/cli.ts run <private-store> task-1 codex "Continue the fix"
node <bridge>/src/cli.ts run <private-store> task-1 claude "Review the result"
```

Choose `claude` or `codex` explicitly, or use `auto` to try Claude first. Auto falls back to Codex on a usage limit only if Claude has not started a tool.

## What is transferred

The bridge imports supported messages, tool calls, tool results, and image attachments from each agent's local transcript. It sends unseen records when switching agents and resumes each agent's own session.

For long histories, the prompt contains a recent excerpt and a path to the complete local handoff file. Up to five supported images are attached per handoff.

## What stays private

The data directory contains unredacted conversations, images, and tool output. Keep it outside public repositories and restrict access to it.

## If a run fails

The handoff remains pending until a run completes successfully. If an agent accepted a prompt before failing, retrying may repeat work. Check its session before retrying.

## Manual handoff

To import an existing transcript and prepare a handoff without running an agent:

```sh
node <bridge>/src/cli.ts import <private-store> task-1 claude <transcript.jsonl>
node <bridge>/src/cli.ts prepare <private-store> task-1 codex > handoff.txt
node <bridge>/src/cli.ts ack <private-store> task-1 codex <batch-id>
```

The import report counts unsupported record types. `prepare` prints the batch ID to stderr. Send the handoff before acknowledging that ID; the output file contains private data.

## Limitations

Native session state, hidden reasoning, and some provider-specific records cannot be transferred. Imported records and image formats are limited to those supported by the adapters. Agents must be able to read the local handoff file when the excerpt is incomplete.

## Development

```sh
npm test
npm run check
```

## License

[MIT](LICENSE)
