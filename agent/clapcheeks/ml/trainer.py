"""Phase H trainer — fit a preference classifier on clapcheeks_swipe_decisions.

Pure Python, zero numpy/sklearn dependencies so the VPS image stays lean.
Two model families:

* logreg — L2-regularized logistic regression, fit by mini-batch SGD.
* gbm    — shallow depth-3 decision-tree ensemble (boosted stumps-of-stumps),
           log-loss gradient. Handles non-linear interactions the logreg misses.

At train time we fit BOTH and keep whichever has higher held-out accuracy.
Serialization is plain JSON so Phase I scoring can load without importing
this module at all (trainer only runs in the nightly daemon thread).

Public API:

* fit_preference_model(user_id, min_decisions=200) -> dict | None
* score_with_model(features, model_v) -> float in [0.0, 1.0]
* blend_with_rules(rule_score, model_score, n_decisions) -> float in [0.0, 1.0]

All three are deterministic given the same inputs + random seed, which makes
the Phase H unit tests reproducible.
"""
from __future__ import annotations

import json
import logging
import math
import os
import random
from datetime import datetime, timezone
from typing import Any

from .features import feature_keys, features_to_vector

log = logging.getLogger("clapcheeks.ml.trainer")


# ---------------------------------------------------------------------------
# Blend thresholds — Phase H x Phase I
# ---------------------------------------------------------------------------
#
# Blend = model_weight * model + rule_weight * rule
#
# * n_decisions < 200 : (0.0, 1.0) -> pure rules.
# * 200 <= n < 500    : (0.3, 0.7) -> let the model nudge.
# * n >= 500          : (0.5, 0.5) -> model reaches parity.
#
# These are the bands the PR description requires; kept as module constants so
# the unit test can assert them without copy-paste.

BLEND_BANDS: tuple[tuple[int, float, float], ...] = (
    (500, 0.5, 0.5),
    (200, 0.3, 0.7),
    (0, 0.0, 1.0),
)


def blend_with_rules(
    rule_score: float,
    model_score: float | None,
    n_decisions: int,
) -> float:
    """Blend the Phase I rule score with the Phase H model score.

    Returns a float in [0, 1]. If ``model_score`` is None (no model trained
    yet) or ``n_decisions`` is below the 200 floor we fall back to the rule
    score, so Phase I never breaks when Phase H hasn't kicked in yet.
    """
    try:
        rule = max(0.0, min(1.0, float(rule_score)))
    except (TypeError, ValueError):
        rule = 0.0

    if model_score is None:
        return rule

    try:
        model = max(0.0, min(1.0, float(model_score)))
    except (TypeError, ValueError):
        return rule

    for floor, model_w, rule_w in BLEND_BANDS:
        if n_decisions >= floor:
            blended = model_w * model + rule_w * rule
            return max(0.0, min(1.0, blended))

    return rule


# ---------------------------------------------------------------------------
# Logistic regression — mini-batch SGD with L2
# ---------------------------------------------------------------------------

def _sigmoid(z: float) -> float:
    # Numerically stable sigmoid.
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def _dot(w: list[float], x: list[float]) -> float:
    # Inline sum is faster than sum(generator) on CPython for small vectors.
    total = 0.0
    for wi, xi in zip(w, x):
        total += wi * xi
    return total


def _train_logreg(
    X: list[list[float]],
    y: list[int],
    *,
    epochs: int = 40,
    lr: float = 0.2,
    l2: float = 1e-3,
    seed: int = 42,
) -> tuple[list[float], float]:
    """Return (weights, bias). Assumes X is already float; y in {0, 1}."""
    n_features = len(X[0]) if X else 0
    w = [0.0] * n_features
    b = 0.0
    rng = random.Random(seed)

    indices = list(range(len(X)))
    for _ in range(epochs):
        rng.shuffle(indices)
        for i in indices:
            x = X[i]
            yi = y[i]
            z = _dot(w, x) + b
            p = _sigmoid(z)
            err = p - yi
            # Gradient update with L2 shrinkage.
            for j in range(n_features):
                w[j] -= lr * (err * x[j] + l2 * w[j])
            b -= lr * err
    return w, b


