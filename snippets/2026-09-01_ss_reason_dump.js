(async () => {
  const s = await new Promise(r => chrome.storage.local.get(['prop_predictions_v1'], r));
  const evs = s.prop_predictions_v1 || [];
  const e = evs.reduce((a, b) => (Number(b.generatedAt || 0) > Number(a.generatedAt || 0) ? b : a));
  for (const n of ['Dan Hooker', 'Morgan Charriere', 'Modestas Bukauskas']) {
    const p = e.predictions.find(x => x.fighter === n);
    console.log('%c' + n + '  ss.line=' + p?.ss?.line + '  anchoredFrom=' + p?.ss?.anchoredFrom, 'font-weight:bold');
    (p?.ss?.reasons || []).forEach((r, i) => console.log('   [' + i + '] ' + r));
  }
})();
