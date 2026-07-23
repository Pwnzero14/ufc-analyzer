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
    // Platforms use her given name "Beatriz"; UFCStats fighter page is "Bia Mesquita".
    'Beatriz Mesquita': 'Bia Mesquita',
    // UFCStats lists these two Magomedovs by short first names (Shara / Abus); the
    // platforms + card use the full legal first names. Canonicalize so card-match,
    // the UFCStats history fetch, and settle all agree — and so the two Magomedovs on
    // the same card (Fiziev/Torres) stay distinct fighters.
    'Sharabutdin Magomedov': 'Shara Magomedov',
    'Abusupiyan Magomedov': 'Abus Magomedov',
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
export const MODEL_VERSION = 9;
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