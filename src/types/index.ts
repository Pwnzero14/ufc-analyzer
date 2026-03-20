// ── FIGHTER DATA ──────────────────────────────────────────────────────────
export interface Fighter {
  name: string;
  line_fp?: number | null;
  line_ss?: number | null;
  line_td?: number | null;
  opponent?: string | null;
  capturedAt?: number;
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
}

// ── FIGHT HISTORY ─────────────────────────────────────────────────────────
export interface FightResult {
  opp: string;
  fp?: number | null;
  fp_p6?: number | null;
  fp_ud?: number | null;
  sigStr?: number | null;
  totStr?: number | null;
  ctrlSecs?: number | null;
  timeSecs?: number | null;
  td?: number | null;
  kd?: number | null;
  rev?: number | null;
  method?: string;
  result?: string; // 'win' | 'loss'
  date?: string;
  round?: number;
  oppStats?: FightStats | null;
}

export interface FightStats {
  sigStr?: number | null;
  totStr?: number | null;
  ctrlSecs?: number | null;
  kd?: number | null;
  td?: number | null;
  rev?: number | null;
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
  totStr: number | null;
  td: number | null;
  kd: number | null;
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
export type WatchPlatform = 'pick6' | 'underdog' | 'betr' | 'prizepicks';

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

// ── UPCOMING CARD ─────────────────────────────────────────────────────────
export interface UFCFight {
  f1: string;
  f2: string;
}

export interface UpcomingCard {
  event: string;
  date: string;
  url: string;
  fighters: UFCFight[];
  fetchedAt: number;
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
