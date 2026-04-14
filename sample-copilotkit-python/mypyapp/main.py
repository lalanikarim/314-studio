#!/usr/bin/env python3
"""
Sample CopilotKit Python Application

This application demonstrates how to interact with a CopilotKit server
using Python 3.13 and the requests library.
"""

import os
import json
import requests
from typing import Dict, Any, Optional, List
from dataclasses import dataclass


@dataclass
class AgentConfig:
    """Configuration for a CopilotKit agent."""

    name: str
    api_base: str = "http://localhost:8080"
    model: str = "gpt-4o-mini"


class CopilotKitClient:
    """
    A Python client for interacting with CopilotKit server
    via its REST API.
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.api_base = config.api_base.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        # Load JWT token if available from environment
        self.jwt_token = os.environ.get("COPILOTKIT_JWT_TOKEN")
        if self.jwt_token:
            self.headers["Authorization"] = f"Bearer {self.jwt_token}"

    def _make_request(
        self, method: str, endpoint: str, data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Make an HTTP request to the CopilotKit API."""
        url = f"{self.api_base}/{endpoint}"

        try:
            response = requests.request(
                method=method, url=url, headers=self.headers, json=data
            )

            response.raise_for_status()

            if response.status_code == 204:
                return {}

            # Type cast from Any to Dict[str, Any] since we know the response structure
            result: Dict[str, Any] = response.json()  # type: ignore[no-any-return]
            return result
        except requests.exceptions.RequestException as e:
            error_msg = f"API request failed: {str(e)}"
            if hasattr(e, "response") and e.response is not None:
                error_msg += (
                    f" Status: {e.response.status_code}, Content: {e.response.text}"
                )
            raise RuntimeError(error_msg) from e

    def run_agent(
        self, agent_id: str, messages: List[str], **kwargs: Any
    ) -> Dict[str, Any]:
        """
        Run a CopilotKit agent with the given messages.

        Args:
            agent_id: The ID of the agent to run
            messages: List of message strings
            **kwargs: Additional parameters to pass to the agent

        Returns:
            Dictionary containing the agent response and metadata
        """
        payload = {
            "agentId": agent_id,
            "messages": messages,
            "model": kwargs.get("model", self.config.model),
            "parameters": kwargs.get("parameters", {}),
        }

        return self._make_request("POST", "post", payload)

    def list_agents(self) -> List[Dict[str, Any]]:
        """
        List all available agents from the CopilotKit server.

        Returns:
            List of agent descriptions
        """
        result = self._make_request("GET", "agents")
        # Convert result to list since we expect a list of agents
        if isinstance(result, list):
            return result  # type: ignore[return-value]
        return [result]  # type: ignore[return-value]

    def get_agent_status(self, agent_id: str) -> Dict[str, Any]:
        """
        Get the status of a specific agent.

        Args:
            agent_id: The ID of the agent to check

        Returns:
            Agent status information
        """
        return self._make_request("GET", f"agents/{agent_id}")

    def get_conversation(self, conversation_id: str, limit: int = 50) -> Dict[str, Any]:
        """
        Get conversation history from the CopilotKit server.

        Args:
            conversation_id: The conversation ID to retrieve
            limit: Maximum number of messages to retrieve

        Returns:
            Conversation history
        """
        return self._make_request(
            "GET", f"conversations/{conversation_id}", {"limit": limit}
        )


class WeatherAgent:
    """
    Sample agent that fetches and processes weather data.
    This would typically be implemented in the CopilotKit server,
    but we'll simulate it here for demonstration.
    """

    def __init__(self, client: CopilotKitClient):
        self.client = client

    def get_weather(self, location: str) -> Dict[str, Any]:
        """
        Get weather information for a location using CopilotKit agent.

        Args:
            location: City or location name

        Returns:
            Weather information
        """
        result = self.client.run_agent(
            agent_id="weather",
            messages=[f"Get weather information for {location}"],
            model="gpt-4o-mini",
        )
        return result


