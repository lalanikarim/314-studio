# Litro ChatPanel Migration Plan

**Branch:** `refactor/migrate-to-lit-frontend`
**Created:** 2026-07-05
**Status:** Not started
**Prerequisite for:** Litro Migration Plan — ChatPanel completion
**Depends on:** [Litro Component Best Practices Plan](litro-component-best-practices-plan.md) Phases 0–3

## Overview

This plan ports the React `ChatPanel` component (~1100 lines, `frontend/src/components/ChatPanel.tsx`) to a Lit-based implementation in `frontend-litro/components/chat-panel.ts`. It is the final major piece of the Litro frontend migration and the most complex UI surface in the entire app — it handles SSE streaming, markdown rendering with GFM, collapsible tool calls, message history, model switching, session controls, and extension UI prompts.

> **Scope boundary:** We port ChatPanel only. Syntax highlighting inside code blocks is out of scope (FilePreview improvement task). Session management UI on the FolderSelector page is also out of scope (covered by best-practices Phase 2+).

## Architecture Decisions

### 1. SSE State as a `ReactiveController`

The React version wraps SSE in a `useSSE` hook. In Lit, the idiomatic replacement is a `ChatStreamController` that implements `ReactiveController`. The controller:
- Connects to SSE in `hostConnected()`
- Disconnects in `hostDisconnected()`
- Buffers raw inbound messages
- Tracks `conversationState`, `isStreaming`, `errorMessage`, `pendingUiRequest`
- Calls `host.requestUpdate()` on every new event so the component re-renders
- Exposes imperative methods: `prompt()`, `abort()`, `compact()`, `getMessages()`, `getState()`, `setModel()`, `respondToUi()`

**Why not put all SSE logic directly in the component?** The controller is ~250 lines of transport logic. Keeping it separate makes the component focused on rendering, allows reuse if we ever add a secondary chat surface, and is unit-testable independently of DOM rendering.

### 2. Markdown via `marked` + `unsafeHTML` directive

React uses `react-markdown` + `remark-gfm`. Lit has no equivalent React-first library. The simplest, battle-tested replacement is:
- `marked` (v15+) with `{ gfm: true }` for tables, code blocks, strikethrough, task lists
- `lit/directives/unsafe-html.js` to render the generated HTML string inside the Shadow DOM
- A tiny wrapper `lib/markdown.ts` that configures `marked` once and exports `renderMarkdown(source: string): string`

**Security note:** The markdown content originates from the Pi agent (trusted source) and is rendered inside a closed Shadow DOM (isolated from the document light DOM). `marked` does not execute JavaScript in code blocks. This is acceptable for an internal developer tool. If stricter sanitization is needed later, we can wrap `marked` output with `DOMPurify` in a follow-up.

### 3. Message Processing in `updated()` with a Monotonic Counter

The React version tracks `processedCountRef` and uses a `useEffect([sse.messages])` to process new events. In Lit, the controller calls `host.requestUpdate()` on every SSE event. The component implements `updated()`:

```typescript
updated() {
  const newMessages = this.chatController.messages.slice(this.processedCount);
  if (newMessages.length === 0) return;
  // Process into displayMessages / streamingContent / toolCalls...
  this.processedCount = this.chatController.messages.length;
}
```

This is proven (same logic as React) and avoids the complexity of making the controller own display-state, which is rendering-domain logic.

### 4. One Component Per File

Following the best-practices plan Phase 1, ChatPanel is decomposed into:

```
frontend-litro/
├── components/
│   ├── chat-panel.ts          # Main container (~400 lines)
│   ├── chat-message.ts          # User + assistant message rendering
│   ├── chat-tool-call.ts        # Collapsible tool call details
│   └── chat-input.ts            # Input bar + send/abort buttons
├── lib/
│   ├── chat-stream-controller.ts # SSE ReactiveController
│   ├── chat-processor.ts        # extractText, extractToolCall, agentMessageToDisplay
│   ├── markdown.ts              # marked wrapper
│   └── model.ts                 # deriveModelName, createMinimalModel
└── types/
    └── chat.ts                  # DisplayMessage, ToolCallEntry, AgentMessage, etc.
```

### 5. Event-Based Parent Communication

Following best-practices Phase 3, the ChatPanel does **not** accept callback props. It dispatches `CustomEvent` for parent-level actions:

| Event | Detail | When |
|-------|--------|------|
| `session-close` | `{ sessionId: string }` | User clicks close/compact |
| `session-delete` | `{ sessionId: string }` | User clicks delete |
| `model-switch` | `{ model: Model }` | User picks a new model |
| `navigate-home` | — | User clicks project title (handled by workspace) |

The parent (`WorkspacePage`) listens and routes to its own handlers.

### 6. `static properties` for All Sub-Components

