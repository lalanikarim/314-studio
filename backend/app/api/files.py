"""
File API endpoints for browsing and reading project files.

All endpoints take `project_path` as a query parameter (absolute path
to the project directory), matching the pattern in browse.py and project.py.
"""

from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, HTTPException, Query

from ..schemas import FileInfo
from ..utils import resolve_project_path

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /files — list files in a directory
# ---------------------------------------------------------------------------


@router.get("/files", response_model=list[FileInfo])
async def list_files(
    project_path: str = Query(..., description="Absolute path to the project directory"),
    path: Optional[str] = Query("/", description="Sub-directory path within the project"),
    limit: int = Query(500, ge=1, le=5000, description="Max files to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> list[FileInfo]:
    """
    List files in a directory with optional pagination.
    """
    base = resolve_project_path(project_path)

    if not base.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {base}")

    # Resolve the path relative to project root
    if path and path != "/":
        target_path = base / path.lstrip("/")
    else:
        target_path = base

    # Security check: ensure path is within project root
    if not target_path.resolve().is_relative_to(base.resolve()):
        raise HTTPException(status_code=403, detail="Access denied: Path outside project root")

    # Only directories can be listed
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # List files
    files = []
    count = 0
    for entry in target_path.iterdir():
        if entry.name.startswith(".") or entry.name.startswith("_"):
            continue

        rel = str(entry.relative_to(target_path))
        file_info: dict = {
            "name": rel,
            "path": rel,
            "isDirectory": entry.is_dir(),
        }

        if not entry.is_dir():
            try:
                file_info["size"] = entry.stat().st_size
            except OSError:
                pass

        if count >= offset:
            if len(files) < limit:
                files.append(file_info)
        count += 1

    return files


# ---------------------------------------------------------------------------
# GET /files/read — read file contents
# ---------------------------------------------------------------------------


@router.get("/files/read")
async def read_file(
    project_path: str = Query(..., description="Absolute path to the project directory"),
    file_path: str = Query(..., description="Relative path of the file within the project"),
) -> str:
    """
    Read file contents.
    """
    base = resolve_project_path(project_path)

    if not base.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {base}")

    # Resolve the file path
    target_path = base / file_path

    # Security check: ensure path is within project root
    if not target_path.resolve().is_relative_to(base.resolve()):
        raise HTTPException(status_code=403, detail="Access denied: Path outside project root")

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory, not a file")

    # Read file — detect binary content first
    async with aiofiles.open(target_path, "rb") as f:
        sample = await f.read(8192)
        if b"\x00" in sample:
            raise HTTPException(
                status_code=400,
                detail="File appears to be binary and cannot be displayed as text.",
            )
        # Seek back and read the full content as text
        await f.seek(0)
        content_bytes = await f.read()

    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="File is not valid UTF-8 text.",
        )

    return content
