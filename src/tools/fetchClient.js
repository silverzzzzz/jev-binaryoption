/**
 * 提供元ごとのページング / カーソル処理。HTTP の実行は呼び出し側から
 * `get` として注入するため、Node（scripts/fetch-data.js）でもブラウザ
 * （app/）でも、テスト用モックでも同じコードが動く。
 */
import {
  SOURCES, CANDLE_HEADER, TICK_PRICE_HEADER,
  binanceKlinesUrl, parseBinanceKlines, binanceAggTradesUrl, parseBinanceAggTrades,
  krakenOhlcUrl, parseKrakenOhlc, krakenTradesUrl, parseKrakenTrades,
  yahooChartUrl, parseYahooChart, stooqUrl, parseStooqCsv,
  bitflyerExecutionsUrl, parseBitflyerExecutions,
} from './sources.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @typedef {Object} FetchOptions
 * @property {string} source   SOURCES のキー
 * @property {string} symbol
 * @property {boolean} [tick]  約定単位で取得するか
 * @property {string} [interval] ローソク足の間隔
 * @property {number} startTime エポックミリ秒
 * @property {number} endTime
 * @property {number} [maxRows]
 * @property {string} [base]   API ベース URL の差し替え
 * @property {(url:string, asText?:boolean)=>Promise<any>} get HTTP 実行関数
 * @property {(rows:number, lastTime:number)=>void} [onProgress]
 * @property {(ms:number)=>Promise<void>} [sleep]
 * @property {()=>boolean} [cancelled] true を返すと途中で打ち切る
 */

/**
 * @param {FetchOptions} o
 * @returns {Promise<{header: string[], rows: any[][]}>}
 */
export async function fetchSeries(o) {
  const src = SOURCES[o.source];
  if (!src) throw new Error(`未知の提供元: ${o.source}`);
  const kind = o.tick ? 'tick' : 'candle';
  if (!src.kinds.includes(kind)) throw new Error(`${src.label} は ${kind} に対応していません（対応: ${src.kinds.join(', ')}）`);
  const ctx = {
    ...o,
    maxRows: o.maxRows || 2000000,
    sleep: o.sleep || defaultSleep,
    onProgress: o.onProgress || (() => {}),
    cancelled: o.cancelled || (() => false),
    withBase: (obj) => (o.base ? { ...obj, base: o.base } : obj),
  };
  return FETCHERS[o.source](ctx);
}

async function binance(c) {
  const rows = [];
  if (c.tick) {
    let fromId = null;
    let cursor = c.startTime;
    for (;;) {
      if (c.cancelled()) break;
      const url = fromId == null
        ? binanceAggTradesUrl(c.withBase({ symbol: c.symbol, startTime: cursor, endTime: Math.min(cursor + 3600000, c.endTime) }))
        : binanceAggTradesUrl(c.withBase({ symbol: c.symbol, fromId }));
      const { rows: chunk, lastTime, lastId } = parseBinanceAggTrades(await c.get(url));
      if (!chunk.length) {
        if (fromId != null) break;
        cursor += 3600000; // その 1 時間に約定が無い
        if (cursor >= c.endTime) break;
        continue;
      }
      for (const r of chunk) {
        if (Date.parse(r[0]) > c.endTime) return { rows, header: TICK_PRICE_HEADER };
        rows.push(r);
      }
      c.onProgress(rows.length, lastTime);
      if (rows.length >= c.maxRows || lastTime >= c.endTime) break;
      fromId = lastId + 1;
      await c.sleep(120);
    }
    return { rows, header: TICK_PRICE_HEADER };
  }
  const interval = c.interval || '1m';
  let cursor = c.startTime;
  for (;;) {
    if (c.cancelled()) break;
    const { rows: chunk, lastTime } = parseBinanceKlines(
      await c.get(binanceKlinesUrl(c.withBase({ symbol: c.symbol, interval, startTime: cursor, endTime: c.endTime, limit: 1000 })))
    );
    if (!chunk.length) break;
    rows.push(...chunk);
    c.onProgress(rows.length, lastTime);
    if (chunk.length < 1000 || rows.length >= c.maxRows || lastTime >= c.endTime) break;
    cursor = lastTime + 1;
    await c.sleep(120);
  }
  return { rows, header: CANDLE_HEADER };
}

