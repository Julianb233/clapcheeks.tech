"""Phase L (AI-8340) - 7-day IG posting scheduler.

Runs daily (09:00 PT) from ``_content_scheduler_worker`` in daemon.py.
Reads ``persona.content_library.ratio`` and pops the library rows into a
rolling 7-day schedule stored in ``clapcheeks_posting_queue``.

Rules (hardcoded defaults; persona can override):

* Max one post per day (looks desperate otherwise). Julian's persona
  caps at 1-2 but we target 1/day.
* Category ratio follows ``persona.content_library.ratio`` - default is
  60% beach+dog, 20% active, 10% entrepreneur, 10% food.
* No two days in a row from the same category (diversity rule).
* Entrepreneur + ted_talk_speaking combined cap at 1/7 posts (thirsty
  cap from the Phase L brief).
* Items already ``posted_at`` are never re-scheduled.
* Library items already in ``pending`` posting_queue rows are skipped
  (prevents double-schedule).

The scheduler does NOT actually post - it only builds the queue. The
publisher (``clapcheeks.content.publisher``) drains due rows.
"""
from __future__ import annotations

import logging
import random
from collections import Counter
from datetime import datetime, time, timedelta, timezone
from typing import Any

log = logging.getLogger("clapcheeks.content.scheduler")

# Default if persona has no ratio block. Keep in sync with the saved
# persona.content_library.ratio.
DEFAULT_RATIO: dict[str, float] = {
    "beach_house_work_from_home": 0.30,
    "dog_faith": 0.30,
    "beach_active": 0.20,
    "entrepreneur_behind_scenes": 0.10,
    "food_drinks_mission_beach": 0.10,
    "ted_talk_speaking": 0.00,  # rare, per brief
}

# Persona-configurable posts per day. Stays at 1.
DEFAULT_POSTS_PER_DAY = 1

# Default time-of-day slots keyed to target_time_of_day hint. All times
# are America/Los_Angeles; we store UTC in the queue.
TIME_OF_DAY_HOURS = {
    "golden_hour": 18,       # 6pm PT
    "workday": 11,           # 11am PT
    "evening": 20,           # 8pm PT
    "anytime": 12,           # noon PT fallback
}

# LA offset rounded to a constant so the scheduler doesn't require
# pytz. Close enough for queueing (publisher does the exact check).
_LA_OFFSET_HOURS = -7


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def categories_ratio(persona: dict[str, Any]) -> dict[str, float]:
    """Return the category ratio map, falling back to DEFAULT_RATIO."""
    cl = (persona or {}).get("content_library") or {}
    raw = cl.get("ratio") or {}
    if not raw:
        return dict(DEFAULT_RATIO)
    total = sum(max(0.0, float(v)) for v in raw.values()) or 1.0
    return {k: max(0.0, float(v)) / total for k, v in raw.items()}


