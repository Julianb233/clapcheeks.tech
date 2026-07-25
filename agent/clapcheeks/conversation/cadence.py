"""Per-person response cadence derived from valid recent exchanges."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from statistics import median


class CadenceBand(str, Enum):
    LIVE_RECIPROCAL = "live_reciprocal"
    WARM_SAME_DAY = "warm_same_day"
    NORMAL_ACTIVE = "normal_active"
    SLOW_RESPONDER = "slow_responder"
    TIME_SENSITIVE_LOGISTICS = "time_sensitive_logistics"
    SENSITIVE_REVIEW = "sensitive_review"


@dataclass(frozen=True)
class CadenceWindow:
    band: CadenceBand
    minimum_minutes: int
    maximum_minutes: int
    valid_sample_count: int
    median_minutes: float | None


def calculate_cadence(
    *,
    recent_response_minutes: list[float],
    overnight_indexes: set[int] | None = None,
    backfill_indexes: set[int] | None = None,
    delivery_failure_indexes: set[int] | None = None,
    live_reciprocal: bool = False,
    time_sensitive_logistics: bool = False,
    sensitive_context: bool = False,
) -> CadenceWindow:
    excluded = (overnight_indexes or set()) | (backfill_indexes or set()) | (
        delivery_failure_indexes or set()
    )
    valid = [
        float(value)
        for index, value in enumerate(recent_response_minutes)
        if index not in excluded and value >= 0
    ]
    sample_median = median(valid) if valid else None

    if sensitive_context:
        return CadenceWindow(CadenceBand.SENSITIVE_REVIEW, 0, 0, len(valid), sample_median)
    if time_sensitive_logistics:
        return CadenceWindow(CadenceBand.TIME_SENSITIVE_LOGISTICS, 0, 30, len(valid), sample_median)
    if live_reciprocal:
        return CadenceWindow(CadenceBand.LIVE_RECIPROCAL, 3, 15, len(valid), sample_median)
    if sample_median is None or sample_median <= 120:
        return CadenceWindow(CadenceBand.WARM_SAME_DAY, 20, 120, len(valid), sample_median)
    if sample_median <= 360:
        return CadenceWindow(CadenceBand.NORMAL_ACTIVE, 120, 360, len(valid), sample_median)
    mirrored = min(1_080, max(360, round(sample_median)))
    return CadenceWindow(CadenceBand.SLOW_RESPONDER, mirrored, 1_080, len(valid), sample_median)
