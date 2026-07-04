"""Model-related Pydantic models."""

from typing import Optional

from pydantic import BaseModel


class ModelConfig(BaseModel):
    """Model configuration with optional metadata."""

    id: str
    provider: str
    contextWindow: Optional[int] = None
    maxTokens: Optional[int] = None
