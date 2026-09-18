/** 数値ユーティリティ（依存なし） */

export function mean(a) {
  if (!a.length) return NaN;
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

export function std(a, m = mean(a)) {
  if (a.length < 2) return 0;
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return Math.sqrt(s / (a.length - 1));
}

export function sma(a, n) {
  if (a.length < n || n <= 0) return NaN;
  let s = 0;
  for (let i = a.length - n; i < a.length; i++) s += a[i];
  return s / n;
}

/** 系列全体の EMA の最終値 */
export function ema(a, n) {
  if (!a.length) return NaN;
  const k = 2 / (n + 1);
  let e = a[0];
  for (let i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k);
  return e;
}

/** Wilder の RSI (0..100)。データ不足なら 50。 */
export function rsi(prices, n = 14) {
  if (prices.length <= n) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

/**
 * 最小二乗直線 y = a + b x（x = 0..n-1）。
 * @returns {{a:number, b:number, resid:number}} resid = 残差の標準偏差
 */
export function linreg(y) {
  const n = y.length;
  if (n < 2) return { a: y[0] ?? 0, b: 0, resid: 0 };
  const xm = (n - 1) / 2;
  const ym = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xm) * (y[i] - ym);
    sxx += (i - xm) * (i - xm);
  }
  const b = sxx ? sxy / sxx : 0;
  const a = ym - b * xm;
  let se = 0;
  for (let i = 0; i < n; i++) {
    const r = y[i] - (a + b * i);
    se += r * r;
  }
  return { a, b, resid: Math.sqrt(se / Math.max(1, n - 2)) };
}

/** 標準正規分布の累積分布関数（Abramowitz–Stegun 7.1.26 ベース、誤差 ~1e-7） */
export function normalCdf(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** 標準正規分布の逆関数（Acklam のアルゴリズム） */
export function normalInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
