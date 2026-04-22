"""Main harness orchestration — follows the frontend flow EXACTLY.

Steps:
  1. FolderSelector  setSelectedFolder + setView('models')
  2. ModelSelector mounts  useModels  createSession (POST)
  3. useModels polls GET /api/models/ until models arrive
  4. User selects model  switchModel + setView('workspace')
  5. ChatPanel mounts  useWebSocket  doConnect
  6. WS onopen  send get_state + set_model
  7. Send prompt "Tell me about this project"
  8. Relay inbound messages until agent_end
  9. Send get_messages to retrieve conversation history
"""

from __future__ import annotations

import asyncio
import json
import time

import httpx

from .colors import (
    banner,
    err,
    info,
    ok,
    verdict_inconclusive,
    verdict_stable,
    verdict_stall,
    warn,
)
from .config import (
    API_BASE,
    MAX_POLL_TIME,
    POLL_INTERVAL,
    PROJECT_NAME,
    RELAY_WINDOW,
    TEST_MODEL_ID,
)
from .http_client import http_get, http_post
from .project_resolver import list_projects, resolve_project_path
from .ws_client import ws_connect, ws_receive, ws_send


def _select_model(models: list[dict] | None) -> tuple[str, str]:
    """Pick the best model from the list, falling back to default."""
    if not models:
        return TEST_MODEL_ID, ""
    for m in models:
        if TEST_MODEL_ID in m.get("id", ""):
            return m["id"], m.get("provider", "")
    return TEST_MODEL_ID, ""


def _format_msg(msg: dict, elapsed: float) -> str:
    """Format a WS inbound message for display."""
    kind = msg.get("kind", msg.get("type", "unknown"))
    event = msg.get("event", {})
    etype = event.get("type", event.get("status", kind))

    if kind == "rpc_event":
        return f"[+{elapsed:.0f}s] * rpc_event type={etype}"
    if kind == "extension_ui_request":
        return f"[+{elapsed:.0f}s] ! extension_ui_request method={msg.get('method')}"
    if kind == "extension_ui_response":
        return f"[+{elapsed:.0f}s] * extension_ui_response"
    if kind == "response":
        return f"[+{elapsed:.0f}s] OK response"
    return f"[+{elapsed:.0f}s] {kind}: {json.dumps(msg)[:300]}"


def _extract_content(msg: dict) -> str:
    """Extract text content from a Pi RPC streaming event.

    Per the official RPC protocol docs, message_update events have this shape:
      { type: "message_update", assistantMessageEvent: { type, delta, partial } }

    Text deltas come in two forms:
      - text_delta:   ami.delta contains the new chunk
      - text_start:   ami.partial.content[0].text has accumulated text
    """
    if msg.get("kind") != "rpc_event":
        return ""

    event = msg.get("event", {})
    if event.get("type") != "message_update":
        return ""

    # assistantMessageEvent is the actual stream payload (per RPC docs)
    ami = event.get("assistantMessageEvent", {})
    if not ami or not isinstance(ami, dict):
        return ""

    delta_type = ami.get("type", "")

    # text_delta: single text chunk in ami.delta
    if delta_type == "text_delta":
        delta = ami.get("delta", "")
        if isinstance(delta, str) and delta:
            return delta

    # text_start / other: accumulated text in ami.partial.content[0].text
    partial = ami.get("partial", {})
    if isinstance(partial, dict):
        content_list = partial.get("content", [])
        if isinstance(content_list, list) and content_list:
            first = content_list[0]
            if isinstance(first, dict):
                text = first.get("text", "")
                if isinstance(text, str) and text:
                    return text

    return ""


