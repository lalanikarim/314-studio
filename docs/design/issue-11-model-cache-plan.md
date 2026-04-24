# Issue #11 — Cache Models via `pi --list-models` at Startup

> **Status**: Plan drafted, awaiting review & approval
> **Related**: Issue #11 on GitHub

---

## 1. Problem Restatement

The current `GET /api/models/?session_id=...` endpoint requires an **active session** to list available models. This causes:

| Symptom | Root Cause |
|---------|------------|
| Model selector blocked on step 2 (before session creation) | No models without RPC-ready session |
| Repeated RPC queries on reconnect/refresh | Every request sends `get_available_models` |
| Race conditions if models endpoint called before session | `session_id` is `Query(...)` — required, not optional |

**Models don't change at runtime.** Every model query returns the same data. Caching at startup eliminates the RPC overhead and removes the session dependency.

---

## 2. Key Discovery: `pi --list-models` Output Format

`pi --list-models` produces **tabular plaintext** (no JSON mode available):

```
provider   model                                           context  max-out  thinking  images
anthropic  claude-opus-4-6                                 1M       128K     yes       yes
ollama     deepseek-coder-v2:16b                           163.8K   8.2K     yes       no
ollama     hf.co/unsloth/Qwen3-Coder-Next-GGUF:UD-Q4_K_M   262.1K   8.2K     yes       no
```

**Parsing challenges**:
- Model names may contain `:`, `/` (e.g., `hf.co/unsloth/Qwen3-Coder-Next-GGUF:UD-Q4_K_M`)
- Context values use suffixes: `K`, `M` (e.g., `1M`, `200K`, `163.8K`)
- Columns appear space/tab separated — must parse from the **right** since model names are the variable-width middle column

### Parsing Strategy: Right-to-Left

Split each data line from the right:

```python
# For line: "ollama    hf.co/unsloth/Qwen3-Coder-Next-GGUF:UD-Q4_K_M   262.1K   8.2K    yes       no"
# Known fixed-width tail: context  max_out  thinking  images
# Strategy: split from right, 4 fields
parts = line.rsplit(None, 4)
# parts[0] = "ollama"   (provider)
# parts[1] = "hf.co/..." (model)
# parts[2] = "262.1K"   (context)
# parts[3] = "8.2K"     (max-out) — not in ModelConfig
# parts[4] = "yes"      (thinking)
# (images = parts[5] — not in ModelConfig)

# Parse context: "200K" → 200_000, "1M" → 1_000_000
def parse_context(s: str) -> int:
    s = s.strip().upper()
    if s.endswith('M'): return int(s[:-1]) * 1_000_000
    if s.endswith('K'): return int(s[:-1]) * 1_000  # rough
    return int(s)
```

---

## 3. Implementation Plan

### 3.1 Backend: `session_manager.py`

Add a **class-level** cache and a startup method:

```python
# In SessionManager class:
_cached_models: Optional[list[dict]] = None  # class-level: list of parsed model dicts

async def fetch_available_models(self) -> Optional[list[dict]]:
    """
    Run `pi --list-models`, parse the tabular output, and cache the result.

    Returns the list of model dicts on success, None on failure.
    """
    if self._cached_models is not None:
        return self._cached_models  # already cached

    proc = await asyncio.create_subprocess_exec(
        "npx", "pi", "--list-models",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30.0)

    if proc.returncode != 0:
        stderr_text = stderr.decode(errors="replace")
        logger.warning("pi --list-models failed (exit %d): %s", proc.returncode, stderr_text[:200])
        return None  # RPC fallback will still work

    return self._parse_models_output(stdout.decode())

def _parse_models_output(self, text: str) -> list[dict]:
    """Parse `pi --list-models` tabular output → list of ModelConfig dicts."""
    models = []
    lines = text.strip().splitlines()

    for line in lines:
        line = line.strip()
        if not line or line.startswith("provider"):
            continue  # skip header line

        parts = line.rsplit(None, 4)
        if len(parts) < 6:
            continue  # don't parse malformed lines

        provider = parts[0]
        model_id = parts[1]
        context_str = parts[2]

        context = self._parse_context(context_str)

        models.append({
            "id": model_id,
            "provider": provider,
            "contextWindow": context,
        })

    self._cached_models = models  # cache it
    return models

@staticmethod
def _parse_context(s: str) -> int:
    s = s.strip().upper()
    if s.endswith('M'):
        return int(s[:-1]) * 1_000_000
    if s.endswith('K'):
        return int(s[:-1]) * 1_000
    try:
        return int(s)
    except ValueError:
        return 0
```