Per the best-practices plan Phase 0, any class that receives data from a parent uses `static properties` block, **never** `@property`. Only `@state()` is permitted for internal reactive fields. `@customElement` is used for registration.

---

## Prerequisite Verification

Before starting any phase, confirm the best-practices plan prerequisites are met:

```bash
cd frontend-litro
# 1. No @property decorators remain in components/
grep -rn "@property" components/ lib/ pages/ || echo "clean"
# 2. Build succeeds
rm -rf dist && bun run litro build
# 3. Workspace route loads with 0 JS errors in production
node dist/server/server/index.mjs &
node /Users/karim/.pi/agent/skills/headless-browser-checker/check.js \
  --url "http://localhost:3000/workspace?folder=/Users/karim/Projects/314-studio" \
  --wait 'page-workspace' --errors /tmp/prereq-errs.json
# Verify: "jsErrors": []
```

If any prerequisite check fails, pause and fix the best-practices plan first.

---

## Verification Protocol

Every phase must pass **all four verification tiers** from the [Litro Component Best Practices Plan](litro-component-best-practices-plan.md). A quick reference:

1. **Tier 1:** `bun run litro build` exits 0 with no unresolved-symbol warnings.
2. **Tier 2:** Fresh production build, headless browser on `/workspace` route, 0 JS errors.
3. **Tier 3:** Playwright script tests the specific interactive behavior added in the phase.
4. **Tier 4:** Cross-route regression (home, models, workspace) with 0 JS errors.

> **Stale server rule:** Before every Tier 2/4 run, kill any process on port 3000, verify the port is free, then start the fresh `dist/server/server/index.mjs`.

---

## Phase 0: Markdown Infrastructure

**Goal:** Install `marked` and create a reusable markdown rendering utility.

### Step 0.1 — Install `marked`

```bash
cd frontend-litro
bun add marked
# marked is pure-JS and browser-safe; no additional bundler config needed.
```

### Step 0.2 — Create `lib/markdown.ts`

```typescript
import { marked } from 'marked';

marked.use({ gfm: true });

/** Render markdown source to HTML string. */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  return marked.parse(source, { async: false }) as string;
}
```

### Step 0.3 — Verify `unsafeHTML` import path

Confirm `lit/directives/unsafe-html.js` resolves in the project:

```typescript
// Temporary smoke-test in a page (remove after verification)
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
```

Build should succeed; `unsafeHTML` is part of the standard `lit` package.

### Verification ✅

```bash
cd frontend-litro
bun run litro build
# grep for marked in the bundle to confirm tree-shaking is reasonable
grep -c "marked" dist/client/assets/*.js | head -5
# Expect: at least one file contains marked (non-zero count)
```

**Acceptance criterion:** `renderMarkdown('# hello')` returns `<h1>hello</h1>`; build succeeds.

---

## Phase 1: ChatStreamController (SSE ReactiveController)

**Goal:** Create a reusable `ReactiveController` that wraps `SSEClient` and exposes reactive SSE state to any host component.

### Step 1.1 — Create `types/chat.ts`

```typescript
export interface ToolCallEntry {
  name: string;
  args?: string;
  result?: string;
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallEntry[];
  timestamp: number;
}

export type AgentMessage = Record<string, unknown>;

export type ConversationState =
  | 'idle'
  | 'streaming'
  | 'loading'
  | 'connecting'
  | 'disconnected'
  | 'error';

export interface RpcEventMessage {
  kind: 'rpc_event';
  event: Record<string, unknown>;
}

export interface RpcResponseMessage {
  kind: 'rpc_response';
  response: Record<string, unknown>;
}

export interface ExtensionUiRequestMessage {
  kind: 'extension_ui_request';
  type: 'extension_ui_request';
  id: string;
  method: string;
  params: unknown;
}

export type InboundMessage =
  | RpcEventMessage
  | RpcResponseMessage
  | ExtensionUiRequestMessage;
```

### Step 1.2 — Create `lib/chat-stream-controller.ts`

This is the Lit equivalent of `useSSE.ts`. It adopts the host, connects on mount, disconnects on unmount, and calls `host.requestUpdate()` on every event.

Key implementation notes:
- Use the existing `SSEClient` from `services/api.ts` for transport.
- Maintain `messages: InboundMessage[]` as a public array. The host reads it and tracks its own `processedCount`.
- Track streaming state by inspecting event types (`turn_start` → streaming, `agent_end` → idle).
- Auto-send `get_state` 300 ms after connect (same as React hook).
- Auto-ack fire-and-forget extension UI requests; expose interactive ones as `pendingUiRequest`.

