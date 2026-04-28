"""Phase J (AI-8338): health-score + close-probability computation.

health_score in [0, 100] is a weighted composite of:
    response_rate        25%  (her messages vs his messages)
    reply_speed          20%  (avg_reply_hours inverted)
    recency              20%  (days since last activity, decays 2 pts/day)
    engagement_depth     15%  (messages_7d volume vs his output)
    sentiment            10%  (warming / flat / cooling trajectory)
    his_to_her_ratio     10%  (0.8-1.2 is ideal; penalize extremes)

close_probability is a cheap derived signal used to rank the daily Top-3:
    final_score * (health_score / 100) * stage_multiplier
Normalized into [0, 1].

No network. No Supabase. Pure inputs -> pure outputs so it is trivial to
unit-test.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Weights (sum to 100)
# ---------------------------------------------------------------------------

WEIGHT_RESPONSE_RATE    = 25
WEIGHT_REPLY_SPEED      = 20
WEIGHT_RECENCY          = 20
WEIGHT_ENGAGEMENT       = 15
WEIGHT_SENTIMENT        = 10
WEIGHT_HIS_HER_RATIO    = 10

# Silence decay: how many points/day of dead air erodes recency.
RECENCY_DECAY_PER_DAY = 2.0

# Stage multipliers used by close_probability. Stages not in the dict get 0.25.
STAGE_MULTIPLIER: dict[str, float] = {
    "new_match":              0.20,
    "chatting":               0.45,
    "chatting_phone":         0.70,
    "date_proposed":          0.85,
    "date_booked":            0.95,
    "date_attended":          0.90,
    "hooked_up":              0.75,
    "recurring":              0.85,
    "faded":                  0.10,
    "ghosted":                0.05,
    "archived":               0.00,
    "archived_cluster_dupe":  0.00,
}


@dataclass
class HealthBreakdown:
    response_rate: float
    reply_speed: float
    recency: float
    engagement: float
    sentiment: float
    his_her: float
    total: int

    def as_dict(self) -> dict[str, float | int]:
        return {
            "response_rate": round(self.response_rate, 2),
            "reply_speed": round(self.reply_speed, 2),
            "recency": round(self.recency, 2),
            "engagement": round(self.engagement, 2),
            "sentiment": round(self.sentiment, 2),
            "his_her": round(self.his_her, 2),
            "total": self.total,
        }


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            # Supabase gives ISO8601 with +00:00 or Z.
            cleaned = value.replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# Per-signal scorers — each returns [0.0, 1.0]
# ---------------------------------------------------------------------------

def _score_response_rate(match: dict, events: list[dict]) -> float:
    """What share of his outgoing messages got a reply?

    If we have explicit response_rate on the row, use it. Otherwise derive
    from events: (her incoming) / (his outgoing). Clamp to [0, 1].
    """
    explicit = match.get("response_rate")
    if isinstance(explicit, (int, float)) and 0 <= explicit <= 1:
        return float(explicit)

    his = sum(1 for e in events if (e.get("direction") or "").lower() == "outgoing")
    hers = sum(1 for e in events if (e.get("direction") or "").lower() == "incoming")
    if his == 0:
        # No outreach yet; give her the benefit of the doubt at 0.5.
        return 0.5
    return _clamp(hers / his)


def _score_reply_speed(match: dict) -> float:
    """Lower avg_reply_hours -> higher score. 0h = 1.0, 48h+ = 0.0."""
    hrs = match.get("avg_reply_hours")
    if not isinstance(hrs, (int, float)) or hrs < 0:
        return 0.5  # unknown -> neutral
    if hrs <= 0.5:
        return 1.0
    if hrs >= 48:
        return 0.0
    # Linear decay between 0.5h and 48h.
    return _clamp(1.0 - (hrs - 0.5) / (48 - 0.5))


def _score_recency(match: dict, now: datetime) -> float:
    """Fresh conversation -> high; silence decays at 2 pts/day normalized."""
    last = (
        _parse_ts(match.get("last_activity_at"))
        or _parse_ts(match.get("updated_at"))
        or _parse_ts(match.get("created_at"))
    )
    if last is None:
        return 0.3
    days = (now - last).total_seconds() / 86400.0
    if days < 0:
        days = 0.0
    # 0 days = 1.0, decay of RECENCY_DECAY_PER_DAY points per day on the
    # 0-100 scale -> 0.02 per day on the 0-1 scale.
    decay_per_day = RECENCY_DECAY_PER_DAY / 100.0
    return _clamp(1.0 - days * decay_per_day)


def _score_engagement(match: dict) -> float:
    """Volume-in-the-last-week signal. 30+ msgs in 7d saturates at 1.0."""
    m7 = match.get("messages_7d") or 0
    if m7 <= 0:
        return 0.2
    return _clamp(m7 / 30.0)


def _score_sentiment(match: dict) -> float:
    """sentiment_trajectory: warming > flat > cooling."""
    tag = (match.get("sentiment_trajectory") or "").strip().lower()
    return {"warming": 1.0, "flat": 0.5, "cooling": 0.15}.get(tag, 0.5)


def _score_his_her_ratio(match: dict) -> float:
    """Ideal 0.8-1.2. Very-one-sided (>2x either way) penalized heavily."""
    r = match.get("his_to_her_ratio")
    if not isinstance(r, (int, float)) or r <= 0:
        return 0.5
    if 0.8 <= r <= 1.2:
        return 1.0
    # Anything beyond 3x either way floors to 0.
    dist = abs(r - 1.0)
    return _clamp(1.0 - (dist / 2.0))


# ---------------------------------------------------------------------------
# Top-level API
# ---------------------------------------------------------------------------

def compute_health_breakdown(
    match: dict,
    events: list[dict] | None = None,
    now: datetime | None = None,
) -> HealthBreakdown:
    """Compute the 0-100 health score + per-signal breakdown.

    Args:
        match: dict-like row from clapcheeks_matches. Missing keys default
            to neutral values.
        events: optional list of {direction: "incoming"|"outgoing", ...}
            from clapcheeks_conversation_events or message table.
        now: UTC datetime (injected for testability).
    """
    events = events or []
    now = (now or datetime.now(timezone.utc))
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    s_response = _score_response_rate(match, events)
    s_speed    = _score_reply_speed(match)
    s_recency  = _score_recency(match, now)
    s_engage   = _score_engagement(match)
    s_senti    = _score_sentiment(match)
    s_ratio    = _score_his_her_ratio(match)

    total = (
        s_response * WEIGHT_RESPONSE_RATE
        + s_speed    * WEIGHT_REPLY_SPEED
        + s_recency  * WEIGHT_RECENCY
        + s_engage   * WEIGHT_ENGAGEMENT
        + s_senti    * WEIGHT_SENTIMENT
        + s_ratio    * WEIGHT_HIS_HER_RATIO
    )
    total_i = max(0, min(100, int(round(total))))

    return HealthBreakdown(
        response_rate=s_response,
        reply_speed=s_speed,
        recency=s_recency,
        engagement=s_engage,
        sentiment=s_senti,
        his_her=s_ratio,
        total=total_i,
    )


def compute_health_score(
    match: dict,
    events: list[dict] | None = None,
    now: datetime | None = None,
) -> int:
    """Public entry point — returns the 0-100 integer score."""
    return compute_health_breakdown(match, events, now).total


def compute_close_probability(
    match: dict,
    health_score: int | None = None,
) -> float:
    """Cheap 0.0-1.0 scalar used to rank the Top-3 and the roster.

    close_probability = norm(final_score) * (health/100) * stage_mult
    """
    final_score = match.get("final_score")
    if not isinstance(final_score, (int, float)):
        final_score = 0.0
    # final_score is 0-100 in Phase I; normalize.
    fs = _clamp(float(final_score) / 100.0)

    hs = health_score if isinstance(health_score, (int, float)) else (
        match.get("health_score") or 50
    )
    hs = _clamp(float(hs) / 100.0)

    stage = match.get("stage") or "new_match"
    mult = STAGE_MULTIPLIER.get(stage, 0.25)

    return round(_clamp(fs * hs * mult), 4)


# ---------------------------------------------------------------------------
# Batch recompute (called from the hourly cron daemon thread)
# ---------------------------------------------------------------------------

def recompute_all(
    user_id: str,
    limit: int = 500,
) -> dict:
    """Recompute health_score + close_probability for every active match.

    Returns {scanned, updated, errors}. Skips archived/ghosted stages.
    Designed to be called from daemon.py's roster worker.
    """
    import requests

    # AI-8767: Use user-scoped JWT via scoring._supabase_creds() which prefers
    # SUPABASE_USER_ACCESS_TOKEN over service-role key on operator Macs.
    from clapcheeks.scoring import _supabase_creds, _supabase_headers  # type: ignore

    url, key = _supabase_creds()
    headers = {
        **_supabase_headers(key),
        "Prefer": "return=minimal",
    }

    # Pull only non-terminal rows.
    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_matches",
        params={
            "user_id": f"eq.{user_id}",
            "stage": "not.in.(archived,archived_cluster_dupe)",
            "select": (
                "id,stage,final_score,health_score,avg_reply_hours,"
                "messages_7d,his_to_her_ratio,sentiment_trajectory,"
                "last_activity_at,updated_at,created_at,response_rate"
            ),
            "limit": str(limit),
        },
        headers=_supabase_headers(key),
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json()

    now = datetime.now(timezone.utc)
    scanned, updated, errors = 0, 0, 0

    for row in rows:
        scanned += 1
        try:
            hb = compute_health_breakdown(row, events=[], now=now)
            cp = compute_close_probability(row, health_score=hb.total)
            patch = {
                "health_score": hb.total,
                "health_score_updated_at": now.isoformat(),
                "close_probability": cp,
            }
            r = requests.patch(
                f"{url}/rest/v1/clapcheeks_matches",
                params={"id": f"eq.{row['id']}"},
                headers=headers,
                json=patch,
                timeout=15,
            )
            if r.status_code < 300:
                updated += 1
            else:
                errors += 1
        except Exception:
            errors += 1

    return {"scanned": scanned, "updated": updated, "errors": errors}
