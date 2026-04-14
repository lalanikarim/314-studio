"""
Test cases for the CopilotKit Python client.
"""

import json
import os
from unittest.mock import patch

from mypyapp.main import ChatAssistant, CopilotKitClient, WeatherAgent


def test_copilotkit_client_initialization():
    """Test that the CopilotKit client initializes correctly."""
    from mypyapp.main import AgentConfig

    config = AgentConfig(name="test-agent", api_base="http://test.com", model="gpt-4")
    client = CopilotKitClient(config)

    assert client.config == config
    assert client.api_base == "http://test.com"
    assert client.headers["Content-Type"] == "application/json"
    assert "Authorization" not in client.headers  # No token by default


def test_copilotkit_client_with_jwt():
    """Test that the client includes JWT token when provided."""
    from mypyapp.main import AgentConfig

    with patch.dict(os.environ, {"COPILOTKIT_JWT_TOKEN": "test-token"}):
        config = AgentConfig(name="test-agent", api_base="http://test.com")
        client = CopilotKitClient(config)

        assert "Authorization" in client.headers
        assert client.headers["Authorization"] == "Bearer test-token"


def test_agent_creation():
    """Test that agents can be created with the client."""
    from mypyapp.main import AgentConfig

    config = AgentConfig(name="test-agent")
    client = CopilotKitClient(config)

    weather_agent = WeatherAgent(client)
    assert weather_agent.client == client

    chat_assistant = ChatAssistant(client)
    assert chat_assistant.client == client
    assert chat_assistant.conversation_id == "demo-conversation"


def test_sample_agents_format():
    """Test that sample agents are properly formatted."""
    from mypyapp.main import create_sample_agents

    agents = create_sample_agents()

    assert len(agents) == 2
    assert agents[0]["id"] == "weather"
    assert agents[0]["name"] == "Weather Information Agent"
    assert agents[1]["id"] == "chat-assistant"
    assert "capabilities" in agents[0]
    assert "capabilities" in agents[1]


def test_save_agent_manifest():
    """Test that agent manifest can be saved and loaded."""
    from mypyapp.main import create_sample_agents, save_agent_manifest

    agents = create_sample_agents()
    save_agent_manifest("test_agents.json", agents)

    # Load and verify
    with open("test_agents.json") as f:
        loaded_agents = json.load(f)

    assert loaded_agents == agents

    # Cleanup
    os.remove("test_agents.json")


def test_error_handling_in_request():
    """Test that API errors are properly handled."""
    from mypyapp.main import AgentConfig, CopilotKitClient

    config = AgentConfig(name="test-agent", api_base="http://nonexistent.test")
    client = CopilotKitClient(config)

    try:
        client.list_agents()
        assert False, "Should have raised an exception"
    except RuntimeError as e:
        assert "API request failed" in str(e)


def test_python_version_compatibility():
    """Test that the code runs with Python 3.13 syntax."""
    import sys

    assert sys.version_info >= (3, 13, 0), "This code requires Python 3.13+"


if __name__ == "__main__":
    test_copilotkit_client_initialization()
    test_copilotkit_client_with_jwt()
    test_agent_creation()
    test_sample_agents_format()
    test_save_agent_manifest()
    test_error_handling_in_request()
    test_python_version_compatibility()
    print("All tests passed!")
