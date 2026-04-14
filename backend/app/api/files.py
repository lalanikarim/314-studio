"""
File API endpoints for browsing and reading files.
"""

from fastapi import APIRouter, HTTPException, Request
from pathlib import Path
from typing import List, Optional
import aiofiles
from ..schemas import FileInfo

router = APIRouter()


@router.get("/files", response_model=List[FileInfo])
async def list_files(project_name: str, path: Optional[str] = "/") -> List[FileInfo]:
    """
    List files in a directory.
    """
    project_path = Path.cwd() / project_name

    # Resolve the path relative to project root
    if path and path != "/":
        target_path = project_path / path.lstrip("/")
    else:
        target_path = project_path

    # Security check: ensure path is within project root
    if not target_path.is_relative_to(project_path):
        raise HTTPException(
            status_code=403, detail="Access denied: Path outside project root"
        )

    # List files
    files = []
    for entry in target_path.iterdir():
        if entry.name.startswith("."):
            continue

        file_info = {
            "path": str(entry.relative_to(project_path)),
            "isDirectory": entry.is_dir(),
        }

        if not entry.is_dir():
            try:
                file_info["size"] = entry.stat().st_size
            except OSError:
                pass

        files.append(file_info)

    return files


@router.get("/files/{file_path:.+}")
async def read_file(request: Request, file_path: str) -> str:
    """
    Read file contents.
    """
    # Extract project_name from the path
    project_name = request.path_params.get("project_name", "test-project")

    project_path = Path.cwd() / project_name

    # Resolve the file path
    target_path = project_path / file_path

    print(f"Reading: project={project_name}, file={file_path}")
    print(f"Project path: {project_path}")
    print(f"Target path: {target_path}")
    print(f"Target exists: {target_path.exists()}")

    # Security check: ensure path is within project root
    if not target_path.is_relative_to(project_path):
        raise HTTPException(
            status_code=403, detail="Access denied: Path outside project root"
        )

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory, not a file")

    # Read file asynchronously
    async with aiofiles.open(target_path, "r") as f:
        content = await f.read()

    return content
