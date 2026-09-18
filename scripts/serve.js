#!/usr/bin/env node
/**
 * 依存なしの静的ファイルサーバー。`npm run serve` → http://localhost:8787/app/
 * ES モジュールは file:// では動かないため、開発時はこれで配信する。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || process.argv[2] || 8787);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/app/';
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 ' + url); }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // DuckDB-wasm の pthread 版を使えるようにする（無くても動く）
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Jev app: http://localhost:${port}/app/`);
});
