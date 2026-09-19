import os
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

load_dotenv()

PROVIDERS = {
    "anthropic": ChatAnthropic,
    "openai": ChatOpenAI,
    "ollama": ChatOllama,
}


class ModelFactory:
    """Factory for creating LangChain chat models. The Model Money Saver Pattern.

    Routes between smart (Claude/GPT-4) and cheap (Mistral/Ollama) models
    at runtime. Because not every agent deserves a premium brain.

    Usage:
        from agentkit import ModelFactory

        factory = ModelFactory()
        supervisor_llm = factory.smart()       # Claude/GPT-4
        gift_card_llm = factory.cheap()        # Mistral via Ollama
        custom = factory.create("openai", "gpt-4o-mini")
    """

    def __init__(self, default_provider: str = None, default_model: str = None):
        self.default_provider = default_provider or os.getenv("DEFAULT_MODEL_PROVIDER", "anthropic")
        self.default_model = default_model or os.getenv("DEFAULT_MODEL_NAME", "claude-sonnet-4-6")

    def get_model(self, provider: str = None, model: str = None, **kwargs):
        provider = provider or self.default_provider
        model = model or self.default_model

        model_class = PROVIDERS.get(provider)
        if not model_class:
            raise ValueError(f"Unsupported provider: {provider}, supported: {list(PROVIDERS.keys())}")

        return model_class(model=model, **kwargs)

    def smart(self, **kwargs):
        """High-quality model for tasks that need thinking."""
        return self.get_model(**kwargs)

    def cheap(self, provider: str = None, model: str = None, **kwargs):
        """Low-cost model for simple lookups and ranking.
        Uses CHEAP_MODEL_PROVIDER/CHEAP_MODEL_NAME env vars, falls back to ollama/mistral locally."""
        provider = provider or os.getenv("CHEAP_MODEL_PROVIDER", "anthropic")
        model = model or os.getenv("CHEAP_MODEL_NAME", "claude-sonnet-4-6")
        return self.get_model(provider=provider, model=model, **kwargs)

    def create(self, provider: str, model: str, **kwargs):
        """Explicit provider/model pair."""
        return self.get_model(provider=provider, model=model, **kwargs)