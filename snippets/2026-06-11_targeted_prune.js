// ============================================================
// TARGETED STORAGE PRUNE — export-first, two-step
// Run in the extension console (analyzer page) when chrome.storage.local
// hits the ~10 MB quota (symptom: "Resource::kQuotaBytes quota exceeded",
// archive/backfill writes failing, Pick6 FP tab not persisting).
//
// What it deletes (ONLY these):
//   • prop_archive_alias_backfill_backup_* — redundant one-time backfill backup
//   • debug_fight_html_*                    — legacy, fixed at source
//   • ufcstats_v<NN>_*  where NN < 49        — stale pre-v49 fighter cache
// NEVER touches: prop_archive_v1, lines_*, betr*, line_history*, *snapshot*,
//                prop_predict*, fight_odds*, ufcstats_v49_*.
//
// Step 1: paste this — auto-downloads a JSON safety copy + prints the plan.
// Step 2: review the green "=== PRUNE PLAN ===" line, then run confirmPrune().
//
// NOTE: the bundled NN<49 cutoff matches the ufcstats cache version that was
// current on 2026-06-11. If the cache version has since advanced, bump the
// `< 49` below to (currentVersion) so you don't wipe the live cache.
// ============================================================
(async () => {
  const CURRENT_UFCSTATS_VERSION = 49; // bump to match the live ufcstats_vNN_ prefix
  const all = await new Promise(res => chrome.storage.local.get(null, res));
  const enc = new TextEncoder();
  const mb = k => { try { return enc.encode(JSON.stringify(all[k])).length / 1048576; } catch { return 0; } };

  const PROTECTED = k =>
    k === 'prop_archive_v1' || /^lines_/.test(k) || /betr/i.test(k) ||
    /^line_history/.test(k) || /snapshot/i.test(k) || /^prop_predict/.test(k) ||
    /^fight_odds/.test(k) || new RegExp(`^ufcstats_v${CURRENT_UFCSTATS_VERSION}_`).test(k);

  const doomed = Object.keys(all).filter(k => {
    if (PROTECTED(k)) return false;
    if (/^prop_archive_alias_backfill_backup_/.test(k)) return true;
    if (/^debug_fight_html_/.test(k)) return true;
    const m = k.match(/^ufcstats_v(\d+)_/);
    return !!(m && Number(m[1]) < CURRENT_UFCSTATS_VERSION);
  });
  const total = doomed.reduce((s, k) => s + mb(k), 0);

  // auto safety-export (analyzer-page console only — needs DOM)
  const payload = { exportedAt: new Date().toISOString(), keys: Object.fromEntries(doomed.map(k => [k, all[k]])) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  a.download = `pruned_storage_${Date.now()}.json`;
  a.click();

  console.log(`%c=== PRUNE PLAN === ${doomed.length} keys, ~${total.toFixed(2)} MB | JSON backup downloaded. Run confirmPrune() to delete.`, 'color:#0f0;font-weight:bold');
  console.log('=== PRUNE KEYS ===', doomed);

  globalThis.confirmPrune = () => new Promise(res =>
    chrome.storage.local.remove(doomed, () =>
      chrome.storage.local.getBytesInUse(null, b => {
        console.log(`%c=== PRUNED ${doomed.length} keys. Storage now ${(b / 1048576).toFixed(2)} MB of ~10 MB ===`, 'color:#0f0;font-weight:bold');
        res(b);
      })));
})();
