// AI-8329 Phase 44 — AUTO-06: Confidence dashboard.
//
// Aggregates the signals the operator needs to trust (or distrust) hands-off
// mode at a glance: how good the preference model is, how confident recent
// decisions were, and what share of actions the engine auto-sent vs. parked
// for approval. Pure aggregation over rows the Convex wrapper fetches.

import type { PreferenceModel } from "./types";

export interface ApprovalRow {
  status: "pending" | "approved" | "rejected" | "expired";
  confidence: number;
}

export interface ConfidenceBuckets {
  high: number; // confidence >= 0.75
  medium: number; // 0.4 <= confidence < 0.75
  low: number; // confidence < 0.4
}

export interface DashboardSummary {
  model: {
    trained: boolean;
    accuracy: number; // cross-validated, [0,1]; -1 if untrained
    meetsThreshold: boolean; // accuracy >= 0.7 (AUTO-01 bar)
    nSamples: number;
    topFeatures: Array<{ feature: string; weight: number }>;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    approvalRate: number; // approved / (approved + rejected)
    avgConfidence: number;
    buckets: ConfidenceBuckets;
  };
  autonomy: {
    autoSendable: number; // rows that would auto-send at the given floor
    queued: number; // rows that would queue
    autoRatio: number; // autoSendable / total
  };
}

export function bucketConfidence(values: number[]): ConfidenceBuckets {
  const buckets: ConfidenceBuckets = { high: 0, medium: 0, low: 0 };
  for (const c of values) {
    if (c >= 0.75) buckets.high++;
    else if (c >= 0.4) buckets.medium++;
    else buckets.low++;
  }
  return buckets;
}

export function topFeatures(
  model: PreferenceModel,
  limit = 5,
): Array<{ feature: string; weight: number }> {
  return Object.entries(model.weights)
    .map(([feature, weight]) => ({ feature, weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, limit);
}

export interface SummarizeArgs {
  model: PreferenceModel;
  approvals: ApprovalRow[];
  /** confidence floor used to classify auto-sendable vs. queued (auto_send). */
  autoSendFloor?: number;
}

export function summarizeConfidence(args: SummarizeArgs): DashboardSummary {
  const { model, approvals } = args;
  const floor = args.autoSendFloor ?? 0.4;

  const total = approvals.length;
  const pending = approvals.filter((a) => a.status === "pending").length;
  const approved = approvals.filter((a) => a.status === "approved").length;
  const rejected = approvals.filter((a) => a.status === "rejected").length;
  const expired = approvals.filter((a) => a.status === "expired").length;
  const decided = approved + rejected;
  const approvalRate = decided > 0 ? approved / decided : 0;

  const confidences = approvals.map((a) => a.confidence);
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0;

  const autoSendable = approvals.filter((a) => a.confidence >= floor).length;
  const queued = total - autoSendable;

  return {
    model: {
      trained: model.nSamples > 0 && model.accuracy >= 0,
      accuracy: model.accuracy,
      meetsThreshold: model.accuracy >= 0.7,
      nSamples: model.nSamples,
      topFeatures: topFeatures(model),
    },
    approvals: {
      total,
      pending,
      approved,
      rejected,
      expired,
      approvalRate,
      avgConfidence,
      buckets: bucketConfidence(confidences),
    },
    autonomy: {
      autoSendable,
      queued,
      autoRatio: total > 0 ? autoSendable / total : 0,
    },
  };
}
