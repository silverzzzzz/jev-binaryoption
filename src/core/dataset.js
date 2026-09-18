import { parseTime, median } from './time.js';

/**
 * 列名からロール（time/open/high/low/close/bid/ask/price/volume/date/timeOnly）を推定する。
 * 日本語・MT4/MT5・一般的な取引所エクスポートの列名に対応。
 */
const SYNONYMS = {
  time: ['timestamp', 'datetime', 'date_time', 'time', 'ts', 'epoch', 'unix', '日時', '時刻', '時間', 'gmt time', 'local time', 'date'],
  date: ['<date>', 'date', '日付'],
  timeOnly: ['<time>', 'time', '時刻'],
  open: ['open', '<open>', 'o', '始値'],
  high: ['high', '<high>', 'h', '高値'],
  low: ['low', '<low>', 'l', '安値'],
  close: ['close', '<close>', 'c', '終値', 'adj close'],
  bid: ['bid', '<bid>', 'bidprice', 'bid_price', '売値', 'ビッド'],
  ask: ['ask', '<ask>', 'askprice', 'ask_price', 'offer', '買値', 'アスク'],
  price: ['price', 'mid', 'last', 'rate', 'value', '価格', 'レート', '仲値'],
  volume: ['volume', '<vol>', '<tickvol>', 'vol', 'tickvol', 'qty', '出来高'],
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * @param {string[]} header
 * @returns {Record<string, number|undefined>} ロール → 列インデックス
 */
export function detectColumns(header) {
  const h = header.map(norm);
  /** @type {Record<string, number|undefined>} */
  const map = {};
  const find = (role) => {
    for (const syn of SYNONYMS[role]) {
      const i = h.indexOf(syn);
      if (i >= 0 && !Object.values(map).includes(i)) return i;
    }
    return undefined;
  };
  // MT 形式 (<DATE> + <TIME>) → date + timeOnly を優先
  const dateIdx = h.findIndex((x) => x === '<date>' || x === 'date' || x === '日付');
  const timeIdx = h.findIndex((x) => x === '<time>' || x === 'time' || x === '時刻');
  if (dateIdx >= 0 && timeIdx >= 0 && dateIdx !== timeIdx) {
    map.date = dateIdx;
    map.timeOnly = timeIdx;
  } else {
    map.time = find('time');
  }
  for (const role of ['open', 'high', 'low', 'close', 'bid', 'ask', 'price', 'volume']) {
    map[role] = find(role);
  }
  if (map.time === undefined && map.date === undefined) {
    // 時刻列が見つからない: 最初の列が時刻としてパースできるか試す
    map.time = 0;
  }
  return map;
}

/**
 * 行データを Series（tick / candle）へ正規化する。
 * @param {string[]} header
 * @param {Array<Array<unknown>>} rows
 * @param {Record<string, number|undefined>} [mapping] 省略時は detectColumns
 * @param {{kind?: 'auto'|'tick'|'candle'}} [opts]
 * @returns {import('./types.js').Series & {warnings: string[], dropped: number}}
 */
export function buildSeries(header, rows, mapping, opts = {}) {
  const m = mapping || detectColumns(header);
  const warnings = [];
  const num = (v) => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  const has = (r) => m[r] !== undefined && m[r] !== null && m[r] >= 0;
  const hasOhlc = has('open') && has('high') && has('low') && has('close');
  const hasBidAsk = has('bid') && has('ask');
  let kind = opts.kind && opts.kind !== 'auto' ? opts.kind : hasOhlc ? 'candle' : 'tick';
  if (kind === 'candle' && !hasOhlc) {
    warnings.push('OHLC 列が揃っていないため tick として読み込みます');
    kind = 'tick';
  }
  const priceCol = has('price') ? m.price : has('close') ? m.close : has('bid') ? m.bid : undefined;
  if (kind === 'tick' && !hasBidAsk && priceCol === undefined) {
    throw new Error('価格列（price / close / bid+ask）が見つかりません。列の割り当てを確認してください。');
  }

  const data = [];
  let dropped = 0;
  for (const r of rows) {
    let t;
    if (has('date') && has('timeOnly')) t = parseTime(`${r[m.date]} ${r[m.timeOnly]}`);
    else t = parseTime(r[m.time]);
    if (!Number.isFinite(t)) {
      dropped++;
      continue;
    }
    if (kind === 'candle') {
      const o = num(r[m.open]), h = num(r[m.high]), l = num(r[m.low]), c = num(r[m.close]);
      if (![o, h, l, c].every(Number.isFinite)) {
        dropped++;
        continue;
      }
      const bar = { t, o, h, l, c };
      if (has('volume')) bar.v = num(r[m.volume]);
      if (hasBidAsk) {
        const s = num(r[m.ask]) - num(r[m.bid]);
        if (Number.isFinite(s)) bar.spread = s;
      }
      data.push(bar);
    } else {
      let bid, ask, mid;
      if (hasBidAsk) {
        bid = num(r[m.bid]);
        ask = num(r[m.ask]);
        if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
          dropped++;
          continue;
        }
        mid = (bid + ask) / 2;
      } else {
        mid = num(r[priceCol]);
        if (!Number.isFinite(mid)) {
          dropped++;
          continue;
        }
      }
      const tick = { t, mid };
      if (hasBidAsk) {
        tick.bid = bid;
        tick.ask = ask;
        tick.spread = ask - bid;
      }
      if (has('volume')) tick.v = num(r[m.volume]);
      data.push(tick);
    }
  }
  data.sort((a, b) => a.t - b.t);
  // 同一時刻の重複は最後の値を採用
  const dedup = [];
  for (const p of data) {
    if (dedup.length && dedup[dedup.length - 1].t === p.t) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  if (dropped) warnings.push(`${dropped} 行を解釈できずスキップしました`);
  const series = { kind, data: dedup, warnings, dropped };
  if (kind === 'candle') series.intervalMs = inferInterval(dedup);
  return series;
}

/** 隣接時刻差の中央値 */
export function inferInterval(data) {
  if (data.length < 2) return NaN;
  const diffs = [];
  const step = Math.max(1, Math.floor(data.length / 2000));
  for (let i = step; i < data.length; i += step) diffs.push(data[i].t - data[i - step].t);
  const d = median(diffs) / step;
  return d;
}

/** Series の概要 */
export function summarize(series) {
  const d = series.data;
  if (!d.length) return { count: 0 };
  const closes = seriesCloses(series);
  const spreads = d.map((p) => p.spread).filter(Number.isFinite);
  return {
    kind: series.kind,
    count: d.length,
    start: d[0].t,
    end: d[d.length - 1].t,
    intervalMs: inferInterval(d),
    min: Math.min(...closes),
    max: Math.max(...closes),
    avgSpread: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : NaN,
    spreadRatio: spreads.length / d.length,
  };
}

/** 終値（tick なら mid）の配列 */
export function seriesCloses(series) {
  return series.kind === 'candle' ? series.data.map((b) => b.c) : series.data.map((p) => p.mid);
}

/** 点の代表価格 */
export function pointPrice(kind, p) {
  return kind === 'candle' ? p.c : p.mid;
}
