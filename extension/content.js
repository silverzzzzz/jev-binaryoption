/**
 * コンテンツスクリプト: 設定された CSS セレクタの要素から価格を読み取り、
 * 変化があるたびに { type: 'jev:tick', t, bid, ask } をサイドパネルへ送る。
 * セレクタは chrome.storage.local の jevSelectors に保存される:
 *   { bid: '.price-bid', ask: '.price-ask' } または { price: '.rate' }
 */
(() => {
  let selectors = null;
  let last = null;
  let timer = null;

  const parsePrice = (el) => {
    if (!el) return NaN;
    const txt = (el.value ?? el.textContent ?? '').replace(/[^\d.\-]/g, '');
    return txt ? Number(txt) : NaN;
  };

  function poll() {
    if (!selectors) return;
    let bid, ask, mid;
    if (selectors.bid && selectors.ask) {
      bid = parsePrice(document.querySelector(selectors.bid));
      ask = parsePrice(document.querySelector(selectors.ask));
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
      mid = (bid + ask) / 2;
    } else if (selectors.price) {
      mid = parsePrice(document.querySelector(selectors.price));
      if (!Number.isFinite(mid)) return;
    } else return;
    const key = `${bid}|${ask}|${mid}`;
    if (key === last) return;
    last = key;
    chrome.runtime.sendMessage({ type: 'jev:tick', t: Date.now(), bid, ask, mid, url: location.href }).catch(() => {});
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(poll, selectors?.intervalMs || 250);
  }

  chrome.storage.local.get('jevSelectors', (r) => {
    selectors = r.jevSelectors || null;
    if (selectors) start();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.jevSelectors) {
      selectors = changes.jevSelectors.newValue || null;
      last = null;
      if (selectors) start();
      else if (timer) clearInterval(timer);
    }
  });
})();
