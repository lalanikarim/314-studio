#!/usr/bin/env python3
"""
Flow 6: Error Handling

Covers: T6.1–T6.6
Tests invalid inputs, path traversal, missing resources, and graceful error responses.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

from test_utils import (
    API_BASE,
    TESTS_DIR,
    TIMEOUT,
    http_get,
    http_post_json,
    ws_connect,
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_create_session_nonexistent_project(client, result):
    """T6.1 — Create session on non-existent project returns 404."""
    print("\n  T6.1 Create session on non-existent project")
    # Use actual absolute path (expanduser) so _resolve_project_path doesn't find it
    nonexistent = str(Path.home() / "Projects" / "does-not-exist")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"model_id": TEST_MODEL_ID, "name": "BadProject"},
        params={"project_path": nonexistent},
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for non-existent project, got {resp.status_code}",
    )


async def test_create_session_empty_project_path(client, result):
    """T6.1b — Create session with missing project_path returns 400."""
    print("\n  T6.1b Create session with missing project_path")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"model_id": TEST_MODEL_ID, "name": "MissingPath"},
    )
    result.check(
        resp.status_code == 422 or resp.status_code == 400,
        f"Returns 422/400 for missing project_path, got {resp.status_code}",
    )


async def test_close_nonexistent_session(client, result):
    """T6.2 — Close non-existent session returns 404."""
    print("\n  T6.2 Close non-existent session")
    resp = await http_post_json(
        client,
        "/api/projects/fake-session-id-that-does-not-exist/close",
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for close non-existent session, got {resp.status_code}",
    )


async def test_delete_nonexistent_session(client, result):
    """T6.2b — Delete non-existent session returns 404."""
    print("\n  T6.2b Delete non-existent session")
    resp = await http_post_json(
        client,
        "/api/projects/fake-session-id-that-does-not-exist/delete",
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for delete non-existent session, got {resp.status_code}",
    )


async def test_switch_model_nonexistent_session(client, result):
    """T6.2c — Switch model on non-existent session returns 404."""
    print("\n  T6.2c Switch model on non-existent session")
    resp = await http_post_json(
        client,
        "/api/projects/fake-session-id-that-does-not-exist/model",
        params={"model_id": TEST_MODEL_ID, "provider": "vllm"},
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for model switch on non-existent session, got {resp.status_code}",
    )


async def test_ws_connect_nonexistent_session(client, result):
    """T6.3 — WS connect to non-existent session is rejected (close code 4002)."""
    print("\n  T6.3 WS connect to non-existent session")
    try:
        # Use websockets library — it will raise an exception if the connection is rejected
        import asyncio

        ws = await ws_connect("fake-session-id-that-does-not-exist")
        try:
            # Try to receive — if the server closes immediately, we get a close exception
            raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
            # If we got a message before close, the server accepted unexpectedly
            result.check(
                False, f"Should have been closed with error code, got message: {raw[:100]}"
            )
        except Exception as exc:
            # Connection error or close is expected
            exc_str = str(exc).lower()
            # Accept close error, connection reset, or similar
            is_close = any(
                kw in exc_str for kw in ("close", "error", "disconnect", "closed", "exception")
            )
            if is_close:
                result.check(True, f"Connection rejected: {type(exc).__name__}")
            else:
                result.check(False, f"Unexpected error type: {type(exc).__name__}: {exc}")
        finally:
            try:
                await ws.close()
            except Exception:
                pass
    except Exception as exc:
        # websockets.connect itself might fail if the connection is immediately rejected
        exc_str = str(exc).lower()
        is_rejected = any(kw in exc_str for kw in ("close", "error", "reject", "exception", "http"))
        if is_rejected:
            result.check(True, f"WS connection rejected: {type(exc).__name__}")
        else:
            result.check(False, f"Unexpected error: {type(exc).__name__}: {exc}")


async def test_project_info_nonexistent_project(client, result):
    """T6.3b — Project info for non-existent project returns 404."""
    print("\n  T6.3b Project info for non-existent project")
    resp = await http_get(
        client,
        "/api/projects/info",
        params={"project_path": str(Path.home() / "Projects" / "does-not-exist")},
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for non-existent project info, got {resp.status_code}",
    )


async def test_path_traversal_files_list(client, result):
    """T6.4a — Path traversal in files list returns 403."""
    print("\n  T6.4a Path traversal in files list")
    resp = await http_get(
        client,
        "/api/projects/files",
        params={
            "project_path": str(TESTS_DIR),
            "path": "../../../etc",
        },
    )
    result.check(
        resp.status_code == 403,
        f"Returns 403 for traversal in files list, got {resp.status_code}",
    )

    # Also try ../etc/passwd as path
    resp2 = await http_get(
        client,
        "/api/projects/files",
        params={
            "project_path": str(TESTS_DIR),
            "path": "../etc/passwd",
        },
    )
    result.check(
        resp2.status_code == 403,
        f"Returns 403 for ../etc/passwd in files list, got {resp2.status_code}",
    )


async def test_path_traversal_files_read(client, result):
    """T6.4b — Path traversal in files/read returns 403."""
    print("\n  T6.4b Path traversal in files/read")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "../../etc/passwd",
        },
    )
    result.check(
        resp.status_code == 403,
        f"Returns 403 for traversal in files/read, got {resp.status_code}",
    )

    # Try absolute path traversal
    resp2 = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "../../../etc/passwd",
        },
    )
    result.check(
        resp2.status_code == 403,
        f"Returns 403 for ../../../etc/passwd in files/read, got {resp2.status_code}",
    )


async def test_read_nonexistent_file(client, result):
    """T6.5a — Read non-existent file returns 404."""
    print("\n  T6.5a Read non-existent file")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "this-file-definitely-does-not-exist.py",
        },
    )
    result.check(
        resp.status_code == 404,
        f"Returns 404 for non-existent file, got {resp.status_code}",
    )


async def test_duplicate_session_names(client, result):
    """T6.5b — Duplicate session names are allowed (names not unique)."""
    print("\n  T6.5b Duplicate session names")
    session_id1 = None
    session_id2 = None

    try:
        resp1 = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "DupTest"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp1.status_code != 200:
            result.check(False, f"First duplicate returned {resp1.status_code}")
            return
        data1 = resp1.json()
        session_id1 = data1.get("session_id")
        result.check(data1.get("status") == "running", "First session created and running")
        result.check(data1.get("name") == "DupTest", "First session name is 'DupTest'")

        resp2 = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "DupTest"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp2.status_code != 200:
            result.check(False, f"Second duplicate returned {resp2.status_code}")
            return
        data2 = resp2.json()
        session_id2 = data2.get("session_id")
        result.check(data2.get("status") == "running", "Second session created and running")

        # Both should have unique session IDs
        result.check(
            session_id1 != session_id2,
            "Both created with unique session_ids despite same name",
        )

        # Verify both appear in project info
        resp3 = await http_get(
            client,
            "/api/projects/info",
            params={"project_path": str(TESTS_DIR)},
        )
        if resp3.status_code == 200:
            info = resp3.json()
            dup_sessions = [
                s
                for s in info.get("sessions", [])
                if isinstance(s, dict) and s.get("name") == "DupTest"
            ]
            result.check(
                len(dup_sessions) >= 2,
                f"Found {len(dup_sessions)} sessions with name 'DupTest'",
            )
    finally:
        # Cleanup
        if session_id1:
            await client.post(f"{API_BASE}/api/projects/{session_id1}/close")
        if session_id2:
            await client.post(f"{API_BASE}/api/projects/{session_id2}/close")


async def test_browse_nonexistent_path(client, result):
    """T6.5c — Browse non-existent directory returns 200 with empty list (graceful)."""
    print("\n  T6.5c Browse non-existent directory")
    resp = await http_get(
        client,
        "/api/browse",
        params={"path": "/nonexistent/path/that/does/not/exist"},
    )
    result.check(
        resp.status_code == 200,
        f"Returns 200 (graceful) for non-existent browse path, got {resp.status_code}",
    )
    data = resp.json()
    result.check(
        data == [],
        f"Non-existent path returns empty list, got {data}",
    )


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        await test_create_session_nonexistent_project(client, result)
        await test_create_session_empty_project_path(client, result)
        await test_close_nonexistent_session(client, result)
        await test_delete_nonexistent_session(client, result)
        await test_switch_model_nonexistent_session(client, result)
        await test_ws_connect_nonexistent_session(client, result)
        await test_project_info_nonexistent_project(client, result)
        await test_path_traversal_files_list(client, result)
        await test_path_traversal_files_read(client, result)
        await test_read_nonexistent_file(client, result)
        await test_duplicate_session_names(client, result)
        await test_browse_nonexistent_path(client, result)
