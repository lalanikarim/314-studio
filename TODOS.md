# TODO — Web-Pi Project

## Completed

### Frontend
- [x] Folder Selector view — browse directories, select project
- [x] Model Selector view — pick model, create RPC session
- [x] Workspace view — 3-column layout (tree, preview, chat)
- [x] ProjectTree component — recursive file tree with lazy loading
- [x] FilePreview component — file content viewer with line numbers
- [x] `useFileContent` hook — read files via REST
- [x] `useModels` hook — create RPC session, poll for real models, fallback
- [x] `useWebSocket` hook — WS connection, reconnection, event routing, extension UI
- [x] **ChatPanel wired to WebSocket** — real `ws.send()` replaces mock replies
- [x] **Streaming content** — accumulate `rpc_event` text in real-time
- [x] **Tool call tracking** — display tool names as badges during streaming
- [x] **Model switcher** — send `set_model` RPC on model change
- [x] **Connection status** — indicator + label in header
- [x] **Pending UI requests** — banner with accept/cancel buttons
- [x] CSS for streaming cursor, tool call badges, UI prompt banner

### Backend
- [x] All REST endpoints (browse, projects, sessions, models, files)
- [x] SessionManager — spawn/manage `pi --rpc` processes
- [x] WebSocket relay — bidirectional JSON over `pi --rpc` stdin/stdout
- [x] Extension UI handling — auto-ack fire-and-forget, forward interactive

### Tests
- [x] 76/76 passing across 7 flows
- [x] Flow 1: Browse + Chat
- [x] Flow 2: File Browse
- [x] Flow 3: Multi-Session
- [x] Flow 4: Model Switch
- [x] Flow 5: Close/Delete
- [x] Flow 6: Error Handling
- [x] Flow 7: Shutdown Cleanup

---

## Pending

### Near-term
- [ ] **Display tool call args/results** — currently only shows tool names; enhance `extractToolName` to also pull `args`/`result` from rpc_events
- [ ] **Markdown rendering** — Pi responses are plain text; add a markdown-to-HTML transformer for richer display
- [ ] **Multi-turn message history** — the `clearMessages` hook function exists but isn't called; wire "clear chat" button or auto-purge on model switch
- [ ] **WS URL uses `projectFolder` but backend expects `session_id`** — the hook constructs `/api/projects/${projectFolder}/ws` but the backend chat.py expects `?session_id=...`. This needs a fix in the WS URL construction or backend endpoint.

### Medium-term
- [ ] **Typing indicator for streaming** — show "Pi is thinking" during the initial delay before first event arrives
- [ ] **Session persistence** — remember last active project/model across page reloads
- [ ] **Keyboard shortcuts** — Ctrl/Cmd+K to focus input, Escape to close dropdown
- [ ] **File search** — add fuzzy search to the project tree
- [ ] **Tabbed file preview** — open multiple files in tabs
- [ ] **Error boundary** — wrap components in React ErrorBoundary for graceful degradation
- [ ] **Toast notifications** — display API errors, session errors to the user
- [ ] **Dark/light theme toggle**

### Stretch
- [ ] **Code diff view** — when Pi modifies files, show diffs inline
- [ ] **Voice input** — Web Speech API for voice-to-text
- [ ] **Collaboration** — multiple users in the same session
- [ ] **Plugin system** — user-defined commands/shortcuts
