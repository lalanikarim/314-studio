"""
Test simple file API.
"""

from fastapi import APIRouter, HTTPException
from pathlib import Path
import aiofiles

router = APIRouter()


@router.get("/test-file")
async def test_file_read(file_path: str = "test.txt") -> str:
    """
    Simple test endpoint for file reading.
    """
    target_path = Path(file_path)

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    async with aiofiles.open(target_path, "r") as f:
        content = await f.read()

    return content
