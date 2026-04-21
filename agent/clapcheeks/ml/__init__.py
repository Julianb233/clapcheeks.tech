"""Phase H (AI-8322) — ML preference learner.

Three pieces:

* ``features``  — deterministic feature extraction from a match row
* ``trainer``   — fit a logistic regression on clapcheeks_swipe_decisions,
                  serialize weights into clapcheeks_user_settings.preference_model_v
* ``ingest_export`` — CLI that parses Tinder / Hinge GDPR exports and bulk-inserts
                      historical (match, decision) rows into clapcheeks_swipe_decisions

Design constraints:

* No sklearn runtime dep — the VPS image doesn't ship with it and we do not
  want to add a large compiled dep for a model that reduces to a weighted dot
  product. We hand-roll logistic regression + a small gradient-boosted-
  decision-tree-ish fallback so the entire module is pure Python + numpy-free
  at both train and inference time. Serialization is a plain JSON dict.
* Every public function is pure: takes dicts, returns dicts. I/O is isolated
  to ``trainer.fit_preference_model`` (reads Supabase, writes Supabase).
* Inference is fast enough (< 1 ms) to run inline from Phase I scoring.
"""

from .features import extract_features
from .trainer import fit_preference_model, score_with_model, blend_with_rules

__all__ = [
    "extract_features",
    "fit_preference_model",
    "score_with_model",
    "blend_with_rules",
]
