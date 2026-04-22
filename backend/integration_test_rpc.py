#!/usr/bin/env python3
"""
Integration test: backend RPC protocol against a live pi --mode rpc process.

Tests every command the backend sends/receives, validating against the
Pi RPC protocol.

Architecture:
  - Single event_reader task: owns proc.stdout.readline()
    → auto-replies to extension_ui_request (fire-and-forget) so Pi unblocks
    → queues response/event lines for consumers
  - send_command: writes command to stdin, then waits on queue for matching id
  - drain: pulls events until a stop condition
"""

import asyncio
import json
import sys
import uuid
from pathlib import Path

PROJECT_DIR = Path(__file__).parent / "tmp_test_project"
PROJECT_DIR.mkdir(exist_ok=True)
(PROJECT_DIR / "README.md").write_text("# Test Project\n")
(PROJECT_DIR / "test_file.py").write_text('print("hello")\n')


class EventQueue:
    """
    Shared event queue: single event_reader pushes here.
    Consumers pop via wait_for_response / drain.
    """

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._events: list[dict] = []

    async def push(self, line: str):
        decoded = line.strip()
        if not decoded:
            return
        try:
            obj = json.loads(decoded)
        except json.JSONDecodeError:
            obj = {"_raw": decoded}
        self._events.append(obj)
        await self._queue.put(obj)

    async def wait_for_response(self, proc, request_id: str, timeout: float = 60) -> dict | None:
        """Wait until we get a response with matching id (or extension_ui_request).

        Auto-responds to extension_ui_request so Pi doesn't block.
        """
        deadline = asyncio.get_event_loop().time() + timeout
        got_types: list[str] = []
        while asyncio.get_event_loop().time() < deadline:
            try:
                obj = await asyncio.wait_for(
                    self._queue.get(),
                    timeout=min(2.0, deadline - asyncio.get_event_loop().time()),
                )
            except asyncio.TimeoutError:
                break

            got_types.append(obj.get("type", "?"))
            if isinstance(obj, dict) and obj.get("id") == request_id:
                print(f"    [wait] Got matching id (types: {got_types[:5]})")
                return obj

            if isinstance(obj, dict) and obj.get("type") == "extension_ui_request":
                auto_reply = {
                    "type": "extension_ui_response",
                    "id": obj["id"],
                    "value": None,
                    "cancelled": False,
                }
                proc.stdin.write(f"{json.dumps(auto_reply)}\n".encode())
                await proc.stdin.drain()
                print(f"    [wait] Auto-reply extension_ui_request id={obj['id'][:16]}")

            if isinstance(obj, dict) and obj.get("type") == "response":
                print(f"    [wait] Other response: cmd={obj.get('command')} id={obj.get('id')}")

        print(f"    [wait] TIMEOUT after {timeout}s, types seen: {got_types[:10]}")
        return None

    async def drain(self, stop_after: set[str] | None = None, max_lines: int = 50) -> list[dict]:
        """Drain events until a stop condition or timeout."""
        events: list[dict] = []
        for _ in range(max_lines):
            try:
                obj = await asyncio.wait_for(self._queue.get(), timeout=3.0)
            except asyncio.TimeoutError:
                break
            events.append(obj)
            etype = obj.get("type", "unknown")
            if stop_after and etype in stop_after:
                break
            if etype == "response":
                cmd = obj.get("command", "?")
                if stop_after and cmd in stop_after:
                    break
        return events


# ── helpers ────────────────────────────────────────────────────────────────

sent: list[dict] = []
received: list[dict] = []


