"""
Utils for the backend application.
"""

from pathlib import Path
from typing import Dict
import asyncio

# Track active Pi RPC processes
active_rpc_processes: Dict[str, tuple] = {}


async def cleanup_session(session_id: str) -> None:
    """
    Clean up resources for a session.
    """
    if session_id in active_rpc_processes:
        process, _, _ = active_rpc_processes[session_id]
        if process:
            process.terminate()
        del active_rpc_processes[session_id]


async def launch_rpc(session_id: str, project_path: Path) -> tuple:
    """
    Launch a Pi RPC process for a session.

    Returns:
        tuple: (process, stdin, stdout)
    """
    # Create session directory if it doesn't exist
    session_dir = project_path / ".pi" / "sessions"
    session_dir.mkdir(parents=True, exist_ok=True)

    # Launch the Pi RPC process
    # This command assumes Pi is installed and available in PATH
    proc = await asyncio.create_subprocess_exec(
        "pi-rpc",
        "--session-dir",
        str(session_dir),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    return (proc, proc.stdin, proc.stdout)
