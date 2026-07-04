"""
Chat API endpoints — SSE stream for Pi RPC events + REST command endpoint.

Architecture:
  - SSE (`GET /api/projects/sse`) delivers streaming events from the
    `pi --rpc` process to the frontend via `text/event-stream`.
  - REST (`POST /api/projects/{session_id}/cmd`) sends commands to the
    process stdin. Responses flow back through the SSE stream.
  - The session manager owns process lifecycle. This module is a thin
    transport layer only.

Protocol:
  - SSE events are JSON lines with an `event:` type field:
      event: rpc_event       → streaming text, tool calls
      event: rpc_response    → command responses (get_state, etc.)
      event: extension_ui_request → interactive prompts
      event: extension_ui_response → auto-ack relay
      event: set_model       → initial model config
      event: session_terminated → process exit
  - REST commands map directly to Pi RPC commands. The `id` for
    request/response correlation is handled by the session manager's
    pending_requests mechanism.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from ..session_manager import session_manager
from ..utils import validate_session_id

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# SSE endpoint
# ---------------------------------------------------------------------------


@router.get("/sse")
async def sse_endpoint(session_id: str = Query(...)) -> StreamingResponse:
    """Server-Sent Events stream for a session.

    Yields JSON-line SSE events from the session's event_buffer.
    Supports streaming with proper text/event-stream format.
    """
    validate_session_id(session_id)

    # Validate session exists and is running
    ok = await session_manager.subscribe_sse(session_id)
    if not ok:
        rec = session_manager.get_session(session_id)
        reason = "Session not found" if not rec else f"Session is {rec.status} (not running)"
        return JSONResponse(status_code=400, content={"detail": reason})

    # Send set_model event on connect
    model_id = await session_manager.get_model_id(session_id)

    async def event_generator():
        # Initial set_model event
        if model_id:
            yield {
                "event": "set_model",
                "data": json.dumps(
                    {
                        "type": "set_model",
                        "modelId": model_id,
                        "provider": "",
                    },
                    ensure_ascii=False,
                ),
            }

        # Main event stream loop
        while True:
            rec = session_manager.get_session(session_id)
            if not rec or rec.status != "running":
                yield {"event": "session_terminated", "data": json.dumps({"reason": "terminated"})}
                break
            if rec.sse_cancelled:
                break
            event = await session_manager.get_next_event(session_id)
            if event is None:
                # EOF — process exited
                yield {"event": "session_terminated", "data": json.dumps({"reason": "eof"})}
                break
            yield format_sse_event(event)

    return EventSourceResponse(event_generator(), ping=30)


def format_sse_event(event: dict) -> dict:
    """Format an event dict into an SSE event with event/data/id fields."""
    kind = event.get("kind")
    msg_type = event.get("type")

    if kind == "extension_ui_request":
        return {"event": "extension_ui_request", "data": json.dumps(event, ensure_ascii=False)}
    if kind == "extension_ui_response":
        return {"event": "extension_ui_response", "data": json.dumps(event, ensure_ascii=False)}
    if kind == "rpc_event":
        return {"event": "rpc_event", "data": json.dumps(event, ensure_ascii=False)}
    if msg_type == "response":
        return {"event": "rpc_response", "data": json.dumps(event, ensure_ascii=False)}

    # Fallback: wrap as rpc_event
    return {"event": "rpc_event", "data": json.dumps(event, ensure_ascii=False)}


# ---------------------------------------------------------------------------
# REST command endpoint
# ---------------------------------------------------------------------------


@router.post("/cmd")
async def cmd_endpoint(
    session_id: str = Query(...),
    command: dict = None,
):
    """Send a command to a session's pi --rpc process.

    All Pi RPC commands are supported. Responses flow back through the
    SSE event stream as rpc_response events (not returned in this REST response).
    """
    validate_session_id(session_id)

    if not command:
        raise HTTPException(status_code=400, detail="Missing command body")

    cmd = command.get("command")
    if not cmd:
        raise HTTPException(status_code=400, detail="Missing 'command' field")

    record = session_manager.get_session(session_id)
    if not record or record.status != "running":
        raise HTTPException(status_code=400, detail="Session not running")

    # Abort is fire-and-forget: write directly to stdin, return immediately
    if cmd == "abort":
        await _write_stdin_raw(session_id, '{"type": "abort"}\n')
        return {"status": "ok"}

    # All other commands go through send_command which:
    # 1. Generates req_id and stores a Future in pending_requests
    # 2. Writes JSONL to stdin
    # 3. Waits for the matching response Future to resolve
    rpc_command = _build_rpc_command(command)
    response = await session_manager.send_command(session_id, rpc_command)
    return {"status": "ok", "response": response}


def _build_rpc_command(command: dict) -> dict:
    """Convert a REST command envelope to Pi RPC command format.

    Reference: rpc.md#commands for each command's expected shape.
    """
    cmd = command.get("command", "")
    payload: dict = {"type": cmd}

    if cmd == "prompt":
        if command.get("message"):
            payload["message"] = command["message"]
        if command.get("streamingBehavior"):
            payload["streamingBehavior"] = command["streamingBehavior"]
        if command.get("images"):
            payload["images"] = command["images"]
    elif cmd == "steer":
        payload["message"] = command.get("message", "")
    elif cmd == "follow_up":
        payload["message"] = command.get("message", "")
    elif cmd == "compact":
        if command.get("customInstructions"):
            payload["customInstructions"] = command["customInstructions"]
    elif cmd == "set_model":
        payload["modelId"] = command.get("modelId", "")
        payload["provider"] = command.get("provider", "")
    elif cmd == "get_state":
        pass  # Empty payload is fine
    elif cmd == "get_messages":
        pass
    elif cmd == "get_session_stats":
        pass
    elif cmd == "get_commands":
        pass
    elif cmd == "cycle_model":
        pass
    elif cmd == "get_available_models":
        pass
    elif cmd == "extension_ui_response":
        payload["id"] = command.get("id", "")
        payload["value"] = command.get("value")
        payload["cancelled"] = command.get("cancelled", False)
    elif cmd == "set_auto_compaction":
        payload["enabled"] = command.get("enabled", False)
    elif cmd == "set_thinking_level":
        payload["level"] = command.get("level", "")
    elif cmd == "cycle_thinking_level":
        pass
    elif cmd == "set_steering_mode":
        payload["mode"] = command.get("mode", "")
    elif cmd == "set_follow_up_mode":
        payload["mode"] = command.get("mode", "")
    elif cmd == "bash":
        payload["command"] = command.get("command_text", "")
    elif cmd == "abort_bash":
        pass
    elif cmd == "get_entries":
        if command.get("since"):
            payload["since"] = command["since"]
    elif cmd == "get_tree":
        pass
    elif cmd == "get_last_assistant_text":
        pass
    elif cmd == "set_session_name":
        payload["name"] = command.get("name", "")
    elif cmd == "fork":
        payload["entryId"] = command.get("entry_id", "")
    elif cmd == "clone":
        pass
    elif cmd == "get_fork_messages":
        pass
    elif cmd == "switch_session":
        payload["sessionPath"] = command.get("session_path", "")
    elif cmd == "new_session":
        pass
    elif cmd == "export_html":
        if command.get("output_path"):
            payload["outputPath"] = command["output_path"]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd}")

    return payload


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _write_stdin_raw(session_id: str, raw: str) -> None:
    """Write raw bytes to the session's stdin."""
    record = session_manager.get_session(session_id)
    if not record or record.status != "running" or record.stdin is None:
        logger.warning("Session %s not available for stdin write", session_id)
        return
    try:
        record.stdin.write(raw.encode("utf-8"))
        await record.stdin.drain()
    except (BrokenPipeError, ConnectionResetError) as exc:
        logger.warning("Session %s stdin broken: %s", session_id, exc)
        raise