### 3.2 Backend: `main.py`

Call the fetch in `lifespan`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await session_manager.initialize()
    await session_manager.fetch_available_models()  # NEW
    session_manager.start_cleanup_task()
    if session_manager._cached_models:
        logger.info("Cached %d models from `pi --list-models`", len(session_manager._cached_models))
    yield
    await session_manager.shutdown_all()
```

### 3.3 Backend: `api/model.py`

Make `session_id` **optional**. Serve cached data first, fall back to RPC:

```python
@router.get("/", response_model=List[ModelConfig])
async def list_models(
    session_id: Optional[str] = Query(None, description="Session to query (optional – uses cache if available)"),
) -> List[ModelConfig]:
    # 1. Return cached models if available (no session needed)
    if session_manager._cached_models:
        return [ModelConfig(**m) for m in session_manager._cached_models]

    # 2. If session provided, try RPC (backward compatibility + edge cases)
    if session_id:
        record = session_manager.get_session(session_id)
        if record and record.status == "running" and record.stdin:
            try:
                result = await session_manager._send_command_internal(
                    record, {"type": "get_available_models"}, timeout=30.0
                )
                return _parse_rpc_models(result.get("result", result.get("data", result)))
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Pi RPC failed: {exc}")

    # 3. No cache and no session → return empty (frontend will show "no models")
    return []
```

**Key design decisions**:
- `session_id` becomes **optional** (`Query(None)` not `Query(...)`) — removes the blocker
- Cached data is always returned first (no race condition)
- RPC fallback only triggers if `session_id` is provided **and** cache is empty (won't happen after startup in normal operation)
- Returns `[]` if neither cache nor session available — safe, lets frontend show "no models" state

### 3.4 Frontend: `services/api.ts`

Already supports optional `sessionId` — `listModels()` already passes `""` query if no sessionId. The backend currently returns 422 for missing `session_id` (required Query param), so once the backend change ships, this **requires no change**. Document the optional parameter:

```typescript
/**
 * List available models.
 * @param sessionId — optional; omitted = uses server's cached list (recommended)
 */
