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

router = APIRouter()


def _resolve_project_path(project_path_str: Optional[str]) -> Path:
    """Resolve the project path string to a Path object."""
    if not project_path_str:
        raise HTTPException(
            status_code=400, detail="Missing required query parameter: project_path"
        )
    resolved = Path(project_path_str).expanduser()
    if not resolved.is_absolute() and not resolved.exists():
        candidate = Path.home() / "Projects" / project_path_str
        if candidate.exists():
            resolved = candidate
    return resolved


# ---------------------------------------------------------------------------
# GET /files — list files in a directory
# ---------------------------------------------------------------------------


@router.get("/files", response_model=list[FileInfo])
async def list_files(
    project_path: str = Query(..., description="Absolute path to the project directory"),
    path: Optional[str] = Query("/", description="Sub-directory path within the project"),
) -> list[FileInfo]:
    """
    List files in a directory.
    """
    base = _resolve_project_path(project_path)

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

    # List files
    files = []
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

        files.append(file_info)

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
    base = _resolve_project_path(project_path)

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

    # Read file asynchronously
    async with aiofiles.open(target_path, "r") as f:
        content = await f.read()

    return content
