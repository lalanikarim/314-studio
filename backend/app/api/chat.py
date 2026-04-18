"""
Chat API endpoints for communicating with the Pi coding agent via WebSocket RPC.

Protocol:
  - WebSocket connects to `pi --mode rpc` process (started in project's cwd)
  - Messages from client → wrapped as `prompt` commands with unique `id`
  - Output from Pi → typed as either `"response"` (matching `id`) or `"event"` (streaming)
  - `extension_ui_request` → forwarded so frontend can respond interactively

Project identification is via `project_path` query parameter, matching browse.py.
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..schemas import ChatMessage, Message

router = APIRouter()

# Active Pi RPC processes and websockets
# session_id -> {"process": subprocess, "stdin": writer, "stdout": reader}
active_rpc_processes: dict = {}
# session_id -> WebSocket
active_websockets: dict = {}


# ---------------------------------------------------------------------------
# Pi RPC helper
# ---------------------------------------------------------------------------


async def launch_pi_rpc(project_path: str) -> tuple:
    """
    Launch a Pi RPC process for a project directory.

    Returns (process, stdin, stdout).
    """
    proc = await asyncio.create_subprocess_exec(
        "pi",
        "--mode",
        "rpc",
        cwd=project_path,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    return (proc, proc.stdin, proc.stdout)


async def send_rpc_command(stdin, command: dict) -> str:
    """
    Send a JSON command to Pi RPC stdin and return the generated request id.
    The command dict is sent as a single newline-terminated JSON line.
    """
    req_id = str(uuid.uuid4())
    # Attach the id if not already present
    if "id" not in command:
        command["id"] = req_id
    else:
        req_id = command["id"]

    line = json.dumps(command, ensure_ascii=False)
    stdin.write(f"{line}\n".encode("utf-8"))  # write() is sync; drain() is async
    await stdin.drain()
    return req_id


# ---------------------------------------------------------------------------
# WebSocket forwarding
# ---------------------------------------------------------------------------


async def forward_rpc_messages(session_id: str, websocket: WebSocket, project_path: str):
    """
    Bidirectional bridge:
      WebSocket text → Pi RPC stdin (wrapped as prompt commands)
      Pi RPC stdout  → WebSocket (typed: response / event / extension_ui_request)
    """
    # Launch RPC process if not already running
    if session_id not in active_rpc_processes:
        proc, stdin, stdout = await launch_pi_rpc(project_path)
        active_rpc_processes[session_id] = {
            "process": proc,
            "stdin": stdin,
            "stdout": stdout,
        }

    rpc = active_rpc_processes[session_id]

    read_task = asyncio.create_task(read_rpc_output(rpc["stdout"], websocket, session_id))
    write_task = asyncio.create_task(write_rpc_input(rpc["stdin"], websocket, session_id))

    done, pending = await asyncio.wait(
        {read_task, write_task},
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in pending:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    await asyncio.gather(*pending, return_exceptions=True)


async def _auto_reply_to_extension_request(data: dict, stdin):
    """
    Auto-reply to non-interactive extension_ui_request (notify, setHeader, etc.).

    Pi blocks on stdout until it gets an extension_ui_response for every
    extension_ui_request. For fire-and-forget methods (notify, setStatus,
    setHeader, setFooter, setTitle, setWidget, etc.) we send an automatic
    ack so Pi can continue processing.

    For interactive methods (select, confirm, input, editor) we forward to
    the frontend via WebSocket and wait for user input.
    """
    method = data.get("method", "")
    fire_and_forget = {
        "notify",
        "setStatus",
        "setTitle",
        "setFooter",
        "setHeader",
        "setWidget",
        "setEditorComponent",
        "set_tools_expanded",
    }
    interactive = {"select", "confirm", "input", "editor"}

    if method in fire_and_forget:
        # Auto-ack so Pi doesn't block
        reply = {
            "type": "extension_ui_response",
            "id": data["id"],
            "value": None,
            "cancelled": False,
        }
        await stdin.write(f"{json.dumps(reply, ensure_ascii=False)}\n".encode("utf-8"))
        await stdin.drain()
        return True
    elif method in interactive:
        # Interactive — forward to frontend for user input
        return False
    else:
        # Unknown method — auto-ack to prevent blocking
        reply = {
            "type": "extension_ui_response",
            "id": data["id"],
            "value": None,
            "cancelled": False,
        }
        await stdin.write(f"{json.dumps(reply, ensure_ascii=False)}\n".encode("utf-8"))
        await stdin.drain()
        return True


async def read_rpc_output(stdout, websocket: WebSocket, session_id: str):
    """
    Read JSON lines from Pi RPC stdout and forward them to the WebSocket.

    Events are typed for the frontend:
      - {"type":"response", ...}         → forwarded as-is
      - Extension UI request             → auto-ack or forward to frontend
      - Any other JSON line              → wrapped as {"kind":"rpc_event", ...}
    """
    # Grab the stdin from the active RPC process so we can auto-reply
    rpc = active_rpc_processes.get(session_id, {})
    stdin = rpc.get("stdin")

    try:
        while True:
            line = await stdout.readline()
            if not line:
                break

            decoded = line.decode().strip()
            if not decoded:
                continue

            try:
                data = json.loads(decoded)
            except json.JSONDecodeError:
                continue  # Skip non-JSON lines

            # Type the event so the frontend knows how to handle it
            if isinstance(data, dict):
                msg_type = data.get("type")

                if msg_type == "response":
                    # Normal response — already self-describing
                    await websocket.send_text(json.dumps(data, ensure_ascii=False))
                elif msg_type == "extension_ui_request":
                    # Auto-reply to fire-and-forget requests so Pi doesn't block.
                    # Forward interactive requests to frontend.
                    auto_acked = await _auto_reply_to_extension_request(data, stdin)
                    if not auto_acked:
                        # Interactive — forward to frontend
                        wrapped = {"kind": "extension_ui_request", **data}
                        await websocket.send_text(json.dumps(wrapped, ensure_ascii=False))
                elif msg_type == "extension_ui_response":
                    # Extension got a response — relay it
                    wrapped = {"kind": "extension_ui_response", **data}
                    await websocket.send_text(json.dumps(wrapped, ensure_ascii=False))
                else:
                    # Streaming events (message_start, message_update, turn_start,
                    # message_end, agent_start, agent_end, tool_execution_*, etc.)
                    wrapped = {"kind": "rpc_event", "event": data}
                    await websocket.send_text(json.dumps(wrapped, ensure_ascii=False))
            else:
                # Non-dict line (unexpected but guard against it)
                wrapped = {"kind": "rpc_event", "event": decoded}
                await websocket.send_text(json.dumps(wrapped, ensure_ascii=False))

    except Exception as e:
        print(f"Error reading RPC output for {session_id}: {e}")


async def write_rpc_input(stdin, websocket: WebSocket, session_id: str):
    """
    Receive text from WebSocket and forward to Pi RPC stdin.

    Client can send:
      - Normal strings → wrapped as {"type":"prompt","message":"...","id":"<uuid>"}
      - Extension UI responses → forwarded directly as {type:"extension_ui_response", ...}
      - Commands (get_state, set_model, compact, etc.) → forwarded directly
    """
    try:
        while True:
            data = await websocket.receive_text()
            if not data:
                continue

            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                payload = data  # Plain text → treat as chat message

            if isinstance(payload, str):
                # Plain text message → wrap as prompt command
                command = {"type": "prompt", "message": payload}
                await send_rpc_command(stdin, command)

            elif isinstance(payload, dict):
                # Structured message
                kind = payload.get("kind")
                msg_type = payload.get("type")

                if kind == "extension_ui_response":
                    # Extension replied to an interactive prompt
                    await stdin.write(
                        f"{json.dumps(payload, ensure_ascii=False)}\n".encode("utf-8")
                    )
                    await stdin.drain()
                elif kind == "rpc_event":
                    # Skip events going upstream
                    continue
                elif msg_type in (
                    "prompt",
                    "steer",
                    "follow_up",
                    "set_model",
                    "cycle_model",
                    "get_available_models",
                    "get_state",
                    "get_messages",
                    "get_session_stats",
                    "compact",
                    "set_auto_compaction",
                    "set_thinking_level",
                    "cycle_thinking_level",
                    "set_steering_mode",
                    "set_follow_up_mode",
                    "get_commands",
                ):
                    # Known RPC command — send as-is
                    await send_rpc_command(stdin, payload)
                elif msg_type == "extension_ui_response":
                    # Already handled above
                    await stdin.write(
                        f"{json.dumps(payload, ensure_ascii=False)}\n".encode("utf-8")
                    )
                    await stdin.drain()
                elif msg_type == "abort":
                    # Abort is special — no id needed
                    await stdin.write('{"type": "abort"}\n'.encode("utf-8"))
                    await stdin.drain()
                elif msg_type == "prompt":
                    # User message → wrap with prompt type
                    cmd = {"type": "prompt", "message": payload.get("message", "")}
                    await send_rpc_command(stdin, cmd)
                else:
                    # Unknown dict — try to forward as-is
                    await send_rpc_command(stdin, payload)
            else:
                # Fallback: send raw
                await stdin.write(f"{json.dumps(payload)}\n".encode("utf-8"))
                await stdin.drain()

    except Exception as e:
        print(f"Error writing RPC input for {session_id}: {e}")


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/ws")
async def rpc_websocket_endpoint(websocket: WebSocket, project_path: str = Query(...)):
    """
    WebSocket endpoint for Pi RPC communication.

    project_path: absolute path to the project directory (e.g. ~/Projects/ai-chatbot)
    """
    await websocket.accept()

    session_id = f"ws_{uuid.uuid4().hex[:8]}"

    try:
        active_websockets[session_id] = websocket
        resolved_path = str(Path(project_path).expanduser())

        await forward_rpc_messages(session_id, websocket, resolved_path)

    except WebSocketDisconnect:
        print(f"WebSocket disconnected for project={project_path}")
        await _cleanup_session(session_id)

    except Exception as e:
        print(f"WebSocket error for project={project_path}: {e}")
        await _cleanup_session(session_id)


async def _cleanup_session(session_id: str):
    """Terminate Pi RPC process and clean up tracking dicts."""
    if session_id in active_rpc_processes:
        rpc = active_rpc_processes[session_id]
        proc = rpc.get("process")
        if proc and proc.returncode is None:
            try:
                proc.terminate()
                # Give it a moment, then kill if still alive
                await asyncio.sleep(0.1)
                if proc.returncode is None:
                    proc.kill()
            except Exception:
                pass
        del active_rpc_processes[session_id]

    if session_id in active_websockets:
        del active_websockets[session_id]


# ---------------------------------------------------------------------------
# REST helpers (backward compatibility)
# ---------------------------------------------------------------------------


@router.post("/sessions/{session_id}/chat")
async def send_chat_message(
    session_id: str,
    project_path: str = Query(...),
    message: Optional[ChatMessage] = None,
) -> dict:
    """
    Send a chat message. Deprecated — use the WebSocket endpoint instead.
    If the WebSocket is active for this session, the message is forwarded there.
    """
    # Find the WebSocket session for this project
    if not message:
        return {"status": "error", "message": "Message body required"}
    for sid, ws in active_websockets.items():
        try:
            await ws.send_text(json.dumps({"kind": "rpc_event", "event": message.message}))
            return {"status": "forwarded", "websocket": sid}
        except Exception:
            pass

    return {
        "status": "no_active_connection",
        "message": "Use the WebSocket endpoint /api/projects/ws?project_path=... for real-time chat",
        "websocket_url": "/api/projects/ws",
    }


@router.get("/sessions/{session_id}/chat")
async def get_chat_history(
    session_id: str,
    project_path: str = Query(...),
) -> List[Message]:
    """
    Get chat history. Deprecated — fetch via WebSocket using get_messages RPC command.
    """
    return []
