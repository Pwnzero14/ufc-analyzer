// ── CONFIGURATION ────────────────────────────────────────────────────────
// Centralized config for platforms, selectors, API endpoints, and constants

export const CONFIG = {
  platforms: {
    pick6: {
      id: 'pick6',
      label: 'Pick6 (DraftKings)',
      color: '#63b3ed',
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
