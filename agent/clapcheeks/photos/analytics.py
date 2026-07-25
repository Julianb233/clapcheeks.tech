"""Objective profile-photo experiment evidence helpers."""


def evidence_status(*, exposures: int | None, matches: int) -> str:
    """Avoid comparative claims without a meaningful same-platform denominator."""
    if exposures is None or exposures < 30 or matches < 0:
        return "insufficient evidence"
    return "measurable"
