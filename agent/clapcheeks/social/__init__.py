"""Social-signal helpers (Phase C - AI-8317, Phase K - AI-8339).

Public surface:
    - ig_handle.extract_ig_handles(text) -> list[str]
    - ig_parser.parse_ig_user_feed(raw) -> dict
    - ig_parser.aggregate_ig_intel(parsed) -> str
    - graph.detect_mutual_friends(match, julian_ig_session, julian_contacts)
    - graph.compute_risk_band(count, persona_rules)
    - graph.scan_match(match, persona_rules, ...)
    - clusters.find_cluster_candidates(match_row, active_matches, threshold)
    - clusters.assign_to_cluster(match_id, candidate_ids)
    - clusters.update_cluster_ranks(cluster_id)
    - clusters.on_cluster_locked(cluster_id, triggering_match_id)
"""
from clapcheeks.social.ig_handle import extract_ig_handles  # noqa: F401
from clapcheeks.social.ig_parser import (  # noqa: F401
    aggregate_ig_intel,
    parse_ig_user_feed,
)
from clapcheeks.social.graph import (  # noqa: F401
    compute_risk_band,
    detect_mutual_friends,
    scan_match,
)
from clapcheeks.social.clusters import (  # noqa: F401
    assign_to_cluster,
    find_cluster_candidates,
    on_cluster_locked,
    update_cluster_ranks,
)
