/*
 * STEP 1 of 3. READ-ONLY DUMP. Writes nothing.
 *
 * Recording a 2-leg slip taken 2026-08-31 15:15 at lines that have since moved:
 *     Nursulton Ruziboev  LOWER 22.5 SS   (board now 19.5)
 *     Michael Page        LOWER 31.5 SS   (board now 29.5)
 * The PLACED button stamps the CURRENT line, which would destroy the CLV
 * measurement, so these have to be hand-written at their ENTRY lines.
 *
 * SEQUENCE IS NON-NEGOTIABLE: dump -> Backup -> write. This is the dump. It
 * exists to catch the traps that have actually bitten this repo before:
 *   - the EVENT KEY must be READ, never constructed (it is the event name
 *     lowercased, and the exact string is what settle matches on)
 *   - SPELLING comes from the PLACED STORE, not the card: a previous entry hit
 *     "Sumudaerji" on the card vs "Su Mudaerji" in every placed record
 *   - the TWO-JOHNSON trap: never guess an opponent; copy the canonical pairing
 *   - a bare-key collision may be a SECOND REAL WAGER on another book, not a
 *     duplicate - which is why the book-suffixed key exists
 *
 * Paste into the ANALYZER page console.
 */
(async () => {
  'use strict';
  const PLACED = 'best_picks_placed_v1';
  const PARLAY = 'parlay_placed_v1';
  const CARD = 'upcoming_ufc_card';
  const LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
  const BOOK = { lines_pick6: 'pick6', lines_underdog: 'underdog', lines_betr: 'betr', lines_prizepicks: 'prizepicks', lines_draftkings_sportsbook: 'draftkings_sportsbook' };
  const TARGETS = ['ruziboev', 'page'];

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const raw = await get([PLACED, PARLAY, CARD, ...LINE_KEYS]);
  const placed = raw[PLACED] && typeof raw[PLACED] === 'object' ? raw[PLACED] : {};
  const parlays = raw[PARLAY] && typeof raw[PARLAY] === 'object' ? raw[PARLAY] : {};

  console.log('%c[placed-entry STEP 1] READ-ONLY DUMP — nothing is written', 'font-weight:bold');

  // ── 1. EVENT KEYS. Read them; do not build them. ──────────────────────────
  console.log('%c── 1. EVENT KEYS (copy the exact string) ──', 'font-weight:bold');
  console.log('  best_picks_placed_v1 keys:', Object.keys(placed));
  console.log('  parlay_placed_v1 keys   :', Object.keys(parlays));
  const guess = Object.keys(placed).concat(Object.keys(parlays)).find((k) => /hooker|parnasse/i.test(k));
  console.log('  key matching this card  :', guess || 'NONE YET — the event has no placed records, so STEP 2 creates it');

  // ── 2. EXISTING LEGS ON THIS EVENT — the spelling source of truth ─────────
  console.log('%c── 2. EXISTING PLACED LEGS ON THIS EVENT ──', 'font-weight:bold');
  const evLegs = guess && placed[guess] ? placed[guess] : {};
  const legRows = Object.entries(evLegs).map(([k, r]) => ({
    key: k, name: r && r.name, pretty: r && r.pretty, dir: r && r.dir, source: r && r.source,
    line: r && r.line, book: r && r.book, bookLabel: r && r.bookLabel,
    opponent: r && r.opponent, opponentRaw: r && r.opponentRaw,
    placedAt: r && r.placedAt ? new Date(r.placedAt).toLocaleString() : '',
    outcome: (r && r.outcome) || 'pending',
  }));
  if (legRows.length) console.table(legRows); else console.log('  (none)');
  console.log('  CLONE name / pretty / opponent / opponentRaw off these if either fighter appears.');

  // ── 3. EXISTING PARLAYS + their signatures ────────────────────────────────
  console.log('%c── 3. EXISTING PARLAYS ON THIS EVENT ──', 'font-weight:bold');
  // Signature changed 2026-08-27 (5cdde96): it now carries BOOK and LINE.
  // Reproducing it without those wrongly reports a duplicate.
  const sigOf = (ls) => (ls || [])
    .map((l) => `${String(l.fighter).toLowerCase()}|${l.stat}|${String(l.dir).toLowerCase()}|${l.book ?? ''}|${l.line ?? ''}`)
    .sort().join(',');
  const evPar = guess && Array.isArray(parlays[guess]) ? parlays[guess] : [];
  if (evPar.length) {
    for (const p of evPar) {
      console.log('  id', p.id, '|', new Date(p.placedAt).toLocaleString());
      console.log('     legs:', (p.legs || []).map((l) => `${l.fighter} ${l.dir} ${l.line} ${l.statLabel} @${l.book}`).join('  +  '));
      console.log('     sig :', sigOf(p.legs));
    }
  } else console.log('  (none)');

  // ── 4. CANONICAL PAIRINGS — never guess an opponent ───────────────────────
  console.log('%c── 4. CARD PAIRINGS FOR THE TWO FIGHTERS ──', 'font-weight:bold');
  const card = raw[CARD];
  const cf = (card && Array.isArray(card.fighters)) ? card.fighters : [];
  const hits = cf.filter((f) => f && TARGETS.some((t) => String(f.name || '').toLowerCase().includes(t)));
  console.table(hits.map((f) => ({ name: f.name, opponent: f.opponent })));
  for (const t of TARGETS) {
    const n = cf.filter((f) => String(f.name || '').toLowerCase().includes(t)).length;
    if (n > 1) console.warn('  *** ' + n + ' fighters match "' + t + '" — the two-Johnson trap. Resolve before writing. ***');
  }
  if (!cf.length) console.warn('  upcoming_ufc_card has no fighters array — fall back to the placed store spellings.');

  // ── 5. STORED LINES NOW, vs the ENTRY lines being recorded ────────────────
  console.log('%c── 5. LINES NOW vs ENTRY (this is why we are hand-writing) ──', 'font-weight:bold');
  const ENTRY = { ruziboev: 22.5, page: 31.5 };
  const rows = [];
  for (const k of LINE_KEYS) {
    const st = raw[k];
    const arr = Array.isArray(st) ? st : (st && Array.isArray(st.fighters) ? st.fighters : []);
    for (const f of arr) {
      const nm = String(f && f.name || '').toLowerCase();
      const t = TARGETS.find((x) => nm.includes(x));
      if (!t) continue;
      rows.push({ book: BOOK[k], name: f.name, 'line_ss NOW': f.line_ss, 'ENTRY line': ENTRY[t],
        moved: Number(f.line_ss) !== ENTRY[t] ? 'YES' : 'no', ss_under_available: f.ss_under_available });
    }
  }
  console.table(rows);
  console.log('  A book still showing the ENTRY line could have been placed normally through the UI.');
  console.log('  The book that MOVED is the one that needs the manual write. Confirm which book the');
  console.log('  slip was actually on before STEP 2 — it sets the leg keys, the parlay signature and CLV.');

  // ── 6. THE KEYS STEP 2 WOULD WRITE, AND WHETHER THEY COLLIDE ──────────────
  console.log('%c── 6. TARGET KEYS AND COLLISION CHECK ──', 'font-weight:bold');
  const probe = (nm, book) => {
    const bare = `${nm}|under|ss`;
    const withBook = `${bare}|${book}`;
    console.log('  ' + bare.padEnd(38), evLegs[bare] ? 'EXISTS -> use the book-suffixed key' : 'free');
    console.log('  ' + withBook.padEnd(38), evLegs[withBook] ? 'EXISTS -> already recorded, skip' : 'free');
  };
  const nameFromCard = (t) => { const f = hits.find((x) => String(x.name).toLowerCase().includes(t)); return f ? f.name : '(unresolved)'; };
  probe(nameFromCard('ruziboev'), 'underdog');
  probe(nameFromCard('page'), 'underdog');
  console.log('  A bare-key collision is NOT automatically a duplicate — it may be the same side');
  console.log('  taken on another book, which is a second real wager and needs the suffixed key.');

  window.__placedDump = { eventKey: guess, evLegs, evPar, cardHits: hits, lineRows: rows };
  console.log('  full dump on window.__placedDump');
})();
