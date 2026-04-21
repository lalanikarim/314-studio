import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "../store/AppContext";
import { useModels } from "../hooks/useModels";
import { useWebSocket } from "../hooks/useWebSocket";
import {
	closeSession,
	deleteSession,
	switchModel as apiSwitchModel,
} from "../services/api";
import type { Model } from "../types";
import "./components.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisplayMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers — extract content from Pi RPC events
// Per the official RPC protocol, message_update events contain:
//   event.assistantMessageEvent.delta    — streaming text chunk
//   event.assistantMessageEvent.partial.content[0].text — accumulated text

function extractText(event: Record<string, unknown>): string {
	// Direct fields (fallback for non-message_update events)
	if (typeof event.content === "string") return event.content;
	if (typeof event.text === "string") return event.text;
	if (typeof event.message === "string") return event.message;

	const ami = event.assistantMessageEvent as
		| {
				type?: string;
				delta?: unknown;
				partial?: { content?: unknown[] };
		  }
		| undefined;
	if (ami) {
		const deltaType = ami.type;

		// text_delta: single chunk in delta field
		if (deltaType === "text_delta") {
			const delta = ami.delta;
			if (typeof delta === "string" && delta) return delta;
		}

		// text_start / other: accumulated in partial.content[0].text
		const partial = ami.partial;
		if (partial) {
			const content = partial.content;
			if (Array.isArray(content) && content.length > 0) {
				const first = content[0];
				if (typeof first === "object" && first !== null && "text" in first) {
					const text = (first as { text: unknown }).text;
					if (typeof text === "string" && text) return text;
				}
			}
		}
	}

	return "";
}

function extractToolName(event: Record<string, unknown>): string | null {
	// Direct fields (fallback)
	if (typeof event.tool_name === "string") return event.tool_name;
	if (typeof event.command === "string") return event.command;
	if (typeof event.function === "string") return event.function;

	// assistantMessageEvent for toolcall events (per RPC protocol docs)
	const ami = event.assistantMessageEvent as
		| {
				type?: string;
				toolCall?: { name?: unknown };
		  }
		| undefined;
	if (ami) {
		const deltaType = ami.type;

		// toolcall_delta / toolcall_end: toolCall.name has the function name
		if (
			(deltaType === "toolcall_delta" || deltaType === "toolcall_end") &&
			ami.toolCall
		) {
			const name = ami.toolCall.name;
			if (typeof name === "string" && name) return name;
		}
	}

	return null;
}

