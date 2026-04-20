/**
 * Hook: WebSocket connection to Pi RPC via FastAPI backend.
 *
 * Manages a single WebSocket per project, handles:
 *   - Connection / disconnection / reconnection
 *   - Sending messages (wraps plain text as prompt commands)
 *   - Routing inbound messages: rpc_event, extension_ui_request, extension_ui_response
 *   - Auto-acknowledging fire-and-forget extension UI methods
 *   - Sending initial set_model when the session starts
 */

import {
	useCallback,
	useRef,
	useEffect,
	useState,
	type MutableRefObject,
} from "react";
import type { Model } from "../types";

// ── Message types forwarded from backend ────────────────────────────────────

export interface RpcEventMessage {
	kind: "rpc_event";
	event: Record<string, unknown>;
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
	| ExtensionUiResponseMessage;

// ── Outbound message types ─────────────────────────────────────────────────

export type PlainTextMessage = string;

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

export type OutboundMessage =
	| PlainTextMessage
	| UiResponseMessage
	| RpcCommand
	| PromptMessage;

// ── Connection states ──────────────────────────────────────────────────────

export type ConnectionState =
	| "connecting"
	| "connected"
	| "disconnected"
	| "error";

export interface UseWebSocketReturn {
	/** Current connection state */
	state: ConnectionState;
	/** Close code from last WebSocket close event (null if not closed) */
	closeCode: number | null;
	/** Close reason from last WebSocket close event (null if not closed) */
	closeReason: string | null;
	/** Human-readable error message for the current state */
	errorMessage: string | null;
	/** Send a message to Pi (plain text or structured) */
	send: (data: OutboundMessage) => void;
	/** Abort current Pi turn without terminating session */
	abort: () => void;
	/** Compact conversation to reduce context size (session stays running) */
	compact: () => void;
	/** List of inbound messages (rpc_events, extension_ui_requests, etc.) */
	messages: InboundMessage[];
	/** Extension UI request currently awaiting user input */
	pendingUiRequest: ExtensionUiRequestMessage | null;
	/** Reply to an extension UI interactive prompt */
	respondToUi: (id: string, value: unknown, cancelled?: boolean) => void;
	/** Disconnect and clean up */
	disconnect: () => void;
	/** Clear message history */
	clearMessages: () => void;
	/** Reconnect the WebSocket */
	reconnect: () => void;
}

// ── Interactive extension UI methods (need user input) ──────────────────────

const INTERACTIVE_METHODS = new Set(["select", "confirm", "input", "editor"]);

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Create a WebSocket hook for a given project.
 *
 * @param projectFolder - The selected project folder name (from AppContext)
 * @param modelRef      - Ref to the current model (used to send set_model on connect)
 * @param sessionId     - Session id for the WS connection (stored in AppContext)
 * @returns WebSocket hook return value
 */
export function useWebSocket(
	projectFolder: string | null,
	modelRef: MutableRefObject<Model | null>,
	sessionId: string | null,
): UseWebSocketReturn {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const doConnectRef = useRef<() => void>(null as unknown as () => void);
	const [state, setState] = useState<ConnectionState>("disconnected");
	const [messages, setMessages] = useState<InboundMessage[]>([]);
	const [pendingUiRequest, setPendingUiRequest] =
		useState<ExtensionUiRequestMessage | null>(null);
	const [closeCode, setCloseCode] = useState<number | null>(null);
	const [closeReason, setCloseReason] = useState<string | null>(null);

	// Track whether cleanup has run (to prevent async setState after unmount)
	const disposedRef = useRef(false);

	// ── Send helper ────────────────────────────────────────────────────────

	const send = useCallback((data: OutboundMessage) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;

		if (typeof data === "string") {
			// Plain text → wrap as prompt command
			ws.send(JSON.stringify({ type: "prompt", message: data }));
		} else if ("kind" in data && data.kind === "extension_ui_response") {
			// Extension UI reply
			ws.send(JSON.stringify(data));
		} else {
			// RPC command — forward as-is with auto-generated id
			const command: RpcCommand = { ...(data as RpcCommand) };
			if (command.id === undefined) {
				command.id = crypto.randomUUID();
			}
			ws.send(JSON.stringify(command));
		}
	}, []);

	// ── UI reply helper ────────────────────────────────────────────────────

	const respondToUi = useCallback(
		(id: string, value: unknown, cancelled = false) => {
			const reply: UiResponseMessage = {
				kind: "extension_ui_response",
				type: "extension_ui_response",
				id,
				value,
				cancelled,
			};
			setPendingUiRequest(null);
			send(reply);
		},
		[send],
	);

	// ── Disconnect helper ──────────────────────────────────────────────────

