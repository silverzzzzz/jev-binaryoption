import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTime, parseDelimited, detectColumns, buildSeries, ticksToCandles, indexAtOrAfter,
  decide, resolveOutcome, computeFeatures, Predictor, runSimulation, RealtimeSession,
  generateTicks, ticksToCsv, toCandleSeries, mathUtils,
} from '../src/core/index.js';

test('parseTime handles common formats', () => {
  assert.equal(parseTime('2024-01-05T09:30:00Z'), Date.UTC(2024, 0, 5, 9, 30, 0));
  assert.equal(parseTime('2024.01.05 09:30:00+09:00'), Date.UTC(2024, 0, 5, 0, 30, 0));
  assert.equal(parseTime(1704447000), 1704447000000); // epoch seconds
  assert.equal(parseTime(1704447000000), 1704447000000); // epoch ms
  assert.equal(parseTime('1704447000123'), 1704447000123);
  assert.equal(parseTime(45296.5), Math.round((45296.5 - 25569) * 86400000)); // Excel serial
  assert.ok(Number.isNaN(parseTime('not a date')));
  // ローカル時刻形式は Date と一致
  assert.equal(parseTime('2024/01/05 09:30:15'), new Date(2024, 0, 5, 9, 30, 15).getTime());
});

test('parseDelimited detects delimiter and handles quotes', () => {
  const { header, rows, delimiter } = parseDelimited('a;b;c\n1;"x;y";3\r\n4;5;6\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(header, ['a', 'b', 'c']);
  assert.deepEqual(rows, [['1', 'x;y', '3'], ['4', '5', '6']]);
  const tsv = parseDelimited('﻿t\tv\n1\t2');
  assert.deepEqual(tsv.header, ['t', 'v']);
  const noHeader = parseDelimited('1,2\n3,4');
  assert.deepEqual(noHeader.header, ['col0', 'col1']);
  assert.equal(noHeader.rows.length, 2);
});

test('detectColumns maps MT-style and Japanese headers', () => {
  const m = detectColumns(['<DATE>', '<TIME>', '<OPEN>', '<HIGH>', '<LOW>', '<CLOSE>', '<TICKVOL>']);
  assert.equal(m.date, 0);
  assert.equal(m.timeOnly, 1);
  assert.equal(m.close, 5);
  assert.equal(m.volume, 6);
  const j = detectColumns(['日時', '売値', '買値']);
  assert.equal(j.time, 0);
  assert.equal(j.bid, 1);
  assert.equal(j.ask, 2);
});

test('buildSeries creates tick series from bid/ask and candle series from OHLC', () => {
  const tick = buildSeries(['time', 'bid', 'ask'], [
    ['2024-01-01T00:00:01Z', '150.001', '150.004'],
    ['2024-01-01T00:00:00Z', '150.000', '150.003'],
    ['bad', '1', '2'],
  ]);
  assert.equal(tick.kind, 'tick');
  assert.equal(tick.data.length, 2);
  assert.equal(tick.dropped, 1);
  assert.ok(tick.data[0].t < tick.data[1].t);
  assert.ok(Math.abs(tick.data[0].spread - 0.003) < 1e-9);
  const candle = buildSeries(['Date', 'Open', 'High', 'Low', 'Close'], [
    ['2024-01-01 00:00', '1', '2', '0.5', '1.5'],
    ['2024-01-01 00:01', '1.5', '2', '1', '1.2'],
  ]);
  assert.equal(candle.kind, 'candle');
  assert.equal(candle.intervalMs, 60000);
});

test('ticksToCandles aggregates OHLC and spread', () => {
  const ticks = [
    { t: 0, mid: 1, spread: 0.1 }, { t: 500, mid: 3, spread: 0.3 }, { t: 900, mid: 2, spread: 0.2 },
    { t: 1000, mid: 5 },
  ];
  const c = ticksToCandles(ticks, 1000);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].o, c[0].h, c[0].l, c[0].c, c[0].v], [1, 3, 1, 2, 3]);
  assert.ok(Math.abs(c[0].spread - 0.2) < 1e-9);
  assert.equal(c[1].spread, undefined);
});

test('indexAtOrAfter binary search', () => {
  const d = [{ t: 0 }, { t: 10 }, { t: 20 }, { t: 30 }];
  assert.equal(indexAtOrAfter(d, 10), 1);
  assert.equal(indexAtOrAfter(d, 11), 2);
  assert.equal(indexAtOrAfter(d, 31), -1);
  assert.equal(indexAtOrAfter(d, 5, 2), 2);
});

