"""Profile coaching module — actionable tips based on research benchmarks."""
from __future__ import annotations

from clapcheeks.profile import Profile


def analyze_profile(profile: Profile) -> list[str]:
    """Analyze a user's Profile and return actionable coaching tips.

    Pure logic based on Profile fields — no external API calls.
    Tips are grounded in dating-app research benchmarks.
    """
    tips: list[str] = []

    # Bio length check (>50 chars is the baseline for a decent bio)
    bio = (profile.bio_summary or "").strip()
    if not bio:
        tips.append(
            "You have no bio. Add something specific about yourself "
            "— profiles with bios get 4x more matches."
        )
    elif len(bio) < 50:
        tips.append(
            "Your bio is too short. Add something specific about yourself "
            "— aim for at least 2-3 sentences."
        )

    # Preferred traits
    if not profile.pref_traits:
        tips.append(
            "Set your preferred traits (clapcheeks profile setup). "
            "Knowing what you want helps the AI target better matches."
        )

    # Looking for
    if not profile.looking_for:
        tips.append(
            "Set what you're looking for (casual, serious, etc.). "
            "Users with clear intent get 30% more meaningful conversations."
        )

    # Dealbreakers
    if not profile.dealbreakers:
        tips.append(
            "Add at least one dealbreaker. It saves time and signals "
            "you know what you want."
        )

    # Photo tip (always show — we can't check photos, but it's high leverage)
    if not bio or len(bio) < 50:
        tips.append(
            "Add a full-body photo — it increases matches by 203%."
        )

    # Hinge-specific prompt tip
    tips.append(
        "Set your Hinge prompts to be question-based "
        "— they get 40% more comments."
    )

    # Profile completeness encouragement
    filled = sum([
        bool(profile.name),
        bool(profile.age),
        bool(profile.location),
        bool(profile.looking_for),
        len(bio) >= 50,
        bool(profile.pref_traits),
        bool(profile.dealbreakers),
    ])
    total = 7
    if filled == total:
        # Profile is complete — only return the Hinge prompt tip
        return [
            "Set your Hinge prompts to be question-based "
            "— they get 40% more comments."
        ]

    return tips


def format_coach_tips(tips: list[str]) -> str:
    """Format coaching tips as a Rich-friendly string for CLI display."""
    if not tips:
        return ""
    lines = []
    for i, tip in enumerate(tips, 1):
        lines.append(f"[bold]{i}.[/bold] {tip}")
    return "\n".join(lines)