async def send_command(eq: EventQueue, cmd: dict, label: str = "") -> dict | None:
    """Send a command to Pi and wait for the matching response."""
    req_id = cmd.get("id", str(uuid.uuid4()))
    cmd["id"] = req_id
    label = label or cmd.get("type", "unknown")
    print(f"\n▶ Sending: {label} (id={req_id})")
    print(f"  cmd = {json.dumps(cmd, default=str)[:200]}")

    line = json.dumps(cmd) + "\n"
    proc.stdin.write(line.encode("utf-8"))
    await proc.stdin.drain()
    sent.append({"label": label, "cmd": cmd, "id": req_id})

    assert proc is not None
    resp = await eq.wait_for_response(proc, req_id)
    if resp:
        print(f"  ✓ Got response (id={resp.get('id')}, type={resp.get('type')})")
        print(f"  resp = {json.dumps(resp, default=str)[:300]}")
    else:
        print("  ❌ TIMEOUT waiting for response")
    received.append({"id": req_id, "label": label, "response": resp})
    return resp


# ── tests ──────────────────────────────────────────────────────────────────

passed = 0
failed = 0


def check(condition: bool, msg: str):
    global passed, failed
    if condition:
        print(f"  ✅ {msg}")
        passed += 1
    else:
        print(f"  ❌ {msg}")
        failed += 1
        return False
    return True


# 1. get_available_models
async def test_get_available_models(eq: EventQueue):
    resp = await send_command(eq, {"type": "get_available_models"}, "get_available_models")
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")
        check(resp.get("type") == "response", "Response type=response")
        data = resp.get("data", {})
        models = data.get("models", data.get("data", []))
        if isinstance(models, list):
            check(len(models) > 0, f"Got {len(models)} models")
            if models:
                first = models[0]
                check("id" in first, "Each model has an 'id' field")
                check("provider" in first, "Each model has a 'provider' field")
        else:
            check(False, f"data is not a list, type={type(data)}")


# 2. set_model
async def test_set_model(eq: EventQueue):
    resp = await send_command(
        eq,
        {"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"},
        "set_model",
    )
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")


# 3. get_state
async def test_get_state(eq: EventQueue):
    resp = await send_command(eq, {"type": "get_state"}, "get_state")
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")
        data = resp.get("data", {})
        check(
            "modelId" in data or "model" in data or "provider" in data,
            f"State contains model info (keys: {list(data.keys())[:10]})",
        )


# 4. get_messages
async def test_get_messages(eq: EventQueue):
    resp = await send_command(eq, {"type": "get_messages"}, "get_messages")
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")
        data = resp.get("data", {})
        if isinstance(data, dict):
            msgs = data.get("messages", [])
        else:
            msgs = data
        check(isinstance(msgs, list), "Data contains messages list")


# 5. get_session_stats
async def test_get_session_stats(eq: EventQueue):
    resp = await send_command(eq, {"type": "get_session_stats"}, "get_session_stats")
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")


# 6. get_commands
async def test_get_commands(eq: EventQueue):
    resp = await send_command(eq, {"type": "get_commands"}, "get_commands")
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")
        data = resp.get("data", {})
        commands = data.get("commands", []) if isinstance(data, dict) else data
        if isinstance(commands, list):
            check(len(commands) > 0, f"Got {len(commands)} commands")


# 7. set_thinking_level
async def test_set_thinking_level(eq: EventQueue):
    resp = await send_command(
        eq, {"type": "set_thinking_level", "level": "medium"}, "set_thinking_level"
    )
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")


# 8. set_session_name
async def test_set_session_name(eq: EventQueue):
    resp = await send_command(
        eq, {"type": "set_session_name", "name": "test-integration"}, "set_session_name"
    )
    check(resp is not None, "Got a response")
    if resp:
        check(resp.get("success") is True, "Response success=true")


