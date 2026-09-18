/* global Jev */
const $ = (id) => document.getElementById(id);
let session = null;
const DIR_JA = { up: '上昇', down: '下落', flat: '同じ' };

function loadSettings() {
  chrome.storage.local.get(['jevSelectors', 'jevConfig'], (r) => {
    const s = r.jevSelectors || {};
    $('selBid').value = s.bid || '';
    $('selAsk').value = s.ask || '';
    $('selPrice').value = s.price || '';
    $('selInterval').value = s.intervalMs || 250;
    const c = r.jevConfig || {};
    $('cfgWindow').value = c.windowBars || 60;
    $('cfgHorizon').value = c.horizonSeconds || 60;
    $('cfgSpread').value = c.spreadValue || 0;
    $('cfgPayout').value = Math.round((c.payout || 0.85) * 100);
    $('cfgMinProb').value = Math.round((c.minProb || 0.55) * 100);
    createSession(c);
  });
}

function createSession(c) {
  session = new Jev.RealtimeSession({
    windowBars: Number(c.windowBars) || 60,
    horizonSeconds: Number(c.horizonSeconds) || 60,
    spreadMode: 'auto',
    spreadValue: Number(c.spreadValue) || 0,
    payout: Number(c.payout) || 0.85,
    minProb: Number(c.minProb) || 0.55,
  }, 'tick');
  session.on('resolved', renderStats);
}

$('save').onclick = () => {
  const jevSelectors = {
    bid: $('selBid').value.trim() || undefined,
    ask: $('selAsk').value.trim() || undefined,
    price: $('selPrice').value.trim() || undefined,
    intervalMs: Number($('selInterval').value) || 250,
  };
  const jevConfig = {
    windowBars: Number($('cfgWindow').value),
    horizonSeconds: Number($('cfgHorizon').value),
    spreadValue: Number($('cfgSpread').value),
    payout: Number($('cfgPayout').value) / 100,
    minProb: Number($('cfgMinProb').value) / 100,
  };
  chrome.storage.local.set({ jevSelectors, jevConfig }, () => {
    createSession(jevConfig);
    $('info').textContent = '設定を保存しました。tick 待ち…';
  });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'jev:tick' || !session) return;
  const tick = { t: msg.t, mid: msg.mid };
  if (Number.isFinite(msg.bid) && Number.isFinite(msg.ask)) {
    tick.bid = msg.bid;
    tick.ask = msg.ask;
    tick.spread = msg.ask - msg.bid;
  }
  const p = session.push(tick);
  $('mid').textContent = msg.mid.toFixed(5);
  if (!p) {
    $('info').textContent = `ウォームアップ中 ${session.predictor.buffer.length} / ${session.predictor.config.windowBars}`;
    return;
  }
  $('dir').textContent = DIR_JA[p.direction];
  $('dir').className = `dir ${p.direction}`;
  $('exp').textContent = `${p.expectedPrice.toFixed(5)} (${p.expectedMove >= 0 ? '+' : ''}${p.expectedMove.toFixed(5)})`;
  $('probs').textContent = `${(p.pUp * 100).toFixed(1)}% / ${(p.pFlat * 100).toFixed(1)}% / ${(p.pDown * 100).toFixed(1)}%`;
  $('ev').textContent = p.ev.toFixed(3);
  $('trade').textContent = p.trade ? `エントリー推奨 (${DIR_JA[p.direction]})` : '見送り';
  $('info').textContent = `${new Date(p.t).toLocaleTimeString()} spread ${p.spread.toFixed(5)}`;
});

function renderStats() {
  const s = session.stats;
  $('stats').textContent = `${s.total} 件 / 正解 ${s.total ? ((s.correct / s.total) * 100).toFixed(1) : '–'}% / 勝率 ${s.traded ? ((s.wins / s.traded) * 100).toFixed(1) : '–'}% / 損益 ${s.pnl.toFixed(2)}`;
}

loadSettings();
