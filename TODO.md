# TODO — Frontend Gap Remediation

> Source: Backend + Test coverage audit. Every item maps to a backend endpoint, test, or RPC command that the frontend does not yet surface.

---

## 🔴 P0 — Critical: Backend has it, Frontend completely lacks it

### 1. Add Close/Delete Session API functions and UI buttons ✅ **DONE**
**Backend:** `POST /api/projects/:id/close` (compact+terminate), `POST /api/projects/:id/delete` (abort+terminate)  
**Tests:** `test_flow5_close_delete.py` — T5.1 through T5.5  
**Files:** `frontend/src/services/api.ts`, `frontend/src/components/ChatPanel.tsx`

- [x] **1a.** Add `closeSession(sessionId)` and `deleteSession(sessionId)` functions to `api.ts`
- [x] **1b.** Add Close/Delete/Compact buttons in ChatPanel header
- [x] **1c.** After close/delete, transition view back to `folders`
- [x] **1d.** Handle errors gracefully with try/catch
- [x] **3.** Add standalone `compact()` RPC function via WS (compacts without terminating)
  ```ts
  export async function closeSession(sessionId: string): Promise<SessionCloseResponse> {
    return request<SessionCloseResponse>(`/api/projects/${sessionId}/close`);
  }
  export async function deleteSession(sessionId: string): Promise<SessionCloseResponse> {
    return request<SessionCloseResponse>(`/api/projects/${sessionId}/delete`);
  }
  export interface SessionCloseResponse {
    session_id: string;
    compacted: boolean;
  }
  ```
- [ ] **1b.** Add Close/Delete buttons in ChatPanel header or a dedicated session controls bar
  - Close = compact conversation before terminating (preserves context)
  - Delete = immediate abort + terminate (no compact)
  - Show confirmation dialog before closing/deleting
- [ ] **1c.** After close/delete, transition view back to `folders` or `models`
- [ ] **1d.** Handle 404 (already terminated) and 500 (server error) gracefully in UI

### 2. Add Project Info endpoint call ✅ **DONE**
**Backend:** `GET /api/projects/info?project_path=...` returns `{ path, sessions, running_count }`  
**Tests:** `test_flow1_browse_chat.py` — T1.3, T1.6  
**Files:** `frontend/src/services/api.ts`, `frontend/src/views/Workspace.tsx`

- [ ] **2a.** Add `getProjectInfo(projectPath: string)` to `api.ts`
  ```ts
  export interface ProjectInfo {
    path: string;
    sessions: SessionRecord[];
    running_count: number;
  }
  export async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
    return request<ProjectInfo>(`/api/projects/info?project_path=${encodeURIComponent(projectPath)}`);
  }
  ```
- [ ] **2b.** Remove the stale `exists` / `is_directory` fields from frontend `ProjectInfo` (not returned by backend)
- [ ] **2c.** Call project info in `ModelSelector` to show "N sessions running" indicator
- [ ] **2d.** Optionally show session names in ModelSelector so user can pick which existing session to use

### 3. Add Compact RPC command to API
**Backend:** WS relay accepts `"compact"` in allowed types; `session_manager.py` runs compact with 300s timeout  
**Tests:** `test_flow5_close_delete.py` — verifies `compacted: true`  
**Files:** `frontend/src/services/api.ts`, `frontend/src/hooks/useWebSocket.ts`

- [ ] **3a.** Add `compactSession(sessionId)` to `api.ts` that POSTs to `/api/projects/:id/close` and returns `compacted: true/false`
  - Note: This is essentially the Close endpoint without delete. We may want a dedicated compact-only endpoint in the backend, or just reuse close and skip the terminate.
  - **Decision:** Backend currently only has close (compact+terminate) and delete (abort). For a compact-only operation, either:
    - **Option A:** Add `POST /api/projects/:id/compact` endpoint in `session.py`
    - **Option B:** Send `{ type: "compact" }` via WebSocket relay
  - **Recommended:** Option B — send compact via WS, then separately terminate. This keeps the compact logic in the WS relay where it belongs.
- [ ] **3b.** Add a "Compact Conversation" button in ChatPanel that sends compact via WS
- [ ] **3c.** Show "Compacting…" loading state while compacting

