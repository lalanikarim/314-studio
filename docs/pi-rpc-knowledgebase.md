# Pi RPC Integration Knowledge Base

## Overview

The Pi coding agent supports **RPC mode** – a headless, JSON‑line protocol that lets other applications talk to the coding agent via **stdin** (commands) and **stdout** (events). This knowledge base summarises the protocol, the CLI options, every command, message and event type, and the special Extension UI sub‑protocol that works over the RPC stream.

---

## 1. Starting RPC Mode

Run the agent in RPC mode:

```bash
pi --mode rpc [options]
```

### Common Options
| Option | Description |
|--------|--------------|
| `--provider <name>` | Choose LLM provider (`anthropic`, `openai`, `google`, etc.) |
| `--model <pattern|id>` | Model pattern or ID (e.g. `anthropic/claude-3.5-sonnet` or `openai/o3-mini`) |
| `--no-session` | Disable persisting a session (no session file will be written) |
| `--session-dir <path>` | Custom directory for session JSONL file |

---

## 2. Protocol Overview

- **Command stream**: Each JSON object ends with a line‑feed (`\n`). **Only LF is allowed** – `readline` on macOS or Windows may split on `U+2028`/`U+2029` and will corrupt the stream.
- **Response stream**: The agent writes JSON objects (one per line) to **stdout**. A normal response always contains a top‑level `"type": "response"`. If a request includes `"id"` the response repeats that ID.
- **Event stream**: While the agent is running, it emits **events** to stdout as JSON lines (no `type` field is required, the object itself is the stream entry). Events do **not** have an `id`.
- **Messaging**: `prompt`‑type commands return a short `"type":"response"` immediately; the full agent output later arrives as `event` objects (`message_start`, `message_update`, …).

### Input / Output Framing Rules
- Split incoming data on **newline (`\n`)** only.
- Accept optional `\r\n` by stripping a trailing `\r`.
- Never treat Unicode line separators as line breaks – they are legal inside JSON strings.
- **Do not** use generic line readers (e.g. `.NET StreamReader` without `Console.ReadLine` options) that may split on other separators.

---

## 3. Available Commands

All commands are JSON objects sent on the command stream. The command name is identified by the `"type"` field.

### 3.1 Prompting

| Command | Purpose | Example |
|---------|---------|---------|
| **prompt** | Send a user prompt to the agent (asynchronous). | ```json { "type":"prompt", "message":"What's the current time?", "ids": ["req-1"] } ``` |
| **steer** | Queue a steering message while the agent is running. Delivered after the current turn. | ```json { "type":"steer", "message":"Do a risk assessment." } ``` |
| **follow_up** | Queue a follow‑up message to be processed after the current turn finishes. | ```json { "type":"follow_up", "message":"Summarise the result." } ``` |

**Message structure** (used by all three):
```json
{
  "type": "prompt | steer | follow_up",
  "id":   "optional-id",
  "message": "User text",
  "images": [               // optional
    { "type":"image", "data":"base64‑data",   "mimeType":"image/png" }
  ],
  "streamingBehavior": "steer" // allowed only on prompt during streaming
}
```

**Response after command (e.g. prompt)**:
```json
{
  "type":"response",
  "id":"req-1",
  "command":"prompt",
  "success":true
}
```

### 3.2 Core Commands

| Command | What it does | Example |
|---------|--------------|---------|
| **abort** | Abort the current operation. | `{ "type":"abort" }` |
| **new_session** | Starts a fresh session (optionally linking to a parent). | `{ "type":"new_session", "parentSession":"/path/parent.jsonl" }` |
| **set_model** | Switch to another model (`provider` + `modelId`). | `{ "type":"set_model", "provider":"anthropic", "modelId":"claude-sonnet-4-20250514" }` |
| **cycle_model** | Cycle to next model (returns `null` data if only one). | `{ "type":"cycle_model" }` |
| **get_available_models** | Lists all configured model objects. | `{ "type":"get_available_models" }` |
| **set_thinking_level** | Set `off|minimal|low|medium|high|xhigh`. | `{ "type":"set_thinking_level", "level":"high" }` |
| **cycle_thinking_level** | Cycle thinking levels. | `{ "type":"cycle_thinking_level" }` |

### 3.3 State Queries

| Command | Returns | Example |
|---------|---------|---------|
| **get_state** | Full session state (model, thinking level, steering mode, etc.) | `{ "type":"get_state" }` |
| **get_messages** | All messages in the conversation. | `{ "type":"get_messages" }` |
| **get_session_stats** | Token usage, cost, context window. | `{ "type":"get_session_stats" }` |
| **get_commands** | Enum of built‑in, extension, and prompt‑template commands. | `{ "type":"get_commands" }` |

### 3.4 Compaction

| Command | Purpose | Example |
|---------|---------|---------|
| **compact** | Manually compact conversation (reduces token usage). | `{ "type":"compact", "customInstructions":"Focus on code changes" }` |
| **set_auto_compaction** | Enable/disable automatic compaction when the context is almost full. | `{ "type":"set_auto_compaction", "enabled":true }` |

### 3.5 Retry