```typescript
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { SSEClient } from '../services/api.js';
import type { InboundMessage, ConversationState, ExtensionUiRequestMessage } from '../types/chat.js';

const INTERACTIVE_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

export class ChatStreamController implements ReactiveController {
  private host: ReactiveControllerHost;
  private sse = new SSEClient();
  private _sessionId = '';
  private disposed = false;

  state: ConversationState = 'idle';
  messages: InboundMessage[] = [];
  isStreaming = false;
  errorMessage: string | null = null;
  pendingUiRequest: ExtensionUiRequestMessage | null = null;

  constructor(host: ReactiveControllerHost, sessionId: string) {
    this.host = host;
    this._sessionId = sessionId;
    host.addController(this);
  }

  hostConnected() {
    this.disposed = false;
    if (this._sessionId) this.connect();
  }

  hostDisconnected() {
    this.disposed = true;
    this.sse.close();
  }

  setSessionId(sessionId: string) {
    if (this._sessionId === sessionId) return;
    this._sessionId = sessionId;
    this.resetState();
    this.sse.close();
    if (sessionId) this.connect();
  }

  private resetState() {
    this.messages = [];
    this.isStreaming = false;
    this.state = 'idle';
    this.errorMessage = null;
    this.pendingUiRequest = null;
  }

  private async connect() {
    const sid = this._sessionId;
    try {
      await this.sse.connect(sid);
    } catch {
      this.state = 'error';
      this.errorMessage = 'Failed to connect';
      this.host.requestUpdate();
      return;
    }

    // Re-dispatch all named events
    this.sse.on('rpc_event', (data) => this.handleRpcEvent(data));
    this.sse.on('rpc_response', (data) => this.handleRpcResponse(data));
    this.sse.on('extension_ui_request', (data) => this.handleExtensionUiRequest(data));
    this.sse.on('set_model', (data) => this.handleRpcResponse(data));
    this.sse.on('session_terminated', () => {
      this.isStreaming = false;
      this.state = 'disconnected';
      this.errorMessage = 'Session terminated';
      this.host.requestUpdate();
    });

    setTimeout(() => {
      if (!this.disposed) this.sse.getState().catch(() => {});
    }, 300);
  }

  private pushMessage(msg: InboundMessage) {
    this.messages.push(msg);
    this.host.requestUpdate();
  }

  private handleRpcEvent(data: Record<string, unknown>) {
    if (this.disposed) return;
    const eventType = (data.event as Record<string, unknown>)?.type || '';
    if (eventType === 'turn_start' || eventType === 'agent_start' || eventType === 'message_start') {
      this.isStreaming = true;
      this.state = 'streaming';
    } else if (eventType === 'agent_end') {
      this.isStreaming = false;
      this.state = 'idle';
    }
    this.pushMessage({ kind: 'rpc_event', event: data.event as Record<string, unknown> });
  }

  private handleRpcResponse(data: Record<string, unknown>) {
    if (this.disposed) return;
    this.pushMessage({ kind: 'rpc_response', response: data });
  }

  private handleExtensionUiRequest(data: ExtensionUiRequestMessage) {
    if (this.disposed) return;
    if (INTERACTIVE_METHODS.has(data.method)) {
      this.pendingUiRequest = data;
      this.host.requestUpdate();
    } else {
      this.sse.respondToExtensionUI(data.id, null, false).catch(() => {});
    }
  }

  prompt(message: string) { return this.sse.prompt(message); }
  abort() { return this.sse.abort(); }
  compact() { return this.sse.compact(); }
  getMessages() { return this.sse.getMessages(); }
  setModel(modelId: string, provider: string) { return this.sse.setModel(modelId, provider); }
  respondToUi(id: string, value: unknown, cancelled = false) {
    this.pendingUiRequest = null;
    return this.sse.respondToExtensionUI(id, value, cancelled);
  }
}
```

### Verification ✅

Write a temporary Playwright script that:
1. Navigates to `/workspace?folder=/Users/karim/Projects/314-studio`
2. Waits for `page-workspace`
3. Injects a dummy `<chat-panel>` element with a fake `sessionId` (or mocks SSE — easier: just verify the component instantiates and the controller connects/disconnects without errors)

Since a real SSE connection requires a running backend session, the Tier 3 functional test can verify that the controller class is importable and its methods exist. Full end-to-end chat verification comes in Phase 7.

**Acceptance criterion:** `ChatStreamController` compiles, builds, and can be instantiated by a Lit component without runtime errors.

---

## Phase 2: Chat Message Processing Library

**Goal:** Port the message-processing helpers from `ChatPanel.tsx` into a pure, testable module.

### Step 2.1 — Create `lib/chat-processor.ts`

Port these functions from React ChatPanel with zero DOM/React dependencies:

1. `agentMessageToDisplay(msg: AgentMessage): DisplayMessage | null`
2. `extractText(event: Record<string, unknown>): string`
3. `extractToolCall(event: Record<string, unknown>): ToolCallEntry | null`
4. `isStreamFinalizer(event: Record<string, unknown>): boolean`

