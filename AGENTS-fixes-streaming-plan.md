# Streaming Fixes — Plan & Rollout

**Branch:** `refactor/migrate-to-lit-frontend`  
**Date:** 2026-07-07  
**Status:** Applied (see below)

---

## Problem Summary

Two issues in the SSE-based chat streaming pipeline:

1. **UI stuck in "streaming…/typing…"** — Even after the event source has returned all message chunks, the typing indicator persists.
2. **Consecutive assistant messages not merged** — Live streaming renders each `message_end` as a separate assistant block, while `get_messages` hydration merges consecutive assistant messages into one coherent turn block.

---

## Root-Cause Analysis

### Issue 1: UI stuck in streaming

**Three contributing causes:**

| # | Layer | Root Cause | Fix |
|---|-------|-----------|-----|
| 1A | `chat-stream-controller.ts` | `updateStreamingState()` only looks at top-level `event.type`. Terminal `assistantMessageEvent.type === "done"` / `"error"` inside a `message_update` event is invisible. | Inspect `assistantMessageEvent` alongside top-level type. |
| 1B | `chat-panel.ts` | `drainQueue()` imports `isMessageTerminal` (line 13) but **never calls it**. Terminal `message_update` events flush nothing. | Wire `isMessageTerminal` into `drainQueue()` to commit accumulators on `done`/`error`. |
| 1C | `backend/app/session_manager.py` | `subscribe_sse()` does not evict the stale SSE consumer. After `EventSource` auto-reconnect, two generators race on `record.event_buffer.get()`. The old generator can steal `message_end`, leaving the new client permanently streaming. | Set `sse_cancelled = True` on existing subscriber and put a sentinel into the buffer. Update `get_next_event()` to poll for cancel flag. |

### Issue 2: Consecutive assistant messages not merged

**Single root cause:**

| # | Layer | Root Cause | Fix |
|---|-------|-----------|-----|
| 2 | `chat-panel.ts` | `mergeHistoryToolResults()` is called only in `applyHistoryResponse()` (history hydration path). The live `drainQueue()` never applies it. Each `message_end` creates a separate `ChatMessage` that is never collapsed. | Call `mergeHistoryToolResults()` on `displayMessages` at the end of every `drainQueue()` pass. |

### Bonus: Canonical messages from `turn_end` / `agent_end`

`turn_end` carries `event.message` and `agent_end` carries `event.messages[]` — both authoritative. The live path currently ignores them.

| # | Fix |
|---|-----|
| B1 | On `turn_end` with a canonical `message`, call `applyFinalizedAssistantMessage()` to replace the streaming placeholder. |
| B2 | (Deferred) On `agent_end` with `messages[]`, optionally validate/replace `displayMessages`. Not applied in this iteration. |

---

## Files Modified

| File | Lines | Changes |
|------|-------|---------|
| `frontend-litro/lib/chat-stream-controller.ts` | ~25 | `updateStreamingState()` accepts full event payload; `handleRpcEvent()` passes it through. |
| `frontend-litro/components/chat-panel.ts` | ~20 | `drainQueue()` handles terminal `message_update`, `turn_end.message`, and merges live `displayMessages`. |
| `backend/app/session_manager.py` | ~15 | `subscribe_sse()` evicts stale consumer; `get_next_event()` checks cancel flag. |

---

## Validation

| # | Criterion | Method |
|---|-----------|--------|
| V1 | Build succeeds | `cd frontend-litro && bun run litro build` |
| V2 | No `@property` decorators leak | `grep -rn "@property" frontend-litro/components/ frontend-litro/lib/` |
| V3 | `isMessageTerminal` imported AND called | `grep -n "isMessageTerminal" frontend-litro/components/chat-panel.ts` |
| V4 | Terminal `assistantMessageEvent` handled | `grep -n "ami.type\|done.*error" frontend-litro/lib/chat-stream-controller.ts` |
| V5 | `mergeHistoryToolResults` called in `drainQueue` | `grep -n "mergeHistoryToolResults" frontend-litro/components/chat-panel.ts` |
| V6 | Backend SSE evicts stale subscriber | `grep -A2 "sse_cancelled = True" backend/app/session_manager.py` |
| V7 | Headless browser check passes | `check.js --url ... --wait 'page-workspace' --errors` |
| V8 | Integration tests pass | `cd tests && API_BASE=... uv run pytest -v` |

---

## Rollout Log

| Step | Status | Notes |
|------|--------|-------|
| Fix 1A: controller | ✅ Applied | `updateStreamingState` now inspects `assistantMessageEvent` |
| Fix 1B: drainQueue terminal | ✅ Applied | `isMessageTerminal` wired in |
| Fix 1C: backend SSE race | ✅ Applied | `subscribe_sse` evicts stale + `get_next_event` polls cancel |
| Fix 2: live merge | ✅ Applied | `mergeHistoryToolResults` called after drain |
| Bonus B1: turn_end canonical | ✅ Applied | `turn_end.message` replaces streaming placeholder |
| Build & lint | ✅ Passed | `bun run litro build` clean |
| Headless check | ✅ Passed | 0 JS errors on workspace route |
