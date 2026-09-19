import json
from pathlib import Path

from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from agentkit.model_factory import ModelFactory
from agentkit.logging.logger_config import setup_logger

_LOG_DIR = str(Path(__file__).parent.parent.parent / "logs")


class BaseAgent:
    """Reusable LLM agent with ReAct tool-calling loop."""

    def __init__(self, name: str, system_prompt: str, tools: list, use_smart: bool = True):
        self.name = name
        self.system_prompt = system_prompt
        self.logger = setup_logger(f"agent.{name}", log_dir=_LOG_DIR, console=True, file=True)
        factory = ModelFactory()
        self.llm = factory.smart() if use_smart else factory.cheap()
        self.tools = tools
        self.llm_with_tools = self.llm.bind_tools(tools) if tools else self.llm
        self._tool_map = {t.name: t for t in tools} if tools else {}

        self.logger.info(f"Initialized with {'smart' if use_smart else 'cheap'} model, {len(tools)} tools")

    async def run(self, user_message: str, context: str = "") -> str:
        """Run the agent's ReAct loop and return the final text response."""
        self.logger.info(f"Running: {user_message}")

        full_prompt = self.system_prompt
        if context:
            full_prompt += f"\n\n--- CONTEXT FROM SUPERVISOR ---\n{context}"

        messages = [
            SystemMessage(content=full_prompt),
            HumanMessage(content=user_message),
        ]
        
        self.logger.info(f"FULL PROMPT:\n{'='*60}\n{full_prompt}\n---\nUser: {user_message}\n{'='*60}")


        for iteration in range(5):
            self.logger.info(f"ReAct iteration {iteration + 1}")
            response = self.llm_with_tools.invoke(messages)
            messages.append(response)

            if not response.tool_calls:
                self.logger.info(f"Final response ({len(response.content)} chars)")
                return response.content

            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                self.logger.info(f"Calling tool: {tool_name}({json.dumps(tool_call['args'])})")
                tool_fn = self._tool_map[tool_name]
                result = await tool_fn.ainvoke(tool_call["args"])
                self.logger.info(f"Tool {tool_name} returned ({len(str(result))} chars)")
                messages.append(ToolMessage(content=result, tool_call_id=tool_call["id"]))

        # Max iterations reached — force a final answer without tools
        self.logger.warning("Hit max iterations (5), forcing final answer")
        final_response = self.llm.invoke(messages)
        return final_response.content if final_response.content else "Could not complete request."