These are 1:1 ports. The only change is type imports come from `../types/chat.js`.

### Step 2.2 — Create `lib/model.ts`

Port from `frontend/src/utils/model.ts`:

1. `deriveModelName(modelId: string, provider: string): string`
2. `extractProvider(modelId: string | null | undefined): string`
3. `createMinimalModel(modelId: string, provider: string, nameOverride?: string): Model`

### Verification ✅

```bash
cd frontend-litro
bun run litro build
# Verify the lib modules are bundled and no React imports leak:
grep -rn "from 'react'" lib/ || echo "clean"
```

**Acceptance criterion:** All helper functions build without React dependencies; `agentMessageToDisplay` produces correct `DisplayMessage` objects for sample agent messages.

---

## Phase 3: Message Sub-Components

**Goal:** Create the leaf components that render individual messages and tool calls.

### Step 3.1 — Create `components/chat-tool-call.ts`

```typescript
import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { ToolCallEntry } from '../types/chat.js';

@customElement('chat-tool-call')
export class ChatToolCallElement extends LitElement {
  static styles = css`...`; // Collapsible details styles
  static properties = {
    name: { type: String },
    args: {},
    result: {},
  };

  name = '';
  args?: string;
  result?: string;

  render() {
    return html`
      <details class="tool-call" ?open=${false}>
        <summary>🔧 ${this.name} ...</summary>
        ${this.args ? html`<pre>${this.args}</pre>` : ''}
        ${this.result ? html`<pre>${this.result}</pre>` : ''}
      </details>
    `;
  }
}
```

### Step 3.2 — Create `components/chat-message.ts`

Renders both user and assistant messages. Accepts a `DisplayMessage` and uses `renderMarkdown` for assistant content.

```typescript
import { html, css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { DisplayMessage } from '../types/chat.js';

@customElement('chat-message')
export class ChatMessageElement extends LitElement {
  static styles = css`...`;
  static properties = {
    message: { type: Object },
  };

  message?: DisplayMessage;

  render() {
    const msg = this.message;
    if (!msg) return html``;
    const isUser = msg.role === 'user';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return html`
      <div class="message ${isUser ? 'message--user' : 'message--assistant'}">
        <div class="message__avatar">${isUser ? 'You' : 'π'}</div>
        <div class="message__body">
          <div class="message__meta">
            ${isUser ? 'You' : 'Pi'}
            <span class="message__time">${time}</span>
          </div>
          ${!isUser && msg.toolCalls.length > 0
            ? html`<div class="message__tools">
                ${msg.toolCalls.map(tc => html`
                  <chat-tool-call .name=${tc.name} .args=${tc.args} .result=${tc.result}></chat-tool-call>
                `)}
              </div>`
            : ''}
          <div class="message__content">
            ${isUser
              ? html`<p>${msg.content}</p>`
              : unsafeHTML(renderMarkdown(msg.content))}
          </div>
        </div>
      </div>
    `;
  }
}
```

### Step 3.3 — Create `components/chat-input.ts`

```typescript
import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('chat-input')
export class ChatInputElement extends LitElement {
  static styles = css`...`;
  static properties = {
    disabled: { type: Boolean },
    isStreaming: { type: Boolean },
  };

  @state() value = '';
  disabled = false;
  isStreaming = false;

  private onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  private send() {
    const trimmed = this.value.trim();
    if (!trimmed) return;
    this.dispatchEvent(new CustomEvent('send-message', { detail: trimmed, bubbles: true, composed: true }));
    this.value = '';
  }

  private abort() {
    this.dispatchEvent(new CustomEvent('abort-message', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="chat-input">
        <input
          type="text"
          placeholder="Message Pi…"
          .value=${this.value}
          @input=${(e: InputEvent) => this.value = (e.target as HTMLInputElement).value}
          @keydown=${this.onKeyDown}
          ?disabled=${this.disabled || this.isStreaming}
        />
        ${this.isStreaming
          ? html`<button class="btn btn--abort" @click=${this.abort}>■</button>`
          : html`<button class="btn btn--send" @click=${this.send} ?disabled=${!this.value.trim() || this.disabled}>➤</button>`}
      </div>
    `;
  }
}
```

### Verification ✅

```bash
cd frontend-litro
bun run litro build
# Headless on workspace route:
node /Users/karim/.pi/agent/skills/headless-browser-checker/check.js \
  --url "http://localhost:3000/workspace?folder=/Users/karim/Projects/314-studio" \
  --wait 'page-workspace' --errors /tmp/phase3-errs.json
