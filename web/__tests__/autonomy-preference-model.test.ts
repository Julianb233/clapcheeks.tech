// AI-8329 Phase 44 — AUTO-01 coverage: the preference model must predict swipes
// with >70% accuracy on a learnable dataset (the stated success criterion).

import { describe, expect, test } from "vitest";

import {
  crossValidateAccuracy,
  emptyModel,
  evaluateAccuracy,
  predict,
  sigmoid,
  trainAndScore,
  trainModel,
} from "../lib/autonomy/preference-model";
import type { SwipeDecision } from "../lib/autonomy/types";

// Deterministic PRNG so the >70% assertion is stable in CI.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1103515245 * s + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Synthetic "operator" preference: likes tall, verified, close-by profiles;
// dislikes far, unverified. We add noise so it isn't perfectly separable —
// a real preference never is — and require the model to still clear 70%.
function makeDataset(n: number, seed = 42): SwipeDecision[] {
  const rand = lcg(seed);
  const out: SwipeDecision[] = [];
  for (let i = 0; i < n; i++) {
    const height = 60 + rand() * 20; // 60..80 in
    const distance = rand() * 50; // 0..50 km
    const verified = rand() > 0.5 ? 1 : 0;
    const photos = 1 + Math.floor(rand() * 6);
    // latent score the operator "feels"
    const score =
      0.25 * (height - 68) - 0.12 * (distance - 15) + 1.4 * verified + 0.15 * photos;
    const noise = (rand() - 0.5) * 1.5;
    const like = score + noise > 0 ? "like" : "pass";
    out.push({
      direction: like,
      features: { height, distance, verified, photos },
      source: "manual",
    });
  }
  return out;
}

describe("sigmoid", () => {
  test("is stable and monotonic", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6);
    expect(sigmoid(100)).toBeCloseTo(1, 6);
    expect(sigmoid(-100)).toBeCloseTo(0, 6);
    expect(sigmoid(2)).toBeGreaterThan(sigmoid(1));
  });
});

describe("empty / degenerate models", () => {
  test("emptyModel predicts a coin flip with zero confidence", () => {
    const p = predict(emptyModel(), { a: 5 });
    expect(p.probability).toBeCloseTo(0.5, 6);
    expect(p.confidence).toBeCloseTo(0, 6);
  });

  test("training on zero decisions returns an empty model", () => {
    const m = trainModel([]);
    expect(m.featureKeys).toEqual([]);
    expect(m.nSamples).toBe(0);
  });
});

describe("AUTO-01 preference learning", () => {
  const data = makeDataset(300);

  test("train-set accuracy is high on a learnable signal", () => {
    const model = trainModel(data);
    const { accuracy } = evaluateAccuracy(model, data);
    expect(accuracy).toBeGreaterThan(0.8);
  });

  test("cross-validated accuracy clears the >70% bar", () => {
    const cv = crossValidateAccuracy(data, 5);
    expect(cv).toBeGreaterThan(0.7);
  });

  test("trainAndScore stamps honest accuracy and sample count", () => {
    const model = trainAndScore(data);
    expect(model.accuracy).toBeGreaterThan(0.7);
    expect(model.nSamples).toBe(data.length);
    expect(model.version).toBe(1);
  });

  test("learned weights reflect the true preference directions", () => {
    const model = trainModel(data);
    // operator likes verified + taller, dislikes distance
    expect(model.weights.verified).toBeGreaterThan(0);
    expect(model.weights.height).toBeGreaterThan(0);
    expect(model.weights.distance).toBeLessThan(0);
  });

  test("predict handles missing features via feature means", () => {
    const model = trainModel(data);
    const p = predict(model, { height: 75, verified: 1 }); // no distance/photos
    expect(p.probability).toBeGreaterThanOrEqual(0);
    expect(p.probability).toBeLessThanOrEqual(1);
    expect(["like", "pass"]).toContain(p.direction);
  });

  test("auto-sourced decisions do not pollute training", () => {
    const poisoned: SwipeDecision[] = [
      ...data,
      // 50 garbage auto rows that would wreck the model if trained on
      ...Array.from({ length: 50 }, (_, i) => ({
        direction: (i % 2 === 0 ? "like" : "pass") as "like" | "pass",
        features: { height: 68, distance: 25, verified: 0, photos: 3 },
        source: "auto" as const,
      })),
    ];
    const model = trainAndScore(poisoned);
    expect(model.nSamples).toBe(data.length); // auto rows excluded
    expect(model.accuracy).toBeGreaterThan(0.7);
  });

  test("confidence rises as probability moves away from 0.5", () => {
    const model = trainModel(data);
    const strong = predict(model, { height: 80, distance: 1, verified: 1, photos: 6 });
    const weak = predict(model, { height: 68, distance: 15, verified: 1, photos: 3 });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });
});
