// AI-8329 Phase 44 — AUTO-02: Auto-swipe mode.
//
// Turns a preference prediction into a concrete swipe action, while respecting
// rate limits and refusing to act when the model isn't confident. This is the
// safety-critical bit: an unbounded auto-swiper gets an account shadow-banned,
// so the rate-limit gate and the low-confidence stop are non-negotiable.
//
// Success criteria (AUTO-02):
//   - Auto-swipe respects rate limits, stops on low confidence.

import { predict } from "./preference-model";
import type {
  PreferenceModel,
  Prediction,
  RateLimitConfig,
  RateLimitState,
  SwipeOutcome,
  SwipeThresholds,
} from "./types";

export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  likeThreshold: 0.62,
  passThreshold: 0.38,
  minConfidence: 0.35,
};

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  // ~1 swipe / 12s sustained; conservative vs. app anti-bot heuristics.
  maxPerWindow: 100,
  windowMs: 60 * 60 * 1000, // 1 hour
};

/** Count engine swipes still inside the rolling window ending at `now`. */
export function swipesInWindow(
  state: RateLimitState,
  now: number,
  config: RateLimitConfig,
): number {
  const cutoff = now - config.windowMs;
  return state.recentSwipeTimestamps.filter((t) => t > cutoff).length;
}

export function withinRateLimit(
  state: RateLimitState,
  now: number,
  config: RateLimitConfig,
): boolean {
  return swipesInWindow(state, now, config) < config.maxPerWindow;
}

export interface DecideSwipeArgs {
  prediction: Prediction;
  now: number;
  rateState: RateLimitState;
  thresholds?: SwipeThresholds;
  rateLimit?: RateLimitConfig;
}

/**
 * Decide a single swipe action.
 *
 * Precedence (most-blocking first):
 *   1. rate limit exhausted        -> "stop"  (halts the whole batch)
 *   2. confidence below floor      -> "skip"  (leave for the human)
 *   3. probability >= likeThresh   -> "like"
 *   4. probability <= passThresh   -> "pass"
 *   5. otherwise (grey zone)       -> "skip"
 */
export function decideSwipe(args: DecideSwipeArgs): SwipeOutcome {
  const thresholds = args.thresholds ?? DEFAULT_SWIPE_THRESHOLDS;
  const rateLimit = args.rateLimit ?? DEFAULT_RATE_LIMIT;
  const { prediction, now, rateState } = args;

  if (!withinRateLimit(rateState, now, rateLimit)) {
    return {
      action: "stop",
      reason: `rate_limit_reached: ${swipesInWindow(rateState, now, rateLimit)}/${rateLimit.maxPerWindow} in ${rateLimit.windowMs}ms window`,
      prediction,
    };
  }

  if (prediction.confidence < thresholds.minConfidence) {
    return {
      action: "skip",
      reason: `low_confidence: ${prediction.confidence.toFixed(2)} < ${thresholds.minConfidence}`,
      prediction,
    };
  }

  if (prediction.probability >= thresholds.likeThreshold) {
    return { action: "like", reason: "high_like_probability", prediction };
  }
  if (prediction.probability <= thresholds.passThreshold) {
    return { action: "pass", reason: "high_pass_probability", prediction };
  }

  return {
    action: "skip",
    reason: `grey_zone: ${prediction.probability.toFixed(2)} between ${thresholds.passThreshold} and ${thresholds.likeThreshold}`,
    prediction,
  };
}

export interface Candidate {
  id: string;
  features: Record<string, number>;
}

export interface PlannedSwipe {
  candidateId: string;
  outcome: SwipeOutcome;
}

/**
 * Plan a batch of swipes against a candidate queue. Simulates the rate-limit
 * budget draining as "like"/"pass" actions are taken so the plan never exceeds
 * the window cap, and short-circuits the moment a "stop" fires. Pure — the
 * caller is responsible for actually executing the returned actions.
 */
export function planAutoSwipes(
  model: PreferenceModel,
  candidates: Candidate[],
  now: number,
  rateState: RateLimitState,
  thresholds: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS,
  rateLimit: RateLimitConfig = DEFAULT_RATE_LIMIT,
): PlannedSwipe[] {
  const plan: PlannedSwipe[] = [];
  // Local copy of the swipe log we mutate as we plan.
  const simulated: number[] = [...rateState.recentSwipeTimestamps];

  for (const c of candidates) {
    const prediction = predict(model, c.features);
    const outcome = decideSwipe({
      prediction,
      now,
      rateState: { recentSwipeTimestamps: simulated },
      thresholds,
      rateLimit,
    });
    plan.push({ candidateId: c.id, outcome });
    if (outcome.action === "stop") break;
    if (outcome.action === "like" || outcome.action === "pass") {
      // this swipe consumes a slice of the rate budget
      simulated.push(now);
    }
  }
  return plan;
}