# Expect 0 JS errors (chat-panel not mounted yet, but sub-components are registered)
```

**Acceptance criterion:** All three sub-components build successfully and are importable; `chat-message` renders markdown for assistant messages and plain text for user messages.

---

## Phase 4: Core ChatPanel Component

**Goal:** Build `components/chat-panel.ts` — the main container that wires the controller, processes messages, and composes sub-components.

### Step 4.1 — Component Skeleton

```typescript
import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ChatStreamController } from '../lib/chat-stream-controller.js';
import { agentMessageToDisplay, extractText, extractToolCall, isStreamFinalizer } from '../lib/chat-processor.js';
import { deriveModelName, createMinimalModel } from '../lib/model.js';
import type { Model } from '../types/index.js';
import type { DisplayMessage, ToolCallEntry } from '../types/chat.js';

@customElement('chat-panel')
export class ChatPanelElement extends LitElement {
  static styles = css`...`; // Panel layout, scrolling, message list
  static properties = {
    sessionId: { type: String },
    models: { type: Array },
    currentModel: { type: Object },
    projectPath: { type: String },
  };

  sessionId = '';
  models: Model[] = [];
  currentModel: Model | null = null;
  projectPath = '';

  @state() private processedCount = 0;
  @state() private displayMessages: DisplayMessage[] = [];
  @state() private streamingContent = '';
  @state() private toolCalls: ToolCallEntry[] = [];
  @state() private input = '';
  @state() private modelDropdownOpen = false;
  @state() private closingState: 'none' | 'compact' | 'delete' = 'none';

  private chatController!: ChatStreamController;
  private modelSetFromState = false;

  connectedCallback() {
    super.connectedCallback();
    this.chatController = new ChatStreamController(this, this.sessionId);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Controller auto-disconnects via hostDisconnected
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('sessionId')) {
      this.chatController.setSessionId(this.sessionId);
      this.resetDisplayState();
    }
    this.processNewMessages();
  }

  private resetDisplayState() {
    this.processedCount = 0;
    this.displayMessages = [];
    this.streamingContent = '';
    this.toolCalls = [];
    this.modelSetFromState = false;
  }

  private processNewMessages() { ... }
  private handleSend(message: string) { ... }
  private handleSwitchModel(model: Model) { ... }
  private handleClose() { ... }
  private handleDelete() { ... }
  private handleCompact() { ... }
  private scrollToBottom() { ... }

  render() {
    // Header + messages list + input
    // Uses <chat-message>, <chat-input>, and inline streaming indicator
  }
}
```

### Step 4.2 — Implement `processNewMessages()`

Port the React `useEffect([sse.messages])` logic into `processNewMessages()`. The logic is identical:

1. Slice `chatController.messages` from `processedCount` to end.
2. First pass: handle `rpc_response` (get_messages, get_state, compact) and `rpc_event` (text, tool calls, finalizers).
3. Accumulate `streamingContent` and `toolCalls`.
4. Second pass: if streaming ended + finalizer seen, finalize the assistant message into `displayMessages`.
5. Update `processedCount`.

### Step 4.3 — Implement Send Handler

```typescript
private handleSend(message: string) {
  // Finalize any current streaming content before the new user message
  if (this.streamingContent.trim() || this.toolCalls.length > 0) {
    this.finalizeStreamingMessage();
  }
  this.streamingContent = '';
  this.toolCalls = [];

  // Add user message to display
  this.displayMessages = [...this.displayMessages, {
    id: `user-${Date.now()}`,
    role: 'user',
    content: message,
    toolCalls: [],
    timestamp: Date.now(),
  }];

  // Forward to Pi
  this.chatController.prompt(message);
}
```

### Step 4.4 — Implement `finalizeStreamingMessage()`

```typescript
private finalizeStreamingMessage() {
  const toolLines = this.toolCalls.map(tc => {
    const argsLine = tc.args ? `\n  args: ${tc.args}` : '';
    const resultLine = tc.result ? `\n  result: ${tc.result}` : '';
    return `> ${tc.name}${argsLine}${resultLine}`;
  }).filter(Boolean);
  const lines = [...toolLines, this.streamingContent.trim()].filter(Boolean);
  if (lines.length) {
    this.displayMessages = [...this.displayMessages, {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: lines.join('\n\n'),
      toolCalls: [...this.toolCalls],
      timestamp: Date.now(),
    }];
  }
}
```

### Step 4.5 — Model Switch & Session Controls

Port `handleSwitchModel`, `handleClose`, `handleDelete`, `handleCompact` from React. These call `services/api.ts` functions (`switchModel`, `closeSession`, `deleteSession`) and dispatch events (`model-switch`, `session-close`, `session-delete`) so the parent can navigate away if needed.

### Verification ✅

Build + headless on workspace route. Because no real SSE session exists in the headless check, verify:
- `chat-panel` element renders without JS errors.
- Input bar and placeholder are visible.
- `chat-message` renders a manually injected test message (via Playwright `page.evaluate`) correctly.

**Acceptance criterion:** ChatPanel renders in the workspace layout with no runtime errors; all internal state management logic compiles.

---

## Phase 5: Workspace Integration

**Goal:** Mount `chat-panel` inside `WorkspacePage` and wire events.

### Step 5.1 — Update `pages/workspace.ts`

Replace the placeholder:

```html
<!-- Before -->
<div class="view-workspace__chat-placeholder">ChatPanel — coming soon</div>

