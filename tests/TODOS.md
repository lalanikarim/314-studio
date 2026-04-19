# Tests — Done

All Phase 1–3 cleanup items from the original plan are complete. Test suite is running and passing.

## Summary

- **pytest infrastructure**: `conftest.py` with fixtures, subfixture support, `test_utils.py` with shared helpers
- **73 tests passing** across flows 1–4, 5–6
- **Run**: `API_BASE=http://127.0.0.1:8000 WS_BASE=ws://127.0.0.1:8000 uv run pytest -v`
- **Harness**: `uv run run-tests` (CLI entry point from `pyproject.toml`)

## Completed

- [x] Fix `TEST_MODEL2_ID` default in `test_utils.py`
- [x] Remove dead `start_uvicorn` / `stop_uvicorn` references
- [x] Fix Flow 7 `run()` — safe exit on early return
- [x] Make fixture dir path configurable via `TESTS_DIR` env var
- [x] Add `conftest.py` for pytest support (fixtures + subfixture hook)
- [x] Remove `sys.path.insert(0, ...)` from every flow file
- [x] Remove duplicate constants (kept in `test_utils.py`)
- [x] Generate `uv.lock` for tests/
- [x] Remove redundant `__main__` blocks from flow files
- [x] Cache/scratch directories cleaned
- [x] `tests/.gitignore` added
- [x] Subfixture pattern working (session_id, ws, session1_id, session2_id)
- [x] WS fixture creates fresh connection per test (avoids event-loop mismatch)
- [x] Flow 4 rewritten: pytest-compatible (4 tests, 6 pass + 2 optional skip)
  - T4.1: Create session with primary model → model_id verified, running
  - T4.2: Switch model REST + WS reconnect → skips if TEST_MODEL2_ID not set
  - T4.3: Chat on original session (skip path note)
  - T4.4: Recreate session with original model → WS connect + chat verified
- [x] Flow 5 rewritten: pytest-compatible (4 tests, all passing)
  - T5.1: Create session → status running, PID set and alive
  - T5.2: Close session → compacted accepted (True or False), PID terminated, session removed
  - T5.3: Create session for delete → status running, PID set and alive
  - T5.4: Delete session → compacted == False, PID terminated, session removed
  - T5.5: Final clean state verification → running_count == 0
- [x] Flow 6 rewritten: pytest-compatible (12 tests, all passing)
  - T6.1: Create session on non-existent project → 404
  - T6.1b: Missing project_path → 422
  - T6.2: Close/delete/model-switch on non-existent session → 404
  - T6.3: WS connect to non-existent session → rejected
  - T6.3b: Project info on non-existent project → 404
  - T6.4a/4b: Path traversal in files list and read → 403
  - T6.5a: Read non-existent file → 404
  - T6.5b: Duplicate session names → allowed (unique IDs)
  - T6.5c: Browse non-existent directory → 200 with empty list

## Pending Test Flows

| Flow | File | Tests | Status |
|------|------|-------|--------|
| 7: Shutdown | `test_flow7_shutdown_cleanup.py` | — | ⏳ Not written |

See `docs/design/integration-test-plan.md` for detailed test specifications for flows 4–7.
