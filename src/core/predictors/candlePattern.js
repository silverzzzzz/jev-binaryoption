/**
 * ローソク足形状: 直近 n 本の「実体の向き × 大きさ」と「ヒゲの偏り」からバイアスを推定。
 * tick 系列（OHLC なし）の場合は終値差分だけで代用する。
 */
export function candlePatternPredictor({ bars = 3, gain = 0.5 } = {}) {
  return {
    id: 'candlePattern',
    predict(ctx) {
      const sigma = ctx.vol * Math.sqrt(ctx.horizonSteps);
      const src = ctx.bars;
      if (!src || src.length < 2) return { mu: 0, sigma };
      const n = Math.min(bars, src.length);
      let score = 0;
      let wsum = 0;
      for (let i = 0; i < n; i++) {
        const b = src[src.length - 1 - i];
        const w = 1 / (i + 1);
        const range = Math.max(b.h - b.l, 1e-12);
        const body = (b.c - b.o) / range; // -1..1
        const upperWick = (b.h - Math.max(b.o, b.c)) / range;
        const lowerWick = (Math.min(b.o, b.c) - b.l) / range;
        score += w * (body + (lowerWick - upperWick) * 0.5);
        wsum += w;
      }
      const bias = score / wsum; // -1.5..1.5 程度
      return { mu: gain * bias * ctx.vol * Math.sqrt(ctx.horizonSteps), sigma };
    },
  };
}
