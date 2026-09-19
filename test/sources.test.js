import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  binanceKlinesUrl, parseBinanceKlines, binanceAggTradesUrl, parseBinanceAggTrades,
  krakenOhlcUrl, parseKrakenOhlc, krakenTradesUrl, parseKrakenTrades,
  yahooChartUrl, parseYahooChart, stooqUrl, parseStooqCsv,
  bitflyerExecutionsUrl, parseBitflyerExecutions, SOURCES,
} from '../src/tools/sources.js';
import { parseDelimited, buildSeries } from '../src/core/index.js';

/* 実際の API 応答形式を模したフィクスチャ（値は短縮） */

test('binance klines: URL と変換', () => {
  const url = binanceKlinesUrl({ symbol: 'btcusdt', interval: '1s', startTime: 1704153600000, endTime: 1704153660000 });
  assert.match(url, /api\/v3\/klines\?/);
  assert.match(url, /symbol=BTCUSDT/);
  assert.match(url, /interval=1s/);
  assert.match(url, /startTime=1704153600000/);
  const json = [
    [1704153600000, '42000.10', '42010.50', '41999.00', '42005.20', '1.5', 1704153600999, '63000', 12, '0.7', '29000', '0'],
    [1704153601000, '42005.20', '42006.00', '42001.00', '42002.00', '0.8', 1704153601999, '33000', 7, '0.3', '12000', '0'],
  ];
  const { rows, lastTime } = parseBinanceKlines(json);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['2024-01-02T00:00:00.000Z', 42000.1, 42010.5, 41999, 42005.2, 1.5]);
  assert.equal(lastTime, 1704153601000);
  assert.throws(() => parseBinanceKlines({ code: -1121, msg: 'Invalid symbol.' }), /配列ではない/);
});

test('binance aggTrades: fromId 指定時は startTime を送らない', () => {
  const first = binanceAggTradesUrl({ symbol: 'BTCUSDT', startTime: 1000, endTime: 2000 });
  assert.match(first, /startTime=1000&endTime=2000/);
  const next = binanceAggTradesUrl({ symbol: 'BTCUSDT', fromId: 55, startTime: 1000 });
  assert.match(next, /fromId=55/);
  assert.ok(!next.includes('startTime'));
  const { rows, lastTime, lastId } = parseBinanceAggTrades([
    { a: 100, p: '42000.10', q: '0.5', f: 1, l: 2, T: 1704153600000, m: false, M: true },
    { a: 101, p: '42001.00', q: '0.1', f: 3, l: 3, T: 1704153600500, m: true, M: true },
  ]);
  assert.deepEqual(rows[0], ['2024-01-02T00:00:00.000Z', 42000.1]);
  assert.equal(lastTime, 1704153600500);
  assert.equal(lastId, 101);
});

test('kraken OHLC / Trades: エラーと変換', () => {
  assert.match(krakenOhlcUrl({ pair: 'XBTUSD', intervalMinutes: 5, since: 1704153600000 }), /interval=5&since=1704153600/);
  const ohlc = parseKrakenOhlc({
    error: [],
    result: {
      XXBTZUSD: [[1704153600, '42000.0', '42010.0', '41990.0', '42005.0', '42001.0', '3.2', 25]],
      last: 1704153660,
    },
  });
  assert.deepEqual(ohlc.rows[0], ['2024-01-02T00:00:00.000Z', 42000, 42010, 41990, 42005, 3.2]);
  assert.equal(ohlc.last, 1704153660000);
  assert.throws(() => parseKrakenOhlc({ error: ['EQuery:Unknown asset pair'] }), /Unknown asset pair/);
  assert.match(krakenTradesUrl({ pair: 'XBTUSD', since: '1704153600000000000' }), /since=1704153600000000000/);
  const tr = parseKrakenTrades({
    error: [],
    result: { XXBTZUSD: [['42000.5', '0.01', 1704153600.1234, 'b', 'l', ''], ['42001.0', '0.02', 1704153601.5, 's', 'm', '']], last: '1704153601500000000' },
  });
  assert.deepEqual(tr.rows[0], ['2024-01-02T00:00:00.123Z', 42000.5]);
  assert.equal(tr.cursor, '1704153601500000000');
  assert.equal(tr.lastTime, 1704153601500);
});

