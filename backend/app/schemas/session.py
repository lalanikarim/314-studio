"""Session-related Pydantic models."""

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class SessionRecord(BaseModel):
    """State for one pi --rpc session."""

    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    session_id: str
    project_path: str
    name: str
    model_id: Optional[str] = None
    status: str = "creating"  # creating | running | closing | stopped
    pid: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    sse_connected: bool = False
    sse_cancelled: bool = False

    # Runtime-only fields — excluded from JSON serialization
    process: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdin: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdout: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdout_task: Optional[asyncio.Task] = Field(default=None, exclude=True)  # noqa: ANN401
    pending_requests: dict[str, asyncio.Future] = Field(default_factory=dict, exclude=True)  # noqa: ANN401
    event_buffer: asyncio.Queue = Field(default_factory=asyncio.Queue, exclude=True)  # noqa: ANN401


class SessionCreateRequest(BaseModel):
    """Request body for creating a new session."""

    name: Optional[str] = None


class SessionCloseResponse(BaseModel):
    """Response from session close or delete."""

    session_id: str
    compacted: bool
