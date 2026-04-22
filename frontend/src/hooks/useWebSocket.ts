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

// ── Connection states ─────────────────────────────────────────────────────

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
	/** Set auto-compaction on/off */
	setAutoCompaction: (enabled: boolean) => void;
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
	/** Connection sequence number (increments on each reconnection) */
	connectionSequence: number;
}

// ── Interactive extension UI methods (need user input) ────────────────────

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
	const [connectionSequence, setConnectionSequence] = useState<number>(0);

	// Track whether cleanup has run (to prevent async setState after unmount)
	const disposedRef = useRef(false);
	// Track whether the user explicitly requested disconnect (to prevent unwanted reconnection)
	const shouldDisconnectRef = useRef(false);

	// Stable refs so doConnect can read current values without being recreated.
	// doConnect reads from these refs instead of the closure, giving it stable deps.
	const projectFolderRef = useRef(projectFolder);
	const sessionIdRef = useRef(sessionId);

	// Keep refs in sync with props — runs after render, not during.
	useEffect(() => {
		projectFolderRef.current = projectFolder;
	}, [projectFolder]);
	useEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

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

	// ── Disconnect helper ─────────────────────────────────────────────────

	const disconnect = useCallback(() => {
		shouldDisconnectRef.current = true; // Mark that user requested disconnect
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

	// Read from stable refs inside the callback body (not at render time).
	const doConnect = useCallback(() => {
		if (disposedRef.current) return;
		if (shouldDisconnectRef.current) return; // Don't reconnect if user requested disconnect

		// Prevent double connection attempts (StrictMode mounts twice in dev)
		if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
			// Already connecting, don't create another one
			return;
		}
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			// Already connected, don't create a duplicate connection
			return;
		}

		const folder = projectFolderRef.current;
		const sid = sessionIdRef.current;
		if (!folder || !sid) return;

		// Inline disconnect logic instead of calling disconnect() to avoid dependency
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		const existingWs = wsRef.current;
		if (existingWs) {
			existingWs.close(1000, "Reconnecting");
		}

		setState("connecting");
		setConnectionSequence((prev) => prev + 1); // Increment connection sequence

		// Use a relative path so Vite's dev proxy (configured for /api with
		// ws: true) routes the WebSocket upgrade to the backend at :8000.
		// In production both frontend and backend share the same origin.
		const wsUrl = `/api/projects/ws?session_id=${encodeURIComponent(sid)}`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			if (disposedRef.current) return;
			setState("connected");
			// Note: Do NOT call setMessages([]) here to avoid breaking message processing

			// Send initial get_state to trigger the streaming pipeline
			send({ type: "get_state" });

			// modelRef.current is read here (not as a useCallback dep)
			// so changes to currentModel don't trigger reconnection.
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
						// Clear pending UI request after successful auto-ack
						setPendingUiRequest(null);
					}
				} else if (parsed.kind === "extension_ui_response") {
					// Extension got a response — just log it
					setMessages((prev) => [
						...prev,
						parsed as ExtensionUiResponseMessage,
					]);
				} else if (parsed.type === "response") {
					// RPC response (get_state, set_model, etc.) — relay to frontend
					setMessages((prev) => [
						...prev,
						{
							kind: "rpc_response",
							response: parsed as Record<string, unknown>,
						},
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

			// Don't set state to disconnected if we're intentionally reconnecting
			// The reconnect flag check above prevents unwanted auto-reconnection
			if (!shouldDisconnectRef.current) {
				setState("error");
			} else {
				// Reset flag for manual reconnect
				shouldDisconnectRef.current = false;
				setState("disconnected");
			}

			// Only attempt reconnection if not intentional disconnect
			// and not a clean close (1000 = Normal closure)
			if (!shouldDisconnectRef.current && event.code !== 1000) {
				reconnectTimerRef.current = setTimeout(() => {
					if (!disposedRef.current && !shouldDisconnectRef.current) {
						doConnectRef.current();
					}
				}, 2000);
			}
		};
	}, [send]);

	// ── Lifecycle ──────────────────────────────────────────────────────────
	// Note: Use empty dep array to prevent re-connection loops
	// doConnect and disconnect are stored in refs, not closure deps
	useEffect(() => {
		disposedRef.current = false;
		shouldDisconnectRef.current = false; // Reset on mount
		// Set the ref for reconnect timer & manual reconnect button.
		doConnectRef.current = doConnect;
		// Clear any existing reconnect timer
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		doConnect();
		return () => {
			disposedRef.current = true;
			shouldDisconnectRef.current = true; // Set flag in cleanup
			// Clean up reconnect timer
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			disconnect();
		};
	}, []); // Empty deps - use refs instead of closure variables

	// ── Clear messages helper ──────────────────────────────────────────────

	const clearMessages = useCallback(() => {
		setMessages([]);
		send({ type: "get_messages" });
	}, [send]);

	// ── Abort helper ───────────────────────────────────────────────────────

	const abort = useCallback(() => {
		send({ type: "abort" });
	}, [send]);

	// ── Compact helper ─────────────────────────────────────────────────────

	const compact = useCallback(() => {
		send({ type: "compact" });
	}, [send]);

	// ── Reconnect helper ───────────────────────────────────────────────────

	const reconnect = useCallback(() => {
		setCloseCode(null);
		setCloseReason(null);
		shouldDisconnectRef.current = false; // Reset disconnect flag for manual reconnect
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		doConnectRef.current();
	}, []);

	// ── Auto-compaction helper ────────────────────────────────────────────

	const setAutoCompaction = useCallback(
		(enabled: boolean) => {
			send({ type: "set_auto_compaction", enabled });
		},
		[send],
	);

	// ── Error message helper ──────────────────────────────────────────────

	const errorMessage: string | null = (() => {
		if (state === "error") {
			if (closeCode === 4002)
				return closeReason || "Session not found or not running";
			if (closeReason) return closeReason;
			return "WebSocket connection lost";
		}
		return null;
	})();

	// ── Memoized return value ──────────────────────────────────────────────
	// Only returns a new object when state values actually change.
	// Without this, a new object on every render causes ChatPanel to
	// recreate handleSend (which depends on ws), triggering cascading
	// re-renders that tear down and reconnect the WebSocket.
	return useMemo(
		() => ({
			state,
			closeCode,
			closeReason,
			errorMessage,
			send,
			abort,
			compact,
			setAutoCompaction,
			messages,
			pendingUiRequest,
			respondToUi,
			disconnect,
			clearMessages,
			reconnect,
			connectionSequence,
		}),
		// Include all state values so the memo updates when connection state changes.
		// This is safe — the object only changes when the values actually change,
		// not on every render where state happens to be the same value.
		[
			state,
			closeCode,
			closeReason,
			send,
			abort,
			compact,
			setAutoCompaction,
			messages,
			pendingUiRequest,
			respondToUi,
			disconnect,
			clearMessages,
			reconnect,
			connectionSequence,
		],
	);
}
