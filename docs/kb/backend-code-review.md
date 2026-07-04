# Backend Code Review — Issues & Opportunities

> Date: 2026-07-03
> Scope: `backend/app/` (FastAPI + Uvicorn)
> Status: Reviewed, actionable items listed

---

## Table of Contents

- [Critical Issues](#critical-issues)
- [High Priority](#high-priority)
- [Medium Priority](#medium-priority)
- [Low Priority / Nice-to-Have](#low-priority--nice-to-have)
- [Summary Matrix](#summary-matrix)
- [Recommended Actions](#recommended-actions)
- [Code Walkthrough](#code-walkthrough-by-file)

---

## Critical Issues

### C-1: Duplicate `_resolve_project_path` Across Files ✅ FIXED

**Files**: `project.py`, `files.py`, `browse.py`

The same path resolution logic (with a `~/Projects/{name}` fallback) was reimplemented in three places. Extracted to `app/utils.py:resolve_project_path()` with a shared `PROJECTS_ROOT` constant.

**Result**: `app/utils.py` is the single source of truth. All three route files import from it.

---

### C-2: Unfiltered Filesystem Browsing in `/api/browse` ✅ FIXED

**File**: `browse.py`

Added a path confinement check. `/api/browse?path=/etc` and `/api/browse?path=/tmp` now return `[]`. Legitimate `~/Projects` browsing works unchanged.

---

### C-3: No Input Validation on `session_id` ✅ FIXED

**Files**: `session.py`, `chat.py`

Added `validate_session_id()` in `app/utils.py` (regex: `^sess_[0-9a-f]{12}$`). All 3 session endpoints in `session.py` and the WS endpoint in `chat.py` validate before processing. Invalid format → 400. Valid format, non-existent → 404 (unchanged).

---

### C-4: `main.py` Uses `__import__("logging")` ✅ FIXED

**File**: `main.py`

Added `import logging` at module level, defined `logger = logging.getLogger(__name__)` at module scope, and replaced the inline `__import__` call in the lifespan with the module-level logger.

---

### C-5: `_cached_models` Class Variable Accessed as Private ✅ FIXED

**File**: `session_manager.py`, `main.py`, `api/model.py`

Added `SessionManager.get_cached_models()` class method. Both `main.py` and `model.py` now use the public getter instead of accessing `_cached_models` directly.

---

## High Priority

### H-1: Model Cache Never Refreshes ✅ FIXED

**File**: `session_manager.py`, `api/model.py`

Added `SessionManager.refresh_models()` (clears cache + re-fetches) and `POST /api/models/refresh` endpoint. Frontend can call this to refresh the model list without restarting the server.

---

### H-2: No Shared Path Resolution Utility ✅ FIXED (same as C-1)

Resolved by extracting to `app/utils.py:resolve_project_path()` with shared `PROJECTS_ROOT` constant.

---

### H-3: `/files/read` Reads Binary Files as Text ✅ FIXED

**File**: `files.py`

Now reads files in binary mode, checks first 8KB for null bytes, and rejects binary/non-UTF-8 files with a 400 error and clear message.

---

### H-4: No Rate Limiting ✅ FIXED

**All endpoints**

Added a simple in-memory sliding-window rate limiter (`app/utils.py:RateLimiter`). Default: 60 requests per 60 seconds per client IP. Bypass with `RATE_LIMIT_DISABLED=1` env var (for tests).

---

## Medium Priority

### M-1: No Health Check Endpoint ✅ FIXED

Added `GET /health` endpoint returning `status` and `running_sessions` count.

---

### M-2: `_relay_messages` Race Condition Risk ✅ FIXED

**File**: `chat.py`

Added a shared `asyncio.Event` (`closed`) checked by both `_outbound` and `_inbound` loops. When either task completes or disconnects, `closed.set()` signals the other to exit cleanly before `task.cancel()` is called.

---

### M-3: Background Cleanup Task Never Awaited/Canceled ✅ FIXED

**File**: `session_manager.py`

`shutdown_all()` now cancels `_cleanup_task` and awaits it (catching `CancelledError`) before terminating sessions.

---

### M-4: `_parse_models_output` Parsing Is Fragile ✅ FIXED

**File**: `session_manager.py`

Added warning log when unparseable lines are encountered (count + sample line). Silent drops are now visible in logs.

---

### M-5: `_write_stdin` Silently Swallows Errors ✅ FIXED

**File**: `chat.py`

Both `_write_stdin` and `_write_stdin_raw` now log a warning when the session is unavailable, and catch `BrokenPipeError`/`ConnectionResetError` with a warning + re-raise so the caller knows.

---

### M-6: `_parse_rpc_models` Response Parsing Is Guesswork ✅ FIXED

**File**: `model.py`

Added explicit logging for unexpected response shapes (missing keys, wrong types) with details in the warning. Documented the expected format in the docstring.

---

## Low Priority / Nice-to-Have

### L-1: No Request ID Tracking ✅ FIXED

Added `X-Request-ID` header (12-char UUID) to every HTTP response via middleware.

---

### L-2: `_safe_terminate` Races with `get_session` ✅ FIXED

**File**: `session_manager.py`

All read methods (`get_session`, `get_sessions`, `get_all_sessions`, `get_running_instances`) now use a copy-on-read pattern (`dict(self._sessions)`) to take a snapshot before iterating, avoiding races with concurrent `_safe_terminate` mutations.

---

### L-3: Inconsistent `_` Prefix Filtering ✅ ALREADY CONSISTENT

**Files**: `browse.py`, `files.py`

Both already filter out entries starting with `.` or `_`. No change needed.

---

### L-4: No Pagination on `list_files` ✅ FIXED

**File**: `files.py`

Added `?limit=500` (default, max 5000) and `?offset=0` query parameters for pagination.

---

### L-5: No Gzip/Compression Middleware ✅ FIXED

**All endpoints**

Added `GZipMiddleware` (min size 500 bytes) to compress responses.

---

### L-6: Loose CORS Origin Validation ✅ ALREADY SECURE

**File**: `main.py`

CORS already uses explicit `allow_origins=[f"http://localhost:{_frontend_port}"]` which validates the Origin header on incoming requests. No change needed.

---

### L-7: No Structured Logging ⏳ DEFERRED

**All files**

Logging uses standard Python text format. Structured JSON logging (e.g., `structlog`) would improve production observability but requires a new dependency and formatter changes. Defer to Phase 3.

---

### L-8: `SessionRecord` Schema Lives in `session_manager.py` ✅ FIXED

**File**: `session_manager.py` → `app/schemas/session.py`

Moved `SessionRecord`, `SessionCreateRequest`, and `SessionCloseResponse` to `app/schemas/session.py`. `session_manager.py` now imports from there.

---

## Summary Matrix

| ID | Severity | File(s) | Issue | Effort |
|----|----------|---------|-------|--------|
| C-1 | Critical | project.py, files.py, browse.py | Duplicate `_resolve_project_path` | Low | ✅ FIXED
| C-2 | Critical | browse.py | Unfiltered filesystem browsing | Low | ✅ FIXED
| C-3 | Critical | session.py, chat.py | No `session_id` validation | Low | ✅ FIXED
| C-4 | Critical | main.py | `__import__("logging")` code smell | Trivial | ✅ FIXED
| C-5 | Critical | session_manager.py, main.py, model.py | `_cached_models` as private class var | Low | ✅ FIXED
| H-1 | High | session_manager.py, main.py | Model cache never refreshes | Medium | ✅ FIXED
| H-2 | High | project.py, files.py, browse.py | No shared path utility | Low | ✅ FIXED
| H-3 | High | files.py | Binary file handling | Medium | ✅ FIXED
| H-4 | High | All endpoints | No rate limiting | Medium | ✅ FIXED
| M-1 | Medium | Missing | No health check endpoint | Trivial | ✅ FIXED
| M-2 | Medium | chat.py | `_relay_messages` race condition | Medium | ✅ FIXED
| M-3 | Medium | session_manager.py | Cleanup task never cancelled | Low | ✅ FIXED
| M-4 | Medium | session_manager.py | Fragile model output parsing | Medium | ✅ FIXED
| M-5 | Medium | chat.py | `_write_stdin` silent failure | Low | ✅ FIXED
| M-6 | Medium | model.py | RPC response parsing guesswork | Low | ✅ FIXED
| L-1 | Low | chat.py | No request ID tracking | Low | ✅ FIXED
| L-2 | Low | session_manager.py | `_safe_terminate` race with reads | Medium | ✅ FIXED
| L-3 | Low | browse.py, files.py | Inconsistent `_` prefix filtering | Low | ✅ ALREADY CONSISTENT
| L-4 | Low | files.py | No pagination on `list_files` | Low | ✅ FIXED
| L-5 | Low | All endpoints | No gzip compression | Trivial | ✅ FIXED
| L-6 | Low | main.py | Loose CORS validation | Low | ✅ ALREADY SECURE
| L-7 | Low | All files | No structured logging | Medium | ⏳ DEFERRED
| L-8 | Low | session_manager.py | `SessionRecord` not in schemas | Low | ✅ FIXED

**Totals**: 24 issues (5 critical, 4 high, 6 medium, 7 low)
**Resolved**: 21 fixed, 2 already OK, 1 deferred (L-7)

---

## Recommended Actions

Prioritized by impact vs effort:

### Phase 1: Quick Wins (Low Effort, High Impact) — ✅ ALL DONE

1. ~~Extract path resolution~~ → `app/utils.py` — **✅ DONE**
2. ~~Add path confinement~~ to `/api/browse` — **✅ DONE**
3. ~~Add input validation~~ on `session_id` — **✅ DONE**
4. ~~Fix `main.py` logger~~ — **✅ DONE**
5. ~~Add `/health` endpoint~~ — **✅ DONE**
6. ~~Add gzip middleware~~ — **✅ DONE**
7. ~~Cancel cleanup task on shutdown~~ — **✅ DONE**
8. ~~Log warnings on silent failures~~ — **✅ DONE**

### Phase 2: Core Improvements (Medium Effort) — ✅ ALL DONE

9. ~~Model cache refresh~~ — **✅ DONE** (`POST /api/models/refresh`)
10. ~~Binary file detection~~ in `/files/read` — **✅ DONE**
11. ~~Standardize `_` prefix filtering~~ — **✅ ALREADY CONSISTENT**
12. ~~Add request ID tracking~~ — **✅ DONE** (`X-Request-ID` header)
13. ~~Lock all reads~~ to `_sessions` — **✅ DONE** (copy-on-read)
14. ~~Move `SessionRecord`~~ to `app/schemas/` — **✅ DONE**

### Phase 3: Production Readiness (Higher Effort)

15. ~~Rate limiting~~ — **✅ DONE** (built-in, no extra dep)
16. ~~Structured logging~~ with `structlog` — **⏳ DEFERRED** (L-7)
17. ~~WebSocket race condition fix~~ — **✅ DONE**
18. ~~Pagination~~ on `list_files` — **✅ DONE**
19. ~~Document expected RPC response format~~ — **✅ DONE** (M-6)
20. ~~CORS origin header validation~~ — **✅ ALREADY SECURE**

---

## Code Walkthrough by File

### `main.py`

| Line | Issue | Severity |
|------|-------|----------|
| 27 | `__import__("logging")` inline import | C-4 |
| 39 | CORS `allow_origins` accepts any origin on the port | L-6 |
| 58 | No gzip/compression middleware | L-5 |
| 61 | No health check endpoint | M-1 |

### `schemas/__init__.py`

| Line | Issue | Severity |
|------|-------|----------|
| 1-30 | `SessionRecord` not here (lives in `session_manager.py`) | L-8 |

### `api/project.py`

| Line | Issue | Severity |
|------|-------|----------|
| 18-29 | `_resolve_project_path` duplicated (should be in `utils.py`) | C-1, H-2 |
| 77-80 | Calls `get_sessions` twice in `create_session` | Low (minor perf) |

### `api/browse.py`

| Line | Issue | Severity |
|------|-------|----------|
| 16-23 | No path confinement check | C-2 |
| 19 | Filters `_` prefix dirs (inconsistent with files.py) | L-3 |
| 18 | Path resolution duplicated | C-1 |

### `api/files.py`

| Line | Issue | Severity |
|------|-------|----------|
| 16-24 | `_resolve_project_path` duplicated | C-1, H-2 |
| 50-52 | No binary file detection | H-3 |
| 35 | No path confinement check (only checks `is_relative_to` after resolving) | C-2 (partial) |
| 33 | Filters `.` but not `_` prefix (inconsistent) | L-3 |
| 13 | No pagination | L-4 |

### `api/session.py`

| Line | Issue | Severity |
|------|-------|----------|
| 18 | No `session_id` validation | C-3 |
| 36 | No `session_id` validation | C-3 |
| 53 | No `session_id` validation | C-3 |

### `api/chat.py`

| Line | Issue | Severity |
|------|-------|----------|
| 37 | No `session_id` validation | C-3 |
| 78-95 | `_relay_messages` race condition risk | M-2 |
| 131-138 | `_write_stdin` silently returns on failure | M-5 |
| 140-146 | `_write_stdin_raw` same issue | M-5 |
| 1-25 | No request ID tracking | L-1 |

### `api/model.py`

| Line | Issue | Severity |
|------|-------|----------|
| 17-30 | `_parse_rpc_models` fragile response parsing | M-6 |
| 40-44 | `_cached_models` accessed as private | C-5 |

### `session_manager.py`

| Line | Issue | Severity |
|------|-------|----------|
| 110 | `_cached_models` class var, no getter | C-5 |
| 113-140 | Model cache never refreshes | H-1 |
| 155-175 | `_parse_models_output` fragile column parsing | M-4 |
| 260-280 | `_safe_terminate` modifies `_sessions` without lock in some paths | L-2 |
| 440-450 | Cleanup task never cancelled on shutdown | M-3 |
| 500+ | `get_session` doesn't acquire lock | L-2 |
