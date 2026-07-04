/**
 * Hook: Server-Sent Events connection to Pi RPC.
 *
 * Manages a single SSE stream per session for outbound events from Pi,
 * and REST calls for inbound commands. Handles:
 *   - SSE connection / disconnection / auto-reconnection (via EventSource)
 *   - Sending commands (prompt, abort, compact) via REST
 *   - Routing inbound events: rpc_event, extension_ui_request, extension_ui_response
 *   - Auto-acknowledging fire-and-forget extension UI methods
 *   - Receiving set_model on connect
 *
 * Architecture:
 *   SSE (EventSource)  → server→client event stream
 *   REST (fetch)       → client→server commands
 */

import {
	useCallback,
	useRef,
	useEffect,
	useState,
	useMemo,
	type MutableRefObject,
} from "react";
import type { Model } from "../types";

// ── Message types forwarded from backend ───────────────────────────────────

export interface RpcEventMessage {
	kind: "rpc_event";
	event: Record<string, unknown>;
}

export interface RpcResponseMessage {
	kind: "rpc_response";
	response: Record<string, unknown>;
}

export interface ExtensionUiRequestMessage {
	kind: "extension_ui_request";
	type: "extension_ui_request";
	id: string;
	method: string;
	params: unknown;
}

export interface ExtensionUiResponseMessage {
	kind: "extension_ui_response";
	type: "extension_ui_response";
	id: string;
	value: unknown;
	cancelled: boolean;
}

export type InboundMessage =
	| RpcEventMessage
	| ExtensionUiRequestMessage
	| ExtensionUiResponseMessage
	| RpcResponseMessage;

// ── Outbound message types ─────────────────────────────────────────────────

export type UiResponseMessage = {
	kind: "extension_ui_response";
	type: "extension_ui_response";
	id: string;
	value: unknown;
	cancelled: boolean;
};

export type RpcCommand = {
	type: string;
	id?: string;
	[key: string]: unknown;
};

export type PromptMessage = {
	type: "prompt";
	message: string;
};

// ── Conversation states ───────────────────────────────────────────────────
// These represent the state of the conversation flow, not just the connection.

export type ConversationState =
	| "idle"          // No active stream, waiting for user input
	| "streaming"     // Actively receiving streaming events
	| "loading"       // Initial load or history fetch
	| "connecting"    // Establishing SSE connection
	| "disconnected"  // SSE connection lost
	| "error";        // Error state

export interface UseSSEReturn {
	/** Current conversation state */
	state: ConversationState;
	/** Human-readable error message for the current state */
	errorMessage: string | null;
	/** Send a prompt message to Pi (REST call) */
	prompt: (message: string) => void;
	/** Abort current Pi turn without terminating session */
	abort: () => void;
	/** Compact conversation to reduce context size (session stays running) */
	compact: () => void;
	/** Set auto-compaction on/off */
	setAutoCompaction: (enabled: boolean) => void;
	/** List of inbound messages (rpc_events, extension_ui_requests, etc.) */
	messages: InboundMessage[];
	/** Extension UI request currently awaiting user input */
	pendingUiRequest: ExtensionUiRequestMessage | null;
	/** Reply to an extension UI interactive prompt */
	respondToUi: (id: string, value: unknown, cancelled?: boolean) => void;
	/** Whether a stream is currently active */
	isStreaming: boolean;
}

// ── Interactive extension UI methods (need user input) ────────────────────

const INTERACTIVE_METHODS = new Set(["select", "confirm", "input", "editor"]);



/** API base path for REST commands */
const API_BASE = "";

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Create an SSE hook for a given session.
 *
 * @param sessionId     - Session id for the SSE stream
 * @param modelRef      - Ref to the current model (used to send set_model on connect)
 * @returns SSE hook return value
 */
