/**
 * 無料の価格データ提供元ごとの「URL 組み立て」と「レスポンス → 行データ」変換。
 *
 * ここには純粋関数だけを置く（fetch もファイル書き込みもしない）ので、
 * ネットワーク無しでユニットテストできる。実際の取得は scripts/fetch-data.js。
 *
 * 出力形式は 2 種類:
 *   candle: { header: ['timestamp','open','high','low','close','volume'], rows }
 *   tick  : { header: ['timestamp','bid','ask'] または ['timestamp','price'], rows }
 * いずれも timestamp は ISO 8601 (UTC)。そのまま app/ の取り込みで読める。
 */

const iso = (ms) => new Date(ms).toISOString();

/* ============================ Binance (暗号資産) ============================ */
// APIキー不要。klines は 1s 〜 1M、aggTrades は約定単位（板の bid/ask は含まない）。
// 取引所の利用規約に従うこと。地域によっては api.binance.com が使えない。

export const BINANCE_INTERVALS = ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

export function binanceKlinesUrl({ symbol, interval = '1m', startTime, endTime, limit = 1000, base = 'https://api.binance.com' }) {
  const p = new URLSearchParams({ symbol: symbol.toUpperCase(), interval, limit: String(limit) });
  if (startTime != null) p.set('startTime', String(Math.round(startTime)));
  if (endTime != null) p.set('endTime', String(Math.round(endTime)));
  return `${base}/api/v3/klines?${p}`;
}

/** @param {any[][]} json @returns {{rows: any[][], lastTime: number}} */
export function parseBinanceKlines(json) {
  if (!Array.isArray(json)) throw new Error('Binance klines: 配列ではないレスポンス: ' + JSON.stringify(json).slice(0, 200));
  const rows = json.map((k) => [iso(Number(k[0])), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])]);
  return { rows, lastTime: json.length ? Number(json[json.length - 1][0]) : NaN };
}

export function binanceAggTradesUrl({ symbol, startTime, endTime, fromId, limit = 1000, base = 'https://api.binance.com' }) {
  const p = new URLSearchParams({ symbol: symbol.toUpperCase(), limit: String(limit) });
  if (fromId != null) p.set('fromId', String(fromId));
  else {
    if (startTime != null) p.set('startTime', String(Math.round(startTime)));
    // startTime 指定時は endTime も必要（かつ範囲は 1 時間以内）
    if (endTime != null) p.set('endTime', String(Math.round(endTime)));
  }
  return `${base}/api/v3/aggTrades?${p}`;
}

/** aggTrades は板情報を持たないため price のみ。スプレッドはアプリ側で固定値を設定する。 */
export function parseBinanceAggTrades(json) {
  if (!Array.isArray(json)) throw new Error('Binance aggTrades: 配列ではないレスポンス: ' + JSON.stringify(json).slice(0, 200));
  const rows = json.map((t) => [iso(Number(t.T)), Number(t.p)]);
  const last = json[json.length - 1];
  return { rows, lastTime: last ? Number(last.T) : NaN, lastId: last ? Number(last.a) : NaN };
}

/* ============================== Kraken (暗号資産) ============================== */
// APIキー不要。Binance が使えない地域の代替。OHLC は最大 720 本、Trades は since カーソル方式。

export function krakenOhlcUrl({ pair, intervalMinutes = 1, since, base = 'https://api.kraken.com' }) {
  const p = new URLSearchParams({ pair, interval: String(intervalMinutes) });
  if (since != null) p.set('since', String(Math.floor(since / 1000)));
  return `${base}/0/public/OHLC?${p}`;
}

export function parseKrakenOhlc(json) {
  if (json?.error?.length) throw new Error('Kraken: ' + json.error.join(', '));
  const result = json?.result || {};
  const key = Object.keys(result).find((k) => k !== 'last');
  const arr = key ? result[key] : [];
  // [time, open, high, low, close, vwap, volume, count]
  const rows = arr.map((k) => [iso(Number(k[0]) * 1000), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[6])]);
  return { rows, last: Number(result.last) * 1000 };
}

export function krakenTradesUrl({ pair, since, base = 'https://api.kraken.com' }) {
  const p = new URLSearchParams({ pair });
  if (since != null) p.set('since', String(since)); // ナノ秒カーソル（前回の result.last をそのまま渡す）
  return `${base}/0/public/Trades?${p}`;
}

export function parseKrakenTrades(json) {
  if (json?.error?.length) throw new Error('Kraken: ' + json.error.join(', '));
  const result = json?.result || {};
  const key = Object.keys(result).find((k) => k !== 'last');
  const arr = key ? result[key] : [];
  // [price, volume, time(sec, 小数), buy/sell, market/limit, misc]
  const rows = arr.map((t) => [iso(Math.round(Number(t[2]) * 1000)), Number(t[0])]);
  return { rows, cursor: result.last, lastTime: arr.length ? Math.round(Number(arr[arr.length - 1][2]) * 1000) : NaN };
}

/* ========================= Yahoo Finance (FX / 株価指数) ========================= */
// 非公式エンドポイント。1 分足は直近 7〜8 日のみ。個人利用の範囲で。
// シンボル例: USDJPY=X, EURUSD=X, ^N225, AAPL