| Command | Purpose |
|---------|---------|
| **set_auto_retry** | Turn on/off automatic retry after 5xx, rate‑limit, overloaded errors. |
| **abort_retry** | Cancel an in‑progress retry. |

### 3.6 Bash Integration

| Command | What it does |
|---------|--------------|
| **bash** | Execute a shell command, make its output available for the *next* prompt. Returns `output`, `exitCode`, and `truncated` (if the log file is written to disk). |
| **abort_bash** | Abort a currently running Bash command. |

**Response for `bash`**:
```json
{
  "type":"response",
  "command":"bash",
  "success":true,
  "data":{
    "output":"total 48\n…",
    "exitCode":0,
    "cancelled":false,
    "truncated":false
  }
}
```

If truncated, a `fullOutputPath` field points to the temporary log file that contains the complete output.

---

## 4. Session Management

| Command | Description |
|---------|-------------|
| **export_html** | Dump the whole session into an HTML file (optional path). |
| **switch_session** | Load a different session file (can be cancelled by a `session_before_switch` extension). |
| **fork** | Create a new fork from a particular entry (`entryId`). Returns the forked prompt text. |
| **get_fork_messages** | List all messages that can be used for a fork operation. |
| **get_last_assistant_text** | Returns the text of the most recent assistant message (or `null`). |
| **set_session_name** | Give the current session a display name. |

All session actions persist to a JSONL file at the path configured in the session. The path is exposed via `get_state.sessionFile`.

---

## 5. Model & Thinking

* **Model**: A JSON object that contains provider name, model ID, capabilities, and other metadata. It can be retrieved via `get_available_models` and used to construct tool‑call arguments.
* **Thinking**: Advanced reasoning modes that certain models support. Use `set_thinking_level` and `cycle_thinking_level`.

---

## 6. Queue Modes

Two independent modes control the behavior of `steer` and `follow_up` messages:

| Setting | Options | Behaviour |
|---------|---------|-----------|
| **steeringMode** | `all` (all at once) or `one-at-a-time` (default) | When a `steer` arrives, the agent may deliver it immediately after the current assistant turn. |
| **followUpMode** | `all` (batch) or `one-at-a-time` (default) | When a `follow_up` arrives, it will be processed at the first upcoming turn end. |

Set via:
```json
{ "type":"set_steering_mode", "mode":"one-at-a-time" }
{ "type":"set_follow_up_mode", "mode":"one-at-a-time" }
```

---

## 7. Compaction Details

* **Manual compaction** (`compact`) can include `customInstructions` to guide the summariser.
* **Automatic compaction** (when enabled via `set_auto_compaction`) triggers on a *threshold* (default 80% of context) or on direct overflow.
* Events: `compaction_start` → one or more `tool_execution_*` events → `compaction_end`. The `compaction_end` event contains a `summary`, `firstKeptEntryId`, `tokensBefore`, and flags `aborted` / `willRetry`.

---

## 8. Auto‑Retry Details

* Enabled with `set_auto_retry`. Retries only on transient errors (timeout, 5xx, rate‑limit).
* Each retry emits `auto_retry_start` (with counters, delay, error message) and `auto_retry_end` (with `success` flag). If the final attempt fails, `finalError` is present.

---

## 9. Events – What the Client Receives

While the agent works, events stream to **stdout** as JSON lines. The most important ones for a consuming UI:

| Event | Payload summary |
|-------|-----------------|
| `agent_start` | Agent has begun a new prompt. |
| `agent_end` | Agent finished; contains all `messages` and `toolResults`. |
| `turn_start` / `turn_end` | Marks the beginning and end of a turn (assistant + tool calls). |
| `message_start` / `message_end` | Marks when a message (assistant or tool) begins and ends. |
| `message_update` | Sent each time a message is streamed (text, thinking, tool results). For assistant messages it also contains an `assistantMessageEvent` sub‑object showing the detailed delta (`text_delta`, `thinking_delta`, `toolcall_*`, `done`, `error`). |
| `tool_execution_*` | Progress of a tool execution (`start`, `update`, `end`). Provides `toolCallId` to match updates to a specific request. |
| `queue_update` | The current steering/follow‑up queues after any change. |
| `compaction_*` / `auto_retry_*` / `extension_error` | Self‑explanatory per the tables above. |

**Important**: Events do **not** have an `id` and are not guaranteed to be received in the exact order they were emitted – the agent preserves order, but network transport can reorder packets; the client **must not** rely on relative ordering between different types of events.

---

## 10. Extension UI Sub‑Protocol (RPC Mode)

Extensions that need interactive input (e.g. a command that asks “Do you want to continue?”) use a secondary request/response channel **over the same stdio streams**.

### Requests (sent by the agent to stdout)
All Extension UI requests start with:
```json
{
  "type": "extension_ui_request",
  "id": "a-unique-uuid",
  "method": "select" | "confirm" | "input" | "editor" | "setStatus" | ...
}
```
Each request also contains a `title`, `options`, `placeholder`, etc. The request must be immediately followed (on the same line stream) by a **response** to the same `id`.

