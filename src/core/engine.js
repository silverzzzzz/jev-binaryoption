import { computeFeatures } from './features.js';
import { createPredictor, PREDICTOR_INFO } from './predictors/index.js';
import { decide, resolveOutcome } from './decision.js';
import { inferInterval, pointPrice } from './dataset.js';

/**
 * @typedef {Object} PredictorConfig
 * @property {number} [windowBars=60]     参照する過去バー（tick）本数
 * @property {number} [horizonSeconds=60] 何秒後を予測するか
 * @property {'auto'|'fixed'} [spreadMode='auto'] auto: データの bid/ask から, fixed: spreadValue
 * @property {number} [spreadValue=0]     fixed 時のスプレッド（価格単位）
 * @property {number} [flatThreshold=0]   「同じ」と判定する追加帯（価格単位）
 * @property {number} [payout=0.85]       ペイアウト率
 * @property {number} [minProb=0.55]      エントリー推奨に必要な確率
 * @property {number} [minEv=0]
 * @property {string[]} [predictors]      使用するモデル id
 * @property {Record<string, number>} [weights] モデルごとの重み
 * @property {Record<string, object>} [predictorOptions] モデルごとのオプション
 * @property {number} [stepMs]            1 歩の時間（省略時はデータから推定）
 */

export const DEFAULT_CONFIG = Object.freeze({
  windowBars: 60,
  horizonSeconds: 60,
  spreadMode: 'auto',
  spreadValue: 0,
  flatThreshold: 0,
  payout: 0.85,
  minProb: 0.55,
  minEv: 0,
  predictors: ['momentum', 'meanReversion', 'linearTrend', 'candlePattern', 'onlineLogistic'],
  weights: Object.fromEntries(PREDICTOR_INFO.map((p) => [p.id, p.defaultWeight])),
  predictorOptions: {},
  stepMs: undefined,
});

/**
 * Jev 予測エンジン本体。
 * 過去データを push() で流し込み、predict() で「t 秒後に上がる / 下がる / 同じ」を返す。
 * リアルタイム利用・シミュレーション双方で同じクラスを使う。
 */
export class Predictor {
  /**
   * @param {PredictorConfig} [config]
   * @param {import('./types.js').SeriesKind} [kind='tick']
   */
  constructor(config = {}, kind = 'tick') {
    this.config = { ...DEFAULT_CONFIG, ...config, weights: { ...DEFAULT_CONFIG.weights, ...(config.weights || {}) } };
    this.kind = kind;
    /** @type {Array<import('./types.js').Tick|import('./types.js').Candle>} */
    this.buffer = [];
    this.maxBuffer = Math.max(this.config.windowBars * 2, 200);
    this.models = this.config.predictors.map((id) =>
      createPredictor(id, this.config.predictorOptions[id] || {})
    );
    this._stepMs = this.config.stepMs;
  }

  /** 内部状態を保ったまま設定だけ差し替える（重み変更など） */
  get horizonMs() {
    return this.config.horizonSeconds * 1000;
  }

  /** @param {import('./types.js').Tick|import('./types.js').Candle} point */
  push(point) {
    this.buffer.push(point);
    if (this.buffer.length > this.maxBuffer) this.buffer.splice(0, this.buffer.length - this.maxBuffer);
  }

  /** 複数点をまとめて投入 */
  load(points) {
    for (const p of points) this.push(p);
  }

  get ready() {
    return this.buffer.length >= Math.min(this.config.windowBars, 10);
  }

  /** 1 歩あたりの時間（ms）。設定値 → データ推定の順。 */
  stepMs() {
    if (this._stepMs) return this._stepMs;
    const d = inferInterval(this.buffer.slice(-Math.min(this.buffer.length, 500)));
    return Number.isFinite(d) && d > 0 ? d : 1000;
  }

  /** 現時点（バッファ末尾）のスプレッドを決める */
  currentSpread(point) {
    if (this.config.spreadMode === 'fixed') return this.config.spreadValue || 0;
    if (Number.isFinite(point.spread)) return point.spread;
    // auto だがデータにスプレッドが無い → 直近の既知スプレッド、無ければ設定値
    for (let i = this.buffer.length - 1; i >= 0 && i >= this.buffer.length - 50; i--) {
      if (Number.isFinite(this.buffer[i].spread)) return this.buffer[i].spread;
    }
    return this.config.spreadValue || 0;
  }

  /**
   * バッファ末尾時点の予測を返す。
   * @returns {import('./types.js').Prediction|null} データ不足なら null
   */
  predict() {
    if (!this.ready) return null;
    const win = this.buffer.slice(-this.config.windowBars);
    const closes = win.map((p) => pointPrice(this.kind, p));
    const last = win[win.length - 1];
    const mid = closes[closes.length - 1];
    const features = computeFeatures(closes);
    const stepMs = this.stepMs();
    const horizonSteps = Math.max(1, this.horizonMs / stepMs);
    const spread = this.currentSpread(last);
    const band = spread / 2 + (this.config.flatThreshold || 0);
    const ctx = {
      closes,
      bars: this.kind === 'candle' ? win : null,
      features,
      vol: features.vol,
      stepMs,
      horizonMs: this.horizonMs,
      horizonSteps,
      spreadLog: Math.log1p(band / mid),
      config: this.config,
    };
    const parts = [];
    let wsum = 0, muSum = 0, sigSum = 0;
    for (const m of this.models) {
      const w = this.config.weights[m.id] ?? 1;
      if (w <= 0) continue;
      const out = m.predict(ctx);
      if (!Number.isFinite(out.mu) || !Number.isFinite(out.sigma)) continue;
      parts.push({ id: m.id, mu: out.mu, sigma: out.sigma, weight: w, extra: out });
      muSum += w * out.mu;
      sigSum += w * out.sigma;
      wsum += w;
    }
    const mu = wsum ? muSum / wsum : 0;
    const sigma = wsum ? sigSum / wsum : features.vol * Math.sqrt(horizonSteps);
    const d = decide({
      mu,
      sigma,
      mid,
      spread,
      flatThreshold: this.config.flatThreshold,
      payout: this.config.payout,
      minProb: this.config.minProb,
      minEv: this.config.minEv,
    });
    return {
      t: last.t,
      index: this.buffer.length - 1,
      mid,
      spread,
      mu,
      sigma,
      horizonSteps,
      ...d,
      parts,
      features: features.vector,
      _ctx: ctx,
    };
  }

  /**
   * 結果が判明した予測でオンライン学習モデルを更新する。
   * @param {import('./types.js').Prediction} prediction
   * @param {import('./types.js').Direction} outcome
   */
  learn(prediction, outcome) {
    for (const m of this.models) if (m.learn) m.learn(prediction._ctx, outcome);
  }

  /**
   * 予測に対する実現結果を判定する。
   * @param {import('./types.js').Prediction} prediction
   * @param {number} exitMid ホライズン到達時点の仲値
   */
  resolve(prediction, exitMid) {
    return resolveOutcome(prediction.mid, exitMid, prediction.band);
  }

  reset() {
    this.buffer = [];
    for (const m of this.models) if (m.reset) m.reset();
  }
}

/**
 * 便利関数: 過去データ（Series）を渡して末尾時点の予測を 1 回返す。
 * @param {import('./types.js').Series} series
 * @param {PredictorConfig} [config]
 */
export function predictFromHistory(series, config = {}) {
  const p = new Predictor(config, series.kind);
  p.load(series.data.slice(-Math.max((config.windowBars || DEFAULT_CONFIG.windowBars) * 2, 200)));
  return p.predict();
}
