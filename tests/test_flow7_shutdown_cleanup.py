#!/usr/bin/env python3
"""
Flow 7: App Shutdown Cleanup

Covers: T7.1
Tests that the backend properly terminates all child pi --rpc processes
when the uvicorn process receives SIGTERM.

Note: This test kills the backend server. It must be run as an isolated
test or as the last flow in the suite.

Environment variables:
    TEST_MODEL_ID          — primary model (default: Qwen/Qwen3.6-35B-A3B)
    TESTS_PORT             — uvicorn port (default: extracted from API_BASE)
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import time

import httpx

from test_utils import (
    API_BASE,
    TESTS_DIR,
    TIMEOUT,
    http_get,
    http_post_json,
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


# ── Helpers ──────────────────────────────────────────────────────────────────


def _is_pid_alive(pid: int) -> bool:
    """Check if a process with the given PID is still alive."""
    try:
        os.kill(pid, 0)  # Signal 0 checks existence without sending a signal
        return True
    except OSError:
        return False


def _extract_port(api_base: str) -> int:
    """Extract port number from API_BASE URL."""
    # Handle http://127.0.0.1:8765 or http://localhost:8765 etc.
    match = re.search(r":(\d+)", api_base)
    if match:
        return int(match.group(1))
    # Default to 8765 if no port specified
    return 8765


def _find_process_by_port(port: int) -> str | None:
    """Find PID of process listening on given port.

    Tries lsof (macOS/BSD) first, then falls back to ss/fuser (Linux).
    Returns PID string or None if not found.
    """
    # Try lsof (macOS/BSD)
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Try ss (Linux)
    try:
        result = subprocess.run(
            ["ss", "-tlnp"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            # Look for the port and extract PID
            for line in result.stdout.splitlines():
                if f":{port}" in line:
                    # PID format: users:(("uvicorn",pid=1234,fd=5))
                    pid_match = re.search(r"pid=(\d+)", line)
                    if pid_match:
                        return pid_match.group(1)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Try fuser (Linux)
    try:
        result = subprocess.run(
            ["fuser", f"{port}/tcp"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split()[0]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return None


def _find_zombie_processes(process_pattern: str) -> str:
    """Find processes matching a pattern. Returns stdout or empty string."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", process_pattern],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_find_uvicorn_process(client, result):
    """T7.1a — Find the uvicorn process by port."""
    print("\n  T7.1a Find uvicorn process")

    port = _extract_port(API_BASE)
    print(f"     Looking for process on port {port}...")

    pid = _find_process_by_port(port)
    if not pid:
        result.failed += 1
        result.failures.append(
            f"T7.1a: No uvicorn process found on port {port} (tried lsof, ss, fuser)"
        )
        return

    pid_int = int(pid)
    print(f"     Found uvicorn PID: {pid}")
    result.check(_is_pid_alive(pid_int), f"PID {pid_int} is alive")
    result.check(pid_int > 0, f"PID is positive: {pid_int}")

    return pid_int


async def test_create_sessions_before_shutdown(client, result, uvicorn_pid=None):
    """T7.1b — Create 2 sessions and verify both are running.

    Requires uvicorn_pid from T7.1a.
    """
    print("\n  T7.1b Create 2 sessions before shutdown")

    if uvicorn_pid is None:
        result.failed += 1
        result.failures.append("T7.1b: Skipped — no uvicorn_pid from T7.1a")
        return

    # Create first session
    resp1 = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "ShutdownTest-1"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp1.status_code != 200:
        result.failed += 1
        result.failures.append("T7.1b: Create session 1 returned non-200")
        return

    # Create second session
    resp2 = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "ShutdownTest-2"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp2.status_code != 200:
        result.failed += 1
        result.failures.append("T7.1b: Create session 2 returned non-200")
        return

    data1 = resp1.json()
    data2 = resp2.json()

    sid1 = data1.get("session_id")
    sid2 = data2.get("session_id")
    pid1 = data1.get("pid")
    pid2 = data2.get("pid")

    result.check(sid1 != sid2, "Both sessions have unique IDs")
    result.check(pid1 is not None and pid1 > 0, f"Session 1 PID is positive: {pid1}")
    result.check(pid2 is not None and pid2 > 0, f"Session 2 PID is positive: {pid2}")
    result.check(_is_pid_alive(pid1), f"Session 1 process {pid1} is alive")
    result.check(_is_pid_alive(pid2), f"Session 2 process {pid2} is alive")

    # Verify both appear in project info
    resp = await http_get(
        client,
        "/api/projects/info",
        params={"project_path": str(TESTS_DIR)},
    )
    info = resp.json()
    running = info.get("running_count", 0)
    result.check(running == 2, f"running_count == 2, got {running}")

    return {
        "session_ids": [sid1, sid2],
        "pids": [pid1, pid2],
    }


