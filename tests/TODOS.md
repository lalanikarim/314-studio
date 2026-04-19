# Tests Cleanup — Migration to uv Project

## Phase 1: Fix Breakages (must-do)

### ✅ T3: Fix `TEST_MODEL2_ID` default in `test_utils.py`
- **Status**: ✅ Done
- **File**: `test_utils.py:23`
- **Detail**: `TEST_MODEL2_ID = ""` — the env var check (`os.environ.get("TEST_MODEL2_ID", "")`) is correct but the initial assignment overrides it to `""` before flows can override. The flow files do `os.environ.get("TEST_MODEL_ID", ...)` but `TEST_MODEL2_ID` is imported as `""` before the env check can help.
- **Action**: Set default to `""` via env directly: `TEST_MODEL2_ID = os.environ.get("TEST_MODEL2_ID", "")` at module level.

### ✅ T1: Remove dead `start_uvicorn` / `stop_uvicorn` references
- **Status**: ✅ Done
- **Files**: `test_flow2_file_browse.py`, `test_flow3_multi_session.py`
- **Detail**: `__main__` blocks call `start_uvicorn()` and `stop_uvicorn()` which are never defined in `integration_test_harness.py`. These are dead code and will raise `NameError` if anyone runs `python test_flow2_file_browse.py` directly.
- **Action**: Remove the `start_uvicorn()` / `stop_uvicorn()` / `try/finally` blocks from each `__main__`. Keep the harness-only entry point as-is (harness expects `run()` function).

### ✅ T2: Fix Flow 7 `run()` — crashes on early return
- **Status**: ✅ Done
- **File**: `test_flow7_shutdown_cleanup.py`
- **Detail**: `run(result)` is a regular (sync) function. When it `return`s early (e.g., no uvicorn process found, no `lsof`, SIGTERM failure), the harness gets back `None` and crashes on `result.failed`. Other flows return nothing too but are async so the event loop handles it differently — still, Flow 7 is the only one that `return`s without `return result` or `async def`.
- **Action**: Either make it `async def run(result)` wrapping the sync body in `asyncio.to_thread()`, or remove it entirely since it requires live OS process inspection (not suitable for automated runs). Recommend keeping but making it safe.

---

## Phase 2: Project Consolidation

### ✅ T9: Make fixture dir path configurable
- **Status**: ✅ Done
- **File**: `test_utils.py`
- **Detail**: `TESTS_DIR = Path.home() / "Projects" / "web-pi-integration-tests"` — hard-coded to a specific machine's home directory.
- **Action**: Read from env var `TESTS_DIR` with fallback to current dir: `TESTS_DIR = Path(os.environ.get("TESTS_DIR", str(Path.home() / "Projects" / "web-pi-integration-tests")))`

### ✅ T6: Add `conftest.py` for pytest support
- **Status**: ✅ Done
- **File**: `tests/conftest.py` (new)
- **Detail**: No pytest fixtures exist. Users can't run `pytest` naturally.
- **Action**: Add fixtures for:
  - `async_client` — shared `httpx.AsyncClient`
  - `tests_dir` — fixture directory path (from env or default)
  - `test_model_id`, `test_model2_id` — env-based model config
  - `api_base`, `ws_base`, `timeout` — env-based or constant
  - `session_cleanup` — auto-cleanup fixture (optional, may be too heavy for integration tests)

### ✅ T5: Remove `sys.path.insert(0, ...)` from every flow file
- **Status**: ✅ Done
- **Files**: All `test_flow*.py` files
- **Detail**: Every flow file does `sys.path.insert(0, str(Path(__file__).parent))` to import `test_utils`. This is fragile.
- **Action**: Once T4 is done and `__init__.py` exists, `from test_utils import ...` works without sys.path hacks. Remove all `sys.path.insert` lines.

### ✅ T4: Remove duplicate constants
- **Status**: ✅ Done
- **Files**: `test_utils.py`, `integration_test_harness.py`
- **Detail**: `API_BASE`, `TESTS_DIR`, `FLAT_DIR`, `NESTED_DIR`, `TIMEOUT` are defined in both files.
- **Action**: Keep all constants in `test_utils.py`. Import them in `integration_test_harness.py` instead of duplicating.

### ✅ T7: Generate `uv.lock` for tests/
- **Status**: ✅ Done
- **File**: `tests/uv.lock` (new)
- **Detail**: `pyproject.toml` exists but no lockfile. Dependencies may resolve differently across machines.
- **Action**: Run `uv lock` in `tests/` directory.

### ✅ T8: Remove redundant `__main__` blocks
- **Status**: ✅ Done
- **Files**: All `test_flow*.py` files
- **Detail**: Each flow file has a `if __name__ == "__main__"` block that duplicates the harness entry point logic. The harness already provides the CLI interface.
- **Action**: Keep `__main__` only if standalone execution is desired. Otherwise remove to reduce maintenance burden. Decision: keep minimal `__main__` that delegates to harness for debugging convenience.

---

## Phase 3: Cleanup

### ✅ T10: Remove cache / scratch directories
- **Status**: ✅ Done
- **Locations**: `tests/__pycache__/`, `tests/.ruff_cache/`, `tests/.pi-lens/`
- **Action**: Removed cache dirs.

### ✅ T11: Add `tests/.gitignore`
- **Status**: ✅ Done
- **File**: `tests/.gitignore` (new)
- **Action**: Ignore `__pycache__/`, `.ruff_cache/`, `.ty_cache/`, `.pytest_cache/`, `uv.lock`, `.pi-lens/`

---

## Execution Order

```
T3 → T4 → T5 → T9 → T6 → T1 → T2 → T7 → T8 → T10 → T11
```

- T3–T9: Fix test_utils and imports first (foundation)
- T1, T2: Fix broken flows
- T7: Lock dependencies
- T8, T10–T11: Cleanup
