// ── CONFIGURATION ────────────────────────────────────────────────────────
// Centralized config for platforms, selectors, API endpoints, and constants

export const CONFIG = {
  platforms: {
    pick6: {
      id: 'pick6',
      label: 'Pick6 (DraftKings)',
      color: '#63b3ed',
      // 2026-06-11: `/category/46?sport=UFC` now DEAD — it redirects a logged-out
      // browser to the Pick6 homepage (World Cup), scraping 0 UFC fighters. The
      // live entry point for the current card is the bare root `/?sport=UFC` (what
      // the in-app UFC tab navigates to). The SPA loads UFC fighter cards + stat
      // tabs from there; the content script clicks through SS/TD tabs to capture.
      // DK has used /category/46, /category/129, and bare ?sport=UFC across the
      // past months — if Pick6 fetching breaks, first check what URL a logged-out
      // browser actually lands on for the current card (click the in-app UFC tab).
      url: 'https://pick6.draftkings.com/?sport=UFC',
    },
    underdog: {
      id: 'underdog',
      label: 'Underdog Fantasy',
      color: '#9b4ae8',
      url: 'https://underdogfantasy.com/pick-em/higher-lower',
    },
    betr: {
      id: 'betr',
      label: 'Betr Fantasy',
      color: '#ff6b2b',
      url: 'https://betr.app/fantasy',
    },
    prizepicks: {
      id: 'prizepicks',
      label: 'PrizePicks',
      color: '#3bcf8e',
      url: 'https://app.prizepicks.com/board',
    },
  },

  // ── DOM SELECTORS ─────────────────────────────────────────────────────
  selectors: {
    pick6: {
      cardButton: '[data-testid="cardButton"]',
      playerCard: '[class*="PlayerCard"], [class*="player"], [class*="Pick"]',
    },
    underdog: {
      overUnderCell: '[data-testid="over-under-cell"]',
      mmaIcon: '[data-testid="test-icon-mma"]',
      nameSelector: '[class*="nameAndButtons"] [class*="name"], [class*="playerName"], [class*="displayName"]',
    },
    draftkings: {
      tdLabel: 'Total Takedowns Landed O/U',
      betButton: '[class*="Bet"], [class*="Button"]',
    },
  },

  // ── API ENDPOINTS ─────────────────────────────────────────────────────
  api: {
    underdog: [
      'https://api.underdogfantasy.com/v2/over_under_lines',
      'https://api.underdogfantasy.com/v1/over_under_lines',
    ],
    ufcstats: {
      upcoming: 'http://www.ufcstats.com/statistics/events/upcoming?page=all',
      completed: 'http://www.ufcstats.com/statistics/events/completed?page=all',
      base: 'http://www.ufcstats.com',
    },
  },

  // ── POLLING & TIMING ──────────────────────────────────────────────────
  polling: {
    schedule: {
      // Days until event -> poll interval
      earlyWindow: { daysUntil: 6.5, intervalMinutes: 60 }, // Sunday
      midWindow: { daysUntil: 4, intervalMinutes: 30 },     // Monday
      wednesdayWindow: { daysUntil: 2.5, intervalMinutes: 15 }, // Wed
      lateWindow: { daysUntil: 0, intervalMinutes: 5 },     // Thu-Fri
    },
    scrape: {
      maxAttempts: 20,
      attemptIntervalMs: 1500,
      timeoutMs: 35000,
      scrollTimeoutMs: 12000,
      scrollIntervalMs: 600,
    },
    storage: {
      cacheExpireMs: 7200000, // 2 hours
      pollAlarmName: 'ufc_line_poll',
    },
  },

  // ── STAT VALIDATION ───────────────────────────────────────────────────
  validation: {
    fp: { min: 5, max: 300 },
    ss: { min: 1, max: 300 },
    td: { min: 0.5, max: 20 },
  },

  // ── HTTP HEADERS ──────────────────────────────────────────────────────
  http: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    defaultTimeout: 15000,
  },

  // ── LOG LEVELS ────────────────────────────────────────────────────────
  logging: {
    debug: false, // Set to true for verbose logs
    prefix: '[UFC]',
  },
} as const;

// ── EVENT SCHEDULE (always Saturday, lines drop on predictable windows) ──
export const LINE_DROP_SCHEDULE = {
  sunday: { window: 'earlyWindow', label: 'Underdog SS/TD + PrizePicks SS/TD' },
  monday: { window: 'midWindow', label: 'Underdog/PrizePicks SS/TD continued' },
  wednesday: { window: 'wednesdayWindow', label: 'Pick6 FP lines' },
  thursday: { window: 'lateWindow', label: 'Betr FP + PrizePicks FP' },
  friday: { window: 'lateWindow', label: 'Betr FP (latest), PrizePicks FP' },
};

// ── FANTASY SCORING (identical for Pick6, Underdog, and Betr) ──────────
// Source: pick6.draftkings.com/pick6-rules-and-scoring-ufc
//         help.underdogfantasy.com/en/articles/10905385-pick-em-scoring-mma
export const FANTASY_SCORING = {
  sigStrike: 0.4,      // counts as strike 0.2 + sig strike 0.2
  nonSigStrike: 0.2,
  controlTimePerSec: 0.03,
  takedown: 5,
  reversal: 5,
  knockdown: 10,
  quickWinBonus: 25,   // R1 finish in ≤60 seconds
  winBonus: {
    round1: 90,
    round2: 70,
    round3: 45,
    round4Plus: 40,
    decision: 30,
  },
} as const;

