/**
 * tick → ローソク足、ローソク足のリサンプル、時刻検索。
 */

/**
 * @param {import('./types.js').Tick[]} ticks 時刻昇順
 * @param {number} intervalMs
 * @returns {import('./types.js').Candle[]}
 */
export function ticksToCandles(ticks, intervalMs) {
  const out = [];
  let cur = null;
  let spreadSum = 0;
  let spreadN = 0;
  for (const tk of ticks) {
    const bucket = Math.floor(tk.t / intervalMs) * intervalMs;
    if (!cur || cur.t !== bucket) {
      if (cur) finish(cur);
      cur = { t: bucket, o: tk.mid, h: tk.mid, l: tk.mid, c: tk.mid, v: 0 };
      spreadSum = 0;
      spreadN = 0;
      out.push(cur);
    }
    if (tk.mid > cur.h) cur.h = tk.mid;
    if (tk.mid < cur.l) cur.l = tk.mid;
    cur.c = tk.mid;
    cur.v += 1;
    if (Number.isFinite(tk.spread)) {
      spreadSum += tk.spread;
      spreadN++;
    }
  }
  if (cur) finish(cur);
  return out;
  function finish(bar) {
    if (spreadN) bar.spread = spreadSum / spreadN;
  }
}

/**
 * @param {import('./types.js').Candle[]} candles
 * @param {number} intervalMs 元より大きい間隔
 */
export function resampleCandles(candles, intervalMs) {
  const out = [];
  let cur = null;
  let spreadSum = 0;
  let spreadN = 0;
  for (const b of candles) {
    const bucket = Math.floor(b.t / intervalMs) * intervalMs;
    if (!cur || cur.t !== bucket) {
      if (cur && spreadN) cur.spread = spreadSum / spreadN;
      cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: 0 };
      spreadSum = 0;
      spreadN = 0;
      out.push(cur);
    }
    if (b.h > cur.h) cur.h = b.h;
    if (b.l < cur.l) cur.l = b.l;
    cur.c = b.c;
    if (Number.isFinite(b.v)) cur.v += b.v;
    if (Number.isFinite(b.spread)) {
      spreadSum += b.spread;
      spreadN++;
    }
  }
  if (cur && spreadN) cur.spread = spreadSum / spreadN;
  return out;
}

/**
 * Series を指定間隔のローソク足 Series に変換する。tick はそのまま集計、
 * candle は間隔が大きくなる場合のみリサンプル。
 * @param {import('./types.js').Series} series
 * @param {number} intervalMs
 * @returns {import('./types.js').Series}
 */
export function toCandleSeries(series, intervalMs) {
  if (series.kind === 'tick') {
    return { kind: 'candle', data: ticksToCandles(series.data, intervalMs), intervalMs };
  }
  if (series.intervalMs && intervalMs > series.intervalMs * 1.5) {
    return { kind: 'candle', data: resampleCandles(series.data, intervalMs), intervalMs };
  }
  return series;
}

/**
 * 時刻 t 以上となる最初のインデックス（二分探索）。無ければ -1。
 * @param {Array<{t:number}>} data
 * @param {number} t
 * @param {number} [lo]
 */
export function indexAtOrAfter(data, t, lo = 0) {
  let hi = data.length - 1;
  if (hi < lo || data[hi].t < t) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].t >= t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
