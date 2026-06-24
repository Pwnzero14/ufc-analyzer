// ── FIGHTER DATA ──────────────────────────────────────────────────────────
export interface Fighter {
  name: string;
  line_fp?: number | null;
  line_ss?: number | null;
  line_ss_r1?: number | null;  // Round 1 significant strikes (PrizePicks + Underdog)
  line_ss_body?: number | null;  // Significant body strikes (PrizePicks + Underdog)
  line_ss_leg?: number | null;   // Significant leg strikes (PrizePicks + Underdog)
  line_td?: number | null;
  line_ft?: number | null;
  // Control time line, stored in minutes for parity with FT (UFCStats shows mm:ss)
  line_ctrl?: number | null;
  opponent?: string | null;
  capturedAt?: number;
  // Side odds can be American (e.g., -110, +100) or payout multipliers (e.g., 0.66x, 1.34x)
  ss_over_odds?: number | null;
  ss_under_odds?: number | null;
  td_over_odds?: number | null;
  td_under_odds?: number | null;
  ft_over_odds?: number | null;
  ft_under_odds?: number | null;
  ctrl_over_odds?: number | null;
  ctrl_under_odds?: number | null;
  // Pick6-specific: whether the card offers a "Less" button for CTRL. Some fighters
  // only get a More/OVER side. Default undefined = unknown (treat as unavailable).
  ctrl_under_available?: boolean | null;
  // Pick6-specific: same Less-button check for SS/TD props, which are also frequently
  // More/OVER-only (e.g. low takedown lines at 0.5/1.5 — no Less side offered).
  // true = Less button present, false = More-only, null = unknown (pre-flag/stale).
  ss_under_available?: boolean | null;
  td_under_available?: boolean | null;
  // Pick6-specific: same Less-button check for the Fantasy Points prop. Underdogs are
  // given a More/OVER-only FP prop (no Less side), so this is the authoritative
  // placeability signal for FP UNDERs — independent of the (often-incomplete)
  // moneyline odds map. true = Less present, false = More-only, null = unknown.
  fp_under_available?: boolean | null;
  // Underdog-specific: per-side availability for SS/TD/FT lines. UD pick-em is
  // often one-sided (only Higher offered). true = UD surfaced this side,
  // false = UD has the line but didn't offer this side, null = no UD line at all.
  // Used by Best Picks to drop UD-tagged candidates for sides that aren't tappable.
  ud_ss_over_avail?: boolean | null;
  ud_ss_under_avail?: boolean | null;
  ud_td_over_avail?: boolean | null;
  ud_td_under_avail?: boolean | null;
  ud_ft_over_avail?: boolean | null;
  ud_ft_under_avail?: boolean | null;
}

// ── PLATFORM LINES ────────────────────────────────────────────────────────
export interface PlatformLines {
  fighters: Fighter[];
  capturedAt?: number;
}

export interface AllLines {
  pick6?: PlatformLines;
  underdog?: PlatformLines;
  betr?: PlatformLines;
  prizepicks?: PlatformLines;
  draftkings_sportsbook?: PlatformLines;
}

// ── FIGHT HISTORY ─────────────────────────────────────────────────────────
export interface FightResult {
  opp: string;
  fp?: number | null;
  fp_p6?: number | null;
  fp_ud?: number | null;
  sigStr?: number | null;
  sigStrR1?: number | null; // sig strikes landed in round 1 only
  sigStrBody?: number | null; // significant body strikes landed (all rounds)
  sigStrLeg?: number | null;  // significant leg strikes landed (all rounds)
  totStr?: number | null;
  ctrlSecs?: number | null;
  timeSecs?: number | null;
  td?: number | null;
  kd?: number | null;
  rev?: number | null;
  sub?: number | null; // submission attempts (PrizePicks scoring: 4pts each)
  method?: string;
  result?: string; // 'win' | 'loss'
  date?: string;
  round?: number;
  oppStats?: FightStats | null;
}

export interface FightStats {
  sigStr?: number | null;
  sigStrR1?: number | null;
  sigStrBody?: number | null;
  sigStrLeg?: number | null;
  totStr?: number | null;
  ctrlSecs?: number | null;
  kd?: number | null;
  td?: number | null;
  rev?: number | null;
  sub?: number | null;
}

export interface CareerStats {
  slpm?: number | null;
  sapm?: number | null;
  strAcc?: number | null;
  strDef?: number | null;
  tdAvg?: number | null;
  tdAcc?: number | null;
  tdDef?: number | null;
  subAvg?: number | null;
  record?: string;
  height?: string;
  stance?: string;
}

