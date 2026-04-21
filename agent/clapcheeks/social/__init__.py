"""Social-signal helpers (Phase C - AI-8317).

Public surface:
    - ig_handle.extract_ig_handles(text) -> list[str]
    - ig_parser.parse_ig_user_feed(raw) -> dict
    - ig_parser.aggregate_ig_intel(parsed) -> str
"""
from clapcheeks.social.ig_handle import extract_ig_handles  # noqa: F401
from clapcheeks.social.ig_parser import (  # noqa: F401
    aggregate_ig_intel,
    parse_ig_user_feed,
)
