import {
  buildSeries, detectColumns, summarize, seriesCloses, toCandleSeries, formatTime,
  runSimulationAsync, RealtimeSession, PREDICTOR_INFO, DEFAULT_CONFIG, generateTicks, toCsv, pointPrice,
} from '../src/core/index.js';
import { drawChart } from './chart.js';
import { readFile, parseText, loadDuckDb, duckRegister, duckQuery } from './importers.js';
import { SOURCES } from '../src/tools/sources.js';
import { fetchSeries, makeHttpGet } from '../src/tools/fetchClient.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const pct = (v, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '–');
const DIR_JA = { up: '上昇', down: '下落', flat: '同じ' };
const COLOR = { up: '#22c55e', down: '#ef4444', flat: '#9ca3af', hit: '#22c55e', miss: '#ef4444', skip: '#6b7280' };

const state = {
  raw: null, // {header, rows, source}
  mapping: null,
  baseSeries: null, // 列割り当て直後
  series: null, // リサンプル後（シミュレーションに使う）
  result: null,
  simRunning: false,
  cancel: false,
  rt: null, // RealtimeSession
  rtIndex: 0,
  rtTimer: null,
  rtHistory: [],
};

// ---------------- タブ ----------------
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  showTab(b.dataset.tab);
});
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'data' && state.series) drawSeriesChart();
  if (name === 'simulation' && state.result) renderResult();
  if (name === 'realtime') { ensureRealtime(); drawRtChart(); }
}
function setStatus(text) { $('status').textContent = text; }
function toast(msg, isError = false) {
  setStatus(msg);
  if (isError) console.error(msg);
}

// ---------------- 設定 ----------------
function buildModelList() {
  const el = $('modelList');
  el.innerHTML = '';
  for (const p of PREDICTOR_INFO) {
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = `
      <input type="checkbox" id="use_${p.id}" checked>
      <div><label for="use_${p.id}" style="color:var(--text);font-size:13px">${p.name}</label><div class="desc">${p.description}</div></div>
      <input type="number" id="w_${p.id}" value="${p.defaultWeight}" min="0" step="0.1" title="重み">`;
    el.appendChild(row);
  }
}
buildModelList();

function readConfig() {
  const predictors = PREDICTOR_INFO.filter((p) => $(`use_${p.id}`).checked).map((p) => p.id);
  const weights = Object.fromEntries(PREDICTOR_INFO.map((p) => [p.id, Number($(`w_${p.id}`).value) || 0]));
  return {
    windowBars: Math.max(10, Number($('cfgWindow').value) || 60),
    horizonSeconds: Math.max(0.1, Number($('cfgHorizon').value) || 60),
    spreadMode: $('cfgSpreadMode').value,
    spreadValue: Number($('cfgSpreadValue').value) || 0,
    flatThreshold: Number($('cfgFlat').value) || 0,
    payout: (Number($('cfgPayout').value) || 85) / 100,
    minProb: (Number($('cfgMinProb').value) || 0) / 100,
    stride: Math.max(1, Number($('cfgStride').value) || 1),
    predictors,
    weights,
    predictorOptions: { onlineLogistic: { learningRate: Number($('cfgLr').value) || 0.02 } },
  };
}
function writeConfig(c) {
  $('cfgWindow').value = c.windowBars;
  $('cfgHorizon').value = c.horizonSeconds;
  $('cfgSpreadMode').value = c.spreadMode;
  $('cfgSpreadValue').value = c.spreadValue;
  $('cfgFlat').value = c.flatThreshold;
  $('cfgPayout').value = Math.round(c.payout * 100);
  $('cfgMinProb').value = Math.round(c.minProb * 100);
  $('cfgStride').value = c.stride || 1;
  $('cfgLr').value = c.predictorOptions?.onlineLogistic?.learningRate ?? 0.02;
  for (const p of PREDICTOR_INFO) {
    $(`use_${p.id}`).checked = c.predictors.includes(p.id);
    $(`w_${p.id}`).value = c.weights?.[p.id] ?? p.defaultWeight;
  }
}
$('saveCfgBtn').onclick = () => {
  localStorage.setItem('jev.config', JSON.stringify(readConfig()));
  toast('設定を保存しました');
};
$('resetCfgBtn').onclick = () => {
  writeConfig({ ...DEFAULT_CONFIG, stride: 1 });
  localStorage.removeItem('jev.config');
};
try {
  const saved = localStorage.getItem('jev.config');
  writeConfig(saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_CONFIG, stride: 1 });
} catch { writeConfig({ ...DEFAULT_CONFIG, stride: 1 }); }