export interface Streak {
  type: 'hot' | 'cold' | 'neutral';
  count: number;
  text: string;
}

export interface OppFightResult {
  opp: string | null;
  fp: number | null;
  sigStr: number | null;
  sigStrR1?: number | null;
  sigStrBody?: number | null;
  sigStrLeg?: number | null;
  totStr: number | null;
  td: number | null;
  kd: number | null;
  sub?: number | null;
  ctrlSecs: number | null;
}

export interface FighterDB {
  record: string;
  country: string;
  avgFP?: number | null;
  avgFP_p6?: number | null;
  avgFP_ud?: number | null;
  avgFP_pp?: number | null;
  avgFP_betr?: number | null;
  avgSigStr?: number | null;
  avgTD?: number | null;
  avgTDperFight?: number | null;
  slpm?: number | null;
  sapm?: number | null;
  strAcc?: number | null;
  strDef?: number | null;
  tdDef?: number | null;
  tdAcc?: number | null;
  stance?: string | null;
  style: 'striker' | 'grappler' | 'balanced';
  finishRate?: number | null;
  // Analytics metrics
  avgFP_weighted?: number | null;
  fpFloor?: number | null;
  fpCeiling?: number | null;
  fpStdDev?: number | null;
  fpConsistency?: number | null;
  fpMedian?: number | null;
  ssStdDev?: number | null;
  avgTimeMins?: number | null;
  avgCtrlSecs?: number | null;
  avgFP_perRound?: number | null;
  streak?: Streak;
  fiveRoundRate?: number;
  history: FightResult[];
  oppHistory: OppFightResult[];
  loaded: boolean;
  detailUrl?: string | null;
}

// ── LINE DROP STATE ───────────────────────────────────────────────────────
export interface LineDropState {
  watching: boolean;
  lastP6Count: number;
  lastUDCount: number;
  lastUDFPCount?: number;
  detectedAt?: number | null;
  eventDate?: string | null;
  eventName?: string | null;
  detectedUD?: number | null;
  detectedUDFP?: number | null;
  detectedP6?: number | null;
  lastPollAt?: number | null;
  daysUntil?: number;
  _currentPollMins?: number;
}

export interface LineDrop {
  platform: string;
  type: string;
  count: number;
}

export type LineDirection = 'drop' | 'rise' | 'both';
export type WatchedStatType = 'fp' | 'ss' | 'td';
export type WatchPlatform = 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'dk';

export interface LineWatchSettings {
  enabled: boolean;
  direction: LineDirection;
  threshold: number;
  watchPlatforms: WatchPlatform[];
  watchStats: WatchedStatType[];
  fighterAllowList: string[];
  detectStealth: boolean;
  detectSteam: boolean;
  playSound: boolean;
}

export interface LineMovementEvent {
  id: string;
  timestamp: number;
  fighter: string;
  platform: WatchPlatform;
  stat: WatchedStatType;
  from: number;
  to: number;
  delta: number;
  direction: 'drop' | 'rise';
  stealth?: boolean;
  steam?: boolean;
  valueSpike?: boolean;
  // Reverse line movement proxy. On pick-em platforms public money hammers
  // OVER on FP/SS/TD/FT — so a line rising against that flow is a sharp-UNDER
  // signal, and a line dropping hard on an unpopular UNDER side is a sharp-OVER
  // signal. Set by LineDropService.detectEvents when the heuristic fires.
  rlm?: 'under' | 'over';
  rlmReason?: string;
  notes?: string;
}

export interface LineDropAlert {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
  events: LineMovementEvent[];
}

export interface FighterLineHistory {
  fighter: string;
  stat: WatchedStatType;
  points: Array<{ timestamp: number; value: number; platform: WatchPlatform }>;
}

// ── LINE HISTORY ─────────────────────────────────────────────────────────
/** Compact snapshot point: one timestamp with per-platform values */
export interface LineHistoryPoint {
  t: number;                     // timestamp ms
  v: Record<string, number>;     // platform abbrev -> value e.g. { p6: 23, ud: 22.5 }
}

/** Persisted line history for an entire event */
export interface LineHistoryStore {
  eventKey: string;
  updatedAt: number;
  /** Keys: "fighter_name_lower|stat" -> array of timestamped snapshots */
  series: Record<string, LineHistoryPoint[]>;
}

// ── UPCOMING CARD ─────────────────────────────────────────────────────────
export type WeightClass =
  | 'flyweight'
  | 'bantamweight'
  | 'featherweight'
  | 'lightweight'
  | 'welterweight'
  | 'middleweight'
  | 'lightHeavyweight'
  | 'heavyweight'
  | 'womenStrawweight'
  | 'womenFlyweight'
  | 'womenBantamweight'
  | 'womenFeatherweight';

