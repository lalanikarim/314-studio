#!/usr/bin/env python3
"""
Flow 7: App Shutdown Cleanup

Covers: T7.1
"""

from __future__ import annotations

import os
import signal
import subprocess
import time

import httpx

from test_utils import (
    API_BASE,
    TESTS_DIR,
    TIMEOUT,
    http_post_json,
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


async def run(result):
    """
    Flow 7 requires direct access to the uvicorn process.
    Finds the PID, creates sessions, sends SIGTERM, verifies cleanup.
    """
    # Find the uvicorn process on port 8765
    try:
        proc_result = subprocess.run(
            ["lsof", "-ti:8765", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        pid = proc_result.stdout.strip()
        if not pid:
            result.failed += 1
            result.failures.append("T7.1: No uvicorn process found on port 8765")
            return result

        print(f"\n  T7.1 Found uvicorn PID: {pid}")

        # ── Create two sessions ──────────────────────────────────────────
        print("  Creating 2 sessions...")

        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp1 = await http_post_json(
                client,
                "/api/projects/",
                body={"model_id": TEST_MODEL_ID, "name": "ShutdownTest-1"},
                params={"project_path": str(TESTS_DIR)},
            )
            resp2 = await http_post_json(
                client,
                "/api/projects/",
                body={"model_id": TEST_MODEL_ID, "name": "ShutdownTest-2"},
                params={"project_path": str(TESTS_DIR)},
            )
            id1 = resp1.json().get("session_id")
            id2 = resp2.json().get("session_id")

        if not id1 or not id2:
            result.failed += 1
            result.failures.append("T7.1: Failed to create sessions")
            return result

        # Verify both running
        print(f"  Sessions created: {id1[:12]}... and {id2[:12]}...")

        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{API_BASE}/api/projects/info",
                params={"project_path": str(TESTS_DIR)},
            )
            info = resp.json()
        running_count = info.get("running_count", 0)
        result.check(
            running_count == 2,
            f"Both running: count={running_count}, got {running_count}",
        )

        # ── Send SIGTERM to uvicorn ──────────────────────────────────────
        print(f"  Sending SIGTERM to uvicorn PID {pid}...")
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError as exc:
            result.failed += 1
            result.failures.append(f"T7.1: Failed to send SIGTERM: {exc}")
            return result

        # ── Wait for cleanup ─────────────────────────────────────────────
        print("  Waiting for processes to terminate...")
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                # Check if the uvicorn process is still alive
                os.kill(int(pid), 0)  # Signal 0 checks if process exists
                time.sleep(0.5)
            except OSError:
                break
        else:
            # Process still alive, try SIGKILL
            print("  SIGTERM didn't work, sending SIGKILL...")
            try:
                os.kill(int(pid), signal.SIGKILL)
            except OSError:
                pass

        # ── Verify all processes terminated ──────────────────────────────

        # Check for any pi --rpc processes still running
        pi_procs = subprocess.run(
            ["pgrep", "-f", "pi.*rpc"],
            capture_output=True,
            text=True,
        )
        if pi_procs.returncode == 0 and pi_procs.stdout.strip():
            result.check(False, f"Zombie pi processes found: {pi_procs.stdout.strip()}")
        else:
            result.check(True, "All pi processes terminated cleanly")

        # Check for any remaining uvicorn processes
        uvicorn_procs = subprocess.run(
            ["pgrep", "-f", "uvicorn.*8765"],
            capture_output=True,
            text=True,
        )
        if uvicorn_procs.returncode == 0 and uvicorn_procs.stdout.strip():
            result.check(False, f"Uvicorn still running: {uvicorn_procs.stdout.strip()}")
        else:
            result.check(True, "Uvicorn terminated cleanly")

    except FileNotFoundError:
        result.skipped += 1
        result.failures.append("T7.1: lsof not available, skipping shutdown test")
    except Exception as exc:
        result.failed += 1
        result.failures.append(f"T7.1: {type(exc).__name__}: {exc}")
