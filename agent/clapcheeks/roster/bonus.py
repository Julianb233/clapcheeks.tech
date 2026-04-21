"""Phase J (AI-8338) — bonus factor helpers (v1 ships 3 of them).

1. geographic_cluster — group matches within 2mi into a shared cluster_id.
2. calendar_overlap — API side only (web/app/api/roster/tonight).
3. boundary_log — 3+ red_flags auto-archives the match.
"""
from __future__ import annotations

import math
import uuid
from typing import Iterable


GEO_CLUSTER_RADIUS_MI = 2.0
BOUNDARY_THRESHOLD = 3


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon pairs in miles."""
    R = 3958.7613  # earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def assign_geo_clusters(
    matches: list[dict],
    radius_mi: float = GEO_CLUSTER_RADIUS_MI,
) -> dict[str, str]:
    """Single-link clustering of matches by lat/lon.

    Args:
        matches: [{id, lat, lon, ...}, ...]. Rows missing lat/lon are skipped.
        radius_mi: Two points within this distance share a cluster.

    Returns: {match_id: cluster_id_uuid_hex}.
    """
    results: dict[str, str] = {}
    # Union-find over the indices.
    valid = [
        (i, m) for i, m in enumerate(matches)
        if isinstance(m.get("lat"), (int, float)) and isinstance(m.get("lon"), (int, float))
    ]
    parent: dict[int, int] = {i: i for i, _ in valid}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    for idx_a, (i, a) in enumerate(valid):
        for j, b in valid[idx_a + 1:]:
            d = haversine_miles(a["lat"], a["lon"], b["lat"], b["lon"])
            if d <= radius_mi:
                union(i, j)

    # Materialize cluster ids.
    root_to_cluster: dict[int, str] = {}
    for i, m in valid:
        r = find(i)
        if r not in root_to_cluster:
            root_to_cluster[r] = uuid.uuid4().hex
        # Only emit a cluster id when there's at least one sibling.
        # (Single-element groups stay NULL — no chaining value.)
    # Second pass: skip clusters of size 1.
    sizes: dict[int, int] = {}
    for i, _ in valid:
        r = find(i)
        sizes[r] = sizes.get(r, 0) + 1
    for i, m in valid:
        r = find(i)
        if sizes[r] >= 2:
            results[m["id"]] = root_to_cluster[r]

    return results


def should_auto_archive_for_boundary(red_flags: Iterable | None) -> bool:
    """Boundary log: auto-archive if 3+ red_flags present."""
    if not red_flags:
        return False
    try:
        return len(list(red_flags)) >= BOUNDARY_THRESHOLD
    except TypeError:
        return False


def boundary_flag_count(red_flags: Iterable | None) -> int:
    if not red_flags:
        return 0
    try:
        return len(list(red_flags))
    except TypeError:
        return 0