export interface UFCFight {
  f1: string;
  f2: string;
  scheduledRounds?: number;
  weightClass?: WeightClass;
}

export interface UpcomingCard {
  event: string;
  date: string;
  url: string;
  fighters: UFCFight[];
  fetchedAt: number;
  location?: string;
}

// ── SCRAPER RESULTS ───────────────────────────────────────────────────────
export interface ScraperResult {
  platform: string;
  fighters: Fighter[];
  error?: string;
}

export interface AutoScrapeResult {
  status: 'done' | 'already_running';
  results?: Record<string, number>;
}

// ── ERROR HANDLING ────────────────────────────────────────────────────────
export interface AppError {
  code: string;
  message: string;
  platform?: string;
  timestamp: number;
  severity: 'debug' | 'warn' | 'error';
}

// ── PROP ARCHIVE ─────────────────────────────────────────────────────────
export type PropType =
  | 'Fantasy'      // Pick6/Underdog/Betr scoring (sigStr×0.4, td×5, kd×10, R1=90, dec=30, etc.)
  | 'Fantasy_PP'   // PrizePicks scoring (sigStr×0.5, sub×4, td×5, kd×10, R1=50, dec=10, no quick-finish)
  | 'SS'
  | 'SS_R1'        // Significant strikes in round 1 only (PrizePicks + Underdog)
  | 'TD'
  | 'Control'
  | 'FightTime'
  | (string & {});

export interface PropArchiveRecord {
  fighter: string;
  opponent: string;
  event: string;
  date: string; // ISO
  platform?: string;
  propType: PropType;
  line?: number;
  // First line observed for this record (opening). Captured on first insert; never overwritten.
  // Paired with `line` (closing / latest) to compute market CLV = line - openLine.
  openLine?: number;
  result: number;
}

// ── PROP LINE PREDICTOR ─────────────────────────────────────────────────

export interface StatPrediction {
  line: number;
  lean: 'over' | 'under';
  confidence: number;
  reasons: string[];
}

export interface PropPrediction {
  fighter: string;
  opponent: string;
  scheduledRounds: number;
  weightClass?: WeightClass;
  ss: StatPrediction;
  td: StatPrediction;
  fantasy: StatPrediction;
}

export interface PredictionEvent {
  event: string;
  date: string;           // ISO
  generatedAt: number;    // timestamp
  predictions: PropPrediction[];
  settled: boolean;
}

// Per-weight-class calibration bucket. `default` is the fallback when the class is
// unknown or has never been sampled in the learning cycle. Class-specific entries are
// written lazily as the learning cycle observes bias per class.
export interface PerClassModifier {
  default: number;
  flyweight?: number;
  bantamweight?: number;
  featherweight?: number;
  lightweight?: number;
  welterweight?: number;
  middleweight?: number;
  lightHeavyweight?: number;
  heavyweight?: number;
  womenStrawweight?: number;
  womenFlyweight?: number;
  womenBantamweight?: number;
  womenFeatherweight?: number;
}

export interface PredictorWeights {
  ss_pace_modifier: PerClassModifier;
  td_attempt_modifier: PerClassModifier;
  fp_global_modifier: PerClassModifier;
  fp_ss_weight: number;
  fp_td_weight: number;
  fp_ctrl_weight: number;
  fp_kd_weight: number;
  fp_win_weight: number;
  version: number;
}

export interface FighterTrend {
  fighter: string;
  ss_trend: number;
  td_trend: number;
  fp_trend: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface LearningPredictionResult {
  fighter: string;
  weightClass?: WeightClass;
  predicted: { ss: number; td: number; fp: number };
  actual: { ss: number; td: number; fp: number };
  delta: { ss: number; td: number; fp: number };
  // RLM-blended delta used by calibration when the closing line moved meaningfully
  // from open. Equals `delta` when no significant RLM was observed. UI should
  // display `actual` and `delta` (raw); calibration code reads `effectiveDelta`.
  effectiveDelta?: { ss: number; td: number; fp: number };
}

export interface LearningSummary {
  avgAbsDeltaSS: number;
  avgAbsDeltaTD: number;
  avgAbsDeltaFP: number;
  bestPrediction: string;
  worstPrediction: string;
  // Per-class deltas applied this event, keyed by modifier name (e.g. "ss_pace_modifier.lightweight").
  weightAdjustments: Record<string, number>;
  trendUpdates: number;
}

export interface LearningResult {
  event: string;
  date: string;
  learnedAt: number;
  predictions: LearningPredictionResult[];
  summary: LearningSummary;
}