// ---------------- データ読み込み ----------------
const dz = $('dropzone');
dz.addEventListener('click', () => $('fileInput').click());
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
$('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
$('pasteBtn').onclick = () => {
  try { setRaw(parseText($('pasteArea').value)); } catch (err) { toast('読み込み失敗: ' + err.message, true); }
};
$('genBtn').onclick = () => {
  const ticks = generateTicks({
    n: Number($('genN').value) || 8000,
    intervalMs: (Number($('genInterval').value) || 1) * 1000,
    start: Number($('genStart').value) || 150,
    vol: Number($('genVol').value) || 0.00005,
    spread: Number($('genSpread').value) || 0,
    trendStrength: Number($('genTrend').value) || 0,
    seed: Number($('genSeed').value) || 1,
  });
  setRaw({ header: ['timestamp', 'bid', 'ask'], rows: ticks.map((t) => [t.t, t.bid, t.ask]), source: '合成データ' });
};
$('loadSampleBtn').onclick = async () => {
  try {
    const res = await fetch('../samples/sample_ticks.csv');
    if (!res.ok) throw new Error(res.statusText);
    setRaw(parseText(await res.text(), 'samples/sample_ticks.csv'));
  } catch (err) {
    toast('サンプルを取得できません（npm run serve で起動してください）: ' + err.message, true);
  }
};

// ---------------- オンライン取得 ----------------
function buildSourceSelect() {
  const sel = $('dlSource');
  sel.innerHTML = Object.entries(SOURCES)
    .map(([id, s]) => `<option value="${id}"${s.browser ? '' : ' disabled'}>${s.label}${s.browser ? '' : '（CLI のみ）'}</option>`)
    .join('');
  sel.value = 'binance';
  onSourceChange();
}
function onSourceChange() {
  const s = SOURCES[$('dlSource').value];
  $('dlSymbol').value = s.symbolExample;
  $('dlNote').textContent = s.note;
  const kindSel = $('dlKind');
  kindSel.innerHTML = s.kinds.map((k) => `<option value="${k}">${k === 'tick' ? 'tick（約定）' : 'ローソク足'}</option>`).join('');
  onKindChange();
}
function onKindChange() {
  const s = SOURCES[$('dlSource').value];
  const isTick = $('dlKind').value === 'tick';
  const iv = $('dlInterval');
  iv.innerHTML = s.intervals.map((i) => `<option value="${i}">${/^\d+$/.test(i) ? i + ' 分' : i}</option>`).join('');
  iv.value = s.intervals.includes('1m') ? '1m' : s.intervals[0] || '';
  iv.disabled = isTick || !s.intervals.length;
}
$('dlSource').onchange = onSourceChange;
$('dlKind').onchange = onKindChange;
buildSourceSelect();

let dlCancel = false;
let lastDownload = null;
$('dlCancelBtn').onclick = () => { dlCancel = true; };
$('dlBtn').onclick = async () => {
  const source = $('dlSource').value;
  const tick = $('dlKind').value === 'tick';
  const hours = Number($('dlSpan').value) || 24;
  const endTime = Date.now();
  dlCancel = false;
  $('dlBtn').disabled = true;
  $('dlCancelBtn').hidden = false;
  $('dlInfo').textContent = '取得中…';
  try {
    const res = await fetchSeries({
      source,
      symbol: $('dlSymbol').value.trim(),
      tick,
      interval: $('dlInterval').value,
      startTime: endTime - hours * 3600000,
      endTime,
      maxRows: Number($('dlLimit').value) || 200000,
      base: $('dlBase').value.trim() || undefined,
      get: makeHttpGet({ onRetry: (m) => { $('dlInfo').textContent = m; } }),
      onProgress: (rows, lastTime) => {
        $('dlInfo').textContent = `${rows.toLocaleString()} 行 (${formatTime(lastTime)} まで)`;
      },
      cancelled: () => dlCancel,
    });
    if (!res.rows.length) throw new Error('0 行でした。銘柄名や期間を確認してください。');
    lastDownload = { ...res, source, symbol: $('dlSymbol').value.trim(), tick };
    $('dlSaveBtn').disabled = false;
    $('dlInfo').textContent = `${res.rows.length.toLocaleString()} 行を取得${dlCancel ? '（中止）' : ''}`;
    if (res.note) $('dlNote').textContent = res.note;
    setRaw({ header: res.header, rows: res.rows, source: `${SOURCES[source].label} ${$('dlSymbol').value.trim()}` });
    if (!SOURCES[source].hasSpread) $('dlNote').textContent = 'このデータには bid/ask が含まれません。設定タブで「固定スプレッド」に実際の値を入力してください。';
  } catch (err) {
    $('dlInfo').textContent = '失敗: ' + err.message;
  } finally {
    $('dlBtn').disabled = false;
    $('dlCancelBtn').hidden = true;
  }
};
$('dlSaveBtn').onclick = () => {
  if (!lastDownload) return;
  const d = lastDownload;
  download(`${d.source}_${d.symbol.replace(/[^\w.-]/g, '')}_${d.tick ? 'tick' : 'candle'}.csv`, toCsv(d.header, d.rows), 'text/csv');
};

async function loadFile(file) {
  setStatus(`読み込み中: ${file.name}`);
  try {
    setRaw(await readFile(file));
  } catch (err) {
    toast('読み込み失敗: ' + err.message, true);
  }
}

const ROLES = [
  ['time', '日時（1 列）'], ['date', '日付（分離時）'], ['timeOnly', '時刻（分離時）'],
  ['open', '始値'], ['high', '高値'], ['low', '安値'], ['close', '終値'],
  ['bid', 'Bid（売値）'], ['ask', 'Ask（買値）'], ['price', '価格（単一）'], ['volume', '出来高'],
];

function setRaw(raw) {
  state.raw = raw;
  state.mapping = detectColumns(raw.header);
  $('rawInfo').textContent = `${raw.source}: ${raw.rows.length.toLocaleString()} 行 × ${raw.header.length} 列`;
  const grid = $('mappingGrid');
  grid.innerHTML = '';
  for (const [role, label] of ROLES) {
    const sel = document.createElement('select');
    sel.dataset.role = role;
    sel.innerHTML = `<option value="">（なし）</option>` + raw.header.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('');
    sel.value = state.mapping[role] !== undefined ? String(state.mapping[role]) : '';
    const lab = document.createElement('label');
    lab.textContent = label;
    lab.appendChild(sel);
    grid.appendChild(lab);
  }
  renderTable($('previewTable'), raw.header, raw.rows.slice(0, 8));
  $('mappingCard').hidden = false;
  $('sqlRunBtn').disabled = $('sqlPreviewBtn').disabled = !window.__duckReady;
  applyMapping();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('applyMappingBtn').onclick = applyMapping;
function applyMapping() {
  const mapping = {};
  document.querySelectorAll('#mappingGrid select').forEach((s) => { if (s.value !== '') mapping[s.dataset.role] = Number(s.value); });
  try {
    const series = buildSeries(state.raw.header, state.raw.rows, mapping, { kind: $('kindSelect').value });
    state.mapping = mapping;
    state.baseSeries = series;
    if (series.warnings.length) toast(series.warnings.join(' / '));
    applyResample();
    $('seriesCard').hidden = false;
  } catch (err) {
    toast('系列を作れません: ' + err.message, true);
  }
}
$('resampleSelect').onchange = applyResample;
function applyResample() {
  if (!state.baseSeries) return;
  const iv = Number($('resampleSelect').value);
  state.series = iv > 0 ? toCandleSeries(state.baseSeries, iv) : state.baseSeries;
  state.result = null;
  state.rt = null;
  $('results').hidden = true;
  $('exportCsvBtn').disabled = $('exportJsonBtn').disabled = true;
  const s = summarize(state.series);
  $('seriesKpis').innerHTML = [
    kpi('種類', s.kind === 'candle' ? 'ローソク足' : 'tick'),
    kpi('点数', s.count.toLocaleString()),
    kpi('期間', `${formatTime(s.start)}<br>〜 ${formatTime(s.end)}`),
    kpi('中央間隔', humanMs(s.intervalMs)),
    kpi('価格範囲', `${fmt(s.min, 3)} – ${fmt(s.max, 3)}`),
    kpi('平均スプレッド', Number.isFinite(s.avgSpread) ? fmt(s.avgSpread, 5) : 'なし（固定値を設定）'),
  ].join('');
  setStatus(`${s.kind} ${s.count.toLocaleString()} 点 / 間隔 ${humanMs(s.intervalMs)}`);
  $('rtStart').max = Math.max(0, s.count - 1);
  drawSeriesChart();
}
function humanMs(ms) {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} 秒`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(ms % 60000 ? 1 : 0)} 分`;
  return `${(ms / 3600000).toFixed(1)} 時間`;
}
function kpi(label, value, sub = '', cls = '') {
  return `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
function drawSeriesChart() {
  if (!state.series) return;
  const closes = seriesCloses(state.series);
  const data = state.series.data;
  drawChart($('priceChart'), {
    lines: [{ values: closes }],
    xLabels: data.map((p) => formatTime(p.t).slice(5, 16)),
  });
}
function renderTable(table, header, rows, classes) {
  const th = `<tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r, ri) => `<tr${classes?.row ? ` class="${classes.row(r, ri)}"` : ''}>${r.map((c, ci) => `<td${classes?.cell ? ` class="${classes.cell(c, ci, r, ri)}"` : ''}>${escapeHtml(c ?? '')}</td>`).join('')}</tr>`).join('');
  table.innerHTML = th + body;
}

