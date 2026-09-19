import httpx
import uuid
from pathlib import Path
from agentkit.logging.logger_config import setup_logger

_LOG_DIR = str(Path(__file__).parent.parent.parent / "logs")
logger = setup_logger("a2a_client", log_dir=_LOG_DIR, console=True, file=True)


class A2AClient:
    """Generic client for communicating with any A2A agent provider.

    Discovers agent capabilities via Agent Cards, sends tasks via JSON-RPC,
    and returns artifacts. Pure HTTP — no shared code with providers.
    """

    def __init__(self, providers: dict[str, str] = None):
        """
        Args:
            providers: mapping of provider name to base URL
                        e.g. {"travel": "http://localhost:9001",
                            "gift_cards": "http://localhost:9002"}
        """
        self.providers = providers or {}
        self._agent_cards: dict[str, dict] = {}
        self._client = httpx.AsyncClient(timeout=120.0)

    def register(self, name: str, base_url: str):
        """Register a new A2A provider at runtime."""
        self.providers[name] = base_url

    async def discover(self, provider_name: str) -> dict:
        """Fetch the Agent Card from a provider's well-known endpoint."""
        base_url = self.providers[provider_name]
        url = f"{base_url}/.well-known/agent.json"
        logger.info(f"Discovering agent card: {url}")

        response = await self._client.get(url)
        response.raise_for_status()
        card = response.json()
        self._agent_cards[provider_name] = card
        logger.info(f"Discovered: {card['name']} — {len(card.get('skills', []))} skills")
        return card

    async def discover_all(self) -> dict[str, dict]:
        """Discover all registered providers. Returns dict of agent cards."""
        cards = {}
        for name in self.providers:
            try:
                cards[name] = await self.discover(name)
            except Exception as e:
                logger.warning(f"Failed to discover {name}: {e}")
        return cards

    async def send_task(self, provider_name: str, message: str) -> dict:
        """Send a task to an A2A provider and return the response.

        Args:
            provider_name: key from self.providers (e.g. "travel")
            message: natural language request for the agent

        Returns:
            Full A2A response dict with id, status, and artifacts
        """
        base_url = self.providers[provider_name]
        url = f"{base_url}/a2a"
        task_id = str(uuid.uuid4())

        payload = {
            "id": task_id,
            "message": {
                "role": "user",
                "parts": [{"type": "text", "text": message}],
            },
        }

        logger.info(f"Sending task to {provider_name}: {message}...")
        response = await self._client.post(url, json=payload)
        response.raise_for_status()
        result = response.json()

        state = result.get("status", {}).get("state", "unknown")
        logger.info(f"Task {task_id} → {state}")

        if state == "failed":
            error_msg = result.get("status", {}).get("message", "Unknown error")
            logger.error(f"Task failed: {error_msg}")

        return result

    @staticmethod
    def extract_text(response: dict) -> str:
        """Pull the text content out of an A2A response's artifacts."""
        artifacts = response.get("artifacts", [])
        texts = []
        for artifact in artifacts:
            for part in artifact.get("parts", []):
                if part.get("type") == "text":
                    texts.append(part["text"])
        return "\n".join(texts) if texts else ""

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()

    async def send_task_and_extract(self, provider_name: str, message: str) -> str:
        """Send a task and return just the text content."""
        response = await self.send_task(provider_name, message)
        return self.extract_text(response)