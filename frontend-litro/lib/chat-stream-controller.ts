import type { ReactiveController, ReactiveControllerHost } from "lit";
import { SSEClient } from "../services/api.js";
import type {
  ConversationState,
  ExtensionUiRequestMessage,
  InboundMessage,
  RpcEventMessage,
  RpcResponseMessage,
} from "../types/chat.js";

/** Interactive extension UI methods that require user input */
const INTERACTIVE_METHODS = new Set(["select", "confirm", "input", "editor"]);

/**
 * SSE ReactiveController wrapping SSEClient for the ChatPanel.
 *
 * Adopts a Lit component as host, connects to SSE on mount, disconnects
 * on unmount, and calls `host.requestUpdate()` on every new event so the
 * component re-renders reactively.
 *
 * Separation of concerns:
 * - Controller owns transport logic (~200 lines)
 * - Component owns rendering logic (display messages, streaming content)
 *
 * This makes the controller reusable across different chat surfaces and
 * unit-testable independently of DOM rendering.
 */
export class ChatStreamController implements ReactiveController {
  private host: ReactiveControllerHost;
  private sse = new SSEClient();
  private _sessionId = "";
  private disposed = false;

  state: ConversationState = "idle";
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

  /** Switch to a different session (closes old SSE, opens new one) */
  setSessionId(sessionId: string) {
    if (this._sessionId === sessionId) return;
    this._sessionId = sessionId;
    this.resetState();
    this.sse.close();
    if (sessionId) this.connect();
  }

  /** Send a prompt message to Pi */
  prompt(message: string) {
    return this.sse.prompt(message);
  }

  /** Abort current Pi turn */
  abort() {
    return this.sse.abort();
  }

  /** Compact conversation (reduce context size, session stays alive) */
  compact() {
    return this.sse.compact();
  }

  /** Request current agent state */
  getState() {
    return this.sse.getState();
  }

  /** Request chat history */
  getMessages() {
    return this.sse.getMessages();
  }

  /** Switch the active model */
  setModel(modelId: string, provider: string) {
    return this.sse.setModel(modelId, provider);
  }

  /** Reply to an extension UI interactive prompt */
  respondToUi(id: string, value: unknown, cancelled = false) {
    this.pendingUiRequest = null;
    return this.sse.respondToExtensionUI(id, value, cancelled);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private resetState() {
    this.messages = [];
    this.isStreaming = false;
    this.state = "idle";
    this.errorMessage = null;
    this.pendingUiRequest = null;
  }

  private async connect() {
    const sid = this._sessionId;
    if (!sid) return;

    this.state = "connecting";
    this.host.requestUpdate();

    try {
      await this.sse.connect(sid);
    } catch {
      this.state = "error";
      this.errorMessage = "Failed to connect";
      this.host.requestUpdate();
      return;
    }

    // Reset error on successful connect
    this.state = "idle";
    this.errorMessage = null;
    this.host.requestUpdate();

    // Register event listeners
    this.sse.on("rpc_event", (data) => this.handleRpcEvent(data));
    this.sse.on("rpc_response", (data) => this.handleRpcResponse(data));
    this.sse.on("set_model", (data) => this.handleRpcResponse(data));
    this.sse.on("extension_ui_request", (data) =>
      this.handleExtensionUiRequest(data),
    );
    this.sse.on("session_terminated", () => {
      if (this.disposed) return;
      this.isStreaming = false;
      this.state = "disconnected";
      this.errorMessage = "Session terminated";
      this.host.requestUpdate();
    });

    // EventSource error — don't change state (auto-reconnects),
    // only set disconnected if truly closed.
    const onError = () => {
      if (this.disposed) return;
      // EventSource auto-reconnects; state will be set when 'open' fires
      // or when we explicitly close. Don't preempt.
    };
    // We don't have direct access to the EventSource's onerror from SSEClient,
    // but SSEClient.onerror rejects the connect promise — already handled above.

    // Auto-send get_state 300ms after connect (same as React hook)
    setTimeout(() => {
      if (!this.disposed) {
        this.sse.getState().catch(() => {
          /* ignore — state response arrives via SSE */
        });
      }
    }, 300);
  }

  private pushMessage(msg: InboundMessage) {
    if (this.disposed) return;
    this.messages.push(msg);
    this.host.requestUpdate();
  }

  private handleRpcEvent(data: Record<string, unknown>) {
    if (this.disposed) return;

    const event = data as { event?: Record<string, unknown> };
    const eventPayload = event.event ?? event;
    const eventType = (eventPayload as Record<string, unknown>)?.type || "";

    // Debug: log event types
    console.log('[SSE] rpc_event type:', eventType);
    if (eventType === 'agent_message') {
      console.log('[SSE] agent_message text:', (eventPayload as any).text?.substring(0, 100));
    }

    // Track streaming state based on event type
    if (
      eventType === "turn_start" ||
      eventType === "agent_start" ||
      eventType === "message_start"
    ) {
      this.isStreaming = true;
      this.state = "streaming";
    } else if (eventType === "agent_end" || eventType === "turn_end") {
      // agent_end or turn_end signals end of streaming turn
      this.isStreaming = false;
      this.state = "idle";
    }

    this.pushMessage({
      kind: "rpc_event",
      event: eventPayload as Record<string, unknown>,
    });
  }

  private handleRpcResponse(data: Record<string, unknown>) {
    if (this.disposed) return;
    const command = data.command || data.commandName || data.type || 'unknown';
    console.log('[SSE] rpc_response command:', command);
    this.pushMessage({
      kind: "rpc_response",
      response: data as Record<string, unknown>,
    });
  }

  private handleExtensionUiRequest(
    data: ExtensionUiRequestMessage | Record<string, unknown>,
  ) {
    if (this.disposed) return;

    const msg =
      data.kind === "extension_ui_request"
        ? (data as ExtensionUiRequestMessage)
        : ({
            kind: "extension_ui_request",
            type: "extension_ui_request",
            id: (data as Record<string, unknown>).id as string,
            method: (data as Record<string, unknown>).method as string,
            params: (data as Record<string, unknown>).params,
          } as ExtensionUiRequestMessage);

    if (INTERACTIVE_METHODS.has(msg.method)) {
      this.pendingUiRequest = msg;
      this.host.requestUpdate();
    } else {
      // Fire-and-forget — auto-ack via REST
      this.sse
        .respondToExtensionUI(msg.id, null, false)
        .catch(() => {
          /* ignore */
        });
    }
  }
}
