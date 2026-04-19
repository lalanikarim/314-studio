"""Pytest fixtures for integration tests."""

from __future__ import annotations

import os
from pathlib import Path
from typing import AsyncGenerator

import httpx
import pytest

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


# ── Fixtures ─────────────────────────────────────────────────────────────────


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
async def async_client(timeout: float) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Provide an httpx.AsyncClient, auto-closed after test."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        yield client


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


def pytest_addoption(parser):
    """Add CLI options for selecting flows."""
    parser.addoption(
        "--flows",
        action="store",
        default=None,
        help="Run only specified flows (e.g. 'flow1 flow2')",
    )