// ── PRIZEPICKS FANTASY SCORING (different from Pick6/UD/Betr) ───────────
// Source: PrizePicks app → MMA Fantasy Score Breakdown
// Notes: only sig strikes count (no non-sig, no control time, no reversals).
//        No quick-finish bonus. Submission attempts score 4 each (parsed from
//        UFCStats col 7 — the SUB. ATT column — during settlement).
export const PRIZEPICKS_SCORING = {
  sigStrike: 0.5,
  nonSigStrike: 0,
  controlTimePerSec: 0,
  takedown: 5,
  reversal: 0,
  knockdown: 10,
  submissionAttempt: 4,
  winBonus: {
    round1: 50,
    round2: 40,
    round3: 30,
    round4Plus: 20,   // 4th and 5th round wins both score 20
    decision: 10,
  },
} as const;

// ── FIGHTER NAME ALIASES ───────────────────────────────────────────────
// Platform spelling (key) → UFCStats canonical form (value). Keys are written
// in the title-cased shape analyzer's normalizeName produces; both sides are
// re-normalized by each consumer before use, so casing/spacing here is just for
// readability. Shared by analyzer.ts (normalizeName) and the settle path in
// background.ts so card-pair matching, opponent resolution, and archive
// settlement all agree on one canonical name. Add new entries when a platform
// lists a fighter in a different order/spacing than UFCStats.
export const NAME_ALIASES: Record<string, string> = {
  'Jung Young Lee':   'Jeongyeong Lee',
  'Jungyoung Lee':    'Jeongyeong Lee',
  'Su Sumudaerji':    'Su Mudaerji',
  'Sumudaerji Su':    'Su Mudaerji',
  'Sumudaerji':       'Su Mudaerji',
  // Chinese / Asian fighters where platforms (UD, Pick6) use one order/spacing
  // and UFCStats uses another. Right-hand side mirrors the UFCStats canonical
  // form on the event page.
  'Yadong Song':      'Song Yadong',
  // UFCStats writes "YiSak Lee" with an internal capital S. normalizeName
  // title-cases each word ("Yisak Lee"), so the canonical form is "Yisak Lee".
  'Yi Sak Lee':       'Yisak Lee',
  'Qileng Aori':      'Aoriqileng',
  'Aori Qileng':      'Aoriqileng',
  'Aori Aoriqileng':  'Aoriqileng',
  'Harris Carlston':  'Carlston Harris',
  // 2026-08-31 (Hooker vs. Parnasse): UD lists the full "Matthieu Letho Duclos";
  // UFCStats and the card roster use "Matthieu Duclos". Caught BEFORE it cost
  // anything — his UD FightTime 7.5 archived fine, because namesMatch is
  // surname-token based and duclos/duclos matches on both sides. The exposure is
  // resolveVsArchive, which does NOT use namesMatch: it looks up an EXACT
  // `event|normalizedName|propType` key, so a leg placed under "Matthieu Duclos"
  // would never find a row filed under "Matthieu Letho Duclos". That is the exact
  // shape of the 8 legs (Orolbai, Sumudaerji) the 2026-08-30 ledger audit could
  // not re-grade until aliases were applied.
  'Matthieu Letho Duclos': 'Matthieu Duclos',
  // 2026-09-04 (same card, found by the pre-card audit): THREE more variants on
  // this one board, each holding the ONLY copy of that book's lines. Underdog and
  // PrizePicks carry no canonical record at all for Hooker or Naimov -- their UD/PP
  // SS and Round-1 SS live exclusively under the long spellings:
  //     Dan Hooker      -> UD r1 14.5,  PP ss 30.5 / r1 14.5
  //     Muhammad Naimov -> UD ss 24.5 / r1 11.5,  PP ss 28.5 / r1 11.5
  //     Klaudia Sygula  -> BT ss 45.5   (Betr alone spells her with the Polish L-stroke)
  // The live board is fine: namesMatch is surname-token based, so hooker/hooker and
  // naimov/naimov merge on their own. resolveVsArchive is the exposure -- it looks up
  // an EXACT `event|normalizedName|propType` key, exactly as written above for Duclos.
  'Daniel Hooker':      'Dan Hooker',
  'Muhammadjon Naimov': 'Muhammad Naimov',
  // Sygula needs an ALIAS rather than a normalizer change. Every normalizer in this
  // repo strips diacritics with `normalize('NFD').replace(/[̀-ͯ]/g,'')`,
  // which only removes COMBINING MARKS. U+0142 L-STROKE is a standalone letter that
  // NFD does not decompose, so it survives every one of them -- as do o-slash,
  // d-stroke and sharp-s. Widening that strip touches recordKey for all ~41k archive
  // rows and must be collision-measured first (the way the 2026-09-03 diacritic change
  // was: 0 collisions, 0 lossy). Not the night before a card. See
  // [[project_diacritic_name_split]].
  'Klaudia Syguła':      'Klaudia Sygula',
  // 2026-08-21: PrizePicks lists him "Sergey Spivak"; UFCStats canonical is
  // "Serghei Spivac". namesMatch is surname-token based, so Spivak/Spivac never
  // matched and the stale-opponent guard concluded PP had priced Vitor Petrino
  // against someone off the card — dropping every PrizePicks line on that fight
  // and showing "⊘ STALE PRIZEPICKS". The data was in storage the whole time.
  'Sergey Spivak':    'Serghei Spivac',
  'Sergei Spivak':    'Serghei Spivac',
  'Serghei Spivak':   'Serghei Spivac',
  'Sergey Spivac':    'Serghei Spivac',
  'Sergei Spivac':    'Serghei Spivac',
  'Xiong Jing Nan':   'Xiong Jingnan',
  // Reverse-order variants: platforms sometimes list Chinese fighters in
  // Western order (given-family) while UFCStats uses Chinese order (family-given).
  'Kangjie Zhu':      'Zhu Kangjie',
  'Meng Ding':        'Ding Meng',
  'Mingyang Zhang':   'Zhang Mingyang',
  'Jingnan Xiong':    'Xiong Jingnan',
  // 2026-08-25 (Nurmagomedov vs. Song): UD listed her Western-order "Xiaonan Yan"
  // while UFCStats/Pick6 use "Yan Xiaonan". Surname tokens Yan vs Xiaonan never
  // matched, so her UD SS 52.5 + FT 12.5 split off into a ghost row of their own and
  // the real card row showed only the Pick6 line.
  'Xiaonan Yan':      'Yan Xiaonan',
  // Same card, same shape: UD writes "CE Liu" (normalizes to "Ce Liu"), the card is
  // "Liu Ce". Also fixes his opponent string on Levi Rodrigues Jr's UD record.
  'Ce Liu':           'Liu Ce',
  'Liu Ce':           'Liu Ce',
  // UFC 329: Pick6 lists her Chinese-order "Wang Cong" (family Wang) while
  // UD/PP/Betr use Western-order "Cong Wang" — the mismatch split her into a real
  // card + a ghost and broke opponent/moneyline resolution (Tracy Cortez's dog-FP
  // gate). normalizeName applies this so all platforms + settle collapse to one key.
  'Cong Wang':        'Wang Cong',
  // 2026-07-23 (Davis vs Aliev card): UD/PP truncate "Muhammad Saidov" (the
  // UFCStats card + Pick6 canonical) to "Muhammad Said". Different surname token,
  // so namesMatch can't merge them — his UD/PP/Betr lines split off the Pick6
  // card, leaving it "1 of 26 without lines". normalizeName collapses both.
  'Muhammad Said':    'Muhammad Saidov',
  'Damon Jackson':    'Donte Johnson',
  'Myktybek Orolbai': 'Myktybek Orolbai Uulu',
  'Orolbai':          'Myktybek Orolbai Uulu',
  'Kevin Vallejos':   'Kevin Vallejos',
  'Jose Miguel Delgado': 'Jose Delgado',
  'Jose M Delgado':   'Jose Delgado',
  'Patricio Freire':           'Patricio Pitbull',
  'Patricio Pitbull Freire':   'Patricio Pitbull',
  'Loopy Godinez':     'Lupita Godinez',
  'Paulo Henrique Costa': 'Paulo Costa',
  'Paulo Henrique Da Silva Costa': 'Paulo Costa',
  'Christopher Padilla': 'Chris Padilla',
  'Azamat Murazakov':    'Azamat Murzakanov',
  'A Murazakov':         'Azamat Murzakanov',
  'Darya Zheleznyakova': 'Daria Zhelezniakova',
  // Underdog lists this fighter's full legal name; UFCStats + the card use the short form.
  // Without the alias namesMatch fails (last names "Matos" ≠ "Oliveira") so the SS line never
  // attaches to the card fighter (and his opponent's opp-SS shows blank too).
  'Vinicius De Oliveira Prestes De Matos': 'Vinicius Oliveira',
  'Vinicius De Oliveira': 'Vinicius Oliveira',
  // 2026-08-02 (Gamrot vs Salkilld card): Underdog writes the surname as ONE word
  // ("Yadier Delvalle") while UFCStats + the card use two ("Yadier del Valle").
  // normalizeName title-cases per word, giving "Yadier Delvalle" vs "Yadier Del
  // Valle" — different token counts, so namesMatch can't bridge them and his UD
  // SS line never attached to the card fighter (row showed "No visible source
  // lines" while UD plainly listed him at 27.5).
  'Yadier Delvalle':  'Yadier Del Valle',
  // Platforms use her given name "Beatriz"; UFCStats fighter page is "Bia Mesquita".
  'Beatriz Mesquita':    'Bia Mesquita',
  // UFCStats lists these two Magomedovs by short first names (Shara / Abus); the
  // platforms + card use the full legal first names. Canonicalize so card-match,
  // the UFCStats history fetch, and settle all agree — and so the two Magomedovs on
  // the same card (Fiziev/Torres) stay distinct fighters.
  'Sharabutdin Magomedov': 'Shara Magomedov',
  'Abusupiyan Magomedov':  'Abus Magomedov',
  // 2026-08-06 (Gamrot vs Salkilld card): DK Sportsbook posts his full legal name
  // "Carlos Diego Ferreira"; UFCStats + the card use "Diego Ferreira". Three
  // tokens vs two, so namesMatch (surname-token based) can't bridge them and the
  // DK SS prop failed to attach — instead of landing on his card it spawned a
  // PHANTOM fighter row with its own PRELIM section, opponent Billy Quarantillo,
  // no record and no history. That is the tell for a missing alias on a
  // book-only line: a duplicate fight card carrying exactly one book's prop.
  'Carlos Diego Ferreira': 'Diego Ferreira',
};

