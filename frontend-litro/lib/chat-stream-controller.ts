import type { ReactiveController, ReactiveControllerHost } from "lit";
import { SSEClient } from "../services/api.js";
import type {
  ConversationState,
  ExtensionUiRequestMessage,
  InboundMessage,
} from "../types/chat.js";

/** Interactive extension UI methods that require user input */
const INTERACTIVE_METHODS = new Set(["select", "confirm", "input", "editor"]);

/**
 * SSE ReactiveController — queue + transport layer.
 *
 * Responsibilities:
 * - Manage SSE connection lifecycle (connect/disconnect/reconnect)
 * - Append every incoming event to the `messages` queue
 * - Track `isStreaming` based on event types (content-driven, not prevIsStreaming)
 * - Notify the host component of every new event
 *
 * The controller does NOT process event content. That is the component's job.
 * This separation makes the controller unit-testable and reusable.
 */
export class ChatStreamController implements ReactiveController {
  private host: ReactiveControllerHost;
  private sse = new SSEClient();
  private _sessionId = "";
  private disposed = false;

  /** Queue of all inbound messages (events + responses + extension UI) */
  messages: InboundMessage[] = [];

  /** Whether the agent is currently streaming assistant content */
  isStreaming = false;

  /** Connection/lifecycle state */
  state: ConversationState = "idle";

  /** Error message (if any) */
  errorMessage: string | null = null;

  /** Pending interactive extension UI request */
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

  // ── Public commands ──────────────────────────────────────────────────

  prompt(message: string) {
    return this.sse.prompt(message);
  }

  abort() {
    return this.sse.abort();
  }

  compact() {
    return this.sse.compact();
  }

  getState() {
    return this.sse.getState();
  }

  getMessages() {
    return this.sse.getMessages();
  }

  setModel(modelId: string, provider: string) {
    return this.sse.setModel(modelId, provider);
  }

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

    // Auto-send get_state 300ms after connect
    setTimeout(() => {
      if (!this.disposed) {
        this.sse.getState().catch(() => {
          /* ignore — state response arrives via SSE */
        });
      }
    }, 300);
  }

  private push(msg: InboundMessage) {
    if (this.disposed) return;
    this.messages.push(msg);
    this.host.requestUpdate();
  }

  /**
   * Update streaming state based on event type.
   *
   * Per Pi RPC protocol:
   * - Streaming STARTS on: agent_start, turn_start, message_start
   * - Streaming STOPS on:  message_end, turn_end, agent_end, done, error
   *
   * These are checked AFTER the event is pushed to the queue so the
   * component can process the event content before seeing the state change.
   */
  private updateStreamingState(eventType: string) {
    const wasStreaming = this.isStreaming;

    if (
      eventType === "agent_start" ||
      eventType === "turn_start" ||
      eventType === "message_start"
    ) {
      this.isStreaming = true;
      if (this.state === "idle") this.state = "streaming";
      console.debug('[ChatStream] START:', eventType);
    }

    if (
      eventType === "message_end" ||
      eventType === "turn_end" ||
      eventType === "agent_end"
    ) {
      this.isStreaming = false;
      if (this.state === "streaming") this.state = "idle";
      console.debug('[ChatStream] END:', eventType);
    }
  }

  private handleRpcEvent(data: Record<string, unknown>) {
    if (this.disposed) return;

    const eventPayload =
      (data as { event?: Record<string, unknown> }).event ?? data;
    const eventType =
      (eventPayload as Record<string, unknown>)?.type as string | undefined ??
      "";

    // Push the event to the queue first
    this.push({
      kind: "rpc_event",
      event: eventPayload as Record<string, unknown>,
    });

    // Then update streaming state (component reads queue next tick)
    this.updateStreamingState(eventType);
  }

  private handleRpcResponse(data: Record<string, unknown>) {
    if (this.disposed) return;
    this.push({
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
