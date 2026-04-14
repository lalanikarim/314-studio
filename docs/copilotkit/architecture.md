# Architecture & Core Concepts

CopilotKit is an **agentic application platform** that unifies the runtime, UI, storage, and plugins into a coherent ecosystem.

## High‑Level Diagram (textual)
```
+-------------------+      +--------------------+
|   Client (Web UI) | <--> |  CopilotKit Server |
+-------------------+      +--------------------+
         ^                          ^
         |                          |
         |   JSON‑API (REST)        |
         v                          v
+-------------------+      +--------------------+
|   Agent Runtime   | <--> |   Storage Layer   |
+-------------------+      +--------------------+
         ^                          ^
         |                          |
   Plugins/Providers          Database (Postgres/Redis)
```
- **Client**: React/Next.js UI or native UI that sends requests to the CopilotKit server.
- **CopilotKit Server**: Provides the core runtime for agents, manages API keys, sessions, and routing.
- **Agent Runtime**: Executes agents (LLM calls, tools, logic) in isolated processes.
- **Storage Layer**: Centralized state (conversation history, user sessions) backed by Postgres + Redis.

## Core Components

### 1. Agents
- Defined as a set of **actions** (functions), **tools**, and **personas**.
- Each agent runs in its own sandbox; execution is deterministic and traceable.
- Agent state persists automatically; agents can emit events (messages, logs).

### 2. Runtime Engine
- Stateless HTTP layer authenticates requests via JWT.
- `post` endpoint parses messages, looks up the appropriate agent, runs it, and returns the response.
- Built‑in **rate limiting**, **circuit breakers**, and **caching**.

### 3. Plugins
- Extend the runtime with **LLM providers**, **vector stores**, or **auth providers**.
- Plugins register via a `manifest.json` with hooks like `onInitialize`, `onBeforeRun`.

### 4. UI
- The `@copilotkit/ui` package supplies pre‑built React components:
  - `copilot-chat` – scrollable chat with agent selection.
  - `copilot-console` – raw command line interface.
- UI talks to the server using the **CopilotKit SDK**.

### 5. Storage & State
- **Conversation History**: Stored in Postgres for persistence; optionally cached in Redis for low latency.
- **Metadata**: Agent run metadata, logs, and metrics stored in dedicated tables.
- **Encrypted Secrets**: LLM API keys stored encrypted with a master key.

## Key Patterns

### Inline Agent Calls
```ts
await cot.run()
```
- The client directly calls the server, passing `agentId`, `messages`, and optional parameters.
- The server returns a structured response: `{ response: string, tokens: number, metadata: {...} }`.

### Agent Composition
- Build a **pipeline** of agents (e.g., data fetcher → summarizer → resolver).
- Use `copilot.pipeline(['agent1', 'agent2'])` to chain them.

### Session Management
- Sessions are identified by a JWT claim `sub`. All data is scoped to this user, ensuring privacy.

## Extending the Platform
- **Custom Agents**: Implement the `AgentBase` class, override `handle()`.
- **Custom Tools**: Define a `Tool` with `name`, `description`, and an async `execute()` method.
- **Lens Visualizer**: Use `@copilotkit/lens` to generate agent interaction graphs.

## Debugging & Observability
- Enable the **Lens** UI at `/lens` to visualize runs.
- Logs are streamed to the console; can also hook into external log aggregators via a plugin.

Proceed to the [Agents](agents.md) documentation for concrete examples and best practices.