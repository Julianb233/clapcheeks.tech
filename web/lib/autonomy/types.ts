// AI-8329 Phase 44: Autonomy Engine — shared types for the pure-logic core.
//
// These types are framework-agnostic on purpose. The Convex module
// (convex/autonomy.ts) and any Next.js route are thin wrappers over the
// pure functions in this folder, so all the interesting logic stays unit
// testable under vitest (which runs in CI — see .github/workflows/test.yml).

/** Per-user autonomy level. Mirrors the `autonomy_config.global_level` union. */
export type AutonomyLevel =
  | "supervised" // nothing sends without explicit approval
  | "semi_auto" //  only high-confidence actions auto-send, rest queue
  | "auto_send" //  send unless confidence is below the floor
  | "full_auto"; // send everything above a hard safety floor, queue the rest

/** Which way the operator (or the engine) swiped on a candidate. */
export type SwipeDirection = "like" | "pass";

/**
 * A single labelled swipe used to train the preference model.
 * `features` is a flat map of feature-name -> numeric value. Categorical
 * features should be one-hot encoded by the caller before they get here so the
 * model stays a simple, explainable linear scorer.
 */
export interface SwipeDecision {
  direction: SwipeDirection;
  features: Record<string, number>;
  /** unix ms — used for rate-limit windows, not for training. */
  at?: number;
  /** "manual" (operator) or "auto" (engine). Only manual decisions train. */
  source?: "manual" | "auto";
}

/** A trained linear preference model. Explainable: score = sigmoid(w·x + b). */
export interface PreferenceModel {
  /** feature-name -> weight */
  weights: Record<string, number>;
  bias: number;
  /** ordered feature keys the model was trained on */
  featureKeys: string[];
  /** number of labelled samples used to train */
  nSamples: number;
  /** cross-validated accuracy in [0,1]; -1 when not yet evaluated */
  accuracy: number;
  /** feature-mean used to fill missing features at predict time */
  featureMeans: Record<string, number>;
  version: number;
}

export interface Prediction {
  /** P(like) in [0,1] */
  probability: number;
  /** how far from a coin-flip we are, in [0,1]. |p-0.5| * 2 */
  confidence: number;
  /** the direction the model would take at the 0.5 decision boundary */
  direction: SwipeDirection;
}

export interface SwipeThresholds {
  /** like when probability >= this */
  likeThreshold: number;
  /** pass when probability <= this */
  passThreshold: number;
  /** below this confidence, don't act — leave for the human */
  minConfidence: number;
}

export interface RateLimitConfig {
  /** max engine swipes allowed inside the rolling window */
  maxPerWindow: number;
  /** rolling window length in ms */
  windowMs: number;
}

export interface RateLimitState {
  /** timestamps (unix ms) of engine swipes already taken */
  recentSwipeTimestamps: number[];
}

export type SwipeAction = "like" | "pass" | "skip" | "stop";

export interface SwipeOutcome {
  action: SwipeAction;
  reason: string;
  prediction?: Prediction;
}

export type ActionRoute = "send" | "queue" | "drop";

export interface RouteOutcome {
  route: ActionRoute;
  reason: string;
}

export interface StaleConfig {
  /** conversations idle longer than this (ms) are candidates */
  staleAfterMs: number;
  /** past this idle time (ms) we recommend giving up, not re-engaging */
  deadAfterMs: number;
}

export interface StaleConversation {
  id: string;
  status: string;
  match_name?: string;
  platform?: string;
  last_inbound_at?: number;
  last_outbound_at?: number;
  last_message_at?: number;
}

export interface StaleCandidate {
  id: string;
  match_name?: string;
  platform?: string;
  idleMs: number;
  urgency: "low" | "medium" | "high";
  recommendation: "reengage" | "final_bump" | "mark_dead";
}
