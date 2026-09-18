/**
 * デモ・テスト用の合成価格データ生成。
 * ランダムウォークに、周期的なドリフト（トレンド局面）と平均回帰局面を混ぜる。
 */

/** 決定的な疑似乱数 (mulberry32) */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {object} [o]
 * @param {number} [o.n=5000] 点数
 * @param {number} [o.intervalMs=1000]
 * @param {number} [o.start=150] 初期価格
 * @param {number} [o.vol=0.00005] 1 歩あたりの対数リターン標準偏差
 * @param {number} [o.spread=0.003] スプレッド（価格単位）
 * @param {number} [o.trendStrength=0.3] ドリフトの強さ（vol 比）
 * @param {number} [o.regimeLength=300] 局面の平均長さ
 * @param {number} [o.seed=42]
 * @param {number} [o.startTime] 開始時刻（ms）
 * @returns {import('./types.js').Tick[]}
 */
export function generateTicks(o = {}) {
  const n = o.n ?? 5000;
  const intervalMs = o.intervalMs ?? 1000;
  const vol = o.vol ?? 0.00005;
  const spread = o.spread ?? 0.003;
  const trendStrength = o.trendStrength ?? 0.3;
  const regimeLength = o.regimeLength ?? 300;
  const r = rng(o.seed ?? 42);
  let t = o.startTime ?? Date.UTC(2024, 0, 2, 0, 0, 0);
  let logp = Math.log(o.start ?? 150);
  let drift = 0;
  let anchor = logp;
  let regime = 0;
  let left = 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) {
      regime = r() < 0.5 ? 'trend' : 'range';
      left = Math.floor(regimeLength * (0.5 + r()));
      drift = regime === 'trend' ? (r() < 0.5 ? -1 : 1) * trendStrength * vol : 0;
      anchor = logp;
    }
    let step = drift + gauss(r) * vol;
    if (regime === 'range') step += -(logp - anchor) * 0.05;
    logp += step;
    const mid = Math.exp(logp);
    const s = spread * (0.8 + 0.4 * r());
    out.push({ t, mid, bid: mid - s / 2, ask: mid + s / 2, spread: s });
    t += intervalMs * (o.jitter ? 0.5 + r() : 1);
  }
  return out;
}

/** 合成 tick を CSV 文字列に */
export function ticksToCsv(ticks) {
  const lines = ['timestamp,bid,ask'];
  for (const tk of ticks) lines.push(`${new Date(tk.t).toISOString()},${tk.bid.toFixed(5)},${tk.ask.toFixed(5)}`);
  return lines.join('\n');
}
