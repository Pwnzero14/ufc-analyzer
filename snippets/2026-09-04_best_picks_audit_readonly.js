/*
 * READ-ONLY pre-card audit dump — UFC Fight Night: Hooker vs Parnasse (2026-09-05).
 *
 * WHY A DUMP AND NOT AN EYEBALL. The audit checklist needs two things no single
 * screen shows together:
 *   1. what the board DISPLAYS per pick (side, stat, line, book, WIN%, EV, tier,
 *      every caveat badge), and
 *   2. what EVERY OTHER CAPABLE BOOK posts for that same fighter+stat — the only
 *      way to check line-side optimality ("lowest line wins an OVER, highest wins
 *      an UNDER") instead of trusting the 🏪 badge to have fired.
 * (2) reads the five raw line stores, so it is independent of the analyzer's
 * merge: if the merge dropped a line, this still sees it.
 *
 * IT RE-DERIVES NOTHING SCORED. Confidence, EV and tier are read AS RENDERED.
 * The audit rules are explicit that a row's WIN% (displayed, post-recalibration)
 * and a raw `el.conf` are different quantities that routinely differ by 15+
 * points, and comparing across them manufactures rank inversions that do not
 * exist.
 *
 * PARSING NOTES — each of these was a real bug caught against the live markup,
 * so do not "simplify" them back:
 *   · `data-fight` is NULL on every row; same-fight grouping uses `.bp-vs`.
 *   · The BOOK PRECEDES THE LINE ("Pick6 88.5"), it does not follow it.
 *   · FP picks print NO stat label at all — absence means FP.
 *   · A `● PLACED UNDER FT` badge names a DIFFERENT stat you already placed on
 *     that fighter. Reading side/stat out of the row text grabs that badge
 *     instead of the pick. Side and tier therefore come from the ROW CLASS
 *     (`over`/`under`, `tier-*`), which cannot be confused, and the stat is
 *     matched only in the `<STAT> <SIDE> <number>` shape.
 *
 * RUN IT ON THE AI BEST PICKS VIEW. chrome.storage.local.get only; no writes.
 */
