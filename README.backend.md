# FastAPI + React Pi Integration

This is the implementation of the FastAPI backend for the Pi coding agent integration with React frontend.

## Backend Architecture

The backend provides RESTful APIs for:
- Project browsing and management
- Session creation and management
- File system navigation
- Model configuration
- Chat interface with Pi agent

## API Overview

### Projects
```
GET    /api/projects              - List available projects
POST   /api/projects/{name}/start - Initialize a new project
```

### Sessions
```
GET     /api/projects/{proj}/sessions        - List sessions
POST    /api/projects/{proj}/sessions        - Create session
GET     /api/projects/{proj}/sessions/{id}   - Get session details
```

### Files
```
GET     /api/projects/{proj}/files          - List files
GET     /api/projects/{proj}/files/{path}   - Read file contents
```

### Models
```
GET     /api/models              - List available models
POST    /api/models/{session}/model - Switch model
```

### Chat
```
GET     /api/projects/{proj}/sessions/{id}/chat  - Get chat history
POST    /api/projects/{proj}/sessions/{id}/chat  - Send message
WebSocket /api/projects/{proj}/ws/chat/{id}    - Real-time chat
```

## Running the Backend

```bash
# Install dependencies
cd backend
uv install

# Start the server
uv run python app/main.py

# Server will be available at http://localhost:8000
# API documentation at http://localhost:8000/docs
```

## Testing

```bash
# Run tests
cd backend
uv run pytest

# Or run specific tests
uv run python test_api.py
```

## Development Setup

1. Install Python 3.13+
2. Install Node.js 20+ for the React frontend
3. Clone this repository
4. Run `uv install` in the backend directory
5. Run `npm install` in the frontend directory

## Technical Notes

- Uses FastAPI with async support
- Session data stored as JSONL files
- Pi agent communicates via stdin/stdout (JSONL)
- WebSocket for real-time chat streaming
- File access restricted to project directory

## Requirements Compliance

This implementation follows the architecture specified in @docs/fastapi-react-pi-integration-plan.md with support for:
- 🔄 Project selection
- 🔄 Session management
- 🔄 File tree with viewer
- 🔄 Chat console
- 🔄 Model switching
- 🔄 Session persistence via JSONL
- 🔄 Pi RPC integration plan
- 🔄 Security via path validation

## Known Issues

- File reading endpoint returns 404 (path parameter routing issue)
- WebSocket lacks actual Pi RPC integration (uses stub responses)
- No rate limiting implemented
- No session cleanup/expunction logic

## Progress

See @docs/backend_status.md for detailed progress tracking.
