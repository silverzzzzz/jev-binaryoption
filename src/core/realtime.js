import { Predictor } from './engine.js';
import { pointPrice } from './dataset.js';

/**
 * リアルタイム用セッション。
 * 価格が届くたびに push() すると最新の予測を返し、ホライズン到達後に
 * 自動で結果を判定してオンライン学習モデルへフィードバックする。
 * Chrome 拡張 / 専用ブラウザ / 将来の API トレードの共通入口。
 *
 * イベント: 'prediction' (pred), 'resolved' (record), 'signal' (trade 推奨の pred)
 */
export class RealtimeSession {
  /**
   * @param {import('./engine.js').PredictorConfig} config
   * @param {import('./types.js').SeriesKind} [kind='tick']
   */
  constructor(config = {}, kind = 'tick') {
    this.predictor = new Predictor(config, kind);
    this.kind = kind;
    this.pending = [];
    this.records = [];
    this.listeners = {};
    this.last = null;
    this.stats = { total: 0, correct: 0, traded: 0, wins: 0, pnl: 0 };
  }

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
    return () => {
      this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
    };
  }

  emit(event, payload) {
    for (const fn of this.listeners[event] || []) fn(payload);
  }

  /**
   * 新しい価格を投入する。
   * @param {import('./types.js').Tick|import('./types.js').Candle} point
   * @returns {import('./types.js').Prediction|null}
   */
  push(point) {
    const mid = pointPrice(this.kind, point);
    // 期限を迎えた予測を解決
    while (this.pending.length && this.pending[0].dueT <= point.t) {
      const pd = this.pending.shift();
      const outcome = this.predictor.resolve(pd.prediction, mid);
      this.predictor.learn(pd.prediction, outcome);
      const hit = pd.prediction.direction === outcome;
      const payout = this.predictor.config.payout;
      const pnl = pd.prediction.trade ? (hit ? payout : -1) : 0;
      const rec = { prediction: pd.prediction, exitT: point.t, exitMid: mid, outcome, hit, pnl };
      this.records.push(rec);
      this.stats.total++;
      if (hit) this.stats.correct++;
      if (pd.prediction.trade) {
        this.stats.traded++;
        if (hit) this.stats.wins++;
        this.stats.pnl += pnl;
      }
      this.emit('resolved', rec);
    }
    this.predictor.push(point);
    const pred = this.predictor.predict();
    if (pred) {
      this.last = pred;
      this.pending.push({ prediction: pred, dueT: point.t + this.predictor.horizonMs });
      this.emit('prediction', pred);
      if (pred.trade) this.emit('signal', pred);
    }
    return pred;
  }

  /** 過去データで初期化（予測は出さない） */
  prime(points) {
    this.predictor.load(points);
  }

  reset() {
    this.predictor.reset();
    this.pending = [];
    this.records = [];
    this.last = null;
    this.stats = { total: 0, correct: 0, traded: 0, wins: 0, pnl: 0 };
  }
}
