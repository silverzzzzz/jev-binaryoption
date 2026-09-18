import { mean, std, sma, ema, rsi, linreg, clamp } from './math.js';

/**
 * 直近 window 本の終値（tick なら mid）から特徴量を計算する。
 * すべて価格スケールに依存しない（対数リターン or 正規化）値にしてあるので
 * 通貨ペア・銘柄をまたいでオンライン学習モデルに投入できる。
 *
 * @param {number[]} closes 時刻昇順、最後が現在値
 * @param {{emaFast?:number, emaSlow?:number, rsiLen?:number}} [opts]
 * @returns {{vector:number[], names:string[], named:Record<string,number>, vol:number, returns:number[]}}
 */
export function computeFeatures(closes, opts = {}) {
  const emaFast = opts.emaFast ?? 5;
  const emaSlow = opts.emaSlow ?? 20;
  const rsiLen = opts.rsiLen ?? 14;
  const n = closes.length;
  const logs = new Array(n);
  for (let i = 0; i < n; i++) logs[i] = Math.log(closes[i]);
  const returns = new Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) returns[i - 1] = logs[i] - logs[i - 1];
  const vol = Math.max(std(returns), 1e-9);
  const last = logs[n - 1];
  const lagRet = (k) => (n > k ? (last - logs[n - 1 - k]) / (vol * Math.sqrt(k)) : 0);
  const m = mean(returns);
  const cum = returns.reduce((a, b) => a + b, 0);
  const emaF = ema(closes, Math.min(emaFast, n));
  const emaS = ema(closes, Math.min(emaSlow, n));
  const smaAll = sma(closes, n);
  const reg = linreg(logs);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const rangePos = hi > lo ? ((closes[n - 1] - lo) / (hi - lo)) * 2 - 1 : 0;
  const half = Math.floor(returns.length / 2);
  const volRecent = half > 1 ? std(returns.slice(half)) : vol;
  const volRatio = Math.log((volRecent + 1e-9) / (vol + 1e-9));
  const named = {
    ret1: clamp(lagRet(1), -5, 5),
    ret2: clamp(lagRet(2), -5, 5),
    ret3: clamp(lagRet(3), -5, 5),
    ret5: clamp(lagRet(5), -5, 5),
    ret10: clamp(lagRet(10), -5, 5),
    drift: clamp((m / vol) * Math.sqrt(returns.length || 1), -5, 5), // 平均リターンの t 値
    emaDiff: clamp(Math.log(emaF / emaS) / (vol * Math.sqrt(emaSlow)), -5, 5),
    zscore: clamp(Math.log(closes[n - 1] / smaAll) / (vol * Math.sqrt(n)), -5, 5),
    slope: clamp((reg.b / vol) * Math.sqrt(n), -5, 5),
    rsi: (rsi(closes, Math.min(rsiLen, n - 1)) - 50) / 50,
    rangePos,
    volRatio: clamp(volRatio, -3, 3),
    accel: clamp(lagRet(1) - (n > 2 ? (logs[n - 2] - logs[n - 3]) / vol : 0), -5, 5),
    cumRet: clamp(cum / (vol * Math.sqrt(returns.length || 1)), -5, 5),
  };
  const names = Object.keys(named);
  const vector = names.map((k) => (Number.isFinite(named[k]) ? named[k] : 0));
  return { vector, names, named, vol, returns };
}

export const FEATURE_COUNT = 14;