class ChatAssistant:
    """
    Sample chat assistant that uses CopilotKit for conversation handling.
    """

    def __init__(
        self, client: CopilotKitClient, conversation_id: str = "demo-conversation"
    ):
        self.client = client
        self.conversation_id = conversation_id

    def send_message(self, message: str) -> Dict[str, Any]:
        """
        Send a message to the chat assistant.

        Args:
            message: The user's message

        Returns:
            The assistant's response
        """
        # In a real implementation, we'd pass the conversation_id
        result = self.client.run_agent(
            agent_id="chat-assistant",
            messages=[message],
            model="gpt-4o-mini",
            parameters={"conversationId": self.conversation_id},
        )
        return result

    def get_history(self, limit: int = 10) -> Dict[str, Any]:
        """
        Get the conversation history.

        Args:
            limit: Maximum number of messages to retrieve

        Returns:
            Conversation history
        """
        return self.client.get_conversation(self.conversation_id, limit)


def create_sample_agents() -> List[Dict[str, Any]]:
    """
    Create sample agent definitions for JSON export.

    Returns:
        List of agent definitions
    """
    return [
        {
            "id": "weather",
            "name": "Weather Information Agent",
            "description": "Provides weather information for locations",
            "model": "gpt-4o-mini",
            "capabilities": ["fetch_weather_data", "interpret_weather_codes"],
        },
        {
            "id": "chat-assistant",
            "name": "Chat Assistant",
            "description": "General purpose chat assistant",
            "model": "gpt-4o-mini",
            "capabilities": ["text_completion", "conversational_memory"],
        },
    ]


def save_agent_manifest(file_path: str, agents: List[Dict[str, Any]]) -> None:
    """
    Save agent definitions to a JSON file.

    Args:
        file_path: Path to the output file
        agents: List of agent definitions
    """
    with open(file_path, "w") as f:
        json.dump(agents, f, indent=2)


def main() -> None:
    """
    Main entry point for the sample application.
    """
    # Create agent configuration
    agent_config = AgentConfig(
        name="python-demo-agent", api_base="http://localhost:8080", model="gpt-4o-mini"
    )

    # Initialize CopilotKit client
    client = CopilotKitClient(agent_config)

    print(f"Initializing Python CopilotKit Client")
    print(f"Connected to: {agent_config.api_base}")
    print(f"Using model: {agent_config.model}")
    print()

    # Try to list available agents
    try:
        agents = client.list_agents()
        print(f"Available agents: {json.dumps(agents, indent=2)}")
    except Exception as e:
        print(f"Could not list agents (server may not be running): {e}")
        print("This is expected if CopilotKit server is not running locally.")
        print()

    # Create a weather agent
    weather_agent = WeatherAgent(client)

    # Simulate a weather query
    print("Sample weather query:")
    try:
        weather_result = weather_agent.get_weather("San Francisco")
        print(f"Weather results: {json.dumps(weather_result, indent=2)}")
    except Exception as e:
        print(f"Weather query failed (expected if server not running): {e}")

    print()

    # Create a chat assistant
    chat_assistant = ChatAssistant(client)

    print("Sample chat interaction:")
    try:
        response = chat_assistant.send_message("What is CopilotKit?")
        print(f"Chat response: {json.dumps(response, indent=2)}")
    except Exception as e:
        print(f"Chat query failed (expected if server not running): {e}")

    # Create sample agent manifest
    print("\nCreating sample agent manifest...")
    agents = create_sample_agents()
    save_agent_manifest("sample_agents.json", agents)
    print(f"Agent manifest saved to sample_agents.json")

    print("\nSample application completed!")
    print("To use with a real CopilotKit server, run:")
    print("  npx copilotkit@latest server")
    print()
    print("Then set COPILOTKIT_JWT_TOKEN environment variable for authentication.")


if __name__ == "__main__":
    main()
