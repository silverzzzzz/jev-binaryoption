import { linreg } from '../math.js';

/**
 * 線形トレンド外挿: ウィンドウ内の対数価格を直線回帰し、
 * 傾き × ホライズン歩数を期待リターンとする。残差もばらつきに加える。
 */
export function linearTrendPredictor({ lookback = 30, damping = 0.7 } = {}) {
  return {
    id: 'linearTrend',
    predict(ctx) {
      const c = ctx.closes;
      const lb = Math.min(lookback, c.length);
      const logs = c.slice(c.length - lb).map(Math.log);
      const { a, b, resid } = linreg(logs);
      const fitted = a + b * (lb - 1);
      const gap = fitted - logs[lb - 1]; // 現在値が直線からどれだけ離れているか
      const mu = damping * (b * ctx.horizonSteps + gap);
      const sigma = Math.sqrt(ctx.vol ** 2 * ctx.horizonSteps + resid ** 2);
      return { mu, sigma };
    },
  };
}
