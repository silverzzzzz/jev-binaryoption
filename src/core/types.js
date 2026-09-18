/**
 * 共通の型定義（JSDoc のみ。ランタイムには何も含まない）。
 *
 * @typedef {Object} Tick
 * @property {number} t    エポックミリ秒
 * @property {number} mid  仲値 (bid と ask の平均、または単一価格)
 * @property {number} [bid]
 * @property {number} [ask]
 * @property {number} [spread] ask - bid（絶対値、価格単位）
 *
 * @typedef {Object} Candle
 * @property {number} t   バー開始時刻（エポックミリ秒）
 * @property {number} o
 * @property {number} h
 * @property {number} l
 * @property {number} c
 * @property {number} [v]
 * @property {number} [spread] バー内の平均スプレッド（分かる場合）
 *
 * @typedef {'tick'|'candle'} SeriesKind
 *
 * @typedef {Object} Series
 * @property {SeriesKind} kind
 * @property {Array<Tick|Candle>} data  時刻昇順
 * @property {number} [intervalMs]      ローソク足の間隔（candle の場合）
 *
 * @typedef {'up'|'down'|'flat'} Direction
 *
 * @typedef {Object} ModelOutput
 * @property {number} mu     ホライズン t 秒後までの期待対数リターン
 * @property {number} sigma  同・標準偏差
 *
 * @typedef {Object} Prediction
 * @property {number} t          予測時点
 * @property {number} index      系列内インデックス
 * @property {number} mid        予測時点の仲値（エントリー価格）
 * @property {number} spread     採用したスプレッド（価格単位）
 * @property {number} mu
 * @property {number} sigma
 * @property {number} pUp
 * @property {number} pDown
 * @property {number} pFlat
 * @property {Direction} direction  最も確率の高い方向
 * @property {number} confidence    その確率
 * @property {number} expectedPrice t 秒後の予想価格
 * @property {number} expectedMove  expectedPrice - mid
 * @property {number} ev            推奨方向でエントリーした場合の期待値（掛け金 1 あたり）
 * @property {boolean} trade        エントリー推奨か
 * @property {Array<{id:string, mu:number, sigma:number, weight:number}>} parts 各モデルの出力
 * @property {number[]} features    特徴量ベクトル（オンライン学習用）
 */
export {};