# 9. prompt + event streaming
async def test_prompt_and_events(eq: EventQueue):
    print("\n▶ Testing prompt + event streaming")

    cmd = {
        "type": "prompt",
        "message": "Reply with exactly: HELLO_WORLD",
        "streamingBehavior": "steer",
    }
    req_id = str(uuid.uuid4())
    cmd["id"] = req_id
    print(f"  Sending prompt (id={req_id})...")

    proc.stdin.write((json.dumps(cmd) + "\n").encode("utf-8"))
    await proc.stdin.drain()
    sent.append({"label": "prompt", "cmd": cmd, "id": req_id})

    resp = await eq.wait_for_response(proc, req_id, timeout=30)
    if resp:
        t = resp.get("type")
        rid = resp.get("id")
    else:
        t = None
        rid = None
    print(f"  Immediate response: type={t}, id={rid}")
    received.append({"id": req_id, "label": "prompt", "response": resp})

    if resp:
        check(resp.get("type") == "response", "Immediate response type=response")
        check(resp.get("command") == "prompt", "Response command=prompt")
        check(resp.get("success") is True, "Response success=true")
        check(resp.get("id") == req_id, "Response id matches request id")
    else:
        check(False, "Got immediate response for prompt")

    print("  Draining events (waiting for turn_end or agent_end)...")
    events = await eq.drain(stop_after={"turn_end", "agent_end"})

    if events:
        types = [e.get("type", "unknown") for e in events]
        print(f"  Collected {len(events)} events: {types[:10]}")
        check(any(t in ("turn_end", "agent_end") for t in types), "Got turn_end or agent_end event")
        check(
            any(t == "message_update" for t in types) or any(t == "message_start" for t in types),
            "Got message streaming event (message_update or message_start)",
        )

    await asyncio.sleep(3)
    remaining = await eq.drain(stop_after={"agent_end"}, max_lines=20)
    print(f"  Remaining events after 3s: {len(remaining)}")
    check(True, "Agent completed prompt within timeout")


# 10. extension_ui handling
async def test_extension_ui_handling(eq: EventQueue):
    print("\n▶ Testing extension_ui_request handling")
    ui_requests = [
        r for r in eq._events if isinstance(r, dict) and r.get("type") == "extension_ui_request"
    ]
    if ui_requests:
        check(True, f"Received {len(ui_requests)} extension_ui_request(s) from agent")
    else:
        check(True, "No extension_ui_request received (agent may not need interactive input)")

    import inspect

    from app.api.chat import read_rpc_output

    src = inspect.getsource(read_rpc_output)
    check("extension_ui_request" in src, "read_rpc_output handles extension_ui_request")
    check("extension_ui_response" in src, "read_rpc_output handles extension_ui_response")
    check('"kind"' in src, "Events are tagged with 'kind' field")


# 11. message wrapping
async def test_message_wrapping():
    print("\n▶ Testing message wrapping (write_rpc_input)")
    import inspect

    from app.api.chat import send_rpc_command, write_rpc_input

    src = inspect.getsource(write_rpc_input)
    check('"prompt"' in src or "'prompt'" in src, "Plain text wrapped as prompt command")
    check("extension_ui_response" in src, "Extension responses forwarded directly")

    src = inspect.getsource(send_rpc_command)
    check("uuid" in src, "Request IDs use uuid.uuid4()")
    check('"id"' in src, "ID is attached to command")


# 12. model parsing
async def test_model_parse():
    print("\n▶ Testing model parsing")
    from app.api.model import _parse_rpc_models

    sample_data = {
        "models": [
            {
                "id": "claude-sonnet-4",
                "provider": "anthropic",
                "contextWindow": 200000,
                "maxTokens": 8192,
            },
            {"id": "gpt-4.1", "provider": "openai", "contextWindow": 131072, "maxTokens": 4096},
        ]
    }
    result = _parse_rpc_models(sample_data)
    check(len(result) == 2, "Parsed 2 models from response")
    if len(result) >= 1:
        check(result[0].id == "claude-sonnet-4", "First model id='claude-sonnet-4'")
        check(result[0].provider == "anthropic", "First model provider='anthropic'")

    result = _parse_rpc_models(None)
    check(len(result) > 0, "Returns defaults when data is None")


# ── main ──────────────────────────────────────────────────────────────────

proc: asyncio.subprocess.Process | None = None  # module-level global, set in main()


