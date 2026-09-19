from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
import aiosqlite


class ShortTermMemory:
    """LangGraph conversation checkpointer backed by SQLite.

    Persists conversation history per thread. Same thread_id = continue
    the conversation. New thread_id = fresh conversation. Survives restarts.
    """

    def __init__(self, db_path: str = "data/checkpoints.db"):
        self.db_path = db_path
        self._checkpointer = None

    async def get_checkpointer(self):
        """Create or return the async SQLite checkpointer."""
        if self._checkpointer is None:
            conn = await aiosqlite.connect(self.db_path)
            self._checkpointer = AsyncSqliteSaver(conn)
            await self._checkpointer.setup()
        return self._checkpointer

    @staticmethod
    def get_thread_config(user_id: str, thread_id: str = None) -> dict:
        """Build the config dict that LangGraph uses to track conversations."""
        if thread_id is None:
            thread_id = f"thread_{user_id}"
        return {
            "configurable": {
                "thread_id": thread_id,
                "user_id": user_id,
            }
        }