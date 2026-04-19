#!/usr/bin/env python3
"""
Flow 6: Error Handling

Covers: T6.1–T6.5
"""

from __future__ import annotations

import os

import httpx

# Ensure test_utils is importable (same directory)

from test_utils import (
    API_BASE,
    TESTS_DIR,
    TIMEOUT,
    http_get,
    http_post_json,
    ws_connect,
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # ── T6.1: Create session on non-existent project ─────────────────
        print("\n  T6.1 Create session on non-existent project")
        resp = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "BadProject"},
            params={"project_path": "$HOME/Projects/does-not-exist"},
        )
        result.check(resp.status_code == 404, f"Returns 404, got {resp.status_code}")

        # ── T6.2: Close non-existent session ─────────────────────────────
        print("\n  T6.2 Close non-existent session")
        resp = await http_post_json(
            client,
            "/api/projects/fake-session-id/close",
        )
        result.check(resp.status_code == 404, f"Returns 404, got {resp.status_code}")

        # ── T6.3: WS connect to non-existent session ─────────────────────
        print("\n  T6.3 WS connect to non-existent session")
        try:
            ws = await ws_connect("fake-session-id")
            # If connection succeeds, try to receive — should fail
            try:
                import asyncio

                raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                # If we got a message, check if it's an error close
                print(f"     Got message (unexpected): {raw[:100]}")
                result.check(False, "Should have been closed with error code")
            except Exception as exc:
                # Connection error or close is expected
                print(f"     Connection error/close: {type(exc).__name__}")
                result.check(True, "Connection rejected or closed with error")
            finally:
                try:
                    await ws.close()
                except Exception:
                    pass
        except Exception as exc:
            print(f"     Connection failed: {type(exc).__name__}")
            result.check(True, "WS rejected connection to non-existent session")

        # ── T6.4: Read file outside project root ─────────────────────────
        print("\n  T6.4 Read file outside project root")
        resp = await http_get(
            client,
            "/api/projects/files/read",
            params={
                "project_path": str(TESTS_DIR),
                "file_path": "../../etc/passwd",
            },
        )
        result.check(resp.status_code == 403, f"Returns 403, got {resp.status_code}")

        # ── T6.5: Duplicate session name ─────────────────────────────────
        print("\n  T6.5 Duplicate session names")
        resp1 = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "DupTest"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp1.status_code == 200:
            id1 = resp1.json().get("session_id")
            resp2 = await http_post_json(
                client,
                "/api/projects/",
                body={"model_id": TEST_MODEL_ID, "name": "DupTest"},
                params={"project_path": str(TESTS_DIR)},
            )
            if resp2.status_code == 200:
                id2 = resp2.json().get("session_id")
                result.check(
                    id1 != id2,
                    "Both created with unique IDs despite same name",
                )
                # Cleanup
                await client.post(f"{API_BASE}/api/projects/{id1}/close")
                await client.post(f"{API_BASE}/api/projects/{id2}/close")
            else:
                result.check(False, f"Second duplicate returned {resp2.status_code}")
        else:
            result.check(False, f"First duplicate returned {resp1.status_code}")
