"""Clapcheeks AI — drafters + persona + voice pipeline.

Public API:
    drafter.run_pipeline(raw_text, persona=None, user_id=None) -> DraftResult
    drafter.inject_persona_into_system_prompt(base_system, persona, user_id) -> str
    persona_loader.load_persona(user_id) -> dict
    sanitizer.sanitize_draft(text) -> str
    sanitizer.validate_draft(text, persona) -> (ok, errors)
    splitter.split_draft_into_messages(text) -> list[str]

PHASE-E - AI-8319
"""
from clapcheeks.ai import drafter, persona_loader, sanitizer, splitter  # noqa: F401
