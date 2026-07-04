"""File-related Pydantic models."""

from typing import Optional

from pydantic import BaseModel


class FileInfo(BaseModel):
    """File information returned by file listing endpoints."""

    name: str
    path: str
    isDirectory: bool
    size: Optional[int] = None
