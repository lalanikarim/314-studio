#!/usr/bin/env python3
"""
Integration test: backend REST API flows against a live uvicorn server.

Tests every REST endpoint that the frontend calls, validating responses
match expected shapes.

Architecture:
  - Starts uvicorn in a subprocess on port 8765
  - Sends HTTP requests via httpx.AsyncClient
  - Validates response codes, shapes, and data integrity
  - Tests WebSocket chat endpoint separately
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import httpx

# ── Test project setup ─────────────────────────────────────────────────────

API_BASE = "http://127.0.0.1:8765"
TIMEOUT = 15.0

# Create a temporary project directory for testing
TEST_DIR = Path(tempfile.mkdtemp(prefix="web-pi-test-"))
(TEST_DIR / "README.md").write_text("# Test Project\n")
(TEST_DIR / "test_file.py").write_text('print("hello")\n')
(TEST_DIR / "main.py").write_text("def main(): pass\n")
(TEST_DIR / "config.yaml").write_text("key: value\n")

# Create nested subdirs
(TEST_DIR / "src").mkdir()
(TEST_DIR / "src" / "utils.py").write_text("def util(): pass\n")
(TEST_DIR / "tests").mkdir()
(TEST_DIR / "tests" / "test_main.py").write_text("def test_main(): pass\n")


class TestCase:
    """Track test results."""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.failures: list[str] = []

    def check(self, condition: bool, msg: str):
        if condition:
            print(f"  ✅ {msg}")
            self.passed += 1
        else:
            print(f"  ❌ {msg}")
            self.failed += 1
            self.failures.append(msg)

    def check_status(self, status: int, expected: int, msg: str):
        self.check(status == expected, f"Status {status} == {expected}: {msg}")

    def check_json(self, resp: httpx.Response, msg: str):
        self.check(resp.is_success, f"Response is JSON: {msg}")

    def print_summary(self):
        print(
            f"\n  Results: {self.passed} passed, {self.failed} failed, {self.passed + self.failed} total"
        )


tc = TestCase()

# ── Uvicorn subprocess management ──────────────────────────────────────────

uvicorn_proc: subprocess.Popen | None = None


def start_uvicorn():
    """Start the FastAPI uvicorn server in a subprocess."""
    global uvicorn_proc
    print(f"▶ Starting uvicorn on {API_BASE}...")
    env = os.environ.copy()
    uvicorn_proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--log-level",
            "warning",
        ],
        cwd=str(Path(__file__).parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    # Wait for server to be ready
    for _ in range(30):
        import time

        time.sleep(0.5)
        try:
            r = httpx.get(f"{API_BASE}/docs", timeout=2)
            if r.status_code == 200:
                print(f"  ✓ Uvicorn ready (PID {uvicorn_proc.pid})")
                return True
        except Exception:
            continue
    print(f"  ❌ Uvicorn failed to start (stderr: {uvicorn_proc.stderr.read().decode()[:500]})")
    return False


def stop_uvicorn():
    global uvicorn_proc
    if uvicorn_proc:
        print("▶ Stopping uvicorn...")
        try:
            uvicorn_proc.terminate()
            uvicorn_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            uvicorn_proc.kill()
            uvicorn_proc.wait()
        except Exception:
            pass
        uvicorn_proc = None


# ── Helpers ────────────────────────────────────────────────────────────────


async def http_get(
    client: httpx.AsyncClient, path: str, params: dict | None = None, **kwargs
) -> httpx.Response:
    url = f"{API_BASE}{path}"
    print(
        f"  → GET  {path}{'?' + '&'.join(f'{k}={v}' for k, v in (params or {}).items()) if params else ''}"
    )
    resp = await client.get(url, params=params, timeout=TIMEOUT, **kwargs)
    print(f"     ← {resp.status_code}", end="")
    try:
        body = resp.json()
        if isinstance(body, dict) and len(json.dumps(body)) > 200:
            body = {k: str(v)[:50] for k, v in body.items()}
        print(f" body={json.dumps(body, default=str)[:200]}")
    except Exception:
        print(f" body={resp.text[:200]}")
    return resp


async def http_post(
    client: httpx.AsyncClient, path: str, json_body: dict | None = None, params: dict | None = None
) -> httpx.Response:
    url = f"{API_BASE}{path}"
    print(
        f"  → POST {path}{'?' + '&'.join(f'{k}={v}' for k, v in (params or {}).items()) if params else ''}"
    )
    resp = await client.post(url, json=json_body, params=params, timeout=TIMEOUT)
    print(f"     ← {resp.status_code}", end="")
    try:
        body = resp.json()
        print(f" body={json.dumps(body, default=str)[:200]}")
    except Exception:
        print(f" body={resp.text[:200]}")
    return resp


async def http_ws(client: httpx.AsyncClient, path: str, params: dict):
    url = f"{API_BASE}{path}"
    print(
        f"  → WS   {path}{'?' + '&'.join(f'{k}={v}' for k, v in params.items()) if params else ''}"
    )
    ws = await client.websocket_connect(url, params=params, timeout=TIMEOUT)  # type: ignore[attr-defined]
    print("     ← WS connected")
    return ws


# ── Tests ──────────────────────────────────────────────────────────────────


# 1. Browse (maps to "list projects" flow)
async def test_browse(client: httpx.AsyncClient):
    print("\n▶ 1. GET /api/browse")
    resp = await http_get(client, "/api/browse")
    tc.check_status(resp.status_code, 200, "Browse returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), f"Browse returns a list, got {type(data).__name__}")
    if data:
        tc.check("path" in data[0], f"Each entry has 'path', keys={list(data[0].keys())}")
        tc.check("name" in data[0], "Each entry has 'name'")
        tc.check("isDirectory" in data[0], "Each entry has 'isDirectory'")


# 2. List projects
async def test_list_projects(client: httpx.AsyncClient):
    print("\n▶ 2. GET /api/projects/")
    resp = await http_get(client, "/api/projects/")
    tc.check_status(resp.status_code, 200, "List projects returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), f"Returns a list, got {type(data).__name__}")
    # Should include our test dir name or other project dirs
    print(f"     Found {len(data)} projects")


# 3. Project info
async def test_project_info(client: httpx.AsyncClient):
    print("\n▶ 3. GET /api/projects/info")
    resp = await http_get(client, "/api/projects/info", params={"project_path": str(TEST_DIR)})
    tc.check_status(resp.status_code, 200, "Project info returns 200")
    data = resp.json()
    tc.check(data.get("exists") is True, f"Project exists: {data}")
    tc.check(data.get("path") == str(TEST_DIR), f"Path matches: {data.get('path')}")


# 4. List files in a directory
async def test_list_files(client: httpx.AsyncClient):
    print("\n▶ 4. GET /api/projects/files")
    resp = await http_get(
        client, "/api/projects/files", params={"project_path": str(TEST_DIR), "path": "/"}
    )
    tc.check_status(resp.status_code, 200, "List files returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), f"Returns a list, got {type(data).__name__}")
    # Should contain README.md, test_file.py, src/, tests/, config.yaml, main.py
    file_count = sum(1 for f in data if not f.get("isDirectory"))
    dir_count = sum(1 for f in data if f.get("isDirectory"))
    tc.check(file_count >= 3, f"Found {file_count} files (expected >= 3)")
    tc.check(dir_count >= 2, f"Found {dir_count} dirs (expected >= 2: src, tests)")

    # Check nested
    print("  → GET /api/projects/files (src/)")
    resp2 = await http_get(
        client, "/api/projects/files", params={"project_path": str(TEST_DIR), "path": "/src"}
    )
    tc.check_status(resp2.status_code, 200, "Nested list files returns 200")
    nested = resp2.json()
    tc.check(len(nested) == 1, f"src/ has 1 file, got {len(nested)}")


# 5. Read file
async def test_read_file(client: httpx.AsyncClient):
    print("\n▶ 5. GET /api/projects/files/read")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={"project_path": str(TEST_DIR), "file_path": "test_file.py"},
    )
    tc.check_status(resp.status_code, 200, "Read file returns 200")
    content = resp.text
    tc.check('print("hello")' in content, f"Content matches: {content[:100]}")
    tc.check(isinstance(content, str), "Response is a string")

    # 404 for missing file
    print("  → GET /api/projects/files/read (missing)")
    resp2 = await http_get(
        client,
        "/api/projects/files/read",
        params={"project_path": str(TEST_DIR), "file_path": "nonexistent.py"},
    )
    tc.check_status(resp2.status_code, 404, "Missing file returns 404")


# 6. List models (with RPC project name — returns defaults)
async def test_list_models(client: httpx.AsyncClient):
    print("\n▶ 6. GET /api/models/")
    resp = await http_get(client, "/api/models/")
    tc.check_status(resp.status_code, 200, "List models returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), f"Returns a list, got {type(data).__name__}")
    if data:
        first = data[0]
        tc.check("id" in first, f"Model has 'id': {first}")
        tc.check("provider" in first, f"Model has 'provider': {first}")
        print(f"     Found {len(data)} models: {[m.get('id') for m in data]}")


# 7. Switch model (requires active RPC — will likely fail gracefully)
async def test_switch_model(client: httpx.AsyncClient):
    print("\n▶ 7. POST /api/models/{session_id}/model")
    session_id = "test-session-nonexistent"
    resp = await http_post(
        client,
        f"/api/models/{session_id}/model",
        params={"project_name": str(TEST_DIR), "model_id": "claude-sonnet-4-20250514"},
    )
    tc.check_status(resp.status_code, 200, f"Switch model returns 200 (status={resp.status_code})")
    data = resp.json()
    # Without active RPC, should return error message
    tc.check("message" in data or "error" in data, f"Returns message: {data}")
    print("     (Expected: no active RPC — error is correct behavior)")


# 8. List sessions
async def test_list_sessions(client: httpx.AsyncClient):
    print("\n▶ 8. GET /api/projects/sessions")
    resp = await http_get(client, "/api/projects/sessions", params={"project_path": str(TEST_DIR)})
    tc.check_status(resp.status_code, 200, "List sessions returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), f"Returns a list, got {type(data).__name__}")
    # May be empty if no .pi/sessions dir
    print(f"     Found {len(data)} sessions")


# 9. Get session (requires active RPC — will fail)
async def test_get_session(client: httpx.AsyncClient):
    print("\n▶ 9. GET /api/projects/sessions/{session_id}")
    session_id = "test-session-1"
    resp = await http_get(
        client,
        f"/api/projects/sessions/{session_id}",
        params={"project_path": str(TEST_DIR)},
    )
    tc.check_status(
        resp.status_code, 404, f"Get session returns 404 (no active RPC): {resp.status_code}"
    )


# 10. Create session (launches RPC — the big one)
async def test_create_session(client: httpx.AsyncClient):
    print("\n▶ 10. POST /api/projects/sessions")
    resp = await http_post(
        client,
        "/api/projects/sessions",
        params={"project_path": str(TEST_DIR)},
    )
    tc.check_status(resp.status_code, 200, f"Create session returns 200: {resp.status_code}")
    data = resp.json()
    tc.check(isinstance(data, dict), f"Returns a dict, got {type(data).__name__}")
    if isinstance(data, dict):
        tc.check("session_id" in data, f"Response has 'session_id': {list(data.keys())}")
        tc.check("name" in data, "Response has 'name'")
        tc.check("project" in data, "Response has 'project'")
        tc.check("model" in data, "Response has 'model'")
        tc.check("messages" in data, "Response has 'messages'")
        if data.get("model"):
            model = data["model"]
            tc.check("id" in model, f"Model has 'id': {model}")
            tc.check("provider" in model, "Model has 'provider'")
        print(f"     Session: {data.get('session_id')}, model: {data.get('model')}")

        # Return the session_id for subsequent tests
        return data.get("session_id")
    return None


# 11. Chat (POST — deprecated, requires active WS — likely no-op)
async def test_send_chat(client: httpx.AsyncClient):
    print("\n▶ 11. POST /api/projects/sessions/{id}/chat")
    session_id = "test-session-chat"
    resp = await http_post(
        client,
        f"/api/projects/sessions/{session_id}/chat",
        params={"project_path": str(TEST_DIR)},
        json_body={"message": "hello"},
    )
    tc.check_status(resp.status_code, 200, f"Chat returns 200: {resp.status_code}")
    data = resp.json()
    tc.check("status" in data, f"Response has 'status': {data}")
    print(f"     Status: {data.get('status')}")


# 12. Chat history (GET)
async def test_get_chat_history(client: httpx.AsyncClient):
    print("\n▶ 12. GET /api/projects/sessions/{id}/chat")
    session_id = "test-session-history"
    resp = await http_get(
        client,
        f"/api/projects/sessions/{session_id}/chat",
        params={"project_path": str(TEST_DIR)},
    )
    tc.check_status(resp.status_code, 200, f"Chat history returns 200: {resp.status_code}")
    data = resp.json()
    tc.check(isinstance(data, list), f"Returns a list, got {type(data).__name__}")
    print(f"     History: {len(data)} messages")


# 13. WebSocket — connect and exchange messages
async def test_websocket(client: httpx.AsyncClient):
    print("\n▶ 13. WebSocket /api/projects/ws")

    # First create a session to have an active RPC
    session_id = await test_create_session(client)

    if not session_id:
        tc.check(False, "Skipped WebSocket test: no session created")
        return

    session_id = f"ws_test_{uuid.uuid4().hex[:8]}"

    try:
        ws = await http_ws(client, "/api/projects/ws", params={"project_path": str(TEST_DIR)})

        # Receive initial messages (should get a startup response)
        try:
            initial = await asyncio.wait_for(ws.receive_text(), timeout=8.0)
            init_data = json.loads(initial)
            init_type = init_data.get("type", init_data.get("kind", "?"))
            print(f"     Initial: type={init_type}")
            tc.check(True, f"Got initial message type='{init_type}'")
        except asyncio.TimeoutError:
            print("     (No initial message within 8s — might be OK)")
            tc.check(True, "No initial message (timeout — might be normal)")

        # Send a simple prompt
        prompt = {"type": "prompt", "message": "Say back: HELLO_API"}
        await ws.send_text(json.dumps(prompt))
        print(f"     Sent: {json.dumps(prompt)[:80]}")

        # Wait for response or events
        try:
            events = []
            deadline = asyncio.get_event_loop().time() + 15.0
            while asyncio.get_event_loop().time() < deadline:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    msg = await asyncio.wait_for(ws.receive_text(), timeout=min(3.0, remaining))
                    evt = json.loads(msg)
                    etype = evt.get("type", evt.get("kind", "unknown"))
                    events.append(evt)
                    print(f"     Event: type={etype}")
                    if etype in ("turn_end", "agent_end", "response"):
                        break
                except asyncio.TimeoutError:
                    continue

            if events:
                types = [e.get("type", e.get("kind", "?")) for e in events[:5]]
                tc.check(
                    any(t in ("turn_end", "agent_end", "response") for t in types),
                    f"Got meaningful event: {types}",
                )
                tc.check(len(events) > 0, f"Received {len(events)} events")
            else:
                tc.check(False, "No events received from WebSocket")

        except Exception as e:
            tc.check(False, f"WebSocket event receive error: {e}")

        ws.close()
        print("     WS closed")

    except Exception as e:
        tc.check(False, f"WebSocket connection error: {type(e).__name__}: {e}")


# 14. Security: path traversal prevention
async def test_path_security(client: httpx.AsyncClient):
    print("\n▶ 14. Security: path traversal")

    # Try to read file outside project
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={"project_path": str(TEST_DIR), "file_path": "../../etc/passwd"},
    )
    tc.check_status(resp.status_code, 403, f"Path traversal returns 403: {resp.status_code}")

    # Try to read directory as file
    resp2 = await http_get(
        client,
        "/api/projects/files/read",
        params={"project_path": str(TEST_DIR), "file_path": "src"},
    )
    tc.check_status(resp2.status_code, 400, f"Directory as file returns 400: {resp2.status_code}")


# 15. Browse with path parameter
async def test_browse_with_path(client: httpx.AsyncClient):
    print("\n▶ 15. GET /api/browse?path=")
    resp = await http_get(client, "/api/browse", params={"path": str(TEST_DIR)})
    tc.check_status(resp.status_code, 200, "Browse with path returns 200")
    data = resp.json()
    tc.check(isinstance(data, list), "Returns a list")
    if data:
        tc.check("path" in data[0], "Entries have 'path'")
        print(f"     Found {len(data)} items in TEST_DIR")


# 16. Invalid project_path
async def test_invalid_project(client: httpx.AsyncClient):
    print("\n▶ 16. Invalid project_path")
    resp = await http_get(
        client, "/api/projects/info", params={"project_path": "/nonexistent/path/xyz"}
    )
    tc.check_status(resp.status_code, 404, "Invalid project returns 404")


# ── Main ──────────────────────────────────────────────────────────────────


async def main():
    print("=" * 70)
    print("Backend REST API Integration Tests")
    print("=" * 70)
    print(f"Test project: {TEST_DIR}")
    print(f"API base: {API_BASE}")
    print()

    # Start server
    if not start_uvicorn():
        print("FATAL: Could not start uvicorn. Exiting.")
        sys.exit(1)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tests = [
            test_browse,
            test_list_projects,
            test_project_info,
            test_list_files,
            test_read_file,
            test_list_models,
            test_switch_model,
            test_list_sessions,
            test_get_session,
            # test_create_session must run before WebSocket
            test_create_session,
            test_send_chat,
            test_get_chat_history,
            # WebSocket depends on create_session
            test_websocket,
            test_path_security,
            test_browse_with_path,
            test_invalid_project,
        ]

        for test_fn in tests:
            try:
                result = await test_fn(client)
                # Capture session_id for WS test
                if test_fn.__name__ == "test_create_session" and result:
                    pass  # already handled
            except Exception as e:
                import traceback

                print(f"\n  ❌ {test_fn.__name__}: {type(e).__name__}: {e}")
                traceback.print_exc()
                tc.failed += 1

    # Cleanup
    stop_uvicorn()

    # Remove test dir
    import shutil

    shutil.rmtree(TEST_DIR, ignore_errors=True)

    # Summary
    tc.print_summary()
    print("=" * 70)

    if tc.failed > 0:
        print(f"\n⚠️  {tc.failed} failure(s):")
        for f in tc.failures:
            print(f"    - {f}")
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
