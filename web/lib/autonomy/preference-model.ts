// AI-8329 Phase 44 — AUTO-01: Preference learning.
//
// A small, explainable logistic-regression preference model. It learns which
// candidate features correlate with the operator's "like" swipes and predicts
// P(like) for new candidates. Kept deliberately simple (one linear layer +
// sigmoid, batch gradient descent, L2 regularization) so:
//   1. every weight is human-inspectable ("she likes tall + verified"),
//   2. it trains in-process inside a Convex mutation with no native deps,
//   3. it's fully unit-testable as pure functions.
//
// Success criterion (AUTO-01): predict swipe with >70% accuracy. We report an
// honest k-fold cross-validated accuracy rather than train-set accuracy so the
// dashboard number can't lie.

import type {
  PreferenceModel,
  Prediction,
  SwipeDecision,
  SwipeDirection,
} from "./types";

export const MODEL_VERSION = 1;

export function sigmoid(z: number): number {
  // Numerically stable sigmoid.
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

export function emptyModel(): PreferenceModel {
  return {
    weights: {},
    bias: 0,
    featureKeys: [],
    nSamples: 0,
    accuracy: -1,
    featureMeans: {},
    version: MODEL_VERSION,
  };
}

/** Collect the union of feature keys across all decisions, in stable order. */
export function collectFeatureKeys(decisions: SwipeDecision[]): string[] {
  const seen = new Set<string>();
  for (const d of decisions) {
    for (const k of Object.keys(d.features)) seen.add(k);
  }
  return Array.from(seen).sort();
}

function computeMeans(
  decisions: SwipeDecision[],
  keys: string[],
): Record<string, number> {
  const means: Record<string, number> = {};
  if (decisions.length === 0) {
    for (const k of keys) means[k] = 0;
    return means;
  }
  for (const k of keys) {
    let sum = 0;
    for (const d of decisions) sum += d.features[k] ?? 0;
    means[k] = sum / decisions.length;
  }
  return means;
}

/**
 * Standardization stats (mean/std per feature) so gradient descent converges
 * regardless of raw feature scale (age in years vs. distance in km).
 */
function computeStd(
  decisions: SwipeDecision[],
  keys: string[],
  means: Record<string, number>,
): Record<string, number> {
  const std: Record<string, number> = {};
  for (const k of keys) {
    let s = 0;
    for (const d of decisions) {
      const x = d.features[k] ?? 0;
      s += (x - means[k]) * (x - means[k]);
    }
    const variance = decisions.length > 0 ? s / decisions.length : 0;
    // guard against zero-variance (constant) features
    std[k] = variance > 1e-9 ? Math.sqrt(variance) : 1;
  }
  return std;
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

/**
 * Train a preference model from labelled decisions using batch gradient
 * descent on the standardized features, then fold the standardization back
 * into the returned raw-feature weights so `predict()` can consume raw
 * features directly.
 */
export function trainModel(
  decisions: SwipeDecision[],
  opts: TrainOptions = {},
): PreferenceModel {
  const epochs = opts.epochs ?? 400;
  const lr = opts.learningRate ?? 0.3;
  const l2 = opts.l2 ?? 0.001;

  const keys = collectFeatureKeys(decisions);
  const model = emptyModel();
  model.featureKeys = keys;
  model.nSamples = decisions.length;
  model.featureMeans = computeMeans(decisions, keys);

  if (decisions.length === 0 || keys.length === 0) {
    return model;
  }

  const means = model.featureMeans;
  const std = computeStd(decisions, keys, means);

  // Standardized design matrix.
  const X = decisions.map((d) =>
    keys.map((k) => ((d.features[k] ?? means[k]) - means[k]) / std[k]),
  );
  const y = decisions.map((d) => (d.direction === "like" ? 1 : 0));

  // Standardized-space parameters.
  const w = new Array(keys.length).fill(0);
  let b = 0;
  const n = decisions.length;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(keys.length).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < keys.length; j++) z += w[j] * X[i][j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < keys.length; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }
    for (let j = 0; j < keys.length; j++) {
      // average gradient + L2 (bias is not regularized)
      w[j] -= lr * (gradW[j] / n + l2 * w[j]);
    }
    b -= lr * (gradB / n);
  }

  // Fold standardization back into raw-feature space:
  //   z = b + Σ w_j * (x_j - mean_j)/std_j
  //     = (b - Σ w_j*mean_j/std_j) + Σ (w_j/std_j) * x_j
  const weights: Record<string, number> = {};
  let rawBias = b;
  for (let j = 0; j < keys.length; j++) {
    const raw = w[j] / std[keys[j]];
    weights[keys[j]] = raw;
    rawBias -= raw * means[keys[j]];
  }
  model.weights = weights;
  model.bias = rawBias;
  return model;
}

/** Predict P(like) and confidence for a raw feature vector. */
export function predict(
  model: PreferenceModel,
  features: Record<string, number>,
): Prediction {
  let z = model.bias;
  for (const k of model.featureKeys) {
    const x = features[k] ?? model.featureMeans[k] ?? 0;
    z += (model.weights[k] ?? 0) * x;
  }
  const probability = sigmoid(z);
  const confidence = Math.min(1, Math.abs(probability - 0.5) * 2);
  const direction: SwipeDirection = probability >= 0.5 ? "like" : "pass";
  return { probability, confidence, direction };
}

/** Train-set accuracy — optimistic, use only for sanity checks. */
export function evaluateAccuracy(
  model: PreferenceModel,
  decisions: SwipeDecision[],
): { accuracy: number; n: number; correct: number } {
  if (decisions.length === 0) return { accuracy: 0, n: 0, correct: 0 };
  let correct = 0;
  for (const d of decisions) {
    const pred = predict(model, d.features);
    if (pred.direction === d.direction) correct++;
  }
  return { accuracy: correct / decisions.length, n: decisions.length, correct };
}

/**
 * Honest k-fold cross-validated accuracy. This is the number AUTO-01's >70%
 * criterion should be measured against — it never trains and tests on the same
 * row. Falls back to train-set accuracy when there aren't enough samples to
 * fold.
 */
export function crossValidateAccuracy(
  decisions: SwipeDecision[],
  k = 5,
  opts: TrainOptions = {},
): number {
  const n = decisions.length;
  if (n < 2) return 0;
  const folds = Math.min(k, n);
  if (folds < 2) {
    return evaluateAccuracy(trainModel(decisions, opts), decisions).accuracy;
  }

  let correct = 0;
  let total = 0;
  for (let f = 0; f < folds; f++) {
    const test: SwipeDecision[] = [];
    const train: SwipeDecision[] = [];
    for (let i = 0; i < n; i++) {
      if (i % folds === f) test.push(decisions[i]);
      else train.push(decisions[i]);
    }
    if (train.length === 0 || test.length === 0) continue;
    const m = trainModel(train, opts);
    for (const d of test) {
      if (predict(m, d.features).direction === d.direction) correct++;
      total++;
    }
  }
  return total > 0 ? correct / total : 0;
}

/**
 * Full training pipeline used by the Convex wrapper: train on all manual
 * decisions and stamp the honest cross-validated accuracy onto the model.
 */
export function trainAndScore(
  decisions: SwipeDecision[],
  opts: TrainOptions = {},
): PreferenceModel {
  const trainable = decisions.filter((d) => d.source !== "auto");
  const model = trainModel(trainable, opts);
  model.accuracy = crossValidateAccuracy(trainable, 5, opts);
  model.nSamples = trainable.length;
  return model;
}
