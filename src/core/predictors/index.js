/**
 * 予測モデル（Predictor）のレジストリ。
 *
 * すべてのモデルは共通インターフェースを持つ:
 *   predict(ctx) -> { mu, sigma }
 *     mu    : ホライズン終了時点までの期待対数リターン
 *     sigma : その標準偏差（不確実性）
 *   learn?(ctx, outcome)  : 実現結果でオンライン更新（任意）
 *   reset?()              : 内部状態のリセット（任意）
 *
 * ctx = { closes, features, vol, stepMs, horizonMs, horizonSteps, spreadLog, config }
 */
import { momentumPredictor } from './momentum.js';
import { meanReversionPredictor } from './meanReversion.js';
import { linearTrendPredictor } from './linearTrend.js';
import { onlineLogisticPredictor } from './onlineLogistic.js';
import { candlePatternPredictor } from './candlePattern.js';

export const PREDICTOR_FACTORIES = {
  momentum: momentumPredictor,
  meanReversion: meanReversionPredictor,
  linearTrend: linearTrendPredictor,
  candlePattern: candlePatternPredictor,
  onlineLogistic: onlineLogisticPredictor,
};

export const PREDICTOR_INFO = [
  { id: 'momentum', name: 'モメンタム', description: '直近の平均リターン（ドリフト）が継続すると仮定する。トレンド相場向け。', defaultWeight: 1 },
  { id: 'meanReversion', name: '平均回帰', description: '移動平均からの乖離が一部戻ると仮定する。レンジ相場向け。', defaultWeight: 1 },
  { id: 'linearTrend', name: '線形トレンド外挿', description: 'ウィンドウ内の対数価格に直線を当てはめ、t 秒後まで延長する。', defaultWeight: 1 },
  { id: 'candlePattern', name: 'ローソク足形状', description: '直近バーの実体・ヒゲの比率から短期の方向バイアスを推定する。', defaultWeight: 0.5 },
  { id: 'onlineLogistic', name: 'オンライン学習 (ロジスティック回帰)', description: '14 種の特徴量から上昇/下落確率を学習する。シミュレーション中に結果を使って逐次更新される。', defaultWeight: 1.5 },
];

/** @param {string} id @param {object} [options] */
export function createPredictor(id, options = {}) {
  const f = PREDICTOR_FACTORIES[id];
  if (!f) throw new Error(`unknown predictor: ${id}`);
  return f(options);
}