async function kraken(c) {
  const rows = [];
  if (c.tick) {
    let cursor = String(c.startTime * 1e6); // ナノ秒
    for (;;) {
      if (c.cancelled()) break;
      const { rows: chunk, cursor: next, lastTime } = parseKrakenTrades(await c.get(krakenTradesUrl(c.withBase({ pair: c.symbol, since: cursor }))));
      if (!chunk.length) break;
      for (const r of chunk) {
        if (Date.parse(r[0]) > c.endTime) return { rows, header: TICK_PRICE_HEADER };
        rows.push(r);
      }
      c.onProgress(rows.length, lastTime);
      if (rows.length >= c.maxRows || lastTime >= c.endTime || next === cursor) break;
      cursor = next;
      await c.sleep(1100); // 公開 API のレート制限は厳しめ
    }
    return { rows, header: TICK_PRICE_HEADER };
  }
  const minutes = Number(String(c.interval || '1').replace(/[^\d]/g, '')) || 1;
  const { rows: chunk } = parseKrakenOhlc(await c.get(krakenOhlcUrl(c.withBase({ pair: c.symbol, intervalMinutes: minutes, since: c.startTime }))));
  rows.push(...chunk.filter((r) => Date.parse(r[0]) <= c.endTime));
  c.onProgress(rows.length, c.endTime);
  return { rows, header: CANDLE_HEADER, note: chunk.length >= 720 ? 'Kraken の OHLC は最大 720 本です。より長い期間が必要なら interval を大きくしてください。' : undefined };
}

async function bitflyer(c) {
  // 新しい順に返るため before カーソルで遡り、最後に昇順へ並べ替える
  const rows = [];
  let before = null;
  for (;;) {
    if (c.cancelled()) break;
    const { rows: chunk, oldestId, oldestTime } = parseBitflyerExecutions(
      await c.get(bitflyerExecutionsUrl(c.withBase({ productCode: c.symbol, count: 500, before })))
    );
    if (!chunk.length) break;
    for (const r of chunk) {
      const t = Date.parse(r[0]);
      if (t >= c.startTime && t <= c.endTime) rows.push(r);
    }
    c.onProgress(rows.length, oldestTime);
    if (oldestTime <= c.startTime || rows.length >= c.maxRows || !Number.isFinite(oldestId)) break;
    before = oldestId;
    await c.sleep(350);
  }
  rows.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  return { rows, header: TICK_PRICE_HEADER };
}

async function yahoo(c) {
  const interval = c.interval || '1m';
  const { rows } = parseYahooChart(await c.get(yahooChartUrl(c.withBase({ symbol: c.symbol, interval, period1: c.startTime, period2: c.endTime }))));
  c.onProgress(rows.length, c.endTime);
  return {
    rows,
    header: CANDLE_HEADER,
    note: interval === '1m' && c.endTime - c.startTime > 8 * 86400000 ? 'Yahoo の 1 分足は直近 7〜8 日ぶんしか返りません。' : undefined,
  };
}

async function stooq(c) {
  const { rows } = parseStooqCsv(await c.get(stooqUrl(c.withBase({ symbol: c.symbol, interval: c.interval || 'd' })), true));
  const filtered = rows.filter((r) => {
    const t = Date.parse(r[0]);
    return t >= c.startTime && t <= c.endTime;
  });
  const out = filtered.length ? filtered : rows; // 期間外なら全件（日足は古いことがある）
  c.onProgress(out.length, c.endTime);
  return { rows: out, header: CANDLE_HEADER };
}

const FETCHERS = { binance, kraken, bitflyer, yahoo, stooq };

/**
 * リトライ付きの fetch。429 / 5xx は指数バックオフ。
 * @param {{fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>, userAgent?: string, retries?: number, onRetry?: (msg:string)=>void}} [opts]
 */
export function makeHttpGet(opts = {}) {
  const f = opts.fetchImpl || globalThis.fetch;
  const sleep = opts.sleep || defaultSleep;
  const retries = opts.retries ?? 5;
  const onRetry = opts.onRetry || (() => {});
  return async function get(url, asText = false) {
    let wait = 1000;
    for (let attempt = 0; attempt < retries; attempt++) {
      let res;
      try {
        const headers = { Accept: asText ? 'text/csv,*/*' : 'application/json' };
        if (opts.userAgent) headers['User-Agent'] = opts.userAgent; // ブラウザでは設定できない
        res = await f(url, { headers });
      } catch (e) {
        if (attempt === retries - 1) throw e;
        onRetry(`通信エラー (${e.message}) ${wait}ms 後に再試行`);
        await sleep(wait);
        wait *= 2;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries - 1) throw new Error(`HTTP ${res.status} が続きました: ${url}`);
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        const w = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : wait;
        onRetry(`HTTP ${res.status}: ${w}ms 待機して再試行`);
        await sleep(w);
        wait *= 2;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      return asText ? res.text() : res.json();
    }
  };
}
