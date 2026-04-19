"""Pytest fixtures for integration tests."""

from __future__ import annotations

import asyncio
import functools
import os
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
import pytest
import websockets  # type: ignore[import-untyped]

# ── Subfixture registry ──────────────────────────────────────────────────────
# Tests return values (session_id, ws, session1_id, etc.) and subsequent tests
# use them as fixtures. This is the "subfixture" pattern.
_subfixture_cache: dict[str, Any] = {}


# ── Test result tracker ─────────────────────────────────────────────────────


class TestResult:
    """Simple test result tracker used by integration flow tests."""

    def __init__(self) -> None:
        self.failed: int = 0
        self.skipped: int = 0
        self.failures: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.failed += 1
            self.failures.append(f"FAIL: {message}")


# ── Subfixture fixture providers ─────────────────────────────────────────────
# These fixtures provide the return values from earlier tests.


@pytest.fixture
def session_id() -> str | None:
    """Provide session_id from test_create_session return value."""
    return _subfixture_cache.get("test_create_session")


@pytest.fixture
async def ws(session_id: str | None, timeout: float) -> AsyncGenerator[Any, None]:
    """Create a fresh WS connection for each test using session_id from earlier tests.

    Uses a new connection per test to avoid event-loop mismatch issues
    (pytest-asyncio auto mode = one loop per test).
    """
    if not session_id:
        yield None
        return
    url = f"{WS_BASE}/api/projects/ws?session_id={session_id}"
    print(f"  → WS   {url}")
    ws_conn = await websockets.connect(url)
    try:
        yield ws_conn
    finally:
        try:
            await ws_conn.close()
        except Exception:
            pass


@pytest.fixture
def session1_id() -> str | None:
    """Provide session1_id from test_create_session1 return value."""
    return _subfixture_cache.get("test_create_session1")


@pytest.fixture
def session2_id() -> str | None:
    """Provide session2_id from test_create_session2 return value."""
    return _subfixture_cache.get("test_create_session2")


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def result() -> TestResult:
    """Provide a TestResult object for tracking check/assertions."""
    return TestResult()


# ── Config (env-overridable) ─────────────────────────────────────────────────

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765")
WS_BASE = os.environ.get("WS_BASE", "ws://127.0.0.1:8765")
TESTS_DIR = Path(
    os.environ.get("TESTS_DIR", str(Path.home() / "Projects" / "web-pi-integration-tests"))
)
TIMEOUT = float(os.environ.get("TEST_TIMEOUT", "30.0"))
WS_TIMEOUT = float(os.environ.get("WS_TIMEOUT", "10.0"))
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")
TEST_MODEL2_ID = os.environ.get("TEST_MODEL2_ID", "")


@pytest.fixture
def api_base() -> str:
    return API_BASE


@pytest.fixture
def ws_base() -> str:
    return WS_BASE


@pytest.fixture
def tests_dir() -> Path:
    return TESTS_DIR


@pytest.fixture
def timeout() -> float:
    return TIMEOUT


@pytest.fixture
def test_model_id() -> str:
    return TEST_MODEL_ID


@pytest.fixture
def test_model2_id() -> str:
    return TEST_MODEL2_ID


@pytest.fixture
async def client(timeout: float) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Provide an httpx.AsyncClient (alias: client), auto-closed after test."""
    async with httpx.AsyncClient(timeout=timeout) as c:
        yield c


@pytest.fixture
async def async_client(timeout: float) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Provide an httpx.AsyncClient, auto-closed after test."""
    async with httpx.AsyncClient(timeout=timeout) as c:
        yield c


# ── Pytest hooks ─────────────────────────────────────────────────────────────


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line("markers", "flow1: Flow 1 — Browse & Chat")
    config.addinivalue_line("markers", "flow2: Flow 2 — File Browse")
    config.addinivalue_line("markers", "flow3: Flow 3 — Multi Session")
    config.addinivalue_line("markers", "flow4: Flow 4 — Model Switch")
    config.addinivalue_line("markers", "flow5: Flow 5 — Close/Delete")
    config.addinivalue_line("markers", "flow6: Flow 6 — Error Handling")
    config.addinivalue_line("markers", "flow7: Flow 7 — Shutdown Cleanup")
    config.addinivalue_line("markers", "flow8: Flow 8 — Model Operations")


def pytest_addoption(parser):
    """Add CLI options for selecting flows."""
    parser.addoption(
        "--flows",
        action="store",
        default=None,
        help="Run only specified flows (e.g. 'flow1 flow2')",
    )


def pytest_collection_modifyitems(config, items):
    """Wrap async test functions to capture their return values as subfixtures."""
    for item in items:
        if hasattr(item, "obj") and asyncio.iscoroutinefunction(item.obj):
            item.obj = _wrap_test_for_subfixtures(item.obj)


def _wrap_test_for_subfixtures(test_func):
    """Wrap an async test function to capture its return value.

    The return value is stored in _subfixture_cache keyed by function name
    so that subsequent tests can access it via fixtures.
    """

    @functools.wraps(test_func)
    async def wrapper(*args, **kwargs):
        result = await test_func(*args, **kwargs)
        if result is not None:
            _subfixture_cache[test_func.__name__] = result
        return result

    return wrapper
