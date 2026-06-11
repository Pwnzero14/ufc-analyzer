// ============================================================
// STORAGE AUDIT — READ-ONLY (run first)
// Paste into the extension console (analyzer page or service worker).
// Lists every chrome.storage.local key with size, flags backups,
// shows total vs the ~10 MB quota. Mutates nothing.
// ============================================================
chrome.storage.local.get(null, (all) => {
  const enc = new TextEncoder();
  const rows = Object.entries(all).map(([key, val]) => {
    let bytes = -1;
    try { bytes = enc.encode(key).length + enc.encode(JSON.stringify(val)).length; } catch {}
    return {
      key,
      MB: +(bytes / 1048576).toFixed(3),
      rows: Array.isArray(val) ? val.length : '',
      backup: /backup/i.test(key) ? 'YES' : ''
    };
  }).sort((a, b) => b.MB - a.MB);

  console.table(rows);

  const totalMB = rows.reduce((s, r) => s + Math.max(r.MB, 0), 0);
  const bk = rows.filter(r => r.backup);
  const bkMB = bk.reduce((s, r) => s + Math.max(r.MB, 0), 0);
  console.log(`TOTAL (JSON estimate): ${totalMB.toFixed(2)} MB of ~10 MB quota`);
  console.log(`BACKUP KEYS: ${bk.length} keys, ${bkMB.toFixed(2)} MB reclaimable`);
  bk.forEach(r => console.log(`  ${r.key}  ${r.MB} MB`));

  if (chrome.storage.local.getBytesInUse) {
    chrome.storage.local.getBytesInUse(null, b =>
      console.log(`getBytesInUse (exact): ${(b / 1048576).toFixed(2)} MB`));
  }
});
