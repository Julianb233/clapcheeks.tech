"""Clapcheeks conversation engine.

Phase 41 (AI-8326) Conversation Intelligence:
    analyzer.analyze_conversation(messages) -> ConversationAnalysis
    strategy.generate_strategy(profile, messages, analysis=None) -> ConversationStrategy
    strategy.render_strategy_for_prompt(strategy) -> str
    red_flags.detect_red_flags(messages) -> list[RedFlag]
    red_flags.red_flag_summary(flags) -> dict
"""
from clapcheeks.conversation import analyzer, red_flags, strategy  # noqa: F401

__all__ = ["analyzer", "strategy", "red_flags"]