async def test_shutdown_and_cleanup(client, result, session_data=None):
    """T7.1c — Send SIGTERM to uvicorn and verify all child processes terminate.

    This is the main shutdown test. It:
    1. Sends SIGTERM to the uvicorn process
    2. Waits for it to terminate (up to 5s, then SIGKILL)
    3. Verifies all pi --rpc child processes are also terminated
    4. Verifies no zombie processes remain
    """
    print("\n  T7.1c Shutdown uvicorn and verify cleanup")

    if session_data is None:
        result.failed += 1
        result.failures.append("T7.1c: Skipped — no session_data from T7.1b")
        return

    port = _extract_port(API_BASE)
    pid_str = _find_process_by_port(port)

    if not pid_str:
        result.check(True, "Uvicorn already terminated (server may have crashed)")
        # If server is already down, we can't do much more verification
        # Check that pi processes are gone
        pi_procs = _find_zombie_processes("pi.*rpc")
        if pi_procs:
            result.check(False, f"Zombie pi processes found: {pi_procs}")
        else:
            result.check(True, "No pi processes running")
        return

    uvicorn_pid = int(pid_str)
    print(f"     Sending SIGTERM to uvicorn PID {uvicorn_pid}...")

    # Send SIGTERM
    try:
        os.kill(uvicorn_pid, signal.SIGTERM)
    except OSError as exc:
        result.failed += 1
        result.failures.append(f"T7.1c: Failed to send SIGTERM: {exc}")
        return

    # Wait for uvicorn to terminate
    print("     Waiting for uvicorn to terminate...")
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            os.kill(uvicorn_pid, 0)  # Check if alive
            time.sleep(0.5)
        except OSError:
            break
    else:
        # Process still alive after 10s, send SIGKILL
        print("     SIGTERM didn't work, sending SIGKILL...")
        try:
            os.kill(uvicorn_pid, signal.SIGKILL)
        except OSError:
            pass

    # Give processes a moment to fully clean up
    time.sleep(1)

    # Verify no zombie pi --rpc processes
    pi_procs = _find_zombie_processes("pi.*rpc")
    if pi_procs:
        result.check(False, f"Zombie pi processes found: {pi_procs}")
    else:
        result.check(True, "All pi --rpc processes terminated cleanly")

    # Verify no remaining uvicorn processes on the port
    uvicorn_procs = _find_zombie_processes(f"uvicorn.*{port}")
    if uvicorn_procs:
        result.check(False, f"Uvicorn still running: {uvicorn_procs}")
    else:
        result.check(True, "Uvicorn terminated cleanly")

    # Verify session processes (child PIDs) are also gone
    for i, pid in enumerate(session_data["pids"], 1):
        if pid and _is_pid_alive(pid):
            result.check(False, f"Session {i} process {pid} still alive")
        else:
            result.check(True, f"Session {i} process {pid} terminated")


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    """Run the shutdown cleanup flow.

    Note: This test kills the backend server. It must be the last flow
    to run in the test suite.
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # T7.1a: Find uvicorn process
        uvicorn_pid = await test_find_uvicorn_process(client, result)
        if uvicorn_pid is None:
            result.failed += 2
            result.failures.append("T7.1b–T7.1c: Skipped due to T7.1a failure")
            return

        # T7.1b: Create 2 sessions
        session_data = await test_create_sessions_before_shutdown(client, result, uvicorn_pid)
        if session_data is None:
            result.failed += 1
            result.failures.append("T7.1c: Skipped due to T7.1b failure")
            return

        # T7.1c: Shutdown and verify cleanup
        await test_shutdown_and_cleanup(client, result, session_data)