### 4. Add Abort RPC command to UI ✅ **DONE**
**Backend:** WS relay special-cases `"abort"` → writes raw JSON to stdin  
**Tests:** `test_flow5_close_delete.py` T5.4 — delete sends abort before terminate  
**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/src/hooks/useWebSocket.ts`

- [ ] **4a.** Add "Abort" button in ChatPanel that sends `{ type: "abort" }` via WS
  - This cancels the current Pi turn without terminating the session
  - Different from "Stop" which might be a UI-only concept
- [ ] **4b.** Show "Aborting…" state in UI
- [ ] **4c.** Disable send input while abort is in progress

---

## 🟡 P1 — Medium: Backend exists, frontend partial or inconsistent

### 5. Fix dual-route model switch response mismatch ✅ **DONE**
**Backend:** `session.py` now returns `{ message, modelId, provider }` like tests expect  
**Tests:** `test_flow4_model_switch.py` — T4.2, `test_flow8_model_operations.py` — T8.3  
**Files:** `backend/app/api/session.py`, `frontend/src/services/api.ts`

- [ ] **5a.** Remove the duplicate `switch_model` from `session.py` (it's a no-op redirect to `model.py` anyway)
  - `session.py` switch_model is a proper implementation with validation; `model.py` switch_model delegates back to it. Keep `session.py` as the canonical route.
- [ ] **5b.** Update `session.py` `switch_model` response to match what frontend expects:
  ```python
  return {"message": "Model switched", "modelId": model_id, "provider": provider or ""}
  ```
  instead of `SessionCloseResponse`
- [ ] **5c.** Add `ModelSwitchResponse` type to `schemas/__init__.py`
- [ ] **5d.** Add `switchModel(sessionId, modelId, provider)` to `api.ts` with proper response type
- [ ] **5e.** Update `useModels.ts` and `ChatPanel.tsx` to use the new API function instead of inline fetch

### 6. Add `listModels` to api.ts service layer ✅ **ALREADY DONE** — was already implemented

- [ ] **6a.** Move `listModels` from `useModels.ts` into `api.ts`
  ```ts
  export async function listModels(sessionId: string): Promise<ModelConfig[]> {
    return request<ModelConfig[]>(`/api/models/?session_id=${encodeURIComponent(sessionId)}`);
  }
  ```
- [ ] **6b.** Have `useModels.ts` call `listModels()` from api.ts instead of implementing fetch itself
- [ ] **6c.** Export `listModels` from `api.ts` for use in other components (e.g., model switch in ChatPanel)

### 7. Clarify session creation model_id flow ✅ **DONE** — removed model_id from CreateSessionBody

- [ ] **7a.** Remove `model_id` from `CreateSessionBody` in `api.ts` (backend ignores it)
- [ ] **7b.** Document that model selection happens at WS connect time, not at session creation
- [ ] **7c.** Ensure `ModelSelector.tsx` doesn't pass `model_id` in session create body

---

## 🟠 P2 — Feature: Backend WS relay accepts, no frontend UI

### 8. Add Thinking Level controls
**Backend:** WS relay accepts `set_thinking_level` and `cycle_thinking_level`  
**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/src/hooks/useWebSocket.ts`

- [ ] **8a.** Add a settings icon/panel in ChatPanel header that expands to show configuration options
- [ ] **8b.** Thinking level selector (none/low/medium/high) that sends `set_thinking_level` RPC via WS
- [ ] **8c.** "Cycle thinking level" button for quick cycling
- [ ] **8d.** Add `setThinkingLevel(level: string)` and `cycleThinkingLevel()` helpers to `useWebSocket.ts` send function

