#!/usr/bin/env node
/** オフライン利用向け: node_modules の SheetJS を app/vendor/ にコピーする（npm install 後に実行） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/xlsx/dist/xlsx.full.min.js');
const dstDir = path.join(root, 'app/vendor');
if (!fs.existsSync(src)) {
  console.error('node_modules/xlsx が見つかりません。先に npm install を実行してください。');
  process.exit(1);
}
fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, path.join(dstDir, 'xlsx.full.min.js'));
console.log('copied app/vendor/xlsx.full.min.js');
