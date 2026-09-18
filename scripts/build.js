#!/usr/bin/env node
/**
 * app/ を 1 つの HTML ファイル (dist/jev-sim.html) にバンドルする。
 * file:// でダブルクリックして開けるので配布が容易。要 `npm install`（esbuild）。
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const js = await build({
  entryPoints: [path.join(root, 'app/app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  // DuckDB は実行時に CDN から動的 import する
  external: ['https://*'],
});
const css = fs.readFileSync(path.join(root, 'app/styles.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
html = html
  .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="./app.js"></script>', `<script>${js.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>')}</script>`);
fs.writeFileSync(path.join(out, 'jev-sim.html'), html);
console.log(`built dist/jev-sim.html (${(html.length / 1024).toFixed(0)} KB)`);

// --- コアのスタンドアロン版（グローバル Jev）: 拡張機能・他ページから <script> で利用 ---
const core = await build({
  entryPoints: [path.join(root, 'src/core/index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'Jev',
  minify: true,
  write: false,
  target: 'es2020',
});
fs.writeFileSync(path.join(out, 'jev-core.js'), core.outputFiles[0].text);
console.log(`built dist/jev-core.js (${(core.outputFiles[0].text.length / 1024).toFixed(0)} KB)`);

// --- Chrome 拡張（実験的）: extension/ + jev-core.js を dist/extension/ へ ---
const extOut = path.join(out, 'extension');
fs.mkdirSync(extOut, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'extension'))) {
  if (f.endsWith('.md')) continue;
  fs.copyFileSync(path.join(root, 'extension', f), path.join(extOut, f));
}
fs.copyFileSync(path.join(out, 'jev-core.js'), path.join(extOut, 'jev-core.js'));
console.log('built dist/extension/ (chrome://extensions → パッケージ化されていない拡張機能を読み込む)');