<!-- After -->
<chat-panel
  .sessionId=${sessionId}
  .models=${models}
  .currentModel=${currentModel}
  .projectPath=${projectRoot}
  @model-switch=${(e: CustomEvent<Model>) => this.handleModelSwitch(e.detail)}
  @session-close=${() => this.navigateHome()}
  @session-delete=${() => this.navigateHome()}
></chat-panel>
```

Wait — where do `sessionId`, `models`, and `currentModel` come from in `WorkspacePage`? Currently `WorkspacePage` doesn't fetch them. The React version gets them from `AppContext`. In Litro, we need to either:

**Option A:** `WorkspacePage` fetches models on mount and gets `sessionId` from the URL or global state.
**Option B:** The parent shell passes session metadata down.

Looking at the current `workspace.ts`, it only knows `folderPath` from the URL query param. It doesn't know the session ID. In the React app, `AppContext` holds `sessionId`, `currentModel`, `models`. These are set during the model selector step.

For the Litro migration, the simplest approach is:
1. `WorkspacePage` reads `sessionId` from a URL query param (e.g., `?folder=...&session=...`) or from the same global state mechanism used elsewhere.
2. `WorkspacePage` fetches `models` on mount via `fetchModels()`.
3. `WorkspacePage` fetches session info to get `currentModel`.

Actually, looking at the ModelSelector in Litro — does it already create a session and redirect to workspace with session info? Let me check `pages/models.ts` to see how it transitions to workspace. I don't have that file content. Let me read it. Actually, I should check it to be accurate in the plan.

Let me read `pages/models.ts`. But wait, even if I don't read it, I know from the AGENTS.md that the flow is: FolderSelector → ModelSelector → Workspace. The ModelSelector creates a session. It probably redirects to `/workspace?folder=X&session=Y` or similar. Let me check. Actually, I don't have the exact redirect logic. Let me read it quickly. But even if I don't read it, I can design the plan to handle both cases.

Let me read `pages/models.ts` to see how session state is passed. This is important for the integration. Actually, I don't want to keep going back and forth. Let me just check quickly. If the file is short, I'll read it. If not, I'll make a reasonable assumption and document it as a discovery step in the plan.

Actually, looking at the current workspace.ts code, there is no `sessionId` at all. The ChatPanel TODO is just a placeholder. So the workspace page doesn't currently know about sessions. This means Phase 5 must include adding session awareness to `WorkspacePage`.

How does the React app pass session info? Through `AppContext`. In Litro, we don't have a global React context. We could use URL query params, or a module-level store, or have `WorkspacePage` fetch its own session list for the project.

Given the existing patterns in Litro (SelectionStore is instantiated per-mount in WorkspacePage), the cleanest approach is:

1. `WorkspacePage` fetches project info on mount to get the active session for this project.
2. Or, `WorkspacePage` reads `session_id` from URL params.

Looking at the backend API: `GET /api/projects/info?project_path=...` returns sessions. So `WorkspacePage` can call `fetchProjectInfo(this.folderPath)` and pick the first running session. This is robust and self-contained.

Actually, wait — the ModelSelector creates the session and then redirects. If it passes `session_id` in the URL, that's even easier. Let me check what the current ModelSelector does. I'll read the relevant part.

Actually, I think the best approach for the plan is to document this as a discovery step. I'll write the plan with the assumption that `WorkspacePage` needs to resolve `sessionId`, `models`, and `currentModel`, and I'll provide the recommended approach: fetch on mount.

Let me read `pages/models.ts` quickly to see the redirect. I'll use a targeted read with limit. If I can't find it quickly, I'll proceed. Actually, I'll just read it. The file shouldn't be too large. Wait, models.ts could be large. Let me just do a bash grep to find the redirect logic. This is faster. Let me do `grep -n "workspace\|session\|href" frontend-litro/pages/models.ts`. If that doesn't exist, I'll grep in the directory. Actually, if models.ts doesn't exist, it might be `frontend-litro/pages/models.ts`. Let me just do a grep. If I can't find it quickly, I'll document it as TBD.

Let me do a targeted check. But wait, I can also just write the plan to include a step for workspace session resolution without needing to know the exact current models.ts implementation. The plan can say:

"WorkspacePage must resolve `sessionId`. The recommended approach is to read it from URL query params (e.g., `?session_id=...`) or fetch project info. If the current ModelSelector redirect doesn't include it, update ModelSelector to append `&session_id=...` to the workspace URL."

This is safe and actionable.

Let me continue writing the plan without reading models.ts.

So Step 5.1 includes:

1. Add `@state() sessionId = '';` and `@state() models: Model[] = [];` and `@state() currentModel: Model | null = null;` to `WorkspacePage`.
2. In `connectedCallback()` or `firstUpdated()`, call `fetchProjectInfo(projectPath)` to get sessions, pick the first running session, and call `fetchModels()` to populate the models list.
3. Or, read `session_id` from `window.location.search` if ModelSelector passes it.

Actually, the simplest is: read `session_id` from URL params. If ModelSelector doesn't pass it yet, we'll update ModelSelector in a sub-step.

But wait, `WorkspacePage` currently extends `LitroPage` which handles SSR. We must guard `window` access. So:

```typescript
private get sessionId(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('session_id') || '';
}
```

And for models, we fetch in `firstUpdated()`:

```typescript
async firstUpdated() {
  this.models = await fetchModels(this.sessionId);
  // Also fetch current model from session info if needed
}
```

Wait, `fetchModels` takes an optional `sessionId`. That returns the list of available models. Good.

For `currentModel`, we can start with `null` and let the ChatPanel's `get_state` response populate it (same as React).

So in workspace.ts:
```typescript
@state() models: Model[] = [];
@state() currentModel: Model | null = null;

