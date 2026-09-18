import { mean } from '../math.js';

/**
 * モメンタム: 直近 lookback 本の平均対数リターン × ホライズン歩数を期待値とする。
 * gain で強さを調整（1 = 過去平均がそのまま続く）。
 */
export function momentumPredictor({ lookback = 10, gain = 1 } = {}) {
  return {
    id: 'momentum',
    predict(ctx) {
      const r = ctx.features.returns;
      const lb = Math.min(lookback, r.length);
      if (!lb) return { mu: 0, sigma: ctx.vol * Math.sqrt(ctx.horizonSteps) };
      const m = mean(r.slice(r.length - lb));
      return { mu: gain * m * ctx.horizonSteps, sigma: ctx.vol * Math.sqrt(ctx.horizonSteps) };
    },
  };
}