def _score_logreg(weights: list[float], bias: float, vec: list[float]) -> float:
    return _sigmoid(_dot(weights, vec) + bias)


# ---------------------------------------------------------------------------
# Tiny GBM — depth-3 decision stumps
# ---------------------------------------------------------------------------
#
# We purposely keep this minimal: each boosting round finds the best single
# feature + threshold split that reduces MSE against the current residual,
# then stores (feature_idx, threshold, left_val, right_val). At inference
# we sum across all stumps and squash through sigmoid.
#
# This is enough to catch non-linear interactions on tabular tabular data
# with ~50-80 features and a few hundred rows, which is exactly our regime.

def _best_stump(
    X: list[list[float]],
    residuals: list[float],
    feature_idxs: list[int],
) -> tuple[int, float, float, float, float]:
    """Return (feat_idx, threshold, left_val, right_val, sse) for best split.

    Uses the midpoint between sorted unique feature values as candidate
    thresholds. Falls back to the first feature with a constant 0 stump if
    nothing improves on the null MSE.
    """
    n = len(X)
    if n == 0:
        return 0, 0.0, 0.0, 0.0, 0.0

    best: tuple[int, float, float, float, float] = (
        feature_idxs[0], 0.0, 0.0, 0.0, float("inf"),
    )

    for fi in feature_idxs:
        col = sorted({X[i][fi] for i in range(n)})
        if len(col) < 2:
            continue
        # Candidate thresholds: midpoints between sorted unique values.
        for k in range(len(col) - 1):
            thr = 0.5 * (col[k] + col[k + 1])
            left_sum = 0.0
            left_n = 0
            right_sum = 0.0
            right_n = 0
            for i in range(n):
                if X[i][fi] <= thr:
                    left_sum += residuals[i]
                    left_n += 1
                else:
                    right_sum += residuals[i]
                    right_n += 1
            if left_n == 0 or right_n == 0:
                continue
            left_val = left_sum / left_n
            right_val = right_sum / right_n
            sse = 0.0
            for i in range(n):
                if X[i][fi] <= thr:
                    sse += (residuals[i] - left_val) ** 2
                else:
                    sse += (residuals[i] - right_val) ** 2
            if sse < best[4]:
                best = (fi, thr, left_val, right_val, sse)

    return best


def _train_gbm(
    X: list[list[float]],
    y: list[int],
    *,
    n_rounds: int = 30,
    lr: float = 0.2,
    seed: int = 42,
    max_features_per_split: int = 16,
) -> list[dict]:
    """Return list of stumps. Each stump: {f, t, L, R}."""
    rng = random.Random(seed)
    n_features = len(X[0]) if X else 0
    preds = [0.0] * len(X)
    stumps: list[dict] = []

    for _ in range(n_rounds):
        residuals = [
            (y[i] - _sigmoid(preds[i])) for i in range(len(X))
        ]
        # Random feature subset per round for speed + anti-overfit.
        if n_features <= max_features_per_split:
            feat_idxs = list(range(n_features))
        else:
            feat_idxs = rng.sample(range(n_features), max_features_per_split)

        fi, thr, left_v, right_v, sse = _best_stump(X, residuals, feat_idxs)
        if not math.isfinite(sse):
            break

        stumps.append({"f": fi, "t": thr, "L": lr * left_v, "R": lr * right_v})
        for i in range(len(X)):
            preds[i] += (lr * left_v) if X[i][fi] <= thr else (lr * right_v)

    return stumps


def _score_gbm(stumps: list[dict], vec: list[float]) -> float:
    total = 0.0
    for s in stumps:
        fi = s["f"]
        if fi < len(vec):
            xv = vec[fi]
        else:
            xv = 0.0
        total += s["L"] if xv <= s["t"] else s["R"]
    return _sigmoid(total)


# ---------------------------------------------------------------------------
# Held-out split + accuracy
# ---------------------------------------------------------------------------

def _shuffle_and_split(
    X: list[list[float]], y: list[int], *, holdout: float = 0.2, seed: int = 42,
) -> tuple[list[list[float]], list[int], list[list[float]], list[int]]:
    rng = random.Random(seed)
    idx = list(range(len(X)))
    rng.shuffle(idx)
    cut = int(len(idx) * (1.0 - holdout))
    train = idx[:cut]
    test = idx[cut:]
    Xtr = [X[i] for i in train]
    ytr = [y[i] for i in train]
    Xte = [X[i] for i in test]
    yte = [y[i] for i in test]
    return Xtr, ytr, Xte, yte