export function yahooChartUrl({ symbol, interval = '1m', period1, period2, base = 'https://query1.finance.yahoo.com' }) {
  const p = new URLSearchParams({ interval, includePrePost: 'false' });
  p.set('period1', String(Math.floor(period1 / 1000)));
  p.set('period2', String(Math.ceil(period2 / 1000)));
  return `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?${p}`;
}

export function parseYahooChart(json) {
  const err = json?.chart?.error;
  if (err) throw new Error('Yahoo: ' + (err.description || err.code || JSON.stringify(err)));
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error('Yahoo: result が空です');
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if ([o, h, l, c].some((v) => v == null || !Number.isFinite(v))) continue; // 欠損バーは除外
    rows.push([iso(ts[i] * 1000), o, h, l, c, q.volume?.[i] ?? 0]);
  }
  return { rows, lastTime: rows.length ? Date.parse(rows[rows.length - 1][0]) : NaN };
}

/* ================================ Stooq (日足) ================================ */
// 例: s=usdjpy, s=^spx, s=7203.jp。日足なので t 秒予測の検証には粗いが疎通確認に使える。

export function stooqUrl({ symbol, interval = 'd', base = 'https://stooq.com' }) {
  return `${base}/q/d/l/?s=${encodeURIComponent(symbol)}&i=${interval}`;
}

export function parseStooqCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length || !/^date/i.test(lines[0])) throw new Error('Stooq: 想定外の応答: ' + text.slice(0, 120));
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (c.length < 5) continue;
    const t = Date.parse(c[0].includes('T') || c[0].includes(' ') ? c[0] : c[0] + 'T00:00:00Z');
    if (!Number.isFinite(t)) continue;
    rows.push([iso(t), Number(c[1]), Number(c[2]), Number(c[3]), Number(c[4]), c[5] ? Number(c[5]) : 0]);
  }
  return { rows, lastTime: rows.length ? Date.parse(rows[rows.length - 1][0]) : NaN };
}

/* ============================== bitFlyer (暗号資産) ============================== */
// 日本の取引所。APIキー不要。約定履歴は before カーソルで過去へ遡る（新しい順に返る）。

export function bitflyerExecutionsUrl({ productCode = 'BTC_JPY', count = 500, before, base = 'https://api.bitflyer.com' }) {
  const p = new URLSearchParams({ product_code: productCode, count: String(count) });
  if (before != null) p.set('before', String(before));
  return `${base}/v1/getexecutions?${p}`;
}

/** 新しい順に返るため、呼び出し側で時刻昇順に並べ替える。 */
export function parseBitflyerExecutions(json) {
  if (!Array.isArray(json)) throw new Error('bitFlyer: 配列ではないレスポンス: ' + JSON.stringify(json).slice(0, 200));
  const rows = json.map((e) => [iso(Date.parse(e.exec_date.endsWith('Z') ? e.exec_date : e.exec_date + 'Z')), Number(e.price)]);
  const last = json[json.length - 1];
  return { rows, oldestId: last ? Number(last.id) : NaN, oldestTime: rows.length ? Date.parse(rows[rows.length - 1][0]) : NaN };
}

/* ================================= 共通ヘッダー ================================= */
export const CANDLE_HEADER = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
export const TICK_PRICE_HEADER = ['timestamp', 'price'];
export const TICK_BIDASK_HEADER = ['timestamp', 'bid', 'ask'];

/**
 * 提供元の定義。scripts/fetch-data.js から参照する。
 * kind: 'candle' | 'tick'、hasSpread: bid/ask を含むか。
 */
export const SOURCES = {
  binance: { label: 'Binance', kinds: ['candle', 'tick'], hasSpread: false, needsKey: false, browser: true, symbolExample: 'BTCUSDT', intervals: BINANCE_INTERVALS, note: '暗号資産。1 秒足まで取得可。tick は約定値のみ（板情報なし）' },
  kraken: { label: 'Kraken', kinds: ['candle', 'tick'], hasSpread: false, needsKey: false, browser: true, symbolExample: 'XBTUSD', intervals: ['1', '5', '15', '60', '240', '1440'], note: '暗号資産。Binance が使えない地域の代替。OHLC は最大 720 本' },
  bitflyer: { label: 'bitFlyer', kinds: ['tick'], hasSpread: false, needsKey: false, browser: true, symbolExample: 'BTC_JPY', intervals: [], note: '日本の暗号資産取引所。約定履歴を過去へ遡って取得' },
  yahoo: { label: 'Yahoo Finance', kinds: ['candle'], hasSpread: false, needsKey: false, browser: false, symbolExample: 'USDJPY=X', intervals: ['1m', '5m', '15m', '1h', '1d'], note: 'FX / 株価指数 / 個別株。1 分足は直近 7〜8 日のみ。非公式 API。ブラウザからは CORS で取得できないため CLI を使う' },
  stooq: { label: 'Stooq', kinds: ['candle'], hasSpread: false, needsKey: false, browser: false, symbolExample: 'usdjpy', intervals: ['d'], note: '日足中心。ブラウザからは CORS で取得できないため CLI を使う' },
};
