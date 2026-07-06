# Litro ChatPanel Fixes Plan

**Branch:** `refactor/migrate-to-lit-frontend`  
**Created:** 2026-07-05  
**Status:** Pending Approval

## Overview

This plan addresses gaps identified between the original React ChatPanel (`frontend/src/components/ChatPanel.tsx`) and the current Litro implementation (`frontend-litro/components/chat-panel.ts`). The gaps range from critical missing features (chat history loading) to minor UX differences.

## Gap Analysis Summary

### Critical Missing Features (P0)
1. ❌ Chat history loading (`get_messages` command)
2. ❌ Tool call updates (args → result)
3. ❌ Session close button (compact + terminate)

### Important Differences (P1)
4. ⚠️ Model switching REST command
5. ⚠️ Message sorting by timestamp

### Minor UX Differences (P2)
6. 🎨 Empty state icon (emoji vs SVG)
7. 🎨 Auto-scroll behavior (jump vs smooth)
8. 🎨 Connection status labels

---

## P0: Critical Fixes

### Fix 1: Chat History Loading

**Problem:** When reopening a session, chat starts empty instead of showing previous conversation.

**Root Cause:** The Lit implementation doesn't fetch historical messages via `get_messages` RPC command.

**React Implementation:**
```typescript
// In useSSE hook or useEffect
if (sse.state !== "idle" && sse.state !== "streaming") {
  fetch(`/api/projects/cmd?session_id=${sid}`, {
    method: "POST",
    body: JSON.stringify({ command: "get_messages" }),
  });
}
```

**Lit Implementation Plan:**

1. **Add state to track history loading:**
```typescript
@state() historyLoaded = false;
```

2. **Send get_messages command when session connects:**
```typescript
updated(changedProperties: Map<string, unknown>) {
  if (changedProperties.has('sessionId') && this.sessionId) {
    this.chatController.setSessionId(this.sessionId);
    this.resetDisplayState();
    
    // Load chat history after SSE connects
    setTimeout(() => {
      this.loadChatHistory();
    }, 500);
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
```

3. **Handle get_messages response in processRpcResponse:**
```typescript
private processRpcResponse(msg: InboundMessage) {
  if (msg.kind !== 'rpc_response') return;

  const response = (msg as any).response;
  const command = response.command || response.commandName;

  // Handle get_messages response (chat history)
  if (command === 'get_messages') {
    const messages = response.data?.messages || [];
    const history = messages
      .map(agentMessageToDisplay)
      .filter((m): m is DisplayMessage => m !== null);
    
    if (history.length > 0) {
      this.displayMessages = [...history];
      this.scrollToBottom();
    }
    return;
  }

  // ... existing handling for get_state, compact, abort
}
```

**Verification:**
- Open a session with existing messages
- Verify messages appear after connection
- Check that `historyLoaded` state prevents duplicate loads

---

### Fix 2: Tool Call Updates

**Problem:** Tool calls only get added when new, but don't update when args or result arrive as separate events.

**Root Cause:** The `extractToolCall` function creates new entries but never updates existing ones.

**React Implementation:**
```typescript
setToolCalls((prev) => {
  const idx = prev.findIndex((tc) => tc.name === toolCall!.name);
  if (idx >= 0) {
    const updated = [...prev];
    if (toolCall.args) updated[idx] = { ...updated[idx], args: toolCall.args };
    if (toolCall.result) updated[idx] = { ...updated[idx], result: toolCall.result };
    return updated;
  }
  return [...prev, toolCall];
});
```

**Lit Implementation Plan:**

1. **Update processNewMessages to handle tool call updates:**
```typescript
private processNewMessages() {
  const newMessages = this.chatController.messages.slice(this.processedCount);
  if (newMessages.length === 0) return;

  let finalizerSeen = false;

  for (const msg of newMessages) {
    if (msg.kind === 'rpc_event') {
      const event = (msg as any).event;

      // ... existing text extraction ...

      // Extract tool call with update logic
      const toolCall = extractToolCall(event);
      if (toolCall) {
        const existingIdx = this.toolCalls.findIndex(tc => tc.name === toolCall.name);
        
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
      }
    }
  }

  // ... existing finalization logic
}
```

**Verification:**
- Send a prompt that triggers a tool call
- Verify args appear first, then result updates the same tool call
- Check that tool call shows both args and result when complete

---

### Fix 3: Session Close Button

**Problem:** Only Compact and Delete buttons exist, but users need a "Close" button that compacts AND terminates the session.

**Root Cause:** The `closeSession` REST endpoint handles the full shutdown sequence (compact → abort → terminate), but there's no UI button to trigger it.

**React Implementation:**
```typescript
// Close = compact + abort + terminate
<button onClick={handleClose}>Close</button>

const handleClose = useCallback(async () => {
  setClosingState("compact");
  await closeSession(selectedSessionId!);  // REST endpoint handles full shutdown
  setView("folders");
}, [closingState, selectedSessionId, setView]);
```

**Lit Implementation Plan:**

1. **Add Close button to header:**
```typescript
render() {
  return html`
    <div class="chat-panel__header-right">
      <button class="chat-panel__btn-close" ?disabled=${this.closingState !== 'none'} 
              @click=${this.clearChat}>Clear</button>
      <button class="chat-panel__btn-close" ?disabled=${this.closingState !== 'none'} 
              @click=${this.handleCompact}>Compact</button>
      <button class="chat-panel__btn-close" ?disabled=${this.closingState !== 'none'} 
              @click=${this.handleCloseSession}>Close</button>
      <button class="chat-panel__btn-close chat-panel__btn--danger" ?disabled=${this.closingState !== 'none'} 
              @click=${this.handleDelete}>Delete</button>
    </div>
  `;
}
```