test('yahoo chart: 欠損バーを除外する', () => {
  const url = yahooChartUrl({ symbol: 'USDJPY=X', interval: '1m', period1: 1704153600000, period2: 1704157200000 });
  assert.match(url, /chart\/USDJPY%3DX\?/);
  assert.match(url, /period1=1704153600&period2=1704157200/);
  const { rows } = parseYahooChart({
    chart: {
      error: null,
      result: [{
        meta: { symbol: 'USDJPY=X' },
        timestamp: [1704153600, 1704153660, 1704153720],
        indicators: { quote: [{ open: [141.1, null, 141.3], high: [141.2, null, 141.4], low: [141.0, null, 141.2], close: [141.15, null, 141.35], volume: [0, null, 0] }] },
      }],
    },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['2024-01-02T00:02:00.000Z', 141.3, 141.4, 141.2, 141.35, 0]);
  assert.throws(() => parseYahooChart({ chart: { error: { code: 'Not Found', description: 'No data found' } } }), /No data found/);
});

test('stooq: 日足 CSV の変換', () => {
  assert.match(stooqUrl({ symbol: 'usdjpy' }), /q\/d\/l\/\?s=usdjpy&i=d/);
  const { rows } = parseStooqCsv('Date,Open,High,Low,Close,Volume\n2024-01-02,141.10,141.90,140.80,141.85,0\n2024-01-03,141.85,143.00,141.70,143.00,0\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['2024-01-02T00:00:00.000Z', 141.1, 141.9, 140.8, 141.85, 0]);
  assert.throws(() => parseStooqCsv('Exceeded the daily hits limit'), /想定外の応答/);
});

test('bitflyer: 約定履歴の変換（新しい順で返る）', () => {
  assert.match(bitflyerExecutionsUrl({ productCode: 'BTC_JPY', before: 123 }), /product_code=BTC_JPY&count=500&before=123/);
  const { rows, oldestId, oldestTime } = parseBitflyerExecutions([
    { id: 200, side: 'BUY', price: 6200000, size: 0.01, exec_date: '2024-01-02T00:00:02.000', buy_child_order_acceptance_id: 'x', sell_child_order_acceptance_id: 'y' },
    { id: 199, side: 'SELL', price: 6199000, size: 0.02, exec_date: '2024-01-02T00:00:01.500Z', buy_child_order_acceptance_id: 'x', sell_child_order_acceptance_id: 'y' },
  ]);
  assert.deepEqual(rows[0], ['2024-01-02T00:00:02.000Z', 6200000]);
  assert.equal(oldestId, 199);
  assert.equal(oldestTime, Date.parse('2024-01-02T00:00:01.500Z'));
});

test('取得した CSV がそのまま系列として読める', () => {
  const { rows } = parseBinanceKlines([
    [1704153600000, '42000.10', '42010.50', '41999.00', '42005.20', '1.5', 0, '0', 0, '0', '0', '0'],
    [1704153660000, '42005.20', '42006.00', '42001.00', '42002.00', '0.8', 0, '0', 0, '0', '0', '0'],
  ]);
  const csv = ['timestamp,open,high,low,close,volume', ...rows.map((r) => r.join(','))].join('\n');
  const parsed = parseDelimited(csv);
  const series = buildSeries(parsed.header, parsed.rows);
  assert.equal(series.kind, 'candle');
  assert.equal(series.data.length, 2);
  assert.equal(series.intervalMs, 60000);
  assert.equal(series.data[0].c, 42005.2);
});

test('SOURCES メタ情報の整合', () => {
  for (const [id, s] of Object.entries(SOURCES)) {
    assert.ok(s.label && s.kinds.length, id);
    assert.ok(s.kinds.every((k) => k === 'tick' || k === 'candle'), id);
    assert.equal(typeof s.hasSpread, 'boolean', id);
  }
});