	const disconnect = useCallback(() => {
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		const ws = wsRef.current;
		if (ws) {
			ws.close();
			wsRef.current = null;
		}
		if (!disposedRef.current) {
			setState("disconnected");
		}
	}, []);

	// ── Connect helper (defined before lifecycle so it's hoisted by ref) ───

	// eslint-disable-next-line react-hooks/immutability
	const doConnect = useCallback(() => {
		if (disposedRef.current) return;

		const targetProject = projectFolder || "";
		if (!targetProject || !sessionId) return;

		// Close any existing connection first
		disconnect();

		setState("connecting");

		const protocol = window.location.protocol === "https:" ? "wss" : "ws";
		const wsUrl = `${protocol}://${window.location.host}/api/projects/ws?session_id=${encodeURIComponent(sessionId)}`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			if (disposedRef.current) return;
			setState("connected");
			setMessages([]);

			// Send initial get_state to trigger the streaming pipeline
			send({ type: "get_state" });

			// Send set_model if a model was selected
			const model = modelRef.current;
			if (model) {
				send({
					type: "set_model",
					provider: model.provider,
					modelId: model.id,
				} as RpcCommand);
			}
		};

		ws.onmessage = (event) => {
			if (disposedRef.current) return;

			try {
				const parsed = JSON.parse(event.data);

				if (parsed.kind === "rpc_event") {
					// Streaming event from Pi (message content, tool calls, etc.)
					setMessages((prev) => [...prev, parsed as RpcEventMessage]);
				} else if (parsed.kind === "extension_ui_request") {
					const extReq = parsed as ExtensionUiRequestMessage;
					if (INTERACTIVE_METHODS.has(extReq.method)) {
						// Interactive — save for user input
						setPendingUiRequest(extReq);
					} else {
						// Fire-and-forget — auto-ack
						ws.send(
							JSON.stringify({
								type: "extension_ui_response",
								id: extReq.id,
								value: null,
								cancelled: false,
							} as UiResponseMessage),
						);
					}
				} else if (parsed.kind === "extension_ui_response") {
					// Extension got a response — just log it
					setMessages((prev) => [
						...prev,
						parsed as ExtensionUiResponseMessage,
					]);
				}
			} catch {
				// Non-JSON — treat as raw event
				setMessages((prev) => [
					...prev,
					{ kind: "rpc_event", event: { raw: event.data } },
				]);
			}
		};

		ws.onerror = () => {
			if (disposedRef.current) return;
			setState("error");
			setCloseCode(null);
			setCloseReason("Connection error");
		};

		ws.onclose = (event) => {
			if (disposedRef.current) return;

			setCloseCode(event.code);
			setCloseReason(event.reason || null);

			if (event.code === 1000) {
				// Clean close
				setState("disconnected");
			} else {
				// Unexpected close — try to reconnect
				setState("error");
				reconnectTimerRef.current = setTimeout(() => {
					if (!disposedRef.current) {
						doConnectRef.current();
					}
				}, 2000);
			}
		};
	}, [projectFolder, modelRef, disconnect, send]);

	// ── Lifecycle ──────────────────────────────────────────────────────────

	// Keep the ref in sync so the setTimeout callback can call it
	useEffect(() => {
		doConnectRef.current = doConnect;
	}, [doConnect]);

	useEffect(() => {
		disposedRef.current = false;
		doConnect();
		return () => {
			disposedRef.current = true;
			disconnect();
		};
	}, [doConnect, disconnect]);

	// ── Clear messages helper ──────────────────────────────────────────────

	const clearMessages = useCallback(() => {
		setMessages([]);
		send({ type: "get_messages" });
	}, [send]);

	// ── Abort helper ──────────────────────────────────────────────────────

	const abort = useCallback(() => {
		send({ type: "abort" });
	}, [send]);

	// ── Compact helper ───────────────────────────────────────────────────

	const compact = useCallback(() => {
		send({ type: "compact" });
	}, [send]);

	// ── Reconnect helper ─────────────────────────────────────────────────

	const reconnect = useCallback(() => {
		setCloseCode(null);
		setCloseReason(null);
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		doConnectRef.current();
	}, []);

	// ── Error message helper ─────────────────────────────────────────────

	const errorMessage: string | null = (() => {
		if (state === "error") {
			if (closeCode === 4002)
				return closeReason || "Session not found or not running";
			if (closeReason) return closeReason;
			return "WebSocket connection lost";
		}
		return null;
	})();

	return {
		state,
		closeCode,
		closeReason,
		errorMessage,
		send,
		abort,
		compact,
		messages,
		pendingUiRequest,
		respondToUi,
		disconnect,
		clearMessages,
		reconnect,
	};
}
