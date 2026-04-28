"""Clapcheeks voice cloning — chat.db scanner + style digest for few-shot prompting.

AI-8763: highest-impact research item — kill 'AI voice' tells at the
prompt-engineering layer by feeding the LLM real samples of the operator's
past sends, plus a numeric style fingerprint. Belt-and-suspenders with the
existing P2 anti-voice guards and the older voice.py / nlp/style_analyzer.py
heuristic stacks.
"""
from __future__ import annotations

from clapcheeks.voice.clone import (  # noqa: F401
    DIGEST_PATH,
    compute_style_digest,
    load_digest,
    save_digest,
    scan_operator_sends,
)
