// AI-8329 Phase 44 — coverage for AUTO-02 (auto-swipe), AUTO-04 (stale
// recovery), AUTO-05 (approval gates), AUTO-06 (confidence dashboard).

import { describe, expect, test } from "vitest";

import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_SWIPE_THRESHOLDS,
  decideSwipe,
  planAutoSwipes,
  swipesInWindow,
  withinRateLimit,
} from "../lib/autonomy/auto-swipe";
import {
  DEFAULT_GATE_THRESHOLDS,
  routeAction,
  shouldSend,
} from "../lib/autonomy/approval-gate";
import {
  DEFAULT_STALE_CONFIG,
  findStaleConversations,
} from "../lib/autonomy/stale-recovery";
import { summarizeConfidence } from "../lib/autonomy/confidence-dashboard";
import { trainAndScore } from "../lib/autonomy/preference-model";
import type {
  Prediction,
  PreferenceModel,
  StaleConversation,
  SwipeDecision,
} from "../lib/autonomy/types";

const NOW = 1_700_000_000_000;

function pred(probability: number): Prediction {
  return {
    probability,
    confidence: Math.min(1, Math.abs(probability - 0.5) * 2),
    direction: probability >= 0.5 ? "like" : "pass",
  };
}

describe("AUTO-02 auto-swipe decisions", () => {
  const empty = { recentSwipeTimestamps: [] as number[] };

  test("likes high-probability candidates", () => {
    const o = decideSwipe({ prediction: pred(0.9), now: NOW, rateState: empty });
    expect(o.action).toBe("like");
  });

  test("passes low-probability candidates", () => {
    const o = decideSwipe({ prediction: pred(0.1), now: NOW, rateState: empty });
    expect(o.action).toBe("pass");
  });

  test("skips low-confidence (grey-zone) candidates", () => {
    const o = decideSwipe({ prediction: pred(0.5), now: NOW, rateState: empty });
    expect(o.action).toBe("skip");
    expect(o.reason).toContain("low_confidence");
  });

  test("skips the grey zone even when confident-ish but between thresholds", () => {
    // probability 0.55 -> confidence 0.10 which is < minConfidence, so skip.
    const o = decideSwipe({ prediction: pred(0.55), now: NOW, rateState: empty });
    expect(o.action).toBe("skip");
  });

  test("STOPS when the rate-limit window is exhausted", () => {
    const full = {
      recentSwipeTimestamps: Array.from(
        { length: DEFAULT_RATE_LIMIT.maxPerWindow },
        () => NOW - 1000,
      ),
    };
    const o = decideSwipe({ prediction: pred(0.95), now: NOW, rateState: full });
    expect(o.action).toBe("stop");
    expect(o.reason).toContain("rate_limit_reached");
  });

  test("rate-limit window ignores timestamps outside the window", () => {
    const old = {
      recentSwipeTimestamps: Array.from(
        { length: 200 },
        () => NOW - DEFAULT_RATE_LIMIT.windowMs - 1,
      ),
    };
    expect(swipesInWindow(old, NOW, DEFAULT_RATE_LIMIT)).toBe(0);
    expect(withinRateLimit(old, NOW, DEFAULT_RATE_LIMIT)).toBe(true);
  });

  test("planAutoSwipes stops the batch and never exceeds the budget", () => {
    const model: PreferenceModel = {
      weights: { x: 10 },
      bias: 0,
      featureKeys: ["x"],
      nSamples: 10,
      accuracy: 0.9,
      featureMeans: { x: 0 },
      version: 1,
    };
    const rateLimit = { maxPerWindow: 3, windowMs: 60_000 };
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      features: { x: 1 }, // all strong likes
    }));
    const plan = planAutoSwipes(
      model,
      candidates,
      NOW,
      { recentSwipeTimestamps: [] },
      DEFAULT_SWIPE_THRESHOLDS,
      rateLimit,
    );
    const likes = plan.filter((p) => p.outcome.action === "like").length;
    const stopped = plan.some((p) => p.outcome.action === "stop");
    expect(likes).toBe(3); // exactly the budget
    expect(stopped).toBe(true); // 4th attempt halts the batch
    expect(plan[plan.length - 1].outcome.action).toBe("stop");
  });
});

describe("AUTO-05 approval gates", () => {
  test("supervised always queues, regardless of confidence", () => {
    expect(routeAction({ level: "supervised", confidence: 0.99 }).route).toBe("queue");
    expect(routeAction({ level: "supervised", confidence: 0.01 }).route).toBe("queue");
  });

  test("semi_auto sends only high-confidence", () => {
    expect(routeAction({ level: "semi_auto", confidence: 0.8 }).route).toBe("send");
    expect(routeAction({ level: "semi_auto", confidence: 0.5 }).route).toBe("queue");
  });

  test("auto_send sends above the floor, queues below", () => {
    expect(routeAction({ level: "auto_send", confidence: 0.5 }).route).toBe("send");
    expect(routeAction({ level: "auto_send", confidence: 0.2 }).route).toBe("queue");
  });

  test("full_auto sends almost everything but respects the safety floor", () => {
    expect(routeAction({ level: "full_auto", confidence: 0.2 }).route).toBe("send");
    expect(routeAction({ level: "full_auto", confidence: 0.05 }).route).toBe("queue");
  });

  test("per-match override:always_approve forces the queue", () => {
    const r = routeAction({
      level: "full_auto",
      confidence: 0.99,
      matchOverride: "always_approve",
    });
    expect(r.route).toBe("queue");
    expect(r.reason).toContain("always_approve");
  });

  test("per-match override:always_send forces send but not below safety floor", () => {
    expect(
      routeAction({ level: "supervised", confidence: 0.9, matchOverride: "always_send" })
        .route,
    ).toBe("send");
    expect(
      routeAction({ level: "supervised", confidence: 0.05, matchOverride: "always_send" })
        .route,
    ).toBe("queue");
  });

  test("shouldSend mirrors routeAction", () => {
    expect(shouldSend({ level: "auto_send", confidence: 0.9 })).toBe(true);
    expect(shouldSend({ level: "supervised", confidence: 0.9 })).toBe(false);
  });

  test("out-of-range confidence is clamped", () => {
    expect(routeAction({ level: "auto_send", confidence: 2 }).route).toBe("send");
    expect(routeAction({ level: "auto_send", confidence: -1 }).route).toBe("queue");
    expect(routeAction({ level: "auto_send", confidence: Number.NaN }).route).toBe("queue");
  });

  test("thresholds are configurable", () => {
    const strict = { ...DEFAULT_GATE_THRESHOLDS, semiAutoHighConfidence: 0.95 };
    expect(
      routeAction({ level: "semi_auto", confidence: 0.8, thresholds: strict }).route,
    ).toBe("queue");
  });
});

