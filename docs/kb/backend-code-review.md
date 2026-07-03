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

### C-1: Duplicate `_resolve_project_path` Across Files

**Files**: `project.py`, `files.py`, `browse.py`

The same path resolution logic (with a `~/Projects/{name}` fallback) is reimplemented in three places. `browse.py` reimplements it without the fallback. If the resolution logic changes, all three must be updated.

**project.py** (authoritative):
```python
def _resolve_project_path(project_path: Optional[str]) -> Path:
    if not project_path:
        raise HTTPException(400, "Missing required query parameter: project_path")
    resolved = Path(project_path).expanduser()
    if not resolved.is_absolute() and not resolved.exists():
        candidate = Path.home() / "Projects" / project_path
        if candidate.exists():
            resolved = candidate
    return resolved
```

**files.py** (duplicate, no fallback):
```python
def _resolve_project_path(project_path_str: Optional[str]) -> Path:
    # Same logic, different parameter name, no ~/Projects fallback
```

**browse.py** (partial duplicate):
```python
# Inline logic, no fallback at all
target = Path(path).expanduser() if path else Path.home() / "Projects"
```

**Fix**: Extract to `app/utils.py:resolve_project_path()`.

---

### C-2: Unfiltered Filesystem Browsing in `/api/browse`

**File**: `browse.py`

The `/api/browse` endpoint accepts any path and returns all subdirectories. No security check confines browsing to `~/Projects`. A client could browse the entire filesystem:

```
GET /api/browse?path=/etc
→ returns all /etc subdirectories
```

**Current code**:
```python
@router.get("/browse")
async def browse(path: Optional[str] = None) -> List[dict]:
    if path:
        target = Path(path).expanduser()
    else:
        target = Path.home() / "Projects"
    # No validation that target is within ~/Projects
```

**Fix**: Add a path confinement check after resolving the target:
```python
home = Path.home() / "Projects"
if not target.resolve().is_relative_to(home.resolve()):
    return []  # or raise 403
```

---

### C-3: No Input Validation on `session_id`

**Files**: `session.py`, `chat.py`

Both endpoints accept arbitrary strings as `session_id` with no format validation. While it's used in a dict lookup (no SQL injection risk), garbage values waste resources and make debugging harder.

**session.py**:
```python
@router.post("/{session_id}/close")
async def close_session(session_id: str) -> dict:  # No validation
```

**chat.py**:
```python
async def ws_endpoint(websocket: WebSocket, session_id: str = Query(...)) -> None:
    # No validation
```

**Fix**: Validate format (e.g., UUID4 pattern, or alphanumeric with `sess_` prefix). Reject invalid IDs with 400 before any processing.

---

### C-4: `main.py` Uses `__import__("logging")`

**File**: `main.py:27`

Inline import is a code smell. Use a proper module-level logger.

```python
# Current (bad)
logger = __import__("logging").getLogger(__name__)

# Should be
import logging
logger = logging.getLogger(__name__)
```

---

### C-5: `_cached_models` Class Variable Accessed as Private

**File**: `session_manager.py`

`_cached_models` is declared as a class variable but accessed from `main.py` and `model.py` as if private. No getter, no type safety, no encapsulation.

```python
# session_manager.py
_cached_models: list[dict] | None = None  # class-level

# main.py — accessed directly
if session_manager._cached_models:
    ...

# model.py — accessed directly
if session_manager._cached_models:
    return [ModelConfig(**m) for m in session_manager._cached_models]
```

**Fix**: Add a public getter method and type the cache as `list[dict]` consistently, or switch to `list[ModelConfig]`.

---

## High Priority

### H-1: Model Cache Never Refreshes

**File**: `session_manager.py`, `main.py`

`_cached_models` is populated **once at server startup** via `pi --list-models` and never updated. If new models are added to `pi` after the server starts, they won't appear until a restart.

```python
# main.py lifespan
await session_manager.fetch_available_models()
# Never called again until server restart
```

**Impact**: The user's earlier complaint about stale models is caused by this — the server cache is stale, and clearing only the browser localStorage doesn't help if the server hasn't re-fetched.

