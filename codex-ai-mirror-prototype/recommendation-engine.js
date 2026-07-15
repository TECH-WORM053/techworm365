import { PROTOTYPE_CATALOG } from "./catalog-data.js";

const DEFAULT_SIGNAL = Object.freeze({
  faceAspect: 0.74,
  jawRatio: 0.76,
  proximity: 0.5,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function closeness(value, target, tolerance) {
  return clamp01(1 - Math.abs(value - target) / tolerance);
}

function scoreProduct(product, signal, mood) {
  const profile = product.profile;
  const moodScore = profile[mood] ?? 0.5;
  const aspectScore = closeness(signal.faceAspect, profile.widthToHeight, 0.34);
  const jawScore = closeness(signal.jawRatio, profile.jaw, 0.38);
  const presenceTarget = 0.35 + signal.proximity * 0.65;
  const presenceScore = closeness(profile.presence, presenceTarget, 0.72);

  return moodScore * 0.42 + aspectScore * 0.27 + jawScore * 0.18 + presenceScore * 0.13;
}

export class RecommendationEngine {
  constructor(catalog = PROTOTYPE_CATALOG) {
    this.catalog = [...catalog];
    this.lastRanking = [...catalog];
    this.lastUpdateAt = -Infinity;
    this.updateInterval = 4200;
  }

  rank(signal = DEFAULT_SIGNAL, mood = "glass", now = performance.now(), force = false) {
    const safeSignal = {
      faceAspect: Number.isFinite(signal.faceAspect) ? signal.faceAspect : DEFAULT_SIGNAL.faceAspect,
      jawRatio: Number.isFinite(signal.jawRatio) ? signal.jawRatio : DEFAULT_SIGNAL.jawRatio,
      proximity: clamp01(signal.proximity ?? DEFAULT_SIGNAL.proximity),
    };

    if (!force && now - this.lastUpdateAt < this.updateInterval) {
      return this.lastRanking;
    }

    const previousIndex = new Map(this.lastRanking.map((product, index) => [product.id, index]));
    this.lastRanking = [...this.catalog].sort((a, b) => {
      const scoreDifference = scoreProduct(b, safeSignal, mood) - scoreProduct(a, safeSignal, mood);
      if (Math.abs(scoreDifference) > 0.018) return scoreDifference;
      return (previousIndex.get(a.id) ?? 0) - (previousIndex.get(b.id) ?? 0);
    });
    this.lastUpdateAt = now;
    return this.lastRanking;
  }

  reset() {
    this.lastRanking = [...this.catalog];
    this.lastUpdateAt = -Infinity;
  }
}
