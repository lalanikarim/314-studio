"""
Model API endpoints for managing available models.
"""

from typing import List

from fastapi import APIRouter

from ..schemas import ModelConfig

router = APIRouter()

# Available models (this would typically come from a config or database)
AVAILABLE_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="claude-sonnet-4-20250514",
        provider="anthropic",
        contextWindow=200000,
        maxTokens=16384,
    ),
    ModelConfig(id="gpt-4.1", provider="openai", contextWindow=131072, maxTokens=16384),
    ModelConfig(id="deepseek-coder", provider="deepseek", contextWindow=65536, maxTokens=16384),
]


@router.get("/", response_model=List[ModelConfig])
async def list_models() -> List[ModelConfig]:
    """
    List all available models.
    """
    return AVAILABLE_MODELS


@router.post("/{session_id}/model")
async def switch_model(session_id: str, model_id: str) -> dict:
    """
    Switch model for a session.
    """
    # Find the model
    model = next((m for m in AVAILABLE_MODELS if m.id == model_id), None)

    if not model:
        return {"error": "Model not found"}

    # In a real implementation, this would update the session
    # For now, just return success
    return {"message": "Model switched successfully", "model": model}