(async () => {
  'use strict';
  const rows = [...document.querySelectorAll('.best-pick-row')];
  console.log('%c[bp-audit] READ-ONLY', 'font-weight:bold;font-size:13px');
  if (!rows.length) {
    console.warn('  No .best-pick-row found — switch to the AI BEST PICKS view and re-run.');
    return;
  }

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const STORES = {
    P6: 'lines_pick6', UD: 'lines_underdog', BT: 'lines_betr',
    PP: 'lines_prizepicks', DK: 'lines_draftkings_sportsbook',
  };
  // Straight from LINE_STAT_ACCESSORS. A book absent from a stat's list CANNOT
  // post it, so its blank is capability — never report that as a missing line.
  const CAPABLE = {
    fp: ['P6', 'UD', 'PP', 'BT'],
    ss: ['P6', 'UD', 'PP', 'BT', 'DK'],
    ss_r1: ['UD', 'PP', 'DK'],
    td: ['P6', 'UD', 'PP', 'BT', 'DK'],
    ft: ['P6', 'UD', 'PP', 'BT', 'DK'],
    ctrl: ['P6', 'UD', 'PP', 'BT', 'DK'],
    kd: ['PP'],
  };
  const FIELD = { fp: 'line_fp', ss: 'line_ss', ss_r1: 'line_ss_r1', td: 'line_td', ft: 'line_ft', ctrl: 'line_ctrl', kd: 'line_kd' };

  // ── PLACEABILITY MUST BE APPLIED BEFORE ANY PRICE COMPARISON ──────────────
  // Added after this probe reported two false "giveaways" on 2026-09-04. It
  // compared raw stored lines and found Felipe Lima's SS UNDER shown at P6 37.5
  // while UD had 39.5 — but UD SS unders are offered to DOGS ONLY and Lima is a
  // -205 FAVOURITE, so that 39.5 is a bet he cannot place. His opponent
  // Charriere (+170, DOG) showed the mirror image: P6 39.5 blocked, UD 38.5
  // shown. `bestSideLineForPick` in analyzer.ts was sorting correctly the whole
  // time; it filters unplaceable books first, which is exactly right.
  //
  // The rule (from the SS-under gate in analyzer.ts, kept in sync here):
  //   PrizePicks / DraftKings — both sides for every fighter
  //   Betr                    — trust betr_ss_under_avail; unset = permissive
  //   Pick6                   — SS UNDER for FAVOURITES only
  //   Underdog                — SS UNDER for UNDERDOGS only
  // A comparison that ignores this manufactures giveaways on every fight where
  // the two fighters' roles split the books, which is most of them.
  const roleOf = (name, oppName) => {
    const a = mlOf(name), b = mlOf(oppName);
    if (a == null || b == null) return 'unknown';
    return a > b ? 'dog' : a < b ? 'fav' : 'even';
  };
  const underPlaceable = (stat, book, role, rec) => {
    if (stat !== 'ss' && stat !== 'fp') return true;   // only these two are role-gated here
    if (book === 'PP' || book === 'DK') return true;
    if (stat === 'fp') {
      // Dog FP UNDER is blocked on Pick6 and Betr; placeable on UD and PP.
      if (role !== 'dog') return true;
      return book !== 'P6' && book !== 'BT';
    }
    if (book === 'BT') return (rec && rec.betr_ss_under_avail) !== false;
    if (book === 'UD') return role === 'dog';
    if (book === 'P6') return role === 'fav';
    return true;
  };
  const BOOK_ABBR = { Pick6: 'P6', Underdog: 'UD', PrizePicks: 'PP', Betr: 'BT', DraftKings: 'DK',
                      P6: 'P6', UD: 'UD', PP: 'PP', BT: 'BT', BTR: 'BT', DK: 'DK' };

  const all = await get([...Object.values(STORES), 'fight_odds_moneyline']);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

  const ml = all['fight_odds_moneyline'] || {};
  const mlOf = (n) => {
    const k = norm(n);
    for (const [nm, o] of Object.entries(ml)) if (norm(nm) === k) return o;
    for (const [nm, o] of Object.entries(ml)) {
      const A = norm(nm).split(' '), B = k.split(' ');
      if (A[A.length - 1] === B[B.length - 1]) return o;
    }
    return null;
  };
  const byBook = {};
  for (const [abbr, key] of Object.entries(STORES)) {
    const store = all[key];
    const list = Array.isArray(store) ? store : (store && store.fighters) || [];
    const m = new Map();
    for (const f of list) if (f && f.name) m.set(norm(f.name), f);
    byBook[abbr] = m;
    console.log(`  ${abbr.padEnd(3)} store: ${String(list.length).padStart(3)} fighters`);
  }

  // Column-qualified rank label: O3 = third of the overs, U1 = first of the unders.
  const colRank = (p) => `${p.side === 'OVER' ? 'O' : 'U'}${p.rank}`;
  const picks = rows.map((row, i) => {
    const cls = String(row.className);
    const t = row.innerText.replace(/\s+/g, ' ').trim();
    const hs = [...row.querySelectorAll('.bp-hs-val')].map(e => e.textContent.trim());
    // Stat only in the `<STAT> <SIDE> <number>` shape; no match means FP.
    const sm = t.match(/\b(R1 SS|CTRL|FP|SS|TD|FT|KD)\s+(?:OVER|UNDER)\s+\d/);
    // Tier word then the book's FULL name then the line: "MED Pick6 88.5".
    // Books render EITHER the full name ("MED Pick6 88.5") OR the abbreviation
    // ("MED DK 0.5"). Matching only full names returned null for every DK pick,
    // which is exactly what happened on the first run against live markup.
    const bm = t.match(/\b(?:HIGH|MED|LOW)\s+(Pick6|Underdog|PrizePicks|Betr|DraftKings|P6|UD|PP|BTR|BT|DK)\s+(\d+(?:\.\d+)?)/);
    const statLbl = sm ? sm[1] : 'FP';
    // The rendered "#N" RESTARTS PER COLUMN (overs and unders each start at 1),
    // so a sequential index disagrees with the board — it called Hooker #1 while
    // the index said 9. Read the number the board shows; qualify it by column.
    const rm = t.match(/^#(\d+)/);
    return {
      rank: rm ? Number(rm[1]) : i + 1,
      name: row.getAttribute('data-jump') || '(?)',
      side: /\bunder\b/.test(cls) ? 'UNDER' : /\bover\b/.test(cls) ? 'OVER' : '?',
      tier: (cls.match(/tier-(high|med|low)/) || [, '?'])[1].toUpperCase(),
      statLbl,
      stat: { 'FP': 'fp', 'SS': 'ss', 'R1 SS': 'ss_r1', 'TD': 'td', 'FT': 'ft', 'CTRL': 'ctrl', 'KD': 'kd' }[statLbl],
      book: bm ? BOOK_ABBR[bm[1]] : null,
      line: bm ? Number(bm[2]) : null,
      win: hs[0] || '', ev: hs[1] || '',
      opp: (row.querySelector('.bp-vs') || {}).textContent ? row.querySelector('.bp-vs').textContent.replace(/^vs\s*/, '').replace(/\s*MAIN\s*$/, '').trim() : '',
      flags: [
        /NEEDS ROUNDS/.test(t) && 'NEEDS-ROUNDS',
        /PROJ SAYS/.test(t) && 'PROJ-CONFLICT',
        /CHECK LINE/.test(t) && 'CHECK-LINE',
        /↔ SAME FIGHT/.test(t) && 'SAME-FIGHT',
        /⇄ DUAL/.test(t) && 'DUAL',
        /⬇ corr/.test(t) && 'CORR-DEMOTED',
        /CUT/.test(t) && 'CUT-INVERSION',
        /⚖ MISS/.test(t) && 'WEIGHT-MISS',
        /⚠ NEWS/.test(t) && 'NEWS',
        /ONLY/.test(t) && 'ONE-BOOK',
        /LEAN ✓ · VALUE ✗/.test(t) && 'NO-VALUE',
        /⌀|n=0/.test(t) && 'NO-HISTORY',
      ].filter(Boolean).join(' '),
      text: t,
    };
  });

  console.log('%c-- THE BOARD, AS RENDERED (nothing rescored) --', 'font-weight:bold');
  console.table(picks.map(p => ({
    '#': colRank(p), fighter: p.name, vs: p.opp, side: p.side, stat: p.statLbl,
    line: p.line, book: p.book, WIN: p.win, EV: p.ev, tier: p.tier, flags: p.flags,
  })));

  console.log('%c-- EVERY CAPABLE BOOK (OVER wants the LOWEST line, UNDER the HIGHEST) --', 'font-weight:bold');
  const shop = [];
  for (const p of picks) {
    if (!p.stat) continue;
    const key = norm(p.name);
    const found = [];
    const role = roleOf(p.name, p.opp);
    const blocked = [];
    for (const abbr of CAPABLE[p.stat] || []) {
      const rec = byBook[abbr].get(key);
      const v = rec ? rec[FIELD[p.stat]] : undefined;
      if (v == null || !Number.isFinite(Number(v))) continue;
      // Only placeable books may set the benchmark — see the note above FIELD.
      if (p.side === 'UNDER' && !underPlaceable(p.stat, abbr, role, rec)) {
        blocked.push(`${abbr} ${Number(v)}`);
        continue;
      }
      found.push([abbr, Number(v)]);
    }
    if (blocked.length) console.log(`     ${colRank(p)} ${p.name} (${role}) — NOT placeable, excluded: ${blocked.join('  ')}`);
    if (!found.length) {
      shop.push({ '#': colRank(p), fighter: p.name, stat: p.statLbl, side: p.side, shown: `${p.line} ${p.book}`, allBooks: '(none found)', best: '', giveaway: '' });
      continue;
    }
    const bestVal = (p.side === 'OVER' ? Math.min : Math.max)(...found.map(e => e[1]));
    const give = p.line == null ? null : (p.side === 'OVER' ? p.line - bestVal : bestVal - p.line);
    shop.push({
      '#': colRank(p), fighter: p.name, stat: p.statLbl, side: p.side,
      shown: `${p.line} ${p.book}`,
      allBooks: found.map(([b, v]) => `${b} ${v}`).join('  '),
      best: `${bestVal} ${found.filter(e => e[1] === bestVal).map(e => e[0]).join('/')}`,
      giveaway: give == null ? '' : (give >= 1.5 ? `*** ${give.toFixed(1)} ***` : give.toFixed(1)),
    });
  }
  console.table(shop);
  console.log('  *** N *** = 1.5+ points worse than the best book IN THE PICK\'S DIRECTION.');
  console.log('  A book missing from allBooks is a real absence — capability came from LINE_STAT_ACCESSORS.');

  console.log('%c-- SAME-FIGHT CONCENTRATION (data-fight is null; grouped by fighter+opponent) --', 'font-weight:bold');
  const byFight = new Map();
  for (const p of picks) {
    if (!p.opp) continue;
    const k = [norm(p.name), norm(p.opp)].sort().join('  vs  ');
    if (!byFight.has(k)) byFight.set(k, []);
    byFight.get(k).push(p);
  }
  const pairs = [...byFight.entries()].filter(([, v]) => v.length > 1);
  if (!pairs.length) console.log('  none — every pick sits on a different fight.');
  pairs.forEach(([k, v]) => console.log(`  ${k}\n      ` + v.map(p => `${colRank(p)} ${p.name} ${p.side} ${p.statLbl} ${p.line} (${p.win})`).join('\n      ')));

  console.log('%c-- FULL ROW TEXT (for the reasons/badges the table truncates) --', 'font-weight:bold');
  picks.forEach(p => console.log(`${colRank(p)} ${p.name}\n    ${p.text}`));

  window.__bpAudit = { picks, shop, pairs };
  console.log('%c  full result on window.__bpAudit', 'color:#888');
})();