// ---------------- シミュレーション ----------------
$('runBtn').onclick = runSim;
$('cancelBtn').onclick = () => { state.cancel = true; };
async function runSim() {
  if (!state.series) { toast('先にデータを読み込んでください', true); showTab('data'); return; }
  if (state.simRunning) return;
  const cfg = readConfig();
  if (!cfg.predictors.length) { toast('モデルを 1 つ以上選んでください', true); return; }
  state.simRunning = true;
  state.cancel = false;
  $('runBtn').disabled = true;
  $('cancelBtn').hidden = false;
  $('progress').hidden = false;
  $('progress').value = 0;
  const t0 = performance.now();
  try {
    // 中止対応のため progress コールバックで例外を投げる
    const result = await runSimulationAsync(state.series, cfg, (p) => {
      if (state.cancel) throw new Error('cancelled');
      $('progress').value = p.progress;
      $('simInfo').textContent = `${Math.round(p.progress * 100)}% (${p.records.toLocaleString()} 件)`;
    });
    state.result = result;
    $('simInfo').textContent = `${result.metrics.total.toLocaleString()} 件を ${((performance.now() - t0) / 1000).toFixed(1)} 秒で評価`;
    $('exportCsvBtn').disabled = $('exportJsonBtn').disabled = false;
    renderResult();
  } catch (err) {
    if (err.message === 'cancelled') $('simInfo').textContent = '中止しました';
    else toast('シミュレーション失敗: ' + err.message, true);
  } finally {
    state.simRunning = false;
    $('runBtn').disabled = false;
    $('cancelBtn').hidden = true;
    $('progress').hidden = true;
  }
}

