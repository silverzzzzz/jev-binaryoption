/**
 * 依存なしの区切りテキストパーサ。カンマ / セミコロン / タブを自動判定し、
 * ダブルクォート内の区切り文字・改行・"" エスケープに対応する。
 * @param {string} text
 * @param {{delimiter?: string, maxRows?: number}} [opts]
 * @returns {{header: string[], rows: string[][], delimiter: string}}
 */
export function parseDelimited(text, opts = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const delimiter = opts.delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (opts.maxRows && rows.length >= opts.maxRows + 1) break;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  if (!rows.length) return { header: [], rows: [], delimiter };
  let header = rows[0].map((h) => h.trim());
  let body = rows.slice(1);
  // ヘッダーが数値だけなら「ヘッダーなし」と判断して col0.. を付与
  if (header.every((h) => h === '' || /^-?\d+(\.\d+)?$/.test(h))) {
    body = rows;
    header = rows[0].map((_, i) => `col${i}`);
  }
  return { header, rows: body, delimiter };
}

export function detectDelimiter(text) {
  const sample = text.slice(0, 5000).split(/\r?\n/).slice(0, 10);
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.filter((l) => l.length).map((l) => l.split(d).length - 1);
    if (!counts.length) continue;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const score = min > 0 && min === max ? min * 10 : min;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * 行の配列を CSV テキストへ。
 * @param {string[]} header
 * @param {Array<Array<unknown>>} rows
 */
export function toCsv(header, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
