"""
Pydantic models for the API.

SessionRecord (the session data model) lives in session_manager.py and is the
source of truth — FastAPI serialises it natively as a Pydantic dataclass.
"""

from typing import Optional

from pydantic import BaseModel


class FileInfo(BaseModel):
    """File information returned by file listing endpoints."""

    name: str
    path: str
    isDirectory: bool
    size: Optional[int] = None


class ModelConfig(BaseModel):
    """Model configuration with optional metadata."""

    id: str
    provider: str
    contextWindow: Optional[int] = None
    maxTokens: Optional[int] = None


# ── Session Manager schemas ───────────────────────────────────────────────────


class SessionCreateRequest(BaseModel):
    """Request body for creating a new session."""

    name: Optional[str] = None


class SessionCloseResponse(BaseModel):
    """Response from session close or delete."""

    session_id: str
    compacted: bool
