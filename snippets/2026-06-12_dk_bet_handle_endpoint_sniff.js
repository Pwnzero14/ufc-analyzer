// READ-ONLY network sniffer — run in the DK event tab, then RELOAD the page.
// Logs the URL + body of any API response that looks like betting splits / % of bets
// placed, so we can find the endpoint behind the "% of bets placed" widget. Writes nothing.
(() => {
  const RX = /(percent|handle|placed|consensus|popular|split|sentiment|insight|public|ticket)/i;
  const looksLikeSplit = (txt) => RX.test(txt) && /\d/.test(txt) && txt.length < 200000;
  const report = (url, txt) => {
    console.log('%c[HANDLE?] ' + url, 'color:#ffae42;font-weight:bold');
    console.log(txt.slice(0, 2000));
  };
  // fetch
  const _f = window.fetch;
  window.fetch = async (...a) => {
    const r = await _f(...a);
    try { const u = (a[0] && a[0].url) || a[0]; const t = await r.clone().text(); if (looksLikeSplit(t)) report(u, t); } catch {}
    return r;
  };
  // XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__u = u; return _open.call(this, m, u, ...rest); };
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', function () {
      try { const t = String(this.responseText || ''); if (looksLikeSplit(t)) report(this.__u, t); } catch {}
    });
    return _send.apply(this, a);
  };
  console.log('%cfetch + XHR hooked — now RELOAD the page and scroll to the "% of bets placed" bar. Watch for [HANDLE?] lines.', 'color:#42dca3;font-weight:bold');
})();
