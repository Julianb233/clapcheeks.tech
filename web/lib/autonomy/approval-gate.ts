// AI-8329 Phase 44 — AUTO-05: Approval gates (supervised / semi / auto / full).
//
// One place that decides, for any proposed outbound action (a reply, a swipe,
// a scheduled touch), whether it may SEND now, must QUEUE for human approval,
// or should be DROPped. touches.ts already special-cases "supervised" inline;
// this generalizes that to every level and every action type and supports
// per-match overrides, so the whole engine routes through one predictable
// matrix.
//
// Success criteria (AUTO-05):
//   - Approval gates configurable per match and globally.

import type { ActionRoute, AutonomyLevel, RouteOutcome } from "./types";

export interface GateThresholds {
  /** semi_auto sends only at/above this confidence. */
  semiAutoHighConfidence: number;
  /** auto_send queues anything below this confidence. */
  autoSendFloor: number;
  /** full_auto still queues anything below this hard safety floor. */
  fullAutoSafetyFloor: number;
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  semiAutoHighConfidence: 0.75,
  autoSendFloor: 0.4,
  fullAutoSafetyFloor: 0.15,
};

export interface RouteArgs {
  level: AutonomyLevel;
  /** model/action confidence in [0,1] */
  confidence: number;
  thresholds?: GateThresholds;
  /**
   * Optional per-match override. When set it wins over the global level.
   * "always_approve" forces the queue; "always_send" forces send (still
   * subject to the full-auto safety floor); "inherit" uses the global level.
   */
  matchOverride?: "always_approve" | "always_send" | "inherit";
}

/**
 * Resolve where a proposed action should go.
 *
 * Global level matrix:
 *   supervised  -> always queue
 *   semi_auto   -> send if confidence >= semiAutoHighConfidence, else queue
 *   auto_send   -> send if confidence >= autoSendFloor, else queue
 *   full_auto   -> send if confidence >= fullAutoSafetyFloor, else queue
 *
 * Per-match override:
 *   always_approve -> queue (a specific match Julian wants to hand-check)
 *   always_send    -> send, unless the full-auto safety floor rejects it
 *   inherit/unset  -> use the global matrix
 */
export function routeAction(args: RouteArgs): RouteOutcome {
  const t = args.thresholds ?? DEFAULT_GATE_THRESHOLDS;
  const conf = clamp01(args.confidence);
  const override = args.matchOverride ?? "inherit";

  if (override === "always_approve") {
    return { route: "queue", reason: "match_override:always_approve" };
  }
  if (override === "always_send") {
    if (conf < t.fullAutoSafetyFloor) {
      return {
        route: "queue",
        reason: `match_override:always_send but confidence ${conf.toFixed(2)} < safety floor ${t.fullAutoSafetyFloor}`,
      };
    }
    return { route: "send", reason: "match_override:always_send" };
  }

  switch (args.level) {
    case "supervised":
      return { route: "queue", reason: "level:supervised" };
    case "semi_auto":
      return conf >= t.semiAutoHighConfidence
        ? { route: "send", reason: `semi_auto high confidence ${conf.toFixed(2)}` }
        : {
            route: "queue",
            reason: `semi_auto confidence ${conf.toFixed(2)} < ${t.semiAutoHighConfidence}`,
          };
    case "auto_send":
      return conf >= t.autoSendFloor
        ? { route: "send", reason: `auto_send confidence ${conf.toFixed(2)}` }
        : {
            route: "queue",
            reason: `auto_send confidence ${conf.toFixed(2)} < floor ${t.autoSendFloor}`,
          };
    case "full_auto":
      return conf >= t.fullAutoSafetyFloor
        ? { route: "send", reason: `full_auto confidence ${conf.toFixed(2)}` }
        : {
            route: "queue",
            reason: `full_auto confidence ${conf.toFixed(2)} < safety floor ${t.fullAutoSafetyFloor}`,
          };
    default: {
      // exhaustive-guard: unknown level is treated as the safest option.
      const _never: never = args.level;
      return { route: "queue", reason: `unknown_level:${String(_never)}` };
    }
  }
}

export function shouldSend(args: RouteArgs): boolean {
  return routeAction(args).route === "send";
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export type { ActionRoute };
