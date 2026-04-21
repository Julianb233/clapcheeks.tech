"""Phase K (AI-8339): Friend-cluster manager.

When a new match shares >= 2 female friends with an existing active
match, they belong to the same "friend cluster". We surface only the
highest-scoring match per cluster on the dashboard; the rest stay in
the DB but are marked with cluster_rank >= 2 so the UI can dedupe.

Rules (from persona.social_graph_rules.cluster_management_rules):
- On a new match joining a cluster: recompute ranks by final_score.
  If the new match outranks the current leader, iMessage Julian with
  "swap focus?" context.
- When the cluster leader reaches status = 'dated' (date attended):
  LOCK the cluster permanently. Every other member is archived.
- When a leader fades (30d silence): UNLOCK and let the next-highest
  surface at a 'high_risk' band because word has traveled.

This module only handles the Supabase state. Actual opener-pause +
iMessage side-effects live in the daemon worker.

Public API:
    assign_to_cluster(match_id, candidate_ids) -> cluster_id | None
    update_cluster_ranks(cluster_id) -> None
    on_cluster_locked(cluster_id, triggering_match_id) -> None
    find_cluster_candidates(match_row, active_matches) -> list[str]
"""
from __future__ import annotations

import logging
import uuid
from typing import Iterable

from clapcheeks.social.graph import _normalize_handle, _normalize_name

logger = logging.getLogger("clapcheeks.social.clusters")

# Minimum shared female-friend overlap to trigger cluster assignment.
DEFAULT_CLUSTER_THRESHOLD = 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _handles_set(entries: Iterable[dict] | None) -> set[str]:
    """Extract the canonical key (handle, falling back to name) per entry."""
    if not entries:
        return set()
    out: set[str] = set()
    for e in entries:
        if not isinstance(e, dict):
            continue
        key = _normalize_handle(e.get("handle")) or _normalize_name(e.get("name"))
        if key:
            out.add(key)
    return out


def _supabase_rest():
    """Import lazily so the module is test-friendly without Supabase creds."""
    from clapcheeks.scoring import _supabase_creds
    import requests
    url, key = _supabase_creds()
    return url, key, requests


# ---------------------------------------------------------------------------
# Candidate discovery
# ---------------------------------------------------------------------------

def find_cluster_candidates(
    match_row: dict,
    active_matches: Iterable[dict],
    threshold: int = DEFAULT_CLUSTER_THRESHOLD,
) -> list[str]:
    """Given a new match + the list of other active matches for this user,
    return the ids of matches that share >= ``threshold`` female friends
    with ``match_row``.

    ``active_matches`` rows must carry ``id`` + ``mutual_friends_list`` +
    optionally ``shared_female_friends`` + ``friend_cluster_id`` +
    ``status``. Matches that have stage = 'dated' or status = 'ghosted'
    are skipped (they can't form a NEW cluster, though they may already
    hold one).
    """
    her_friends = _handles_set(
        match_row.get("shared_female_friends") or match_row.get("mutual_friends_list")
    )
    if len(her_friends) < threshold:
        # Even in the best case, < threshold overlap is impossible.
        return []

    out: list[str] = []
    for other in active_matches:
        if not isinstance(other, dict):
            continue
        if other.get("id") == match_row.get("id"):
            continue
        if other.get("status") in ("ghosted",):
            continue
        other_friends = _handles_set(
            other.get("shared_female_friends") or other.get("mutual_friends_list")
        )
        overlap = her_friends & other_friends
        if len(overlap) >= threshold:
            out.append(other["id"])
    return out


# ---------------------------------------------------------------------------
# Cluster assignment
# ---------------------------------------------------------------------------

def assign_to_cluster(
    match_id: str,
    candidate_ids: list[str],
    *,
    existing_cluster_id: str | None = None,
    client: object = None,
) -> str | None:
    """Place ``match_id`` into a cluster with each id in ``candidate_ids``.

    If any candidate already holds a cluster_id, reuse it. Otherwise,
    mint a new uuid and stamp it on everyone (including the new match).

    Returns the cluster_id stamped on the match (or None if Supabase
    access was unavailable - the caller can retry next tick).
    """
    if not match_id:
        return None

    try:
        url, key, requests = _supabase_rest()
    except Exception as exc:
        logger.debug("assign_to_cluster: supabase unavailable (%s)", exc)
        return None

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # Step 1: figure out the canonical cluster_id.
    cluster_id = existing_cluster_id
    if not cluster_id and candidate_ids:
        try:
            # Fetch candidates' existing cluster ids.
            r = requests.get(
                f"{url}/rest/v1/clapcheeks_matches",
                params={
                    "id": f"in.({','.join(candidate_ids)})",
                    "select": "id,friend_cluster_id",
                },
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                timeout=15,
            )
            if r.status_code < 300:
                for row in r.json():
                    if row.get("friend_cluster_id"):
                        cluster_id = row["friend_cluster_id"]
                        break
        except Exception as exc:
            logger.debug("assign_to_cluster: candidate fetch failed (%s)", exc)

    if not cluster_id:
        cluster_id = str(uuid.uuid4())

    # Step 2: stamp every member with cluster_id.
    members = set(candidate_ids) | {match_id}
    try:
        r = requests.patch(
            f"{url}/rest/v1/clapcheeks_matches",
            params={"id": f"in.({','.join(members)})"},
            headers=headers,
            json={"friend_cluster_id": cluster_id},
            timeout=15,
        )
        if r.status_code >= 300:
            logger.warning(
                "assign_to_cluster PATCH failed (%s): %s",
                r.status_code, r.text[:200],
            )
            return None
    except Exception as exc:
        logger.warning("assign_to_cluster PATCH exception: %s", exc)
        return None

    # Step 3: recompute ranks.
    update_cluster_ranks(cluster_id)
    return cluster_id


