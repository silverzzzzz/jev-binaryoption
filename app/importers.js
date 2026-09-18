/**
 * ファイル読み込み（CSV / Excel / JSON）と DuckDB-wasm の遅延ロード。
 * Excel と DuckDB はブラウザ側で CDN から読み込む（オフライン時は CSV のみ）。
 */
import { parseDelimited } from '../src/core/index.js';

const XLSX_SOURCES = [
  './vendor/xlsx.full.min.js', // npm run vendor で配置（オフライン用）
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(s);
  });
}

let xlsxPromise = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = (async () => {
      let lastErr;
      for (const src of XLSX_SOURCES) {
        try {
          await loadScript(src);
          if (window.XLSX) return window.XLSX;
        } catch (e) {
          lastErr = e;
        }
      }
      xlsxPromise = null;
      throw new Error('SheetJS (xlsx) を読み込めませんでした。ネット接続を確認するか、CSV に変換してください。' + (lastErr ? ` (${lastErr.message})` : ''));
    })();
  }
  return xlsxPromise;
}

/**
 * @param {File} file
 * @returns {Promise<{header:string[], rows:any[][], source:string}>}
 */
export async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
    const XLSX = await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const nonEmpty = aoa.filter((r) => r.some((c) => c !== '' && c != null));
    if (!nonEmpty.length) throw new Error('シートが空です');
    return { header: nonEmpty[0].map(String), rows: nonEmpty.slice(1), source: `${file.name} / ${wb.SheetNames[0]}` };
  }
  const text = await file.text();
  if (name.endsWith('.json')) return { ...parseJson(text), source: file.name };
  return { ...parseDelimited(text), source: file.name };
}

export function parseText(text, source = 'paste') {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return { ...parseJson(trimmed), source };
  return { ...parseDelimited(text), source };
}

/** JSON: オブジェクト配列 / 配列の配列 / {data:[...]} に対応 */
export function parseJson(text) {
  let obj = JSON.parse(text);
  if (obj && !Array.isArray(obj)) obj = obj.data || obj.rows || obj.values || Object.values(obj).find(Array.isArray) || [];
  if (!Array.isArray(obj) || !obj.length) throw new Error('JSON に配列が見つかりません');
  if (Array.isArray(obj[0])) {
    const header = obj[0].every((v) => typeof v === 'string' && !/^\d/.test(v)) ? obj[0].map(String) : obj[0].map((_, i) => `col${i}`);
    const rows = header === obj[0] ? obj.slice(1) : obj;
    return { header, rows };
  }
  const header = Array.from(obj.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set()));
  const rows = obj.map((r) => header.map((k) => r[k]));
  return { header, rows };
}

// ---------------- DuckDB-wasm ----------------
const DUCKDB_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';
let duck = null;

export async function loadDuckDb(onStatus = () => {}) {
  if (duck) return duck;
  onStatus('duckdb-wasm を取得中…');
  const duckdb = await import(/* @vite-ignore */ DUCKDB_ESM);
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const logger = new duckdb.VoidLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  onStatus('WASM を初期化中…');
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();
  duck = { db, conn };
  onStatus('準備完了');
  return duck;
}

/** 生テーブルを prices として登録 */
export async function duckRegister(header, rows) {
  const { db, conn } = await loadDuckDb();
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  await db.registerFileText('prices.csv', csv);
  await conn.query(`CREATE OR REPLACE TABLE prices AS SELECT * FROM read_csv_auto('prices.csv', header=true)`);
}

/** SQL 実行 → {header, rows} */
export async function duckQuery(sql) {
  const { conn } = await loadDuckDb();
  const table = await conn.query(sql);
  const header = table.schema.fields.map((f) => f.name);
  const conv = (v) => {
    if (v == null) return '';
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && typeof v.valueOf === 'function') {
      const n = v.valueOf();
      return typeof n === 'bigint' ? Number(n) : n;
    }
    return v;
  };
  const rows = table.toArray().map((r) => header.map((k) => conv(r[k])));
  return { header, rows };
}