// ── MODEL VERSION ───────────────────────────────────────────────────────
// Bump on ANY change to lean scoring, tiering, correlation passes, or EV math.
// Stamped into Best Picks snapshots (analyzer.ts) and prop predictions
// (PropLinePredictorService) so the Archive can compare accuracy per version.
// Rows without the field predate stamping ≙ v1.
// v2 (2026-07-07): hit-rate shrinkage (Laplace) + backfill projection floor.
// v3 (2026-07-07): EV win prob uses the displayed-confidence pipeline (CLV
//   boost → recalibration) instead of raw conf; Parlay Lab payout-aware slip EV.
// v4 (2026-07-07): FT lean uses DK "To Start Round X" round market as a
//   finish-timing prior — blends with the stat lean and, for no-history fighters,
//   emits a market-only FT lean (bypasses the calcFTLean history<3 gate).
// v5 (2026-07-07): FT prior extended to FINAL-round lines via DK "Fight to Go the
//   Distance" market (pins P(decision)); previously those lines were stat-only.
// v6 (2026-07-07): SS/TD projections duration-adjusted by the market-implied expected
//   fight length (round ladder + distance) — scales the per-fight avg when the fight
//   is priced materially shorter/longer than the fighter's career norm.
// v7 (2026-07-07): DK "Time of Finish" 1-minute finish distribution becomes the
//   preferred source for the FT prior + expected-duration (actual within-round shape
//   instead of uniform); round ladder is the fallback.
// v8 (2026-07-17): Knockdowns (KD) lean source — PrizePicks-only prop, hit-rate-driven
//   (per-fight KD count vs line) + opponent dropped-rate corroboration. Best Picks
//   eligible only when PP offers BOTH sides (standard projection, not demon/goblin).
// v9 (2026-07-22): duration coupling in the Best Picks correlation pass. A volume
//   OVER (SS/R1 SS/TD/CTRL) opposite a finish-driven opponent (≥65% finish rate or
//   ≤7m career average) is demoted 8pts and tagged NEEDS ROUNDS. The prior rule
//   treated opposite-direction same-fight stat picks as the coherent "A outworks B"
//   shape — true when the under side is low output over a full fight, false when it
//   arrives via a finish, which suppresses BOTH fighters' volume together.
// v10 (2026-07-24): opponent-weighted R1 SS projection. calcSSR1Lean blended the
//   fighter's own R1 average with opponent-allowed 50/50; that under-reads a
//   finish-heavy fighter (R1 average deflated by their own early stoppages) against
//   a durable opponent (long avg fight time → fight goes rounds → fighter forced to
//   strike). When fighter finishRate ≥50% AND opponent avgTimeMins ≥11 AND
//   opponent-allowed > the fighter's own R1 avg, opponent-allowed is weighted 0.68.
//   UNVALIDATED pending Davis-vs-Aliev-card results — version stamped so the archive
//   can measure whether v10 improves R1 SS hit-rate.
// v11 (2026-07-24): R1 SS projection-diff recalibration + direction-consistent
//   archetype nudge. The old diff buckets scored a 4-strike R1 gap as "slightly off"
//   (0.6) with a strict `< -4` boundary, and a striker +0.4 prior could then oppose
//   the fighter's own projected direction — so a clean projected-under (Ankalaev
//   proj 14.5 vs line 18.5, Ponzinibbio proj 13.5 vs 15.5) netted inside the neutral
//   band and rendered "NO LEAN". Buckets are now inclusive with a 2-4 mid-tier, and
//   the archetype nudge applies only when it agrees with the projection sign. Result:
//   clean-signal fighters (projection and hit-rate agreeing) now produce directional
//   R1 leans; genuinely split fighters (mean-projection vs hit-rate disagreement, e.g.
//   Guskov/Erceg/Sam) stay honest toss-ups.
// v12 (2026-07-28): Prop Line Predictor SS rebuilt on RATES. The old formula blended
//   `avgSigStr` (per-FIGHT total, deflated by the fighter's own early finishes) with
//   `sapm × 15` (already a per-15-MINUTE rate), then multiplied the blend by
//   `expectedMin / avgHistMin` — applying a duration multiplier to a term that was
//   already duration-normalised. A finisher with a short average fight got scaled
//   2–2.6×: Uros Medic (22.3 avg SS, 3:59 avg fight, career max 69 SS) projected
//   101.5 against a 29.5 opener. Measured across the Ankalaev slate, prediction error
//   correlated −0.50 with average fight length. Now: per-minute rates for both terms,
//   duration applied ONCE, rate clamped to a plausible 0.5–9.0 SS/min band (a single
//   cached 235-SS row implied 15.7/min), `> 0` guards replacing `??` (which does not
//   fall through on 0 — unfetched fighters had slpm/avgSigStr of exactly 0, making the
//   projection purely the opponent's absorbed number; Rzepecki/Vagaev/Tuchalov were
//   the slate's three biggest under-predictions), and the market fight-time line
//   blended 50/50 into expected minutes. Validated against posted UD SS lines on the
//   Ankalaev slate (n=22): MAE 13.9 → 9.2, worst error 34.5 → 32.5. NOTE the learned
//   `ss_pace_modifier` values (0.70–0.90) were fit against the inflated formula and
//   are now stale — expect a residual under-bias (~−3) until the learning cycle
//   re-converges from the corrected base.
// v13 (2026-07-28): market-derived expected duration + pace-modifier renormalisation.
//   (a) New `marketExpectedFightMinutesFromLadder` builds the per-round finish
//   distribution from DK's "Fight to Start Round" ladder and "Go the Distance"
//   market — both FULL-SLATE (26/26 on the Ankalaev card), unlike the Time-of-Finish
//   histogram which is main-event-only. predictSS prefers it at 0.75 weight, then
//   the pick-em FT line, then the career estimate, so it is inert until those
//   markets post mid-fight-week.
//   (b) The learned `ss_pace_modifier` values were an artifact of the pre-v12
//   duration double-count: the learning cycle spent 14 runs pushing them DOWN to
//   damp the inflation, far enough that lightHeavyweight pinned at the 0.70 clamp
//   FLOOR (saturated). With the formula corrected they under-predicted by 3-6 SS, so
//   a one-time renormalisation rescales every class by the same factor to bring
//   `default` back to 1.0 (DEFAULT_WEIGHTS' intent), preserving relative per-class
//   learning. Gated on its own `ssPaceRenormalizedV13` marker — NOT on `version`,
//   which is a learning-run counter.
//   Validated on the Ankalaev slate vs posted UD SS lines (n=22):
//     v12                      MAE 9.2  bias -3.2
//     market duration alone    MAE 8.8  bias -6.6  (net-negative — needs (b))
//     (a)+(b) together         MAE 7.9  bias -0.1
//   Excluding the two known bad-data fighters (Rzepecki: no cached history at all;
//   Zaynukov: a single corrupt 235-SS row), n=20 → MAE 6.6.
// v14 (2026-07-28): damp the career-based duration estimate by 0.87 at source.
//   v13 shipped two halves that offset each other — the pace-modifier renormalisation
//   (×1.228 up) and market-derived duration (×0.866 down) — but the market half is
//   data-gated on DK's round markets, which post mid-fight-week. Before they open,
//   only the uplift is live, so projections ran the full ~23% hot (Medic 39.5 → 48
//   instead of the intended ~42) and would then have DROPPED ~13% the moment DK
//   opened, a pure data-availability artifact. Root cause is that the career estimate
//   over-reads duration (non-finish branch weighted against rounds × 5 with pFinish
//   capped at 0.85): measured 11.16min career vs 9.66min market on the Ankalaev slate.
//   Damping it at source puts every branch on one scale, so predictions are consistent
//   whether or not the markets have posted.
// v15 (2026-07-28): shrink the observed SS rate toward the league mean.
//   An observed SS/min is a noisy estimate of a true rate, and extreme observations
//   carry the most noise, so they regress. Measured WALK-FORWARD over 1,891 fights
//   from 325 cached fighters — rate computed from prior fights only, projected across
//   each fight's ACTUAL duration so the test isolates the rate rather than the
//   duration model:
//     prior rate    mean error (predicted - actual)
//       0-3 SS/min      -6.83   LOW rates were UNDER-predicted
//       3-4             -2.03
//       4-5             +2.51
//       5-6             +5.29
//       6+             +17.45   HIGH rates over-predicted, 72% of the time
//   Regressing actual rate on prior rate gives slope 0.49 (about half of any deviation
//   from the mean evaporates), rising with sample size — 0.28 at 3-5 prior fights,
//   0.70 at 8+ — exactly as regression to the mean predicts. Implemented as
//   empirical-Bayes shrinkage (K = 36 "phantom minutes" at the league mean), NOT the
//   raw linear fit, which over-corrects the low extreme.
//   ONE-SIDED — only rates ABOVE the mean are shrunk. Splitting mean vs median vs
//   trimmed mean shows the tails are not equally supported: the 6+ bucket is
//   +17.45/+16.20/+18.08 (robust however measured) while 0-3 is -6.83/-3.88/-5.30
//   (half the mean is outlier skew). The low-end correction is also contradicted by
//   the live market — it moved Robert Valentin, whose projection matched his posted
//   line almost exactly (22.8 vs 21.5), out to 30.4. Both variants were measured:
//                       actual results (n=1891)      live lines (n=14)
//     v14 no shrink     MAE 20.52  bias +1.61        MAE 7.7  bias +5.5
//     two-sided         MAE 19.79  bias +2.18        MAE 7.7  bias +6.6
//     ONE-SIDED         MAE 19.75  bias -0.31        MAE 7.0  bias +4.9
//   One-sided is better on both metrics and on both datasets; it keeps the whole
//   high-end fix (6+ bucket bias +17.45 -> +4.95) and leaves the weakly-evidenced low
//   end alone. This is the first model change here validated against ACTUAL RESULTS
//   rather than posted lines, which cannot separate "model is wrong" from "book
//   shaded it".
// v17 — same-fight FT correlation completed. calcPairCorrelation's FT branch
//   scored only two of the four (FT direction x volume direction) quadrants;
//   over-FT+under-volume and under-FT+under-volume returned null, i.e. were
//   scored as INDEPENDENT. They are not: FT is the fight's duration, so every
//   stat that accrues while the clock runs is coupled to it. Added
//   over-FT+under-volume = conflict (-0.14, softer than its under-FT+over-volume
//   mirror because a finish hard-caps volume while a long fight only tends to
//   raise it) and under-FT+under-volume = synergy (+0.15). Volume set also
//   widened from {ss,fp} to {ss,fp,td,ctrl}; ss_r1 and kd stay out — R1 SS is
//   capped by one round regardless of duration, and a knockdown tends to END
//   fights, so it moves opposite the rest.
// v18 — cross-book outlier guard on SS/TD lines. plausibleSs/plausibleTd bound
//   each book in isolation, so they catch absurd values but not merely WRONG
//   ones. Darren Elkins (2026-08-06) stored Pick6 SS 5 against UD 14.5 / PP 13.5
//   / BT 13.5 / DK 14.5; 5 clears the `>= 4` floor, and since the lowest line
//   wins for an OVER the line-shop selected it — a fake 9.5-point discount that
//   carried the pick to #1 TOP PICK at Δ+17.2. Raising the floor was rejected:
//   plausibleSs's own comment records a real 5.5 line, so any floor catching
//   this rejects legitimate ones. Now a value below HALF THE MEDIAN of the other
//   books is dropped, requiring 2+ books before judging anything. Bumped because
//   it changes which lines exist, hence which picks reach the archived snapshot.
//   (First cut required 3+ books and immediately let an identical bug through on
//   the same board — Louie Sutherland, Pick6 SS 5 against UD 17.5 with no third
//   book, #4 at +16% EV. Junk scrapes are always LOW, so with two books the low
//   side is the bad one; ordinary shading sits nowhere near half. Kept at 18
//   rather than bumping again: 18 was never pushed, so no released build ever
//   carried the 3-book behaviour.)
// v24 (2026-08-14): CTRL reads opponent-allowed control. It was the only lean
//   that never touched `oppHistory` — FP/SS/TD/FT/R1 SS all blend what the
//   opponent ALLOWS, while CTRL scored off the fighter's own average and
//   inferred the opponent from takedown-defence %. calcCTRLLean now blends
//   50/50 the same way SS does, and the opponent's actual over-rate at THIS
//   line supersedes the tdDef proxy rather than stacking with it.
// v25 (2026-08-14): CTRL scores the moneyline. calcCTRLLean received it and
//   never used it — only calcLean (FP) had a heavy-favourite/heavy-underdog
//   branch. Control time is more win-coupled than FP (a dog can bank fantasy
//   points while losing; he cannot bank sustained top control while losing), so
//   the price belongs in it. Thresholds/magnitudes mirror the FP block: <=-300
//   → +0.8, >=+300 → -0.7.
// v26 (2026-08-14): CTRL is duration-aware. It never called
//   durationAdjustProjection (SS and TD both do), and v24's opp-allowed average
//   was contaminated by fight LENGTH — a fighter who finishes people early
//   "allows" almost no control because his fights end, not because he is hard to
//   control. Both halves of the blend are now expressed against THIS fight's
//   expected minutes: the opponent's allowed control as a SHARE of fight time,
//   the fighter's own average through the standard helper. Each half scaled once.
// (v27–v36 were never logged here; see the git log and RESUME_CHECKPOINT.md.)
// v37 (2026-08-29): SS projection is anchored to the market. Measured over the
//   149 settled SS picks in the snapshot store, calcSSLean's projection ran
//   +6.3 significant strikes above the actual result while the POSTED LINE ran
//   +0.3 — the market is ~20x better centred, and its raw MAE (25.90) beat the
//   projection's (27.29). The projection therefore sat above the line on 68% of
//   picks, which is exactly where the 2:1 OVER volume and the 47% OVER hit rate
//   came from; UNDER, which had to overcome that same +6 handicap before it
//   could fire at all, ran 60%. One bias, not two edges.
//   The fix de-biases by the measured offset and then averages with the line.
//   NOT shrink-toward-the-line alone: scaling preserves the SIGN of the gap, so
//   it cuts volume without touching the direction skew — a sweep had it making
//   the over:under ratio WORSE (2.52 → 4.40 at k=0.5). The pairing below was the
//   only candidate to beat the line-only MAE baseline (25.61 vs 25.90) and it
//   carried the best directional hit rate (59% vs 54% today, breakeven 52.4%)
//   at a near-balanced over:under of 0.81.
//   IN-SAMPLE on n=149: the constants were chosen against the same rows they are
//   scored on, so expect worse than 59% live (Wilson lower bound ~48%). Kept as
//   round numbers rather than 6.32 to limit the overfit. Re-measure after Paris.
// v38 (2026-08-29): the SS ±0.5 tier collapses to a push. It fired a lean at a
//   flat conf 54 off a SINGLE weak factor — "slightly above line" is +0.5 on its
//   own, and so is "striker style". Over the same 149 settled SS picks, conf<=55
//   ran 21/50 = 42% (OVER 40%, UNDER 45%) against a 52.4% breakeven: losing on
//   BOTH sides, and the only cut where the two directions agreed. calcSSR1Lean
//   already collapsed this exact tier — full-fight SS now matches.
//   Stacks with v37, which independently cut the fire count 116 → 85, so SS lean
//   VOLUME will drop sharply. That is intended, but it means v37 and v38 will be
//   measured together after Paris; the 42% above was taken under PRE-v37 scoring
//   and will not carry over unchanged. TD and FT keep their ±0.5 tier — FT runs
//   68% and was never implicated.
// v39 (2026-08-29): the SS hit-rate term is duration-normalised. It asked how often
//   a fighter's PAST fights cleared THIS fight's line using raw h.sigStr, so output
//   from 25-minute main events was compared against a 3-round line as though the
//   fights were the same length. Worth ±2 — the largest term after diff — and the
//   last one still duration-blind, beside a projection that has been duration-
//   adjusted since v6 and market-anchored since v37. Each past fight is now scaled
//   by expMins/thatFightMins, bounded 0.5–1.5 so a 60-second KO is not extrapolated
//   to a full fight; the target is the 3R/5R distortion, not short-fight noise.
//   Falls back per-fight to the raw comparison when timeSecs is missing, so a db
//   without duration data behaves exactly as it did before.
//   calcTDLean carries the same un-normalised pattern and was deliberately NOT
//   changed — TD is n=6 in the archive, far too thin to justify touching.
// v40 (2026-08-30): the prop-line predictor learns against the POSTED LINE.
//   runLearningCycle computed its gradient from `result` — the stat the fighter went
//   on to produce — while the thing it outputs is a LINE. Those are different targets:
//   over 149 settled SS props the posted line sat 0.29 from the eventual result on
//   average, with a mean absolute error of 25.90, so training on the outcome spent the
//   whole gradient chasing ~26 points of variance no book is trying to price. The
//   tuning notes gave it away — v13 cites MAE 7.9, only reachable against a line.
//   Tuned on one target, learned on the other; this reconciles them.
//   effectiveDelta is now `predicted - median opening line` wherever a line was
//   archived, falling back to close, then the old RLM-blended result, then the raw
//   result — so a prop with no archived line behaves exactly as before. The relative-
//   error DENOMINATOR moves to the same scale (marketTarget), or a line-scale
//   numerator over a result-scale denominator would mis-size every weight step.
//   Paired with a read-only backtest (backtestVsPostedLines) that scores stored
//   predictions against posted openers per stat AND per book.
//   NOTE: existing per-fighter trends were EWMA'd on the OLD target and are on the
//   wrong scale. They are deliberately not reset — alpha >= 0.10 washes them out over
//   roughly 7-10 events — but read early post-v40 trend values with that in mind.
// v41 (2026-08-30): predictions are calibrated to what books actually POST.
//   Two facts, both MEASURED from the 39.9k-row archive rather than assumed, and both
//   things eyeballing would have got wrong:
//   GRID — every book posts SS, TD and R1 SS on .50, but FANTASY is book-specific:
//     Betr/Pick6 .50, Underdog .99 (366/366 rows), PrizePicks .55 (100%). A prediction
//     of 63.7 is not postable anywhere; it rounds to 63.5 / 63.99 / 63.55 by book.
//     FightTime is genuinely mixed (.50/.75/.25/.99) so the 80%-consistency gate
//     deliberately refuses to snap it.
//   OFFSET — books disagree with the model by a CONSTANT per stat, which is the
//     correctable half of the error in a way MAE spread is not. Over 10 events FP ran
//     7.8 BELOW the books and SS 4.1 ABOVE.
//   Both are recomputed from the archive at every generation, never frozen: v40 trains
//   against the line too, so the true bias shrinks event over event and this layer must
//   shrink with it. A stored constant would fight the learner.
//   Applied BEFORE the save, so the stored prediction is the calibrated one and Best
//   Picks / EV / parlay maths all read one number rather than re-deriving it.
//   PrizePicks Fantasy is NOT special-cased: its +19.2 gap is the Fantasy_PP scoring
//   basis, and a per-book offset absorbs it — the same reason v33 keeps PP out of FP
//   best-line comparisons. The headline number uses the all-book offset so that gap
//   cannot drag it.
// v42 (2026-08-30): the predictor forecasts ROUND-1 significant strikes.
//   543 archived SS_R1 rows, every single one carrying an openLine, on a clean .50
//   grid at DK / PrizePicks / Underdog — the best-labelled prop that was not being
//   predicted. (CTRL is deliberately NOT added yet: it archives under TWO propTypes
//   and only the 228 `ctrl` rows carry a line at all; the 5,780 `Control` rows are
//   result-only backfill. Revisit once a few more cards accumulate lines.)
//   predictSSR1 does NOT reuse predictSS. Round one is a fixed five minutes, so the
//   v12 rate x expected-minutes apparatus and its v14/v15 corrections do not apply;
//   the only duration term is early-finish risk INSIDE the round.
//   Constants are FITTED. Walk-forward over 3,104 samples from 478 cached fighters
//   (baseline from PRIOR fights only) shows the same regression to the mean the
//   full-fight rate has: raw bucket bias runs -8.25 on low priors to +8.87 on high,
//   a 17-point tilt. Shrinking toward the measured league mean 17.15 with K=10
//   flattens every bucket to within 1.02 and takes MAE 9.47 -> 9.01. As with v15 the
//   MAE gain is small; killing the tilt is the point, since it sits exactly where an
//   OVER would be bet.
//   R1 SS shares ss_pace_modifier and ss_trend (scaled by 0.57, the median R1 share
//   of full-fight SS over 451 paired fighter-events) rather than fitting a second
//   modifier on a fifth of the data. So it learns through the SS signal; its own
//   accuracy is tracked separately in the Predictor vs Posted Lines panel.
// v43 (2026-08-30): SS/TD get the market ties FP has had since v22, and two
//   debutants in one fight stop rendering identical rows.
//   #2 BOOK PRIOR + MARKET ANCHOR FOR SS/TD/R1 SS. computeBookPriorFP and
//     applyMarketAnchor were FP-ONLY, so SS and TD had nothing tying them to how books
//     price a given fighter — the likeliest reason FP tracks the market better (FP MAE
//     17.8 on lines averaging ~85 is proportionally far better than SS 12.6 on ~43).
//     computeBookPrior is the same median-of-posted-lines with the same >=5 sample gate;
//     `books` stays optional because only FP needs a rulebook exclusion (PrizePicks
//     scores fantasy differently), while SS and TD mean the same thing everywhere.
//     The anchor cap is a FRACTION of the fair line (0.18) rather than FP's absolute 15,
//     because TD lines average 1.3 and SS 43 — one absolute cap cannot serve both. 0.18
//     is what FP's 15 already is against its ~85 mean, so all four props share one rule.
//     `shift` comes from bookCalibration, so "fair" means the posted line adjusted by
//     how this model is measured to sit against books.
//   #4 THE DEBUT MIRROR. TD is EXCLUDED — see below. With no history a fighter gets the league prior — and because
//     the OPPONENT also has none, the "opponent allows" term is the league default too,
//     so both sides came out byte-identical (Aljarouj and Sintes: SS 47.5 / R1 SS 22.5 /
//     TD 0.5 / FP 73.5 / conf 53%). Books separate them on price. Measured on POSTED
//     OPENING LINES: favourites are priced above underdogs by SS +13.4 (n=266), FP +16.0
//     (n=94), R1 SS +4.7 (n=77), TD +0.2 (n=75). Deliberately measured on LINES, not
//     results — on results the same split reads +24.2 SS, but favourites win more and
//     winners fight longer, so the outcome gap is about double what books actually
//     price and would over-separate. HALF the gap goes to each side, so the pair's
//     midpoint stays on the league prior: it separates the two without moving the level
//     of the fight. TD is dropped: its 0.2 gap is SMALLER than the 0.5 grid TD lines are
//     posted on, so it cannot express itself and the 0.5 floor breaks the midpoint
//     symmetry the other three keep. Fires ONLY with zero history, since a record already
//     encodes their level and would be double-counted.
// v44 (2026-09-01): the v43 market-anchor shift was NEGATED for SS/TD/R1 SS.
//   bookCal.global[stat] is (predicted - posted) and applyMarketAnchorFor computes
//   `fair = postedLine + shift` against a line still on the MODEL scale, which
//   calibrateToBooks then de-biases by the same offset. Passing -S made the fair
//   reference P - S instead of P + S, so the offset was applied TWICE in the same
//   direction and the reachable band became [P - 2S - cap, P - 2S + cap]: an anchored
//   line could never finish above the posted one. Corrected to +S, which puts the
//   finished band symmetrically at [P - cap, P + cap].
//   MEASURED ON THE BOARD, not read off the code: `fair` is quoted verbatim in every
//   anchor reason and sat exactly S below the posted line on all 10 anchored rows
//   (Hooker fair 24.2 / book 27.5, Charriere 33.2 / 36.5, with S = 3.3). 8 of 9
//   SHIPPED lines sat at or below the book, and the two rows with the strongest
//   duration-normalised OVER history — Hooker 67%, Peek 100% — were pushed UNDER.
//   SCOPE: predictor path only. Best Picks leans come from calcSSLean, which never
//   reads PropPrediction, so no pick was affected. What was affected is the displayed
//   line, the Δ BOOK chips, PREDICTOR VS POSTED LINES, and runLearningCycle's target.
//   THE BUMP MATTERS AS MUCH AS THE FIX: only one board was ever generated under v43
//   (Hooker vs. Parnasse, 2026-09-01) and it never settled, so nothing learned from a
//   wrong-signed line. Bumping to 44 keeps v43-anchored rows distinguishable in the
//   archive — every diagnosis this session depended on knowing which model version
//   produced a stored line.
export const MODEL_VERSION = 44;

