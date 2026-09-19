# Jev — バイナリーオプション方向予測シミュレーター

過去の価格データ（tick またはローソク足）から **「t 秒後に価格が上がるか・下がるか・同じか」** を
リアルタイムに判定するためのエンジンと、過去データで検証（シミュレーション）するための HTML アプリです。
スプレッドを判定帯として組み込み、予想価格・確率・期待値（EV）も返します。

```
過去データ (CSV / Excel / JSON / DuckDB SQL)
   │
   ▼
Jev core (src/core)  ── Predictor.predict() ──▶ { direction: 'up'|'down'|'flat',
   │                                              pUp, pDown, pFlat, expectedPrice, ev, trade }
   ├─ simulate()          過去データをウォークフォワードで検証
   └─ RealtimeSession     価格を 1 点ずつ push → 最新予測、ホライズン後に自動で結果判定と学習
```

- **依存なしの純 JavaScript (ESM)**。ブラウザでも Node でも同じコードが動きます。
- **HTML アプリ** (`app/`) はビルド不要。`npm run build` で 1 ファイル (`dist/jev-sim.html`) にもできます。
- Excel 読み込み (SheetJS) と DuckDB-wasm による SQL 前処理はブラウザ側で CDN から遅延ロード（任意機能）。
- Chrome 拡張の雛形 (`extension/`) は同じ `RealtimeSession` を使ってページ上の価格から予測します（実験的）。

> **注意**: 本ツールは検証用です。過去データ（特に合成データ）での成績は将来の収益を保証しません。
> 実際の業者の判定ルール・スプレッド・ペイアウトに合わせて、十分な期間の実データで検証してください。

## クイックスタート

```bash
git clone <this repo>
cd jev-binaryoption
npm install            # esbuild / xlsx（開発用。コアの実行には不要）
npm test               # コアのユニットテスト
npm run serve          # http://localhost:8787/app/ でアプリを開く
```

アプリの流れ:

1. **データ** タブ: CSV / Excel をドロップするか、「サンプルデータを生成」を押す。列名は自動判定。
2. **設定** タブ: 参照バー数、何秒後 (t)、スプレッド、ペイアウト率、使用モデルと重みを指定。
3. **シミュレーション** タブ: 実行 → 正解率、勝率、損益曲線、混同行列、較正表、モデル別成績、予測ログ。CSV / JSON で書き出し可能。
4. **リアルタイム再生** タブ: 同じデータを 1 点ずつ流し、リアルタイム運用時と同じ API の出力を確認。

配布用の単一 HTML:

```bash
npm run build          # dist/jev-sim.html（ダブルクリックで開ける）, dist/jev-core.js, dist/extension/
```

CLI でのシミュレーション:

```bash
node scripts/sim-cli.js samples/sample_ticks.csv --horizon 30 --window 60 --payout 0.85
node scripts/sim-cli.js samples/sample_candles_m1.csv --horizon 300 --window 30 --out result.json
```

## 実データを無料で取得する

アプリの**データ**タブにある「オンラインから実データを取得」から、Binance / Kraken / bitFlyer の
実データを直接読み込めます（APIキー不要）。CLI からも取得できます（`data/` に CSV を保存）。

```bash
node scripts/fetch-data.js --source binance --symbol BTCUSDT --interval 1s --days 1
node scripts/fetch-data.js --source yahoo   --symbol USDJPY=X --interval 1m --days 7
node scripts/fetch-data.js --source bitflyer --symbol BTC_JPY --tick --hours 1
node scripts/fetch-data.js --help          # 提供元とオプションの一覧
```

これらのデータには bid/ask が含まれないため、検証時は実際のスプレッドを指定してください。

```bash
node scripts/sim-cli.js data/binance_BTCUSDT_candle_1s_1d.csv --horizon 60 --spread 2
```

FX の **bid/ask 付き tick**（バイナリーオプションの検証にはこちらが適切）は Dukascopy から取得できます。

```bash
npx dukascopy-node@latest -i eurusd -from 2024-01-02 -to 2024-01-03 -t tick -f csv
```

提供元の一覧、銘柄名の書式、利用上の注意は [docs/data-sources.md](docs/data-sources.md) を参照してください。

## コアをコードから使う

```js
import { Predictor, RealtimeSession, runSimulation, parseDelimited, buildSeries } from './src/core/index.js';

// 1) 過去データを読み込む
const { header, rows } = parseDelimited(csvText);
const series = buildSeries(header, rows);      // { kind: 'tick'|'candle', data: [...] }

// 2) シミュレーション
const result = runSimulation(series, { windowBars: 60, horizonSeconds: 60, payout: 0.85, minProb: 0.55 });
console.log(result.metrics.accuracy, result.metrics.winRate, result.metrics.pnl);

// 3) リアルタイム
const session = new RealtimeSession({ windowBars: 60, horizonSeconds: 60 }, 'tick');
session.on('signal', (p) => console.log('エントリー推奨', p.direction, p.pUp, p.expectedPrice));
session.push({ t: Date.now(), bid: 150.001, ask: 150.004, mid: 150.0025, spread: 0.003 });
```

## リポジトリ構成

```
src/core/            予測エンジン（依存なし ESM）
  engine.js          Predictor: ウィンドウ管理・モデル合成・意思決定
  decision.js        (μ, σ, スプレッド) → 上昇/下落/同じ の確率, EV, 推奨
  predictors/        モメンタム / 平均回帰 / 線形トレンド / ローソク足形状 / オンライン学習
  features.js        価格スケール非依存の特徴量 14 種
  simulator.js       ウォークフォワード検証と指標計算
  realtime.js        RealtimeSession（push → 予測、期限後に自動判定・学習）
  dataset.js csv.js bars.js time.js   取り込み・列判定・tick→足集計・時刻パース
  synthetic.js       合成データ生成
app/                 HTML アプリ（index.html, app.js, chart.js, importers.js, styles.css）
extension/           Chrome 拡張の雛形（実験的）
src/tools/sources.js 無料データ提供元ごとの URL 組み立てと応答の変換
scripts/             serve / build / sample 生成 / データ取得 / CLI シミュレーション / vendor
samples/             サンプル CSV（tick と MT 形式 1 分足）
test/                node:test によるユニットテスト
docs/                設計ドキュメント
```

## ドキュメント

- [docs/architecture.md](docs/architecture.md) — 全体構成とデータフロー
- [docs/data-format.md](docs/data-format.md) — 対応するファイル形式・列名・時刻形式
- [docs/data-sources.md](docs/data-sources.md) — 無料で価格データを入手する方法
- [docs/prediction-model.md](docs/prediction-model.md) — 予測モデルとスプレッドを含む判定ロジック
- [docs/simulation.md](docs/simulation.md) — シミュレーションの仕組みと指標の読み方
- [docs/roadmap.md](docs/roadmap.md) — Chrome 拡張 / 専用ブラウザ / API トレードへの道筋
- [docs/development.md](docs/development.md) — 開発・テスト・ビルド手順

## ライセンス

MIT
