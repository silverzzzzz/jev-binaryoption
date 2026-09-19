#!/usr/bin/env node
/**
 * 無料の公開 API から実際の価格データを取得し、Jev が読める CSV に保存する。
 * API キー不要。Node 18 以上（グローバル fetch）。
 *
 * 例:
 *   node scripts/fetch-data.js --source binance --symbol BTCUSDT --interval 1s --days 1
 *   node scripts/fetch-data.js --source binance --symbol BTCUSDT --tick --hours 2
 *   node scripts/fetch-data.js --source yahoo   --symbol USDJPY=X --interval 1m --days 7
 *   node scripts/fetch-data.js --source kraken  --symbol XBTUSD  --interval 1 --days 1
 *   node scripts/fetch-data.js --source bitflyer --symbol BTC_JPY --tick --hours 1
 *   node scripts/fetch-data.js --source stooq   --symbol usdjpy
 *
 * 出力: data/<source>_<symbol>_<種別>_<期間>.csv （--out で変更可）
 *
 * 注意: 各提供元の利用規約に従ってください。取得したデータの再配布は
 * 多くの場合禁止されています。個人的な検証目的での利用を想定しています。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../src/tools/sources.js';
import { fetchSeries, makeHttpGet } from '../src/tools/fetchClient.js';
import { toCsv } from '../src/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

if (flag('help') || !argv.length) {
  console.log(`使い方: node scripts/fetch-data.js --source <name> --symbol <sym> [options]

提供元:
${Object.entries(SOURCES).map(([k, v]) => `  ${k.padEnd(9)} ${v.label.padEnd(15)} ${v.kinds.join('/').padEnd(12)} ${v.note}`).join('\n')}

オプション:
  --symbol <s>     銘柄 (例: BTCUSDT, USDJPY=X, XBTUSD, BTC_JPY, usdjpy)
  --interval <i>   ローソク足の間隔 (binance: 1s,1m,5m... / kraken: 分数 / yahoo: 1m,5m,1h)
  --tick           約定単位 (tick) で取得する（binance / kraken / bitflyer）
  --days <n>       過去 n 日ぶん (既定 1)
  --hours <n>      過去 n 時間ぶん（--days より優先）
  --end <iso>      終了時刻 (既定: 現在)
  --out <file>     出力先 CSV
  --limit <n>      最大行数（安全弁。既定 2000000）
  --base <url>     API のベース URL を差し替える（検証用。環境変数 JEV_API_BASE でも可）
  --quiet          進捗を表示しない

取得後:
  node scripts/sim-cli.js <出力ファイル> --horizon 60 --window 60 --spread 0.5
  （暗号資産や Yahoo のデータには bid/ask が無いため、--spread で実際のスプレッドを指定してください）`);
  process.exit(0);
}

const source = opt('source');
if (!SOURCES[source]) {
  console.error(`未知の提供元: ${source}. 選択肢: ${Object.keys(SOURCES).join(', ')}`);
  process.exit(1);
}
const symbol = opt('symbol');
if (!symbol) {
  console.error('--symbol を指定してください');
  process.exit(1);
}
const tick = flag('tick');
const quiet = flag('quiet');
const interval = opt('interval');
const maxRows = Number(opt('limit', 2000000));
const endTime = opt('end') ? Date.parse(opt('end')) : Date.now();
if (!Number.isFinite(endTime)) {
  console.error('--end の時刻を解釈できません');
  process.exit(1);
}
const spanMs = opt('hours') ? Number(opt('hours')) * 3600000 : Number(opt('days', 1)) * 86400000;
const startTime = endTime - spanMs;
const log = (...a) => { if (!quiet) process.stderr.write(a.join(' ') + '\n'); };

log(`${SOURCES[source].label} から ${symbol} を取得中 (${new Date(startTime).toISOString()} 〜 ${new Date(endTime).toISOString()}, ${tick ? 'tick' : 'candle ' + (interval || '1m')})`);

let result;
try {
  result = await fetchSeries({
    source, symbol, tick, interval, startTime, endTime, maxRows,
    base: opt('base', process.env.JEV_API_BASE),
    get: makeHttpGet({
      userAgent: 'jev-binaryoption/0.1 (data fetch for personal backtesting)',
      onRetry: (msg) => log('  ' + msg),
    }),
    onProgress: (rows, lastTime) => log(`  ${rows.toLocaleString()} 行 (${new Date(lastTime).toISOString().replace('T', ' ').slice(0, 19)} まで)`),
  });
} catch (e) {
  console.error('取得に失敗しました: ' + e.message);
  process.exit(1);
}

if (result.note) log('  注意: ' + result.note);
if (!result.rows.length) {
  console.error('データが 0 行でした。銘柄名・期間・提供元の対応状況を確認してください。');
  process.exit(1);
}

const span = tick ? `${Math.round(spanMs / 3600000)}h` : `${interval || '1m'}_${Math.round(spanMs / 86400000)}d`;
const safeSymbol = symbol.replace(/[^\w.-]/g, '');
const outPath = path.resolve(opt('out', path.join(root, 'data', `${source}_${safeSymbol}_${tick ? 'tick' : 'candle'}_${span}.csv`)));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, toCsv(result.header, result.rows) + '\n');

const first = Date.parse(result.rows[0][0]);
const last = Date.parse(result.rows[result.rows.length - 1][0]);
console.log(`保存しました: ${path.relative(process.cwd(), outPath)}`);
console.log(`  ${result.rows.length.toLocaleString()} 行, ${new Date(first).toISOString()} 〜 ${new Date(last).toISOString()}`);
console.log(`  平均間隔: ${((last - first) / Math.max(1, result.rows.length - 1) / 1000).toFixed(3)} 秒`);
if (!SOURCES[source].hasSpread) console.log('  ※ bid/ask を含まないデータです。シミュレーションでは --spread（アプリでは固定スプレッド）を指定してください。');
console.log(`\n次の手順:\n  node scripts/sim-cli.js ${path.relative(process.cwd(), outPath)} --horizon 60 --window 60 --spread <実際のスプレッド>`);
