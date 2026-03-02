"""Profile dataclass and JSON persistence for dating preferences."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

PROFILE_DIR = Path.home() / ".clapcheeks"
PROFILE_PATH = PROFILE_DIR / "profile.json"


@dataclass
class Profile:
    name: str = ""
    age: int = 0
    location: str = ""
    looking_for: str = ""
    bio_summary: str = ""
    pref_age_min: int = 18
    pref_age_max: int = 99
    pref_max_distance_miles: int = 25
    pref_traits: list[str] = field(default_factory=list)
    dealbreakers: list[str] = field(default_factory=list)
    convo_style: str = "balanced"
    topics_to_avoid: list[str] = field(default_factory=list)
    updated_at: str = ""


def load_profile() -> Profile:
    """Load profile from disk. Returns defaults if missing or corrupt."""
    try:
        data = json.loads(PROFILE_PATH.read_text())
        return Profile(**{k: v for k, v in data.items() if k in {f.name for f in Profile.__dataclass_fields__.values()}})
    except Exception:
        return Profile()


def save_profile(profile: Profile) -> None:
    """Save profile to disk with updated timestamp."""
    profile.updated_at = datetime.now(timezone.utc).isoformat()
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_PATH.write_text(json.dumps(asdict(profile), indent=2))


def profile_exists() -> bool:
    """Check if a valid profile file exists."""
    try:
        json.loads(PROFILE_PATH.read_text())
        return True
    except Exception:
        return False
