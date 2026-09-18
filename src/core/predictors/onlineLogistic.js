import { sigmoid, normalInv, clamp } from '../math.js';
import { FEATURE_COUNT } from '../features.js';

/**
 * オンライン・ロジスティック回帰（SGD, L2 正則化）。
 * 2 つのヘッド（up / down）を持ち、特徴量ベクトルから P(up), P(down) を推定する。
 * 実現結果が判明するたびに learn() で更新されるため、シミュレーションを進めるほど
 * データに適応していく。学習前は中立（mu = 0）を返す。
 *
 * mu への変換: 正規分布仮定 P(X > b) = Φ((mu - b)/sigma) を逆に解き、
 * P(up) と P(down) から整合する mu を求める（平均を取る）。
 */
export function onlineLogisticPredictor({ learningRate = 0.02, l2 = 1e-4, warmup = 30 } = {}) {
  const dim = FEATURE_COUNT + 1; // bias
  const wUp = new Float64Array(dim);
  const wDown = new Float64Array(dim);
  let samples = 0;

  const dot = (w, x) => {
    let s = w[0];
    for (let i = 0; i < x.length; i++) s += w[i + 1] * x[i];
    return s;
  };
  const sgd = (w, x, y, p) => {
    const g = p - y;
    w[0] -= learningRate * g;
    for (let i = 0; i < x.length; i++) w[i + 1] -= learningRate * (g * x[i] + l2 * w[i + 1]);
  };

  return {
    id: 'onlineLogistic',
    get samples() {
      return samples;
    },
    predict(ctx) {
      const sigma = ctx.vol * Math.sqrt(ctx.horizonSteps);
      const x = ctx.features.vector;
      const pUp = sigmoid(dot(wUp, x));
      const pDown = sigmoid(dot(wDown, x));
      // 学習が浅いうちは中立に寄せる（shrinkage）
      const conf = Math.min(1, samples / warmup);
      const b = ctx.spreadLog;
      const muUp = b + sigma * normalInv(clamp(pUp, 0.001, 0.999));
      const muDown = -b - sigma * normalInv(clamp(pDown, 0.001, 0.999));
      const mu = conf * (muUp + muDown) / 2;
      return { mu, sigma, pUp, pDown, samples };
    },
    learn(ctx, outcome) {
      const x = ctx.features.vector;
      sgd(wUp, x, outcome === 'up' ? 1 : 0, sigmoid(dot(wUp, x)));
      sgd(wDown, x, outcome === 'down' ? 1 : 0, sigmoid(dot(wDown, x)));
      samples++;
    },
    reset() {
      wUp.fill(0);
      wDown.fill(0);
      samples = 0;
    },
    weights() {
      return { up: Array.from(wUp), down: Array.from(wDown), samples };
    },
  };
}
