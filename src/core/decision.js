import { normalCdf } from './math.js';

/**
 * モデル出力 (mu, sigma) とスプレッドから 3 クラス確率と推奨を計算する意思決定層。
 *
 * 上昇と判定する条件: t 秒後の価格 > エントリー価格 + band
 * 下落と判定する条件: t 秒後の価格 < エントリー価格 - band
 * それ以外は「同じ (flat)」。
 *   band = spread / 2 + flatThreshold   （価格単位）
 * spread/2 は「仲値で判定されず、買いは ask・売りは bid で約定する」ことの近似。
 * flatThreshold は業者の判定閾値や、勝ちと見なす最小値幅（0 なら仲値超え）。
 *
 * @param {object} p
 * @param {number} p.mu      期待対数リターン
 * @param {number} p.sigma   その標準偏差
 * @param {number} p.mid     エントリー時の仲値
 * @param {number} p.spread  スプレッド（価格単位）
 * @param {number} [p.flatThreshold=0] 追加の閾値（価格単位）
 * @param {number} [p.payout=0.85] ペイアウト率（掛け金 1 に対する利益）
 * @param {number} [p.minProb=0.55] エントリー推奨に必要な確率
 * @param {number} [p.minEv=0]      エントリー推奨に必要な期待値
 */
export function decide(p) {
  const { mu, mid } = p;
  const sigma = Math.max(p.sigma, 1e-9);
  const spread = Number.isFinite(p.spread) ? p.spread : 0;
  const flatThreshold = p.flatThreshold ?? 0;
  const payout = p.payout ?? 0.85;
  const minProb = p.minProb ?? 0.55;
  const minEv = p.minEv ?? 0;
  const band = spread / 2 + flatThreshold;
  const bLog = Math.log1p(band / mid); // 対数スケールの帯幅
  const pUp = 1 - normalCdf((bLog - mu) / sigma);
  const pDown = normalCdf((-bLog - mu) / sigma);
  const pFlat = Math.max(0, 1 - pUp - pDown);
  let direction = 'flat';
  let confidence = pFlat;
  if (pUp >= pDown && pUp >= pFlat) {
    direction = 'up';
    confidence = pUp;
  } else if (pDown > pUp && pDown >= pFlat) {
    direction = 'down';
    confidence = pDown;
  }
  // 売買方向の期待値（flat は「見送り」なので EV は計算しない）
  const pTrade = direction === 'up' ? pUp : direction === 'down' ? pDown : 0;
  const ev = direction === 'flat' ? 0 : pTrade * payout - (1 - pTrade);
  const trade = direction !== 'flat' && pTrade >= minProb && ev >= minEv;
  const expectedPrice = mid * Math.exp(mu);
  return {
    pUp,
    pDown,
    pFlat,
    direction,
    confidence,
    ev,
    trade,
    band,
    expectedPrice,
    expectedMove: expectedPrice - mid,
    breakEvenProb: 1 / (1 + payout),
  };
}

/**
 * 実現結果を判定する。
 * @param {number} entryMid
 * @param {number} exitMid
 * @param {number} band 価格単位
 * @returns {import('./types.js').Direction}
 */
export function resolveOutcome(entryMid, exitMid, band) {
  if (exitMid > entryMid + band) return 'up';
  if (exitMid < entryMid - band) return 'down';
  return 'flat';
}