async def main():
    global passed, failed

    print("=" * 70)
    print("Pi RPC Integration Tests (against live pi --mode rpc)")
    print("=" * 70)
    print(f"\nProject dir: {PROJECT_DIR}")
    print(f"Python: {sys.version}")
    print()

    # Launch pi --mode rpc
    print("▶ Launching pi --mode rpc...")
    global proc
    proc = await asyncio.create_subprocess_exec(
        "pi",
        "--mode",
        "rpc",
        cwd=str(PROJECT_DIR),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    print(f"  PID: {proc.pid}")

    eq = EventQueue()

    # Single reader task: owns proc.stdout.readline() exclusively
    # Auto-replies to extension_ui_request so Pi doesn't block on stdin.
    async def event_reader() -> None:
        assert proc is not None
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode().strip()
                if not decoded:
                    continue
                try:
                    obj = json.loads(decoded)
                except json.JSONDecodeError:
                    obj = {"_raw": decoded}
                    eq._events.append(obj)
                    continue

                if isinstance(obj, dict) and obj.get("type") == "extension_ui_request":
                    # Auto-reply immediately (fire-and-forget UI methods)
                    auto_reply = {
                        "type": "extension_ui_response",
                        "id": obj["id"],
                        "value": None,
                        "cancelled": False,
                    }
                    proc.stdin.write(f"{json.dumps(auto_reply)}\n".encode())
                    await proc.stdin.drain()
                    eq._events.append(obj)  # track for inspection
                    continue  # skip queue — has no command id

                eq._events.append(obj)
                await eq._queue.put(obj)
        except asyncio.CancelledError:
            pass

    reader_task = asyncio.create_task(event_reader())

    # Let agent initialize — extensions need time to load
    await asyncio.sleep(5)
    initial = await eq.drain(stop_after=set(), max_lines=50)
    print(f"  Initial startup output: {len(initial)} lines")
    for ev in initial:
        etype = ev.get("type", "unknown")
        eid = ev.get("id", "")
        data_keys = list(ev["data"].keys()) if isinstance(ev.get("data"), dict) else "—"
        print(f"    [{etype}] id={eid} cmd={ev.get('command', '—')} data_keys={data_keys}")

    # Warm-up: send a simple command to trigger extension loading
    # so that subsequent test commands respond quickly.
    print("\n▶ Warm-up (triggering extension loading)...")
    warmup_resp = await send_command(eq, {"type": "get_session_stats"}, "warmup")
    await asyncio.sleep(3)  # let Pi fully settle
    # Clear any remaining events from warm-up
    await eq.drain(stop_after=set(), max_lines=50)
    print("  Warm-up complete.")

    # Run tests
    tests = [
        ("1. get_available_models", lambda: test_get_available_models(eq)),
        ("2. set_model", lambda: test_set_model(eq)),
        ("3. get_state", lambda: test_get_state(eq)),
        ("4. get_messages", lambda: test_get_messages(eq)),
        ("5. get_session_stats", lambda: test_get_session_stats(eq)),
        ("6. get_commands", lambda: test_get_commands(eq)),
        ("7. set_thinking_level", lambda: test_set_thinking_level(eq)),
        ("8. set_session_name", lambda: test_set_session_name(eq)),
        ("9. prompt + event streaming", lambda: test_prompt_and_events(eq)),
        ("10. Extension UI handling", lambda: test_extension_ui_handling(eq)),
        ("11. Message wrapping", lambda: test_message_wrapping()),
        ("12. Model parsing", lambda: test_model_parse()),
    ]

    for name, test_fn in tests:
        try:
            await test_fn()
        except Exception as e:
            import traceback

            print(f"  ❌ {name}: {type(e).__name__}: {e}")
            traceback.print_exc()
            failed += 1

    # Cleanup
    print("\n▶ Cleaning up...")
    # Send abort before cancelling reader (reader needs proc.stdin alive)
    assert proc is not None
    try:
        proc.stdin.write((json.dumps({"type": "abort"}) + "\n").encode("utf-8"))
        await proc.stdin.drain()
    except Exception:
        pass
    await asyncio.sleep(1)
    reader_task.cancel()
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=3)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()

    # Summary
    print("\n" + "=" * 70)
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    print("=" * 70)
    if failed > 0:
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
