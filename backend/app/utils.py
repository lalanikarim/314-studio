"""Shared utility functions for the backend API."""

import re
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, Request

# Default root for project-scoped paths
PROJECTS_ROOT = Path.home() / "Projects"


def resolve_project_path(project_path: str) -> Path:
    """Resolve a project path string to an absolute `Path`.

    Handles absolute paths, paths starting with ``~``, and bare project names
    (looked up under ``~/Projects``).

    Raises:
        HTTPException: If the path is missing or doesn't resolve to an
            existing location.
    """
    if not project_path:
        raise HTTPException(
            status_code=400,
            detail="Missing required query parameter: project_path",
        )

    resolved = Path(project_path).expanduser()

    # If it's not absolute and doesn't exist, try ~/Projects/{name}
    if not resolved.is_absolute() and not resolved.exists():
        candidate = PROJECTS_ROOT / project_path
        if candidate.exists():
            resolved = candidate

    return resolved


# Matches: sess_ followed by exactly 12 hex characters
SESSION_ID_PATTERN = re.compile(r"^sess_[0-9a-f]{12}$")


def validate_session_id(session_id: str) -> str:
    """Validate a session ID format and return it, or raise 400.

    Valid format: ``sess_`` followed by exactly 12 lowercase hex characters.
    """
    if not SESSION_ID_PATTERN.match(session_id):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid session_id format: {session_id!r}. "
            "Expected format: sess_ followed by 12 hex characters.",
        )
    return session_id


class RateLimiter:
    """Simple in-memory sliding-window rate limiter.

    Tracks request counts per key within a time window. When the limit is
    exceeded, raises ``HTTPException(429)``.
    """

    def __init__(self, max_requests: int = 60, window_seconds: float = 60.0):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _clean(self, key: str) -> None:
        cutoff = time.monotonic() - self.window_seconds
        timestamps = self._requests[key]
        self._requests[key] = [t for t in timestamps if t > cutoff]

    def check(self, key: str) -> None:
        self._clean(key)
        timestamps = self._requests[key]
        if len(timestamps) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Max {self.max_requests} requests "
                f"per {self.window_seconds:.0f}s.",
            )
        timestamps.append(time.monotonic())


# Default rate limiter: 60 requests per 60 seconds per IP
_default_limiter = RateLimiter(max_requests=60, window_seconds=60.0)


def get_remote_key(request: Request) -> str:
    """Extract a rate-limit key from the request (client IP)."""
    return request.client.host if request.client else "unknown"