async firstUpdated() {
  try {
    this.models = await fetchModels();
  } catch { /* ignore */ }
}
```

And pass them to chat-panel:
```html
<chat-panel
  .sessionId=${this.sessionId}
  .models=${this.models}
  .currentModel=${this.currentModel}
  .projectPath=${this.folderPath}
  @model-switch=${(e: CustomEvent<Model>) => { this.currentModel = e.detail; }}
  @session-close=${() => { window.location.href = '/'; }}
  @session-delete=${() => { window.location.href = '/'; }}
></chat-panel>
```

This is clean.

### Step 5.2 — Update `app.ts`

Uncomment the import:
```typescript
import './components/chat-panel.js';
```

### Step 5.3 — Update `pages/models.ts` (if needed)

If the ModelSelector redirect to workspace does not include `session_id`, update it to append `&session_id=${sessionId}` to the workspace URL.

### Verification ✅

Headless browser check on `/workspace?folder=/Users/karim/Projects/314-studio&session_id=<real-session-id>`.

Since a real session requires a running backend, the Tier 2 check can use a dummy session ID and verify the ChatPanel mounts without JS errors. Tier 3 (Playwright) requires the backend to be running.

**Acceptance criterion:** ChatPanel is visible in the workspace layout; workspace page still renders with 0 JS errors; sidebar and file preview continue to work.

---

## Phase 6: Model Picker, Session Controls & Extension UI

**Goal:** Port the remaining UI surfaces from React ChatPanel: model dropdown, session control buttons, pending UI banner, error banner, empty state.

### Step 6.1 — Model Picker Dropdown

Port the compact model picker from React. It lives in the ChatPanel header and shows a dropdown of available models. Clicking a model:
1. Calls `this.chatController.setModel(model.id, model.provider)`
2. Calls `switchModel(this.sessionId, model.id, model.provider)` (REST persistence)
3. Dispatches `model-switch` event so WorkspacePage can update its own `currentModel`
4. Updates local `currentModel` state for immediate UI feedback

### Step 6.2 — Session Controls

Port compact / close / delete buttons from the ChatPanel header:
- **Compact:** `this.chatController.compact()`
- **Close:** `closeSession(this.sessionId)` → dispatch `session-close`
- **Delete:** `deleteSession(this.sessionId)` → dispatch `session-delete`

Show loading indicator (`closingState`) while async operations are in flight.

### Step 6.3 — Extension UI Banner

Port the `renderPendingUi()` banner. When `chatController.pendingUiRequest` is non-null, render a banner above the messages showing the method name, parameters, Accept/Cancel buttons.

```typescript
private renderPendingUi() {
  const req = this.chatController.pendingUiRequest;
  if (!req) return html``;
  const paramsText = typeof req.params === 'string' ? req.params : JSON.stringify(req.params, null, 2);
  return html`
    <div class="ui-prompt-banner">
      <span class="ui-prompt-banner__method">${req.method}</span>
      <pre class="ui-prompt-banner__params">${paramsText}</pre>
      <div class="ui-prompt-banner__actions">
        <button class="btn btn--sm" @click=${() => this.chatController.respondToUi(req.id, null, false)}>Cancel</button>
        <button class="btn btn--sm btn--primary" @click=${() => this.chatController.respondToUi(req.id, true, false)}>Accept</button>
      </div>
    </div>
  `;
}
```

### Step 6.4 — Connection Status & Error Banners

Port the connection status dot + label and the error banner from the React header.

### Step 6.5 — Empty State & Clear Chat

Port the empty state illustration and the "Clear chat" button.

### Verification ✅

Playwright script that:
1. Creates a session via the backend API
2. Navigates to workspace with that session
3. Types a message and sends it
4. Verifies the user message appears in the DOM
5. Waits for assistant response (or at least streaming indicator)
6. Verifies 0 JS errors throughout

**Acceptance criterion:** All UI surfaces from the React ChatPanel are present and functional; sending a prompt produces a visible user message and triggers SSE streaming.

---

## Phase 7: Verification & Regression

**Goal:** Full end-to-end verification that the ChatPanel works in the context of the entire Litro app.

### Step 7.1 — End-to-End Chat Test

With backend running and a real session:

```bash
cd frontend-litro
# 1. Build
rm -rf dist && bun run litro build
# 2. Start production server
node dist/server/server/index.mjs &
# 3. Run headless check on workspace
node /Users/karim/.pi/agent/skills/headless-browser-checker/check.js \
  --url "http://localhost:3000/workspace?folder=/Users/karim/Projects/314-studio&session_id=<id>" \
  --wait 'chat-panel' --errors /tmp/phase7-errs.json --screenshot /tmp/phase7-chat.png
