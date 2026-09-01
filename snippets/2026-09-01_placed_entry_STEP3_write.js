/*
 * STEP 3 of 3. *** THIS ONE WRITES. *** Do not run it until 💾 Backup has been
 * clicked (… MORE → 💾 Backup in the analyzer header).
 *
 * Records a 2-leg Underdog "Champions" slip taken 2026-08-31 15:15, at its ENTRY
 * lines, because the board has since moved (UD Page 31.5→29.5, Ruziboev
 * 22.5→19.5) and the ✓ PLACED button would stamp the CURRENT number and destroy
 * the CLV measurement.
 *
 * EVERY VALUE BELOW WAS READ FROM STORAGE IN STEPS 1/1b. Nothing is guessed:
 *   event key   "ufc fight night: hooker vs. parnasse"   (read, never constructed)
 *   names       "Michael Page" / "Nursulton Ruziboev"    (line store, full strings)
 *   opponents   cloned from the UNDERDOG rows, which carry full names — Pick6
 *               stores bare surnames ("Page"/"Ruziboev") and would ghost at settle
 *   pretty      identical to name (prettyName only rewrites O'-, Mc-, numerals)
 *   keys        "<name>|under|ss" — both confirmed FREE, so no book suffix needed
 *
 * SAFETY PROPERTIES:
 *   - MERGES. Never replaces the event object, never touches other events.
 *   - SKIPS keys that already exist; re-running cannot double-write.
 *   - Dedupes the parlay on the CURRENT signature, which since 2026-08-27
 *     (5cdde96) is fighter|stat|dir|book|line — omitting book/line would wrongly
 *     report a duplicate.
 *   - Checks chrome.runtime.lastError on the write. A silent quota rejection
 *     once made a full disk look like a dead button; a lost write must be loud.
 *   - Prints before/after counts. "added legs: 0" means STOP and re-diagnose.
 *
 * NOT RECORDED: stake, multiplier, payout. PlacedParlay is {id, placedAt, legs}.
 * The $25 → $63.75 at 2.55x grades hit/miss only. That is a schema gap, not a
 * data-entry mistake.
 */
(async () => {
  'use strict';
  const PLACED = 'best_picks_placed_v1';
  const PARLAY = 'parlay_placed_v1';
  const EV = 'ufc fight night: hooker vs. parnasse';
  const AT = Date.parse('2026-08-31T15:15:00-04:00');   // the real slip time

  if (!Number.isFinite(AT)) { console.error('bad timestamp — aborting'); return; }

  const leg = (name, opp, line) => ({
    key: `${name}|under|ss`,
    name, pretty: name,
    dir: 'UNDER', source: 'ss', statLabel: 'SS',
    line, book: 'underdog', bookLabel: 'Underdog',
    clip: `${name} UNDER ${line} SS @ Underdog (vs ${opp})`,
    opponent: opp, opponentRaw: opp,
    placedAt: AT,
  });
  const LEGS = [
    leg('Nursulton Ruziboev', 'Michael Page', 22.5),
    leg('Michael Page', 'Nursulton Ruziboev', 31.5),
  ];
  const PAR_LEGS = LEGS.map((l) => ({
    fighter: l.name, opponent: l.opponent, dir: 'UNDER',
    stat: 'ss', statLabel: 'SS', line: l.line, book: 'underdog', bookLabel: 'Underdog',
  }));

  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const set = (o) => new Promise((res, rej) => chrome.storage.local.set(o, () => {
    const e = chrome.runtime && chrome.runtime.lastError;
    if (e) rej(new Error(e.message)); else res();
  }));

  const raw = await get([PLACED, PARLAY]);
  const placedAll = (raw[PLACED] && typeof raw[PLACED] === 'object' && !Array.isArray(raw[PLACED])) ? { ...raw[PLACED] } : {};
  const parlayAll = (raw[PARLAY] && typeof raw[PARLAY] === 'object' && !Array.isArray(raw[PARLAY])) ? { ...raw[PARLAY] } : {};

  if (!Object.prototype.hasOwnProperty.call(placedAll, EV)) {
    console.warn('event key not present in best_picks_placed_v1 — it will be created:', EV);
  }
  const evLegs = { ...(placedAll[EV] || {}) };
  const beforeLegs = Object.keys(evLegs).length;
  const beforePar = (parlayAll[EV] || []).length;

  // ── legs ──────────────────────────────────────────────────────────────────
  let added = 0; const skipped = [];
  for (const l of LEGS) {
    if (evLegs[l.key]) { skipped.push(l.key); continue; }
    evLegs[l.key] = l; added++;
  }
  placedAll[EV] = evLegs;

  // ── parlay ────────────────────────────────────────────────────────────────
  const sigOf = (ls) => (ls || [])
    .map((l) => `${String(l.fighter).toLowerCase()}|${l.stat}|${String(l.dir).toLowerCase()}|${l.book ?? ''}|${l.line ?? ''}`)
    .sort().join(',');
  const sig = sigOf(PAR_LEGS);
  const list = Array.isArray(parlayAll[EV]) ? [...parlayAll[EV]] : [];
  const dup = list.some((p) => sigOf(p.legs || []) === sig);
  if (!dup) list.unshift({ id: `${AT}_udchamp2`, placedAt: AT, legs: PAR_LEGS });
  parlayAll[EV] = list.slice(0, 30);

  console.log('%c[placed-entry STEP 3] WRITING', 'font-weight:bold;color:#e0b000');
  console.log('  signature:', sig);
  console.log('  parlay duplicate?', dup ? 'YES — not added' : 'no — adding');
  if (skipped.length) console.warn('  legs skipped (key already present):', skipped);

  try {
    await set({ [PLACED]: placedAll, [PARLAY]: parlayAll });
  } catch (e) {
    console.error('%c  WRITE FAILED — nothing was saved:', 'color:#f44336', e.message);
    console.error('  If this mentions quota, back up and clear space before retrying.');
    return;
  }

  // ── read back from storage, not from the in-memory objects ────────────────
  const after = await get([PLACED, PARLAY]);
  const aLegs = (after[PLACED] && after[PLACED][EV]) || {};
  const aPar = (after[PARLAY] && after[PARLAY][EV]) || [];
  console.log('%c── VERIFIED FROM STORAGE ──', 'font-weight:bold');
  console.log('  added legs:', added, '| added parlays:', dup ? 0 : 1);
  console.log('  legs on this event   :', beforeLegs, '→', Object.keys(aLegs).length);
  console.log('  parlays on this event:', beforePar, '→', aPar.length);
  console.log('  other events untouched:', Object.keys(after[PLACED] || {}).length, 'placed event keys total');
  for (const l of LEGS) {
    const r = aLegs[l.key];
    console.log('  ', r ? '✓' : '✗', l.key, r ? `→ ${r.dir} ${r.line} ${r.statLabel} @${r.book} (vs ${r.opponent}) @ ${new Date(r.placedAt).toLocaleString()}` : 'MISSING');
  }
  if (added === 0 && !dup) console.warn('  added legs: 0 — STOP and re-diagnose before assuming success.');
  console.log('  Now open Data → Placed / Parlays and confirm both render.');
})();
