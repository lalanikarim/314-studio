"""
Chat API endpoints for communicating with the Pi coding agent via WebSocket RPC.
"""

import asyncio
import json
from pathlib import Path
from typing import List

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..schemas import ChatMessage, Message

router = APIRouter()

# Active Pi RPC processes and websockets
active_rpc_processes = {}  # session_id -> (process, stdin, stdout)
active_websockets = {}  # session_id -> WebSocket connection


async def launch_pi_rpc(project_path: str) -> tuple:
    """
    Launch a Pi RPC process for a project.
    Returns the process and its stdin/stdout streams.
    """
    # Launch the Pi RPC process with the project directory as cwd
    # pi --rpc command starts the RPC server for that project
    proc = await asyncio.create_subprocess_exec(
        "pi",
        "--rpc",
        cwd=project_path,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    return (proc, proc.stdin, proc.stdout)


async def forward_rpc_messages(session_id: str, websocket: WebSocket, project_path: str):
    """
    Forward messages between WebSocket and Pi RPC process.
    All interactions happen through this bidirectional channel.
    """
    # Launch RPC if not already running for this project
    if session_id not in active_rpc_processes:
        proc, stdin, stdout = await launch_pi_rpc(project_path)
        active_rpc_processes[session_id] = (proc, stdin, stdout)

    process, stdin, stdout = active_rpc_processes[session_id]

    # Read Pi RPC responses and forward to WebSocket
    read_task = asyncio.create_task(read_rpc_output(stdout, websocket, session_id))

    # Read WebSocket messages and forward to Pi RPC
    write_task = asyncio.create_task(write_rpc_input(stdin, websocket, session_id))

    # Wait for either task to complete
    done, pending = await asyncio.wait({read_task, write_task}, return_when=asyncio.FIRST_COMPLETED)

    # Cancel the other task
    for task in pending:
        task.cancel()
        try:
            await task  # This will raise the exception from task.cancel()
        except asyncio.CancelledError:
            pass  # Expected when we cancel the task
        except Exception as e:
            print(f"Error in cancelled task: {e}")

    # Wait for cancellation to complete
    await asyncio.gather(*list(pending), return_exceptions=True)


async def read_rpc_output(stdout, websocket: WebSocket, session_id: str):
    """
    Read output from Pi RPC and send to WebSocket.
    """
    try:
        while True:
            line = await stdout.readline()
            if not line:
                break

            line = line.decode().strip()
            if line:
                # Parse JSON response from Pi
                try:
                    data = json.loads(line)
                    # Forward to WebSocket
                    await websocket.send_text(json.dumps(data))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Error reading RPC output for {session_id}: {e}")


async def write_rpc_input(stdin, websocket: WebSocket, session_id: str):
    """
    Write messages from WebSocket to Pi RPC.
    """
    try:
        while True:
            # Receive message from WebSocket
            data = await websocket.receive_text()

            # Forward to Pi RPC stdin
            if data:
                await stdin.write(data.encode("utf-8"))
                await stdin.write("\n".encode("utf-8"))
                await stdin.drain()
    except Exception as e:
        print(f"Error writing RPC input for {session_id}: {e}")


@router.websocket("/ws/rpc/{project_name}")
async def rpc_websocket_endpoint(websocket: WebSocket, project_name: str):
    """
    WebSocket endpoint for Pi RPC communication.
    All interactions with Pi happen through this WebSocket.
    """
    await websocket.accept()

    # Generate session ID for this connection
    session_id = f"session_{project_name}_{websocket.headers.get('User-Agent', 'web')}"

    try:
        # Store the websocket connection
        active_websockets[session_id] = websocket

        # Get the project path
        project_path = str(Path.cwd() / project_name)

        # Start forwarding messages
        await forward_rpc_messages(session_id, websocket, project_path)

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for {project_name}")

        # Clean up
        if session_id in active_rpc_processes:
            proc, _, _ = active_rpc_processes[session_id]
            proc.terminate()
            del active_rpc_processes[session_id]

        if session_id in active_websockets:
            del active_websockets[session_id]


@router.post("/sessions/{session_id}/chat")
async def send_chat_message(project_name: str, session_id: str, message: ChatMessage) -> dict:
    """
    Send a chat message to the agent.
    This endpoint is kept for backward compatibility but should redirect to WebSocket.
    """
    # In the new workflow, all messages go through WebSocket
    return {
        "status": "deprecated",
        "message": "Use WebSocket endpoint /ws/rpc/{project} for all communication",
        "websocket_url": f"/ws/rpc/{project_name}",
    }


@router.get("/sessions/{session_id}/chat", response_model=List[Message])
async def get_chat_history(project_name: str, session_id: str) -> List[Message]:
    """
    Get chat history for a session.
    Deprecated - get history through WebSocket RPC instead.
    """
    return []  # History should come from Pi RPC