function isStreamFinalizer(event: Record<string, unknown>): boolean {
	if (event.type === "end_turn" || event.type === "end") return true;
	if (event.type === "agent_end") return true;
	if (event.status === "done" || event.status === "finished") return true;
	if (event.type === "response" && event.id) return true;
	return false;
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

export default function ChatPanel() {
	const {
		currentModel,
		switchModel,
		setSelectedModel,
		setView,
		selectedFolder,
		sessionId: selectedSessionId,
	} = useApp();
	const { models } = useModels();

	// Model ref — kept in sync with currentModel so the WS hook always
	// knows which model to send `set_model` with on connect.
	const modelRef = useRef<Model | null>(currentModel);
	useEffect(() => {
		modelRef.current = currentModel;
	}, [currentModel]);

	// WebSocket connection (one per project — uses sessionId for WS URL)
	const ws = useWebSocket(selectedFolder, modelRef, selectedSessionId);

	// ── Display state: finalized messages ────────────────────────────────────
	const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);

	// ── Streaming state ─────────────────────────────────────────────────────
	const [streamingContent, setStreamingContent] = useState("");
	const [toolCallNames, setToolCallNames] = useState<string[]>([]);
	const isStreaming =
		streamingContent.trim().length > 0 || toolCallNames.length > 0;

	// ── Input state ──────────────────────────────────────────────────────────
	const [input, setInput] = useState("");
	const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
	const [closingState, setClosingState] = useState<
		"none" | "compact" | "delete"
	>("none");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// ── Progress tracking (how many inbound events we've processed) ──────────
	const processedCountRef = useRef(0);
	const prevConnectionSeqRef = useRef(ws.connectionSequence);

	// Reset display state on reconnection
	useEffect(() => {
		if (ws.connectionSequence !== prevConnectionSeqRef.current) {
			setDisplayMessages([]);
			setStreamingContent("");
			setToolCallNames([]);
			prevConnectionSeqRef.current = ws.connectionSequence;
		}
	}, [ws.connectionSequence]);

	// Scroll to bottom whenever messages or streaming content changes
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [displayMessages, streamingContent, toolCallNames]);

	// ── Process new RPC events from the hook ─────────────────────────────────
	useEffect(() => {
		// Reset processing on reconnection
		if (ws.connectionSequence !== prevConnectionSeqRef.current) {
			prevConnectionSeqRef.current = ws.connectionSequence;
			processedCountRef.current = 0;
		}

		if (ws.messages.length <= processedCountRef.current) return;

		const newMessages = ws.messages.slice(processedCountRef.current);

		for (const msg of newMessages) {
			if (msg.kind !== "rpc_event") continue;

			const event = msg.event as Record<string, unknown>;

			// ── End-of-stream marker → finalize current turn ───────────────
			if (isStreamFinalizer(event)) {
				if (streamingContent.trim() || toolCallNames.length > 0) {
					const lines = [
						...toolCallNames.map((tc) => `> ${tc}`),
						streamingContent.trim(),
					].filter(Boolean);

					if (lines.length) {
						// eslint-disable-next-line react-hooks/set-state-in-effect
						setDisplayMessages((prev) => [
							...prev,
							{
								id: `assistant-${Date.now()}`,
								role: "assistant",
								content: lines.join("\n\n"),
								timestamp: Date.now(),
							},
						]);
					}
				}
				setStreamingContent("");
				setToolCallNames([]);
				continue;
			}

			// ── Text content → accumulate ──────────────────────────────────
			const text = extractText(event);
			if (text) {
				setStreamingContent((prev) => prev + text);
			}

			// ── Tool call → track ──────────────────────────────────────────
			const toolName = extractToolName(event);
			if (toolName) {
				setToolCallNames((prev) => [...prev, toolName]);
			}
		}

		processedCountRef.current = ws.messages.length;
	}, [ws.messages]);

	// ── Send handler ─────────────────────────────────────────────────────────
	const handleSend = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed) return;

		// Finalize any current streaming content before the new user message
		if (streamingContent.trim() || toolCallNames.length > 0) {
			const lines = [
				...toolCallNames.map((tc) => `> ${tc}`),
				streamingContent.trim(),
			].filter(Boolean);

			if (lines.length) {
				setDisplayMessages((prev) => [
					...prev,
					{
						id: `assistant-${Date.now()}`,
						role: "assistant",
						content: lines.join("\n\n"),
						timestamp: Date.now(),
					},
				]);
			}
		}
		setStreamingContent("");
		setToolCallNames([]);

		// Add user message to display
		const userMsg: DisplayMessage = {
			id: `user-${Date.now()}`,
			role: "user",
			content: trimmed,
			timestamp: Date.now(),
		};
		setDisplayMessages((prev) => [...prev, userMsg]);
		setInput("");
		inputRef.current?.focus();

		// Forward to Pi via WebSocket
		ws.send(trimmed);
	}, [input, streamingContent, toolCallNames, ws]);

	// ── Model switcher ───────────────────────────────────────────────────────
	const handleSwitchModel = useCallback(
		(model: (typeof models)[0]) => {
			switchModel(model);
			setSelectedModel(model);
			setModelDropdownOpen(false);

			// Persist model change on backend so it survives WS reconnect
			if (selectedSessionId) {
				apiSwitchModel(selectedSessionId, model.id, model.provider).catch(
					(err) => console.warn("Failed to persist model switch:", err),
				);
			}

			// Send set_model RPC through the WS relay for immediate effect
			ws.send({
				type: "set_model",
				provider: model.provider,
				modelId: model.id,
			});
		},
		[switchModel, setSelectedModel, ws, selectedSessionId],
	);

	// ── Session close/delete ─────────────────────────────────────────────────
	const handleClose = useCallback(async () => {
		if (closingState !== "none") return;
		setClosingState("compact");
		try {
			await closeSession(selectedSessionId!);
			setView("folders");
		} catch (err) {
			console.error("Failed to close session:", err);
			setClosingState("none");
		}
	}, [closingState, selectedSessionId, setView]);

	const handleDelete = useCallback(async () => {
		if (closingState !== "none") return;
		setClosingState("delete");
		try {
			await deleteSession(selectedSessionId!);
			setView("folders");
		} catch (err) {
			console.error("Failed to delete session:", err);
			setClosingState("none");
		}
	}, [closingState, selectedSessionId, setView]);

	// ── Compact only (no terminate) ────────────────────────────────────────
	const handleCompact = useCallback(() => {
		if (closingState !== "none") return;
		setClosingState("compact");
		try {
			ws.compact();
			// Compact is async — reset state after a delay
			setTimeout(() => setClosingState("none"), 3000);
		} catch (err) {
			console.error("Failed to compact:", err);
			setClosingState("none");
		}
	}, [closingState, ws]);

	// ── Key handling ─────────────────────────────────────────────────────────
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	// ── Connection status label ──────────────────────────────────────────────
	const connectionLabel = (() => {
		switch (ws.state) {
			case "connected":
				return "Connected";
			case "connecting":
				return "Connecting…";
			case "error":
				return "Connection Error";
			case "disconnected":
				return "Disconnected";
		}
	})();

	const connectionColor = (() => {
		switch (ws.state) {
			case "connected":
				return "#22c55e";
			case "connecting":
				return "#eab308";
			case "error":
				return "#ef4444";
			case "disconnected":
				return "#475569";
		}
	})();

	// ── Pending UI request banner ────────────────────────────────────────────
	const renderPendingUi = () => {
		if (!ws.pendingUiRequest) return null;

		const req = ws.pendingUiRequest;
		const paramsText =
			typeof req.params === "string"
				? req.params
				: JSON.stringify(req.params, null, 2);

		return (
			<div className="ui-prompt-banner">
				<span className="ui-prompt-banner__method">{req.method}</span>
				<pre className="ui-prompt-banner__params">{paramsText}</pre>
				<div className="ui-prompt-banner__actions">
					<button
						className="btn btn--sm"
						onClick={() => ws.respondToUi(req.id, null, false)}
					>
						Cancel
					</button>
					<button
						className="btn btn--sm btn--primary"
						onClick={() => ws.respondToUi(req.id, true, false)}
					>
						Accept
					</button>
				</div>
			</div>
		);
	};

	// ── Empty state ──────────────────────────────────────────────────────────
	const isEmpty =
		displayMessages.length === 0 &&
		!streamingContent &&
		toolCallNames.length === 0;

	// ── Render ───────────────────────────────────────────────────────────────
	return (
		<div className="panel panel--chat">
			{/* Header */}
			<div className="panel__header panel__header--chat">
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span>Chat</span>
					<span
						className="chat-connection-indicator"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 4,
							fontSize: 11,
							color: connectionColor,
						}}
					>
						<span
							style={{
								width: 6,
								height: 6,
								borderRadius: "50%",
								background: connectionColor,
								display: "inline-block",
							}}
						/>
						{connectionLabel}
						{ws.state === "error" && (
							<button
								className="btn btn--sm btn--reconnect"
								onClick={() => ws.reconnect()}
								title="Reconnect"
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									width="14"
									height="14"
								>
									<path d="M1 4v6h6M23 20v-6h-6" />
									<path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
								</svg>
								Reconnect
							</button>
						)}
					</span>
				</div>

				{/* Error message banner */}
				{ws.errorMessage && (
					<div className="chat-error-banner">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="16"
							height="16"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="12" />
							<line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
						<span>{ws.errorMessage}</span>
					</div>
				)}

				{/* Model picker */}
				<div style={{ position: "relative" }}>
					<button
						className="model-picker__trigger"
						onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
						title="Switch model"
						disabled={ws.state !== "connected"}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="16"
							height="16"
						>
							<circle cx="12" cy="12" r="3" />
							<path d="M12 1v6m0 6v6M1 12h6m6 0h6" />
						</svg>
						<span className="model-picker__label">
							{currentModel?.name || "Select"}
						</span>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="12"
							height="12"
						>
							<path d="M6 9l6 6 6-6" />
						</svg>
					</button>
					{modelDropdownOpen && (
						<div className="model-picker__menu model-picker__menu--compact">
							{models.map((model) => (
								<button
									key={model.id}
									className={`model-picker__item ${currentModel?.id === model.id ? "model-picker__item--active" : ""}`}
									onClick={() => handleSwitchModel(model)}
								>
									<div className="model-picker__item-name">{model.name}</div>
									<div className="model-picker__item-meta">
										{model.provider}
									</div>
									{currentModel?.id === model.id && (
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											width="16"
											height="16"
										>
											<path d="M20 6L9 17l-5-5" />
										</svg>
									)}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Session controls */}
				<div style={{ display: "flex", gap: 4 }}>
					{closingState === "none" ? (
						<>
							<button
								className="btn btn--sm btn--compact"
								onClick={handleCompact}
								title="Compact conversation (reduce context size, session stays alive)"
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									width="14"
									height="14"
								>
									<circle cx="12" cy="12" r="10" />
									<path d="M12 6v6l4 2" />
								</svg>
								Compact
							</button>
							<button
								className="btn btn--sm btn--close"
								onClick={handleClose}
								title="Compact and close session"
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									width="14"
									height="14"
								>
									<path d="M18 6L6 18M6 6l12 12" />
								</svg>
								Close
							</button>
							<button
								className="btn btn--sm btn--delete"
								onClick={handleDelete}
								title="Delete session without compact"
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									width="14"
									height="14"
								>
									<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								</svg>
								Delete
							</button>
						</>
					) : (
						<span className="session-closing">
							{closingState === "compact" ? "Compacting…" : "Deleting…"}
						</span>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="panel__content panel__content--chat">
				{/* Pending UI banner (above messages) */}
				{renderPendingUi()}

				{/* Empty state */}
				{isEmpty && (
					<div className="chat-empty">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							width="48"
							height="48"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
						<p>Start a conversation with Pi</p>
						<p className="chat-empty__hint">Type a message below</p>
					</div>
				)}

				{/* User messages */}
				{displayMessages
					.filter((m) => m.role === "user")
					.map((msg) => (
						<div key={msg.id} className="chat-message chat-message--user">
							<div className="chat-message__avatar">You</div>
							<div className="chat-message__body">
								<div className="chat-message__role">
									You
									<span className="chat-message__time">
										{new Date(msg.timestamp).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
								</div>
								<div className="chat-message__content">{msg.content}</div>
							</div>
						</div>
					))}

				{/* Assistant messages (finalized) */}
				{displayMessages
					.filter((m) => m.role === "assistant")
					.map((msg) => (
						<div key={msg.id} className="chat-message chat-message--assistant">
							<div className="chat-message__avatar">π</div>
							<div className="chat-message__body">
								<div className="chat-message__role">
									Pi
									<span className="chat-message__time">
										{new Date(msg.timestamp).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
								</div>
								<div className="chat-message__content">{msg.content}</div>
							</div>
						</div>
					))}

				{/* Streaming assistant message (content arriving in real-time) */}
				{streamingContent || toolCallNames.length > 0 ? (
					<div
						className="chat-message chat-message--assistant"
						style={{ opacity: 0.9 }}
					>
						<div className="chat-message__avatar">π</div>
						<div className="chat-message__body">
							<div className="chat-message__role">
								Pi
								<span className="chat-message__time">typing…</span>
							</div>

							{/* Tool call badges */}
							{toolCallNames.length > 0 && (
								<div className="tool-call-badges">
									{toolCallNames.map((name, i) => (
										<span key={i} className="tool-call-badge">
											🔧 {name}
										</span>
									))}
								</div>
							)}

							{/* Streaming text */}
							<div className="chat-message__content streaming">
								{streamingContent || (
									<span className="chat-message__typing">
										<span />
										<span />
										<span />
									</span>
								)}
								{streamingContent && (
									<span className="streaming-cursor">▌</span>
								)}
							</div>
						</div>
					</div>
				) : null}

				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="panel__input">
				<input
					ref={inputRef}
					type="text"
					placeholder="Message Pi…"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={ws.state !== "connected" || isStreaming}
				/>
				{isStreaming ? (
					<button
						className="btn btn--abort"
						onClick={() => ws.abort()}
						title="Abort current turn"
					>
						<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
							<rect x="6" y="6" width="12" height="12" rx="2" />
						</svg>
					</button>
				) : (
					<button
						className="btn btn--send"
						onClick={handleSend}
						disabled={!input.trim() || ws.state !== "connected"}
					>
						<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
							<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
						</svg>
					</button>
				)}
			</div>
		</div>
	);
}
