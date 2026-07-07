import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ChatStreamController } from '../lib/chat-stream-controller.js';
import {
  agentMessageToDisplay,
  extractText,
  extractThinking,
  extractToolCallDelta,
  extractToolCallEnd,
  extractToolCallResult,
  extractToolExecutionUpdate,
  isMessageEnd,
  isMessageTerminal,
  isTurnEnd,
  isAgentEnd,
} from '../lib/chat-processor.js';
import { createMinimalModel, extractProvider } from '../lib/model.js';
import { closeSession, deleteSession, switchModel, sendCommand } from '../services/api.js';
import { designTokens } from '../styles/design-tokens.js';
import { buttonStyles } from '../styles/shared.js';
import type { Model } from '../types/index.js';
import type {
  AgentMessage,
  ChatMessage,
  MessageContentBlock,
  ToolCallEntry,
  InboundMessage,
} from '../types/chat.js';

type MutableToolCallBlock = MessageContentBlock & { id?: string; result?: string };

/**
 * ChatPanel — main container for the chat interface.
 *
 * Architecture: Queue/Drain
 *
 *   SSE → Controller.queue[] → Component.drainQueue() → display
 *                                    │
 *                              accumulates deltas during streaming
 *                              on message_end: commits to displayMessages
 *                              on turn_end/agent_end: commits remaining
 *                              on tool_execution_update: updates tool results
 *
 * The controller owns transport (SSE connection, event parsing, queueing).
 * The component owns presentation (draining queue, building display messages).
 *
 * Key design principles:
 * - Every event in the queue is processed — nothing is dropped
 * - Finalization is driven by CONTENT-BEARING events (message_end, turn_end, agent_end)
 *   NOT by state transitions (prevIsStreaming)
 * - Streaming accumulators are reset only after content is committed
 */
@customElement('chat-panel')
export class ChatPanelElement extends LitElement {
  static styles = [
    designTokens,
    buttonStyles,
    css`
      :host {
        display: block;
        height: 100%;
        background: var(--bg-primary);
      }
      .chat-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* ── Header ────────────────────────────────────────────── */
      .chat-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
        flex-shrink: 0;
        gap: 0.5rem;
      }
      .chat-panel__header-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .chat-panel__header-right {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .chat-panel__model-selector {
        position: relative;
      }
      .chat-panel__model-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.75rem;
        background: var(--bg-hover);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 0.8125rem;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .chat-panel__model-btn:hover {
        background: var(--bg-active);
      }
      .chat-panel__model-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 0.25rem;
        min-width: 240px;
        max-height: 300px;
        overflow-y: auto;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        z-index: 100;
      }
      .chat-panel__model-option {
        display: block;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        color: var(--text-primary);
        font-size: 0.8125rem;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .chat-panel__model-option:hover {
        background: var(--bg-hover);
      }
      .chat-panel__model-option--active {
        background: var(--accent);
        color: #fff;
      }
      .chat-panel__model-option--active:hover {
        background: var(--accent-hover);
      }
      .chat-panel__status {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: var(--text-muted);
      }
      .chat-panel__status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .chat-panel__status-dot--streaming { background: var(--warning); }
      .chat-panel__status-dot--idle { background: var(--success); }
      .chat-panel__status-dot--error { background: var(--danger); }
      .chat-panel__status-dot--connecting { background: var(--info); animation: pulse 1s infinite; }

      /* ── Messages Area ─────────────────────────────────────── */
      .chat-panel__messages {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
      }
      .chat-panel__empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 2rem;
      }
      .empty__icon {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.5;
      }
      .empty__title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.5rem;
      }
      .empty__description {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
        max-width: 280px;
      }
      .chat-panel__streaming {
        padding: 0.75rem;
        background: var(--bg-secondary);
        border-radius: 8px;
        margin-bottom: 0.5rem;
        color: var(--text-secondary);
        font-size: 0.875rem;
        line-height: 1.6;
      }
      .chat-panel__streaming--thinking {
        border-left: 3px solid var(--accent);
        background: rgba(59, 130, 246, 0.05);
      }
      .chat-panel__streaming__label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--accent);
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .chat-panel__streaming--tools {
        border-left: 3px solid var(--warning);
        background: rgba(245, 158, 11, 0.05);
      }
      .chat-panel__streaming-indicator {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        color: var(--text-muted);
        font-size: 0.75rem;
        margin-top: 0.5rem;
      }
      .chat-panel__typing {
        display: inline-block;
        width: 3px;
        height: 12px;
        background: var(--accent);
        animation: blink 1s infinite;
      }

      /* ── Session Controls ──────────────────────────────────── */
      .chat-panel__btn-close {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8125rem;
        transition: all 0.15s ease;
      }
      .chat-panel__btn-close:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }
      .chat-panel__btn-close:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .chat-panel__btn--danger {
        color: var(--danger);
      }
      .chat-panel__btn--danger:hover:not(:disabled) {
        background: var(--danger-bg);
        color: var(--danger);
      }

      /* ── Error Banner ──────────────────────────────────────── */
      .chat-panel__error {
        margin: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--danger-bg);
        border: 1px solid var(--danger-border);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        font-size: 0.8125rem;
        color: var(--text-primary);
      }
      .chat-panel__error-close {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 0.25rem;
        font-size: 1rem;
        line-height: 1;
      }
      .chat-panel__error-close:hover {
        color: var(--text-primary);
      }

      /* ── Extension UI ──────────────────────────────────────── */
      .chat-panel__extension-ui {
        margin: 0.5rem;
        padding: 1rem;
        background: var(--bg-secondary);
        border: 1px solid var(--accent);
        border-radius: 8px;
      }
      .extension-ui__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
      }
      .extension-ui__method {
        font-weight: 600;
        color: var(--accent);
        font-size: 0.875rem;
      }
      .extension-ui__close {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 0.8125rem;
      }
      .extension-ui__close:hover {
        color: var(--text-primary);
      }
      .extension-ui__params {
        margin-bottom: 0.75rem;
      }
      .extension-ui__params pre {
        background: var(--bg-primary);
        padding: 0.75rem;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin: 0;
      }
      .extension-ui__actions {
        display: flex;
        gap: 0.5rem;
      }

      /* ── Clear Confirm ─────────────────────────────────────── */
      .chat-panel__clear-confirm {
        margin: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .clear-confirm__text {
        font-size: 0.8125rem;
        color: var(--text-secondary);
      }
      .clear-confirm__actions {
        display: flex;
        gap: 0.5rem;
      }

      /* ── Animations ────────────────────────────────────────── */
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
    `,
  ];

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

