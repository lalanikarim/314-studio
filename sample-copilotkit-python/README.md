# sample-copilotkit-python

A sample CopilotKit application built with Python 3.13 using uv.

## Overview

This project demonstrates how to integrate a Python application with CopilotKit's REST API to create AI-powered agents.

## Key Features

- **CopilotKit Client**: Python client for interacting with CopilotKit REST API
- **Weather Agent**: Sample agent for weather information retrieval
- **Chat Assistant**: Sample chat interface using CopilotKit
- **Agent Manifest**: JSON schema for defining agents

## Prerequisites

- Python 3.13
- uv (Python package manager)
- CopilotKit server (optional, for full integration)

## Installation

1. Install dependencies:
```bash
uv sync
```

2. Run the sample application:
```bash
python -m mypyapp.main
```

## CopilotKit Server Setup

To run with a real CopilotKit server:

1. Install CopilotKit:
```bash
npm install @copilotkit/runtime @copilotkit/server @copilotkit/ui
```

2. Start the server:
```bash
npx copilotkit@latest server
```

3. Set authentication token:
```bash
export COPILOTKIT_JWT_TOKEN=your_token_here
```

## Developer Commands

- **Run application**: `python -m mypyapp.main`
- **Run tests**: `pytest tests/`
- **Type checking**: `mypy mypyapp/`
- **Linting**: `ruff check mypyapp/`
- **Formatting**: `ruff format mypyapp/`

## Architecture

The application follows these patterns:

1. **Client Pattern**: CopilotKitClient handles API communication
2. **Agent Pattern**: Specialized agents (WeatherAgent, ChatAssistant)
3. **Configuration Pattern**: AgentConfig for centralized settings

## Running the Application

```bash
# Run with default settings
python -m mypyapp.main

# With custom CopilotKit server URL
COPILOTKIT_API_URL=https://your-server.example.com python -m mypyapp.main

# With authentication
COPILOTKIT_JWT_TOKEN=your_token_here python -m mypyapp.main
```

## CopilotKit Integration Points

This sample demonstrates integration with these CopilotKit features:

- **REST API**: POST /post endpoint for agent execution
- **Agent Lifecycle**: run_agent method for agent orchestration
- **Conversation Management**: get_conversation for history
- **JWT Authentication**: Bearer token support

## Agent Definitions

The application creates sample agent definitions for:

- **weather**: Weather information provider
- **chat-assistant**: General purpose chat assistant

These are exported to sample_agents.json for reference.

## Contributing

Contributions are welcome! Please follow the existing code style and add tests for new features.

## License

MIT License - see LICENSE file.