async def run() -> int:
    """Run the full frontend flow and return exit code."""

    # --- Resolve project path ---

    project_path = resolve_project_path(PROJECT_NAME)
    if not project_path.exists():
        err(f"Project not found: {PROJECT_NAME}")
        print("\nAvailable in ~/Projects:")
        for name in list_projects():
            print(f"  - {name}")
        return 1

    print(f"Project: {project_path}")
    print(f"Model:   {TEST_MODEL_ID}")

    # --- Step 1: FolderSelector ---

    banner("STEP 1: FolderSelector — setSelectedFolder + setView('models')")
    info(f"selectedFolder = {project_path}")
    info("selectedModel = null")
    info("view = 'models'")

    # --- Step 2: ModelSelector mounts  useModels  createSession ---

    banner("STEP 2: ModelSelector mounts  useModels creates session")
    info("useModels(folder)  createSession(projectPath)")
    info("POST /api/projects/?project_path=...")

    async with httpx.AsyncClient(timeout=60) as client:
        # Verify server reachable
        try:
            await client.get(f"http://{API_BASE.replace('http://', '')}/docs", timeout=5)
            ok(f"Backend reachable at {API_BASE}")
        except Exception as e:
            err(f"Cannot reach backend at {API_BASE}: {e}")
            return 1

        # Create session
        try:
            session_data = await http_post(
                client,
                "/api/projects/",
                body={},  # body is required by FastAPI even if empty
                params={"project_path": str(project_path)},
            )
            session_id = session_data["session_id"]
            info(f"session_id = {session_id}")
            info(f"status = {session_data.get('status')}")
            info(f"model_id = {session_data.get('model_id')}")
            ok("Session created (status=running)")
        except Exception as e:
            err(f"Failed to create session: {e}")
            return 1

        info("AppContext.sessionId = session_id OK")

        # --- Step 3: useModels polls for models ---

        banner("STEP 3: useModels polls for models")
        info("GET /api/models/?session_id=...  (polls every 1.5s for up to 30s)")

        start_poll = time.monotonic()
        models: list[dict] | None = None
        poll_count = 0
        while time.monotonic() - start_poll < MAX_POLL_TIME:
            poll_count += 1
            try:
                raw = await http_get(
                    client,
                    "/api/models/",
                    params={"session_id": session_id},
                )
                models = raw if isinstance(raw, list) else []
                if models and len(models) > 0:
                    ok(
                        f"Models arrived after {poll_count} poll(s) "
                        f"({time.monotonic() - start_poll:.1f}s)"
                    )
                    for m in models[:3]:
                        info(f"  - {m.get('provider', '?')} — {m.get('id', '?')}")
                    break
            except Exception as e:
                if poll_count % 4 == 0:
                    warn(f"Poll {poll_count}: {e}")
            await asyncio.sleep(POLL_INTERVAL)
        else:
            warn("Timeout waiting for models — continuing anyway")

        # --- Step 4: User selects model ---

        banner("STEP 4: User selects model — switchModel + setView('workspace')")
        info("switchModel(selectedModel)")
        info("setCurrentModel(selectedModel)")
        info("setView('workspace')")
        info("No REST API call — model switch is client-side only")

        selected_model_id, selected_provider = (
            _select_model(models) if models else (TEST_MODEL_ID, "")
        )
        info(f"Selected model: {selected_model_id} (provider: {selected_provider})")

        # --- Step 5: ChatPanel mounts  useWebSocket ---

        banner("STEP 5: ChatPanel mounts  useWebSocket(folder, modelRef, sessionId)")
        info(f"selectedFolder = {project_path}")
        info(f"modelRef.current = model(id={selected_model_id})")
        info(f"sessionId = {session_id}")
        info("useWebSocket mount effect  doConnect()")

        # --- Step 6: WS Connect ---

        banner("STEP 6: WS Connect  mimics useWebSocket doConnect()")
        ws = await ws_connect(session_id)

        connection_start = time.monotonic()
        messages_received: list[dict] = []
        set_model_sent = False

        # --- Step 7: WS onopen  get_state + set_model ---

        banner("STEP 7: WS onopen  get_state + set_model")
        await asyncio.sleep(0.5)  # let WS settle

        await ws_send(ws, {"type": "get_state"})
        await asyncio.sleep(0.5)

        await ws_send(
            ws,
            {
                "type": "set_model",
                "provider": selected_provider,
                "modelId": selected_model_id,
            },
        )
        set_model_sent = True
        ok("get_state + set_model sent")

        # --- Step 8: Send prompt ---

        banner("STEP 8: Send prompt message")
        await ws_send(ws, "Tell me about this project")
        info("Message sent. Waiting for response...")

        # --- Step 9: Relay inbound messages until agent_end ---

        banner("STEP 9: Relay inbound messages until agent_end")
        relay_start = time.monotonic()
        collected_content = []  # accumulate text content for final display
        last_content_len = 0  # track how much new content each time

        try:
            while time.monotonic() - relay_start < RELAY_WINDOW:
                elapsed = time.monotonic() - connection_start
                msg = await ws_receive(ws, timeout=5.0)
                if msg is None:
                    info(f"[+{elapsed:.0f}s] (timeout, waiting...)")
                    continue

                messages_received.append(msg)

                kind = msg.get("kind", msg.get("type", "unknown"))

                # Extract content from message_update events
                if kind == "rpc_event":
                    content = _extract_content(msg)
                    if content:
                        collected_content.append(content)

                    # Print a condensed summary of event types
                    event = msg.get("event", {})
                    etype = event.get("type", "unknown")
                    if etype == "message_update" and content:
                        # Show running content update
                        current_text = "".join(collected_content)
                        new_text = current_text[last_content_len:]
                        last_content_len = len(current_text)
                        if new_text.strip():
                            info(f"[+{elapsed:.0f}s] text: {new_text[:80]}...")
                    elif etype in ("message_start", "turn_start", "agent_start"):
                        info(f"[+{elapsed:.0f}s] * {etype}")
                    elif etype in ("tool_execution_start", "tool_execution_end"):
                        tool = event.get("tool_name", event.get("name", ""))
                        info(f"[+{elapsed:.0f}s] * {etype} {tool}")
                    elif etype == "agent_end":
                        # Agent is fully idle — no more turns or tool calls.
                        # Per RPC docs: "Emitted when the agent completes."
                        # The messages array has the full response as backup.
                        info(f"[+{elapsed:.0f}s] * {etype}")
                        if event.get("messages"):
                            info(
                                f"  agent_end includes {len(event['messages'])} "
                                f"message(s) (backup text source)"
                            )
                        info(f"[+{elapsed:.0f}s] Agent idle  breaking relay loop")
                        break
                    elif etype in ("turn_end", "message_end"):
                        info(f"[+{elapsed:.0f}s] * {etype}")
                    else:
                        info(f"[+{elapsed:.0f}s] * {etype}")
                elif kind == "rpc_response":
                    # RPC response (get_state, set_model, get_messages, etc.)
                    response = msg.get("response", {})
                    resp_type = (
                        response.get("type", "unknown") if isinstance(response, dict) else "unknown"
                    )
                    info(f"[+{elapsed:.0f}s] OK rpc_response type={resp_type}")
                    # Show get_messages response details
                    if resp_type == "get_messages":
                        messages_data = response.get("messages", [])
                        if isinstance(messages_data, list):
                            info(f"  get_messages: {len(messages_data)} message(s) in history")
                elif kind == "response":
                    info(f"[+{elapsed:.0f}s] OK response")
                elif kind == "extension_ui_request":
                    info(f"[+{elapsed:.0f}s] ! {msg.get('method')}")
                else:
                    info(f"[+{elapsed:.0f}s] {kind}")
        except asyncio.CancelledError:
            pass

        # --- Step 10: Send get_messages after conversation ---

        banner("STEP 10: Send get_messages to retrieve conversation")
        # Don't send an "id" — responses with ids go to pending_requests Future,
        # NOT the event_buffer that the WS relay reads from.
        await ws_send(ws, {"type": "get_messages"})

        # --- Step 11: Wait for get_messages response ---

        banner("STEP 11: Wait for get_messages response")
        get_messages_found = False
        try:
            while time.monotonic() - relay_start < 80.0:  # extended window
                msg = await ws_receive(ws, timeout=5.0)
                if msg is None:
                    info(f"  no response within 5s")
                    break
                messages_received.append(msg)
                kind = msg.get("kind", msg.get("type", "unknown"))
                # Without an id, the response comes as kind=="response" (not wrapped)
                # pi --rpc returns {"type":"response","command":"get_messages",...}
                if kind == "response" and msg.get("command") == "get_messages":
                    messages_data = (
                        msg.get("data", {}).get("messages", []) if msg.get("data") else []
                    )
                    if isinstance(messages_data, list):
                        get_messages_found = True
                        info(f"  get_messages: {len(messages_data)} conversation message(s)")
                        for i, m in enumerate(messages_data[:5]):
                            role = m.get("role", "unknown")
                            content = str(m.get("content", "")[:100])
                            info(f"    [{i}] role={role} content='{content}...'")
                        break
                else:
                    # Still collect other messages in case there's a delay
                    info(f"  (buffered) kind={kind}")
        except Exception as e:
            warn(f"Timeout or error waiting for get_messages response: {e}")

        if not get_messages_found:
            warn("get_messages did not return a response within timeout")

        # --- Summary ---

        total_time = time.monotonic() - connection_start
        banner("SUMMARY")
        info(f"Total WS time: {total_time:.1f}s")
        info(f"Total inbound messages: {len(messages_received)}")
        info(f"set_model sent: {set_model_sent}")

        rpc_events = sum(1 for m in messages_received if m.get("kind") == "rpc_event")
        ext_requests = sum(1 for m in messages_received if m.get("kind") == "extension_ui_request")
        ext_responses = sum(
            1 for m in messages_received if m.get("kind") == "extension_ui_response"
        )
        rpc_responses = sum(1 for m in messages_received if m.get("kind") == "rpc_response")
        responses = sum(
            1 for m in messages_received if m.get("type") == "response" and m.get("kind") is None
        )

        info(f"  rpc_events: {rpc_events}")
        info(f"  extension_ui_requests: {ext_requests}")
        info(f"  extension_ui_responses: {ext_responses}")
        info(f"  rpc_responses: {rpc_responses}")
        info(f"  responses: {responses}")

        # Verdict
        if rpc_events > 0:
            verdict_stable()
            info(f"  {len(messages_received)} inbound, {rpc_events} RPC events, no loop")

            # Print the full response
            if collected_content:
                full_text = "".join(collected_content)
                banner("RESPONSE FROM MODEL")
                print(f"{full_text}")
            return 0
        elif total_time >= RELAY_WINDOW:
            verdict_stall()
            info(f"  60s elapsed, {len(messages_received)} messages  connection stalled")
            return 1
        else:
            verdict_inconclusive()
            info(f"  {len(messages_received)} messages in {total_time:.1f}s")
            return 1