**Fix options**:
1. **TTL-based auto-refresh**: Add a background task that re-runs `pi --list-models` every N minutes
2. **Manual refresh endpoint**: Add `POST /api/models/refresh` that the frontend can call
3. **Hybrid**: Auto-refresh on first request if cache is older than N minutes

---

### H-2: No Shared Path Resolution Utility

**Related to C-1**

Three files contain near-identical path resolution logic. This is a maintenance burden and a source of inconsistency (e.g., `browse.py` skips `_` prefix dirs, `files.py` doesn't).

**Fix**: Create `app/utils.py`:
```python
def resolve_project_path(project_path: Optional[str]) -> Path:
    """Resolve project path with ~/Projects fallback."""
    ...

def confine_path(target: Path, root: Path) -> bool:
    """Check that target is within root directory."""
    ...
```

---

### H-3: `/files/read` Reads Binary Files as Text

**File**: `files.py`

The endpoint opens all files with `"r"` mode (text). Binary files (images, compiled binaries, etc.) will either produce garbage output or raise `UnicodeDecodeError`.

```python
async with aiofiles.open(target_path, "r") as f:
    content = await f.read()
```

**Fix**: Detect binary content before reading:
```python
# Check first 8KB for null bytes
sample = await f.read(8192)
if b'\x00' in sample:
    raise HTTPException(400, "File appears to be binary")
# Seek back and read full content
await f.seek(0)
content = await f.read()
```

Or offer a `?format=b64` query parameter for binary files.

---

### H-4: No Rate Limiting

**All endpoints**

No protection against rapid-fire requests. A buggy frontend could hammer `/files/read` or `/api/browse`, wasting I/O and CPU.

**Fix**: Add `slowapi` middleware or a simple in-memory rate limiter:
```python
from slowapi import Limiter
limiter = Limiter(key_func=slowapi.util.get_remote_address)
app.state.limiter = limiter
```

---

## Medium Priority

### M-1: No Health Check Endpoint

**Missing endpoint**

No `/health` or `/ready` for monitoring, load balancers, or container orchestration.

**Fix**: Add a simple endpoint:
```python
@router.get("/health")
async def health():
    return {"status": "ok", "sessions": len(session_manager.get_running_instances())}
```

---

### M-2: `_relay_messages` Race Condition Risk

**File**: `chat.py`

When `out_task` completes (process exits, event_buffer returns `None`) but `in_task` is still running, `disconnect_ws` is called in the `finally` block. The `asyncio.wait` with `FIRST_COMPLETED` handles the basic case, but there's a subtle race: if the outbound task finishes and the inbound task tries to send to a WebSocket that's been closed, it could raise an exception that's caught but logged.

**Current code**:
```python
done, pending = await asyncio.wait({out_task, in_task}, return_when=asyncio.FIRST_COMPLETED)
for task in pending:
    task.cancel()
    ...
```

**Fix**: Add a shared `Event` or flag that both tasks check before sending:
```python
self._closed = asyncio.Event()

async def _outbound():
    while not self._closed.is_set():
        ...

async def _inbound():
    while not self._closed.is_set():
        ...
```

---

### M-3: Background Cleanup Task Never Awaited/Canceled

**File**: `session_manager.py`

`start_cleanup_task()` creates a background task that runs every 30 seconds. It's never cancelled on shutdown, and the lifespan doesn't await it.

```python
# main.py
session_manager.start_cleanup_task()
# ... later, on shutdown:
await session_manager.shutdown_all()
# cleanup_task is never cancelled
```

**Fix**: Store the task reference and cancel it in `shutdown_all()`:
```python
async def shutdown_all(self):
    if self._cleanup_task and not self._cleanup_task.done():
        self._cleanup_task.cancel()
        try:
            await self._cleanup_task
        except asyncio.CancelledError:
            pass
    ...
```

---

### M-4: `_parse_models_output` Parsing Is Fragile

**File**: `session_manager.py`

The column-based parsing (`parts[1:-4]`) assumes a fixed output format from `pi --list-models`. If the tool changes its output columns (adds/removes a column), parsing breaks silently — lines just get skipped because `len(parts) < 6`.

```python
parts = s.split()
if len(parts) < 6:
    continue  # Silently dropped
model_id = " ".join(parts[1:-4])
```

**Fix**: Log a warning when lines are skipped, and consider using a more robust parser (e.g., regex-based column detection, or parsing by known column positions).

---

### M-5: `_write_stdin` Silently Swallows Errors

**File**: `chat.py`

If stdin is broken, `_write_stdin` just returns without logging. The caller (inbound relay) has no way to know the write failed.

```python
async def _write_stdin(session_id: str, payload: dict) -> None:
    record = session_manager.get_session(session_id)
    if not record or record.status != "running" or record.stdin is None:
        return  # Silently returns
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    record.stdin.write(line.encode("utf-8"))
    await record.stdin.drain()  # BrokenPipeError not caught
```

**Fix**: Log a warning on failure and raise a specific exception so the caller can handle it:
```python
async def _write_stdin(...):
    ...
    try:
        record.stdin.write(...)
        await record.stdin.drain()
    except (BrokenPipeError, ConnectionResetError) as exc:
        logger.warning("Session %s stdin broken: %s", session_id, exc)
        raise
```

---

### M-6: `_parse_rpc_models` Response Parsing Is Guesswork

**File**: `model.py`

The fallback chain `raw.get("models", raw.get("data", []))` is defensive but fragile. If Pi's RPC response format changes, it might silently return an empty list with no error.

```python
items = raw if isinstance(raw, list) else raw.get("models", raw.get("data", []))
```

**Fix**: Log a warning when the response format is unexpected, and document the expected format.

---

## Low Priority / Nice-to-Have

### L-1: No Request ID Tracking

No correlation ID for debugging WebSocket message flows. When a user reports "my chat message didn't go through," there's no way to trace which WebSocket session handled it.

**Fix**: Generate a UUID per request and include it in log messages and optionally in the WebSocket message format.

---

### L-2: `_safe_terminate` Races with `get_session`

**File**: `session_manager.py`

`get_session` doesn't acquire the lock, so it could return a record being modified by `_safe_terminate` (which sets `status = "stopped"` then pops from `_sessions`).

```python
# get_session — no lock
def get_session(self, session_id: str) -> SessionRecord | None:
    return self._sessions.get(session_id)

# _safe_terminate — modifies _sessions without lock in some paths
async with self._lock:
    record = self._sessions.get(session_id)
    if not record:
        return
    record.status = "stopped"
# ... later:
self._sessions.pop(session_id, None)
```

**Fix**: Either lock all read access to `_sessions`, or use a copy-on-read pattern.

---

### L-3: Inconsistent `_` Prefix Filtering

**Files**: `browse.py` vs `files.py`

`browse.py` skips directories starting with `.` or `_`. `files.py` only skips `.` prefix. This means `_hidden_dir/` files appear in file listings but not in folder browsing.

**Fix**: Standardize filtering in the shared utility.

---

### L-4: No Pagination on `list_files`

**File**: `files.py`

A project with thousands of files returns them all in one response. Could be slow and memory-intensive.

**Fix**: Add `?limit=100&offset=0` query parameters with a default limit.

---

### L-5: No Gzip/Compression Middleware

**All endpoints**

FastAPI doesn't enable response compression by default. Large model lists or file contents could be compressed significantly.

**Fix**: Add `fastapi.middleware.gzip.GZipMiddleware`.

---

### L-6: Loose CORS Origin Validation

**File**: `main.py`

CORS is configured to allow `http://localhost:{FRONTEND_PORT}` but doesn't validate the `Origin` header on requests. A malicious site on the same port could make cross-origin requests.

**Fix**: Use `allow_origins` with explicit values and validate the `Origin` header.

---

### L-7: No Structured Logging

**All files**

All logging uses plain text. In production, JSON-formatted logs are easier to search and aggregate.

**Fix**: Use `structlog` or configure `logging` with a JSON formatter.

---

### L-8: `SessionRecord` Schema Lives in `session_manager.py`

**File**: `session_manager.py`

The `SessionRecord` Pydantic model is defined in `session_manager.py` but the `schemas/` package is empty (only contains `FileInfo`, `ModelConfig`, etc.). The comment in `schemas/__init__.py` says `SessionRecord` is the source of truth, but it's not in the schemas package.

**Fix**: Move `SessionRecord` to `app/schemas/session.py` for consistency.

---

## Summary Matrix

| ID | Severity | File(s) | Issue | Effort |
|----|----------|---------|-------|--------|
| C-1 | Critical | project.py, files.py, browse.py | Duplicate `_resolve_project_path` | Low |
| C-2 | Critical | browse.py | Unfiltered filesystem browsing | Low |
| C-3 | Critical | session.py, chat.py | No `session_id` validation | Low |
| C-4 | Critical | main.py | `__import__("logging")` code smell | Trivial |
| C-5 | Critical | session_manager.py, main.py, model.py | `_cached_models` as private class var | Low |
| H-1 | High | session_manager.py, main.py | Model cache never refreshes | Medium |
| H-2 | High | project.py, files.py, browse.py | No shared path utility | Low |
| H-3 | High | files.py | Binary file handling | Medium |
| H-4 | High | All endpoints | No rate limiting | Medium |
| M-1 | Medium | Missing | No health check endpoint | Trivial |
| M-2 | Medium | chat.py | `_relay_messages` race condition | Medium |
| M-3 | Medium | session_manager.py | Cleanup task never cancelled | Low |
| M-4 | Medium | session_manager.py | Fragile model output parsing | Medium |
| M-5 | Medium | chat.py | `_write_stdin` silent failure | Low |
| M-6 | Medium | model.py | RPC response parsing guesswork | Low |
| L-1 | Low | chat.py | No request ID tracking | Low |
| L-2 | Low | session_manager.py | `_safe_terminate` race with reads | Medium |
| L-3 | Low | browse.py, files.py | Inconsistent `_` prefix filtering | Low |
| L-4 | Low | files.py | No pagination on `list_files` | Low |
| L-5 | Low | All endpoints | No gzip compression | Trivial |
| L-6 | Low | main.py | Loose CORS validation | Low |
| L-7 | Low | All files | No structured logging | Medium |
| L-8 | Low | session_manager.py | `SessionRecord` not in schemas | Low |

**Totals**: 24 issues (5 critical, 4 high, 6 medium, 7 low)

---

## Recommended Actions

Prioritized by impact vs effort:

### Phase 1: Quick Wins (Low Effort, High Impact)

1. **Extract path resolution** → `app/utils.py` — eliminates 3 copies of `_resolve_project_path`
2. **Add path confinement** to `/api/browse` — security fix, 3 lines of code
3. **Add input validation** on `session_id` — format check, 5 lines
4. **Fix `main.py` logger** — module-level import, 1 line
5. **Add `/health` endpoint** — monitoring, 5 lines
6. **Add gzip middleware** — compression, 2 lines
7. **Cancel cleanup task on shutdown** — resource leak, 5 lines
8. **Log warnings on silent failures** in `_write_stdin` and `_parse_models_output`

### Phase 2: Core Improvements (Medium Effort)

9. **Model cache refresh** — add TTL or manual refresh endpoint
10. **Binary file detection** in `/files/read`
11. **Standardize `_` prefix filtering** across all file endpoints
12. **Add request ID tracking** for WebSocket debugging
13. **Lock all reads** to `_sessions` in session_manager
14. **Move `SessionRecord`** to `app/schemas/`

### Phase 3: Production Readiness (Higher Effort)

15. **Rate limiting** with `slowapi`
16. **Structured logging** with `structlog` or JSON formatter
17. **WebSocket race condition fix** with shared close flag
18. **Pagination** on `list_files`
19. **Document expected RPC response format** in `_parse_rpc_models`
20. **CORS origin header validation**

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
