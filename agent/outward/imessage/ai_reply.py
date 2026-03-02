"""Local Ollama reply generator — all inference stays on-device."""
from __future__ import annotations

import logging

from outward.config import load as load_config

logger = logging.getLogger(__name__)


class ReplyGenerator:
    """Generate reply suggestions using local Ollama models only."""

    def __init__(self, model: str | None = None, style_prompt: str = "") -> None:
        config = load_config()
        self.model = model or config.get("ai_model", "llama3.2")
        self.style_prompt = style_prompt

    def suggest_reply(
        self,
        conversation: list[dict],
        contact_name: str = "",
        temperature: float = 0.7,
    ) -> str:
        """Generate a single reply suggestion via local Ollama.

        All inference runs on localhost:11434 — no data leaves the device.
        """
        try:
            import ollama
        except ImportError:
            return "Error: ollama package not installed. Run: pip install ollama"

        system_prompt = (
            "You are a dating conversation assistant. Generate a reply "
            "that the user would send. "
            f"{self.style_prompt}. "
            "Reply with ONLY the message text, no quotes, no explanation. "
            "Keep it natural and conversational."
        )
        if contact_name:
            system_prompt += f" The user is texting {contact_name}."

        # Build message history from last 10 messages
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for msg in conversation[-10:]:
            role = "assistant" if msg.get("is_from_me") else "user"
            text = msg.get("text", "")
            if text:
                messages.append({"role": role, "content": text})

        try:
            response = ollama.chat(
                model=self.model,
                messages=messages,
                options={"temperature": temperature},
            )
            return response["message"]["content"].strip()
        except ConnectionError:
            return "Ollama not running. Start it with: ollama serve"
        except Exception as exc:
            logger.error("Ollama chat failed: %s", exc)
            return f"Error generating reply: {exc}"

    def suggest_multiple(
        self,
        conversation: list[dict],
        contact_name: str = "",
        count: int = 3,
    ) -> list[str]:
        """Generate multiple reply options with varying temperature."""
        temperatures = [0.7, 0.9, 1.1]
        results: list[str] = []
        for i in range(count):
            temp = temperatures[i] if i < len(temperatures) else 0.9
            reply = self.suggest_reply(conversation, contact_name, temperature=temp)
            results.append(reply)
        return results
