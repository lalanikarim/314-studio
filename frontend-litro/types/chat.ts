/**
 * Chat-specific types for the ChatPanel component.
 *
 * These mirror the React ChatPanel types but are independent of React.
 */

/** A single tool call (name + args + result) tracked during streaming */
export interface ToolCallEntry {
  name: string;
  args?: string;
  result?: string;
}

/** A finalized message ready for rendering */
export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallEntry[];
  timestamp: number;
}

/** Raw message returned by Pi RPC get_messages command */
export type AgentMessage = Record<string, unknown>;

/**
 * Conversation state — represents the state of the conversation flow,
 * not just the connection.
 */
export type ConversationState =
  | "idle" // No active stream, waiting for user input
  | "streaming" // Actively receiving streaming events
  | "loading" // Initial load or history fetch
  | "connecting" // Establishing SSE connection
  | "disconnected" // SSE connection lost
  | "error"; // Error state

/** Inbound message from the SSE stream */
export type InboundMessage =
  | RpcEventMessage
  | RpcResponseMessage
  | ExtensionUiRequestMessage;

/** RPC event (text chunks, tool calls, finalizers) */
export interface RpcEventMessage {
  kind: "rpc_event";
  event: Record<string, unknown>;
}

/** RPC response (get_state, get_messages, compact, set_model, etc.) */
export interface RpcResponseMessage {
  kind: "rpc_response";
  response: Record<string, unknown>;
}

/** Extension UI request from Pi (interactive prompts needing user input) */
export interface ExtensionUiRequestMessage {
  kind: "extension_ui_request";
  type: "extension_ui_request";
  id: string;
  method: string;
  params: unknown;
}
