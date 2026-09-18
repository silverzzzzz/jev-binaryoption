import { Predictor } from './engine.js';
import { indexAtOrAfter } from './bars.js';
import { pointPrice } from './dataset.js';

/**
 * ウォークフォワード・シミュレーション。
 *
 * 系列を先頭から 1 点ずつ Predictor に流し込み、各時点で予測を出し、
 * horizonSeconds 後の最初の点で結果を判定する。オンライン学習モデルへの
 * フィードバックは「結果が判明した時点」（ホライズン到達後）に行うため
 * 未来情報のリークは起きない。
 *
 * @param {import('./types.js').Series} series
 * @param {import('./engine.js').PredictorConfig & {stride?:number, maxRecords?:number, warmup?:number, stake?:number}} config
 *   stride: 何点ごとに予測を出すか（1 = 全点）。warmup: 予測を始める前に読み込む点数。
 * @returns {Generator<{done:false, progress:number}|{done:true, result:SimulationResult}>}
 */
export function* simulate(series, config = {}) {
  const stride = Math.max(1, config.stride || 1);
  const maxRecords = config.maxRecords || Infinity;
  const stake = config.stake ?? 1;
  const predictor = new Predictor(config, series.kind);
  const warmup = config.warmup ?? predictor.config.windowBars;
  const data = series.data;
  const horizonMs = predictor.horizonMs;
  const records = [];
  const pending = []; // 結果待ち
  let stepCounter = 0;
  const progressEvery = Math.max(1, Math.floor(data.length / 200));

  for (let i = 0; i < data.length; i++) {
    predictor.push(data[i]);
    // 結果が判明したものを解決（時刻順に並んでいる前提）
    while (pending.length && pending[0].resolveIndex <= i) {
      const pd = pending.shift();
      const exitPoint = data[pd.resolveIndex];
      const exitMid = pointPrice(series.kind, exitPoint);
      const outcome = predictor.resolve(pd.prediction, exitMid);
      predictor.learn(pd.prediction, outcome);
      records.push(makeRecord(pd.prediction, exitPoint.t, exitMid, outcome, stake, predictor.config.payout));
      if (records.length >= maxRecords) {
        return { done: true, result: buildResult(records, series, predictor) };
      }
    }
    if (i < warmup - 1) continue;
    if (stepCounter++ % stride !== 0) continue;
    const resolveIndex = indexAtOrAfter(data, data[i].t + horizonMs, i + 1);
    if (resolveIndex < 0) break; // これ以降は結果が判定できない
    const prediction = predictor.predict();
    if (!prediction) continue;
    pending.push({ prediction, resolveIndex });
    if (i % progressEvery === 0) yield { done: false, progress: i / data.length, records: records.length };
  }
  // 残った pending（ホライズン到達前にデータ終了）は破棄
  return { done: true, result: buildResult(records, series, predictor) };
}

/** 同期実行版 */
export function runSimulation(series, config = {}) {
  const it = simulate(series, config);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value.result;
  }
}