describe("AUTO-04 stale conversation recovery", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const convos: StaleConversation[] = [
    { id: "fresh", status: "active", last_inbound_at: NOW - 1 * DAY },
    { id: "stale", status: "active", last_inbound_at: NOW - 3 * DAY, match_name: "A" },
    { id: "urgent", status: "active", last_message_at: NOW - 7 * DAY, match_name: "B" },
    { id: "dead", status: "active", last_outbound_at: NOW - 12 * DAY, match_name: "C" },
    { id: "dating", status: "dating", last_inbound_at: NOW - 30 * DAY },
    { id: "never", status: "active" }, // no activity timestamps
  ];

  test("flags only recoverable stale conversations", () => {
    const res = findStaleConversations(convos, NOW, DEFAULT_STALE_CONFIG);
    const ids = res.map((r) => r.id);
    expect(ids).toContain("stale");
    expect(ids).toContain("urgent");
    expect(ids).toContain("dead");
    expect(ids).not.toContain("fresh"); // too recent
    expect(ids).not.toContain("dating"); // terminal status
    expect(ids).not.toContain("never"); // no activity
  });

  test("assigns recommendations by idle severity", () => {
    const res = findStaleConversations(convos, NOW, DEFAULT_STALE_CONFIG);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    expect(byId.stale.recommendation).toBe("reengage");
    expect(byId.urgent.recommendation).toBe("final_bump");
    expect(byId.dead.recommendation).toBe("mark_dead");
  });

  test("orders actionable (final_bump/reengage) ahead of dead", () => {
    const res = findStaleConversations(convos, NOW, DEFAULT_STALE_CONFIG);
    const deadIdx = res.findIndex((r) => r.recommendation === "mark_dead");
    const reengageIdx = res.findIndex((r) => r.recommendation !== "mark_dead");
    expect(reengageIdx).toBeLessThan(deadIdx);
  });
});

describe("AUTO-06 confidence dashboard", () => {
  const decisions: SwipeDecision[] = Array.from({ length: 60 }, (_, i) => ({
    direction: (i % 2 === 0 ? "like" : "pass") as "like" | "pass",
    features: { a: i % 2 === 0 ? 1 : -1 },
    source: "manual" as const,
  }));

  test("summarizes model + approvals + autonomy split", () => {
    const model = trainAndScore(decisions);
    const approvals = [
      { status: "approved" as const, confidence: 0.9 },
      { status: "approved" as const, confidence: 0.8 },
      { status: "rejected" as const, confidence: 0.5 },
      { status: "pending" as const, confidence: 0.3 },
      { status: "expired" as const, confidence: 0.2 },
    ];
    const s = summarizeConfidence({ model, approvals, autoSendFloor: 0.4 });

    expect(s.model.trained).toBe(true);
    expect(s.model.meetsThreshold).toBe(model.accuracy >= 0.7);
    expect(s.approvals.total).toBe(5);
    expect(s.approvals.pending).toBe(1);
    expect(s.approvals.approved).toBe(2);
    expect(s.approvals.rejected).toBe(1);
    expect(s.approvals.expired).toBe(1);
    expect(s.approvals.approvalRate).toBeCloseTo(2 / 3, 6);
    expect(s.approvals.buckets.high).toBe(2); // 0.9, 0.8
    expect(s.approvals.buckets.medium).toBe(1); // 0.5
    expect(s.approvals.buckets.low).toBe(2); // 0.3, 0.2
    // autoSendable: confidence >= 0.4 -> 0.9,0.8,0.5 = 3
    expect(s.autonomy.autoSendable).toBe(3);
    expect(s.autonomy.queued).toBe(2);
    expect(s.autonomy.autoRatio).toBeCloseTo(3 / 5, 6);
  });

  test("handles an empty approval set without dividing by zero", () => {
    const s = summarizeConfidence({ model: trainAndScore(decisions), approvals: [] });
    expect(s.approvals.total).toBe(0);
    expect(s.approvals.approvalRate).toBe(0);
    expect(s.approvals.avgConfidence).toBe(0);
    expect(s.autonomy.autoRatio).toBe(0);
  });

  test("surfaces the most influential features", () => {
    const model = trainAndScore(decisions);
    const s = summarizeConfidence({ model, approvals: [] });
    expect(s.model.topFeatures[0].feature).toBe("a");
  });
});
