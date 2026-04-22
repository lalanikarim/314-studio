"""Configuration constants — environment variables and defaults."""

from __future__ import annotations

import os

# Server endpoints
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")
WS_BASE = os.environ.get("WS_BASE", "ws://127.0.0.1:8000")

# Project & model
PROJECT_NAME = os.environ.get("PROJECT_NAME", "agent-spy")
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")

# Timing — matches frontend useModels values
HTTP_TIMEOUT = 60.0
POLL_INTERVAL = 1.5  # same as useModels POLL_INTERVAL_MS
MAX_POLL_TIME = 30.0  # same as useModels PI_INIT_TIMEOUT_MS
WS_RECV_TIMEOUT = 30.0  # seconds between WS messages before timeout
RELAY_WINDOW = 60.0  # seconds to relay inbound messages after prompt
