// READ-ONLY probe — run in the DraftKings Sportsbook tab console (same-origin → no CORS).
// Goal: find whether DK's "% of bets placed" handle is in the sportscontent leagues API,
// and under what field. Writes NOTHING. Just logs.
(async () => {
  const URL = 'https://sportsbook-nash.draftkings.com/api/sportscontent/dkusoh/v1/leagues/9034';
  const data = await (await fetch(URL, { headers: { accept: 'application/json' } })).json();
  const markets = Array.isArray(data?.markets) ? data.markets : [];
  const selections = Array.isArray(data?.selections) ? data.selections : [];
  console.log('top-level keys:', Object.keys(data));
  console.log('markets:', markets.length, '| selections:', selections.length);

  // 1) Dump a moneyline selection in full so we can see every field DK ships per pick.
  const mlIds = new Set(markets.filter(m => /^moneyline$/i.test(String(m?.name||'').trim())).map(m => m.id));
  const mlSel = selections.find(s => mlIds.has(s.marketId));
  console.log('--- sample MONEYLINE selection (full) ---');
  console.log(JSON.stringify(mlSel, null, 2));
  console.log('--- its moneyline MARKET (full) ---');
  console.log(JSON.stringify(markets.find(m => m.id === mlSel?.marketId), null, 2));

  // 2) Scan EVERY key path in markets+selections for handle/percent/bet/sentiment-ish names.
  const RX = /(percent|handle|bet|wager|sentiment|split|insight|popular|ticket|public|trend)/i;
  const hits = new Set();
  const walk = (o, path) => {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      if (RX.test(k)) hits.add(path + '.' + k + '  =  ' + JSON.stringify(o[k]).slice(0, 80));
      walk(o[k], path + '.' + k);
    }
  };
  markets.slice(0, 5).forEach((m, i) => walk(m, 'markets[' + i + ']'));
  selections.slice(0, 40).forEach((s, i) => walk(s, 'selections[' + i + ']'));
  console.log('--- handle/percent-ish key hits ---');
  console.log(hits.size ? [...hits].join('\n') : 'NONE FOUND in leagues API — the bets-placed % likely comes from a separate endpoint.');
})();
