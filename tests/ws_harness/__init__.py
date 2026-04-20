"""WebSocket Connection Harness — mimics the frontend flow exactly.

Reproduces the exact sequence the frontend makes to isolate whether
the WS connection loop is a frontend or backend bug.

Frontend flow:
  1. FolderSelector → setSelectedFolder + setView('models')
  2. ModelSelector mounts → useModels → createSession
  3. useModels polls GET /api/models/ until models arrive
  4. User selects model → switchModel + setView('workspace')
  5. ChatPanel mounts → useWebSocket → doConnect
  6. WS onopen → send get_state + set_model
  7. Send prompt "Tell me about this project"
  8. Relay inbound messages
"""
