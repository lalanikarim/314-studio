# Pi Session & Model Management Knowledge Base

## Overview

This knowledge base documents how the Pi coding agent handles **existing sessions** and **existing models**, including session selection, model selection, and related workflows in RPC mode.

---

## Table of Contents

1. [Existing Sessions and Session Selection](#existing-sessions-and-session-selection)
   - [Session Lifecycle](#session-lifecycle)
   - [Key Session Management Commands](#key-session-management-commands)
   - [Session Switching](#session-switching)
   - [Session Forking](#session-forking)
   - [Session Naming](#session-naming)
   - [Parent Session Tracking](#parent-session-tracking)

2. [Existing Models and Model Selection](#existing-models-and-model-selection)
   - [Model Management Commands](#model-management-commands)
   - [Model Object Structure](#model-object-structure)
   - [Model Selection Examples](#model-selection-examples)
   - [Thinking Levels](#thinking-levels)

3. [Best Practices](#best-practices)

---

# Existing Sessions and Session Selection

## Session Lifecycle

Sessions are the persistent conversation state of the Pi agent. Each session is:
- Stored as a JSONL file
- Contains all conversation history
- Tracks model state, thinking levels, and metadata
- Can be named for easy identification

## Key Session Management Commands

| Command | Description | Returns |
|---|---|---|
| `get_state` | Returns current session state including `sessionFile`, `sessionId`, and `sessionName` | Session metadata |
| `get_session_stats` | Shows token usage, costs, and context window for current session | Usage statistics |
| `new_session` | Starts a fresh session (optionally with parent session tracking) | Success flag |
| `switch_session` | Loads a different session file (can be cancelled by extensions) | Success flag with cancellation status |
| `fork` | Creates a new session from a specific message in current session | Original message text |
| `set_session_name` | Sets a display name for current session | Success flag |
| `get_messages` | Gets all messages in the conversation | Array of messages |
| `get_fork_messages` | Lists user messages available for forking | Array of forkable messages |
| `export_html` | Exports session to an HTML file | File path |

## Session Switching

Switch to a different session file:

```json
{
  "type": "switch_session",
  "sessionPath": "/path/to/session.jsonl"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "switch_session",
  "success": true,
  "data": {
    "cancelled": false
  }
}
```

If an extension cancels the switch:
```json
{
  "type": "response",
  "command": "switch_session",
  "success": true,
  "data": {
    "cancelled": true
  }
}
```

## Session Forking

Create a new session starting from a specific message in the current session:

```json
{
  "type": "fork",
  "entryId": "abc123"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "fork",
  "success": true,
  "data": {
    "text": "The original prompt text...",
    "cancelled": false
  }
}
```

Get available messages for forking:
```json
{
  "type": "get_fork_messages"
}
```

## Session Naming

Set a display name for the current session:

```json
{
  "type": "set_session_name",
  "name": "my-feature-work"
}
```

The current session name is available via `get_state` in the `sessionName` field.

## Parent Session Tracking

Create a new session that references a parent session:

```json
{
  "type": "new_session",
  "parentSession": "/path/to/parent-session.jsonl"
}
```

This is useful for maintaining a hierarchy of related sessions or for debugging purposes.

---

# Existing Models and Model Selection

## Model Management Commands

| Command | Description | Returns |
|---|---|---|
| `get_available_models` | Lists all configured models with full details | Array of model objects |
| `set_model` | Switches to a specific model (`provider` + `modelId`) | Success flag with model object |
| `cycle_model` | Cycles through available models | Next model object or null |
| `set_thinking_level` | Configures reasoning level for models that support it | Success flag |
| `cycle_thinking_level` | Cycles through thinking levels | Current thinking level |

## Model Object Structure

Each model is represented as a JSON object with comprehensive metadata:

```json
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "api": "anthropic-messages",
  "provider": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 200000,
  "maxTokens": 16384,
  "cost": {
    "input": 3.0,
    "output": 15.0,
    "cacheRead": 0.3,
    "cacheWrite": 3.75
  }
}
```

**Key fields:**
- `id`: Unique model identifier
- `name`: Human-readable name
- `api`: API type (e.g., "anthropic-messages", "openai-chat")
- `provider`: Provider name (e.g., "anthropic", "openai", "google")
- `baseUrl`: API endpoint URL
- `reasoning`: Whether model supports reasoning/thinking
- `input`: Supported input types ("text", "image")
- `contextWindow`: Maximum context window in tokens
- `maxTokens`: Maximum output tokens
- `cost`: Per-token costs for input/output/cache read/write

## Model Selection Examples

### Switch to specific model

```json
{
  "type": "set_model",
  "provider": "anthropic",
  "modelId": "claude-sonnet-4-20250514"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "set_model",
  "success": true,
  "data": {
    "model": {
      "id": "claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      /* ... full model object ... */
    }
  }
}
```

### Cycle to next model

```json
{
  "type": "cycle_model"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "cycle_model",
  "success": true,
  "data": {
    "model": {
      "id": "claude-instant-1-2-20240227",
      "name": "Claude Instant",
      /* ... full model object ... */
    },
    "thinkingLevel": "medium",
    "isScoped": false
  }
}
```

### List available models

```json
{
  "type": "get_available_models"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "get_available_models",
  "success": true,
  "data": {
    "models": [
      {
        "id": "claude-sonnet-4-20250514",
        "name": "Claude Sonnet 4",
        /* ... model details ... */
      },
      {
        "id": "claude-instant-1-2-20240227",
        "name": "Claude Instant",
        /* ... model details ... */
      }
    ]
  }
}
```

## Thinking Levels

Configurable reasoning levels for models that support thinking:

```json
{
  "type": "set_thinking_level",
  "level": "high"
}
```

**Available levels:**
- `"off"` - No reasoning
- `"minimal"` - Minimal reasoning
- `"low"` - Low reasoning
- `"medium"` - Medium reasoning (default)
- `"high"` - High reasoning
- `"xhigh"` - Extra high reasoning (only supported by OpenAI codex-max models)

Cycle through thinking levels:

```json
{
  "type": "cycle_thinking_level"
}
```

**Response:**
```json
{
  "type": "response",
  "command": "cycle_thinking_level",
  "success": true,
  "data": {
    "level": "high"
  }
}
```

---

# Best Practices

## Session Management

1. **Check current session state** before making changes:
   ```json
   { "type": "get_state" }
   ```

2. **Use session names** to identify sessions easily:
   ```json
   { "type": "set_session_name", "name": "debug-auth-issue" }
   ```

3. **Fork strategically** to create isolated branches for experiments:
   ```json
   { "type": "fork", "entryId": "abc123" }
   ```

4. **Track parent sessions** when creating related sessions:
   ```json
   { "type": "new_session", "parentSession": "/path/to/parent.jsonl" }
   ```

5. **Export sessions** periodically for backup and analysis:
   ```json
   { "type": "export_html" }
   ```

## Model Selection

1. **List available models** before switching:
   ```json
   { "type": "get_available_models" }
   ```

2. **Cycle through models** to find the best fit for your task:
   ```json
   { "type": "cycle_model" }
   ```

3. **Consider context window** when choosing models:
   ```json
   { "type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }
   ```

4. **Adjust thinking levels** based on task complexity:
   ```json
   { "type": "set_thinking_level", "level": "medium" }
   ```

5. **Store model preferences** in your integration to restore state:
   ```json
   {
     "currentModel": {
       "provider": "anthropic",
       "modelId": "claude-sonnet-4-20250514",
       "thinkingLevel": "medium"
     }
   }
   ```

---

## Related Documentation

- [Pi RPC Protocol Documentation](../docs/rpc.md) - Full RPC protocol specification
- [Session Management Guide](../docs/session.md) - Comprehensive session management
- [Model Configuration Guide](../docs/models.md) - Model setup and configuration

---

*Last updated: 2026-04-14*
