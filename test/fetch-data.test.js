/**
 * fetch-data.js のページング・カーソル処理を、ローカルのモック API で検証する。
 * 外部ネットワークには接続しない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDelimited, buildSeries } from '../src/core/index.js';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/fetch-data.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-fetch-'));

let throttleOnce = true;
const requests = [];
const NOW = Date.now(); // bitFlyer モックは「現在から遡る」時刻を返す

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname + url.search);
  const json = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  // 1 度だけ 429 を返し、リトライ経路を通す
  if (url.pathname === '/api/v3/klines' && throttleOnce) {
    throttleOnce = false;
    res.writeHead(429, { 'retry-after': '0' });
    return res.end('{"code":-1003,"msg":"Too many requests"}');
  }
  if (url.pathname === '/api/v3/klines') {
    const start = Number(url.searchParams.get('startTime'));
    const end = Number(url.searchParams.get('endTime'));
    const limit = Number(url.searchParams.get('limit'));
    const out = [];
    for (let t = start; t <= end && out.length < limit; t += 60000) {
      const p = 42000 + (t % 600000) / 1000;
      out.push([t, String(p), String(p + 5), String(p - 5), String(p + 1), '1.5', t + 59999, '0', 3, '0', '0', '0']);
    }
    return json(out);
  }
  if (url.pathname === '/api/v3/aggTrades') {
    const fromId = url.searchParams.get('fromId');
    const start = Number(url.searchParams.get('startTime'));
    const base = fromId != null ? Number(fromId) : 1;
    const t0 = fromId != null ? 1700000000000 + Number(fromId) * 100 : start;
    const out = [];
    for (let i = 0; i < 1000; i++) out.push({ a: base + i, p: String(42000 + i * 0.01), q: '0.01', T: t0 + i * 100, m: false });
    return json(out);
  }
  if (url.pathname === '/0/public/Trades') {
    const since = Number(url.searchParams.get('since') || 0);
    const t0 = Math.round(since / 1e6);
    const arr = [];
    for (let i = 0; i < 500; i++) arr.push([String(42000 + i * 0.1), '0.01', (t0 + i * 200) / 1000, 'b', 'l', '']);
    return json({ error: [], result: { XXBTZUSD: arr, last: String((t0 + 500 * 200) * 1e6) } });
  }
  if (url.pathname === '/0/public/OHLC') {
    const since = Number(url.searchParams.get('since')) * 1000;
    const arr = [];
    for (let i = 0; i < 100; i++) arr.push([(since + i * 60000) / 1000, '42000', '42010', '41990', '42005', '42001', '1.0', 5]);
    return json({ error: [], result: { XXBTZUSD: arr, last: (since + 100 * 60000) / 1000 } });
  }
  if (url.pathname === '/v1/getexecutions') {
    const before = url.searchParams.get('before');
    const topId = before != null ? Number(before) - 1 : 10000;
    const out = [];
    for (let i = 0; i < 500; i++) {
      const id = topId - i;
      out.push({ id, side: 'BUY', price: 6200000 + (id % 1000), size: 0.01, exec_date: new Date(NOW - (10000 - id) * 1000).toISOString().replace('Z', '') });
    }
    return json(out);
  }
  if (url.pathname.startsWith('/v8/finance/chart/')) {
    const p1 = Number(url.searchParams.get('period1'));
    const timestamp = [], open = [], high = [], low = [], close = [], volume = [];
    for (let i = 0; i < 50; i++) {
      timestamp.push(p1 + i * 60);
      const v = i === 7 ? null : 141 + i * 0.01; // 欠損バーを 1 本混ぜる
      open.push(v); high.push(v == null ? null : v + 0.02); low.push(v == null ? null : v - 0.02); close.push(v == null ? null : v + 0.01); volume.push(0);
    }
    return json({ chart: { error: null, result: [{ meta: { symbol: 'USDJPY=X' }, timestamp, indicators: { quote: [{ open, high, low, close, volume }] } }] } });
  }
  if (url.pathname === '/q/d/l/') {
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    const lines = ['Date,Open,High,Low,Close,Volume'];
    for (let i = 0; i < 10; i++) lines.push(`2024-01-${String(i + 1).padStart(2, '0')},141.1,141.9,140.8,141.85,0`);
    return res.end(lines.join('\n'));
  }
  res.writeHead(404);
  res.end('not found');
}

const server = http.createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, '--base', base, '--quiet', ...args], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function readCsv(file) {
  const { header, rows } = parseDelimited(fs.readFileSync(file, 'utf8'));
  return { header, rows };
}

test('binance klines: 複数ページを連結し、429 から復帰する', async () => {
  const out = path.join(tmp, 'binance_candles.csv');
  const stdout = await run(['--source', 'binance', '--symbol', 'BTCUSDT', '--interval', '1m', '--days', '1', '--out', out]);
  assert.match(stdout, /保存しました/);
  const { header, rows } = readCsv(out);
  assert.deepEqual(header, ['timestamp', 'open', 'high', 'low', 'close', 'volume']);
  assert.ok(rows.length > 1400, `rows=${rows.length}`); // 1 日 = 1440 本 → 2 ページ
  // 時刻が昇順かつ重複なし
  const times = rows.map((r) => Date.parse(r[0]));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `not increasing at ${i}`);
  // 429 を 1 回挟んだので klines へのリクエストは 3 回以上
  assert.ok(requests.filter((r) => r.startsWith('/api/v3/klines')).length >= 3);
  // そのまま系列にできる
  const series = buildSeries(header, rows);
  assert.equal(series.kind, 'candle');
  assert.equal(series.intervalMs, 60000);
});

test('binance aggTrades: fromId で連結し --limit で打ち切る', async () => {
  const out = path.join(tmp, 'binance_ticks.csv');
  await run(['--source', 'binance', '--symbol', 'BTCUSDT', '--tick', '--hours', '1', '--limit', '2500', '--out', out]);
  const { header, rows } = readCsv(out);
  assert.deepEqual(header, ['timestamp', 'price']);
  assert.ok(rows.length >= 2500 && rows.length <= 3000, `rows=${rows.length}`);
  const agg = requests.filter((r) => r.startsWith('/api/v3/aggTrades'));
  assert.ok(agg.length >= 3, `pages=${agg.length}`);
  assert.ok(agg.slice(1).every((r) => r.includes('fromId=')), '2 ページ目以降は fromId を使う');
  const series = buildSeries(header, rows);
  assert.equal(series.kind, 'tick');
});

test('kraken trades: since カーソルで連結する', async () => {
  const out = path.join(tmp, 'kraken_ticks.csv');
  await run(['--source', 'kraken', '--symbol', 'XBTUSD', '--tick', '--hours', '1', '--limit', '900', '--out', out]);
  const { header, rows } = readCsv(out);
  assert.deepEqual(header, ['timestamp', 'price']);
  assert.ok(rows.length >= 900, `rows=${rows.length}`);
  const calls = requests.filter((r) => r.startsWith('/0/public/Trades'));
  assert.ok(calls.length >= 2 && calls[1].includes('since='));
});

test('kraken OHLC / yahoo / stooq が保存できる', async () => {
  const k = path.join(tmp, 'kraken_ohlc.csv');
  await run(['--source', 'kraken', '--symbol', 'XBTUSD', '--interval', '1', '--days', '1', '--out', k]);
  assert.ok(readCsv(k).rows.length > 0);

  const y = path.join(tmp, 'yahoo.csv');
  await run(['--source', 'yahoo', '--symbol', 'USDJPY=X', '--interval', '1m', '--days', '1', '--out', y]);
  const yr = readCsv(y);
  assert.equal(yr.rows.length, 49); // 50 本中 1 本は欠損
  assert.equal(buildSeries(yr.header, yr.rows).kind, 'candle');

  const s = path.join(tmp, 'stooq.csv');
  await run(['--source', 'stooq', '--symbol', 'usdjpy', '--days', '3650', '--out', s]);
  assert.ok(readCsv(s).rows.length > 0);
});

test('bitflyer: before カーソルで遡り、昇順に並べ替える', async () => {
  const out = path.join(tmp, 'bitflyer.csv');
  await run(['--source', 'bitflyer', '--symbol', 'BTC_JPY', '--tick', '--hours', '1', '--limit', '600', '--out', out]);
  const { rows } = readCsv(out);
  assert.ok(rows.length > 0);
  const times = rows.map((r) => Date.parse(r[0]));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1], '昇順である');
  const calls = requests.filter((r) => r.startsWith('/v1/getexecutions'));
  assert.ok(calls.length >= 2 && calls[1].includes('before='));
});

test('未知の提供元や非対応の種別はエラーになる', async () => {
  await assert.rejects(run(['--source', 'nope', '--symbol', 'X']), /未知の提供元|Command failed/);
  await assert.rejects(run(['--source', 'yahoo', '--symbol', 'USDJPY=X', '--tick']), /tick|Command failed/);
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
