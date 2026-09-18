#!/usr/bin/env node
/**
 * CLI でシミュレーションを実行する。
 *   node scripts/sim-cli.js <file.csv> [--horizon 60] [--window 60] [--spread 0.003] [--payout 0.85]
 *                            [--minprob 0.55] [--stride 1] [--resample 60000] [--models momentum,linearTrend] [--out result.json]
 */
import fs from 'node:fs';
import { parseDelimited, buildSeries, toCandleSeries, runSimulation, summarize, formatTime } from '../src/core/index.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/sim-cli.js <file.csv> [--horizon 60] [--window 60] [--spread X] [--payout 0.85] [--minprob 0.55] [--stride 1] [--resample ms] [--models a,b] [--out file.json]');
  process.exit(1);
}
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const { header, rows } = parseDelimited(fs.readFileSync(file, 'utf8'));
let series = buildSeries(header, rows);
const resample = Number(opt('resample', 0));
if (resample > 0) series = toCandleSeries(series, resample);
const s = summarize(series);
console.log(`${file}: ${s.kind} ${s.count} points, ${formatTime(s.start)} - ${formatTime(s.end)}, interval ${Math.round(s.intervalMs)} ms, avg spread ${s.avgSpread}`);
const config = {
  horizonSeconds: Number(opt('horizon', 60)),
  windowBars: Number(opt('window', 60)),
  payout: Number(opt('payout', 0.85)),
  minProb: Number(opt('minprob', 0.55)),
  stride: Number(opt('stride', 1)),
};
if (opt('spread')) {
  config.spreadMode = 'fixed';
  config.spreadValue = Number(opt('spread'));
}
if (opt('models')) config.predictors = opt('models').split(',');
const t0 = Date.now();
const result = runSimulation(series, config);
const m = result.metrics;
console.log(`evaluated ${m.total} predictions in ${Date.now() - t0} ms`);
console.log(`accuracy (3-class): ${(m.accuracy * 100).toFixed(2)}%  baseline: ${(m.baselineAccuracy * 100).toFixed(2)}%`);
console.log(`trades: ${m.traded}  win rate: ${(m.winRate * 100).toFixed(2)}%  break-even: ${(m.breakEvenWinRate * 100).toFixed(2)}%`);
console.log(`pnl: ${m.pnl.toFixed(2)}  per trade: ${m.pnlPerTrade?.toFixed(4)}  max drawdown: ${m.maxDrawdown.toFixed(2)}`);
console.log(`expected price MAE: ${m.mae.toExponential(3)}  naive: ${m.maeNaive.toExponential(3)}`);
console.log('confusion (pred \\ outcome):', JSON.stringify(m.confusion));
console.log('models:', JSON.stringify(m.partStats));
const out = opt('out');
if (out) {
  fs.writeFileSync(out, JSON.stringify({ config: result.config, metrics: m, records: result.records }, null, 1));
  console.log('wrote', out);
}
