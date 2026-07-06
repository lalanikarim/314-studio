import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ChatStreamController } from '../lib/chat-stream-controller.js';
import { agentMessageToDisplay, extractText, extractToolCall, isStreamFinalizer } from '../lib/chat-processor.js';
import { deriveModelName, createMinimalModel, extractProvider } from '../lib/model.js';
import { closeSession, deleteSession, switchModel, sendCommand } from '../services/api.js';
import { designTokens } from '../styles/design-tokens.js';
import { buttonStyles } from '../styles/shared.js';
import type { Model } from '../types/index.js';
import type { DisplayMessage, ToolCallEntry, InboundMessage } from '../types/chat.js';

/**
 * ChatPanel — main container for the chat interface.
 *
 * Wires together:
 * - ChatStreamController for SSE transport
 * - Message processing helpers for converting RPC events to display messages
 * - Sub-components: chat-message, chat-input, chat-tool-call
 *
 * Handles:
 * - SSE streaming state management
 * - Message processing and display
 * - User input handling (send/abort)
 * - Model switching
 * - Session controls (compact/close/delete)
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

  @state() processedCount = 0;
  @state() displayMessages: DisplayMessage[] = [];
  @state() streamingContent = '';
  @state() toolCalls: ToolCallEntry[] = [];
  @state() modelDropdownOpen = false;
  @state() closingState: 'none' | 'compact' | 'delete' = 'none';
  @state() errorMessage: string | null = null;
  @state() showClearConfirm = false;
  @state() historyLoaded = false;

  private chatController!: ChatStreamController;
  private modelSetFromState = false;
  private clickOutsideHandler: ((e: Event) => void) | null = null;
  // Track previous streaming state to detect transitions
  private prevIsStreaming = false;

  connectedCallback() {
    super.connectedCallback();
    this.chatController = new ChatStreamController(this, this.sessionId);
    // Add click-outside listener for dropdown
    this.clickOutsideHandler = (e: Event) => {
      if (this.modelDropdownOpen && !this.shadowRoot?.contains(e.target as Node)) {
        this.modelDropdownOpen = false;
      }
    };
    document.addEventListener('click', this.clickOutsideHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove click-outside listener
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
    // Controller auto-disconnects via hostDisconnected
  }

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('sessionId')) {
      this.chatController.setSessionId(this.sessionId);
      this.resetDisplayState();
      this.historyLoaded = false;
      this.prevIsStreaming = false;
      
      // Load chat history after SSE connects
      if (this.sessionId) {
        setTimeout(() => {
          this.loadChatHistory();
        }, 500);
      }
    }
    this.processNewMessages();
  }

  private async loadChatHistory() {
    if (this.historyLoaded || !this.sessionId) return;
    
    try {
      await sendCommand(this.sessionId, { command: 'get_messages' });
      this.historyLoaded = true;
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  // ── State Management ────────────────────────────────────────

  private resetDisplayState() {
    this.processedCount = 0;
    this.displayMessages = [];
    this.streamingContent = '';
    this.toolCalls = [];
    this.modelSetFromState = false;
    this.errorMessage = null;
  }

  // ── Message Processing ──────────────────────────────────────

  private processNewMessages() {
    const newMessages = this.chatController.messages.slice(this.processedCount);
    if (newMessages.length === 0) return;

    // Capture streaming state BEFORE processing (like React's prevIsStreamingRef)
    const wasStreaming = this.prevIsStreaming;
    const streamingEnded = !this.chatController.isStreaming && wasStreaming;

    // Debug: log event types to understand format
    if (newMessages.length <= 3) {
      console.log('[ChatPanel] Processing', newMessages.length, 'new messages');
      newMessages.forEach((msg, i) => {
        if (msg.kind === 'rpc_event') {
          console.log(`[ChatPanel] Event ${i}:`, JSON.stringify(msg.event).substring(0, 200));
        } else if (msg.kind === 'rpc_response') {
          console.log(`[ChatPanel] Response ${i}:`, JSON.stringify(msg.response).substring(0, 200));
        }
      });
    }

    let finalizerSeen = false;

    // Process ALL messages (rpc_response and rpc_event)
    for (const msg of newMessages) {
      if (msg.kind === 'rpc_response') {
        this.processRpcResponse(msg as any);
        continue;
      }
      
      if (msg.kind !== 'rpc_event') continue;

      const event = (msg as any).event;
      const eventType = event.type || '';

      // Track streaming state transitions
      if (
        eventType === 'turn_start' ||
        eventType === 'agent_start' ||
        eventType === 'message_start'
      ) {
        this.prevIsStreaming = true;
        this.streamingContent = '';
        this.toolCalls = [];
      } else if (
        eventType === 'agent_end' ||
        eventType === 'turn_end'
      ) {
        // Finalizer events also update streaming state
        this.prevIsStreaming = false;
      }

      // Extract text — ACCUMULATE (append) not replace
      const text = extractText(event);
      if (text) {
        this.streamingContent += text;
      }

      // Extract tool call with update logic
      const toolCall = extractToolCall(event);
      if (toolCall) {
        const existingIdx = this.toolCalls.findIndex(
          (tc) => tc.name === toolCall.name
        );
        
        if (existingIdx >= 0) {
          // Update existing tool call
          const updated = [...this.toolCalls];
          if (toolCall.args) {
            updated[existingIdx] = { ...updated[existingIdx], args: toolCall.args };
          }
          if (toolCall.result) {
            updated[existingIdx] = { ...updated[existingIdx], result: toolCall.result };
          }
          this.toolCalls = updated;
        } else {
          // Add new tool call
          this.toolCalls = [...this.toolCalls, toolCall];
        }
      }

      // Check for finalizer
      if (isStreamFinalizer(event)) {
        finalizerSeen = true;
        this.prevIsStreaming = false;
      }
    }

    // Finalize ONLY when streaming JUST ended AND a finalizer was seen
    if (streamingEnded && finalizerSeen) {
      this.finalizeStreamingMessage();
    }

    this.processedCount = this.chatController.messages.length;
  }

  private processRpcResponse(msg: InboundMessage) {
    if (msg.kind !== 'rpc_response') return;

    const response = (msg as any).response;
    const command = response.command || response.commandName;

    // Handle get_messages response (chat history)
    // React checks: response.type === "response" && response.command === "get_messages"
    if (
      (response.type === 'response' || response.type === 'get_messages') &&
      command === 'get_messages'
    ) {
      const messages = (response.data as any)?.messages || (response as any).messages || [];
      const history = messages
        .map(agentMessageToDisplay)
        .filter((m): m is DisplayMessage => m !== null);
      
      if (history.length > 0) {
        this.displayMessages = [...this.displayMessages, ...history];
        this.scrollToBottom();
      }
      this.historyLoaded = true;
      return;
    }
    
    // Also try without type check (for some backend response formats)
    if (command === 'get_messages' && !response.type) {
      const messages = (response.data as any)?.messages || (response as any).messages || [];
      const history = messages
        .map(agentMessageToDisplay)
        .filter((m): m is DisplayMessage => m !== null);
      
      if (history.length > 0) {
        this.displayMessages = [...this.displayMessages, ...history];
        this.scrollToBottom();
      }
      this.historyLoaded = true;
      return;
    }

    if (command === 'get_state') {
      // Update current model from state
      if (response.modelId && !this.modelSetFromState) {
        const provider = extractProvider(response.modelId);
        this.currentModel = createMinimalModel(response.modelId, provider);
        this.modelSetFromState = true;
      }
    } else if (command === 'compact') {
      // Compact completed — reset streaming state
      this.streamingContent = '';
      this.toolCalls = [];
      this.closingState = 'none';
    } else if (command === 'abort') {
      // Abort completed
      this.streamingContent = '';
      this.toolCalls = [];
    }
  }

  private finalizeStreamingMessage() {
    const toolLines = this.toolCalls
      .map((tc) => {
        const argsLine = tc.args ? `\n  args: ${tc.args}` : '';
        const resultLine = tc.result ? `\n  result: ${tc.result}` : '';
        return `> ${tc.name}${argsLine}${resultLine}`;
      })
      .filter(Boolean);

    const lines = [...toolLines, this.streamingContent.trim()].filter(Boolean);

    if (lines.length) {
      this.displayMessages = [
        ...this.displayMessages,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: lines.join('\n\n'),
          toolCalls: [...this.toolCalls],
          timestamp: Date.now(),
        },
      ];
    }

    this.streamingContent = '';
    this.toolCalls = [];
  }

  // ── User Actions ────────────────────────────────────────────

  private handleSend(message: string) {
    // Finalize any current streaming content
    if (this.streamingContent.trim() || this.toolCalls.length > 0) {
      this.finalizeStreamingMessage();
    }

    this.streamingContent = '';
    this.toolCalls = [];

    // Add user message to display
    this.displayMessages = [
      ...this.displayMessages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        toolCalls: [],
        timestamp: Date.now(),
      },
    ];

    // Forward to Pi
    this.chatController.prompt(message);

    // Scroll to bottom
    this.scrollToBottom();
  }

  private handleSwitchModel(model: Model) {
    if (!this.sessionId) return;

    this.modelDropdownOpen = false;
    this.currentModel = model;

    const provider = extractProvider(model.id);
    
    // Update session metadata via REST
    switchModel(this.sessionId, model.id, provider).catch((err) => {
      console.error('Failed to switch model:', err);
      this.errorMessage = `Failed to switch model: ${err.message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });

    // Send set_model command via REST for immediate effect
    sendCommand(this.sessionId, {
      command: 'set_model',
      modelId: model.id,
      provider: provider,
    }).catch((err) => {
      console.error('Failed to send set_model command:', err);
    });

    // Update SSE session model
    this.chatController.setModel(model.id, provider);

    // Dispatch event for parent
    this.dispatchEvent(
      new CustomEvent('model-switch', {
        detail: model,
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleClose() {
    if (!this.sessionId || this.closingState !== 'none') return;

    this.closingState = 'compact';

    this.chatController.compact().catch((err) => {
      console.error('Failed to compact:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to compact: ${err.message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });

    // Dispatch event for parent
    this.dispatchEvent(
      new CustomEvent('session-close', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleDelete() {
    if (!this.sessionId || this.closingState !== 'none') return;

    this.closingState = 'delete';

    deleteSession(this.sessionId).catch((err) => {
      console.error('Failed to delete:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to delete: ${err.message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    });

    // Dispatch event for parent
    this.dispatchEvent(
      new CustomEvent('session-delete', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleAbort() {
    this.chatController.abort();
    this.streamingContent = '';
    this.toolCalls = [];
  }

  private async handleCloseSession() {
    if (!this.sessionId || this.closingState !== 'none') return;
    
    this.closingState = 'compact';
    
    try {
      await closeSession(this.sessionId);
      // Dispatch event to navigate away
      this.dispatchEvent(new CustomEvent('session-close', {
        bubbles: true,
        composed: true,
      }));
    } catch (err) {
      console.error('Failed to close session:', err);
      this.closingState = 'none';
      this.errorMessage = `Failed to close: ${err.message}`;
      setTimeout(() => (this.errorMessage = null), 5000);
    }
  }

  // ── Utilities ───────────────────────────────────────────────

  private get sortedMessages(): DisplayMessage[] {
    return [...this.displayMessages].sort((a, b) => a.timestamp - b.timestamp);
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      const messagesContainer = this.shadowRoot?.querySelector('.chat-panel__messages');
      if (messagesContainer) {
        messagesContainer.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth'
        });
      }
    });
  }

  private getModelName(): string {
    if (this.currentModel) {
      return this.currentModel.name;
    }
    return 'Select model';
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
    this.toolCalls = [];
    this.processedCount = 0;
    this.showClearConfirm = false;
  }

  private respondToUi(value: unknown | null) {
    if (this.chatController.pendingUiRequest) {
      this.chatController.respondToUi(
        this.chatController.pendingUiRequest.id,
        value,
        value === null
      );
    }
  }

  // ── Render ──────────────────────────────────────────────────

  render() {
    return html`
      <div class="chat-panel">
        <!-- Header -->
        <div class="chat-panel__header">
          <div class="chat-panel__header-left">
            <!-- Model Selector -->
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
            
            <!-- Connection Status -->
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
                <button class="btn btn--sm" @click=${() => this.showClearConfirm = false}>Cancel</button>
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
                ${this.sortedMessages.map(
                  (msg) =>
                    html`<chat-message .message=${msg}></chat-message>`
                )}
                ${this.streamingContent
                  ? html`
                      <div class="chat-panel__streaming">
                        ${this.streamingContent}
                      </div>
                      <div class="chat-panel__streaming-indicator">
                        <span class="chat-panel__typing"></span>
                        Pi is thinking...
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
          `
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
          `
        )}
      </div>
    `;
  }
}