2. **Add handleCloseSession method:**
```typescript
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
```

3. **Add CSS for Close button:**
```css
.chat-panel__btn-close--close {
  /* Similar to existing styles */
}
```

**Verification:**
- Click Close button on a running session
- Verify session is terminated (no longer shows in sessions list)
- Verify navigation to home page (via session-close event)

---

## P1: Important Fixes

### Fix 4: Model Switching REST Command

**Problem:** Model switch only updates local state and SSE, but doesn't send REST command for immediate effect.

**React Implementation:**
```typescript
// Persist model change on backend
apiSwitchModel(selectedSessionId, model.id, model.provider).catch(...);

// Send set_model command via REST for immediate effect
fetch(`/api/projects/cmd?session_id=${sid}`, {
  method: "POST",
  body: JSON.stringify({ command: "set_model", modelId: model.id, provider: model.provider }),
});
```

**Lit Implementation Plan:**

1. **Update handleSwitchModel to send REST command:**
```typescript
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
  this.dispatchEvent(new CustomEvent('model-switch', {
    detail: model,
    bubbles: true,
    composed: true,
  }));
}
```

**Verification:**
- Switch model while streaming
- Verify model changes immediately in Pi process
- Check that new model is used for subsequent prompts

---

### Fix 5: Message Sorting by Timestamp

**Problem:** Lit assumes messages are already sorted by timestamp, but this isn't guaranteed.

**React Implementation:**
```typescript
{displayMessages.slice().sort((a, b) => a.timestamp - b.timestamp).map(...)}
```

**Lit Implementation Plan:**

1. **Sort messages before rendering:**
```typescript
private get sortedMessages(): DisplayMessage[] {
  return [...this.displayMessages].sort((a, b) => a.timestamp - b.timestamp);
}

render() {
  return html`
    <!-- ... -->
    <div class="chat-panel__messages">
      ${this.sortedMessages.map(msg => html`
        <chat-message .message=${msg}></chat-message>
      `)}
      <!-- ... -->
    </div>
  `;
}
```

**Verification:**
- Send multiple messages rapidly
- Verify messages appear in correct order (oldest first)

---

## P2: Nice-to-Have Improvements

### Fix 6: Empty State SVG Icon

**Current:** Uses emoji 💬  
**Proposed:** Use SVG chat bubble icon (matching React)

**Implementation:**
```typescript
private renderEmptyState() {
  return html`
    <div class="chat-panel__empty">
      <svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <h3 class="empty__title">Start a conversation</h3>
      <p class="empty__description">Type a message below</p>
    </div>
  `;
}
```

---

### Fix 7: Smooth Auto-Scroll

**Current:** Jumps to bottom  
**Proposed:** Smooth scroll to bottom

**Implementation:**
```typescript
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
```

---

### Fix 8: Connection Status Labels

**Current:** "Idle", "Streaming", "Connecting", "Disconnected"  
**Proposed:** "Connected", "Thinking…", "Connecting…", "Disconnected"

**Implementation:**
```typescript
private getConnectionLabel(): string {
  if (this.chatController.isStreaming) return 'Thinking…';
  if (this.chatController.state === 'error' || this.chatController.state === 'disconnected') {
    return 'Disconnected';
  }
  if (this.chatController.state === 'connecting') return 'Connecting…';
  return 'Connected';
}
```

---

## Implementation Order

1. **Fix 1: Chat History Loading** (P0 - Critical)
2. **Fix 2: Tool Call Updates** (P0 - Critical)
3. **Fix 3: Session Close Button** (P0 - Critical)
4. **Fix 4: Model Switching REST Command** (P1 - Important)
5. **Fix 5: Message Sorting** (P1 - Important)
6. **Fix 6: Empty State SVG** (P2 - Nice to Have)
7. **Fix 7: Smooth Scroll** (P2 - Nice to Have)
8. **Fix 8: Connection Labels** (P2 - Nice to Have)

---

## Testing Strategy

### Unit Tests
- Test `loadChatHistory()` fetches messages correctly
- Test tool call updates merge args and results
- Test `handleCloseSession()` dispatches events

### Integration Tests
- Open session with history → verify messages load
- Send prompt with tool calls → verify args/result appear
- Click Close → verify session terminates
- Switch model → verify immediate effect

### Manual Testing
- Navigate between sessions → verify history loads
- Send multiple messages → verify sorting
- Stream long responses → verify tool calls update correctly

---

## Success Criteria

- [ ] Chat history loads when reopening session
- [ ] Tool calls show both args and result
- [ ] Close button terminates session properly
- [ ] Model switch takes immediate effect
- [ ] Messages sort by timestamp
- [ ] All existing tests still pass
- [ ] No new TypeScript errors
- [ ] Build succeeds with `bun run litro build`

---

## Next Steps

1. **Review this plan** with the team
2. **Get approval** to proceed with P0 fixes
3. **Implement fixes** in order of priority
4. **Test thoroughly** after each fix
5. **Commit and push** when all P0 fixes are complete
6. **Consider P1/P2** in follow-up commits

---

**Questions or concerns?** Please review and provide feedback before implementation begins.
