# Chrome 拡張（実験的）

ページ上の価格表示（bid/ask または単一価格の要素）を CSS セレクタで指定して読み取り、
サイドパネルで Jev の `RealtimeSession` による予測を表示します。

```
content.js  ── 250ms ごとに DOM を読む ──▶ chrome.runtime.sendMessage({type:'jev:tick', ...})
panel.js    ── RealtimeSession.push(tick) ──▶ 方向 / 確率 / 予想価格 / EV / 推奨
```

## ビルドと読み込み

```bash
npm run build          # dist/extension/ に manifest, content.js, panel.*, jev-core.js を出力
```

`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `dist/extension/`

## 設定

サイドパネル下部の設定に、業者ページの要素の CSS セレクタを入力します（DevTools の「Copy selector」が便利）。

- Bid / Ask 両方を指定: スプレッドを自動計算
- 単一価格のみ: 「固定スプレッド」を設定

## 制限・今後

- 現在は 1 ページ・1 銘柄。ページ遷移でセッションはリセットされます（サイドパネルを閉じない限り学習状態は残ります）。
- 発注機能はありません（docs/roadmap.md フェーズ 3）。
- ページの利用規約で自動取得が禁止されていないか確認してください。
