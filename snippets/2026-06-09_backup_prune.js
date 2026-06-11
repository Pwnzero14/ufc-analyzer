// ============================================================
// BACKUP PRUNE — two-step, run AFTER the audit snippet
// Step 1: paste this — it only PRINTS the deletion plan.
// Step 2: review the plan, then run  confirmPrune()  to execute.
// Optional: run  exportDoomed()  first (analyzer-page console only)
//           to download a JSON copy of the keys being deleted.
//
// Keeps the NEWEST 1 backup per family (ghostfix, bonfimclear,
// betr_backup, orphan_backup, ...). prop_archive_v1 and all
// non-backup keys are never touched.
// ============================================================
(async () => {
  const KEEP_PER_FAMILY = 1;

  const all = await new Promise(res => chrome.storage.local.get(null, res));
  const isBackup = k =>
    /^prop_archive_(orphan_)?backup_/.test(k) ||
    /^betr_backup_/.test(k) ||
    /_backup_/i.test(k);

  // Family = key minus trailing timestamp (epoch or ISO-ish suffix)
  const familyOf = k => k.replace(/[_-]\d[\d\-T:.Z]*$/, '');

  const backups = Object.keys(all).filter(isBackup);
  if (!backups.length) { console.log('No backup keys found. Nothing to prune.'); return; }

  const fams = {};
  for (const k of backups) (fams[familyOf(k)] ||= []).push(k);

  const toDelete = [];
  for (const keys of Object.values(fams)) {
    keys.sort(); // timestamps sort lexically within a family
    toDelete.push(...keys.slice(0, Math.max(0, keys.length - KEEP_PER_FAMILY)));
  }

  const enc = new TextEncoder();
  const mb = k => { try { return enc.encode(JSON.stringify(all[k])).length / 1048576; } catch { return 0; } };

  console.log('FAMILIES (count):',
    Object.fromEntries(Object.entries(fams).map(([f, k]) => [f, k.length])));
  console.log('KEEPING (newest per family):',
    Object.values(fams).flatMap(k => k.slice(-KEEP_PER_FAMILY)));
  console.table(toDelete.map(k => ({ key: k, MB: +mb(k).toFixed(3) })));
  console.log(`PLAN: delete ${toDelete.length} key(s), reclaim ~${toDelete.reduce((s, k) => s + mb(k), 0).toFixed(2)} MB.`);
  console.log('Run confirmPrune() to execute. Nothing deleted yet.');

  globalThis.confirmPrune = () => new Promise(res =>
    chrome.storage.local.remove(toDelete, () => {
      console.log(`DELETED ${toDelete.length} key(s).`);
      if (chrome.storage.local.getBytesInUse) {
        chrome.storage.local.getBytesInUse(null, b => {
          console.log(`Storage now: ${(b / 1048576).toFixed(2)} MB of ~10 MB.`);
          res(b);
        });
      } else res(null);
    }));

  // Analyzer-page console only (needs DOM). Downloads doomed keys as JSON.
  globalThis.exportDoomed = () => {
    const payload = { exportedAt: new Date().toISOString(), keys: {} };
    for (const k of toDelete) payload.keys[k] = all[k];
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pruned_backups_${Date.now()}.json`;
    a.click();
    console.log('Export triggered — check downloads.');
  };
})();