test('decide: probabilities sum to 1, spread widens flat zone, direction follows mu', () => {
  const base = { mu: 0.0005, sigma: 0.001, mid: 150, spread: 0, payout: 0.85 };
  const d0 = decide(base);
  assert.ok(Math.abs(d0.pUp + d0.pDown + d0.pFlat - 1) < 1e-9);
  assert.equal(d0.direction, 'up');
  assert.ok(d0.pFlat < 1e-6);
  const d1 = decide({ ...base, spread: 0.3 });
  assert.ok(d1.pFlat > d0.pFlat);
  assert.ok(d1.pUp < d0.pUp);
  const d2 = decide({ ...base, mu: -0.0005 });
  assert.equal(d2.direction, 'down');
  assert.ok(Math.abs(d2.pDown - d0.pUp) < 1e-9);
  assert.ok(Math.abs(d0.expectedPrice - 150 * Math.exp(0.0005)) < 1e-9);
  // 期待値: p*payout - (1-p)
  assert.ok(Math.abs(d0.ev - (d0.pUp * 0.85 - (1 - d0.pUp))) < 1e-12);
  assert.equal(decide({ ...base, minProb: 0.99 }).trade, false);
});

test('resolveOutcome uses band', () => {
  assert.equal(resolveOutcome(100, 100.2, 0.1), 'up');
  assert.equal(resolveOutcome(100, 99.8, 0.1), 'down');
  assert.equal(resolveOutcome(100, 100.05, 0.1), 'flat');
});

test('normalCdf / normalInv are consistent', () => {
  for (const p of [0.01, 0.2, 0.5, 0.8, 0.99]) {
    assert.ok(Math.abs(mathUtils.normalCdf(mathUtils.normalInv(p)) - p) < 1e-6);
  }
});

test('computeFeatures returns fixed-size finite vector', () => {
  const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3));
  const f = computeFeatures(closes);
  assert.equal(f.vector.length, 14);
  assert.ok(f.vector.every(Number.isFinite));
  const flat = computeFeatures(Array(30).fill(100));
  assert.ok(flat.vector.every(Number.isFinite));
});

test('Predictor produces a prediction after enough data and expected price tracks trend', () => {
  const up = Array.from({ length: 100 }, (_, i) => ({ t: i * 1000, mid: 100 + i * 0.01, spread: 0.001 }));
  const p = new Predictor({ windowBars: 50, horizonSeconds: 10, predictors: ['momentum', 'linearTrend'] }, 'tick');
  assert.equal(p.predict(), null);
  p.load(up);
  const pred = p.predict();
  assert.ok(pred);
  assert.equal(pred.direction, 'up');
  assert.ok(pred.expectedPrice > pred.mid);
  assert.ok(pred.pUp > 0.5);
  assert.equal(pred.parts.length, 2);
  assert.equal(pred.spread, 0.001);
  const fixed = new Predictor({ windowBars: 50, horizonSeconds: 10, spreadMode: 'fixed', spreadValue: 0.5 }, 'tick');
  fixed.load(up);
  assert.equal(fixed.predict().spread, 0.5);
});

test('simulation runs without lookahead and metrics are consistent', () => {
  const ticks = generateTicks({ n: 1500, seed: 3 });
  const series = { kind: 'tick', data: ticks };
  const res = runSimulation(series, { windowBars: 40, horizonSeconds: 30 });
  const m = res.metrics;
  assert.ok(m.total > 1000);
  assert.equal(res.records.length, m.total);
  assert.equal(res.equity.length, m.total);
  for (const r of res.records) {
    assert.ok(r.exitT >= r.t + 30000);
    assert.equal(r.hit, r.direction === r.outcome);
  }
  const sumConf = Object.values(m.confusion).reduce((a, row) => a + Object.values(row).reduce((x, y) => x + y, 0), 0);
  assert.equal(sumConf, m.total);
  assert.ok(Math.abs(res.equity[res.equity.length - 1] - m.pnl) < 1e-9);
  assert.ok(res.learners.find((l) => l.id === 'onlineLogistic').samples > 0);
  // stride
  const strided = runSimulation(series, { windowBars: 40, horizonSeconds: 30, stride: 5 });
  assert.ok(strided.metrics.total < m.total / 4);
});

test('simulation works on candle series with horizon in bars', () => {
  const ticks = generateTicks({ n: 20000, seed: 11 });
  const candles = toCandleSeries({ kind: 'tick', data: ticks }, 60000);
  assert.equal(candles.kind, 'candle');
  const res = runSimulation(candles, { windowBars: 30, horizonSeconds: 180 });
  assert.ok(res.metrics.total > 200);
  for (const r of res.records) assert.ok(r.exitT - r.t >= 180000);
});

test('RealtimeSession emits predictions and resolves after horizon', () => {
  const ticks = generateTicks({ n: 400, seed: 5 });
  const s = new RealtimeSession({ windowBars: 30, horizonSeconds: 20 }, 'tick');
  let preds = 0, resolved = 0;
  s.on('prediction', () => preds++);
  s.on('resolved', () => resolved++);
  s.prime(ticks.slice(0, 30));
  for (const tk of ticks.slice(30)) s.push(tk);
  assert.ok(preds > 300);
  assert.ok(resolved > 300 && resolved < preds);
  assert.equal(s.stats.total, resolved);
  assert.ok(s.last && ['up', 'down', 'flat'].includes(s.last.direction));
});

test('synthetic csv round-trips through the parser', () => {
  const csv = ticksToCsv(generateTicks({ n: 10 }));
  const { header, rows } = parseDelimited(csv);
  const s = buildSeries(header, rows);
  assert.equal(s.kind, 'tick');
  assert.equal(s.data.length, 10);
});