### 9. Add Auto Compaction toggle
**Backend:** WS relay accepts `set_auto_compaction`  
**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/src/hooks/useWebSocket.ts`

- [ ] **9a.** Add auto-compaction toggle in settings panel
- [ ] **9b.** Send `set_auto_compaction` RPC via WS (value: `true`/`false`)

### 10. Add Steering Mode / Follow Up Mode
**Backend:** WS relay accepts `set_steering_mode` and `set_follow_up_mode`  
**Files:** `frontend/src/components/ChatPanel.tsx`, `frontend/src/hooks/useWebSocket.ts`

- [ ] **10a.** Add steering mode selector in settings panel
- [ ] **10b.** Add follow-up mode selector in settings panel

### 11. Add Get Commands button
**Backend:** WS relay accepts `get_commands`  
**Files:** `frontend/src/components/ChatPanel.tsx`

- [ ] **11a.** Add "Show Commands" button that sends `get_commands` via WS
- [ ] **11b.** Display available commands in a dropdown or popover in the settings area

### 12. Add Session Name / Rename
**Backend:** No explicit rename endpoint; could be done via WS `set_session_name` if Pi supports it  
**Files:** `backend/app/api/session.py`, `frontend/src/components/ChatPanel.tsx`

- [ ] **12a.** Check if Pi RPC supports `set_session_name`; if so, add relay support
- [ ] **12b.** Add rename input in ChatPanel header next to session name display

---

## 🔵 P3 — Minor: UX improvements, consistency fixes, documentation

### 13. Add reconnect UI with disconnect reason ✅ **DONE**
- Add reconnect button with refresh icon in error state
- Show close code and reason
- Display error message banner

- [ ] **13a.** Capture WebSocket close code and reason
- [ ] **13b.** Show reconnect button when in `error` state (in addition to auto-reconnect)
- [ ] **13c.** Display human-readable reason (e.g., "Server restarted", "Network issue")
- [ ] **13d.** Add `onCloseReason: (code: number, reason: string) => void` callback prop

### 14. Add session list in Workspace sidebar
**Backend:** `GET /api/projects/info` returns active sessions  
**Tests:** `test_flow3_multi_session.py` — T3.1 through T3.7  
**Files:** `frontend/src/components/ProjectTree.tsx` or new `SessionList.tsx`

- [ ] **14a.** Fetch project info on workspace mount to get active sessions
- [ ] **14b.** Show session list in a collapsible section above or below file tree
- [ ] **14c.** Allow switching between sessions (switches `sessionId` in AppContext)
- [ ] **14d.** Show session status indicator (running/error/stopped)

### 15. Add session count badge to header ✅ **DONE**
- Fetch project info on workspace mount
- Show "N sessions" badge next to project name

- [ ] **15a.** Show "N sessions" badge next to project name in Workspace header
- [ ] **15b.** Click badge to expand session list

### 16. Document Flow 8 in AGENTS.md ✅ **DONE**
- Add test_flow8 to project structure
- Add Flow 8 to Current Status table

- [ ] **16a.** Add Flow 8 (Model Operations) to the test plan table in AGENTS.md
- [ ] **16b.** Add Flow 8 to `conftest.py` markers (already done — `pytest_configure` has `flow8`)
- [ ] **16c.** Update architecture docs to reflect model operations API

### 17. Standardize browse vs projects list endpoints
**Backend:** `/api/browse` (hides `.`/`_` dirs, returns `DirNode`) vs `/api/projects/` (simpler, returns `List[str]`)  
**Current:** `FolderSelector` uses `/api/browse`; `/api/projects/` is never called from frontend  
**Files:** `frontend/src/views/FolderSelector.tsx`

- [ ] **17a.** Decide which endpoint to standardize on for folder browsing
  - `/api/browse` is richer (returns `isDirectory`, handles relative paths) — recommended to keep
  - `/api/projects/` is simpler (just names) — useful for the sidebar project list
- [ ] **17b.** Use `/api/projects/` (listProjects) in a "Recent Projects" or "Switch Project" dropdown
- [ ] **17c.** Keep `/api/browse` for the recursive tree in FolderSelector

### 18. Add `get_session_stats` RPC support
**Backend:** WS relay accepts `get_session_stats`  
**Files:** `frontend/src/hooks/useWebSocket.ts`, `frontend/src/components/ChatPanel.tsx`

- [ ] **18a.** Add `getSessionStats()` helper to `useWebSocket.ts`
- [ ] **18b.** Display token count / message count in ChatPanel footer

---

## 📋 Implementation Priority

| Priority | Tasks | Effort | Notes |
|----------|-------|--------|-------|
| **P0** | 1, 2, 3, 4 | ~8h | **Must ship** — close/delete/compact/abort are essential session controls |
| **P1** | 5, 6, 7 | ~4h | Fix API inconsistency, improve code organization |
| **P2** | 8–12 | ~10h | Feature additions — settings panel is a good UX enhancement |
| **P3** | 13–18 | ~6h | Polish, consistency, documentation |

**Suggested order:** 1 → 2 → 4 → 3 → 5 → 6 → 7 → 13 → 8 → 9 → 10 → 11 → 14 → 15 → 16 → 17 → 18

---

## 📎 Cross-References

| Frontend File | Backend Endpoint | Test Flow |
|--------------|-----------------|-----------|
| `api.ts` needs: `closeSession`, `deleteSession`, `getProjectInfo`, `listModels`, `switchModel` | `POST /:id/close`, `POST /:id/delete`, `GET /info`, `GET /models/`, `POST /:id/model` | Flow 5, Flow 8 |
| `ChatPanel.tsx` needs: close/delete buttons, compact/abort, settings panel, session list | WS relay commands | Flow 1, Flow 5, Flow 8 |
| `ModelSelector.tsx` needs: project info call, session display | `GET /info` | Flow 1 |
| `useWebSocket.ts` needs: `compact`, `abort`, `set_thinking_level`, `cycle_thinking_level`, `set_auto_compaction` | WS stdin relay | Flow 5, Flow 8 |
| `AppContext.tsx` needs: `currentSession` tracking for multi-session | Session manager | Flow 3 |
