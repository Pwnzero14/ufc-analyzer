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
            midWindow: { daysUntil: 4, intervalMinutes: 30 }, // Monday
            wednesdayWindow: { daysUntil: 2.5, intervalMinutes: 15 }, // Wed
            lateWindow: { daysUntil: 0, intervalMinutes: 5 }, // Thu-Fri
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
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        defaultTimeout: 15000,
    },
    // ── LOG LEVELS ────────────────────────────────────────────────────────
    logging: {
        debug: false, // Set to true for verbose logs
        prefix: '[UFC]',
    },
};
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
    sigStrike: 0.4, // counts as strike 0.2 + sig strike 0.2
    nonSigStrike: 0.2,
    controlTimePerSec: 0.03,
    takedown: 5,
    reversal: 5,
    knockdown: 10,
    quickWinBonus: 25, // R1 finish in ≤60 seconds
    winBonus: {
        round1: 90,
        round2: 70,
        round3: 45,
        round4Plus: 40,
        decision: 30,
    },
};
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
        round4Plus: 20, // 4th and 5th round wins both score 20
        decision: 10,
    },
};
// ── FIGHTER NAME ALIASES ───────────────────────────────────────────────
// Platform spelling (key) → UFCStats canonical form (value). Keys are written
// in the title-cased shape analyzer's normalizeName produces; both sides are
// re-normalized by each consumer before use, so casing/spacing here is just for
// readability. Shared by analyzer.ts (normalizeName) and the settle path in
// background.ts so card-pair matching, opponent resolution, and archive
// settlement all agree on one canonical name. Add new entries when a platform
// lists a fighter in a different order/spacing than UFCStats.
export const NAME_ALIASES = {
    'Jung Young Lee': 'Jeongyeong Lee',
    'Jungyoung Lee': 'Jeongyeong Lee',
    'Su Sumudaerji': 'Su Mudaerji',
    'Sumudaerji Su': 'Su Mudaerji',
    'Sumudaerji': 'Su Mudaerji',
    // Chinese / Asian fighters where platforms (UD, Pick6) use one order/spacing
    // and UFCStats uses another. Right-hand side mirrors the UFCStats canonical
    // form on the event page.
    'Yadong Song': 'Song Yadong',
    // UFCStats writes "YiSak Lee" with an internal capital S. normalizeName
    // title-cases each word ("Yisak Lee"), so the canonical form is "Yisak Lee".
    'Yi Sak Lee': 'Yisak Lee',
    'Qileng Aori': 'Aoriqileng',
    'Aori Qileng': 'Aoriqileng',
    'Aori Aoriqileng': 'Aoriqileng',
    'Harris Carlston': 'Carlston Harris',
    'Xiong Jing Nan': 'Xiong Jingnan',
    // Reverse-order variants: platforms sometimes list Chinese fighters in
    // Western order (given-family) while UFCStats uses Chinese order (family-given).
    'Kangjie Zhu': 'Zhu Kangjie',
    'Meng Ding': 'Ding Meng',
    'Mingyang Zhang': 'Zhang Mingyang',
    'Jingnan Xiong': 'Xiong Jingnan',
    // UFC 329: Pick6 lists her Chinese-order "Wang Cong" (family Wang) while
    // UD/PP/Betr use Western-order "Cong Wang" — the mismatch split her into a real
    // card + a ghost and broke opponent/moneyline resolution (Tracy Cortez's dog-FP
    // gate). normalizeName applies this so all platforms + settle collapse to one key.
    'Cong Wang': 'Wang Cong',
    // 2026-07-23 (Davis vs Aliev card): UD/PP truncate "Muhammad Saidov" (the
    // UFCStats card + Pick6 canonical) to "Muhammad Said". Different surname token,
    // so namesMatch can't merge them — his UD/PP/Betr lines split off the Pick6
    // card, leaving it "1 of 26 without lines". normalizeName collapses both.
    'Muhammad Said': 'Muhammad Saidov',
    'Damon Jackson': 'Donte Johnson',
    'Myktybek Orolbai': 'Myktybek Orolbai Uulu',
    'Orolbai': 'Myktybek Orolbai Uulu',
    'Kevin Vallejos': 'Kevin Vallejos',
    'Jose Miguel Delgado': 'Jose Delgado',
    'Jose M Delgado': 'Jose Delgado',
    'Patricio Freire': 'Patricio Pitbull',
    'Patricio Pitbull Freire': 'Patricio Pitbull',
    'Loopy Godinez': 'Lupita Godinez',
    'Paulo Henrique Costa': 'Paulo Costa',
    'Paulo Henrique Da Silva Costa': 'Paulo Costa',
    'Christopher Padilla': 'Chris Padilla',
    'Azamat Murazakov': 'Azamat Murzakanov',
    'A Murazakov': 'Azamat Murzakanov',
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
    'Yadier Delvalle': 'Yadier Del Valle',
    // Platforms use her given name "Beatriz"; UFCStats fighter page is "Bia Mesquita".
    'Beatriz Mesquita': 'Bia Mesquita',
    // UFCStats lists these two Magomedovs by short first names (Shara / Abus); the
    // platforms + card use the full legal first names. Canonicalize so card-match,
    // the UFCStats history fetch, and settle all agree — and so the two Magomedovs on
    // the same card (Fiziev/Torres) stay distinct fighters.
    'Sharabutdin Magomedov': 'Shara Magomedov',
    'Abusupiyan Magomedov': 'Abus Magomedov',
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
export const MODEL_VERSION = 28;
// ── PICK-EM PAYOUT TABLES ───────────────────────────────────────────────
// Stake-inclusive multiplier by slip size: byLegs[legCount][hitCount] → payout.
// Standard published tables — VERIFY IN-APP before big slips; promos, boosts,
// and state rules shift them. Betr and Pick6 are intentionally absent until
// their multipliers are confirmed in-app; adding an entry here is all it takes
// to light them up in Parlay Lab's slip EV row.
export const PICKEM_PAYOUTS = {
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
//# sourceMappingURL=index.js.map