function renderResult() {
  const r = state.result;
  if (!r) return;
  const m = r.metrics;
  $('results').hidden = false;
  const be = m.breakEvenWinRate;
  $('simKpis').innerHTML = [
    kpi('予測数', m.total.toLocaleString(), `上 ${m.outcomeCounts.up} / 下 ${m.outcomeCounts.down} / 同 ${m.outcomeCounts.flat}`),
    kpi('3 クラス正解率', pct(m.accuracy), `多数派ベースライン ${pct(m.baselineAccuracy)}`, m.accuracy > m.baselineAccuracy ? 'good' : 'bad'),
    kpi('エントリー回数', m.traded.toLocaleString(), `予測の ${pct(m.tradeRate)}`),
    kpi('勝率（エントリー時）', pct(m.winRate), `損益分岐 ${pct(be)} / 同値 ${m.flatsOnTrade}`, m.winRate > be ? 'good' : 'bad'),
    kpi('累積損益', fmt(m.pnl, 2), `1 取引あたり ${fmt(m.pnlPerTrade, 4)}`, m.pnl > 0 ? 'good' : 'bad'),
    kpi('最大ドローダウン', fmt(m.maxDrawdown, 2)),
    kpi('予想価格 MAE', fmt(m.mae, 5), `現在値据え置き ${fmt(m.maeNaive, 5)}`, m.mae < m.maeNaive ? 'good' : ''),
    kpi('上昇 / 下落 勝率', `${pct(m.byDir.up.n ? m.byDir.up.win / m.byDir.up.n : NaN)} / ${pct(m.byDir.down.n ? m.byDir.down.win / m.byDir.down.n : NaN)}`, `${m.byDir.up.n} / ${m.byDir.down.n} 回`),
  ].join('');
  drawChart($('equityChart'), { lines: [{ values: r.equity, fill: true, zeroLine: true, color: r.metrics.pnl >= 0 ? COLOR.up : COLOR.down }], digits: 1 });
  // 混同行列
  const dirs = ['up', 'down', 'flat'];
  $('confusionTable').innerHTML =
    `<tr><th>予測＼結果</th>${dirs.map((d) => `<th class="text-${d}">${DIR_JA[d]}</th>`).join('')}<th>計</th></tr>` +
    dirs.map((a) => {
      const row = m.confusion[a];
      const tot = dirs.reduce((s, b) => s + row[b], 0);
      return `<tr><td class="${a}">${DIR_JA[a]}</td>${dirs.map((b) => `<td${a === b ? ' class="hit"' : ''}>${row[b]}</td>`).join('')}<td>${tot}</td></tr>`;
    }).join('');
  // 較正
  $('calibrationTable').innerHTML =
    '<tr><th>確信度</th><th>件数</th><th>平均確率</th><th>的中率</th></tr>' +
    m.calibration.filter((c) => c.n).map((c) => `<tr><td>${(c.bin * 100).toFixed(0)}–${(c.bin * 100 + 10).toFixed(0)}%</td><td>${c.n}</td><td>${pct(c.avgProb)}</td><td class="${c.hitRate >= c.avgProb ? 'up' : 'down'}">${pct(c.hitRate)}</td></tr>`).join('');
  // モデル別
  $('partsTable').innerHTML =
    '<tr><th>モデル</th><th>判定数</th><th>方向的中率</th></tr>' +
    Object.entries(m.partStats).map(([id, s]) => {
      const info = PREDICTOR_INFO.find((p) => p.id === id);
      return `<tr><td>${info ? info.name : id}</td><td>${s.n}</td><td class="${s.directionalAccuracy > 0.5 ? 'up' : 'down'}">${pct(s.directionalAccuracy)}</td></tr>`;
    }).join('') +
    (r.learners.length ? `<tr><td colspan="3" class="hint">オンライン学習サンプル数: ${r.learners.map((l) => l.samples).join(', ')}</td></tr>` : '');
  // 記録
  const recs = r.records.slice(-300).reverse();
  renderTable(
    $('recordsTable'),
    ['時刻', '仲値', 'スプレッド', '予測', '確率', '予想価格', 'EV', 'エントリー', '結果', 't秒後価格', '損益'],
    recs.map((x) => [formatTime(x.t), fmt(x.mid, 5), fmt(x.spread, 5), DIR_JA[x.direction], pct(x.confidence), fmt(x.expectedPrice, 5), fmt(x.ev, 3), x.trade ? '●' : '', DIR_JA[x.outcome], fmt(x.exitMid, 5), x.trade ? fmt(x.pnl, 2) : '']),
    {
      row: (row, i) => (recs[i].trade ? 'trade' : ''),
      cell: (c, ci, row, ri) => {
        const rec = recs[ri];
        if (ci === 3) return rec.direction;
        if (ci === 8) return rec.hit ? 'hit' : rec.direction !== 'flat' ? 'miss' : 'flat';
        return '';
      },
    }
  );
  $('simRange').max = Math.max(0, r.records.length - 1);
  drawSimPriceChart();
}
$('simRange').oninput = drawSimPriceChart;
$('simSpan').onchange = drawSimPriceChart;
function drawSimPriceChart() {
  const r = state.result;
  if (!r || !r.records.length) return;
  const span = Math.max(20, Number($('simSpan').value) || 600);
  const start = Math.min(Number($('simRange').value) || 0, Math.max(0, r.records.length - span));
  const recs = r.records.slice(start, start + span);
  const markers = [];
  recs.forEach((x, i) => {
    if (x.direction === 'flat') return;
    markers.push({ x: i, y: x.mid, color: x.trade ? (x.hit ? COLOR.hit : COLOR.miss) : COLOR.skip, shape: x.direction, size: x.trade ? 4 : 2.5 });
  });
  drawChart($('simPriceChart'), {
    lines: [{ values: recs.map((x) => x.mid) }, { values: recs.map((x) => x.expectedPrice), color: '#f59e0b', width: 1 }],
    markers,
    xLabels: recs.map((x) => formatTime(x.t).slice(5, 16)),
  });
}