  @state() displayMessages: ChatMessage[] = [];
  @state() streamingContent = '';
  @state() streamingThinking = '';
  @state() toolCalls: ToolCallEntry[] = [];
  @state() modelDropdownOpen = false;
  @state() closingState: 'none' | 'compact' | 'delete' = 'none';
  @state() errorMessage: string | null = null;
  @state() showClearConfirm = false;
  @state() historyLoaded = false;

  private chatController!: ChatStreamController;
  private modelSetFromState = false;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  private sendingMessage = false; // Guard against duplicate sends

  // Streaming accumulators — reset after commit to displayMessages
  private streamingTextAccum = '';
  private streamingThinkingAccum = '';
  private streamingToolCalls: ToolCallEntry[] = [];
  private streamingMessageCreated = false; // Track if message created for current turn
  private queueDrainIndex = 0;

  connectedCallback() {
    super.connectedCallback();
    this.chatController = new ChatStreamController(this, this.sessionId);
    this.clickOutsideHandler = (e: Event) => {
      if (this.modelDropdownOpen && !this.shadowRoot?.contains(e.target as Node)) {
        this.modelDropdownOpen = false;
      }
    };
    document.addEventListener('click', this.clickOutsideHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('sessionId')) {
      this.chatController.setSessionId(this.sessionId);
      this.resetDisplayState();
      this.historyLoaded = false;

      if (this.sessionId) {
        setTimeout(() => this.loadChatHistory(), 500);
      }
    }

    // Reset sending guard when streaming starts (first streaming event received)
    if (this.chatController.isStreaming && this.sendingMessage) {
      this.sendingMessage = false;
    }

    // Drain ALL new messages from the queue — queue/drain architecture
    this.drainQueue();

    // Auto-scroll to bottom while streaming so the user always sees
    // the latest content (whether thinking, tool calls, or text).
    if (this.chatController.isStreaming) {
      this.scrollToBottom();
    }
  }

  // ========================================================================
  // Queue/Drain
  // ========================================================================