def _accuracy(preds: list[float], y: list[int]) -> float:
    if not y:
        return 0.0
    correct = sum(1 for p, yi in zip(preds, y) if (p >= 0.5) == bool(yi))
    return correct / len(y)


# ---------------------------------------------------------------------------
# Unified model_v serialization
# ---------------------------------------------------------------------------

def _serialize_logreg(
    w: list[float], b: float, keys: list[str], acc: float, n: int,
) -> dict:
    return {
        "model_type": "logreg",
        "feature_keys": keys,
        "weights": w,
        "bias": b,
        "accuracy": acc,
        "n_samples": n,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }


def _serialize_gbm(
    stumps: list[dict], keys: list[str], acc: float, n: int,
) -> dict:
    return {
        "model_type": "gbm",
        "feature_keys": keys,
        "stumps": stumps,
        "accuracy": acc,
        "n_samples": n,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }


def score_with_model(features: dict[str, float], model_v: dict | None) -> float | None:
    """Run stored model_v against a feature dict. Returns probability in [0, 1].

    Returns None if ``model_v`` is None, malformed, or unrecognized. Phase I
    treats a None return as 'no model available' and falls back to rules.
    """
    if not model_v or not isinstance(model_v, dict):
        return None
    keys = model_v.get("feature_keys") or []
    if not keys:
        return None
    vec = features_to_vector(features, keys)
    mt = model_v.get("model_type")

    if mt == "logreg":
        w = model_v.get("weights") or []
        b = float(model_v.get("bias") or 0.0)
        if len(w) != len(keys):
            return None
        return _score_logreg(w, b, vec)

    if mt == "gbm":
        stumps = model_v.get("stumps") or []
        if not stumps:
            return None
        return _score_gbm(stumps, vec)

    return None


# ---------------------------------------------------------------------------
# In-memory fit (used by tests + by the Supabase-backed fit_preference_model)
# ---------------------------------------------------------------------------

def fit_in_memory(
    rows: list[tuple[dict[str, float], int]],
    *,
    seed: int = 42,
    min_decisions: int = 200,
) -> dict | None:
    """Train on ``[(features_dict, label), ...]`` and return the best model_v.

    ``label`` should be 1 for like/super_like, 0 for pass. Returns None when
    ``len(rows) < min_decisions`` so callers don't accidentally serve a
    wobbly model. The trainer caller (``fit_preference_model``) is
    responsible for pulling rows + writing back to Supabase.
    """
    if len(rows) < min_decisions:
        return None

    keys = feature_keys()
    X: list[list[float]] = []
    y: list[int] = []
    for feats, label in rows:
        X.append(features_to_vector(feats, keys))
        y.append(int(bool(label)))

    if not X or not y:
        return None
    # Need both classes represented to learn anything.
    if len(set(y)) < 2:
        return None

    Xtr, ytr, Xte, yte = _shuffle_and_split(X, y, seed=seed)

    # Guard against a degenerate split where one of the sides has a single
    # class (can happen on very imbalanced small corpora).
    if len(set(ytr)) < 2 or len(set(yte)) < 2:
        Xtr, ytr, Xte, yte = X, y, X, y

    # Fit logreg
    w, b = _train_logreg(Xtr, ytr, seed=seed)
    logreg_preds = [_score_logreg(w, b, xi) for xi in Xte]
    logreg_acc = _accuracy(logreg_preds, yte)
    logreg_v = _serialize_logreg(w, b, keys, logreg_acc, len(rows))

    # Fit GBM
    stumps = _train_gbm(Xtr, ytr, seed=seed)
    gbm_preds = [_score_gbm(stumps, xi) for xi in Xte]
    gbm_acc = _accuracy(gbm_preds, yte)
    gbm_v = _serialize_gbm(stumps, keys, gbm_acc, len(rows))

    # Keep whichever wins on held-out accuracy. Tie -> logreg (simpler + faster
    # to inference, and serialized weights are smaller in Supabase).
    if gbm_acc > logreg_acc:
        log.info(
            "fit_in_memory: gbm wins (acc=%.3f vs logreg=%.3f) on n=%d",
            gbm_acc, logreg_acc, len(rows),
        )
        return gbm_v

    log.info(
        "fit_in_memory: logreg wins (acc=%.3f vs gbm=%.3f) on n=%d",
        logreg_acc, gbm_acc, len(rows),
    )
    return logreg_v