export async function listModels(sessionId?: string): Promise<ModelConfig[]> {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    return request<ModelConfig[]>(`/api/models/${qs}`);
}
```

### 3.5 Frontend: `hooks/useModels.ts`

**Simplify the hook** to call models without a session first:

```typescript
useEffect(() => {
    // Cancel previous
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    if (!projectPath) {
        setLoading(false);
        return;
    }

    const run = async () => {
        // Step 0: Check localStorage cache first (existing behavior)
        const cachedModels = getCachedModels();
        if (cachedModels && cachedModels.length > 0) {
            setModels(cachedModels);
            setLoading(false);
            return;
        }

        // Step 0.5: Fetch model list WITHOUT creating a session
        // This is the new behavior: models are available before session
        const models = await fetchModelsWithoutSession();
        if (models.length > 0) {
            setModels(models.map(m => ({
                id: m.id, name: deriveModelName(m.id, m.provider),
                provider: m.provider, contextWindow: m.contextWindow || 0,
                maxTokens: m.maxTokens || 0
            })));
            cacheModels(models);
            setLoading(false);

            // Now create the session
            // (session_creation logic continues as before...
```

**Impact**: The hook now loads models **instantly** (cached or from startup cache) before creating any session. Session creation only happens for actual communication.

### 3.6 Tests

Add **Flow 9: Cached Model List** test:

```python
# tests/test_flow9_cached_models.py

async def test_list_models_no_session(client, result):
    """T9.1 — GET /api/models/ without session_id returns cached models."""
    resp = await http_get(client, "/api/models/")
    result.check(resp.status_code == 200)
    models = resp.json()
    result.check(len(models) > 0)

async def test_model_provider_parsing(client, result):
    """T9.2 — Verify provider is correctly parsed from cached models."""
    resp = await http_get(client, "/api/models/")
    models = resp.json()
    providers = {m["provider"] for m in models}
    result.check("anthropic" in providers, f"anthropic provider present, got {providers}")
    result.check("ollama" in providers, f"ollama provider present, got {providers}")

async def test_model_context_parsing(client, result):
    """T9.3 — Verify contextWindow is parsed correctly."""
    resp = await http_get(client, "/api/models/")
    models = resp.json()
    for m in models:
        mw = m["contextWindow"]
        result.check(isinstance(mw, int), f"contextWindow is int for {m['id']}")
        result.check(mw > 0, f"contextWindow > 0 for {m['id']}")
```

---

## 4. Files Changed Summary

| File | Type | Changes |
|------|------|---------|
| `backend/app/session_manager.py` | **Modify** | Add `_cached_models`, `fetch_available_models()`, `_parse_models_output()`, `_parse_context()` |
| `backend/app/main.py` | **Modify** | Call `fetch_available_models()` in lifespan |
| `backend/app/api/model.py` | **Modify** | Make `session_id` optional, use cache as primary source |
| `frontend/src/hooks/useModels.ts` | **Modify** | Call `/api/models/` without session_id before creating session |
| `tests/test_flow9_cached_models.py` | **New** | 3+ tests for cached model list (no session required) |

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `npx pi` is slow at startup (npm install, cold start) | Server startup takes 5-10s extra | Use `asyncio.wait_for(timeout=10.0)`; if it times out, silently fall through to RPC path later |
| `pi --list-models` output format changes | Parser breaks silently | Log full stderr on failure; wrap parser in try/except |
| `pi` not in PATH | Cache empty, RPC path unavailable | Both code paths fail equally — same behavior as before |
| Frontend still sends `session_id` | Wastes RPC call but harmless | Backend returns cache first regardless of session_id presence |

### Startup Timeout Detail

`npx pi --list-models` can be **slow** on first run (npm resolution). Default should be generous:

```python
# In lifespan:
try:
    await asyncio.wait_for(session_manager.fetch_available_models(), timeout=15.0)
except asyncio.TimeoutError:
    logger.warning("pi --list-models timed out at startup, will use RPC fallback")
```

---

## 6. Rollout Order (Recommended)

1. **Backend changes first** (`session_manager.py` → `main.py` → `model.py`)
   - Run tests: `uv run pytest tests/` — all existing tests pass (backward compat: `session_id` still accepted)
2. **Frontend changes** (`useModels.ts`)
   - The frontend change is safe — calling `/api/models/` without `session_id` now works
3. **Add new tests** (`test_flow9_cached_models.py`)
4. **Deploy & verify** — check logs for `Cached N models` message

---

## 7. Open Questions / Decisions Needed

1. **`npx pi` vs `pi` for subprocess**: Currently `which pi` resolves via nvm to `/Users/karim/.nvm/versions/node/v25.2.1/bin/pi`. Should we use `npx pi` (slower, guaranteed to be the project's version) or `pi` (faster, depends on PATH)?
   - **Recommendation**: Use `npx pi --list-models` in the subprocess — more reliable across environments. The overhead is one-time at startup.

2. **Should we store the full `pi --list-models` JSON in a sidecar file** for faster restarts?
   - Unnecessary complexity for now. `pi --list-models` is fast enough once npm is warm.

3. **Should we add a `POST /api/cache/reload` endpoint** to reload the model cache without restart?
   - Nice-to-have but not needed for v1. Adding a "reload" endpoint adds attack surface and state management complexity.

4. **How should `ModelConfig` handle maxTokens?** We don't have it from `pi --list-models`.
   - It's optional in the schema, so `None` is fine. The frontend already handles 0/null for `maxTokens`.

---

## Appendix A: `pi --list-models` Sample Output (tab-separated)

Confirmed tab-separated columns:

```
provider<TAB>model<TAB>context<TAB>max-out<TAB>thinking<TAB>images
anthropic<TAB>claude-opus-4-6<TAB>1M<TAB>128K<TAB>yes<TAB>yes
ollama<TAB>deepseek-r1:70b<TAB>131.1K<TAB>8.2K<TAB>yes<TAB>no
ollama<TAB>hf.co/unsloth/Qwen3-Coder-Next-GGUF:UD-Q4_K_M<TAB>262.1K<TAB>8.2K<TAB>yes<TAB>no
```

## Appendix B: Comparison with Existing RPC Parser

| Aspect | RPC `get_available_models` | CLI `pi --list-models` |
|--------|---------------------------|-----------------------|
| Format | JSON dict (`{models: [...]}`) | Tabular text |
| Fields | `modelId`, `provider`, `contextWindow`, `maxTokens` | `provider`, `model`, `context`, `max-out`, `thinking`, `images` |
| Parsing | Already exists in `_parse_rpc_models()` | New `_parse_models_output()` needed |
| Availability | Only from running session | Anytime from CLI |
| Speed | Instant (in-process) | Subprocess launch (cached after 1st call) |
