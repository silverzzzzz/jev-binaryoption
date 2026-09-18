# 予測モデルと判定ロジック

## 問題設定

時刻 t₀ の仲値 P₀ に対し、t 秒後の仲値 P₁ が

- `up`   : P₁ > P₀ + band
- `down` : P₁ < P₀ − band
- `flat` : それ以外（判定帯の中）

のどれになるかを予測する。ここで

```
band = spread / 2 + flatThreshold
```

- `spread / 2`: 買い（HIGH）は ask で入り仲値で判定されず、売り（LOW）は bid で入る、という
  「スプレッド分だけ不利」な状況の近似。業者が仲値で判定し、かつスプレッド無しの取引なら 0 にできる。
- `flatThreshold`: 業者の「同値は負け」ルールや、勝ちと見なす最小値幅を表す追加帯。

## 二段構え: モデル → 意思決定層

### 1. 各モデルは (μ, σ) を出す

すべてのモデルは、ホライズン終了時点までの **対数リターン** の期待値 μ と標準偏差 σ を返す。
価格スケールに依存しないため、通貨ペア・株価指数・仮想通貨を問わず同じコードで動く。

| id | 名称 | μ の考え方 | 向く相場 |
| --- | --- | --- | --- |
| `momentum` | モメンタム | 直近 lookback 本の平均対数リターン × ホライズン歩数 | トレンド |
| `meanReversion` | 平均回帰 | SMA からの乖離の一部（beta）が戻る | レンジ |
| `linearTrend` | 線形トレンド外挿 | ウィンドウ内の対数価格に直線回帰し延長。残差を σ に加算 | 緩やかなトレンド |
| `candlePattern` | ローソク足形状 | 直近数本の実体方向・ヒゲの偏りからバイアス | 短期の勢い |
| `onlineLogistic` | オンライン学習 | 14 特徴量からロジスティック回帰で P(up), P(down) を推定し、正規分布仮定の逆関数で μ に変換。結果が判明するたび SGD で更新 | データに適応 |

σ の基本値は「ウィンドウ内 1 歩リターンの標準偏差 × √(ホライズン歩数)」。

### 2. 合成

```
μ = Σ wᵢ μᵢ / Σ wᵢ,   σ = Σ wᵢ σᵢ / Σ wᵢ
```

重みは設定タブで変更できる。重み 0 またはチェック解除でモデルを外す。

### 3. 意思決定層 (`decide`)

対数リターン X ~ N(μ, σ²) を仮定し、帯幅 b = log(1 + band / P₀) として

```
pUp   = 1 − Φ((b − μ) / σ)
pDown = Φ((−b − μ) / σ)
pFlat = 1 − pUp − pDown
```

- `direction` = 確率最大のクラス、`confidence` = その確率
- `expectedPrice` = P₀ · e^μ、`expectedMove` = expectedPrice − P₀
- `ev` = p · payout − (1 − p)（推奨方向でエントリーしたときの掛け金 1 あたりの期待値）
- `trade` = direction ≠ flat かつ p ≥ minProb かつ ev ≥ minEv
- 損益分岐勝率 = 1 / (1 + payout)。ペイアウト 85% なら 54.05%。

スプレッドが広いほど b が大きくなり pFlat が増え、確率は 50% に近づく。
これにより「動きが小さいと見込まれる局面では見送る」判断が自然に出る。

## 特徴量（`computeFeatures`）

すべてボラティリティで正規化した無次元量。順に:

`ret1, ret2, ret3, ret5, ret10`（ラグ別リターン / vol√k）, `drift`（平均リターンの t 値）,
`emaDiff`（EMA 短期/長期の対数差）, `zscore`（SMA からの乖離）, `slope`（回帰傾き）,
`rsi`（(RSI−50)/50）, `rangePos`（レンジ内位置 −1..1）, `volRatio`（直近ボラ / 全体ボラ の対数）,
`accel`（リターンの加速）, `cumRet`（累積リターン）。

## オンライン学習の詳細

- up ヘッドと down ヘッドの 2 つのロジスティック回帰（バイアス項 + 14 次元）。
- 更新: SGD、学習率 `learningRate`（既定 0.02）、L2 正則化 `l2`（既定 1e-4）。
- 学習サンプル数が `warmup`（既定 30）に達するまで μ を縮小し、学習前は中立を返す。
- シミュレーションでは結果が判明した時点で `learn()` が呼ばれる（ホライズン到達後）。
- リアルタイムでは `RealtimeSession` が期限を迎えた予測を自動判定して `learn()` する。
- 学習した重みは結果 JSON の `learners` に含まれる。永続化して次回に引き継ぐ機能は未実装（ロードマップ）。

## モデルを追加するには

```js
// src/core/predictors/myModel.js
export function myModelPredictor(options = {}) {
  return {
    id: 'myModel',
    predict(ctx) {
      // ctx.closes, ctx.bars (candle のみ), ctx.features.{vector,named,vol,returns},
      // ctx.stepMs, ctx.horizonMs, ctx.horizonSteps, ctx.spreadLog, ctx.config
      return { mu: 0, sigma: ctx.vol * Math.sqrt(ctx.horizonSteps) };
    },
    learn(ctx, outcome) {}, // 任意
    reset() {},             // 任意
  };
}
```

`src/core/predictors/index.js` の `PREDICTOR_FACTORIES` と `PREDICTOR_INFO` に登録すると UI にも表示される。

## 既知の限界

- 正規分布仮定はファットテール・ジャンプを過小評価する。
- ホライズン歩数はデータの中央間隔から推定するため、tick 間隔が不規則なデータでは σ の見積もりがぶれる。必要なら `stepMs` を設定で固定する。
- 合成データはトレンド局面に人工的な予測可能性がある。実データで検証すること。