$('exportCsvBtn').onclick = () => {
  const r = state.result;
  const header = ['time', 'exit_time', 'mid', 'spread', 'band', 'direction', 'p_up', 'p_down', 'p_flat', 'confidence', 'expected_price', 'ev', 'trade', 'outcome', 'exit_mid', 'hit', 'pnl'];
  const rows = r.records.map((x) => [new Date(x.t).toISOString(), new Date(x.exitT).toISOString(), x.mid, x.spread, x.band, x.direction, x.pUp, x.pDown, x.pFlat, x.confidence, x.expectedPrice, x.ev, x.trade ? 1 : 0, x.outcome, x.exitMid, x.hit ? 1 : 0, x.pnl]);
  download('jev-simulation.csv', toCsv(header, rows), 'text/csv');
};
$('exportJsonBtn').onclick = () => {
  const r = state.result;
  download('jev-simulation.json', JSON.stringify({ config: r.config, metrics: r.metrics, learners: r.learners, records: r.records }, null, 1), 'application/json');
};
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- リアルタイム再生 ----------------
function ensureRealtime() {
  if (state.rt || !state.series) return;
  resetRealtime();
}
function resetRealtime() {
  stopRt();
  if (!state.series) return;
  const cfg = readConfig();
  state.rt = new RealtimeSession(cfg, state.series.kind);
  state.rtIndex = Math.min(Number($('rtStart').value) || 0, state.series.data.length - 1);
  state.rtHistory = [];
  state.rt.on('resolved', (rec) => { state.rtHistory.unshift(rec); if (state.rtHistory.length > 50) state.rtHistory.pop(); });
  // 開始位置までは学習なしで投入
  state.rt.prime(state.series.data.slice(Math.max(0, state.rtIndex - cfg.windowBars), state.rtIndex));
  renderLive(null);
  renderRtStats();
  drawRtChart();
  $('rtInfo').textContent = `位置 ${state.rtIndex} / ${state.series.data.length}`;
}
$('rtResetBtn').onclick = resetRealtime;
$('rtStepBtn').onclick = () => { ensureRealtime(); rtStep(); };
$('rtPlayBtn').onclick = () => {
  ensureRealtime();
  if (state.rtTimer) stopRt();
  else startRt();
};
function startRt() {
  if (!state.rt) return;
  const speed = Math.max(1, Number($('rtSpeed').value) || 20);
  const batch = Math.max(1, Math.round(speed / 20));
  state.rtTimer = setInterval(() => {
    for (let i = 0; i < batch; i++) if (!rtStep()) { stopRt(); break; }
  }, 1000 / Math.min(speed, 20));
  $('rtPlayBtn').textContent = '❚❚ 停止';
}
function stopRt() {
  if (state.rtTimer) clearInterval(state.rtTimer);
  state.rtTimer = null;
  $('rtPlayBtn').textContent = '▶ 再生';
}
function rtStep() {
  const data = state.series.data;
  if (state.rtIndex >= data.length) return false;
  const pred = state.rt.push(data[state.rtIndex++]);
  renderLive(pred);
  renderRtStats();
  if (state.rtIndex % 2 === 0 || state.rtIndex >= data.length) drawRtChart();
  $('rtInfo').textContent = `位置 ${state.rtIndex} / ${data.length}`;
  return true;
}
function renderLive(p) {
  const dirEl = $('liveDir');
  if (!p) {
    dirEl.textContent = '—';
    dirEl.className = 'live-dir';
    $('livePrice').textContent = 'データを流すと予測が表示されます';
    $('liveKpis').innerHTML = '';
    for (const k of ['Up', 'Down', 'Flat']) { $(`bar${k}`).style.width = '0'; $(`p${k}`).textContent = '–'; }
    return;
  }
  dirEl.textContent = DIR_JA[p.direction];
  dirEl.className = `live-dir ${p.direction}`;
  $('livePrice').innerHTML = `${formatTime(p.t)} 仲値 <b>${fmt(p.mid, 5)}</b> スプレッド ${fmt(p.spread, 5)} → ${state.rt.predictor.config.horizonSeconds} 秒後 予想 <b>${fmt(p.expectedPrice, 5)}</b> (${p.expectedMove >= 0 ? '+' : ''}${fmt(p.expectedMove, 5)}) &nbsp; <span class="badge ${p.trade ? 'trade' : ''}">${p.trade ? 'エントリー推奨' : '見送り'}</span>`;
  $('barUp').style.width = pct(p.pUp, 0);
  $('barDown').style.width = pct(p.pDown, 0);
  $('barFlat').style.width = pct(p.pFlat, 0);
  $('pUp').textContent = pct(p.pUp);
  $('pDown').textContent = pct(p.pDown);
  $('pFlat').textContent = pct(p.pFlat);
  $('liveKpis').innerHTML = [
    kpi('EV（掛け金 1）', fmt(p.ev, 3), '', p.ev > 0 ? 'good' : 'bad'),
    kpi('μ (期待対数リターン)', p.mu.toExponential(2)),
    kpi('σ', p.sigma.toExponential(2)),
    kpi('判定帯', fmt(p.band, 5)),
    ...p.parts.map((x) => kpi(PREDICTOR_INFO.find((q) => q.id === x.id)?.name || x.id, x.mu > 0 ? '↑' : x.mu < 0 ? '↓' : '→', x.mu.toExponential(1))),
  ].join('');
}
function renderRtStats() {
  const s = state.rt?.stats;
  if (!s) return;
  $('rtStats').innerHTML = [
    kpi('解決済み', s.total),
    kpi('正解率', pct(s.total ? s.correct / s.total : NaN)),
    kpi('エントリー', s.traded),
    kpi('勝率', pct(s.traded ? s.wins / s.traded : NaN)),
    kpi('損益', fmt(s.pnl, 2), '', s.pnl > 0 ? 'good' : s.pnl < 0 ? 'bad' : ''),
  ].join('');
  const recs = state.rtHistory;
  renderTable($('rtLog'), ['時刻', '予測', '確率', '仲値', 't秒後', '結果', 'エントリー', '損益'],
    recs.map((r) => [formatTime(r.prediction.t), DIR_JA[r.prediction.direction], pct(r.prediction.confidence), fmt(r.prediction.mid, 5), fmt(r.exitMid, 5), DIR_JA[r.outcome], r.prediction.trade ? '●' : '', r.prediction.trade ? fmt(r.pnl, 2) : '']),
    { cell: (c, ci, row, ri) => (ci === 5 ? (recs[ri].hit ? 'hit' : 'miss') : ci === 1 ? recs[ri].prediction.direction : '') });
}
function drawRtChart() {
  if (!state.series) return;
  const data = state.series.data;
  const end = state.rtIndex;
  const start = Math.max(0, end - 200);
  const slice = data.slice(start, end);
  const markers = [];
  for (const rec of state.rtHistory) {
    const idx = slice.findIndex((p) => p.t === rec.prediction.t);
    if (idx >= 0 && rec.prediction.direction !== 'flat') markers.push({ x: idx, y: rec.prediction.mid, color: rec.hit ? COLOR.hit : COLOR.miss, shape: rec.prediction.direction, size: rec.prediction.trade ? 4 : 2.5 });
  }
  const last = state.rt?.last;
  if (last && slice.length) markers.push({ x: slice.length - 1, y: last.expectedPrice, color: '#f59e0b', size: 4 });
  drawChart($('rtChart'), {
    lines: [{ values: slice.map((p) => pointPrice(state.series.kind, p)) }],
    markers,
    xLabels: slice.map((p) => formatTime(p.t).slice(11, 19)),
  });
}

