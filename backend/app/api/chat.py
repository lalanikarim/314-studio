"""
Chat API endpoints — WebSocket relay for Pi RPC communication.

This module is now a thin relay layer. All process lifecycle is owned by
SessionManager (see session_manager.py). The WebSocket connects to an
existing session and relays messages bidirectionally:

  Client WebSocket  →  session's stdin  (commands, prompts, extension responses)
  session's stdout  →  Client WebSocket (responses, streaming events, UI requests)

Protocol:
  - Messages from client → forwarded to process stdin as-is
    Plain strings → wrapped as {"type":"prompt","message":"..."}
    Dicts with "extension_ui_response" → forwarded directly
    Dicts with known RPC type → forwarded directly
  - Output from Pi → typed for frontend:
    {"type":"response", ...}              → relayed as-is
    {"kind":"rpc_event","event": {...}}   → streaming events
    {"kind":"extension_ui_request", ...}  → interactive UI prompt
    {"kind":"extension_ui_response", ...} → ack relay
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..session_manager import session_manager

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, session_id: str = Query(...)) -> None:
    """
    WebSocket endpoint for Pi RPC communication.

    Connects to an existing session's pi --rpc process and relays messages
    bidirectionally. The session must already exist (created via POST
    /api/projects/).

    On connect, sends `set_model` with the session's configured model_id.
    No automatic RPC calls are made during session creation.

    Query params:
        session_id: the session to connect to
    """
    # Validate session exists and is running
    ok = await session_manager.connect_ws(session_id, str(websocket))
    if not ok:
        record = session_manager.get_session(session_id)
        reason = "Session not found" if not record else f"Session is {record.status} (not running)"
        await websocket.close(code=4002, reason=reason)
        return

    await websocket.accept()

    # Send set_model to the RPC process (all Pi actions go through WS)
    model_id = await session_manager.get_model_id(session_id)
    if model_id:
        await _write_stdin(
            session_id,
            {
                "type": "set_model",
                "modelId": model_id,
                "provider": "",
            },
        )

    try:
        await _relay_messages(session_id, websocket)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session %s", session_id)
    except Exception as exc:
        logger.error("WebSocket error for session %s: %s", session_id, exc, exc_info=True)
    finally:
        await session_manager.disconnect_ws(session_id, str(websocket))


# ---------------------------------------------------------------------------
# WS relay logic
# ---------------------------------------------------------------------------


async def _relay_messages(session_id: str, websocket: WebSocket) -> None:
    """Bidirectional relay between WebSocket and session's stdin/stdout."""

    async def _outbound() -> None:
        """Session stdout → WebSocket."""
        try:
            while True:
                event = await session_manager.get_next_event(session_id)
                if event is None:
                    # EOF — process exited
                    break
                if isinstance(event, dict):
                    await websocket.send_text(json.dumps(event, ensure_ascii=False))
                else:
                    await websocket.send_text(json.dumps(event, ensure_ascii=False))
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("Outbound relay error for %s: %s", session_id, exc)

    async def _inbound() -> None:
        """WebSocket → session stdin."""
        try:
            while True:
                data = await websocket.receive_text()
                if not data:
                    continue

                try:
                    payload: Any = json.loads(data)
                except json.JSONDecodeError:
                    payload = {"type": "prompt", "message": data}

                if isinstance(payload, str):
                    payload = {"type": "prompt", "message": payload}

                if isinstance(payload, dict):
                    # Extension UI response → forward directly to stdin
                    if payload.get("type") == "extension_ui_response":
                        await _write_stdin(session_id, payload)
                    # Abort → special handling (no id)
                    elif payload.get("type") == "abort":
                        await _write_stdin_raw(session_id, '{"type": "abort"}\n')
                    # Known RPC command types → forward as-is
                    elif payload.get("type") in (
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
                        await _write_stdin(session_id, payload)
                    # Everything else → try to forward
                    else:
                        await _write_stdin(session_id, payload)
                else:
                    await _write_stdin_raw(session_id, json.dumps(payload) + "\n")
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("Inbound relay error for %s: %s", session_id, exc)

    out_task = asyncio.create_task(_outbound(), name=f"ws_out_{session_id}")
    in_task = asyncio.create_task(_inbound(), name=f"ws_in_{session_id}")

    done, pending = await asyncio.wait({out_task, in_task}, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    await asyncio.gather(*pending, return_exceptions=True)


async def _write_stdin(session_id: str, payload: dict) -> None:
    """Write a JSON command to the session's stdin."""
    record = session_manager.get_session(session_id)
    if not record or record.status != "running" or record.stdin is None:
        return
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    record.stdin.write(line.encode("utf-8"))
    await record.stdin.drain()


async def _write_stdin_raw(session_id: str, raw: str) -> None:
    """Write raw bytes to the session's stdin."""
    record = session_manager.get_session(session_id)
    if not record or record.status != "running" or record.stdin is None:
        return
    record.stdin.write(raw.encode("utf-8"))
    await record.stdin.drain()