# ---------------------------------------------------------------------------
# Rank recomputation
# ---------------------------------------------------------------------------

def update_cluster_ranks(cluster_id: str, *, client: object = None) -> None:
    """Recompute cluster_rank = 1 for the highest-scored member, 2+ for
    the rest. Call on (a) new member joining, (b) final_score change on
    any member, (c) cluster lock / unlock.
    """
    if not cluster_id:
        return
    try:
        url, key, requests = _supabase_rest()
    except Exception as exc:
        logger.debug("update_cluster_ranks: supabase unavailable (%s)", exc)
        return

    try:
        r = requests.get(
            f"{url}/rest/v1/clapcheeks_matches",
            params={
                "friend_cluster_id": f"eq.{cluster_id}",
                "select": "id,final_score,status,cluster_rank",
                "order": "final_score.desc.nullslast,created_at.asc",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
    except Exception as exc:
        logger.warning("update_cluster_ranks fetch failed: %s", exc)
        return

    if r.status_code >= 300:
        logger.warning("update_cluster_ranks fetch %s", r.status_code)
        return

    rows = r.json() or []
    if not rows:
        return

    # Leader = first row (highest final_score, nulls last). If everyone
    # has final_score = None we fall back to oldest first.
    patches: list[tuple[str, int]] = []
    for idx, row in enumerate(rows):
        new_rank = 1 if idx == 0 else idx + 1
        if row.get("cluster_rank") != new_rank:
            patches.append((row["id"], new_rank))

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    for match_id, new_rank in patches:
        try:
            p = requests.patch(
                f"{url}/rest/v1/clapcheeks_matches",
                params={"id": f"eq.{match_id}"},
                headers=headers,
                json={"cluster_rank": new_rank},
                timeout=15,
            )
            if p.status_code >= 300:
                logger.warning(
                    "rank patch failed for %s: %s %s",
                    match_id, p.status_code, p.text[:200],
                )
        except Exception as exc:
            logger.warning("rank patch exception for %s: %s", match_id, exc)


# ---------------------------------------------------------------------------
# Lock on date-attended
# ---------------------------------------------------------------------------

def on_cluster_locked(
    cluster_id: str,
    triggering_match_id: str,
    *,
    client: object = None,
) -> None:
    """Permanently suppress every non-leader in a cluster once the leader
    attends a date with Julian. Suppressed siblings get status='ghosted'
    and cluster_rank bumped to 99 so they stay visible in the archived
    tab but drop out of every active view.

    Idempotent - safe to call repeatedly.
    """
    if not cluster_id or not triggering_match_id:
        return
    try:
        url, key, requests = _supabase_rest()
    except Exception as exc:
        logger.debug("on_cluster_locked: supabase unavailable (%s)", exc)
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # Bump triggering match to cluster_rank=1, mark leader_locked.
    try:
        requests.patch(
            f"{url}/rest/v1/clapcheeks_matches",
            params={"id": f"eq.{triggering_match_id}"},
            headers=headers,
            json={"cluster_rank": 1},
            timeout=15,
        )
    except Exception as exc:
        logger.warning("leader mark failed: %s", exc)

    # Every sibling: cluster_rank=99 + status=ghosted.
    try:
        r = requests.patch(
            f"{url}/rest/v1/clapcheeks_matches",
            params={
                "friend_cluster_id": f"eq.{cluster_id}",
                "id": f"neq.{triggering_match_id}",
            },
            headers=headers,
            json={"cluster_rank": 99, "status": "ghosted"},
            timeout=15,
        )
        if r.status_code >= 300:
            logger.warning(
                "cluster lock PATCH failed: %s %s",
                r.status_code, r.text[:200],
            )
    except Exception as exc:
        logger.warning("cluster lock PATCH exception: %s", exc)