// ---------------- DuckDB ----------------
$('duckLoadBtn').onclick = async () => {
  $('duckLoadBtn').disabled = true;
  try {
    await loadDuckDb((s) => { $('duckStatus').textContent = s; });
    window.__duckReady = true;
    if (state.raw) {
      $('duckStatus').textContent = 'prices テーブルを登録中…';
      await duckRegister(state.raw.header, state.raw.rows);
      $('duckStatus').textContent = `準備完了: prices (${state.raw.rows.length.toLocaleString()} 行)`;
      $('sqlRunBtn').disabled = $('sqlPreviewBtn').disabled = false;
    } else {
      $('duckStatus').textContent = '準備完了（先にデータを読み込むと prices テーブルに登録されます）';
    }
  } catch (err) {
    $('duckStatus').textContent = '読み込み失敗: ' + err.message;
    $('duckLoadBtn').disabled = false;
  }
};
async function runSql(apply) {
  if (!state.raw) { toast('先にデータを読み込んでください', true); return; }
  $('sqlInfo').textContent = '実行中…';
  try {
    await duckRegister(state.raw.header, state.raw.rows);
    const res = await duckQuery($('sqlArea').value);
    $('sqlInfo').textContent = `${res.rows.length.toLocaleString()} 行`;
    renderTable($('sqlTable'), res.header, res.rows.slice(0, 50));
    if (apply) {
      setRaw({ ...res, source: 'DuckDB クエリ結果' });
      showTab('data');
    }
  } catch (err) {
    $('sqlInfo').textContent = 'エラー: ' + err.message;
  }
}
$('sqlRunBtn').onclick = () => runSql(true);
$('sqlPreviewBtn').onclick = () => runSql(false);

window.addEventListener('resize', () => {
  if (state.series) drawSeriesChart();
  if (state.result) { drawSimPriceChart(); drawChart($('equityChart'), { lines: [{ values: state.result.equity, fill: true, zeroLine: true }], digits: 1 }); }
  drawRtChart();
});
window.jev = state; // デバッグ用
