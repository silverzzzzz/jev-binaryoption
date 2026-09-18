# ロードマップ

## フェーズ 0（本リリース）— 検証基盤

- [x] 依存なしのコア（取り込み、特徴量、5 モデル、スプレッド込み判定、シミュレータ、リアルタイムセッション）
- [x] HTML アプリ（CSV / Excel / JSON / DuckDB SQL、設定、シミュレーション、再生）
- [x] 単一 HTML ビルド、CLI、ユニットテスト、サンプルデータ
- [x] Chrome 拡張の雛形（DOM から価格を読み取り → サイドパネルで予測）

## フェーズ 1 — リアルタイム価格の取得

### A. Chrome 拡張（`extension/`）

1. 業者ページの bid/ask 要素の CSS セレクタを設定に保存し、`content.js` が 250ms ごとに読み取って tick を送る。
2. サイドパネルの `RealtimeSession` が予測を表示。
3. 追加予定: `MutationObserver` による即時検出、複数銘柄、tick の IndexedDB 保存（後でシミュレーションに再利用）、ページの WebSocket を `chrome.debugger` で傍受する方式。

### B. 専用ブラウザ（Electron / Playwright）

- Electron に `app/` をそのまま載せ、`BrowserView` で業者ページを開いて `executeJavaScript` で価格を取得。
- 拡張よりも自由度が高い（ネットワーク傍受、ヘッドレス運用、複数タブ）。
- Node 側で `RealtimeSession` を動かし、UI とは IPC でやり取り。

### C. データ API / WebSocket

- 業者やデータベンダーの WebSocket / REST から tick を取得し、`session.push()` に流す。
- 取得した tick は CSV/Parquet に保存し、DuckDB で集計してシミュレーションへ。

## フェーズ 2 — モデル強化

- 学習済み重みの保存・読み込み（`learners` を JSON で永続化）。
- 時間帯・曜日の特徴量、ボラ局面の分類（レジーム）ごとのモデル切替。
- 較正（Platt / isotonic）による確率の補正。
- 勾配ブースティングや小型ニューラルネット（ONNX Runtime Web）を `predictors/` に追加。
- ウォークフォワードでのハイパーパラメータ探索（ウィンドウ・ホライズン・重み）の自動化。

## フェーズ 3 — API トレード

- `RealtimeSession` の `signal` イベントを購読する **Executor** を追加:
  `{ place(direction, amount, expirySeconds), cancel(), balance() }` のインターフェース。
- 業者 API（または Playwright による画面操作）でのアダプタ実装。
- リスク管理: 1 日の最大損失、連敗ストップ、同時ポジション上限、スプレッド急拡大時の停止。
- 発注結果を記録し、シミュレーションの想定（判定帯・ペイアウト）と実際の乖離を監視。

## フェーズ 4 — 運用

- ダッシュボード（本日の成績、モデル別寄与、較正のドリフト）
- 通知（推奨シグナル、異常検知）
- 自動再学習と A/B（シャドー運用）