export function useSSE(
	sessionId: string | null,
	modelRef: MutableRefObject<Model | null>,
	prevIsStreamingRef?: MutableRefObject<boolean>,
): UseSSEReturn {
	const sourceRef = useRef<EventSource | null>(null);
	const [conversationState, setConversationState] =
		useState<ConversationState>("idle");
	const [messages, setMessages] = useState<InboundMessage[]>([]);
	const [pendingUiRequest, setPendingUiRequest] =
		useState<ExtensionUiRequestMessage | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);

	// Track whether cleanup has run
	const disposedRef = useRef(false);
	const sessionRef = useRef(sessionId);
	const modelRefCurrent = useRef(modelRef);

	// Keep refs in sync
	useEffect(() => {
		sessionRef.current = sessionId;
	}, [sessionId]);
	useEffect(() => {
		modelRefCurrent.current = modelRef;
	}, [modelRef]);

	// ── UI reply helper (REST call) ──────────────────────────────────────

	const respondToUi = useCallback(
		async (id: string, value: unknown, cancelled = false) => {
			const sid = sessionRef.current;
			if (!sid) return;
			setPendingUiRequest(null);
			try {
				await fetch(`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						command: "extension_ui_response",
						id,
						value,
						cancelled,
					}),
				});
			} catch (err) {
				console.error("Failed to respond to UI prompt:", err);
			}
		},
		[],
	);

	// ── Prompt helper (REST call) ────────────────────────────────────────

	const prompt = useCallback(
		async (message: string) => {
			const sid = sessionRef.current;
			if (!sid) return;
			try {
				await fetch(`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ command: "prompt", message }),
				});
			} catch (err) {
				console.error("Failed to send prompt:", err);
			}
		},
		[],
	);

	// ── Abort helper (REST call) ─────────────────────────────────────────

	const abort = useCallback(async () => {
		const sid = sessionRef.current;
		if (!sid) return;
		try {
			await fetch(`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command: "abort" }),
			});
		} catch (err) {
			console.error("Failed to abort:", err);
		}
	}, []);

	// ── Compact helper (REST call) ───────────────────────────────────────

	const compact = useCallback(async () => {
		const sid = sessionRef.current;
		if (!sid) return;
		try {
			await fetch(`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command: "compact" }),
			});
		} catch (err) {
			console.error("Failed to compact:", err);
		}
	}, []);

	// ── Auto-compaction helper (REST call) ───────────────────────────────

	const setAutoCompaction = useCallback(
		async (enabled: boolean) => {
			const sid = sessionRef.current;
			if (!sid) return;
			try {
				await fetch(`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ command: "set_auto_compaction", enabled }),
				});
			} catch (err) {
				console.error("Failed to set auto-compaction:", err);
			}
		},
		[],
	);

	// ── SSE Connection ───────────────────────────────────────────────────

	useEffect(() => {
		disposedRef.current = false;

		setMessages([]);

		const sid = sessionId;
		if (!sid) return;

		const url = `/api/projects/sse?session_id=${encodeURIComponent(sid)}`;
		const source = new EventSource(url);
		sourceRef.current = source;

		// Helper to add message.  We append unconditionally; the buffer
		// is reset on every session change so unbounded growth only
		// happens within a single long-lived session.  Front-trimming
		// is intentionally avoided because ChatPanel’s
		// `processedCountRef` uses a monotonic counter that would
		// desynchronize with a trimmed array.
		const addMessage = (msg: InboundMessage) => {
			setMessages((prev) => [...prev, msg]);
		};

		// All event types
		source.addEventListener("rpc_event", (e) => {
			if (disposedRef.current) return;

			// Only process events from the current stream
			try {
				const data = JSON.parse(e.data) as { kind: "rpc_event"; event: Record<string, unknown> };
				addMessage({ kind: "rpc_event", event: data.event });

				// Track streaming state based on event type
				const eventType = data.event?.type || data.event?.kind || "";
				if (eventType === "turn_start" || eventType === "agent_start" || eventType === "message_start") {
					// Synchronously update ref BEFORE React batches the state update
					if (prevIsStreamingRef) prevIsStreamingRef.current = false;
					setIsStreaming(true);
					setConversationState("streaming");
				} else if (eventType === "agent_end") {
					// agent_end is the DEFINITIVE end of a turn — only then stop streaming
					// Synchronously update ref BEFORE React batches the state update
					if (prevIsStreamingRef) prevIsStreamingRef.current = true;
					setIsStreaming(false);
					setConversationState("idle");
				}
				// end_turn, end, response events are NOT used to stop streaming
				// They may arrive before all text events, so we ignore them for state purposes
			} catch {
				// Non-JSON — treat as raw event
				addMessage({ kind: "rpc_event", event: { raw: e.data } });
			}
		});

		source.addEventListener("rpc_response", (e) => {
			if (disposedRef.current) return;
			try {
				const data = JSON.parse(e.data) as { type: "response"; [key: string]: unknown };
				addMessage({
					kind: "rpc_response",
					response: data,
				});
			} catch {
				// ignore
			}
		});

		source.addEventListener("extension_ui_request", (e) => {
			if (disposedRef.current) return;
			try {
				const data = JSON.parse(e.data) as ExtensionUiRequestMessage;
				if (INTERACTIVE_METHODS.has(data.method)) {
					setPendingUiRequest(data);
				} else {
					// Fire-and-forget — auto-ack via REST
					const ack = {
						type: "extension_ui_response",
						id: data.id,
						value: null,
						cancelled: false,
					};
					fetch(
						`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(ack),
						},
					).catch(() => {});
					setPendingUiRequest(null);
				}
			} catch {
				// ignore
			}
		});

		source.addEventListener("extension_ui_response", (e) => {
			if (disposedRef.current) return;
			try {
				const data = JSON.parse(e.data) as ExtensionUiResponseMessage;
				addMessage(data);
			} catch {
				// ignore
			}
		});

		source.addEventListener("set_model", (_e) => {
			if (disposedRef.current) return;
			try {
				const data = JSON.parse(_e.data);
				// The frontend handles set_model via the message processing effect
				// in ChatPanel, so we just add it to the messages buffer
				addMessage({
					kind: "rpc_response",
					response: data,
				});
			} catch {
				// ignore
			}
		});

		source.addEventListener("session_terminated", () => {
			if (disposedRef.current) return;
			setIsStreaming(false);
			setConversationState("disconnected");
			setErrorMessage("Session terminated");
		});

		// EventSource fires "open" on connect and re-connect
		source.addEventListener("open", () => {
			if (disposedRef.current) return;
			setErrorMessage(null);
			// We always transition to idle on connect.  The `get_state`
			// command is auto-sent after 300 ms; ChatPanel will fetch
			// history when it sees idle/streaming state.  Using the
			// stale `messages` closure here always evaluated to 0,
			// incorrectly forcing "loading" on reconnects and preventing
			// history reloads.
			setConversationState("idle");
		});

		// EventSource fires "error" on disconnect / re-connect attempt
		source.onerror = () => {
			if (disposedRef.current) return;
			// Don't change state here — EventSource auto-reconnects,
			// and the "open" event will fire when reconnect succeeds.
			if (source.readyState === EventSource.CLOSED) {
				setConversationState("disconnected");
				setErrorMessage("Connection lost");
			}
		};

		// Send initial get_state to trigger the streaming pipeline
		setTimeout(() => {
			if (!disposedRef.current && source.readyState === EventSource.OPEN) {
				fetch(
					`${API_BASE}/api/projects/cmd?session_id=${encodeURIComponent(sid)}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ command: "get_state" }),
					},
				).catch(() => {});
			}
		}, 300);

		return () => {
			disposedRef.current = true;
			if (sourceRef.current) {
				sourceRef.current.close();
				sourceRef.current = null;
			}
		};
	}, [sessionId]);

	// ── Memoized return value ──────────────────────────────────────────────

	return useMemo(
		() => ({
			state: conversationState,
			errorMessage,
			prompt,
			abort,
			compact,
			setAutoCompaction,
			messages,
			pendingUiRequest,
			respondToUi,
			isStreaming,
		}),
		[
			conversationState,
			errorMessage,
			prompt,
			abort,
			compact,
			setAutoCompaction,
			messages,
			pendingUiRequest,
			respondToUi,
			isStreaming,
		],
	);
}