  /**
   * Drain new messages from the controller's queue.
   *
   * Processes every event in order, accumulating streaming deltas and
   * committing them to displayMessages when content-bearing events arrive
   * (message_end, turn_end, agent_end).
   */
  private drainQueue() {
    const messages = this.chatController.messages;
    if (this.queueDrainIndex >= messages.length) return;

    const newEventCount = messages.length - this.queueDrainIndex;

    let messageEnded = false;
    let turnEnded = false;
    let agentEnded = false;

    for (let i = this.queueDrainIndex; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.kind === 'rpc_response') {
        this.processRpcResponse(msg as InboundMessage);
        continue;
      }

      if (msg.kind !== 'rpc_event') continue;

      const event = (msg as any).event as Record<string, unknown>;

      // ── Streaming content accumulation ────────────────────────────
      const text = extractText(event);
      if (text !== null) {
        this.streamingTextAccum = text;
        this.streamingContent = this.streamingTextAccum;
        this.ensureStreamingMessage();
        this.updateStreamingMessageContent();
      }

      const thinking = extractThinking(event);
      if (thinking !== null) {
        this.streamingThinkingAccum = thinking;
        this.streamingThinking = this.streamingThinkingAccum;
        this.ensureStreamingMessage();
        this.updateStreamingMessageContent();
      }

      const toolCallDelta = extractToolCallDelta(event);
      if (toolCallDelta) {
        const isNew = this.streamingToolCalls.every((tc) => tc.id !== toolCallDelta.id);
        if (isNew) console.debug('[ChatStream] TOOL START:', toolCallDelta.name, toolCallDelta.id);
        this.upsertToolCall(toolCallDelta);
        this.ensureStreamingMessage();
        this.updateStreamingMessageContent();
      }

      const toolCallEnd = extractToolCallEnd(event);
      if (toolCallEnd) {
        console.debug('[ChatStream] TOOL END:', toolCallEnd.name, toolCallEnd.id);
        const idx = this.streamingToolCalls.findIndex((tc) => tc.id === toolCallEnd.id);
        if (idx >= 0) {
          const updated = [...this.streamingToolCalls];
          updated[idx] = toolCallEnd;
          this.streamingToolCalls = updated;
        } else {
          this.streamingToolCalls = [...this.streamingToolCalls, toolCallEnd];
        }
        this.ensureStreamingMessage();
        this.updateStreamingMessageContent();
      }

      // Tool call result — merge directly into the last assistant message's toolCall blocks by id
      const toolResult = extractToolCallResult(event);
      if (toolResult) {
        console.debug('[ChatStream] TOOL RESULT:', toolResult.id, 'len=', toolResult.result?.length);
        this.mergeToolResultIntoLastMessage(toolResult.id!, toolResult.result);
      }

      // Tool execution update — merge partial result directly into the last assistant message's toolCall blocks by id
      const toolExecUpdate = extractToolExecutionUpdate(event);
      if (toolExecUpdate) {
        this.mergeToolResultIntoLastMessage(toolExecUpdate.id, toolExecUpdate.partialText);
      }

      // ── Finalization triggers ─────────────────────────────────────
      if (isMessageEnd(event)) {
        this.applyFinalizedAssistantMessage(event);
        messageEnded = true;
        continue;
      }

      if (isTurnEnd(event)) turnEnded = true;
      if (isAgentEnd(event)) agentEnded = true;
    }

    // Commit any remaining accumulated content if the run ended
    if ((turnEnded || agentEnded) && !messageEnded) {
      this.commitStreamingMessage();
    }