// MODEL v37 · SS market anchor. See the v37 note above for the measurement.
/** Strikes the raw SS projection runs above reality, removed before anchoring. */
export const SS_PROJECTION_BIAS = 6;
/** Weight on the de-biased projection vs the posted line (0.5 = plain average). */
export const SS_MARKET_ANCHOR_WEIGHT = 0.5;

// Ceiling on the FP predictor's confidence score. Exported because the
// predictions panel needs to know when a 92 is an EARNED 92 and when it is the
// clamp — on a typical card roughly a third of the board sits exactly here, and
// a gauge that renders the cap identically to a genuine top score is claiming a
// distinction the number does not make. Keep in step with the clamp in
// PropLinePredictorService.predictFantasyPoints.
export const FP_CONFIDENCE_CEILING = 92;

// ── PICK-EM PAYOUT TABLES ───────────────────────────────────────────────
// Stake-inclusive multiplier by slip size: byLegs[legCount][hitCount] → payout.
// Standard published tables — VERIFY IN-APP before big slips; promos, boosts,
// and state rules shift them. Betr and Pick6 are intentionally absent until
// their multipliers are confirmed in-app; adding an entry here is all it takes
// to light them up in Parlay Lab's slip EV row.
export const PICKEM_PAYOUTS: Record<string, { label: string; byLegs: Record<number, Record<number, number>> }> = {
  ud_standard: { label: 'UD', byLegs: {
    2: { 2: 3 }, 3: { 3: 6 }, 4: { 4: 10 }, 5: { 5: 20 },
  } },
  pp_power: { label: 'PP Power', byLegs: {
    2: { 2: 3 }, 3: { 3: 5 }, 4: { 4: 10 }, 5: { 5: 20 }, 6: { 6: 37.5 },
  } },
  pp_flex: { label: 'PP Flex', byLegs: {
    3: { 3: 2.25, 2: 1.25 },
    4: { 4: 5, 3: 1.5 },
    5: { 5: 10, 4: 2, 3: 0.4 },
    6: { 6: 25, 5: 2, 4: 0.4 },
  } },
};
