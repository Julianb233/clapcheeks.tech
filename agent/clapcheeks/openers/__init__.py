"""Opener template library + scoring.

Data-backed opener formulas pulled from Hinge's 500k-conversation analysis
and VIDA Select's Observation+Question framework. See ``templates.yaml``
for the formula definitions and ``library.py`` for the picker + prompt
builder used by the AI opener pipeline.
"""
from clapcheeks.openers.library import (
    build_opener_prompt,
    load_templates,
    pick_formula,
    OpenerService,
)

__all__ = [
    "build_opener_prompt",
    "load_templates",
    "pick_formula",
    "OpenerService",
]