    this.queueDrainIndex = messages.length;
  }

  /**
   * Ensure there's an assistant message in displayMessages for the current
   * streaming turn. Creates one if it doesn't exist, updates it if it does.
   * Only creates a new message on the FIRST content event of a turn.
   *
   * Tool-result-only turns are skipped — they get merged into the previous
   * assistant message instead of creating a new one.
   */
  private ensureStreamingMessage() {
    // If we've already created a message for this turn, just update it
    if (this.streamingMessageCreated) {
      this.updateStreamingMessageContent();
      return;
    }

    // Check if this turn has only tool results (no thinking, no text)
    const hasOnlyToolResults =
      !this.streamingThinkingAccum.trim() &&
      !this.streamingTextAccum.trim() &&
      this.streamingToolCalls.length > 0;

    if (hasOnlyToolResults) {
      // Merge tool result into the previous assistant message
      const prevMsg = this.displayMessages[this.displayMessages.length - 1];
      if (prevMsg && prevMsg.role === 'assistant') {
        for (const tc of this.streamingToolCalls) {
          for (let bi = 0; bi < prevMsg.content.length; bi++) {
            const pb = prevMsg.content[bi] as MutableToolCallBlock;
            if (pb.kind === 'toolCall' && pb.id === tc.id) {
              pb.result = tc.result ?? pb.result;
              break;
            }
          }
        }
        this.displayMessages = [...this.displayMessages]; // Trigger reactivity
      }
      return;
    }

    // Create a new assistant message for this turn
    const ts = Date.now();
    const contentBlocks: MessageContentBlock[] = [];

    if (this.streamingThinkingAccum.trim()) {
      contentBlocks.push({ kind: 'thinking', content: this.streamingThinkingAccum });
    }
    for (const tc of this.streamingToolCalls) {
      contentBlocks.push({
        kind: 'toolCall',
        id: tc.id,
        name: tc.name,
        args: tc.args,
        result: tc.result,
      });
    }
    if (this.streamingTextAccum.trim()) {
      contentBlocks.push({ kind: 'text', content: this.streamingTextAccum });
    }

    const newMsg: ChatMessage = {
      id: `assistant-streaming-${ts}`,
      role: 'assistant',
      timestamp: ts,
      content: contentBlocks,
    };
    this.displayMessages = [...this.displayMessages, newMsg];
    this.streamingMessageCreated = true;
  }

  /**
   * Update the content blocks of the last assistant message in displayMessages.
   */
  private updateStreamingMessageContent() {
    if (this.displayMessages.length === 0) return;
    const lastMsg = this.displayMessages[this.displayMessages.length - 1];
    if (lastMsg.role !== 'assistant') return;

    const contentBlocks: MessageContentBlock[] = [];

    if (this.streamingThinkingAccum.trim()) {
      contentBlocks.push({ kind: 'thinking', content: this.streamingThinkingAccum });
    }
    for (const tc of this.streamingToolCalls) {
      contentBlocks.push({
        kind: 'toolCall',
        id: tc.id,
        name: tc.name,
        args: tc.args,
        result: tc.result,
      });
    }
    if (this.streamingTextAccum.trim()) {
      contentBlocks.push({ kind: 'text', content: this.streamingTextAccum });
    }

    // Update the message in place (mutable)
    (lastMsg as any).content = contentBlocks;
    this.displayMessages = [...this.displayMessages]; // Trigger reactivity
  }

  /**
   * Commit accumulated streaming content to displayMessages.
   *
   * Fallback path — used only when turn_end/agent_end arrive without a
   * preceding message_end (should be rare). The normal commit path uses
   * applyFinalizedAssistantMessage which reads event.message directly.
   */
  private commitStreamingMessage() {
    // Skip if there's no content to commit
    const textContent = this.streamingTextAccum.trim();
    const thinkingContent = this.streamingThinkingAccum.trim();
    if (!textContent && !thinkingContent && this.streamingToolCalls.length === 0) {
      this.streamingTextAccum = '';
      this.streamingThinkingAccum = '';
      this.streamingContent = '';
      this.streamingThinking = '';
      this.streamingToolCalls = [];
      this.streamingMessageCreated = false;
      return;
    }

    this.updateStreamingMessageContent();

    this.streamingTextAccum = '';
    this.streamingThinkingAccum = '';
    this.streamingContent = '';
    this.streamingThinking = '';
    this.streamingToolCalls = [];
    this.streamingMessageCreated = false;
  }

  /**
   * Apply a finalized assistant message from a message_end event.
   *
   * Reads event.message directly — the same canonical AgentMessage shape
   * that get_messages hydration reads — instead of the accumulator-based
   * reconstruction. This ensures the live view matches the persisted
   * history exactly.
   *
   * If a live-preview streaming message exists in displayMessages, it is
   * replaced with the finalized version. Otherwise the message is appended.
   */
  private applyFinalizedAssistantMessage(event: Record<string, unknown>) {
    const msg = (event as any).message;
    if (!msg || typeof msg !== 'object') return;

    const displayMsgs = agentMessageToDisplay(msg as AgentMessage);
    const lastIdx = this.displayMessages.length - 1;
    const isStreamingMsg =
      lastIdx >= 0 &&
      typeof this.displayMessages[lastIdx].id === 'string' &&
      this.displayMessages[lastIdx].id.startsWith('assistant-streaming-');

    // Debug: log when finalized message is empty and streaming msg exists
    if (displayMsgs.length === 0 && isStreamingMsg) {
      console.debug('[ChatStream] FINALIZED: empty displayMsgs but streaming msg exists — removing placeholder. msg.role=', (msg as any).role, 'msg.content=', JSON.stringify((msg as any).content)?.substring(0, 200));
    }

    if (displayMsgs.length > 0) {
      if (isStreamingMsg) {
        const updated = [...this.displayMessages];
        updated[lastIdx] = displayMsgs[0];
        this.displayMessages = updated;
      } else {
        this.displayMessages = [...this.displayMessages, ...displayMsgs];
      }
    } else if (isStreamingMsg) {
      this.displayMessages = this.displayMessages.slice(0, -1);
    }

    // Reset accumulators — the canonical message has replaced them
    this.streamingTextAccum = '';
    this.streamingThinkingAccum = '';
    this.streamingContent = '';
    this.streamingThinking = '';
    this.streamingToolCalls = [];
    this.streamingMessageCreated = false;
  }

  /**
   * Merge a tool call result (or partial result) into the last assistant
   * message's toolCall blocks by id.
   *
   * Works regardless of whether the message is still being live-previewed
   * or has already been committed via message_end — avoids the accumulator
   * race condition where commitStreamingMessage resets streamingToolCalls
   * before tool_execution_end can find its matching block.
   */
  private mergeToolResultIntoLastMessage(toolCallId: string, result: string) {
    const lastIdx = this.displayMessages.length - 1;
    if (lastIdx < 0 || this.displayMessages[lastIdx].role !== 'assistant') return;

    const msg = this.displayMessages[lastIdx];
    let changed = false;
    const newContent = msg.content.map(block => {
      if (block.kind === 'toolCall' && block.id === toolCallId && block.result !== result) {
        changed = true;
        return { ...block, result } as MutableToolCallBlock;
      }
      return block;
    });

    if (changed) {
      const updated = [...this.displayMessages];
      updated[lastIdx] = { ...msg, content: newContent };
      this.displayMessages = updated;
    }
  }

  /**
   * Upsert a tool call entry by id (or name as fallback).
   * Handles incremental updates from toolcall_delta events.
   */
  private upsertToolCall(tc: ToolCallEntry) {
    const idx = this.streamingToolCalls.findIndex(
      (existing) => existing.id === tc.id || existing.name === tc.name,
    );

    if (idx >= 0) {
      const updated = [...this.streamingToolCalls];
      const merged = { ...updated[idx] };

      if (tc.id && !merged.id) merged.id = tc.id;
      if (tc.name) merged.name = tc.name;
      if (tc.args !== undefined) merged.args = tc.args;
      if (tc.result !== undefined) merged.result = tc.result;

      updated[idx] = merged;
      this.streamingToolCalls = updated;
    } else {
      this.streamingToolCalls = [...this.streamingToolCalls, tc];
    }
  }

  // ========================================================================
  // RPC Response processing
  // ========================================================================

  private processRpcResponse(msg: InboundMessage) {
    if (msg.kind !== 'rpc_response') return;

    const response = (msg as any).response;
    const command = response.command || response.commandName;

    // ── get_messages: hydrate chat history ──────────────────────────
    if (command === 'get_messages') {
      this.applyHistoryResponse(response);
      this.historyLoaded = true;
      return;
    }

    // ── get_state: update current model from session state ──────────
    if (command === 'get_state' && !this.modelSetFromState) {
      const model = (response.data as any)?.model;
      if (model && typeof model.id === 'string' && typeof model.provider === 'string') {
        this.currentModel = createMinimalModel(model.id, model.provider);
        this.modelSetFromState = true;
      } else if (typeof response.modelId === 'string' && response.modelId) {
        const provider = extractProvider(response.modelId);
        this.currentModel = createMinimalModel(response.modelId, provider);
        this.modelSetFromState = true;
      }
    } else if (command === 'compact') {
      this.streamingContent = '';
      this.streamingToolCalls = [];
      this.closingState = 'none';
    } else if (command === 'abort') {
      this.streamingContent = '';
      this.streamingToolCalls = [];
    }
  }

  // ========================================================================
  // History loading
  // ========================================================================

  private async loadChatHistory() {
    if (this.historyLoaded || !this.sessionId) return;

    try {
      const result = await sendCommand(this.sessionId, { command: 'get_messages' });
      const rpcResponse = (result as any)?.response ?? result;
      this.applyHistoryResponse(rpcResponse);
      this.historyLoaded = true;
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  private applyHistoryResponse(response: Record<string, unknown>) {
    const messages =
      ((response?.data as any)?.messages as any[]) ||
      ((response as any)?.messages as any[]) ||
      [];

    const raw = messages.flatMap((m: any) => agentMessageToDisplay(m));
    const merged = this.mergeHistoryToolResults(raw);

    if (merged.length > 0) {
      this.displayMessages = [...this.displayMessages, ...merged];
      this.scrollToBottom();
    }
  }

  /**
   * Merge all assistant and toolResult messages within each turn into a
   * single assistant message. Pi returns separate AgentMessages for each
   * step (assistant→toolResult→assistant), but they represent one coherent
   * turn that should display as a single message.
   *
   * Strategy:
   * 1. Group messages by turn (split on user messages)
   * 2. For each turn: merge all assistant + toolResult messages into one
   * 3. Within the merged message: match toolResult.toolCall.id → assistant.toolCall.id and update result
   */
  private mergeHistoryToolResults(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      if (msg.role === 'user') {
        // User message: just push
        result.push(msg);
        i++;
        continue;
      }

      if (msg.role === 'assistant') {
        // Start of a new turn — collect all assistant + toolResult messages
        const turnBlocks: MessageContentBlock[] = [...msg.content];
        i++;

        // Collect subsequent assistant messages in the same turn.
        // Note: ChatMessage.role is 'user' | 'assistant' only — tool results
        // have already been converted to toolCall content blocks by
        // agentMessageToDisplay, so no 'toolResult' role exists here.
        while (i < messages.length && messages[i].role !== 'user') {
          const next = messages[i];
          if (next.role === 'assistant') {
            turnBlocks.push(...next.content);
            i++;
          } else {
            // Unexpected role in turn, push and break
            result.push(next);
            i++;
            break;
          }
        }

        // Now merge toolResults into matching toolCalls
        const merged = this.mergeToolResultsIntoAssistantBlocks(turnBlocks);
        result.push({
          ...msg,
          timestamp: msg.timestamp,
          content: merged,
        });
        continue;
      }

      // Other roles (shouldn't happen): push as-is
      result.push(msg);
      i++;
    }

    return result;
  }

  /**
   * Merge toolResult blocks into matching toolCall blocks by id.
   * Returns a new block array with results filled in.
   */
  private mergeToolResultsIntoAssistantBlocks(
    blocks: MessageContentBlock[],
  ): MessageContentBlock[] {
    const result: MessageContentBlock[] = [];
    const resultById = new Map<string, string>();

    // First pass: collect all toolResults by id
    for (const block of blocks) {
      if (
        block.kind === 'toolCall' &&
        block.result !== undefined &&
        block.result !== ''
      ) {
        resultById.set(block.id!, block.result);
      }
    }

    // Second pass: rebuild blocks, filling in results
    for (const block of blocks) {
      // Skip toolResults that already have result — they were used in
      // the first pass to populate resultById. The matching toolCall
      // (without result) is rebuilt below with the result filled in.
      if (block.kind === 'toolCall' && block.result !== undefined && block.result !== '') {
        continue;
      }
      if (block.kind === 'toolCall' && block.id && resultById.has(block.id)) {
        const existing = block as MutableToolCallBlock;
        existing.result = resultById.get(block.id) ?? existing.result;
        result.push(existing);
      } else {
        result.push(block);
      }
    }

    return result;
  }

  // ========================================================================
  // State management
  // ========================================================================

  private resetDisplayState() {
    this.displayMessages = [];
    this.streamingContent = '';
    this.streamingThinking = '';
    this.streamingTextAccum = '';
    this.streamingThinkingAccum = '';
    this.streamingToolCalls = [];
    this.streamingMessageCreated = false;
    this.queueDrainIndex = 0;
    this.modelSetFromState = false;
    this.errorMessage = null;
  }

  // ========================================================================
  // User actions
  // ========================================================================

  private handleSend(message: string) {
    // Guard against duplicate sends (race condition between prompt() and
    // isStreaming becoming true — send button stays enabled during this window)
    if (this.sendingMessage) return;
    this.sendingMessage = true;

    // Commit any current streaming content before sending new message
    if (this.streamingTextAccum.trim() || this.streamingThinkingAccum.trim() || this.streamingToolCalls.length > 0) {
      this.commitStreamingMessage();
    }

    this.streamingContent = '';
    this.streamingThinking = '';
    this.streamingTextAccum = '';
    this.streamingThinkingAccum = '';
    this.streamingToolCalls = [];

    // Add user message to display
    this.displayMessages = [
      ...this.displayMessages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        timestamp: Date.now(),
        content: [{ kind: 'text', content: message }],
      },
    ];

    this.chatController.prompt(message);
    this.scrollToBottom();
  }

  private handleSwitchModel(model: Model) {
    if (!this.sessionId) return;

    this.modelDropdownOpen = false;
    this.currentModel = model;

    const provider = extractProvider(model.id);

    switchModel(this.sessionId, model.id, provider).catch((err) => {
      console.error('Failed to switch model:', err);
      this.errorMessage = `Failed to switch model: ${(err as Error).message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });

    sendCommand(this.sessionId, {
      command: 'set_model',
      modelId: model.id,
      provider: provider,
    }).catch((err) => {
      console.error('Failed to send set_model command:', err);
    });

    this.chatController.setModel(model.id, provider);

    this.dispatchEvent(
      new CustomEvent('model-switch', {
        detail: model,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleCompact() {
    if (!this.sessionId || this.closingState !== 'none') return;
    this.closingState = 'compact';

    this.chatController.compact().catch((err) => {
      console.error('Failed to compact:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to compact: ${(err as Error).message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });
  }

  private handleAbort() {
    this.chatController.abort();
    this.streamingContent = '';
    this.streamingThinking = '';
    this.streamingTextAccum = '';
    this.streamingThinkingAccum = '';
    this.streamingToolCalls = [];
  }

  private async handleCloseSession() {
    if (!this.sessionId || this.closingState !== 'none') return;
    this.closingState = 'compact';

    try {
      await closeSession(this.sessionId);
      this.dispatchEvent(new CustomEvent('session-close', {
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      console.error('Failed to close session:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to close: ${(err as Error).message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    }
  }

  private handleDelete() {
    if (!this.sessionId || this.closingState !== 'none') return;
    this.closingState = 'delete';

    deleteSession(this.sessionId).catch((err) => {
      console.error('Failed to delete:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to delete: ${(err as Error).message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });

    this.dispatchEvent(new CustomEvent('session-delete', {
      bubbles: true,
      composed: true,
    }));
  }

  // ========================================================================
  // Utilities
  // ========================================================================

  private get sortedMessages(): ChatMessage[] {
    return [...this.displayMessages].sort((a, b) => a.timestamp - b.timestamp);
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      const messagesContainer = this.shadowRoot?.querySelector('.chat-panel__messages');
      if (messagesContainer) {
        messagesContainer.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth',
        });
      }
    });
  }

  private getModelName(): string {
    return this.currentModel?.name || 'Select model';
  }

  private clearError() {
    this.errorMessage = null;
  }

  private clearChat() {
    this.showClearConfirm = !this.showClearConfirm;
  }

  private confirmClearChat() {
    this.displayMessages = [];
    this.streamingContent = '';
    this.streamingToolCalls = [];
    this.queueDrainIndex = 0;
    this.showClearConfirm = false;
  }

  private respondToUi(value: unknown | null) {
    if (this.chatController.pendingUiRequest) {
      this.chatController.respondToUi(
        this.chatController.pendingUiRequest.id,
        value,
        value === null,
      );
    }
  }

  // ========================================================================
  // Render
  // ========================================================================

  render() {
    return html`
      <div class="chat-panel">
        <!-- Header -->
        <div class="chat-panel__header">
          <div class="chat-panel__header-left">
            <div class="chat-panel__model-selector">
              <button
                class="chat-panel__model-btn"
                @click=${() => (this.modelDropdownOpen = !this.modelDropdownOpen)}
              >
                ${this.getModelName()}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="transition: transform 0.15s; ${this.modelDropdownOpen ? 'transform: rotate(180deg);' : ''}">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              ${this.modelDropdownOpen ? this.renderModelDropdown() : ''}
            </div>

            <span class="chat-panel__status">
              <span
                class="chat-panel__status-dot ${this.chatController.isStreaming
                  ? 'chat-panel__status-dot--streaming'
                  : (this.chatController.state === 'error' || this.chatController.state === 'disconnected')
                  ? 'chat-panel__status-dot--error'
                  : this.chatController.state === 'connecting'
                  ? 'chat-panel__status-dot--connecting'
                  : 'chat-panel__status-dot--idle'}"
              ></span>
              ${this.chatController.isStreaming
                ? 'Streaming'
                : this.chatController.state === 'error' || this.chatController.state === 'disconnected'
                ? 'Disconnected'
                : this.chatController.state === 'connecting'
                ? 'Connecting'
                : 'Idle'}
            </span>
          </div>

          <div class="chat-panel__header-right">
            <button
              class="chat-panel__btn-close"
              ?disabled=${this.closingState !== 'none'}
              @click=${this.clearChat}
              title="Clear chat"
            >
              Clear
            </button>
            <button
              class="chat-panel__btn-close"
              ?disabled=${this.closingState !== 'none'}
              @click=${this.handleCompact}
              title="Compact session"
            >
              Compact
            </button>
            <button
              class="chat-panel__btn-close"
              ?disabled=${this.closingState !== 'none'}
              @click=${this.handleCloseSession}
              title="Close session (compact + terminate)"
            >
              Close
            </button>
            <button
              class="chat-panel__btn-close chat-panel__btn--danger"
              ?disabled=${this.closingState !== 'none'}
              @click=${this.handleDelete}
              title="Delete session"
            >
              Delete
            </button>
          </div>
        </div>

        <!-- Error Message -->
        ${this.errorMessage
          ? html`<div class="chat-panel__error">
              <span>⚠️ ${this.errorMessage}</span>
              <button class="chat-panel__error-close" @click=${this.clearError}>✕</button>
            </div>`
          : ''}

        <!-- Extension UI Request -->
        ${this.chatController.pendingUiRequest
          ? this.renderExtensionUI()
          : ''}

        <!-- Clear Chat Confirm -->
        ${this.showClearConfirm
          ? html`<div class="chat-panel__clear-confirm">
              <span class="clear-confirm__text">Clear all messages?</span>
              <div class="clear-confirm__actions">
                <button class="btn btn--sm" @click=${() => (this.showClearConfirm = false)}>Cancel</button>
                <button class="btn btn--primary btn--sm" @click=${this.confirmClearChat}>Clear</button>
              </div>
            </div>`
          : ''}

        <!-- Messages Area -->
        <div class="chat-panel__messages">
          ${this.displayMessages.length === 0 && !this.streamingContent
            ? html`<div class="chat-panel__empty">
                <div class="empty__icon">💬</div>
                <h3 class="empty__title">Start a conversation</h3>
                <p class="empty__description">
                  Send a message to Pi and it will help you with your code.
                </p>
              </div>`
            : html`
                ${this.renderMessages()}
                ${this.chatController.isStreaming
                  ? html`
                      <div class="chat-panel__streaming-indicator">
                        <span class="chat-panel__typing"></span>
                        Pi is typing...
                      </div>
                    `
                  : ''}
              `}
        </div>

        <!-- Input Bar -->
        <chat-input
          ?disabled=${this.closingState !== 'none'}
          ?isStreaming=${this.chatController.isStreaming}
          @send-message=${(e: CustomEvent<string>) => this.handleSend(e.detail)}
          @abort-message=${() => this.handleAbort()}
        ></chat-input>
      </div>
    `;
  }

  private static _lastRenderSignature = '';

  private renderMessages() {
    const msgs = this.sortedMessages;
    const signature = msgs.map((m) => `${m.role}:${m.content.length}:${m.content.map((b) => b.kind).join(',')}`).join('|');
    if (signature !== ChatPanelElement._lastRenderSignature) {
      for (const msg of msgs) {
        console.debug('[ChatStream] RENDER:', msg.role, 'blocks=', msg.content.length, msg.content.map((b) => b.kind).join(','));
      }
      ChatPanelElement._lastRenderSignature = signature;
    }
    return msgs.map(
      (msg) => html`
        <chat-message
          .role=${msg.role}
          .timestamp=${msg.timestamp}
          .contentBlocks=${msg.content}
        ></chat-message>
      `,
    );
  }

  private renderModelDropdown() {
    if (this.models.length === 0) {
      return html`<div class="chat-panel__model-dropdown">
        <div style="padding: 0.75rem; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">
          No models available
        </div>
      </div>`;
    }

    return html`
      <div class="chat-panel__model-dropdown">
        ${this.models.map(
          (model) => html`
            <button
              class="chat-panel__model-option ${this.currentModel?.id === model.id
                ? 'chat-panel__model-option--active'
                : ''}"
              @click=${() => this.handleSwitchModel(model)}
            >
              <div style="font-weight: 500;">${model.name}</div>
              <div style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.25rem;">
                ${model.provider} ${model.contextWindow > 0 ? `· ${model.contextWindow.toLocaleString()} ctx` : ''}
              </div>
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderExtensionUI() {
    const req = this.chatController.pendingUiRequest;
    if (!req) return html``;

    return html`
      <div class="chat-panel__extension-ui">
        <div class="extension-ui__header">
          <span class="extension-ui__method">🔧 ${req.method}</span>
          <button class="extension-ui__close" @click=${() => this.respondToUi(null)}>Cancel</button>
        </div>
        <div class="extension-ui__params">
          <pre>${typeof req.params === 'string' ? req.params : JSON.stringify(req.params, null, 2)}</pre>
        </div>
        <div class="extension-ui__actions">
          <button class="btn btn--sm" @click=${() => this.respondToUi(null)}>Cancel</button>
          <button class="btn btn--primary btn--sm" @click=${() => this.respondToUi(true)}>Accept</button>
        </div>
      </div>
    `;
  }
}
