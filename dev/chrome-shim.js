// ── PREVIEW-ONLY chrome.* API shim ──────────────────────────────────────────
// Injected by dev/preview-server.js when analyzer.html is served over http for
// local UI inspection. NEVER loaded by the real extension (analyzer.html does
// not reference this file). Storage is an in-memory copy seeded from the newest
// ufc-storage-backup-*.json in ~/Downloads (served at /dev/storage-backup.json)
// — reads see real data, writes stay in this tab and vanish on reload. All
// runtime/tabs/alarms calls are inert no-ops: nothing can reach the real
// extension, real storage, or open real tabs from the preview.
(() => {
  if (window.chrome && window.chrome.storage && window.chrome.storage.local && window.chrome.storage.local.__ufcShim) return;

  const store = Object.create(null);
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  // The pane opens the tab while the server is still booting — a one-shot
  // fetch can race a dead port and silently leave storage empty. Retry.
  const loadBackup = (attempt) =>
    fetch('/dev/storage-backup.json')
      .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .catch((e) => {
        if (attempt < 5) return new Promise((res) => setTimeout(res, 1500)).then(() => loadBackup(attempt + 1));
        throw e;
      });
  loadBackup(1)
    .then((payload) => {
      const data = payload && payload.storage && typeof payload.storage === 'object'
        ? payload.storage
        : (payload && typeof payload === 'object' ? payload : {});
      let freshened = 0;
      for (const [k, v] of Object.entries(data)) {
        // Backups are usually older than the 24h fighter-cache TTL; without this
        // the page discards every cached UFCStats entry and stampedes live
        // fetches that CORS blocks. Freshen fetchedAt so cache hits succeed.
        if (/^ufcstats_v\d+_/.test(k) && v && typeof v === 'object' && typeof v.fetchedAt === 'number') {
          v.fetchedAt = Date.now();
          freshened++;
        }
        store[k] = v;
      }
      console.info(`[chrome-shim] loaded ${Object.keys(store).length} storage keys` +
        (freshened ? ` (freshened ${freshened} ufcstats cache timestamps)` : '') +
        (payload && payload.exportedAt ? ` from backup exported ${payload.exportedAt}` : ''));
    })
    .catch((e) => console.warn('[chrome-shim] no backup loaded:', e && e.message))
    .finally(() => readyResolve());

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  const pickKeys = (keys) => {
    const out = {};
    if (keys == null) {
      for (const k of Object.keys(store)) out[k] = clone(store[k]);
    } else if (typeof keys === 'string') {
      if (keys in store) out[keys] = clone(store[keys]);
    } else if (Array.isArray(keys)) {
      for (const k of keys) if (k in store) out[k] = clone(store[k]);
    } else if (typeof keys === 'object') {
      for (const [k, def] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : def;
    }
    return out;
  };

  const local = {
    __ufcShim: true,
    get(keys, cb) {
      if (typeof keys === 'function') { cb = keys; keys = null; }
      const run = async () => { await ready; return pickKeys(keys); };
      if (typeof cb === 'function') { run().then((v) => cb(v)); return undefined; }
      return run();
    },
    set(items, cb) {
      const run = async () => { await ready; for (const [k, v] of Object.entries(items || {})) store[k] = clone(v); };
      if (typeof cb === 'function') { run().then(() => cb()); return undefined; }
      return run();
    },
    remove(keys, cb) {
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
      const run = async () => { await ready; for (const k of list) delete store[k]; };
      if (typeof cb === 'function') { run().then(() => cb()); return undefined; }
      return run();
    },
    clear(cb) {
      const run = async () => { await ready; for (const k of Object.keys(store)) delete store[k]; };
      if (typeof cb === 'function') { run().then(() => cb()); return undefined; }
      return run();
    },
    getBytesInUse(_keys, cb) {
      const run = async () => { await ready; return JSON.stringify(store).length; };
      if (typeof cb === 'function') { run().then((v) => cb(v)); return undefined; }
      return run();
    },
  };

  const noopEvent = { addListener() {}, removeListener() {}, hasListener() { return false; } };

  window.chrome = {
    storage: { local, onChanged: noopEvent },
    runtime: {
      id: 'ufc-preview-shim',
      lastError: undefined,
      getURL: (p) => '/' + String(p || '').replace(/^\//, ''),
      sendMessage(_msg, cb) {
        if (typeof cb === 'function') { setTimeout(() => cb(undefined), 0); return undefined; }
        return Promise.resolve(undefined);
      },
      onMessage: noopEvent,
    },
    tabs: {
      create(_opts, cb) { console.info('[chrome-shim] tabs.create suppressed in preview'); if (cb) cb({ id: -1 }); },
      query(_q, cb) { if (typeof cb === 'function') { cb([]); return undefined; } return Promise.resolve([]); },
      sendMessage(_id, _msg, cb) { if (typeof cb === 'function') cb(undefined); },
      update(_id, _opts, cb) { if (cb) cb(); },
      remove(_id, cb) { if (cb) cb(); },
    },
    alarms: { create() {}, clear(_n, cb) { if (cb) cb(false); }, clearAll(cb) { if (cb) cb(true); }, onAlarm: noopEvent },
  };

  // NOTE: an earlier "stability" hack here no-op'd long setIntervals and
  // insta-rejected external fetches — it broke line-data attachment (the app
  // polls storage readiness on an interval). Do NOT reintroduce it; the
  // page-side auto-view clicker below already tolerates main-thread churn.
  const _setInterval = window.setInterval.bind(window);
  const _fetch = window.fetch.bind(window);

  // Out-of-band view control (see preview-server.js): read the requested view
  // + scroll once, then keep trying from inside the page until the tab exists
  // and the click lands. Page-side queued tasks always run eventually, even
  // when the main thread is too churned for external automation to land.
  _fetch('/dev/preview-view')
    .then((r) => (r.ok ? r.text() : ''))
    .then((raw) => {
      const [view, scrollRaw] = String(raw || '').trim().split('|');
      if (!view) return;
      const scrollY = Number(scrollRaw);
      let tries = 0;
      const timer = _setInterval(() => {
        tries++;
        const btn = document.querySelector(`.tab-btn[data-view="${view}"]`);
        if (btn) {
          btn.click();
          if (Number.isFinite(scrollY) && scrollY > 0) {
            setTimeout(() => window.scrollTo(0, scrollY), 1200);
          }
          console.info(`[chrome-shim] auto-view: ${view}${Number.isFinite(scrollY) ? ' @' + scrollY : ''} (try ${tries})`);
          clearInterval(timer);
        } else if (tries > 60) {
          clearInterval(timer);
        }
      }, 2500);
    })
    .catch(() => {});

  console.info('[chrome-shim] preview chrome API shim active');
})();
