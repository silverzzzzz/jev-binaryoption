#!/usr/bin/env node
/** 同梱サンプル CSV を生成する: samples/sample_ticks.csv, samples/sample_candles_m1.csv */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTicks, ticksToCsv, ticksToCandles } from '../src/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ticks = generateTicks({ n: 12000, intervalMs: 1000, seed: 2024, start: 150.25, spread: 0.004, trendStrength: 0.15, jitter: true });
fs.writeFileSync(path.join(root, 'samples/sample_ticks.csv'), ticksToCsv(ticks) + '\n');
// 3 日分の 1 秒 tick を 1 分足に集計
const candles = ticksToCandles(generateTicks({ n: 60 * 60 * 24 * 3, intervalMs: 1000, seed: 99, start: 1.0850, vol: 0.000015, spread: 0.00008, trendStrength: 0.15, regimeLength: 3000 }), 60000);
const lines = ['<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<TICKVOL>'];
for (const c of candles) {
  const d = new Date(c.t);
  const p = (n) => String(n).padStart(2, '0');
  lines.push(`${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())},${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00,${c.o.toFixed(5)},${c.h.toFixed(5)},${c.l.toFixed(5)},${c.c.toFixed(5)},${c.v}`);
}
fs.writeFileSync(path.join(root, 'samples/sample_candles_m1.csv'), lines.join('\n') + '\n');
console.log(`wrote ${ticks.length} ticks, ${candles.length} candles`);