# ---------------------------------------------------------------------------
# Supabase fit
# ---------------------------------------------------------------------------

def _supabase_creds() -> tuple[str, str]:
    # Use the same env loader as scoring for consistency.
    from clapcheeks.scoring import _supabase_creds as _scoring_creds

    return _scoring_creds()


def _load_decisions(user_id: str, limit: int = 5000) -> list[dict]:
    """Fetch the most recent ``limit`` decisions for ``user_id``."""
    import requests

    url, key = _supabase_creds()
    resp = requests.get(
        f"{url}/rest/v1/clapcheeks_swipe_decisions",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,features,decision,julian_override,decided_at",
            "order": "decided_at.desc",
            "limit": str(limit),
        },
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _write_model_v(user_id: str, model_v: dict) -> None:
    """PATCH clapcheeks_user_settings.preference_model_v for ``user_id``."""
    import requests

    url, key = _supabase_creds()
    patch_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = requests.patch(
        f"{url}/rest/v1/clapcheeks_user_settings",
        params={"user_id": f"eq.{user_id}"},
        headers=patch_headers,
        json={"preference_model_v": model_v},
        timeout=15,
    )
    if r.status_code >= 300:
        # Fall back to upsert in case the row doesn't exist yet.
        log.warning(
            "preference_model_v PATCH status %s, trying upsert", r.status_code,
        )
        r2 = requests.post(
            f"{url}/rest/v1/clapcheeks_user_settings",
            headers={**patch_headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            json={"user_id": user_id, "preference_model_v": model_v},
            timeout=15,
        )
        r2.raise_for_status()


def fit_preference_model(user_id: str, min_decisions: int = 200) -> dict | None:
    """Pull decisions from Supabase, fit a model, write weights back.

    Returns the model_v dict on success, None if insufficient data or fit
    was degenerate. Called by the Phase H daemon worker once/day at 04:00 PT.
    """
    try:
        rows = _load_decisions(user_id)
    except Exception as exc:
        log.error("fit_preference_model: load failed: %s", exc)
        return None

    if len(rows) < min_decisions:
        log.info(
            "fit_preference_model: only %d decisions for %s (min=%d), skipping",
            len(rows), user_id, min_decisions,
        )
        return None

    pairs: list[tuple[dict, int]] = []
    for row in rows:
        feats = row.get("features") or {}
        if isinstance(feats, str):
            try:
                feats = json.loads(feats)
            except Exception:
                continue
        if not isinstance(feats, dict):
            continue
        decision = row.get("decision")
        label = 1 if decision in ("like", "super_like") else 0
        pairs.append((feats, label))

    model_v = fit_in_memory(pairs, min_decisions=min_decisions)
    if model_v is None:
        return None

    try:
        _write_model_v(user_id, model_v)
    except Exception as exc:
        log.error("fit_preference_model: write failed: %s", exc)
        return None

    log.info(
        "fit_preference_model: %s model trained (acc=%.3f, n=%d) and saved",
        model_v["model_type"], model_v["accuracy"], model_v["n_samples"],
    )
    return model_v


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog="python -m clapcheeks.ml.trainer")
    parser.add_argument("--user-id", required=True, help="auth.users.id")
    parser.add_argument("--min-decisions", type=int, default=200)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    model_v = fit_preference_model(args.user_id, min_decisions=args.min_decisions)
    if model_v is None:
        print(json.dumps({"ok": False, "reason": "insufficient_data_or_fit_failed"}))
        return 1
    summary = {
        "ok": True,
        "model_type": model_v["model_type"],
        "accuracy": model_v["accuracy"],
        "n_samples": model_v["n_samples"],
        "trained_at": model_v["trained_at"],
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
