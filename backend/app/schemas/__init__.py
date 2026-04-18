"""
Pydantic models for the API.
"""

from typing import List, Optional

from pydantic import BaseModel


class Message(BaseModel):
    """
    Message in a conversation.
    """

    role: str  # "user" or "assistant"
    content: str


class ModelConfig(BaseModel):
    """
    Model configuration.
    """

    id: str
    provider: str
    contextWindow: Optional[int] = None
    maxTokens: Optional[int] = None


class SessionBase(BaseModel):
    """
    Base session model.
    """

    session_id: str
    name: str
    project: str


class SessionListItem(SessionBase):
    """
    Session item for listing (lighter than full session).
    """

    pass


class SessionCreate(BaseModel):
    """
    Session creation model.
    """

    name: str
    model: ModelConfig


class Session(SessionBase):
    """
    Full session model with messages.
    """

    messages: List[Message]
    model: ModelConfig
    thinking: str  # "none", "low", "medium", "high"


class FileInfo(BaseModel):
    """
    File information.
    """

    path: str
    isDirectory: bool
    size: Optional[int] = None
    sha256: Optional[str] = None


class ChatMessage(BaseModel):
    """
    Chat message model.
    """

    message: str
    streamingBehavior: Optional[str] = None  # "prompt" or None


class ModelSwitch(BaseModel):
    """
    Model switch request.
    """

    modelId: str


# ── Session Manager schemas ───────────────────────────────────────────────────
# SessionRecord is defined in session_manager.py as a dataclass (source of truth).
# FastAPI handles dataclasses natively as response_model.


class SessionCreateRequest(BaseModel):
    """Request body for creating a new session."""

    model_id: str
    name: Optional[str] = None


class SessionCloseResponse(BaseModel):
    """Response from session close or delete."""

    session_id: str
    compacted: bool