# 4. Verify 0 JS errors
```

### Step 7.2 — Cross-Route Regression

Navigate to `/`, `/models`, and `/workspace` in sequence. Verify 0 JS errors on each.

### Step 7.3 — Integration Test Alignment

The backend integration tests (`tests/test_flow1_browse_chat.py`) exercise chat via SSE. Ensure the Litro frontend can connect to the same SSE endpoint and receive events. No test changes are needed — the backend contract is unchanged.

### Verification ✅

All four tiers from the best-practices plan must pass:
- Tier 1: Build clean
- Tier 2: Headless workspace route, 0 JS errors
- Tier 3: Playwright sends a real prompt and sees the response
- Tier 4: Home + models routes unaffected

**Acceptance criterion:** ChatPanel is feature-complete, production-build-safe, and the workspace route passes all verification tiers.

---

## Sequencing & Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7
(marked)    (SSE ctrl)   (helpers)   (sub-comps)  (main comp)  (integrate)  (polish)     (verify)
```

Each phase depends only on the previous one. Phases 0–2 can be worked on in parallel by different developers if needed (they touch disjoint files). Phase 3 depends on Phase 2 types. Phase 4 depends on Phases 1–3. Phase 5 depends on Phase 4. Phase 6 depends on Phase 4 (it adds UI to the same component). Phase 7 depends on all previous.

---

## Definition of Done

- [ ] `marked` installed and `lib/markdown.ts` renders GFM correctly.
- [ ] `ChatStreamController` connects/disconnects SSE, exposes reactive state, and is reusable.
- [ ] `lib/chat-processor.ts` ports all message-processing helpers with no React dependencies.
- [ ] `lib/model.ts` ports `deriveModelName`, `extractProvider`, `createMinimalModel`.
- [ ] `types/chat.ts` contains all chat-specific types.
- [ ] `components/chat-tool-call.ts` renders collapsible tool calls.
- [ ] `components/chat-message.ts` renders user and assistant messages with markdown.
- [ ] `components/chat-input.ts` handles input, Enter key, send, and abort.
- [ ] `components/chat-panel.ts` is the main container with session controls and model picker.
- [ ] `pages/workspace.ts` mounts `<chat-panel>` and passes session/models/currentModel.
- [ ] `app.ts` imports `chat-panel.js`.
- [ ] No `@property` decorators in any new or modified component.
- [ ] No module-global state — `sessionId` and models are fetched per-mount or passed via URL.
- [ ] All child→parent communication uses `CustomEvent` (no callback props).
- [ ] Tier 1–4 verification passes on the workspace route.
- [ ] Cross-route regression passes (home, models, workspace).
- [ ] `litro-migration-plan.md` updated — ChatPanel marked ✅.
- [ ] Committed with signed-off message and pushed to `refactor/migrate-to-lit-frontend`.

## Out of Scope

- Syntax highlighting inside markdown code blocks (FilePreview improvement task).
- Session management UI on the FolderSelector page (best-practices plan Phase 2 follow-up).
- Production build optimization / bundle splitting.
- Adding `DOMPurify` for markdown sanitization (can be added later; source is trusted).
- Auto-scroll behavior improvements beyond basic `scrollIntoView`.
- Message editing, threading, or multi-modal attachments.