/** 非同期実行版（UI を止めないよう定期的に制御を返す） */
export async function runSimulationAsync(series, config = {}, onProgress, yieldEveryMs = 40) {
  const it = simulate(series, config);
  let last = Date.now();
  for (;;) {
    const r = it.next();
    if (r.done) return r.value.result;
    if (onProgress) onProgress(r.value);
    if (Date.now() - last > yieldEveryMs) {
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
  }
}

function makeRecord(p, exitT, exitMid, outcome, stake, payout) {
  const hit = p.direction === outcome;
  let pnl = 0;
  if (p.trade) pnl = hit ? stake * payout : -stake;
  return {
    t: p.t,
    exitT,
    mid: p.mid,
    exitMid,
    spread: p.spread,
    band: p.band,
    direction: p.direction,
    confidence: p.confidence,
    pUp: p.pUp,
    pDown: p.pDown,
    pFlat: p.pFlat,
    expectedPrice: p.expectedPrice,
    ev: p.ev,
    trade: p.trade,
    outcome,
    hit,
    pnl,
    parts: p.parts.map((x) => ({ id: x.id, mu: x.mu })),
    mu: p.mu,
    sigma: p.sigma,
  };
}

/**
 * @typedef {Object} SimulationResult
 * @property {Array<object>} records
 * @property {object} metrics
 * @property {number[]} equity 累積損益
 */
function buildResult(records, series, predictor) {
  const metrics = computeMetrics(records, predictor.config);
  const equity = [];
  let acc = 0;
  for (const r of records) {
    acc += r.pnl;
    equity.push(acc);
  }
  const learners = predictor.models.filter((m) => m.weights).map((m) => ({ id: m.id, ...m.weights() }));
  return { records, metrics, equity, config: predictor.config, kind: series.kind, learners };
}

const DIRS = ['up', 'down', 'flat'];

export function computeMetrics(records, config = {}) {
  const n = records.length;
  const confusion = Object.fromEntries(DIRS.map((a) => [a, Object.fromEntries(DIRS.map((b) => [b, 0]))]));
  const outcomeCounts = { up: 0, down: 0, flat: 0 };
  let correct = 0;
  let traded = 0, wins = 0, losses = 0, flatsOnTrade = 0, pnl = 0;
  let peak = 0, maxDrawdown = 0, acc = 0;
  let absErr = 0, absErrNaive = 0;
  const byDir = { up: { n: 0, win: 0 }, down: { n: 0, win: 0 } };
  const calib = Array.from({ length: 10 }, () => ({ n: 0, hit: 0, sumP: 0 }));
  const partStats = {};
  for (const r of records) {
    confusion[r.direction][r.outcome]++;
    outcomeCounts[r.outcome]++;
    if (r.hit) correct++;
    absErr += Math.abs(r.expectedPrice - r.exitMid);
    absErrNaive += Math.abs(r.mid - r.exitMid);
    if (r.direction !== 'flat') {
      const b = Math.min(9, Math.floor(r.confidence * 10));
      calib[b].n++;
      calib[b].sumP += r.confidence;
      if (r.hit) calib[b].hit++;
    }
    if (r.trade) {
      traded++;
      pnl += r.pnl;
      acc += r.pnl;
      if (acc > peak) peak = acc;
      if (peak - acc > maxDrawdown) maxDrawdown = peak - acc;
      byDir[r.direction].n++;
      if (r.hit) {
        wins++;
        byDir[r.direction].win++;
      } else if (r.outcome === 'flat') flatsOnTrade++;
      else losses++;
    }
    for (const p of r.parts) {
      const s = (partStats[p.id] ||= { n: 0, agree: 0 });
      const dir = p.mu > 0 ? 'up' : p.mu < 0 ? 'down' : 'flat';
      if (r.outcome !== 'flat' && dir !== 'flat') {
        s.n++;
        if (dir === r.outcome) s.agree++;
      }
    }
  }
  const majority = Math.max(outcomeCounts.up, outcomeCounts.down, outcomeCounts.flat);
  return {
    total: n,
    accuracy: n ? correct / n : NaN,
    baselineAccuracy: n ? majority / n : NaN,
    outcomeCounts,
    confusion,
    traded,
    tradeRate: n ? traded / n : NaN,
    wins,
    losses,
    flatsOnTrade,
    winRate: traded ? wins / traded : NaN,
    breakEvenWinRate: 1 / (1 + (config.payout ?? 0.85)),
    pnl,
    pnlPerTrade: traded ? pnl / traded : NaN,
    maxDrawdown,
    mae: n ? absErr / n : NaN,
    maeNaive: n ? absErrNaive / n : NaN,
    byDir,
    calibration: calib.map((c, i) => ({ bin: i / 10, n: c.n, hitRate: c.n ? c.hit / c.n : NaN, avgProb: c.n ? c.sumP / c.n : NaN })),
    partStats: Object.fromEntries(Object.entries(partStats).map(([k, v]) => [k, { n: v.n, directionalAccuracy: v.n ? v.agree / v.n : NaN }])),
  };
}
