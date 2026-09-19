import json
from pathlib import Path
from datetime import datetime


class LongTermMemory:
    """Persistent long-term memory for any agent.

    Three memory types:
    - Semantic: facts about the user (family, preferences, cards)
    - Episodic: past interactions and events
    - Procedural: communication preferences (tables vs prose, etc.)

    Stored as JSON, keyed by user_id.

    Usage:
        from agentkit import LongTermMemory

        memory = LongTermMemory("data/memory.json")
        memory.save_semantic("user_001", "home_airport", "LAX")
        memory.save_episode("user_001", "Planned Hawaii trip")
        print(memory.format_for_prompt("user_001"))
    """

    def __init__(self, memory_path: str = "data/memory.json"):
        self._path = Path(memory_path)
        self._memory = self._load()

    def _load(self) -> dict:
        if self._path.exists():
            with open(self._path, "r") as f:
                return json.load(f)
        return {}

    def _save(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._memory, f, indent=2)

    def _ensure_user(self, user_id: str):
        if user_id not in self._memory:
            self._memory[user_id] = {
                "semantic": {},
                "episodic": [],
                "procedural": {},
            }

    # --- Semantic Memory (facts about the user) ---

    def get_semantic(self, user_id: str) -> dict:
        self._ensure_user(user_id)
        return self._memory[user_id]["semantic"]

    def save_semantic(self, user_id: str, key: str, value: str):
        self._ensure_user(user_id)
        self._memory[user_id]["semantic"][key] = value
        self._save()

    def save_semantic_batch(self, user_id: str, data: dict) -> bool:
        """Bulk update semantic memory. Only writes to disk if something changed.
        Returns True if memory was updated, False if already up-to-date."""
        self._ensure_user(user_id)
        current = self._memory[user_id]["semantic"]
        dirty = False
        for key, value in data.items():
            if current.get(key) != value:
                current[key] = value
                dirty = True
        if dirty:
            self._save()
        return dirty

    # --- Episodic Memory (past interactions) ---

    def get_episodes(self, user_id: str, limit: int = 10) -> list[dict]:
        self._ensure_user(user_id)
        return self._memory[user_id]["episodic"][-limit:]

    def save_episode(self, user_id: str, summary: str, tags: list[str] = None):
        self._ensure_user(user_id)
        episode = {
            "timestamp": datetime.now().isoformat(),
            "summary": summary,
            "tags": tags or [],
        }
        self._memory[user_id]["episodic"].append(episode)
        self._save()

    # --- Procedural Memory (how the user likes to interact) ---

    def get_procedural(self, user_id: str) -> dict:
        self._ensure_user(user_id)
        return self._memory[user_id]["procedural"]

    def save_procedural(self, user_id: str, key: str, value: str):
        self._ensure_user(user_id)
        self._memory[user_id]["procedural"][key] = value
        self._save()

    # --- Convenience ---

    def get_all(self, user_id: str) -> dict:
        self._ensure_user(user_id)
        return self._memory[user_id]

    def format_for_prompt(self, user_id: str) -> str:
        """Format all long-term memory into a string for prompt injection."""
        mem = self.get_all(user_id)
        parts = []

        if mem["semantic"]:
            parts.append("WHAT I KNOW ABOUT YOU:")
            for key, value in mem["semantic"].items():
                parts.append(f"  - {key}: {value}")

        if mem["episodic"]:
            parts.append("\nPAST INTERACTIONS:")
            for ep in mem["episodic"][-5:]:
                parts.append(f"  - [{ep['timestamp'][:10]}] {ep['summary']}")

        if mem["procedural"]:
            parts.append("\nYOUR PREFERENCES:")
            for key, value in mem["procedural"].items():
                parts.append(f"  - {key}: {value}")

        return "\n".join(parts) if parts else "No prior memory for this user."