def build_weekly_plan(
    library_rows: list[dict[str, Any]],
    persona: dict[str, Any],
    start_date: datetime | None = None,
    days: int = 7,
    existing_pending: list[dict[str, Any]] | None = None,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Build a 7-day posting plan from a library snapshot.

    Args:
        library_rows: list of clapcheeks_content_library rows that are
            NOT posted yet. Each row must have ``id``, ``category``, and
            ``target_time_of_day`` at minimum.
        persona: loaded persona dict from clapcheeks_user_settings.
        start_date: local-date anchor for day 0 (defaults to today).
        days: number of days to plan (default 7).
        existing_pending: already-pending posting_queue rows; the
            scheduler SKIPS their ``content_library_id`` and ALSO avoids
            their days to prevent over-posting.
        rng: optional seeded Random() for deterministic tests.

    Returns a list of plan entries::

        [
          {
            "day_offset": 0,
            "scheduled_for": "2026-04-21T19:00:00Z",
            "content_library_id": "uuid",
            "category": "beach_active",
            "reason": "ratio=0.20, last_cat=None",
          },
          ...
        ]
    """
    rng = rng or random.Random(42)
    anchor = (start_date or datetime.now(timezone.utc)).replace(
        minute=0, second=0, microsecond=0
    )

    ratio = categories_ratio(persona)
    posts_per_day = int(
        (persona or {}).get("content_library", {}).get("posts_per_day")
        or DEFAULT_POSTS_PER_DAY
    )
    total_slots = max(1, days * posts_per_day)

    # Exclude library items already queued or posted.
    skip_ids: set[str] = set()
    blocked_days: set[int] = set()
    for p in existing_pending or []:
        lib_id = p.get("content_library_id")
        if lib_id:
            skip_ids.add(str(lib_id))
        sched = p.get("scheduled_for")
        if sched:
            try:
                day_off = _day_offset_from(sched, anchor)
                if 0 <= day_off < days:
                    blocked_days.add(day_off)
            except Exception:
                pass

    # Bucket library rows by category, skipping already-queued items.
    buckets: dict[str, list[dict[str, Any]]] = {}
    for row in library_rows:
        if not row:
            continue
        if row.get("posted_at"):
            continue
        rid = str(row.get("id") or "")
        if rid in skip_ids:
            continue
        cat = row.get("category") or "entrepreneur_behind_scenes"
        buckets.setdefault(cat, []).append(row)

    # Shuffle each bucket so we don't always pick the oldest first.
    for rows in buckets.values():
        rng.shuffle(rows)

    # Convert ratio -> target count per category. Round half up.
    target_per_cat: dict[str, int] = {}
    for cat, frac in ratio.items():
        target_per_cat[cat] = int(round(frac * total_slots))

    # Thirst cap: entrepreneur+ted_talk combined at most 1 per 7 posts.
    # The cap is applied FIRST to prevent thirsty ratios from dominating
    # the plan, then the freed slots get redistributed below.
    thirsty = ("entrepreneur_behind_scenes", "ted_talk_speaking")
    cap = max(1, total_slots // 7)
    combined = sum(target_per_cat.get(c, 0) for c in thirsty)
    if combined > cap:
        reduce_by = combined - cap
        for c in thirsty:
            if reduce_by <= 0:
                break
            take = min(reduce_by, target_per_cat.get(c, 0))
            target_per_cat[c] = target_per_cat.get(c, 0) - take
            reduce_by -= take

    # Rebalance: if rounding / thirst-cap under/overshot, pad from the
    # highest-ratio non-thirsty category that still has inventory. If
    # every non-thirsty category lacks inventory, fall back to thirsty
    # but only up to cap.
    slots_wanted = total_slots
    current = sum(target_per_cat.values())
    non_thirsty_ratio = sorted(
        ((c, r) for c, r in ratio.items() if c not in thirsty),
        key=lambda kv: -kv[1],
    )
    if current < slots_wanted:
        idx = 0
        limit = max(1, len(non_thirsty_ratio)) * 8
        while current < slots_wanted and idx < limit:
            if non_thirsty_ratio:
                cat = non_thirsty_ratio[idx % len(non_thirsty_ratio)][0]
                if len(buckets.get(cat, [])) > target_per_cat.get(cat, 0):
                    target_per_cat[cat] = target_per_cat.get(cat, 0) + 1
                    current += 1
            idx += 1
        # If still short and only thirsty inventory exists, allow up to cap.
        for c in thirsty:
            while (
                current < slots_wanted
                and target_per_cat.get(c, 0) < cap
                and len(buckets.get(c, [])) > target_per_cat.get(c, 0)
            ):
                combined_now = sum(target_per_cat.get(x, 0) for x in thirsty)
                if combined_now >= cap:
                    break
                target_per_cat[c] = target_per_cat.get(c, 0) + 1
                current += 1
    elif current > slots_wanted:
        cats_by_ratio = sorted(ratio.items(), key=lambda kv: kv[1])
        idx = 0
        while current > slots_wanted and idx < len(cats_by_ratio) * 4:
            cat = cats_by_ratio[idx % len(cats_by_ratio)][0]
            if target_per_cat.get(cat, 0) > 0:
                target_per_cat[cat] = target_per_cat[cat] - 1
                current -= 1
            idx += 1

    # Build an ordered category sequence respecting "no two days in a
    # row from the same category" as best we can. Sort by remaining
    # quota desc so we intersperse the heavy ones.
    sequence: list[str] = []
    last_cat: str | None = None
    remaining = dict(target_per_cat)

    for _ in range(slots_wanted):
        candidates = [
            (cat, left) for cat, left in remaining.items()
            if left > 0 and cat != last_cat and buckets.get(cat)
        ]
        if not candidates:
            candidates = [
                (cat, left) for cat, left in remaining.items()
                if left > 0 and buckets.get(cat)
            ]
        if not candidates:
            # Inventory exhausted - drop empty slots so we don't
            # schedule nothing.
            break
        # Prefer whichever category still has the biggest gap.
        candidates.sort(key=lambda kv: (-kv[1], kv[0]))
        chosen = candidates[0][0]
        sequence.append(chosen)
        remaining[chosen] -= 1
        last_cat = chosen

    # Assign days in order, skipping blocked days.
    free_days = [d for d in range(days) if d not in blocked_days]
    plan: list[dict[str, Any]] = []
    for i, cat in enumerate(sequence):
        if i >= len(free_days):
            break
        day_off = free_days[i]
        row = buckets[cat].pop()
        tod = row.get("target_time_of_day") or "anytime"
        scheduled_for = _slot_for(anchor, day_off, tod)
        plan.append({
            "day_offset": day_off,
            "scheduled_for": scheduled_for.isoformat(),
            "content_library_id": str(row["id"]),
            "category": cat,
            "reason": f"ratio={ratio.get(cat, 0):.2f}",
        })

    return plan


def save_plan_to_queue(
    plan: list[dict[str, Any]],
    user_id: str,
    client: Any = None,
) -> int:
    """Insert plan entries as pending rows in clapcheeks_posting_queue.

    Returns the count inserted. Duplicates (unique index on
    content_library_id where status=pending) are swallowed as 0.
    """
    if not plan:
        return 0

    from clapcheeks.job_queue import _client as _svc_client

    c = client or _svc_client()
    inserted = 0
    for entry in plan:
        row = {
            "user_id": user_id,
            "content_library_id": entry["content_library_id"],
            "scheduled_for": entry["scheduled_for"],
            "status": "pending",
        }
        try:
            resp = c.table("clapcheeks_posting_queue").insert(row).execute()
            data = getattr(resp, "data", None) or []
            if data:
                inserted += 1
        except Exception as exc:
            log.debug("save_plan_to_queue skipped row (%s)", exc)
    log.info("save_plan_to_queue: inserted=%d of %d plan entries", inserted, len(plan))
    return inserted


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _slot_for(anchor_utc: datetime, day_offset: int, tod: str) -> datetime:
    """Return a UTC datetime for day ``day_offset`` at the ``tod`` hour (LA)."""
    local_hour = TIME_OF_DAY_HOURS.get(tod, TIME_OF_DAY_HOURS["anytime"])
    # Convert LA hour to approximate UTC. Good enough for queue sorting.
    utc_hour = (local_hour - _LA_OFFSET_HOURS) % 24
    day_shift = (local_hour - _LA_OFFSET_HOURS) // 24
    target = (anchor_utc + timedelta(days=day_offset + int(day_shift))).replace(
        hour=utc_hour, minute=0, second=0, microsecond=0
    )
    return target


def _day_offset_from(iso_str: str, anchor_utc: datetime) -> int:
    """Return integer day offset from anchor for an ISO timestamp."""
    if not iso_str:
        return -1
    try:
        if isinstance(iso_str, datetime):
            dt = iso_str
        else:
            s = iso_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
    except Exception:
        return -1
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = dt - anchor_utc
    return int(delta.total_seconds() // 86400)


def diversity_score(plan: list[dict[str, Any]]) -> float:
    """Return a [0, 1] score where 1.0 means no repeats across days.

    Used by tests + the dashboard plan preview.
    """
    if not plan:
        return 1.0
    cats = [p["category"] for p in plan]
    repeats = sum(1 for i in range(1, len(cats)) if cats[i] == cats[i - 1])
    return max(0.0, 1.0 - repeats / len(cats))


def summary_counts(plan: list[dict[str, Any]]) -> dict[str, int]:
    """Count posts per category in a plan - for debugging + tests."""
    return dict(Counter(p["category"] for p in plan))
