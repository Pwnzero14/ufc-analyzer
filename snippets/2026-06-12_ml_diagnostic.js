// ML DIAGNOSTIC — paste into the ANALYZER page console (F12 on analyzer.html)
// Shows: what DK scraped, what the merged store holds, and how each card
// fighter resolves. Tells us if the bug is scrape-side or match-side.
chrome.storage.local.get(
  ['fight_odds_moneyline', 'fight_odds_dk_v1', 'lines_pick6'],
  (d) => {
    const ml = d.fight_odds_moneyline || {};
    const dk = d.fight_odds_dk_v1 || {};
    console.log(`=== DK store (fight_odds_dk_v1): ${Object.keys(dk).length} entries ===`);
    console.table(dk);
    console.log(`=== Merged store (fight_odds_moneyline): ${Object.keys(ml).length} entries ===`);
    console.table(ml);
    const card = (d.lines_pick6?.fighters || []).map((f) => f.name);
    console.log('=== Card resolution ===');
    card.forEach((n) => {
      const exact = Object.keys(ml).find((k) => k.toLowerCase() === n.toLowerCase());
      const last = n.split(' ').pop().toLowerCase();
      const fuzzy = exact || Object.keys(ml).find((k) => k.toLowerCase().includes(last));
      console.log(`${n}: ${fuzzy ? `${ml[fuzzy]} (key: "${fuzzy}")` : '*** NO MATCH ***'}`);
    });
  }
);
