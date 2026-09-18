import { sma } from '../math.js';

/**
 * 平均回帰: 現在値と SMA(lookback) の乖離（対数）の一部 (beta) がホライズン内に戻ると仮定。
 */
export function meanReversionPredictor({ lookback = 20, beta = 0.3 } = {}) {
  return {
    id: 'meanReversion',
    predict(ctx) {
      const c = ctx.closes;
      const lb = Math.min(lookback, c.length);
      const m = sma(c, lb);
      const dev = Math.log(c[c.length - 1] / m);
      // ホライズンが長いほど戻る割合が増える（上限 1）
      const frac = Math.min(1, beta * Math.sqrt(ctx.horizonSteps / Math.max(1, lb / 4)));
      return { mu: -dev * frac, sigma: ctx.vol * Math.sqrt(ctx.horizonSteps) };
    },
  };
}
