# 開発ガイド

## 必要環境

- Node.js 18 以上（テストに `node:test` を使用）
- ブラウザ（Chrome / Edge / Firefox / Safari の最近の版）

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm install` | 開発用依存（esbuild, xlsx）を導入。コアの実行には不要 |
| `npm test` | `test/*.test.js` を実行 |
| `npm run serve` | `http://localhost:8787/app/` で開発サーバー（ES モジュールのため file:// では動かない） |
| `npm run build` | `dist/jev-sim.html`（単一 HTML）、`dist/jev-core.js`（グローバル `Jev`）、`dist/extension/` を生成 |
| `npm run vendor` | SheetJS を `app/vendor/` にコピー（オフラインで Excel を読む場合） |
| `npm run sample` | `samples/*.csv` を再生成 |
| `npm run sim -- <file> [opts]` | CLI シミュレーション（`node scripts/sim-cli.js` と同じ） |

## コードスタイル

- ESM、セミコロンあり、2 スペース、`.editorconfig` に従う。
- コアは **ブラウザ API と Node API のどちらにも依存しない**こと（`fs`、`document` を使わない）。
- 数値は価格単位（絶対値）と対数リターンを混同しない。関数の JSDoc に単位を書く。

## テストの追加

`test/` に `*.test.js` を置く。`node:test` と `node:assert/strict` を使用。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/core/index.js';
test('example', () => { assert.ok(decide({ mu: 0, sigma: 1, mid: 100, spread: 0 }).pFlat < 1e-6); });
```

## ブラウザでの動作確認

1. `npm run serve` → データタブで「生成して読み込む」→ シミュレーション実行。
2. `npm run build` → `dist/jev-sim.html` をダブルクリックで開いて同じ手順（file:// でも動く）。
3. Excel: `.xlsx` をドロップ。ネットが無い場合は `npm run vendor` を先に実行。
4. DuckDB: SQL タブで「DuckDB を読み込む」（要ネット）。`SELECT * FROM prices WHERE ...` で絞り込み → 「実行して結果を系列にする」。

## Chrome 拡張の試し方

1. `npm run build`
2. `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `dist/extension/`
3. 業者ページを開き、ツールバーのアイコンでサイドパネルを開く。
4. bid/ask 要素の CSS セレクタ（DevTools で確認）を入力して「保存して開始」。

## リリース

- `package.json` の version を更新し、`npm run build` の成果物（`dist/jev-sim.html`）を配布。