### Responses (sent by the client to stdin)
The client replies with a matching line:
```json
{
  "type": "extension_ui_response",
  "id": "the‑same‑uuid-as‑request",
  "value": "selected‑option",
  "cancelled": false
}
```
If the request included a `timeout`, and the client does not respond in time, the agent automatically replies with a default (often `undefined` or “timeout”).

### Supported Methods
| Method | Description |
|--------|-------------|
| `select` | Drop‑down list; receives `options` `[string]`, optional `hint`, `selected` pre‑set. |
| `confirm` | Yes/No prompt. |
| `input` | Free‑form text field. |
| `editor` | Full‑screen editor (the agent sends a temporary file path; client may edit and save). |
| `setStatus`, `setTitle`, `setFooter`, `setHeader` | Fire‑and‑forget UI updates (no response expected). |
| `setWidget`, `setEditorComponent`, `setToolsExpanded` | Fire‑and‑forget (mostly no‑ops in RPC). |
| `notify` | Message display. |
| `set_editor_text` | Replace editor text. |

> **Limitation** – The TUI UI (`ctx.ui.setStatus`, `setHeader`, etc.) is degraded: some properties are `undefined`, `setWorkingMessage` does nothing, `pasteToEditor` just writes text, `getAllThemes` returns an empty array, etc. The `hasUI` flag is `true`.

---

## 11. Commands Overview (Invokable via the `prompt` command)

Extension‑provided commands can be invoked with the command name prefixed by `/`. Example: `/fix-tests` will execute a prompt template; `/skill:brave-search` runs a skill.

You can query them with:
```json
{ "type":"get_commands" }
```

Typical response (trimmed):

```json
{
  "type":"response",
  "command":"get_commands",
  "data":{
    "commands":[
      {
        "name":"session-name",
        "description":"Set or clear session name",
        "source":"extension",
        "path":"/home/karim/.pi/agent/extensions/session.ts"
      },
      {
        "name":"fix-tests",
        "description":"Fix failing tests",
        "source":"prompt",
        "location":"project",
        "path":"/Users/karim/Projects/ocproject/remote-pi/web-pi/.pi/agent/prompts/fix-tests.md"
      },
      {
        "name":"skill:brave-search",
        "description":"Web search via Brave API",
        "source":"skill",
        "location":"user",
        "path":"/home/karim/.pi/agent/skills/brave-search/SKILL.md"
      }
    ]
  }
}
```

The `name` is the identifier you send in a `prompt` command:
```json
{ "type":"prompt", "message":"/session-name my-work" }
```

The agent expands the command, merges it into the conversation, and processes it.

---

## 12. Best Practices for Integration

1. **Line‑feed only** – In any language, read `stdin` as raw bytes, split on `\n`. Avoid buffered readers that split on `\r\n` *and* Unicode separators.
2. **Maintain a single “id”** for each request you need to match later (e.g., enable logging of `id` values). The response includes the same `id`.
3. **Consume events asynchronously** – Do not block on the *prompt* command waiting for events; set up a line reader and push each event to your UI/logger.
4. **Handle throttling** – If you send commands faster than the agent can process, you may receive `"error": "too many pending commands"` (specific error name not documented here – check agent logs). Use the `auto_retry` mechanism or manually `abort_retry`.
5. **Bash command output truncation** – The agent writes the full output to a temporary file when truncated. Capture `fullOutputPath` if you need the complete dump; you can read the file yourself.
6. **Extension UI** – Your UI (e.g., a web front‑end, a VS Code extension, a desktop UI) must have a thread listening on `stdin` for UI responses and reading `stdout` for events. The UI does **not** send prompt messages directly on the command stream (those must be wrapped as normal `prompt` commands).
7. **Session persistence** – When you want to save state for later sessions, call `new_session` with `parentSession` or persist the JSONL file manually. Use `set_session_name` for easy identification.

---

## 13. Reference – Quick Command Cheat‑Sheet (JSON one‑liners)

You can copy‑paste these into a test harness.

| Command | One‑liner (curl‑like) |
|---------|----------------------|
| Prompt a message | `{"type":"prompt","message":"Explain the difference between var, let and const","id":"req-01"}` |
| Steer after a turn | `{"type":"steer","message":"Assume we are now debugging a production bug"} ` |
| Bypass abort in a turn | `{"type":"abort"}` |
| Get list of models | `{"type":"get_available_models"}` |
| Cycle to next model | `{"type":"cycle_model"}` |
| Compact manually | `{"type":"compact","customInstructions":"Highlight only code changes"}` |
| Run bash (limited output) | `{"type":"bash","command":"git status"}` |
| Export session to HTML | `{"type":"export_html","outputPath":"/tmp/piSession.html"}` |
| Switch session to a file | `{"type":"switch_session","sessionPath":"/tmp/oldSession.jsonl"}` |

---

## 14. Further Reading

* The full source code for RPC mode is under `src/modes/rpc/` in the Pi coding‑agent repository.
* See `src/modes/rpc/rpc-client.ts` for a TypeScript client that already implements the framing rules.
* The `src/core/agent-session.ts` holds the API for *direct* (non‑process) usage in a Node.js application.

---

*End of knowledge‑base.*