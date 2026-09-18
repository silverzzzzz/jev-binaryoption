/**
 * 様々な時刻表現をエポックミリ秒に変換する。
 * 対応: ISO 8601, "YYYY.MM.DD HH:MM[:SS]" (MT4/MT5), "YYYY/MM/DD HH:MM:SS",
 *       エポック秒 / ミリ秒 / マイクロ秒, Excel シリアル値, Date オブジェクト。
 * @param {unknown} value
 * @returns {number} ミリ秒。解釈できない場合は NaN。
 */
export function parseTime(value) {
  if (value == null || value === '') return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return numberToMs(value);
  const s = String(value).trim();
  if (s === '') return NaN;
  if (/^-?\d+(\.\d+)?$/.test(s)) return numberToMs(Number(s));

  // "2024.01.05 09:30:00" / "2024/01/05 09:30" / "2024-01-05 09:30:00.123"
  const m = s.match(
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0', frac = '', tz] = m;
    const ms = frac ? Math.round(Number('0.' + frac) * 1000) : 0;
    if (tz) {
      const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, ms);
      if (tz === 'Z') return base;
      const sign = tz[0] === '-' ? -1 : 1;
      const [th, tm] = tz.slice(1).replace(':', '').match(/\d{2}/g).map(Number);
      return base - sign * (th * 60 + tm) * 60000;
    }
    return new Date(+y, +mo - 1, +d, +h, +mi, +se, ms).getTime();
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function numberToMs(n) {
  if (!Number.isFinite(n)) return NaN;
  const abs = Math.abs(n);
  if (abs < 1e6) return Math.round((n - 25569) * 86400000); // Excel serial date
  if (abs < 1e11) return Math.round(n * 1000); // epoch seconds
  if (abs < 1e14) return Math.round(n); // epoch ms
  if (abs < 1e17) return Math.round(n / 1000); // epoch µs
  return Math.round(n / 1e6); // epoch ns
}

/** @param {number} ms */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 中央値 */
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
