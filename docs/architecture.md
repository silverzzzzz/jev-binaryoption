# アーキテクチャ

## 設計方針

1. **コアは依存なし・環境非依存**。ブラウザ（HTML アプリ、Chrome 拡張）と Node（CLI、テスト、将来の API トレードサーバー）で同じ `src/core` を使う。
2. **シミュレーションとリアルタイムで同じクラスを使う**。`Predictor` は「バッファに点を push して predict する」だけのインターフェースなので、過去データを順に流せばシミュレーション、ライブ価格を流せばリアルタイムになる。検証した通りの挙動が本番でも再現される。
3. **モデルは (μ, σ) を返すだけの小さな部品**。方向の判定・スプレッド・ペイアウトは意思決定層に集約し、モデルの追加や重み調整を容易にする。
4. **未来情報を使わない**。シミュレーションではオンライン学習の更新を「結果が判明した時点」まで遅らせる。

## データフロー

```
ファイル (CSV/TSV/XLSX/JSON)   公開 API (src/tools)   DuckDB-wasm (任意)
        │ importers.js            │ fetchSeries()        │ SQL → 行
        ▼                         ▼                      ▼
   {header, rows}  ──── detectColumns / buildSeries ────▶ Series {kind, data[]}
                                                              │ toCandleSeries (任意: tick → 足)
                                                              ▼
                  ┌────────────── simulate(series, config) ───────────────┐
                  │  for each point i:                                     │
                  │    predictor.push(point)                               │
                  │    resolve pending whose horizon <= t_i → learn        │
                  │    prediction = predictor.predict()                    │
                  │    pending.push({prediction, resolveIndex})            │
                  └──────────────────────────────▶ {records, metrics, equity}
                  ┌────────────── RealtimeSession ──────────────┐
                  │  push(tick) → resolve due → predict → emit  │
                  └─────────────────────────────────────────────┘
```

## Predictor の内部

```
buffer (直近 windowBars × 2 点)
  └─ window = 末尾 windowBars 点
       ├─ closes            → computeFeatures → {vector[14], vol, returns}
       ├─ stepMs            (設定 or データの中央間隔)
       ├─ horizonSteps      = horizonSeconds*1000 / stepMs
       ├─ spread            (auto: 点の bid/ask, fixed: 設定値)
       └─ ctx → 各モデル.predict(ctx) → {mu, sigma}
                   重み付き平均 → (μ, σ)
                   decide({μ, σ, mid, spread, flatThreshold, payout, minProb})
                     → pUp, pDown, pFlat, direction, expectedPrice, ev, trade
```

## モジュール一覧

| ファイル | 役割 |
| --- | --- |
| `src/core/engine.js` | `Predictor`（設定、バッファ、モデル合成、`predict/learn/resolve`）、`predictFromHistory` |
| `src/core/decision.js` | `decide`（確率・EV・推奨）、`resolveOutcome`（実現結果の判定） |
| `src/core/predictors/*.js` | 個別モデル。`index.js` にレジストリと UI 用のメタ情報 |
| `src/core/features.js` | 特徴量計算 |
| `src/core/simulator.js` | `simulate`（ジェネレータ）、`runSimulation`、`runSimulationAsync`、`computeMetrics` |
| `src/core/realtime.js` | `RealtimeSession`（イベント: prediction / resolved / signal） |
| `src/core/dataset.js` | 列判定 `detectColumns`、`buildSeries`、`summarize` |
| `src/core/csv.js` | 区切りテキストのパースと出力 |
| `src/core/bars.js` | tick→足集計、リサンプル、時刻二分探索 |
| `src/core/time.js` | 時刻パース（ISO / MT4 / epoch / Excel シリアル） |
| `src/core/math.js` | 統計関数（正規分布 CDF / 逆関数、回帰、RSI など） |
| `src/core/synthetic.js` | 合成データ |
| `app/app.js` | UI コントローラ（タブ、設定の永続化、シミュレーション実行、再生） |
| `app/chart.js` | canvas チャート |
| `app/importers.js` | ファイル読み込み、SheetJS / DuckDB-wasm の遅延ロード |
| `src/tools/sources.js` | 無料データ提供元ごとの URL 組み立てと応答変換（純粋関数） |
| `src/tools/fetchClient.js` | ページング / カーソル処理と HTTP リトライ。CLI とブラウザで共用 |

## 将来の拡張ポイント

- **価格ソースの追加**: `RealtimeSession.push()` に tick を渡す部分だけを差し替える（DOM 監視、WebSocket、REST ポーリング）。
- **モデルの追加**: `src/core/predictors/` に `{id, predict(ctx), learn?(ctx, outcome)}` を返すファクトリを追加し、`index.js` に登録する。
- **発注**: `RealtimeSession` の `signal` イベントを購読して業者 API を呼ぶ層を追加する（docs/roadmap.md 参照）。
