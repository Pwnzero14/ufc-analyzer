import { FighterDB, FightResult, FightStats, CareerStats } from './types/index.js';
import type { LineWatchSettings, LineMovementEvent, WatchPlatform, WatchedStatType } from './types/index.js';
import { FANTASY_SCORING } from './config/index.js';
import { PropArchiveService } from './services/index.js';
import type { PropArchiveRecord } from './types/index.js';

// ── LOCAL TYPES ────────────────────────────────────────────────────────────
interface LeanReason { icon: 'pos' | 'neg' | 'neu'; text: string }
interface LeanResult { 
  lean: 'over'|'under'|'push'|'none'; 
  conf: number; 
  score?: number; 
  reasons: LeanReason[]; 
  verdict: string; 
  avg?: number; 
  line?: number; 
  type?: string; 
  ev?: number;
  // New enhanced prediction fields
  ensembleAgreement?: number;
  bayesianProbability?: number;
  calibratedProbability?: number;
  optimizedLine?: number;
  timeWeightedAvg?: number;
  kellyBetSize?: number;
}
interface EffectiveLean extends LeanResult { _source: 'fp'|'ss'|'td'|'ft'; _label: string }
interface OppStats { oppName?: string|null; kd?: number|null; sigStr?: number|null; totStr?: number|null; td?: number|null; ctrlSecs?: number|null }
interface UFCFightHistory { result: string; opponent: string; event: string; method: string; round: number|null; date: string|null; kd?: number|null; sigStr?: number|null; totStr?: number|null; td?: number|null; sub?: number|null; rev?: number|null; ctrlSecs?: number|null; timeSecs?: number|null; oppStats?: OppStats|null; fightUrl?: string }
interface UFCStatsData { name: string; fetchedAt: number; careerStats: CareerStats; fightHistory: UFCFightHistory[]; detailUrl: string }
interface NameCandidate { char: string; first: string; last: string }
interface AnalyzerFighter { name: string; line_p6?: number|null; line_p6_ss?: number|null; line_p6_td?: number|null; line_p6_ft?: number|null; line_ud?: number|null; line_ud_ss?: number|null; line_ud_td?: number|null; line_ud_ft?: number|null; line_betr?: number|null; line_betr_ss?: number|null; line_betr_td?: number|null; line_betr_ft?: number|null; line_pp?: number|null; line_pp_ss?: number|null; line_pp_td?: number|null; line_pp_ft?: number|null; line_dk_ss?: number|null; line_dk_td?: number|null; line_dk_ft?: number|null; ss_over_odds?: number|null; ss_under_odds?: number|null; td_over_odds?: number|null; td_under_odds?: number|null; ft_over_odds?: number|null; ft_under_odds?: number|null; moneyline?: number|null; opponent?: string|null; db: FighterDB; lean: LeanResult; lean_ss?: LeanResult|null; lean_td?: LeanResult|null; lean_ft?: LeanResult|null }

function createEmptyLean(verdict = ''): LeanResult {
  return { lean: 'none', conf: 0, reasons: [], verdict };
}

function createPlaceholderAnalyzerFighter(name: string, opponent: string): AnalyzerFighter {
  return {
    name,
    line_p6: null,
    line_p6_ss: null,
    line_p6_td: null,
    line_p6_ft: null,
    line_ud: null,
    line_ud_ss: null,
    line_ud_td: null,
    line_ud_ft: null,
    line_betr: null,
    line_betr_ss: null,
    line_betr_td: null,
    line_betr_ft: null,
    line_pp: null,
    line_pp_ss: null,
    line_pp_td: null,
    line_pp_ft: null,
    // Removed duplicate line_dk_ft property
    moneyline: null,
    opponent,
    db: { loaded: false } as FighterDB,
    lean: createEmptyLean(),
    lean_ss: null,
    lean_td: null,
    lean_ft: null,
      line_dk_ss: null,
      line_dk_td: null,
      line_dk_ft: null,
  };
}

// ── MODULE STATE ───────────────────────────────────────────────────────────
const debugMessages: string[] = [];
const statsCache: Record<string, FighterDB> = {};
const statsCachePromises: Record<string, Promise<FighterDB>> = {};

let currentView = 'all';
let currentPlatform = 'pick6';
let allFighters: AnalyzerFighter[] = [];
let _leanCache: Map<string, EffectiveLean> | null = null;
let _fighterByNorm: Map<string, AnalyzerFighter> | null = null;
let fightOddsMoneylineByName: Record<string, number> = {};
let currentSearch = '';
let currentSort = 'default';
let sourceVisibility: Record<'p6'|'ud'|'pp'|'betr'|'dk', boolean> = {
  p6: true,
  ud: true,
  pp: true,
  betr: true,
  dk: true,
};
let currentDensity: 'compact'|'detailed' = 'detailed';
let currentHistoryDensity: 'compact'|'readable' = 'compact';
let recentLineMoves: LineMovementEvent[] = [];
let latestValueSpikeByFighter: Record<string, LineMovementEvent> = {};
let isDataLoadInFlight = false;
let queuedDataReload = false;
let bestPicksRenderSeq = 0;
let eventCountdownTimer: ReturnType<typeof setInterval>|null = null;
let periodicRefreshTimer: ReturnType<typeof setInterval>|null = null;
let upcomingCardPairs: Array<{ f1: string; f2: string }> = [];
let upcomingEventName: string = '';
let inferredEventNameFromLines: string = '';

type UpcomingCardFighter = { f1: string; f2: string };
type UpcomingCard = { event?: string; date?: string; fighters?: UpcomingCardFighter[]; fetchedAt?: number; url?: string };
type UpcomingCardResponse = { card?: UpcomingCard | null };

function buildEventDisplayName(event: string, fighters: Array<{ f1: string; f2: string }> | undefined): string {
  const pair = fighters?.[0];
  if (!pair) return event;
  const lastName = (s: string) => s.trim().split(/\s+/).pop() || s;
  return `${event}: ${lastName(pair.f1)} vs. ${lastName(pair.f2)}`;
};

function strictCardNameMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const aParts = na.split(' ');
  const bParts = nb.split(' ');
  if (aParts.length < 2 || bParts.length < 2) return false;
  const aFirst = aParts[0];
  const aLast = aParts[aParts.length - 1];
  const bFirst = bParts[0];
  const bLast = bParts[bParts.length - 1];
  if (aLast !== bLast) return false;
  return aFirst[0] === bFirst[0] && (aFirst.length >= 3 || bFirst.length >= 3);
}

function findOpponentFromUpcomingCard(name: string): string|null {
  for (const pair of upcomingCardPairs) {
    if (strictCardNameMatch(name, pair.f1)) return pair.f2;
    if (strictCardNameMatch(name, pair.f2)) return pair.f1;
  }
  return null;
}

function isUpcomingCardFighter(name: string | null | undefined): boolean {
  if (!name || !upcomingCardPairs.length) return false;
  return upcomingCardPairs.some((pair) => strictCardNameMatch(name, pair.f1) || strictCardNameMatch(name, pair.f2));
}

function filterPayloadToUpcomingCard(payload: PlatformLinesPayload | null | undefined): PlatformLinesPayload | null {
  if (!payload?.fighters?.length || !upcomingCardPairs.length) return payload || null;
  const fighters = payload.fighters.filter((fighter) => {
    const fighterName = normalizeName(String(fighter?.name || ''));
    const opponentName = normalizeName(String(fighter?.opponent || ''));
    if (isUpcomingCardFighter(fighterName)) return true;
    if (opponentName && isUpcomingCardFighter(opponentName)) return true;
    return false;
  });
  // Safety: if matching is too sparse, the cached card is likely stale and would hide valid lines.
  // In that case pass through unfiltered instead of showing a misleading tiny subset.
  const matchRatio = fighters.length / Math.max(1, payload.fighters.length);
  if (fighters.length === 0 || matchRatio < 0.5) return payload;
  return { ...payload, fighters };
}

function pruneOrphanFighters(payload: PlatformLinesPayload | null | undefined): PlatformLinesPayload | null {
  if (!payload?.fighters?.length) return payload || null;
  // Only prune on larger slates where orphan rows are almost always stale carry-over.
  if (payload.fighters.length < 10) return payload;
  const fighters = payload.fighters.filter((fighter) => {
    const name = normalizeName(String(fighter?.name || ''));
    const opponent = normalizeName(String(fighter?.opponent || ''));
    if (!name) return false;
    return !!opponent;
  });
  if (!fighters.length) return payload;
  return { ...payload, fighters };
}

function inferEventNameFromPayloads(payloads: Array<PlatformLinesPayload | null | undefined>): string {
  const pairCounts = new Map<string, { a: string; b: string; count: number }>();
  for (const payload of payloads) {
    for (const f of payload?.fighters || []) {
      const a = normalizeName(String(f?.name || ''));
      const b = normalizeName(String(f?.opponent || ''));
      if (!a || !b || a === b) continue;
      const names = [a, b].sort((x, y) => x.localeCompare(y));
      const key = `${names[0]}|${names[1]}`;
      const hit = pairCounts.get(key);
      if (hit) hit.count += 1;
      else pairCounts.set(key, { a: names[0], b: names[1], count: 1 });
    }
  }

  let best: { a: string; b: string; count: number } | null = null;
  for (const v of pairCounts.values()) {
    if (!best || v.count > best.count) best = v;
  }
  if (!best || best.count < 2) return '';
  return `UFC Fight Night: ${best.a} vs ${best.b}`;
}

function isUsableUpcomingCard(card: UpcomingCard | null | undefined): card is UpcomingCard {
  if (!card || !card.date) return false;
  const ts = parseEventDateMs(card.date);
  if (!Number.isFinite(ts)) return false;
  // Only accept cards for events that haven't fully passed yet (6h grace for same-night use).
  return ts >= Date.now() - 6 * 60 * 60 * 1000;
}

function applyUpcomingCardContext(card: UpcomingCard | null): void {
  if (!card) {
    upcomingCardPairs = [];
    upcomingEventName = '';
    return;
  }

  upcomingCardPairs = (card.fighters || [])
    .map((fight) => {
      const f1 = normalizeName(fight.f1);
      const f2 = normalizeName(fight.f2);
      if (!f1 || !f2 || f1 === f2) return null;
      return { f1, f2 };
    })
    .filter((p): p is { f1: string; f2: string } => p != null);
  upcomingEventName = buildEventDisplayName(card.event || '', card.fighters);
}

async function syncUpcomingCardContext(forceRefresh = false): Promise<UpcomingCard | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime) return null;
  const resp = await runtimeSendMessage<UpcomingCardResponse>({ type: 'GET_UPCOMING_CARD', forceRefresh });
  const cached = await storageGet<Record<string, UpcomingCard | null>>(['upcoming_ufc_card']);
  const runtimeCard = isUsableUpcomingCard(resp?.card) ? resp!.card! : null;
  const cachedCard = isUsableUpcomingCard(cached['upcoming_ufc_card']) ? cached['upcoming_ufc_card'] : null;
  const card = runtimeCard || cachedCard || null;
  if (!card) {
    applyUpcomingCardContext(null);
    await storageRemove(['upcoming_ufc_card']);
    return null;
  }
  applyUpcomingCardContext(card);
  return card;
}

function hasSourceLine(f: AnalyzerFighter, source: 'p6'|'ud'|'pp'|'betr'|'dk'): boolean {
  if (source === 'p6') return f.line_p6 != null || f.line_p6_ss != null || f.line_p6_td != null || f.line_p6_ft != null;
  if (source === 'ud') return f.line_ud != null || f.line_ud_ss != null || f.line_ud_td != null || f.line_ud_ft != null;
  if (source === 'pp') return f.line_pp != null || f.line_pp_ss != null || f.line_pp_td != null || f.line_pp_ft != null;
  if (source === 'dk') return f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null;
  return f.line_betr != null || f.line_betr_ss != null || f.line_betr_td != null || f.line_betr_ft != null;
}

function hasAnyVisibleSourceLine(f: AnalyzerFighter): boolean {
  const keys: Array<'p6'|'ud'|'pp'|'betr'|'dk'> = ['p6', 'ud', 'pp', 'betr', 'dk'];
  return keys.some((k) => sourceVisibility[k] && hasSourceLine(f, k));
}

function applySourceVisibilityFilter(fighters: AnalyzerFighter[]): AnalyzerFighter[] {
  return fighters.filter((f) => hasAnyVisibleSourceLine(f));
}

function updateSourceToggleUI(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.source-toggle[data-source]');
  buttons.forEach((btn) => {
    const key = (btn.dataset.source || '') as 'p6'|'ud'|'pp'|'betr'|'dk';
    const enabled = !!sourceVisibility[key];
    btn.classList.toggle('active', enabled);
  });
}

const STORAGE_LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'] as const;
const STORAGE_BETR_MANUAL_KEY = 'lines_betr_manual_v1' as const;
const STORAGE_ODDS_KEY = 'fight_odds_moneyline' as const;
const STORAGE_PROP_ARCHIVE_KEY = 'prop_archive_v1' as const;
const STORAGE_BEST_PICKS_SNAPSHOT_KEY = 'best_picks_snapshots_v1' as const;
const STORAGE_AI_LEAN_SNAPSHOT_KEY = 'ai_lean_snapshots_v1' as const;
const UFC_LONDON_CUTOFF_ISO = '2026-03-01T00:00:00.000Z';
const STORAGE_CORE_LINE_KEYS = ['lines_pick6', 'lines_underdog'] as const;
const STORAGE_BETR_LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr'] as const;
const STORAGE_LINE_DEBUG_KEYS = ['pick6', 'underdog', 'sportsbook'] as const;

function storageGet<T = unknown>(keys: string[]): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve({} as T);
  return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data as T)));
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve();
  return new Promise((resolve) => chrome.storage.local.set(values, () => resolve()));
}

function storageRemove(keys: string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve();
  return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}

// Apply user-adjusted Betr lines on top of whatever is in lines_betr.
// Manual non-null values win; fighters only in manual are added whole.
function applyBetrManualOverrides(
  base: RawLineFighter[],
  manual: RawLineFighter[]
): RawLineFighter[] {
  const result = base.map(f => ({ ...f }));
  for (const m of manual) {
    const mName = String(m.name || '').trim().toLowerCase();
    if (!mName) continue;
    const existing = result.find(f => String(f.name || '').trim().toLowerCase() === mName);
    if (existing) {
      if (m.line_fp  != null) existing.line_fp  = m.line_fp;
      if (m.line_ss  != null) existing.line_ss  = m.line_ss;
      if (m.line_td  != null) existing.line_td  = m.line_td;
      if (m.line_ft  != null) existing.line_ft  = m.line_ft;
    } else {
      result.push({ ...m });
    }
  }
  return result;
}

function runtimeSendMessage<T = unknown>(payload: Record<string, unknown>): Promise<T|null> {
  if (typeof chrome === 'undefined' || !chrome.runtime) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((resp ?? null) as T|null);
    });
  });
}

// ── DEBUG PANEL ────────────────────────────────────────────────────────────
function debugLog(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log('[UFC]', msg);
  debugMessages.push(line);
  const panel = document.getElementById('debugPanel');
  if (panel) {
    panel.textContent = debugMessages.slice(-20).join('\n');
    panel.scrollTop = panel.scrollHeight;
  }
}

// ── FANTASY SCORING ────────────────────────────────────────────────────────
function winBonus(won: boolean, method: string|null|undefined, round: number|null|undefined): number {
  if (!won) return 0;
  const isDec = /DEC/i.test(method || '');
  if (isDec) return 30;
  const r = round || 3;
  if (r === 1) return 90;
  if (r === 2) return 70;
  if (r === 3) return 45;
  return 40;
}

type HistoricalScoringPlatform = 'pick6' | 'underdog' | 'prizepicks' | 'betr';

function calcFPForPlatform(
  platform: HistoricalScoringPlatform,
  sigStr: number|null|undefined,
  totStr: number|null|undefined,
  ctrlSecs: number|null|undefined,
  timeSecs: number|null|undefined,
  kd: number|null|undefined,
  td: number|null|undefined,
  rev: number|null|undefined,
  won: boolean,
  method: string|null|undefined,
  round: number|null|undefined,
): number {
  const nonSig = Math.max(0, (totStr || 0) - (sigStr || 0));
  let fp = (sigStr  || 0) * FANTASY_SCORING.sigStrike
       + nonSig          * 0.2
       + (ctrlSecs || 0) * FANTASY_SCORING.controlTimePerSec
       + (kd  || 0)      * FANTASY_SCORING.knockdown
       + (td  || 0)      * FANTASY_SCORING.takedown
       + (rev || 0)      * FANTASY_SCORING.reversal
       + winBonus(won, method, round);

  if ((platform === 'pick6' || platform === 'underdog' || platform === 'betr') && won && isFinish(method) && (round || 0) === 1 && (timeSecs || 9999) <= 60) {
    fp += 25;
  }
  return fp;
}

function calcFP(sigStr: number|null|undefined, totStr: number|null|undefined, ctrlSecs: number|null|undefined, kd: number|null|undefined, td: number|null|undefined, rev: number|null|undefined, won: boolean, method: string|null|undefined, round: number|null|undefined): number {
  return calcFPForPlatform('pick6', sigStr, totStr, ctrlSecs, null, kd, td, rev, won, method, round);
}

function getFightFantasyValueForPlatform(
  h: {
    result?: string|null;
    fp?: number|null;
    fp_p6?: number|null;
    fp_ud?: number|null;
    sigStr?: number|null;
    totStr?: number|null;
    ctrlSecs?: number|null;
    timeSecs?: number|null;
    kd?: number|null;
    td?: number|null;
    rev?: number|null;
    method?: string|null;
    round?: number|null;
  },
  platform: 'pick6'|'underdog'|'prizepicks'|'betr'
): number|null {
  const won = h.result === 'win';
  const canReconstruct = h.sigStr != null || h.totStr != null || h.kd != null || h.td != null || h.ctrlSecs != null;
  if (platform === 'pick6') {
    if (canReconstruct) {
      return calcFPForPlatform('pick6', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, won, h.method, h.round);
    }
    if (h.fp_p6 != null) return h.fp_p6;
    if (h.fp != null) return h.fp;
    return null;
  }
  if (platform === 'underdog') {
    if (canReconstruct) {
      return calcFPForPlatform('underdog', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, won, h.method, h.round);
    }
    if (h.fp_ud != null) return h.fp_ud;
    return null;
  }
  if (platform === 'prizepicks') {
    if (canReconstruct) {
      return calcFPForPlatform('prizepicks', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, won, h.method, h.round);
    }
    return h.fp ?? null;
  }
  if (canReconstruct) {
    return calcFPForPlatform('betr', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, won, h.method, h.round);
  }
  return h.fp ?? null;
}

function isFinish(method: string|null|undefined): boolean {
  return /KO|TKO|SUB/i.test(method || '');
}

function deriveStyle(careerStats: CareerStats|null|undefined): 'striker'|'grappler'|'balanced' {
  if (!careerStats) return 'balanced';
  const { tdAvg, subAvg, slpm } = careerStats;
  if ((tdAvg != null && tdAvg > 2) || (subAvg != null && subAvg > 0.5)) return 'grappler';
  if (slpm != null && slpm > 5) return 'striker';
  return 'balanced';
}

// ── ANALYTICS HELPERS ──────────────────────────────────────────────────────
function detectStreak(history: FightResult[]): { type: 'hot'|'cold'|'neutral'; count: number; text: string } {
  if (!history?.length) return { type: 'neutral', count: 0, text: '' };
  const recent = history.slice(0, 5);
  let winStreak = 0, lossStreak = 0;
  for (const h of recent) {
    if (h.result === 'win') { if (lossStreak === 0) winStreak++; else break; }
    else { if (winStreak === 0) lossStreak++; else break; }
  }
  if (winStreak >= 3) return { type: 'hot', count: winStreak, text: `${winStreak}-fight win streak` };
  if (lossStreak >= 2) return { type: 'cold', count: lossStreak, text: `${lossStreak}-fight losing streak` };
  const fpFights = recent.filter(h => h.fp != null);
  if (fpFights.length >= 3) {
    let rising = 0, falling = 0;
    for (let i = 0; i < fpFights.length - 1; i++) {
      const delta = (fpFights[i].fp || 0) - (fpFights[i + 1].fp || 0);
      if (delta > 5) rising++;
      else if (delta < -5) falling++;
    }
    if (rising >= 2) return { type: 'hot', count: rising, text: 'FP trending up last 3 fights' };
    if (falling >= 2) return { type: 'cold', count: falling, text: 'FP trending down last 3 fights' };
  }
  return { type: 'neutral', count: 0, text: '' };
}

function calcWeightedAvgFP(history: FightResult[]): number|null {
  const valid = history.filter(f => f.fp != null && f.fp! > 0);
  if (!valid.length) return null;
  const weights = valid.map((_, i) => Math.pow(0.80, i));
  const totalW = weights.reduce((s, w) => s + w, 0);
  return parseFloat((valid.reduce((s, f, i) => s + (f.fp || 0) * weights[i], 0) / totalW).toFixed(1));
}

function calcFPStats(history: FightResult[]): { floor: number|null; ceiling: number|null; stdDev: number|null; consistency: number|null; median: number|null } {
  const fps = history.filter(f => f.fp != null && f.fp! > 0).map(f => f.fp as number);
  if (!fps.length) return { floor: null, ceiling: null, stdDev: null, consistency: null, median: null };
  if (fps.length === 1) return { floor: parseFloat(fps[0].toFixed(1)), ceiling: parseFloat(fps[0].toFixed(1)), stdDev: 0, consistency: 100, median: parseFloat(fps[0].toFixed(1)) };
  const sorted = [...fps].sort((a, b) => a - b);
  const median = parseFloat(sorted[Math.floor(sorted.length / 2)].toFixed(1));
  const floor  = parseFloat(sorted[0].toFixed(1));
  const ceiling = parseFloat(sorted[sorted.length - 1].toFixed(1));
  const mean   = fps.reduce((s, v) => s + v, 0) / fps.length;
  const stdDev = parseFloat(Math.sqrt(fps.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / fps.length).toFixed(1));
  const cv     = mean > 0 ? stdDev / mean : 1;
  const consistency = Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));
  return { floor, ceiling, stdDev, consistency, median };
}

function calcPerRoundFP(history: FightResult[]): number|null {
  const valid = history.filter(f => f.fp != null && f.fp! > 0 && f.round);
  if (!valid.length) return null;
  const perRound = valid.map(f => (f.fp || 0) / (f.round || 3));
  return parseFloat((perRound.reduce((s, v) => s + v, 0) / perRound.length).toFixed(1));
}

// ── BUILD FIGHTER DB ───────────────────────────────────────────────────────
function buildFighterDB(name: string, ufcData: UFCStatsData|null): FighterDB {
  if (!ufcData) {
    return {
      record: '—', country: '🏳️',
      avgFP_p6: null, avgFP_ud: null, avgFP_pp: null, avgFP_betr: null,
      avgSigStr: null, avgTD: null,
      style: 'balanced', finishRate: null,
      history: [], oppHistory: [], loaded: false, detailUrl: null
    };
  }

  const { careerStats, fightHistory, detailUrl } = ufcData;
  const history: FightResult[] = (fightHistory || []).map(f => {
    const won = f.result === 'win';
    const fpP6 = (f.sigStr != null)
      ? calcFPForPlatform('pick6', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, won, f.method, f.round)
      : null;
    const fpUd = (f.sigStr != null)
      ? calcFPForPlatform('underdog', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, won, f.method, f.round)
      : null;
    return {
      opp: f.opponent, fp: fpP6, fp_p6: fpP6, fp_ud: fpUd,
      sigStr: f.sigStr, totStr: f.totStr, ctrlSecs: f.ctrlSecs, timeSecs: f.timeSecs,
      td: f.td, kd: f.kd, rev: f.rev, method: f.method, result: f.result, date: f.date ?? undefined, round: f.round ?? undefined,
      oppStats: f.oppStats as FightStats | null | undefined,
    };
  }).filter(f => f.fp != null);

  const validFights = history.filter(f => f.fp! > 0);
  const avgFP = validFights.length ? validFights.reduce((s,f) => s + (f.fp || 0), 0) / validFights.length : null;
  const p6Samples = history.map((f) => f.fp_p6).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const udSamples = history.map((f) => f.fp_ud).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const ppSamples = (fightHistory || [])
    .map((f) => {
      const won = f.result === 'win';
      if (f.sigStr == null) return null;
      return calcFPForPlatform('prizepicks', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, won, f.method, f.round);
    })
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const betrSamples = (fightHistory || [])
    .map((f) => {
      const won = f.result === 'win';
      if (f.sigStr == null) return null;
      return calcFPForPlatform('betr', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, won, f.method, f.round);
    })
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avgFP_p6 = p6Samples.length ? parseFloat((p6Samples.reduce((s, v) => s + v, 0) / p6Samples.length).toFixed(1)) : null;
  const avgFP_ud = udSamples.length ? parseFloat((udSamples.reduce((s, v) => s + v, 0) / udSamples.length).toFixed(1)) : null;
  const avgFP_pp = ppSamples.length ? parseFloat((ppSamples.reduce((s, v) => s + v, 0) / ppSamples.length).toFixed(1)) : null;
  const avgFP_betr = betrSamples.length ? parseFloat((betrSamples.reduce((s, v) => s + v, 0) / betrSamples.length).toFixed(1)) : null;

  const fightsSS = history.filter(f => f.sigStr != null);
  const avgSigStr = fightsSS.length
    ? parseFloat((fightsSS.reduce((s,f) => s + (f.sigStr || 0), 0) / fightsSS.length).toFixed(1))
    : (careerStats?.slpm != null ? parseFloat((careerStats.slpm * 15).toFixed(1)) : null);
  const fightsTD = history.filter(f => f.td != null);
  const avgTDperFight = fightsTD.length ? parseFloat((fightsTD.reduce((s,f) => s + (f.td || 0), 0) / fightsTD.length).toFixed(1)) : null;

  const finishes = validFights.filter(f => isFinish(f.method));
  const finishRate = validFights.length ? finishes.length / validFights.length : null;

  const avgFP_weighted = calcWeightedAvgFP(history);
  const fpStats        = calcFPStats(history);
  const avgFP_perRound = calcPerRoundFP(history);
  const streak         = detectStreak(history);
  const fiveRoundFights = history.filter(f => (f.round || 0) >= 4).length;
  const fiveRoundRate   = history.length > 0 ? parseFloat((fiveRoundFights / history.length).toFixed(2)) : 0;

  return {
    record: careerStats?.record || '—',
    country: '🏴',
    avgFP: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
    avgFP_p6,
    avgFP_ud,
    avgFP_pp,
    avgFP_betr,
    avgSigStr,
    avgTD: careerStats?.tdAvg || null,
    avgTDperFight,
    slpm: careerStats?.slpm || null,
    sapm: careerStats?.sapm || null,
    strAcc: careerStats?.strAcc || null,
    strDef: careerStats?.strDef || null,
    tdDef: careerStats?.tdDef || null,
    tdAcc: careerStats?.tdAcc || null,
    stance: careerStats?.stance || null,
    style: deriveStyle(careerStats),
    finishRate,
    avgFP_weighted,
    fpFloor:        fpStats.floor,
    fpCeiling:      fpStats.ceiling,
    fpStdDev:       fpStats.stdDev,
    fpConsistency:  fpStats.consistency,
    fpMedian:       fpStats.median,
    avgFP_perRound,
    streak,
    fiveRoundRate,
    history,
    oppHistory: history
      .filter(f => f.oppStats != null)
      .map(f => {
        const os = f.oppStats as FightStats;
        const oppWon = f.result === 'loss';
        const fp = (os.sigStr != null)
          ? calcFPForPlatform('pick6', os.sigStr, os.totStr, os.ctrlSecs, f.timeSecs, os.kd, os.td, null, oppWon, f.method, f.round)
          : null;
        return {
          opp: f.opp,
          result: oppWon ? 'win' : 'loss',
          fp: fp != null ? parseFloat(fp.toFixed(1)) : null,
          fp_p6: fp != null ? parseFloat(fp.toFixed(1)) : null,
          sigStr: os.sigStr ?? null,
          totStr: os.totStr ?? null,
          td: os.td ?? null,
          kd: os.kd ?? null,
          rev: null,
          ctrlSecs: os.ctrlSecs ?? null,
          timeSecs: f.timeSecs ?? null,
          method: f.method ?? null,
          round: f.round ?? null,
        };
      })
      .filter(f => f.fp != null || f.sigStr != null),
    loaded: true,
    detailUrl: detailUrl || null,
  };
}

// ── PARSE FUNCTIONS ────────────────────────────────────────────────────────
function parseCareerStats(html: string): CareerStats {
  const stats: CareerStats = {};
  const li = (label: string): string|null => {
    const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*)', 'i');
    const m = html.match(re);
    if (!m) return null;
    return m[1].replace(/&nbsp;/g, ' ').trim() || null;
  };
  const liNum = (label: string): number|null => { const v = li(label); return v ? parseFloat(v) : null; };
  const liPct = (label: string): number|null => {
    const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*?)([\\d.]+)%', 'i');
    const m = html.match(re);
    return m ? parseFloat(m[2]) : null;
  };
  stats.slpm   = liNum('SLpM');
  stats.strAcc = liPct('Str\\.?\\s*Acc\\.?');
  stats.sapm   = liNum('SApM');
  stats.strDef = liPct('Str\\.?\\s*Def\\.?');
  stats.tdAvg  = liNum('TD\\s*Avg\\.?');
  stats.tdAcc  = liPct('TD\\s*Acc\\.?');
  stats.tdDef  = liPct('TD\\s*Def\\.?');
  stats.subAvg = liNum('Sub\\.?\\s*Avg\\.?');
  const recM = html.match(/Record:\s*([\d]+-[\d]+-[\d]+)/i)
             || html.match(/<span[^>]*>\s*([\d]+-[\d]+-[\d]+)\s*<\/span>/);
  stats.record = recM ? recM[1] : undefined;
  const htM = html.match(/Height[^<]*<\/i>([^<\n]+)/i);
  stats.height = htM ? htM[1].replace(/&nbsp;/g,' ').trim() : undefined;
  const stanceM = html.match(/(?:STANCE|Stance)[^<]*<\/i>([^<\n]+)/i);
  stats.stance = stanceM ? stanceM[1].replace(/&nbsp;/g,' ').trim() : undefined;
  return stats;
}

function parseFightHistoryLinks(html: string): UFCFightHistory[] {
  const fights: UFCFightHistory[] = [];
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    if (row.includes('<th')) continue;
    const fightLinkM = row.match(/href="(http[^"]*fight-details\/[a-f0-9]+)"/i);
    if (!fightLinkM) continue;
    const resultM = row.match(/>\s*(win|loss)\s*</i);
    if (!resultM) continue;
    const wl = resultM[1].toLowerCase();
    const oppLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
    if (oppLinks.length === 0) continue;
    const opponent = oppLinks[oppLinks.length - 1][1].trim();
    if (!opponent || opponent === '--') continue;
    const eventM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
    const event  = eventM ? eventM[1].trim() : '';
    const methodM = row.match(/(KO\/TKO|Submission|U-DEC|S-DEC|M-DEC|DQ|NC)/i);
    let method = 'DEC';
    if (methodM) { const raw = methodM[1].toUpperCase(); method = raw === 'SUBMISSION' ? 'SUB' : raw; }
    const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
    const date  = dateM ? dateM[0] : null;
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    let round: number|null = null;
    for (const t of tds) {
      if (t.includes(':')) continue;
      const n = parseInt(t);
      if (!isNaN(n) && n >= 1 && n <= 5 && t.trim().length <= 2) { round = n; break; }
    }
    fights.push({ result: wl, opponent, event, method, round, date, fightUrl: fightLinkM[1] });
  }
  return fights.slice(0, 10);
}

function parseFightDetailStats(html: string, fighterName: string, fighterDetailUrl: string|null): { kd?: number|null; sigStr?: number|null; totStr?: number|null; td?: number|null; sub?: number|null; rev?: number|null; ctrlSecs?: number|null; timeSecs?: number|null; method?: string|null; round?: number|null } {
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s: string) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let detailMethod: string|null = null;
  let detailRound: number|null = null;

  const methodM = html.match(/Method:\s*<\/i>\s*<i[^>]*>\s*([^<]+)/i);
  if (methodM) {
    const raw = methodM[1].trim().toLowerCase();
    if (raw.includes('ko') || raw.includes('tko')) detailMethod = 'KO/TKO';
    else if (raw.includes('sub')) detailMethod = 'SUB';
    else if (raw.includes('unanimous')) detailMethod = 'U-DEC';
    else if (raw.includes('split')) detailMethod = 'S-DEC';
    else if (raw.includes('majority')) detailMethod = 'M-DEC';
    else if (raw.includes('decision')) detailMethod = 'DEC';
    else if (raw.includes('no contest')) detailMethod = 'NC';
    else if (raw.includes('disq')) detailMethod = 'DQ';
  }
  const roundM = html.match(/Round:\s*<\/i>\s*(?:<[^>]+>\s*)*(\d+)/i)
    || html.match(/Round:\s*(\d+)/i);
  if (roundM) detailRound = parseInt(roundM[1]);
  let detailTimeSecs: number|null = null;
  const timeM = html.match(/Time:\s*<\/i>\s*(?:<[^>]+>\s*)*(\d+):(\d{2})/i)
    || html.match(/Time:\s*(\d+):(\d{2})/i)
    || html.match(/\b(\d+):(\d{2})\b(?=[^<]*$)/i);
  if (timeM) {
    const roundClockSecs = parseInt(timeM[1]) * 60 + parseInt(timeM[2]);
    // UFCStats "Time" is the stoppage clock within the final round, not full fight duration.
    // Convert to total elapsed seconds so FT charts/leans use true duration minutes.
    if (detailRound && detailRound >= 1) detailTimeSecs = ((detailRound - 1) * 5 * 60) + roundClockSecs;
    else detailTimeSecs = roundClockSecs;
  }

  let totalsTable: string|null = null;
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      totalsTable = tableHtml; break;
    }
  }
  if (!totalsTable) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });
  if (tds.length === 0) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

  let fIdx = 0;
  if (fighterDetailUrl) {
    const urlId = fighterDetailUrl.match(/fighter-details\/([a-f0-9]+)/i)?.[1];
    if (urlId) {
      const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
      const hrefMatches = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/([a-f0-9]+)/gi)];
      const ids = hrefMatches.map(m => m[1]);
      const idx = ids.indexOf(urlId);
      if (idx >= 0) fIdx = idx;
    }
  }
  if (fIdx === 0 && tds[0]) {
    const nameParts = fighterName.toLowerCase().split(' ').filter(p => p.length > 2);
    if (tds[0][1] && nameParts.every(p => tds[0][1].toLowerCase().includes(p))) fIdx = 1;
  }

  const val = (colIdx: number) => tds[colIdx]?.[fIdx] || tds[colIdx]?.[0] || '';
  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  const sub    = firstNum(val(7));
  const rev    = firstNum(val(8));
  let ctrlSecs: number|null = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);
  return { kd, sigStr, totStr, td, sub, rev, ctrlSecs, timeSecs: detailTimeSecs, method: detailMethod, round: detailRound };
}

function parseFightDetailStatsOpponent(html: string, fighterName: string, fighterDetailUrl: string|null): OppStats|null {
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s: string) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let totalsTable: string|null = null;
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      totalsTable = tableHtml; break;
    }
  }
  if (!totalsTable) return null;

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return null;

  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });
  if (tds.length === 0) return null;

  let fIdx = 0;
  if (fighterDetailUrl) {
    const urlId = fighterDetailUrl.match(/fighter-details\/([a-f0-9]+)/i)?.[1];
    if (urlId) {
      const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
      const hrefMatches = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/([a-f0-9]+)/gi)];
      const ids = hrefMatches.map(m => m[1]);
      const idx = ids.indexOf(urlId);
      if (idx >= 0) fIdx = idx;
    }
  }
  const oppIdx = fIdx === 0 ? 1 : 0;

  const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
  const nameLinks = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/[a-f0-9]+[^"'\s>]*[>\s]+([^<]+)/gi)];
  const oppName = nameLinks[oppIdx]?.[1]?.trim() || null;

  const val = (colIdx: number) => tds[colIdx]?.[oppIdx] || tds[colIdx]?.[0] || '';
  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  let ctrlSecs: number|null = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);
  return { oppName, kd, sigStr, totStr, td, ctrlSecs };
}

// ── UFC STATS FETCH ────────────────────────────────────────────────────────
async function fetchFromUFCStats(name: string): Promise<UFCStatsData|null> {
  const cacheKey = `ufcstats_v41_${name.toLowerCase().replace(/\s+/g,'_')}`;
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const cached = await storageGet<Record<string, UFCStatsData | undefined>>([cacheKey]);
    if (cached[cacheKey] && (Date.now() - cached[cacheKey].fetchedAt < 86400000)) {
      debugLog(`Cache hit: ${name}`);
      return cached[cacheKey];
    }
  }
  try {
    const SUFFIXES = new Set(['jr','jr.','sr','sr.','ii','iii','iv']);
    const COMPOUND = new Set(['de','van','von','da','dos','del','di','le','la','du','el','abdul']);

    function nameCandidates(n: string): NameCandidate[] {
      const parts = n.trim().split(/\s+/);
      const hasSuffix = SUFFIXES.has(parts[parts.length-1].toLowerCase().replace('.',''));
      const cleanParts = hasSuffix ? parts.slice(0,-1) : [...parts];
      const cands: NameCandidate[] = [];
      if (cleanParts.length >= 2) {
        const last = cleanParts[cleanParts.length-1], first = cleanParts[0];
        // When name has a Jr/Sr suffix, try "Gibson Jr" first to avoid matching
        // an older fighter with the same base last name (e.g. old "Lance Gibson" vs current "Lance Gibson Jr.")
        if (hasSuffix) {
          const suffix = parts[parts.length-1].toLowerCase().replace('.','');
          const lastWithSuffix = last.toLowerCase() + ' ' + suffix;
          cands.push({ char: last[0].toLowerCase(), first: first.toLowerCase(), last: lastWithSuffix });
        }
        cands.push({ char: last[0].toLowerCase(), first: first.toLowerCase(), last: last.toLowerCase() });
      }
      if (cleanParts.length >= 3 && COMPOUND.has(cleanParts[cleanParts.length-2].toLowerCase())) {
        const compLast = cleanParts[cleanParts.length-2] + ' ' + cleanParts[cleanParts.length-1];
        cands.push({ char: cleanParts[cleanParts.length-2][0].toLowerCase(), first: cleanParts[0].toLowerCase(), last: compLast.toLowerCase() });
      }
      const firstLen = cleanParts[0].length;
      const lastLen  = cleanParts[cleanParts.length-1].length;
      if (cleanParts.length === 2 && (firstLen <= 3 || lastLen <= 3)) {
        const revLast  = cleanParts[0].toLowerCase();
        const revFirst = cleanParts[cleanParts.length-1].toLowerCase();
        const revChar  = revLast[0];
        if (revChar !== cands[0]?.char || revLast !== cands[0]?.last) {
          cands.push({ char: revChar, first: revFirst, last: revLast });
        }
      }
      return cands;
    }

    const candidates = nameCandidates(name);
    debugLog(`Searching ${name} — ${candidates.length} candidate(s)`);

    const pageCache: Record<string, string> = {};
    async function getAlphaPage(char: string): Promise<string> {
      if (pageCache[char]) return pageCache[char];
      const url = `http://www.ufcstats.com/statistics/fighters?char=${char}&page=all`;
      let res: Response;
      try { res = await fetch(url); } catch(e: unknown) { debugLog(`Fetch error [${char}]: ${(e as Error).message}`); return ''; }
      if (!res.ok) { debugLog(`HTTP ${res.status} for char=${char}`); return ''; }
      const html = await res.text();
      pageCache[char] = html;
      debugLog(`Loaded [${char.toUpperCase()}] page: ${html.length} chars`);
      return html;
    }

    function findDetailUrl(html: string, firstLower: string, lastLower: string): string|null {
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m: RegExpExecArray|null;
      while ((m = trRegex.exec(html)) !== null) {
        const row = m[1];
        const link = row.match(/href="(http:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
        if (!link) continue;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim().toLowerCase());
        const rowText = cells.join(' ').replace(/-/g, ' ');
        if (rowText.includes(firstLower) && rowText.includes(lastLower)) {
          return link[1].replace('http://ufcstats.com/','http://www.ufcstats.com/');
        }
      }
      const trRegex2 = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m2: RegExpExecArray|null;
      while ((m2 = trRegex2.exec(html)) !== null) {
        const row = m2[1];
        const link = row.match(/href="(http:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
        if (!link) continue;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim().toLowerCase());
        if (cells.some(t => t.replace(/-/g, ' ') === lastLower)) {
          return link[1].replace('http://ufcstats.com/','http://www.ufcstats.com/');
        }
      }
      return null;
    }

    let detailUrl: string|null = null;
    for (const cand of candidates) {
      const html = await getAlphaPage(cand.char);
      if (!html) continue;
      detailUrl = findDetailUrl(html, cand.first, cand.last);
      if (detailUrl) { debugLog(`Matched: ${name} via [${cand.char.toUpperCase()}] first=${cand.first} last=${cand.last}`); break; }
    }

    if (!detailUrl) { debugLog(`✗ NOT FOUND: ${name}`); return null; }

    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) { debugLog(`Detail HTTP ${detailRes.status}`); return null; }
    const detailHtml = await detailRes.text();

    const careerStats = parseCareerStats(detailHtml);
    const fightLinks  = parseFightHistoryLinks(detailHtml);
    debugLog(`✓ ${name}: ${careerStats.record}, ${fightLinks.length} fight links found`);

    const fightHistory: UFCFightHistory[] = [];
    const detailUrlId = detailUrl?.match(/fighter-details\/([a-f0-9]+)/i)?.[1] || 'unknown';
    debugLog(`detailUrl ID: ${detailUrlId}`);
    let firstFightHtmlStored = false;
    for (const fight of fightLinks) {
      try {
        const fRes  = await fetch(fight.fightUrl!);
        const fHtml = await fRes.text();
        if (!firstFightHtmlStored) {
          const debugKey = `debug_fight_html_${name.toLowerCase().replace(/\s+/g,'_')}`;
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [debugKey]: { html: fHtml.slice(0, 20000), url: fight.fightUrl, opponent: fight.opponent } });
          }
          firstFightHtmlStored = true;
        }
        const stats = parseFightDetailStats(fHtml, name, detailUrl);
        const oppStats = parseFightDetailStatsOpponent(fHtml, name, detailUrl);
        const method = stats?.method || fight.method;
        const round  = stats?.round  || fight.round;
        fightHistory.push({ ...fight, ...(stats || {}), method, round, oppStats: oppStats || null, fightUrl: undefined });
        debugLog(`  vs ${fight.opponent}: ${fight.result} kd=${stats?.kd} sig=${stats?.sigStr} tot=${stats?.totStr} td=${stats?.td} ctrl=${stats?.ctrlSecs}s rnd=${round} method=${method} urlMatch=${fHtml.includes(detailUrlId)}`);
      } catch(e: unknown) {
        debugLog(`  fight fetch error ${fight.fightUrl}: ${(e as Error).message}`);
        fightHistory.push({ ...fight, fightUrl: undefined });
      }
    }

    const result: UFCStatsData = { name, fetchedAt: Date.now(), careerStats, fightHistory, detailUrl };
    if (typeof chrome !== 'undefined' && chrome.storage) chrome.storage.local.set({ [cacheKey]: result });
    debugLog(`✓ ${name}: stored ${fightHistory.length} fights with stats`);
    return result;
  } catch (e: unknown) {
    debugLog(`✗ ERROR ${name}: ${(e as Error).name}: ${(e as Error).message}`);
    return null;
  }
}

async function fetchFighterStats(name: string): Promise<FighterDB> {
  if (statsCache[name] !== undefined) return statsCache[name];
  if (name in statsCachePromises) return statsCachePromises[name];
  const promise = fetchFromUFCStats(name).then(ufcData => {
    archivePerformanceForRosterFighter(name, ufcData).catch((e) => {
      debugLog(`archive error ${name}: ${(e as Error).message}`);
    });
    const db = buildFighterDB(name, ufcData);
    statsCache[name] = db;
    return db;
  });
  statsCachePromises[name] = promise;
  return promise;
}

// ── STYLE MATCHUP MATRIX ──────────────────────────────────────────────────
function styleMatchupEdge(styleA: string, styleB: string, dbA: FighterDB, dbB: FighterDB): { delta: number; edges: LeanReason[] } {
  const edges: LeanReason[] = [];
  let delta = 0;
  if (styleA === 'striker' && styleB === 'grappler') {
    const oppTD = dbB?.avgTD || 0;
    const myTDDef = dbA?.tdDef || 50;
    if (oppTD > 2.5) {
      const suppression = myTDDef < 55 ? -2.5 : myTDDef < 70 ? -2.0 : -1.5;
      delta += suppression;
      edges.push({ icon: 'neg', text: `Grappler opponent (${oppTD.toFixed(1)} TD/15min) will neutralize striking — TD def ${myTDDef}% offers ${myTDDef > 75 ? 'some' : 'limited'} protection` });
    } else if (oppTD > 1.5) {
      delta -= 1.0;
      edges.push({ icon: 'neg', text: `Grappler opponent (${oppTD.toFixed(1)} TD/15min) — moderate suppression risk for SS volume` });
    } else {
      delta -= 0.5;
      edges.push({ icon: 'neg', text: `Faces grappler but opponent has limited TD output — some suppression risk` });
    }
  } else if (styleA === 'grappler' && styleB === 'striker') {
    const oppTDDef = dbB?.tdDef || 50;
    if (oppTDDef > 75) {
      delta -= 1.5;
      edges.push({ icon: 'neg', text: `Opponent has strong TD defense (${oppTDDef}%) — grappler's main scoring route is compromised` });
    } else {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Striker opponent with average TD defense (${oppTDDef}%) — takedowns should be available` });
    }
  } else if (styleA === 'striker' && styleB === 'striker') {
    delta += 0.5;
    edges.push({ icon: 'pos', text: `Striker vs striker matchup — expect high output and volume, good for FP` });
  } else if (styleA === 'grappler' && styleB === 'grappler') {
    delta -= 1;
    edges.push({ icon: 'neg', text: `Grappler vs grappler — tends toward low-scoring, grinding fight` });
  }
  return { delta, edges };
}

function calcOpponentDefenseScore(oppDB: FighterDB, _line: number): { delta: number; edges: LeanReason[] } {
  if (!oppDB?.loaded || !oppDB.history?.length) return { delta: 0, edges: [] };
  const edges: LeanReason[] = [];
  let delta = 0;
  if (oppDB.sapm != null) {
    if (oppDB.sapm < 3.0) {
      delta -= 1;
      edges.push({ icon: 'neg', text: `Opponent absorbs only ${oppDB.sapm.toFixed(1)} sig strikes/min — very defensively sound, limits output` });
    } else if (oppDB.sapm > 5.0) {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Opponent absorbs ${oppDB.sapm.toFixed(1)} sig strikes/min — tends to be in high-output fights` });
    }
  }
  if (oppDB.tdDef != null && oppDB.tdDef > 78) {
    delta -= 0.5;
    edges.push({ icon: 'neg', text: `Opponent's TD defense (${oppDB.tdDef}%) will limit takedown scoring opportunities` });
  }
  if (oppDB.finishRate != null && oppDB.finishRate > 0.70) {
    delta -= 1;
    edges.push({ icon: 'neg', text: `Opponent finishes ${Math.round(oppDB.finishRate*100)}% of fights — early stoppage risk suppresses counting stats` });
  }
  return { delta, edges };
}

function calcMatchupPatternEdge(db: FighterDB, oppDB: FighterDB, ssLine: number|null, tdLine: number|null, fpLine: number|null): { score: number; ssScore: number; tdScore: number; reasons: LeanReason[] } {
  if (!db?.loaded || !oppDB?.loaded || !db.history?.length) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };
  const history = db.history.filter(h => h.sigStr != null);
  if (history.length < 2) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };

  const reasons: LeanReason[] = [];
  let score = 0, ssScore = 0, tdScore = 0;
  const oppStyle  = oppDB.style  || null;
  const oppStance = oppDB.stance || null;
  const oppStrDef = oppDB.strDef ?? null;
  const oppTdDef  = oppDB.tdDef  ?? null;

  if (oppStyle) {
    const styleMatches = history.filter((h: FightResult) => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && pastOppDB.style === oppStyle;
    });
    if (styleMatches.length >= 2) {
      const avgSS_vsStyle = styleMatches.filter((h: FightResult) => h.sigStr != null).reduce((s: number,h: FightResult) => s + (h.sigStr || 0), 0) / styleMatches.length;
      const avgTD_vsStyle = styleMatches.filter((h: FightResult) => h.td != null).reduce((s: number,h: FightResult) => s + (h.td || 0), 0) / styleMatches.length;
      const avgFP_vsStyle = styleMatches.filter((h: FightResult) => h.fp != null).reduce((s: number,h: FightResult) => s + (h.fp || 0), 0) / styleMatches.length;
      const label = `vs ${oppStyle}s (${styleMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_vsStyle - ssLine;
        const ssHits = styleMatches.filter(h => (h.sigStr || 0) > ssLine).length;
        if (ssDiff > 10) { ssScore += 1.5; reasons.push({ icon:'pos', text:`Avg ${avgSS_vsStyle.toFixed(0)} SS ${label} — ${ssHits}/${styleMatches.length} over SS line ${ssLine}` }); }
        else if (ssDiff > 3) { ssScore += 0.8; reasons.push({ icon:'pos', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — slightly edges line ${ssLine}` }); }
        else if (ssDiff < -10) { ssScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgSS_vsStyle.toFixed(0)} avg SS ${label} — struggles to hit SS line ${ssLine} vs this style` }); }
        else if (ssDiff < -3) { ssScore -= 0.8; reasons.push({ icon:'neg', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — below SS line ${ssLine}` }); }
      }
      if (tdLine) {
        const tdDiff = avgTD_vsStyle - tdLine;
        const tdHits = styleMatches.filter(h => (h.td||0) > tdLine).length;
        if (tdDiff > 1.5) { tdScore += 1.5; reasons.push({ icon:'pos', text:`Avg ${avgTD_vsStyle.toFixed(1)} TDs ${label} — ${tdHits}/${styleMatches.length} over TD line ${tdLine}` }); }
        else if (tdDiff > 0.5) { tdScore += 0.8; reasons.push({ icon:'pos', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — edges TD line ${tdLine}` }); }
        else if (tdDiff < -1.5) { tdScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — misses TD line ${tdLine} vs this style` }); }
        else if (tdDiff < -0.5) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — below TD line ${tdLine}` }); }
      }
      if (fpLine) {
        const fpDiff = avgFP_vsStyle - fpLine;
        if (fpDiff > 8) { score += 1; reasons.push({ icon:'pos', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — ${styleMatches.filter(h=>(h.fp||0)>fpLine).length}/${styleMatches.length} over FP line` }); }
        else if (fpDiff < -8) { score -= 1; reasons.push({ icon:'neg', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — below FP line historically` }); }
      }
    }
  }

  if (oppStance) {
    const stanceMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && (pastOppDB.stance || '').toLowerCase() === oppStance.toLowerCase();
    });
    if (stanceMatches.length >= 2) {
      const avgSS_vsStance = stanceMatches.filter(h => h.sigStr != null).reduce((s,h) => s + (h.sigStr || 0), 0) / stanceMatches.length;
      const avgTD_vsStance = stanceMatches.filter(h => h.td != null).reduce((s,h) => s + (h.td || 0), 0) / stanceMatches.length;
      const label = `vs ${oppStance} opponents (${stanceMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_vsStance - ssLine;
        if (ssDiff > 12) { ssScore += 1.2; reasons.push({ icon:'pos', text:`Avg ${avgSS_vsStance.toFixed(0)} SS ${label}` }); }
        else if (ssDiff < -12) { ssScore -= 1.2; reasons.push({ icon:'neg', text:`Only ${avgSS_vsStance.toFixed(0)} avg SS ${label} — stance creates problems` }); }
      }
      if (tdLine) {
        const tdDiff = avgTD_vsStance - tdLine;
        if (tdDiff > 1) { tdScore += 0.8; reasons.push({ icon:'pos', text:`Avg ${avgTD_vsStance.toFixed(1)} TDs ${label}` }); }
        else if (tdDiff < -1) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`Only ${avgTD_vsStance.toFixed(1)} avg TDs ${label}` }); }
      }
    }
  }

  if (oppStrDef != null) {
    const getStrDefTier = (d: number) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
    const oppTier = getStrDefTier(oppStrDef);
    const tierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.strDef == null) return false;
      return getStrDefTier(pastOppDB.strDef) === oppTier;
    });
    if (tierMatches.length >= 2) {
      const avgSS_tier = tierMatches.filter(h => h.sigStr != null).reduce((s,h) => s + (h.sigStr || 0), 0) / tierMatches.length;
      const ssHits = ssLine ? tierMatches.filter(h => (h.sigStr || 0) > ssLine).length : 0;
      const tierLabel = `vs ${oppTier} strikedef opponents (${oppStrDef}% tier, ${tierMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_tier - ssLine;
        if (ssDiff > 10) { ssScore += 1.5; reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — ${ssHits}/${tierMatches.length} clears line` }); }
        else if (ssDiff > 4) { ssScore += 0.8; reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel}` }); }
        else if (ssDiff < -10) { ssScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgSS_tier.toFixed(0)} SS ${tierLabel} — elite defense suppresses output` }); }
        else if (ssDiff < -4) { ssScore -= 0.8; reasons.push({ icon:'neg', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — struggles vs this defense tier` }); }
      }
    } else if (oppStrDef > 60 && ssLine) {
      ssScore -= 0.5; reasons.push({ icon:'neg', text:`Opponent has elite striking defense (${oppStrDef}%) — expect suppressed SS output` });
    } else if (oppStrDef < 45 && ssLine) {
      ssScore += 0.5; reasons.push({ icon:'pos', text:`Opponent has poor striking defense (${oppStrDef}%) — easier to land, boosts SS ceiling` });
    }
  }

  if (oppTdDef != null) {
    const getTdDefTier = (d: number) => d > 80 ? 'elite' : d > 65 ? 'good' : d > 50 ? 'average' : 'poor';
    const oppTdTier = getTdDefTier(oppTdDef);
    const tdTierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.tdDef == null) return false;
      return getTdDefTier(pastOppDB.tdDef) === oppTdTier;
    });
    if (tdTierMatches.length >= 2) {
      const avgTD_tier = tdTierMatches.filter(h => h.td != null).reduce((s,h) => s + (h.td || 0), 0) / tdTierMatches.length;
      const tdHits = tdLine ? tdTierMatches.filter(h => (h.td||0) > tdLine).length : 0;
      const tierLabel = `vs ${oppTdTier} tddef opponents (${oppTdDef}% tier, ${tdTierMatches.length} fights)`;
      if (tdLine) {
        const tdDiff = avgTD_tier - tdLine;
        if (tdDiff > 1.5) { tdScore += 1.5; reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — ${tdHits}/${tdTierMatches.length} clears line` }); }
        else if (tdDiff > 0.5) { tdScore += 0.8; reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` }); }
        else if (tdDiff < -1.5) { tdScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — wall keeps them out` }); }
        else if (tdDiff < -0.5) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` }); }
      }
    } else if (oppTdDef > 78 && tdLine) {
      tdScore -= 0.8; reasons.push({ icon:'neg', text:`Opponent has elite TD defense (${oppTdDef}%) — historical pattern suggests under on TDs` });
    } else if (oppTdDef < 50 && tdLine) {
      tdScore += 0.8; reasons.push({ icon:'pos', text:`Opponent has poor TD defense (${oppTdDef}%) — prime target for takedowns` });
    }
  }

  if (oppStyle && oppStrDef != null) {
    const getStrDefTier = (d: number) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
    const oppTier = getStrDefTier(oppStrDef);
    const comboMatches = history.filter(h => {
      const p = statsCache[h.opp];
      return p?.loaded && p.style === oppStyle && p.strDef != null && getStrDefTier(p.strDef) === oppTier;
    });
    if (comboMatches.length >= 2) {
      const avgSS = comboMatches.reduce((s,h) => s + (h.sigStr||0), 0) / comboMatches.length;
      const avgTD = comboMatches.reduce((s,h) => s + (h.td||0),     0) / comboMatches.length;
      const avgFP = comboMatches.reduce((s,h) => s + (h.fp||0),     0) / comboMatches.length;
      const lbl = `vs similar ${oppStyle}/${oppTier}-def opponents (${comboMatches.length} fights)`;
      if (ssLine) {
        const diff = avgSS - ssLine;
        const rate = comboMatches.filter(h=>(h.sigStr||0)>ssLine).length;
        if (Math.abs(diff) > 6) {
          const icon: 'pos'|'neg' = diff > 0 ? 'pos' : 'neg';
          ssScore += diff > 0 ? 1.5 : -1.5;
          reasons.push({ icon, text:`🎯 Strong pattern: ${avgSS.toFixed(0)} avg SS ${lbl} — ${rate}/${comboMatches.length} clears line` });
        }
      }
      if (tdLine) {
        const diff = avgTD - tdLine;
        const rate = comboMatches.filter(h=>(h.td||0)>tdLine).length;
        if (Math.abs(diff) > 0.8) {
          const icon: 'pos'|'neg' = diff > 0 ? 'pos' : 'neg';
          tdScore += diff > 0 ? 1.5 : -1.5;
          reasons.push({ icon, text:`🎯 Strong pattern: ${avgTD.toFixed(1)} avg TDs ${lbl} — ${rate}/${comboMatches.length} clears line` });
        }
      }
      if (fpLine) {
        const diff = avgFP - fpLine;
        if (Math.abs(diff) > 10) {
          score += diff > 0 ? 1 : -1;
          reasons.push({ icon: diff>0?'pos':'neg', text:`🎯 ${avgFP.toFixed(1)} avg FP ${lbl}` });
        }
      }
    }
  }
  return { score, ssScore, tdScore, reasons };
}

// ── AI ENHANCEMENTS: Multivariate Scoring System ──────────────────────────

/** #11: Weighted Recent Form Curve - Exponential decay prioritizes recent fights */
function calcWeightedFormTrend(history: FightResult[]): { trend: number; label: string } {
  if (history.length < 3) return { trend: 0, label: 'Insufficient recent history' };
  const recent = history.slice(0, 5);
  const weights = recent.map((_, i) => Math.pow(0.75, i)); // 0.75 = recent fights worth 75% of previous
  const totalW = weights.reduce((s, w) => s + w, 0);
  const weightedAvg = recent.reduce((s, f, i) => s + (f.fp || 0) * weights[i], 0) / totalW;
  const careerAvg = history.reduce((s, f) => s + (f.fp || 0), 0) / history.length;
  const trend = weightedAvg - careerAvg;
  const label = trend > 5 ? '📈 Strong uptrend' : trend > 2 ? '📈 Slight uptrend' : trend < -5 ? '📉 Strong downtrend' : trend < -2 ? '📉 Slight downtrend' : '➡️ Stable';
  return { trend, label };
}

interface StatTrend {
  recentAvg: number | null;
  careerAvg: number | null;
  delta: number | null;
  direction: 'up' | 'down' | 'flat' | null;
}

function calcStatTrend(
  history: FightResult[],
  getValue: (f: FightResult) => number | null | undefined,
  threshold: number,
  n = 3
): StatTrend {
  const allVals = history
    .map(getValue)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  // Need enough total fights so that career avg is meaningful beyond the recent window
  if (allVals.length < n + 2) return { recentAvg: null, careerAvg: null, delta: null, direction: null };
  const recentVals = allVals.slice(0, n);
  const recentAvg  = recentVals.reduce((s, v) => s + v, 0) / recentVals.length;
  const careerAvg  = allVals.reduce((s, v) => s + v, 0) / allVals.length;
  const delta = parseFloat((recentAvg - careerAvg).toFixed(1));
  const direction: 'up' | 'down' | 'flat' = delta > threshold ? 'up' : delta < -threshold ? 'down' : 'flat';
  return {
    recentAvg: parseFloat(recentAvg.toFixed(1)),
    careerAvg: parseFloat(careerAvg.toFixed(1)),
    delta,
    direction,
  };
}

/** #12: Opponent Strength Adjustment - Rate opponent quality then adjust */
function calcOpponentStrengthScore(oppDB: FighterDB|null): { score: number; label: string } {
  if (!oppDB || !oppDB.loaded) return { score: 0, label: 'Opponent not loaded' };
  const oppAvgFP = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
  const oppStreak = oppDB.streak?.type === 'hot' ? 1 : oppDB.streak?.type === 'cold' ? -1 : 0;
  const oppConsistency = oppDB.fpConsistency || 50;
  const sampleSize = oppDB.history?.length || 0;
  const sampleFactor = Math.min(0.25, sampleSize / 30);
  const strengthScore = ((oppAvgFP - 58) / 16) + ((oppConsistency - 55) / 28) + (oppStreak * 0.18) + sampleFactor;
  const isElite = sampleSize >= 6 && oppAvgFP >= 82 && oppConsistency >= 62 && strengthScore >= 1.45;
  const isStrong = sampleSize >= 4 && oppAvgFP >= 68 && strengthScore >= 0.75;
  const label = isElite ? '🏆 Elite opponent' : isStrong ? '⭐ Strong opponent' : strengthScore > -0.2 ? '👤 Average opponent' : '↓ Below avg opponent';
  return { score: strengthScore, label };
}

/** #13: Fight Context Factors - Home/away, short notice, title fights */
function calcFightContextScore(history: FightResult[]): { score: number; reasons: LeanReason[] } {
  const reasons: LeanReason[] = [];
  let score = 0;
  
  if (history.length < 2) return { score, reasons };
  
  const recent = history?.[0];
  if (!recent) return { score, reasons };
  
  // Short notice detection (if date is available and < 2 weeks to prep)
  const recentFightDate = recent.date ? new Date(recent.date).getTime() : null;
  const prevFightDate = history[1]?.date ? new Date(history[1].date).getTime() : null;
  if (recentFightDate && prevFightDate) {
    const daysBetween = (recentFightDate - prevFightDate) / (1000 * 60 * 60 * 24);
    if (daysBetween < 14 && daysBetween > 0) {
      score -= 1.5;
      reasons.push({ icon: 'neg', text: `⚡ Short notice: Only ${Math.round(daysBetween)} days between fights — underperformance expected` });
    }
  }
  
  return { score, reasons };
}

/** #16: Burnout/Rest Cycle Detection - Days since last fight analysis */
function calcRestCycleFactor(history: FightResult[]): { score: number; label: string; daysSince: number } {
  if (!history.length) return { score: 0, label: 'No fight history', daysSince: 0 };
  
  const lastFightDate = history[0]?.date ? new Date(history[0].date).getTime() : Date.now();
  const daysSince = Math.floor((Date.now() - lastFightDate) / (1000 * 60 * 60 * 24));
  
  let score = 0, label = '';
  if (daysSince < 21)      { score = -1.5; label = `⚠️ Only ${daysSince} days rest — likely underperform`; }
  else if (daysSince < 45) { score = -0.5; label = `📅 Recent fight (${daysSince}d) — some rust expected`; }
  else if (daysSince > 180){ score = -0.5; label = `❄️ Long layoff (${daysSince}d) — ring rust possible`; }
  else                      { score = 0.3; label = `✓ Ideal rest (${daysSince}d) — full camp prep`; }
  
  return { score, label, daysSince };
}

/** #18: Peer Comparison Ranking - Compare fighter to weight-class peers */
function calcPeerPercentileRanking(fighter: AnalyzerFighter[], fighter_name: string): { avgFPPercentile: number; consistencyPercentile: number; strikeVolumePercentile: number } {
  const me = fighter.find(f => f.name === fighter_name)?.db;
  if (!me) return { avgFPPercentile: 50, consistencyPercentile: 50, strikeVolumePercentile: 50 };
  
  const peers = fighter.map(f => f.db).filter(f => f.loaded && f !== me);
  if (peers.length < 3) return { avgFPPercentile: 50, consistencyPercentile: 50, strikeVolumePercentile: 50 };
  
  const avgFPs = peers.map(p => p.avgFP || 0).filter(v => v > 0);
  const consistencies = peers.map(p => p.fpConsistency || 50);
  const strikeVols = peers.map(p => p.slpm || 0);
  
  const avgFPPercentile = avgFPs.length ? Math.round(100 * avgFPs.filter(v => (me.avgFP || 0) > v).length / avgFPs.length) : 50;
  const consistencyPercentile = consistencies.length ? Math.round(100 * consistencies.filter(v => (me.fpConsistency || 50) > v).length / consistencies.length) : 50;
  const strikeVolumePercentile = strikeVols.length ? Math.round(100 * strikeVols.filter(v => (me.slpm || 0) > v).length / strikeVols.length) : 50;
  
  return { avgFPPercentile, consistencyPercentile, strikeVolumePercentile };
}

/** #19: Extreme Value Detection - Flag lines 3+ std devs away */
function detectExtremeValue(line: number|null, fpFloor: number|null, fpCeiling: number|null, fpStdDev: number|null, history: FightResult[]): { isExtreme: boolean; label: string; severity: number } {
  if (!line || !fpStdDev || !history.length) return { isExtreme: false, label: '', severity: 0 };
  
  const fpValues = history.filter(f => f.fp != null && f.fp > 0).map(f => f.fp!) as number[];
  if (fpValues.length < 5) return { isExtreme: false, label: 'Insufficient sample', severity: 0 };
  
  const mean = fpValues.reduce((s, v) => s + v, 0) / fpValues.length;
  const stdDevs = Math.abs(line - mean) / fpStdDev;
  
  const isExtreme = stdDevs >= 3;
  const label = stdDevs >= 4 ? '🚨 EXTREME VALUE' : stdDevs >= 3 ? '⚠️ Outlier line' : '';
  
  return { isExtreme, label, severity: stdDevs };
}

/** #20: Multivariate Confidence Scoring - Complex confidence based on multiple factors */
function calcMultivariateConfidence(db: FighterDB, history: FightResult[], score: number, lineStdDevs: number, sampleSize: number, restDaysSince: number): number {
  let conf = 50; // baseline
  
  // Factor 1: Score magnitude (0-3 scale → confidence boost)
  conf += Math.min(25, Math.abs(score) * 8);
  
  // Factor 2: Sample size (need min 10 fights for full confidence)
  const sampleSizeFactor = Math.min(1, (sampleSize - 3) / 10);
  conf = conf * (0.7 + 0.3 * sampleSizeFactor);
  
  // Factor 3: Time decay (recent data more reliable)
  const timeDecayFactor = Math.min(1, Math.max(0.5, 1 - (365 - restDaysSince) / 730));
  conf = conf * (0.8 + 0.2 * timeDecayFactor);
  
  // Factor 4: Consistency level (high consistency = higher confidence)
  const consistency = db.fpConsistency || 50;
  const consistencyFactor = consistency / 100;
  conf = conf * (0.7 + 0.3 * consistencyFactor);
  
  // Factor 5: Recent vs career gap (big gaps = lower confidence in leans)
  const careerAvg = history.reduce((s, f) => s + (f.fp || 0), 0) / history.length;
  const recentAvg = history.slice(0, 3).reduce((s, f) => s + (f.fp || 0), 0) / Math.min(3, history.length);
  const formGap = Math.abs(recentAvg - careerAvg) / (careerAvg || 1);
  const formGapFactor = Math.min(1, Math.max(0.6, 1 - formGap)); // Large gaps reduce confidence
  conf = conf * formGapFactor;
  
  // Factor 6: Extreme value detection penalty
  if (lineStdDevs >= 3) conf = conf * 0.85;
  
  return Math.round(Math.min(95, Math.max(35, conf)));
}

// ── ADVANCED PREDICTION ENHANCEMENTS ──────────────────────────────────────

// #21: Bayesian Probability Framework - Replace linear scoring with probabilistic reasoning
interface BayesianPredictor {
  priorProbability: number; // Base rate from historical data
  likelihoodRatio: number;  // How strongly evidence supports over/under
  posteriorProbability: number; // Updated probability after evidence
}

function calcBayesianLean(db: FighterDB, line: number, opponentDB: FighterDB|null, historicalAccuracy: number = 0.55): { probability: number; confidence: number; lean: 'over'|'under'|'push' } {
  // Prior: Base rate from historical over/under frequency (adjusted by our model's accuracy)
  const prior = historicalAccuracy; // Start with our model's historical accuracy as prior
  
  // Calculate likelihood ratio from evidence strength
  const likelihoodRatio = calculateEvidenceStrength(db, line, opponentDB);
  
  // Bayesian posterior: P(H|E) = P(E|H) * P(H) / P(E)
  // Simplified: posterior = (likelihood * prior) / ((likelihood * prior) + ((1-likelihood) * (1-prior)))
  const posterior = (likelihoodRatio * prior) / ((likelihoodRatio * prior) + ((1 - likelihoodRatio) * (1 - prior)));
  
  return {
    probability: posterior,
    confidence: Math.abs(posterior - 0.5) * 2, // Scale to 0-1 confidence
    lean: posterior > 0.6 ? 'over' : posterior < 0.4 ? 'under' : 'push'
  };
}

function calculateEvidenceStrength(db: FighterDB, line: number, opponentDB: FighterDB|null): number {
  let evidenceStrength = 0.5; // Neutral starting point
  
  // Historical performance evidence
  const avgFP = db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP;
  if (avgFP != null) {
    const diff = avgFP - line;
    const stdDev = db.fpStdDev || 15; // Default std dev if not available
    const zScore = diff / stdDev;
    
    // Convert z-score to probability using sigmoid function
    evidenceStrength = 1 / (1 + Math.exp(-zScore * 0.5));
  }
  
  // Opponent strength adjustment
  if (opponentDB?.loaded) {
    const oppStrength = calcOpponentStrengthScore(opponentDB).score;
    // Stronger opponent reduces evidence strength for over
    evidenceStrength *= (1 - oppStrength * 0.2);
  }
  
  // Recent form adjustment
  const formTrend = calcWeightedFormTrend(db.history || []);
  evidenceStrength += formTrend.trend * 0.05; // Small adjustment for form
  
  // Consistency bonus
  const consistency = db.fpConsistency || 50;
  evidenceStrength *= (0.8 + (consistency / 100) * 0.4); // More consistent = stronger evidence
  
  return Math.max(0.1, Math.min(0.9, evidenceStrength)); // Bound between 0.1 and 0.9
}

// #22: Enhanced Time-Weighting Algorithm - Multi-phase decay with better recency
function advancedTimeWeightedAverage(history: FightResult[], baseLine: number): number {
  if (!history.length) return baseLine;
  
  const now = Date.now();
  const weights = history.map((fight) => {
    const fightDate = fight.date ? new Date(fight.date).getTime() : now - (365 * 24 * 60 * 60 * 1000); // Default to 1 year ago
    const ageInMonths = (now - fightDate) / (1000 * 60 * 60 * 24 * 30);
    
    // Multi-phase decay: Recent fights heavily weighted, then exponential falloff
    if (ageInMonths < 3) return 1.0;        // Last 3 months: full weight
    if (ageInMonths < 6) return 0.8;        // 3-6 months: 80% weight  
    if (ageInMonths < 12) return 0.6;       // 6-12 months: 60% weight
    return Math.pow(0.85, ageInMonths - 12); // Beyond 1 year: exponential decay
  });
  
  const weightedSum = history.reduce((sum, fight, i) => {
    const fp = fight.fp || 0;
    return sum + (fp * weights[i]);
  }, 0);
  
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  
  return totalWeight > 0 ? weightedSum / totalWeight : baseLine;
}

// #23: Regression-Based Line Optimization - Statistical modeling for optimal predictions
function optimizeLinePrediction(fighter: FighterDB, opponent: FighterDB|null): number {
  // Features for regression model (simplified linear combination)
  const features = [
    fighter.avgFP || 50,                    // Base performance
    fighter.slpm || 0,                      // Strike volume
    fighter.strAcc || 45,                   // Strike accuracy
    fighter.avgTD || 0,                     // Takedown average
    fighter.finishRate || 0.4,              // Finish rate
    fighter.fpConsistency || 50,            // Consistency score
    opponent?.avgFP || 50,                  // Opponent strength
    opponent?.sapm || 3,                    // Opponent defense
    opponent?.tdDef || 50,                  // Opponent TD defense
  ];
  
  // Pre-trained coefficients (would be learned from historical data in production)
  // These coefficients represent the relationship between features and optimal line
  const coefficients = [
    0.35,  // avgFP - strong positive correlation
    0.15,  // slpm - moderate positive
    0.08,  // strAcc - small positive
    0.12,  // tdAvg - moderate positive for grapplers
    -0.18, // finishRate - negative (early finishes hurt volume)
    0.06,  // consistency - small positive
    -0.25, // opponent avgFP - strong negative (stronger opponent = lower line)
    -0.10, // opponent sapm - moderate negative
    0.08,  // opponent tdDef - small positive
  ];
  
  // Calculate predicted line using linear combination
  const predictedLine = features.reduce((sum, feature, i) => {
    return sum + (feature * coefficients[i]);
  }, 45); // Base line of 45
  
  // Apply bounds and adjustments
  let optimizedLine = Math.max(20, Math.min(120, predictedLine));
  
  // Style-based adjustments
  if (fighter.style === 'striker') {
    optimizedLine *= 1.1; // Strikers tend to have higher lines
  } else if (fighter.style === 'grappler') {
    optimizedLine *= 0.9; // Grapplers tend to have lower lines
  }
  
  // Recent form adjustment
  const formTrend = calcWeightedFormTrend(fighter.history || []);
  optimizedLine += formTrend.trend * 2; // Recent form can shift line by up to 6 points
  
  return Math.round(optimizedLine);
}

interface PredictionResult {
  lean: 'over'|'under'|'push';
  confidence: number;
  edge: number;
  expectedValue: number;
}

type EnsembleModelName = 'bayesian' | 'historical' | 'regression' | 'style';

interface ModelPrediction extends PredictionResult {}

interface WeightedModelPrediction {
  name: EnsembleModelName;
  prediction: ModelPrediction;
  weight: number;
}

interface EnsemblePrediction {
  finalPrediction: PredictionResult;
  modelAgreement: number;
  confidence: number;
  betSize: number;
}

interface CalibrationSample {
  rawProbability: number;
  outcome: 0|1;
}

interface CalibrationParams {
  a: number;
  b: number;
}

interface ReliabilityBin {
  bucketStart: number;
  bucketEnd: number;
  count: number;
  expected: number;
  actual: number;
}

interface WalkForwardEvent {
  timestamp: number;
  predictions: Array<{fighter: string; prediction: PredictionResult; line: number}>;
  actualResults: Array<{fighter: string; actualFP: number}>;
}

interface WalkForwardFoldResult {
  trainSize: number;
  testSize: number;
  accuracy: number;
  brierScore: number;
  calibrationScore: number;
}

interface WalkForwardResults {
  folds: WalkForwardFoldResult[];
  overallAccuracy: number;
  overallBrierScore: number;
  driftScore: number;
}

class ProbabilityCalibrator {
  fitPlattScaling(samples: CalibrationSample[], iterations: number = 250, lr: number = 0.05): CalibrationParams {
    if (samples.length < 12) {
      return { a: 1, b: 0 };
    }

    let a = 1;
    let b = 0;

    for (let i = 0; i < iterations; i++) {
      let gradA = 0;
      let gradB = 0;

      for (const s of samples) {
        const p = this.clampProb(s.rawProbability);
        const x = Math.log(p / (1 - p));
        const z = a * x + b;
        const pred = 1 / (1 + Math.exp(-z));
        const error = pred - s.outcome;
        gradA += error * x;
        gradB += error;
      }

      gradA /= samples.length;
      gradB /= samples.length;

      a -= lr * gradA;
      b -= lr * gradB;
    }

    return { a, b };
  }

  calibrate(rawProbability: number, params: CalibrationParams): number {
    const p = this.clampProb(rawProbability);
    const x = Math.log(p / (1 - p));
    const z = params.a * x + params.b;
    return this.clampProb(1 / (1 + Math.exp(-z)));
  }

  brierScore(samples: CalibrationSample[], params?: CalibrationParams): number {
    if (!samples.length) return 0;
    const sse = samples.reduce((sum, s) => {
      const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
      return sum + Math.pow(p - s.outcome, 2);
    }, 0);
    return sse / samples.length;
  }

  reliabilityCurve(samples: CalibrationSample[], bins: number = 10, params?: CalibrationParams): ReliabilityBin[] {
    if (!samples.length) return [];
    const bucketed: ReliabilityBin[] = [];

    for (let i = 0; i < bins; i++) {
      const start = i / bins;
      const end = (i + 1) / bins;
      const inBin = samples.filter(s => {
        const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
        return p >= start && (i === bins - 1 ? p <= end : p < end);
      });

      if (!inBin.length) continue;

      const expected = inBin.reduce((sum, s) => {
        const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
        return sum + p;
      }, 0) / inBin.length;
      const actual = inBin.reduce((sum, s) => sum + s.outcome, 0) / inBin.length;

      bucketed.push({
        bucketStart: start,
        bucketEnd: end,
        count: inBin.length,
        expected,
        actual
      });
    }

    return bucketed;
  }

  private clampProb(v: number): number {
    return Math.max(0.01, Math.min(0.99, v));
  }
}

function buildHistoryCalibrationSamples(history: FightResult[], line: number, scale: number = 15): CalibrationSample[] {
  return history
    .filter(h => h.fp != null)
    .map(h => {
      const fp = h.fp || 0;
      const rawProbability = 1 / (1 + Math.exp(-((fp - line) / Math.max(1, scale))));
      return {
        rawProbability,
        outcome: (fp > line ? 1 : 0) as 0|1
      };
    });
}

// #24: Risk Management with Kelly Criterion
class RiskManager {
  private bankroll: number;
  private kellyFraction: number = 0.1; // Conservative Kelly (10% of calculated amount)
  
  constructor(initialBankroll: number = 1000) {
    this.bankroll = initialBankroll;
  }
  
  calculateBetSize(edge: number, odds: number): number {
    if (edge <= 0 || odds <= 1) return 0;
    
    // Kelly Criterion: (edge * odds - 1) / (odds - 1) * bankroll * fraction
    const kelly = (edge * odds - 1) / (odds - 1);
    const betSize = kelly * this.bankroll * this.kellyFraction;
    
    // Conservative limits: max 5% of bankroll, min $5
    return Math.max(5, Math.min(betSize, this.bankroll * 0.05));
  }
  
  updateBankroll(result: number): void {
    this.bankroll += result;
  }
  
  getBankroll(): number {
    return this.bankroll;
  }
  
  assessPortfolioRisk(predictions: Array<{confidence: number, edge: number}>): { totalRisk: number, recommendedAdjustments: string[] } {
    const adjustments: string[] = [];
    let totalRisk = 0;
    
    // Calculate portfolio concentration risk
    const highConfidenceCount = predictions.filter(p => p.confidence > 0.8).length;
    if (highConfidenceCount > predictions.length * 0.6) {
      totalRisk += 0.3;
      adjustments.push('Reduce concentration in high-confidence plays');
    }
    
    // Calculate edge distribution risk
    const avgEdge = predictions.reduce((sum, p) => sum + p.edge, 0) / predictions.length;
    const edgeVariance = predictions.reduce((sum, p) => sum + Math.pow(p.edge - avgEdge, 2), 0) / predictions.length;
    totalRisk += Math.sqrt(edgeVariance) * 0.5; // Standard deviation of edges
    
    if (totalRisk > 0.7) {
      adjustments.push('Diversify across more fighters to reduce risk');
    }
    
    return { totalRisk, recommendedAdjustments: adjustments };
  }
}

// #25: Ensemble Prediction Model - Combine multiple approaches
class EnsemblePredictor {
  private models: Array<{
    name: EnsembleModelName;
    weight: number;
    predictor: (fighter: FighterDB, line: number, opponent: FighterDB|null) => ModelPrediction;
  }> = [
    { name: 'bayesian', weight: 0.35, predictor: this.bayesianModel },
    { name: 'historical', weight: 0.25, predictor: this.historicalModel },
    { name: 'regression', weight: 0.25, predictor: this.regressionModel },
    { name: 'style', weight: 0.15, predictor: this.styleMatchupModel }
  ];
  
  private riskManager = new RiskManager();
  
  predict(fighter: FighterDB, line: number, opponent: FighterDB|null): EnsemblePrediction {
    const adaptiveWeights = this.getAdaptiveModelWeights(fighter, opponent);
    const predictions = this.models.map(model => ({
      name: model.name,
      prediction: model.predictor(fighter, line, opponent),
      weight: adaptiveWeights[model.name] ?? model.weight
    }));
    
    const finalPrediction = this.weightedAverage(predictions);
    const agreement = this.calculateAgreement(predictions);
    const rawConfidence = this.calculateEnsembleConfidence(predictions);
    const confidence = this.adjustConfidenceForDataQuality(fighter, opponent, rawConfidence, agreement);
    
    return {
      finalPrediction: finalPrediction,
      modelAgreement: agreement,
      confidence,
      betSize: this.riskManager.calculateBetSize(
        finalPrediction.edge, 
        this.calculateImpliedOdds(line, finalPrediction.expectedValue)
      )
    };
  }
  
  private bayesianModel(fighter: FighterDB, line: number, opponent: FighterDB|null): ModelPrediction {
    const bayesian = calcBayesianLean(fighter, line, opponent);
    return {
      lean: bayesian.lean,
      confidence: bayesian.confidence,
      edge: Math.abs(bayesian.probability - 0.5) * 2,
      expectedValue: bayesian.probability
    };
  }
  
  private historicalModel(fighter: FighterDB, line: number, opponent: FighterDB|null): ModelPrediction {
    const avgFP = advancedTimeWeightedAverage(fighter.history || [], line);
    const edge = (avgFP - line) / line;
    return {
      lean: edge > 0.05 ? 'over' : edge < -0.05 ? 'under' : 'push',
      confidence: Math.min(0.9, Math.abs(edge) * 10),
      edge: Math.abs(edge),
      expectedValue: avgFP > line ? 0.6 : 0.4
    };
  }
  
  private regressionModel(fighter: FighterDB, line: number, opponent: FighterDB|null): ModelPrediction {
    const optimizedLine = optimizeLinePrediction(fighter, opponent);
    const edge = (optimizedLine - line) / line;
    return {
      lean: edge > 0.03 ? 'over' : edge < -0.03 ? 'under' : 'push',
      confidence: Math.min(0.85, Math.abs(edge) * 15),
      edge: Math.abs(edge),
      expectedValue: optimizedLine > line ? 0.55 : 0.45
    };
  }
  
  private styleMatchupModel(fighter: FighterDB, line: number, opponent: FighterDB|null): ModelPrediction {
    if (!opponent) return { lean: 'push', confidence: 0.5, edge: 0, expectedValue: 0.5 };
    
    const { delta } = styleMatchupEdge(fighter.style, opponent.style, fighter, opponent);
    const edge = delta * 0.1; // Convert score delta to edge
    return {
      lean: edge > 0.05 ? 'over' : edge < -0.05 ? 'under' : 'push',
      confidence: Math.min(0.8, Math.abs(edge) * 8),
      edge: Math.abs(edge),
      expectedValue: 0.5 + edge
    };
  }
  
  private weightedAverage(predictions: WeightedModelPrediction[]): PredictionResult {
    const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0);
    
    const weightedLean = predictions.reduce((result, p) => {
      const weight = p.weight / totalWeight;
      result.overWeight += p.prediction.lean === 'over' ? weight : 0;
      result.underWeight += p.prediction.lean === 'under' ? weight : 0;
      result.confidence += p.prediction.confidence * weight;
      result.edge += p.prediction.edge * weight;
      result.expectedValue += p.prediction.expectedValue * weight;
      return result;
    }, { overWeight: 0, underWeight: 0, confidence: 0, edge: 0, expectedValue: 0 });
    
    const lean = weightedLean.overWeight > weightedLean.underWeight ? 'over' : 
                 weightedLean.underWeight > weightedLean.overWeight ? 'under' : 'push';
    const directionalProb = Math.max(weightedLean.overWeight, weightedLean.underWeight);
    const directionalEdge = Math.abs(weightedLean.overWeight - weightedLean.underWeight);

    return {
      lean,
      confidence: weightedLean.confidence,
      edge: Math.max(directionalEdge, weightedLean.edge * 0.6),
      expectedValue: lean === 'push' ? 0.5 : directionalProb
    };
  }
  
  private calculateAgreement(predictions: Array<{prediction: ModelPrediction}>): number {
    const leans = predictions.map(p => p.prediction.lean);
    const mostCommon = leans.reduce((acc, lean) => {
      acc[lean] = (acc[lean] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const maxAgreement = Math.max(...(Object.values(mostCommon) as number[]));
    return maxAgreement / predictions.length;
  }
  
  private calculateEnsembleConfidence(predictions: Array<{prediction: ModelPrediction, weight: number}>): number {
    const avgConfidence = predictions.reduce((sum, p) => sum + p.prediction.confidence * p.weight, 0) / 
                         predictions.reduce((sum, p) => sum + p.weight, 0);
    
    const agreement = this.calculateAgreement(predictions);
    
    // Boost confidence when models agree
    return Math.min(0.95, avgConfidence * (0.8 + agreement * 0.4));
  }

  private getAdaptiveModelWeights(fighter: FighterDB, opponent: FighterDB|null): Record<string, number> {
    const sampleSize = Math.max(0, fighter.history?.length || 0);
    const consistency = (fighter.fpConsistency ?? 50) / 100;
    const stdDev = fighter.fpStdDev ?? 18;

    let wBayes = 0.35;
    let wHist = 0.25;
    let wReg = 0.25;
    let wStyle = 0.15;

    if (sampleSize < 8) {
      wBayes += 0.08;
      wStyle += 0.05;
      wHist -= 0.08;
      wReg -= 0.05;
    }

    if (consistency < 0.45) {
      wBayes += 0.06;
      wStyle += 0.03;
      wHist -= 0.05;
      wReg -= 0.04;
    }

    if (stdDev > 24) {
      wBayes += 0.05;
      wStyle += 0.03;
      wHist -= 0.04;
      wReg -= 0.04;
    }

    if (!opponent?.loaded) {
      wStyle -= 0.08;
      wBayes += 0.04;
      wHist += 0.02;
      wReg += 0.02;
    }

    const safe = [wBayes, wHist, wReg, wStyle].map(v => Math.max(0.05, v));
    const total = safe.reduce((s, v) => s + v, 0);

    return {
      bayesian: safe[0] / total,
      historical: safe[1] / total,
      regression: safe[2] / total,
      style: safe[3] / total
    };
  }

  private adjustConfidenceForDataQuality(fighter: FighterDB, opponent: FighterDB|null, confidence: number, agreement: number): number {
    const sampleSize = Math.max(0, fighter.history?.length || 0);
    const sampleFactor = Math.min(1, sampleSize / 12);
    const consistencyFactor = Math.max(0.45, (fighter.fpConsistency ?? 50) / 100);
    const volatilityPenalty = Math.max(0.65, 1 - Math.max(0, (fighter.fpStdDev ?? 18) - 18) / 40);
    const opponentFactor = opponent?.loaded ? 1 : 0.9;
    const agreementFactor = 0.75 + (agreement * 0.25);

    const quality = sampleFactor * consistencyFactor * volatilityPenalty * opponentFactor;
    const adjusted = confidence * (0.7 + 0.3 * quality) * agreementFactor;
    return Math.max(0.35, Math.min(0.95, adjusted));
  }
  
  private calculateImpliedOdds(line: number, expectedValue: number): number {
    // Simplified odds calculation - in reality would use actual sportsbook odds
    return expectedValue > 0.5 ? 1.9 : 1.9; // Assume -110 odds for simplicity
  }
}

// #26: Backtesting & Validation Framework
class BacktestingEngine {
  private historicalPredictions: Array<{
    fighter: string;
    prediction: PredictionResult;
    actualResult: number;
    line: number;
    timestamp: number;
  }> = [];

  async backtestStrategy(
    predictions: Array<{fighter: string, prediction: PredictionResult, line: number}>,
    actualResults: Array<{fighter: string, actualFP: number}>,
    config: BacktestConfig = {}
  ): Promise<BacktestResults> {
    
    // Store predictions for future analysis
    const timestamp = Date.now();
    predictions.forEach(pred => {
      this.historicalPredictions.push({
        fighter: pred.fighter,
        prediction: pred.prediction,
        actualResult: 0, // Will be updated when results are known
        line: pred.line,
        timestamp
      });
    });

    // Simulate results (in production, this would use real historical data)
    const trades = this.generateTrades(predictions, config);
    const results = this.simulateTrades(trades, actualResults);
    
    return {
      totalReturn: results.totalReturn,
      winRate: results.wins / results.totalTrades,
      profitFactor: results.grossProfit / Math.abs(results.grossLoss),
      maxDrawdown: this.calculateMaxDrawdown(results),
      sharpeRatio: this.calculateSharpeRatio(results),
      monthlyReturns: this.groupByMonth(results),
      predictionAccuracy: this.calculatePredictionAccuracy(predictions, actualResults),
      confidenceCalibration: this.assessConfidenceCalibration(predictions, actualResults)
    };
  }
  
  private generateTrades(
    predictions: Array<{fighter: string, prediction: PredictionResult, line: number}>, 
    config: BacktestConfig
  ): Trade[] {
    const riskManager = new RiskManager(config.initialBankroll || 1000);
    
    return predictions
      .filter(p => p.prediction.confidence > (config.minConfidence || 0.6) && p.prediction.lean !== 'push')
      .map(p => ({
        fighter: p.fighter,
        side: p.prediction.lean as 'over'|'under', // Now safe since we filtered out 'push'
        size: riskManager.calculateBetSize(p.prediction.edge, 1.9), // Assume -110 odds
        entryTime: Date.now(),
        expectedLine: p.line,
        confidence: p.prediction.confidence
      }));
  }
  
  private simulateTrades(trades: Trade[], actualResults: Array<{fighter: string, actualFP: number}>): TradeResults {
    let bankroll = 1000; // Starting bankroll
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    const tradeHistory: Array<{pnl: number, bankroll: number, timestamp: number}> = [];
    
    trades.forEach(trade => {
      const actual = actualResults.find(r => r.fighter === trade.fighter);
      if (!actual) return;
      
      const hit = (trade.side === 'over' && actual.actualFP > trade.expectedLine) ||
                  (trade.side === 'under' && actual.actualFP < trade.expectedLine);
      
      const odds = 1.9; // -110 moneyline
      const pnl = hit ? trade.size * (odds - 1) : -trade.size;
      
      bankroll += pnl;
      if (pnl > 0) {
        grossProfit += pnl;
        wins++;
      } else {
        grossLoss += Math.abs(pnl);
      }
      
      tradeHistory.push({
        pnl,
        bankroll,
        timestamp: trade.entryTime
      });
    });
    
    return {
      totalReturn: (bankroll - 1000) / 1000,
      wins,
      totalTrades: trades.length,
      grossProfit,
      grossLoss,
      tradeHistory
    };
  }
  
  private calculateMaxDrawdown(results: TradeResults): number {
    let peak = 1000;
    let maxDrawdown = 0;
    
    results.tradeHistory.forEach(trade => {
      if (trade.bankroll > peak) {
        peak = trade.bankroll;
      }
      const drawdown = (peak - trade.bankroll) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });
    
    return maxDrawdown;
  }
  
  private calculateSharpeRatio(results: TradeResults): number {
    if (results.tradeHistory.length < 2) return 0;
    
    const returns = results.tradeHistory.map((t, i) => 
      i > 0 ? (t.bankroll - results.tradeHistory[i-1].bankroll) / results.tradeHistory[i-1].bankroll : 0
    ).filter(r => r !== 0);
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Assume 2% risk-free rate (monthly)
    const riskFreeRate = 0.02;
    
    return stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev : 0;
  }
  
  private groupByMonth(results: TradeResults): Array<{month: string, return: number}> {
    const monthly = new Map<string, {startBankroll: number, endBankroll: number}>();
    
    results.tradeHistory.forEach(trade => {
      const date = new Date(trade.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthly.has(monthKey)) {
        monthly.set(monthKey, { startBankroll: 1000, endBankroll: 1000 });
      }
      
      const monthData = monthly.get(monthKey)!;
      monthData.endBankroll = trade.bankroll;
    });
    
    return Array.from(monthly.entries()).map(([month, data]) => ({
      month,
      return: (data.endBankroll - data.startBankroll) / data.startBankroll
    }));
  }
  
  private calculatePredictionAccuracy(
    predictions: Array<{fighter?: string, prediction: PredictionResult, line?: number}>,
    actualResults: Array<{fighter: string, actualFP: number}>
  ): number {
    let correct = 0;
    let total = 0;
    
    predictions.forEach(pred => {
      const actual = actualResults.find(r => r.fighter === (pred.fighter || ''));
      if (actual && pred.prediction.lean !== 'push') {
        const hit = (pred.prediction.lean === 'over' && actual.actualFP > (pred.line || 0)) ||
                    (pred.prediction.lean === 'under' && actual.actualFP < (pred.line || 0));
        if (hit) correct++;
        total++;
      }
    });
    
    return total > 0 ? correct / total : 0;
  }
  
  private assessConfidenceCalibration(
    predictions: Array<{fighter?: string, prediction: PredictionResult, line?: number}>,
    actualResults: Array<{fighter: string, actualFP: number}>
  ): { calibrationScore: number; overconfidence: number; underconfidence: number } {
    // Group predictions by confidence buckets and check actual accuracy
    const buckets = [0.5, 0.6, 0.7, 0.8, 0.9];
    const calibration = buckets.map(bucket => {
      const bucketPreds = predictions.filter(p => p.prediction.confidence >= bucket && p.prediction.confidence < bucket + 0.1);
      const actualAccuracy = this.calculatePredictionAccuracy(bucketPreds, actualResults);
      return { expected: bucket + 0.05, actual: actualAccuracy };
    });
    
    const avgCalibrationError = calibration.reduce((sum, c) => sum + Math.abs(c.expected - c.actual), 0) / calibration.length;
    
    return {
      calibrationScore: 1 - avgCalibrationError, // 1.0 = perfect calibration
      overconfidence: calibration.filter(c => c.actual < c.expected).length / calibration.length,
      underconfidence: calibration.filter(c => c.actual > c.expected).length / calibration.length
    };
  }
  
  getHistoricalPredictions(): Array<{
    fighter: string;
    prediction: PredictionResult;
    actualResult: number;
    line: number;
    timestamp: number;
  }> {
    return this.historicalPredictions;
  }
  
  updateActualResult(fighter: string, timestamp: number, actualFP: number): void {
    const prediction = this.historicalPredictions.find(p => 
      p.fighter === fighter && p.timestamp === timestamp
    );
    if (prediction) {
      prediction.actualResult = actualFP;
    }
  }

  runWalkForwardValidation(events: WalkForwardEvent[], minTrainEvents: number = 6): WalkForwardResults {
    const calibrator = new ProbabilityCalibrator();
    const folds: WalkForwardFoldResult[] = [];

    const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
    if (ordered.length <= minTrainEvents) {
      return { folds: [], overallAccuracy: 0, overallBrierScore: 0, driftScore: 0 };
    }

    for (let i = minTrainEvents; i < ordered.length; i++) {
      const train = ordered.slice(0, i);
      const test = ordered[i];

      const trainSamples = this.buildCalibrationSamplesFromEvents(train);
      const params = calibrator.fitPlattScaling(trainSamples);

      const testSamples = this.buildCalibrationSamplesFromEvents([test]);
      if (!testSamples.length) continue;

      let correct = 0;
      testSamples.forEach(s => {
        const calibrated = calibrator.calibrate(s.rawProbability, params);
        const predicted = calibrated >= 0.5 ? 1 : 0;
        if (predicted === s.outcome) correct++;
      });

      const reliability = calibrator.reliabilityCurve(testSamples, 5, params);
      const calibrationError = reliability.length
        ? reliability.reduce((sum, b) => sum + Math.abs(b.expected - b.actual), 0) / reliability.length
        : 0;

      folds.push({
        trainSize: train.length,
        testSize: test.predictions.length,
        accuracy: correct / testSamples.length,
        brierScore: calibrator.brierScore(testSamples, params),
        calibrationScore: 1 - calibrationError
      });
    }

    if (!folds.length) {
      return { folds: [], overallAccuracy: 0, overallBrierScore: 0, driftScore: 0 };
    }

    const overallAccuracy = folds.reduce((sum, f) => sum + f.accuracy, 0) / folds.length;
    const overallBrierScore = folds.reduce((sum, f) => sum + f.brierScore, 0) / folds.length;
    const avgAcc = overallAccuracy;
    const variance = folds.reduce((sum, f) => sum + Math.pow(f.accuracy - avgAcc, 2), 0) / folds.length;
    const driftScore = Math.sqrt(variance);

    return { folds, overallAccuracy, overallBrierScore, driftScore };
  }

  private buildCalibrationSamplesFromEvents(events: WalkForwardEvent[]): CalibrationSample[] {
    const samples: CalibrationSample[] = [];

    events.forEach(evt => {
      evt.predictions.forEach(pred => {
        if (pred.prediction.lean === 'push') return;
        const actual = evt.actualResults.find(r => r.fighter === pred.fighter);
        if (!actual) return;

        const outcome = actual.actualFP > pred.line ? 1 : 0;
        const rawProbability = pred.prediction.lean === 'over'
          ? pred.prediction.confidence
          : 1 - pred.prediction.confidence;

        samples.push({
          rawProbability: Math.max(0.01, Math.min(0.99, rawProbability)),
          outcome: outcome as 0|1
        });
      });
    });

    return samples;
  }
}

interface BacktestConfig {
  minConfidence?: number;
  initialBankroll?: number;
  maxDrawdownLimit?: number;
  riskPerTrade?: number;
}

interface BacktestResults {
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  monthlyReturns: Array<{month: string, return: number}>;
  predictionAccuracy: number;
  confidenceCalibration: {
    calibrationScore: number;
    overconfidence: number;
    underconfidence: number;
  };
  walkForward?: WalkForwardResults;
}

interface Trade {
  fighter: string;
  side: 'over'|'under';
  size: number;
  entryTime: number;
  expectedLine: number;
  confidence: number;
}

interface TradeResults {
  totalReturn: number;
  wins: number;
  totalTrades: number;
  grossProfit: number;
  grossLoss: number;
  tradeHistory: Array<{pnl: number, bankroll: number, timestamp: number}>;
}

type DFSPlatform = 'betr'|'underdog'|'draftkings'|'prizepicks';
type FighterArchetype =
  'volume_striker'
  | 'power_striker'
  | 'chain_wrestler'
  | 'control_grappler'
  | 'submission_hunter'
  | 'point_fighter'
  | 'balanced_generalist';

interface DFSPlatformScoring {
  sigStrikePoint: number;
  takedownPoint: number;
  controlSecPoint: number;
  knockdownPoint: number;
  finishBonusPoint: number;
  decisionWinBonus: number;
  paceMultiplier: number;
  durabilityMultiplier: number;
}

interface DFSFeatureVector {
  archetype: FighterArchetype;
  expectedSigStrPerMin: number;
  expectedTDAttempts: number;
  expectedTDSuccess: number;
  controlTimeProjection: number;
  finishProbability: number;
  opponentDurabilityScore: number;
  paceProjection: number;
  expectedFightDurationMins: number;
  ssVolumeDurationProduct: number;
  tdAttemptDefenseProduct: number;
  controlGetUpProduct: number;
  finishChinProduct: number;
  round1Aggression: number;
  cardioBuildFactor: number;
  layoffRisk: number;
  ageCurveRisk: number;
  shortNoticeRisk: number;
  altitudeRisk: number;
  pressureFragility: number;
  grapplerVulnerability: number;
  southpawVulnerability: number;
  improvementSignal: number;
  declineSignal: number;
  dataQuality: number;
}

interface SubModelOutput {
  value: number;
  confidence: number;
  reasons: LeanReason[];
}

interface FantasyProjection {
  platform: DFSPlatform;
  expectedScore: number;
  edgeVsLine: number;
  confidence: number;
  reasons: LeanReason[];
}

interface FantasyPredictionBrain {
  buildFeatures: (db: FighterDB, oppDB: FighterDB|null, line: number|null) => DFSFeatureVector;
  strikingModel: (f: DFSFeatureVector, db: FighterDB, oppDB: FighterDB|null) => SubModelOutput;
  grapplingModel: (f: DFSFeatureVector, db: FighterDB, oppDB: FighterDB|null) => SubModelOutput;
  finishingModel: (f: DFSFeatureVector, db: FighterDB, oppDB: FighterDB|null) => SubModelOutput;
  matchupAdjustmentModel: (f: DFSFeatureVector, db: FighterDB, oppDB: FighterDB|null) => SubModelOutput;
  fantasyScoringModel: (platform: DFSPlatform, line: number, f: DFSFeatureVector, strike: SubModelOutput, grapple: SubModelOutput, finish: SubModelOutput, matchup: SubModelOutput) => FantasyProjection;
}

const DFS_PLATFORM_SCORING: Record<DFSPlatform, DFSPlatformScoring> = {
  betr: {
    sigStrikePoint: 0.42,
    takedownPoint: 5.2,
    controlSecPoint: 0.032,
    knockdownPoint: 10,
    finishBonusPoint: 28,
    decisionWinBonus: 28,
    paceMultiplier: 1.06,
    durabilityMultiplier: 0.94
  },
  underdog: {
    sigStrikePoint: 0.40,
    takedownPoint: 5.0,
    controlSecPoint: 0.030,
    knockdownPoint: 10,
    finishBonusPoint: 26,
    decisionWinBonus: 26,
    paceMultiplier: 1.03,
    durabilityMultiplier: 0.96
  },
  draftkings: {
    sigStrikePoint: 0.40,
    takedownPoint: 5.0,
    controlSecPoint: 0.030,
    knockdownPoint: 10,
    finishBonusPoint: 30,
    decisionWinBonus: 30,
    paceMultiplier: 1.0,
    durabilityMultiplier: 1.0
  },
  prizepicks: {
    sigStrikePoint: 0.38,
    takedownPoint: 5.0,
    controlSecPoint: 0.028,
    knockdownPoint: 10,
    finishBonusPoint: 25,
    decisionWinBonus: 26,
    paceMultiplier: 1.02,
    durabilityMultiplier: 0.98
  }
};

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function inferArchetype(db: FighterDB): FighterArchetype {
  const slpm = db.slpm ?? 3.6;
  const td = db.avgTDperFight ?? db.avgTD ?? 0.8;
  const subAvg = (db as FighterDB & { subAvg?: number | null }).subAvg ?? 0;
  const finish = db.finishRate ?? 0.45;
  const acc = db.strAcc ?? 42;
  const consistency = db.fpConsistency ?? 50;

  if (td >= 3 && (db.tdAcc ?? 35) >= 35) return 'chain_wrestler';
  if (td >= 2.2 && slpm < 3.8) return 'control_grappler';
  if (subAvg >= 0.6 || (finish >= 0.58 && td >= 1.8)) return 'submission_hunter';
  if (slpm >= 5.5 && acc >= 45) return 'volume_striker';
  if (finish >= 0.62 && slpm < 5.5) return 'power_striker';
  if (consistency >= 70 && finish < 0.5) return 'point_fighter';
  return 'balanced_generalist';
}

function archetypeMatchupDelta(a: FighterArchetype, b: FighterArchetype): number {
  const key = `${a}->${b}`;
  const matrix: Record<string, number> = {
    'volume_striker->power_striker': 1.4,
    'power_striker->volume_striker': -0.8,
    'chain_wrestler->volume_striker': 1.8,
    'volume_striker->chain_wrestler': -1.0,
    'control_grappler->power_striker': 1.2,
    'power_striker->control_grappler': -0.7,
    'submission_hunter->chain_wrestler': 0.9,
    'point_fighter->power_striker': 0.7,
    'balanced_generalist->balanced_generalist': 0
  };
  return matrix[key] ?? 0;
}

function buildDFSFeatureVector(db: FighterDB, oppDB: FighterDB|null, line: number|null): DFSFeatureVector {
  const archetype = inferArchetype(db);
  const oppArchetype = oppDB ? inferArchetype(oppDB) : 'balanced_generalist';
  const slpm = db.slpm ?? 3.8;
  const sapmOpp = oppDB?.sapm ?? 3.7;
  const tdAvg = db.avgTDperFight ?? db.avgTD ?? 1.0;
  const tdAcc = (db.tdAcc ?? 35) / 100;
  const oppTdDef = (oppDB?.tdDef ?? 58) / 100;
  const finishRate = db.finishRate ?? 0.45;
  const oppFinishRate = oppDB?.finishRate ?? 0.45;
  const paceProjection = ((slpm + sapmOpp + (oppDB?.slpm ?? 3.6) + (db.sapm ?? 3.7)) / 2);
  const expectedSigStrPerMin = (slpm * 0.62) + (sapmOpp * 0.38);

  const tdAttempts = tdAvg / Math.max(0.18, tdAcc);
  const tdSuccess = clamp01(tdAcc * (1 - (oppTdDef * 0.72)));
  const controlProjection = Math.max(0, tdAttempts * tdSuccess * 46);

  const chin = clamp01(1 - ((oppDB?.fpConsistency ?? 55) / 140));
  const durability = clamp01((oppDB?.strDef ?? 52) / 100) * 0.45 + clamp01((oppDB?.tdDef ?? 58) / 100) * 0.35 + clamp01(1 - (oppFinishRate * 0.35)) * 0.2;
  const finishProbability = clamp01((finishRate * 0.62) + ((1 - durability) * 0.28) + (archetypeMatchupDelta(archetype, oppArchetype) * 0.03));

  const fiveRoundRate = db.fiveRoundRate ?? 0;
  const expectedFightDurationMins = Math.max(4.5, Math.min(24.5, (15 * (1 - (finishProbability * 0.52))) + (fiveRoundRate * 5)));

  const ssVolumeDurationProduct = expectedSigStrPerMin * expectedFightDurationMins;
  const tdAttemptDefenseProduct = tdAttempts * (1 - oppTdDef);
  const oppGetUpRate = clamp01(1 - ((oppDB?.avgTDperFight ?? 1.2) / 4));
  const controlGetUpProduct = controlProjection * (1 - oppGetUpRate);
  const finishChinProduct = finishProbability * chin;

  const history = db.history || [];
  const recent = history.slice(0, 4);
  const round1Aggression = clamp01(recent.length ? recent.filter(h => (h.round ?? 3) <= 1).length / recent.length : 0.25);
  const cardioBuildFactor = clamp01((db.avgFP_perRound ?? 9) / 14);
  const lastFightDate = history[0]?.date ? new Date(history[0].date).getTime() : null;
  const daysSinceLastFight = lastFightDate ? (Date.now() - lastFightDate) / 86400000 : 160;
  const layoffRisk = clamp01((daysSinceLastFight - 210) / 300);
  const ageCurveRisk = clamp01(((db.fpStdDev ?? 18) - 14) / 22);
  const shortNoticeRisk = clamp01((history.length < 4 ? 0.18 : 0.05) + (Math.abs((db.avgFP_weighted ?? db.avgFP_p6 ?? 0) - (db.avgFP_p6 ?? 0)) > 12 ? 0.08 : 0));
  const altitudeRisk = clamp01((paceProjection > 8.5 ? 0.16 : 0.06) + (db.style === 'grappler' ? 0.06 : 0));
  const pressureFragility = clamp01((db.fpConsistency != null ? (100 - db.fpConsistency) / 120 : 0.35));
  const grapplerVulnerability = clamp01(((db.tdDef ?? 58) < 55 ? 0.55 : 0.18) + (db.style === 'striker' ? 0.15 : 0));
  const southpawVulnerability = clamp01(((db.stance || '').toLowerCase().includes('south') ? 0.1 : 0.2) + (db.strAcc != null && db.strAcc < 40 ? 0.15 : 0));
  const improvementSignal = clamp01(((db.avgFP_weighted ?? db.avgFP_p6 ?? 0) - (db.avgFP_p6 ?? 0) + 10) / 25);
  const declineSignal = clamp01(((db.avgFP_p6 ?? 0) - (db.avgFP_weighted ?? db.avgFP_p6 ?? 0) + 10) / 25);
  const dataQuality = clamp01((history.length / 10) * 0.7 + ((oppDB?.loaded ? 1 : 0) * 0.3));

  const lineAdj = line != null ? Math.max(-0.15, Math.min(0.15, (line - (db.avgFP_p6 ?? line)) / 100)) : 0;
  return {
    archetype,
    expectedSigStrPerMin: Math.max(1.2, expectedSigStrPerMin + lineAdj),
    expectedTDAttempts: Math.max(0.2, tdAttempts),
    expectedTDSuccess: tdSuccess,
    controlTimeProjection: controlProjection,
    finishProbability,
    opponentDurabilityScore: durability,
    paceProjection,
    expectedFightDurationMins,
    ssVolumeDurationProduct,
    tdAttemptDefenseProduct,
    controlGetUpProduct,
    finishChinProduct,
    round1Aggression,
    cardioBuildFactor,
    layoffRisk,
    ageCurveRisk,
    shortNoticeRisk,
    altitudeRisk,
    pressureFragility,
    grapplerVulnerability,
    southpawVulnerability,
    improvementSignal,
    declineSignal,
    dataQuality
  };
}

const fantasyBrain: FantasyPredictionBrain = {
  buildFeatures: buildDFSFeatureVector,

  strikingModel: (f, db, oppDB) => {
    const sigStr = f.ssVolumeDurationProduct * (1 + (f.improvementSignal - f.declineSignal) * 0.12);
    const matchup = archetypeMatchupDelta(f.archetype, inferArchetype(oppDB || db));
    const adjusted = Math.max(8, sigStr + (matchup * 2));
    const confidence = clamp01((0.45 + f.dataQuality * 0.35 + clamp01((db.strAcc ?? 42) / 100) * 0.2) - (f.layoffRisk * 0.08));
    const reasons: LeanReason[] = [
      { icon: adjusted > sigStr ? 'pos' : 'neu', text: `Striking model: ${f.expectedSigStrPerMin.toFixed(2)} SS/min over ${f.expectedFightDurationMins.toFixed(1)} mins projects ~${adjusted.toFixed(1)} SS` }
    ];
    if (f.archetype === 'volume_striker') reasons.push({ icon: 'pos', text: 'Archetype edge: volume striker profile scales well with DFS strike scoring' });
    return { value: adjusted, confidence, reasons };
  },

  grapplingModel: (f, db, oppDB) => {
    const expectedTD = f.expectedTDAttempts * f.expectedTDSuccess;
    const controlSec = Math.max(0, f.controlTimeProjection * (1 - f.altitudeRisk * 0.25));
    const grapplingScore = (expectedTD * 8.4) + (controlSec / 18);
    const confidence = clamp01((0.42 + f.dataQuality * 0.3 + clamp01(((db.tdAcc ?? 35) / 100)) * 0.25) - (f.grapplerVulnerability * 0.05));
    const reasons: LeanReason[] = [
      { icon: expectedTD > 2 ? 'pos' : 'neu', text: `Grappling model: ${f.expectedTDAttempts.toFixed(1)} TD attempts at ${(f.expectedTDSuccess * 100).toFixed(0)}% success projects ${expectedTD.toFixed(1)} TDs` },
      { icon: controlSec > 120 ? 'pos' : 'neu', text: `Control projection: ~${Math.round(controlSec)}s expected control time after matchup adjustments` }
    ];
    if (oppDB && (oppDB.tdDef ?? 58) < 50) reasons.push({ icon: 'pos', text: 'Opponent TD defense profile is exploitable for fantasy grappling accumulation' });
    return { value: grapplingScore, confidence, reasons };
  },

  finishingModel: (f, db) => {
    const kdProjection = Math.max(0.1, (db.slpm ?? 3.8) * (db.strAcc ?? 42) / 430);
    const finishScore = (f.finishProbability * 30) + (kdProjection * 10) + (f.round1Aggression * 4);
    const confidence = clamp01(0.35 + f.dataQuality * 0.28 + f.finishProbability * 0.37);
    const reasons: LeanReason[] = [
      { icon: f.finishProbability > 0.52 ? 'pos' : 'neu', text: `Finishing model: finish probability ${(f.finishProbability * 100).toFixed(1)}% with KD projection ${kdProjection.toFixed(2)}` },
      { icon: f.round1Aggression > 0.4 ? 'pos' : 'neu', text: f.round1Aggression > 0.4 ? 'Fast-starter tendency detected from recent rounds' : 'Balanced start profile; finish odds more distributed across rounds' }
    ];
    return { value: finishScore, confidence, reasons };
  },

  matchupAdjustmentModel: (f, db, oppDB) => {
    const oppArch = inferArchetype(oppDB || db);
    const styleDelta = archetypeMatchupDelta(f.archetype, oppArch);
    const tempoAdj = (f.paceProjection - 7.3) * 0.8;
    const cardioAdj = (f.cardioBuildFactor - 0.5) * 3;
    const sosAdj = oppDB?.fpConsistency != null ? ((oppDB.fpConsistency - 55) / 20) : 0;
    const regressionRisk = (f.layoffRisk + f.ageCurveRisk + f.shortNoticeRisk + f.altitudeRisk) * -1.2;
    const value = styleDelta + tempoAdj + cardioAdj - sosAdj + regressionRisk;
    const confidence = clamp01(0.4 + f.dataQuality * 0.3 + clamp01(Math.abs(styleDelta) / 2.5) * 0.3);
    const reasons: LeanReason[] = [
      { icon: value >= 0 ? 'pos' : 'neg', text: `Matchup model: archetype clash ${f.archetype.replace('_', ' ')} vs ${oppArch.replace('_', ' ')} yields ${value >= 0 ? '+' : ''}${value.toFixed(2)} adjustment` },
      { icon: tempoAdj >= 0 ? 'pos' : 'neg', text: `Pace projection ${f.paceProjection.toFixed(1)} events/min with expected duration ${f.expectedFightDurationMins.toFixed(1)} mins` }
    ];
    if (f.grapplerVulnerability > 0.55) reasons.push({ icon: 'neg', text: 'Heuristic risk: vulnerability versus sustained grappling pressure remains elevated' });
    if (f.southpawVulnerability > 0.28) reasons.push({ icon: 'neg', text: 'Heuristic risk: profile historically volatile in stance-mismatch matchups' });
    return { value, confidence, reasons };
  },

  fantasyScoringModel: (platform, line, f, strike, grapple, finish, matchup) => {
    const scoring = DFS_PLATFORM_SCORING[platform];
    const expectedSigStr = strike.value;
    const expectedTD = Math.max(0.2, f.expectedTDAttempts * f.expectedTDSuccess);
    const expectedControl = Math.max(0, f.controlTimeProjection);
    const expectedKD = Math.max(0.08, finish.value / 45);
    const finishBonus = f.finishProbability * scoring.finishBonusPoint;
    const decisionBonus = (1 - f.finishProbability) * scoring.decisionWinBonus * 0.48;

    const baseFantasyScore =
      expectedSigStr * scoring.sigStrikePoint +
      expectedTD * scoring.takedownPoint +
      expectedControl * scoring.controlSecPoint +
      expectedKD * scoring.knockdownPoint +
      finishBonus +
      decisionBonus;

    const platformArchetypeMultiplier =
      f.archetype === 'volume_striker' ? 1 + (scoring.paceMultiplier - 1) * 0.9 :
      f.archetype === 'chain_wrestler' || f.archetype === 'control_grappler' ? 1 + ((scoring.controlSecPoint / 0.03) - 1) * 0.8 :
      f.archetype === 'power_striker' ? 1 + ((scoring.finishBonusPoint / 30) - 1) * 0.7 :
      1.0;

    const riskDampener = 1 - ((f.layoffRisk + f.ageCurveRisk + f.shortNoticeRisk + f.altitudeRisk) * 0.12);
    const adjustedScore = (baseFantasyScore * platformArchetypeMultiplier * scoring.durabilityMultiplier * scoring.paceMultiplier * Math.max(0.75, riskDampener)) + matchup.value;
    const edgeVsLine = adjustedScore - line;

    const modelAgreement = (strike.confidence + grapple.confidence + finish.confidence + matchup.confidence) / 4;
    const confidence = clamp01(modelAgreement * 0.78 + clamp01(Math.abs(edgeVsLine) / 30) * 0.22);

    const reasons: LeanReason[] = [
      { icon: edgeVsLine >= 0 ? 'pos' : 'neg', text: `${platform.toUpperCase()} projection ${adjustedScore.toFixed(1)} vs line ${line.toFixed(1)} (edge ${edgeVsLine >= 0 ? '+' : ''}${edgeVsLine.toFixed(1)})` },
      { icon: 'neu', text: `Derived DFS features: SS×duration ${f.ssVolumeDurationProduct.toFixed(1)}, TD×defense ${f.tdAttemptDefenseProduct.toFixed(2)}, control×get-up ${f.controlGetUpProduct.toFixed(1)}` }
    ];

    return {
      platform,
      expectedScore: adjustedScore,
      edgeVsLine,
      confidence,
      reasons: [...strike.reasons.slice(0, 1), ...grapple.reasons.slice(0, 1), ...finish.reasons.slice(0, 1), ...matchup.reasons.slice(0, 1), ...reasons]
    };
  }
};

// ── BRAIN V2 OVERLAY ─────────────────────────────────────────────────────
interface AgentLoop {
  step_1_favorite_status: string;
  step_2_style_vs_scoring: {
    over_conditions: string[];
    under_conditions: string[];
  };
  step_3_matchup_dynamics: string[];
  step_4_finish_equity: {
    over: string;
    under: string;
  };
  step_5_extreme_favorite_rule: {
    threshold: string;
    logic: string;
    treatment: string;
  };
  step_6_final_lean: string;
}

interface BrainModules {
  module_1_favorite_logic: {
    standard_favorites: {
      rule: string;
      requirements: string[];
    };
    heavy_favorites: {
      range: string;
      rule: string;
    };
    extreme_favorites: {
      range: string;
      rule: string;
      outcome: string;
      example_pinto: {
        favorite_line: string;
        advantages: string[];
        lean: string;
      };
    };
  };
  module_2_underdog_logic: {
    control_dependent: {
      rule: string;
      lean: string;
      example_roman: string;
    };
    low_pace: {
      rule: string;
      lean: string;
      example_franco: string;
    };
    mismatch_underdogs: {
      rule: string;
      lean: string;
    };
  };
  module_3_matchup_dynamics: {
    pressure_dynamics: string;
    defensive_leaks: string;
    finish_equity: {
      multi_path: string;
      moment_dependent: string;
    };
  };
  module_4_scoring_path_architecture: {
    multi_path_scorers: {
      paths: string[];
      lean: string;
    };
    single_path_scorers: {
      paths: string[];
      lean: string;
    };
  };
  module_5_extreme_favorite_mismatch: {
    structural_smash_equity: string;
    weak_opponent_inflation: string;
    redundant_scoring_paths: string;
    underdog_collapse: string;
    example_pinto_franco: {
      pinto: string;
      franco: string;
      result: string;
    };
  };
}

interface GlobalSummary {
  rules: string[];
}

interface UFCAnalyzerBrainV2 {
  agent_loop: AgentLoop;
  brain_modules: BrainModules;
  global_summary: GlobalSummary;
}

const UFC_ANALYZER_BRAIN_V2: UFCAnalyzerBrainV2 = {
  agent_loop: {
    step_1_favorite_status: 'Identify favorite or underdog.',
    step_2_style_vs_scoring: {
      over_conditions: ['High pace', 'High output', 'Pressure', 'Damage', 'Multiple scoring paths', 'Opponent defensive leaks'],
      under_conditions: ['Low pace', 'Control-dependent grappling', 'Single-path scoring', 'Cannot win minutes']
    },
    step_3_matchup_dynamics: ['Pressure suppresses underdog output', 'Defensive leaks inflate favorite scoring'],
    step_4_finish_equity: { over: 'Multiple finishing paths', under: 'Moment-dependent or control-dependent' },
    step_5_extreme_favorite_rule: {
      threshold: '-600',
      logic: 'Extreme favorites are structural smash spots with inflated scoring ceilings.',
      treatment: 'Treat as top-tier OVER unless style contradicts.'
    },
    step_6_final_lean: 'Combine style + matchup + win equity + opponent defense to produce OVER/UNDER.'
  },
  brain_modules: {
    module_1_favorite_logic: {
      standard_favorites: {
        rule: 'Favorite status boosts OVER only if style supports it.',
        requirements: ['High pace', 'High output', 'Pressure', 'Damage', 'Multiple scoring paths', 'Opponent defensive leaks']
      },
      heavy_favorites: { range: '-300 to -600', rule: 'Win equity amplifies scoring; pressure suppresses underdog output.' },
      extreme_favorites: {
        range: '-600 and above',
        rule: 'Extreme favorites represent massive skill gaps and structural smash equity.',
        outcome: 'High-confidence OVER; top-tier fantasy pick.',
        example_pinto: {
          favorite_line: '-1000',
          advantages: ['Elite pace', 'High damage output', 'Multiple finishing paths', 'Opponent with weak defense'],
          lean: 'Elite OVER'
        }
      }
    },
    module_2_underdog_logic: {
      control_dependent: { rule: 'Needs control to score; collapses under pressure.', lean: 'UNDER', example_roman: 'Low-volume grappler; cannot secure control vs CLD.' },
      low_pace: { rule: 'Low output and no minute-winning tools.', lean: 'UNDER', example_franco: 'Low pace, poor defense, collapses under pressure.' },
      mismatch_underdogs: { rule: 'Output collapses; scoring windows disappear.', lean: 'Strong UNDER' }
    },
    module_3_matchup_dynamics: {
      pressure_dynamics: 'Pressure from favorites reduces underdog attempts and increases favorite scoring.',
      defensive_leaks: 'Weak defense inflates favorite scoring.',
      finish_equity: { multi_path: 'OVER', moment_dependent: 'UNDER' }
    },
    module_4_scoring_path_architecture: {
      multi_path_scorers: { paths: ['Volume', 'Damage', 'Control', 'Finish'], lean: 'OVER' },
      single_path_scorers: { paths: ['Control-only', 'Moment-only'], lean: 'UNDER' }
    },
    module_5_extreme_favorite_mismatch: {
      structural_smash_equity: 'Extreme favorites create inflated scoring environments.',
      weak_opponent_inflation: 'Weak opponents artificially raise favorite ceilings.',
      redundant_scoring_paths: 'Extreme favorites can score by volume, damage, knockdowns, KO, control, or subs.',
      underdog_collapse: 'Underdogs in mismatches produce near-zero offense.',
      example_pinto_franco: {
        pinto: 'Elite pace, damage, finishing threat, -1000 favorite.',
        franco: 'Low pace, poor defense, collapses under pressure.',
        result: 'Pinto = elite OVER; Franco = strong UNDER.'
      }
    }
  },
  global_summary: {
    rules: [
      'Favorite + sustainable scoring = OVER',
      'Heavy favorite + elite pace = HIGH-CONFIDENCE OVER',
      'Extreme favorite (-600+) = SMASH OVER',
      'Underdog + control-dependent or low pace = UNDER',
      'Matchup dynamics override raw averages',
      'Pressure suppresses underdog scoring',
      'Defensive leaks inflate favorite scoring',
      'Multi-path scorers = OVER',
      'Single-path scorers = UNDER',
      'Weak opponents inflate favorite ceilings',
      'Underdogs in mismatches produce near-zero offense'
    ]
  }
};

function getScoringPaths(db: FighterDB): string[] {
  const paths: string[] = [];
  if ((db.slpm ?? 0) >= 4.3) paths.push('Volume');
  if ((db.finishRate ?? 0) >= 0.5) paths.push('Damage');
  if ((db.avgTD ?? 0) >= 1.7 || (db.avgTDperFight ?? 0) >= 1.7) paths.push('Control');
  if ((db.finishRate ?? 0) >= 0.58) paths.push('Finish');
  return paths;
}

function applyBrainV2Overlay(
  db: FighterDB,
  oppDB: FighterDB,
  line: number,
  oppLine: number | null,
  moneyline: number | null,
  oppMoneyline: number | null,
  avgFP: number | null,
  reasons: LeanReason[]
): number {
  const selfBase = db.avgFP_weighted ?? avgFP ?? db.avgFP ?? 0;
  const oppBase = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
  const lineGap = oppLine != null ? line - oppLine : selfBase - oppBase;

  const isFavorite = moneyline != null ? moneyline < 0 : lineGap >= 4;
  const isUnderdog = moneyline != null ? moneyline > 0 : lineGap <= -4;
  const isHeavyFavorite = moneyline != null ? moneyline <= -300 : lineGap >= 10;
  const isExtremeFavorite = moneyline != null ? moneyline <= -600 : lineGap >= 18;

  const overSignals = [
    (db.slpm ?? 0) >= 4.8,
    (avgFP ?? 0) >= line + 4,
    (db.avgTD ?? 0) >= 1.7,
    (db.finishRate ?? 0) >= 0.5,
    (oppDB.strDef ?? 55) < 50 || (oppDB.tdDef ?? 58) < 55 || (oppDB.sapm ?? 3.8) > 4.6,
  ].filter(Boolean).length;

  const underSignals = [
    (db.slpm ?? 0) < 3.4,
    (db.avgTD ?? 0) < 1.2 && (db.tdAcc ?? 40) < 36,
    getScoringPaths(db).length <= 1,
    (db.fpConsistency ?? 55) < 48,
  ].filter(Boolean).length;

  let delta = 0;

  if (isFavorite && overSignals >= 3) {
    delta += 0.8;
    reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[0]} — favorite profile shows sustainable scoring conditions` });
  }

  if (isHeavyFavorite && overSignals >= 2) {
    delta += 0.75;
    reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[1]} — heavy favorite win equity amplifies scoring${moneyline != null ? ` (ML ${moneyline > 0 ? '+' : ''}${moneyline})` : ''}` });
  }

  if (isExtremeFavorite && overSignals >= 2 && getScoringPaths(db).length >= 2) {
    delta += 1.15;
    reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[2]} — extreme mismatch boosts smash OVER expectation${moneyline != null ? ` (ML ${moneyline})` : ' (line-gap proxy)'}` });
  }

  if (moneyline == null && oppMoneyline != null) {
    reasons.push({ icon: 'neu', text: `Moneyline fallback inferred from opponent odds (${oppMoneyline > 0 ? '+' : ''}${oppMoneyline})` });
  }

  if (isUnderdog && underSignals >= 2) {
    delta -= 0.95;
    reasons.push({ icon: 'neg', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[3]} — underdog lacks reliable pace/control paths` });
  }

  const selfPaths = getScoringPaths(db);
  if (selfPaths.length >= 3) {
    delta += 0.6;
    reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[7]} (${selfPaths.join(', ')})` });
  } else if (selfPaths.length <= 1) {
    delta -= 0.55;
    reasons.push({ icon: 'neg', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[8]} — single-path profile adds downside variance` });
  }

  return delta;
}

// ── MONEYLINE-ADJUSTED FP PROJECTION ─────────────────────────────────────
function moneylineToImpliedProb(ml: number): number {
  return ml < 0
    ? Math.abs(ml) / (Math.abs(ml) + 100)
    : 100 / (ml + 100);
}

function calcMLAdjustedFP(history: FightResult[], moneyline: number | null): number | null {
  if (!history.length || moneyline == null || !Number.isFinite(moneyline)) return null;

  const wins   = history.filter(h => h.result === 'win'  && h.fp != null && h.fp > 0);
  const losses = history.filter(h => h.result === 'loss' && h.fp != null && h.fp > 0);
  if (!wins.length && !losses.length) return null;
  // Need both sides for the weighting to be meaningful
  if (!wins.length || !losses.length) return null;

  function weightedAvg(fights: FightResult[]): number {
    const w = fights.map((_, i) => Math.pow(0.85, i));
    const tot = w.reduce((s, v) => s + v, 0);
    return fights.reduce((s, f, i) => s + (f.fp ?? 0) * w[i], 0) / tot;
  }

  const winFP  = weightedAvg(wins);
  const lossFP = weightedAvg(losses);
  const p = moneylineToImpliedProb(moneyline);
  return parseFloat((p * winFP + (1 - p) * lossFP).toFixed(1));
}

// ── LEAN ENGINE ────────────────────────────────────────────────────────────
function calcLean(
  name: string,
  db: FighterDB|null,
  line_p6: number|null,
  line_ud: number|null,
  line_pp: number|null,
  line_betr: number|null,
  moneyline: number|null,
  oppDB: FighterDB|null,
  oppLine_p6: number|null = null,
  oppLine_ud: number|null = null,
  oppLine_pp: number|null = null,
  oppLine_betr: number|null = null,
  oppMoneyline: number|null = null,
): LeanResult {
  const availableLines = ([line_p6, line_ud, line_pp, line_betr].filter(l => l != null) as number[]);
  const avgLine = availableLines.length ? parseFloat((availableLines.reduce((s,l) => s+l, 0) / availableLines.length).toFixed(1)) : null;
  const selectedLine =
    currentPlatform === 'pick6' ? line_p6 :
    currentPlatform === 'underdog' ? line_ud :
    currentPlatform === 'prizepicks' ? line_pp :
    currentPlatform === 'draftkings_sportsbook' ? line_p6 :
    line_betr;
  const oppAvailableLines = ([oppLine_p6, oppLine_ud, oppLine_pp, oppLine_betr].filter(l => l != null) as number[]);
  const oppAvgLine = oppAvailableLines.length
    ? parseFloat((oppAvailableLines.reduce((s, l) => s + l, 0) / oppAvailableLines.length).toFixed(1))
    : null;
  const oppSelectedLine =
    currentPlatform === 'pick6' ? oppLine_p6 :
    currentPlatform === 'underdog' ? oppLine_ud :
    currentPlatform === 'prizepicks' ? oppLine_pp :
    currentPlatform === 'draftkings_sportsbook' ? oppLine_p6 :
    oppLine_betr;
  const oppLine = oppSelectedLine ?? oppAvgLine;
  const line = selectedLine ?? avgLine;
  if (!line || !db || !db.loaded) return { lean: 'none', conf: 0, reasons: [], verdict: 'Loading stats...' };

  const platformAvgCandidates = [
    line_p6 != null ? db.avgFP_p6 ?? null : null,
    line_ud != null ? db.avgFP_ud ?? null : null,
    line_pp != null ? db.avgFP_pp ?? null : null,
    line_betr != null ? db.avgFP_betr ?? null : null,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avgFP = platformAvgCandidates.length
    ? parseFloat((platformAvgCandidates.reduce((s, v) => s + v, 0) / platformAvgCandidates.length).toFixed(1))
    : (db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP);
  const history = db.history || [];
  const historyPlatform: 'pick6'|'underdog'|'prizepicks'|'betr' =
    currentPlatform === 'pick6' ? 'pick6' :
    currentPlatform === 'underdog' ? 'underdog' :
    currentPlatform === 'prizepicks' ? 'prizepicks' :
    currentPlatform === 'draftkings_sportsbook' ? 'pick6' :
    'betr';
  const historyFP = history.map(h => getFightFantasyValueForPlatform(h, historyPlatform));
  const mlAdjFP = calcMLAdjustedFP(history, moneyline);
  const reasons: LeanReason[] = [];
  let score = 0;

  if (platformAvgCandidates.length > 1) {
    reasons.push({ icon: 'neu', text: `Platform-aware FP baseline from app-specific scoring profiles across ${platformAvgCandidates.length} books` });
  }

  // Flag line divergence across books — disagreement signals uncertainty or value
  if (availableLines.length > 1) {
    const minL = Math.min(...availableLines);
    const maxL = Math.max(...availableLines);
    if (maxL - minL >= 2.0) {
      const parts = ([['P6', line_p6], ['UD', line_ud], ['PP', line_pp], ['BTR', line_betr]] as [string, number|null][]) 
        .filter(([, v]) => v != null).map(([lbl, v]) => `${lbl} ${v}`).join(' / ');
      if (selectedLine != null) {
        const src = currentPlatform === 'pick6' ? 'P6' : currentPlatform === 'underdog' ? 'UD' : currentPlatform === 'prizepicks' ? 'PP' : currentPlatform === 'draftkings_sportsbook' ? 'DK' : 'BTR';
        reasons.push({ icon: 'neu', text: `Books diverge: ${parts} — using ${src} ${selectedLine} for analysis` });
      } else {
        reasons.push({ icon: 'neu', text: `Books diverge: ${parts} — using avg ${line} for analysis` });
      }
      score += (line_p6 ?? line_ud ?? line_pp ?? line_betr)! < line ? 0.3 : -0.3; // favor the lower-line book slightly
    }
  }

  const platformProjections: number[] = [];

  if (avgFP != null) {
    const diff = avgFP - line;
    if (diff > 12)      { score += 2.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${diff.toFixed(1)} pts above the line — strong over value` }); }
    else if (diff > 5)  { score += 1.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${diff.toFixed(1)} pts above the line` }); }
    else if (diff > 1)  { score += 0.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) slightly edges the line` }); }
    else if (diff < -12){ score -= 2.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${Math.abs(diff).toFixed(1)} pts BELOW the line — line may be set too high` }); }
    else if (diff < -5) { score -= 1.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) trails the line by ${Math.abs(diff).toFixed(1)} pts` }); }
    else if (diff < -1) { score -= 0.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) slightly below the line` }); }
    else                { reasons.push({ icon: 'neu', text: `Historical avg (${avgFP.toFixed(1)} FP) is essentially at the line — genuine toss-up` }); }
  } else {
    reasons.push({ icon: 'neu', text: `No historical FP data available — line analysis based on career stats only` });
  }

  // ── MONEYLINE-ADJUSTED PROJECTION ────────────────────────────────────────
  if (mlAdjFP != null && moneyline != null && avgFP != null) {
    const impliedPct = Math.round(moneylineToImpliedProb(moneyline) * 100);
    const adjDiff = mlAdjFP - line;
    const shift = mlAdjFP - avgFP;
    // Only surface this if the ML adjustment materially changes the picture (≥3 pt shift)
    if (Math.abs(shift) >= 3) {
      const mlLabel = moneyline < 0 ? `${moneyline} (${impliedPct}% win prob)` : `+${moneyline} (${impliedPct}% win prob)`;
      if (adjDiff > 8 && shift > 3) {
        score += 0.8;
        reasons.push({ icon: 'pos', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — win-scenario scoring lifts outlook ${shift > 0 ? '+' : ''}${shift.toFixed(1)} vs raw avg` });
      } else if (adjDiff < -8 && shift < -3) {
        score -= 0.8;
        reasons.push({ icon: 'neg', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — loss-scenario drag pulls outlook ${shift.toFixed(1)} vs raw avg` });
      } else if (shift > 3) {
        score += 0.4;
        reasons.push({ icon: 'pos', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — favorite premium adds +${shift.toFixed(1)} pts to raw avg` });
      } else if (shift < -3) {
        score -= 0.4;
        reasons.push({ icon: 'neg', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — underdog discount trims ${Math.abs(shift).toFixed(1)} pts from raw avg` });
      }
    }
  }

  if (history.length >= 3) {
    const hits = historyFP.filter(v => v != null && v > line).length;
    const rate = hits / history.length;
    if (rate >= 0.75)      { score += 2;   reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) went over this exact line` }); }
    else if (rate >= 0.6)  { score += 1;   reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights over — consistent over tendency` }); }
    else if (rate <= 0.25) { score -= 2;   reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared this line — line is hard to hit` }); }
    else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} fights over — under tendency at this line` }); }
    else                   {               reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} fights over — nearly 50/50` }); }
  }

  if (history.length >= 3 && avgFP != null) {
    const recent = history.slice(0, 3);
    const recentFP = recent.map(h => getFightFantasyValueForPlatform(h, historyPlatform)).filter((v): v is number => v != null);
    const recentAvg = recentFP.length ? recentFP.reduce((s, v) => s + v, 0) / recentFP.length : avgFP;
    const trend = recentAvg - avgFP;
    if (trend > 8)       { score += 1;   reasons.push({ icon: 'pos', text: `Recent form trending UP — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` }); }
    else if (trend < -8) { score -= 1;   reasons.push({ icon: 'neg', text: `Recent form trending DOWN — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` }); }

    // Recent hit rate — more predictive than career hit rate
    const recentHits = recentFP.filter(v => v > line).length;
    if (recentHits === 3)      { score += 1;   reasons.push({ icon: 'pos', text: `Recent hit rate: 3/3 last fights cleared this line — hot right now` }); }
    else if (recentHits === 0) { score -= 1;   reasons.push({ icon: 'neg', text: `Recent hit rate: 0/3 last fights cleared this line — cold streak at this number` }); }
  }

  if (db.style === 'striker') {
    if (db.slpm != null && db.slpm > 6)      { score += 1;   reasons.push({ icon: 'pos', text: `Elite volume striker (${db.slpm.toFixed(1)} SLpM) — naturally high FP ceiling` }); }
    else if (db.slpm != null && db.slpm > 4) { score += 0.3; reasons.push({ icon: 'pos', text: `Active striker (${db.slpm.toFixed(1)} SLpM)` }); }
  } else if (db.style === 'grappler') {
    if (db.avgTD != null && db.avgTD > 3) { score += 0.5; reasons.push({ icon: 'pos', text: `High-volume grappler (${db.avgTD.toFixed(1)} TD/15min) — TD scoring keeps floor high` }); }
    else { score -= 0.5; reasons.push({ icon: 'neg', text: `Grappler style — FP ceiling limited by finishing tendency and low strike volume` }); }
  }

  if (db.finishRate != null) {
    if (db.finishRate > 0.80) { score -= 1.5; reasons.push({ icon: 'neg', text: `Very high finish rate (${Math.round(db.finishRate*100)}%) — frequent early stoppages severely limit counting stats` }); }
    else if (db.finishRate > 0.65) { score -= 1; reasons.push({ icon: 'neg', text: `High finish rate (${Math.round(db.finishRate*100)}%) as winner — early stoppages rob counting stats` }); }
    else if (db.finishRate < 0.35 && history.length >= 4) { score += 0.5; reasons.push({ icon: 'pos', text: `Decision fighter (${Math.round((1-db.finishRate)*100)}% decisions) — fights go full rounds, maximizing volume` }); }
  }

  if (oppDB && oppDB.loaded) {
    const { delta: defDelta, edges: defEdges } = calcOpponentDefenseScore(oppDB, line);
    score += defDelta; reasons.push(...defEdges);

    const oppAllowedSamples = (oppDB.oppHistory || []).slice(0, 5)
      .map((h) => getFightFantasyValueForPlatform(h, historyPlatform))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (oppAllowedSamples.length >= 3) {
      const allowed = oppAllowedSamples.filter((v) => v > line).length;
      const blocked = oppAllowedSamples.length - allowed;
      const allowedRate = allowed / oppAllowedSamples.length;
      if (allowedRate <= 0.30) {
        score -= 1.1;
        reasons.push({ icon: 'neg', text: `Opponent line defense: only ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP (${blocked} held under)` });
      } else if (allowedRate <= 0.45) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Opponent line defense: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
      } else if (allowedRate >= 0.70) {
        score += 1.1;
        reasons.push({ icon: 'pos', text: `Opponent allows coverage often: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
      } else if (allowedRate >= 0.55) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Opponent has allowed this FP range: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
      } else {
        reasons.push({ icon: 'neu', text: `Opponent line-allow rate is mixed: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
      }
    }

    const { delta: matchupDelta, edges: matchupEdges } = styleMatchupEdge(db.style, oppDB.style, db, oppDB);
    score += matchupDelta; reasons.push(...matchupEdges);
    const { score: patScore, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, null, line);
    score += patScore; reasons.push(...patReasons);

    // Contextual favorite/underdog behavior & scoring pressure (add-on module)
    const lineGap = oppLine != null ? (line - oppLine) : null;
    const selfBase = db.avgFP_weighted ?? avgFP ?? db.avgFP ?? 0;
    const oppBase = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
    const inferredGap = selfBase - oppBase;
    // Prefer sportsbook moneyline for fav/dog status — cleaner signal than FP line gap
    const isFavorite = moneyline != null ? moneyline <= -150
      : lineGap != null ? lineGap >= 3 : inferredGap >= 8;
    const isUnderdog = moneyline != null ? moneyline >= 150
      : lineGap != null ? lineGap <= -3 : inferredGap <= -8;
    const isHeavyFavorite = moneyline != null && moneyline <= -300;
    const isHeavyUnderdog = moneyline != null && moneyline >= 300;

    const selfPressureProfile =
      (db.style === 'striker' && (db.slpm ?? 0) >= 4.8)
      || ((db.avgTD ?? 0) >= 2.2)
      || ((db.slpm ?? 0) >= 4.2 && (db.avgTD ?? 0) >= 1.6);
    const oppPressureProfile =
      (oppDB.style === 'striker' && (oppDB.slpm ?? 0) >= 4.8)
      || ((oppDB.avgTD ?? 0) >= 2.2)
      || ((oppDB.slpm ?? 0) >= 4.2 && (oppDB.avgTD ?? 0) >= 1.6);

    const selfDefensiveLeaks =
      (db.strDef ?? 55) < 50
      || (db.tdDef ?? 58) < 55
      || (db.sapm ?? 3.8) > 4.4
      || (db.fpConsistency ?? 55) < 45;
    const oppDefensiveLeaks =
      (oppDB.strDef ?? 55) < 50
      || (oppDB.tdDef ?? 58) < 55
      || (oppDB.sapm ?? 3.8) > 4.4
      || (oppDB.fpConsistency ?? 55) < 45;

    const selfNoMinuteWinningTools =
      (db.slpm ?? 0) < 3.2
      && (db.avgTD ?? 0) < 1.2
      && (db.tdAcc ?? 40) < 36
      && (db.fpConsistency ?? 55) < 50;

    const oneWayTraffic =
      selfPressureProfile
      && oppDefensiveLeaks
      && (
        ((db.slpm ?? 0) - (oppDB.slpm ?? 0) >= 0.8)
        || ((db.avgTD ?? 0) - (oppDB.avgTD ?? 0) >= 1.0)
        || ((oppDB.sapm ?? 3.8) >= 4.8)
        || ((oppDB.fpConsistency ?? 55) <= 42)
      );

    if (isFavorite && selfPressureProfile && oppDefensiveLeaks) {
      score += 1.45;
      reasons.push({ icon: 'pos', text: `Favorite pressure path: projected pace/control can suppress opponent output and expand your scoring windows` });
    }

    if (isFavorite && oneWayTraffic) {
      score += 1.25;
      reasons.push({ icon: 'pos', text: `One-way traffic projection: pressure + opponent defensive fragility point to favorite pace dominance` });
    }

    if (isFavorite) {
      const styleExploitsLeak =
        ((db.slpm ?? 0) >= 4.2 && (oppDB.strDef ?? 55) < 52)
        || ((db.avgTD ?? 0) >= 1.8 && (oppDB.tdDef ?? 58) < 58);
      if (oppDefensiveLeaks && styleExploitsLeak) {
        score += 1.05;
        reasons.push({ icon: 'pos', text: `Opponent defensive leaks (str/td defense + absorption profile) inflate favorite scoring expectation` });
      }
    }

    if (isFavorite && (db.finishRate ?? 0) >= 0.45) {
      const hasDecisionVolume = (db.slpm ?? 0) >= 4.0;
      const hasControlPath = (db.avgTD ?? 0) >= 1.5;
      if (hasDecisionVolume || hasControlPath) {
        score += 1.1;
        reasons.push({ icon: 'pos', text: `Favorite finish equity with redundant scoring paths (volume/finish/control) raises OVER probability` });
      }
    }

    if (isFavorite && (db.finishRate ?? 0) >= 0.55 && avgFP != null && (line - avgFP) <= 5) {
      score += 0.6;
      reasons.push({ icon: 'pos', text: `Favorite can clear via multiple paths even near line (decision volume or early finish upside)` });
    }

    if (isUnderdog && oppPressureProfile && selfDefensiveLeaks) {
      score -= 1.35;
      reasons.push({ icon: 'neg', text: `Underdog suppression risk: opponent pressure profile can shrink your attempts, control time, and scoring windows` });
    }

    if (isUnderdog && selfNoMinuteWinningTools) {
      score -= 1.1;
      reasons.push({ icon: 'neg', text: `Underdog lacks reliable minute-winning tools (volume/control pace), increasing UNDER collapse risk` });
    }

    if (isHeavyFavorite && avgFP != null && line <= avgFP + 6) {
      score += 0.8;
      reasons.push({ icon: 'pos', text: `Heavy favorite (${moneyline}) — structural edge: high implied win probability amplifies scoring ceiling and pace dominance` });
    }
    if (isHeavyUnderdog) {
      score -= 0.7;
      reasons.push({ icon: 'neg', text: `Heavy underdog (${moneyline}) — suppression risk elevated; opponent likely controls pace and shortens the fight` });
    }

    // Brain V2 modular overlay: favorite/underdog engine + scoring-path architecture
    score += applyBrainV2Overlay(db, oppDB, line, oppLine, moneyline, oppMoneyline, avgFP ?? null, reasons);
  } else if (oppDB && !oppDB.loaded) {
    reasons.push({ icon: 'neu', text: `Opponent stats loading — matchup analysis will update shortly` });
  }

  if (db.strAcc != null) {
    if (db.strAcc > 52)      reasons.push({ icon: 'pos', text: `High striking accuracy (${db.strAcc}%) — efficient volume, good FP conversion` });
    else if (db.strAcc < 36) { score -= 0.3; reasons.push({ icon: 'neg', text: `Low striking accuracy (${db.strAcc}%) — volume doesn't always translate to landed strikes` }); }
  }

  if (db.fpFloor != null && db.fpCeiling != null) {
    if (db.fpFloor > line) { score += 1.5; reasons.push({ icon: 'pos', text: `Elite floor: worst recorded game (${db.fpFloor.toFixed(1)} FP) still clears the line — low downside risk` }); }
    else if (db.fpCeiling < line) { score -= 1.5; reasons.push({ icon: 'neg', text: `Hard ceiling: best recorded game (${db.fpCeiling.toFixed(1)} FP) misses the line — very hard to hit over` }); }
    else if (db.fpFloor > line * 0.88 && history.length >= 4) { score += 0.5; reasons.push({ icon: 'pos', text: `Strong floor (${db.fpFloor.toFixed(1)} FP at ${Math.round((db.fpFloor/line)*100)}% of line) — rarely undershoots badly` }); }
  }

  if (db.fpConsistency != null && history.length >= 4) {
    if (db.fpConsistency >= 75) { score += 0.5; reasons.push({ icon: 'pos', text: `High consistency (${db.fpConsistency}%) — FP is predictable and reliable, boosts lean confidence` }); }
    else if (db.fpConsistency <= 35) { score -= 0.5; reasons.push({ icon: 'neg', text: `Volatile fighter (${db.fpConsistency}% consistency) — high variance, line could go either way` }); }
  }

  if (db.streak?.type === 'hot') { score += 0.5; reasons.push({ icon: 'pos', text: `🔥 Hot streak: ${db.streak.text}` }); }
  else if (db.streak?.type === 'cold') { score -= 0.5; reasons.push({ icon: 'neg', text: `❄️ Cold streak: ${db.streak.text}` }); }

  if (db.avgFP_weighted != null && avgFP != null) {
    const drift = db.avgFP_weighted - avgFP;
    if (drift > 10) { score += 0.5; reasons.push({ icon: 'pos', text: `Rising form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) outpacing career avg (${avgFP.toFixed(1)}) by ${drift.toFixed(1)} pts` }); }
    else if (drift < -10) { score -= 0.5; reasons.push({ icon: 'neg', text: `Fading form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) lagging career avg (${avgFP.toFixed(1)}) by ${Math.abs(drift).toFixed(1)} pts` }); }
  }

  if (db.fiveRoundRate != null && db.fiveRoundRate > 0.3 && db.avgFP_perRound != null) {
    const projFiveRound = db.avgFP_perRound * 5;
    if (projFiveRound > line * 1.1) { score += 0.3; reasons.push({ icon: 'pos', text: `${Math.round(db.fiveRoundRate*100)}% of fights go 4-5 rounds — FP ceiling expands significantly in long fights (proj ${projFiveRound.toFixed(1)} over 5R)` }); }
  }

  // ── AI ENHANCEMENTS: Integrate multivariate scoring factors ───────────────
  
  // #11: Weighted Recent Form Curve
  const formTrend = calcWeightedFormTrend(history);
  if (formTrend.trend > 3) { score += 0.3; reasons.push({ icon: 'pos', text: `${formTrend.label} — recent fights outpacing average` }); }
  else if (formTrend.trend < -3) { score -= 0.3; reasons.push({ icon: 'neg', text: `${formTrend.label} — recent fights underperforming career average` }); }
  
  // #12: Opponent Strength Adjustment
  if (oppDB && oppDB.loaded) {
    const oppStrengthScore = calcOpponentStrengthScore(oppDB);
    if (oppStrengthScore.score >= 1.45) { score -= 0.8; reasons.push({ icon: 'neg', text: `${oppStrengthScore.label} — high-level opponent profile increases difficulty` }); }
    else if (oppStrengthScore.score >= 0.75) { score -= 0.35; reasons.push({ icon: 'neg', text: `${oppStrengthScore.label} — above-average opponent quality adds resistance` }); }
    else if (oppStrengthScore.score <= -0.4) { score += 0.5; reasons.push({ icon: 'pos', text: `${oppStrengthScore.label} — matchup presents opportunity` }); }
  }
  
  // #13: Fight Context Factors
  const contextFactors = calcFightContextScore(history);
  score += contextFactors.score;
  reasons.push(...contextFactors.reasons);
  
  // #16: Burnout/Rest Cycle
  const restCycle = calcRestCycleFactor(history);
  score += restCycle.score;
  if (restCycle.label && restCycle.score !== 0) {
    reasons.push({ icon: restCycle.score > 0 ? 'pos' : 'neg', text: restCycle.label });
  }
  
  // #19: Extreme Value Detection
  const extremeValue = detectExtremeValue(line, db.fpFloor ?? null, db.fpCeiling ?? null, db.fpStdDev ?? null, history);
  if (extremeValue.isExtreme) {
    reasons.push({ icon: 'neu', text: `${extremeValue.label} — line is ${extremeValue.severity.toFixed(1)} std devs from historical norm` });
  }

  const marketSignal = 1;
  let lean: 'over'|'under'|'push' = 'push';
  const threshold = 1.5;
  if (score >= threshold) lean = 'over';
  else if (score <= -threshold) lean = 'under';

  let conf = Math.round(
    35 + Math.min(
      58,
      (Math.min(2.6, Math.abs(score)) / 2.6) * 28 +
      (Math.min(1, (db.fpConsistency || 0) / 100) * 0.35 + Math.min(1, history.length / 8) * 0.25 + marketSignal * 0.4) * 30
    )
  );
  conf = Math.max(35, Math.min(95, conf));

  const lineStr = selectedLine != null
    ? `${currentPlatform === 'pick6' ? 'P6' : currentPlatform === 'underdog' ? 'UD' : currentPlatform === 'prizepicks' ? 'PP' : currentPlatform === 'draftkings_sportsbook' ? 'DK' : 'BTR'} ${selectedLine}`
    : (availableLines.length > 1 ? `avg ${line}` : line_p6 ? `P6 ${line_p6}` : line_ud ? `UD ${line_ud}` : line_pp ? `PP ${line_pp}` : `BTR ${line_betr}`);
  const avgStr  = avgFP != null ? ` (avg ${avgFP.toFixed(1)})` : '';
  const verdict = lean === 'over'
    ? `LEAN OVER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'over value identified'}`
    : lean === 'under'
    ? `LEAN UNDER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'under value identified'}`
    : `LEAN ${score >= 0 ? 'OVER' : 'UNDER'} ${lineStr}${avgStr} — edge not yet at strong threshold`;

  const ev = lean !== 'push' ? parseFloat(((conf / 100) * 0.1 - (1 - conf / 100) * 1).toFixed(2)) : 0;

  return { 
    lean, 
    conf: Math.round(conf), 
    score: parseFloat(score.toFixed(2)), 
    reasons, 
    verdict, 
    ev
  };
}

function calcSSLean(_name: string, db: FighterDB|null, line_ss: number|null, oppDB: FighterDB|null, dkLine?: number|null): LeanResult|null {
  if (!line_ss || !db || !db.loaded) return null;
  const history = (db.history || []).filter(h => h.sigStr != null);
  if (history.length < 3) return null;

  const avgSS = history.reduce((s,h) => s + (h.sigStr || 0), 0) / history.length;
  const reasons: LeanReason[] = [];
  let score = 0;

  const diff = avgSS - line_ss;
  if      (diff > 20)  { score += 2.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) is ${diff.toFixed(1)} above line — strong over value` }); }
  else if (diff > 8)   { score += 1.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) edges the line by ${diff.toFixed(1)}` }); }
  else if (diff > 3)   { score += 0.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) slightly above line` }); }
  else if (diff < -20) { score -= 2.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` }); }
  else if (diff < -8)  { score -= 1.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) trails line by ${Math.abs(diff).toFixed(1)}` }); }
  else if (diff < -3)  { score -= 0.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) slightly below line` }); }
  else                 {               reasons.push({ icon:'neu', text:`Avg SS (${avgSS.toFixed(1)}) near line — toss-up` }); }

  const hits = history.filter(h => (h.sigStr || 0) > line_ss).length;
  const rate = hits / history.length;
  if      (rate >= 0.75) { score += 2;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) went over SS line` }); }
  else if (rate >= 0.6)  { score += 1;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights over SS line` }); }
  else if (rate <= 0.25) { score -= 2;   reasons.push({ icon:'neg', text:`Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared SS line` }); }
  else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon:'neg', text:`Hit rate: ${hits}/${history.length} fights over SS line — under tendency` }); }
  else                   {               reasons.push({ icon:'neu', text:`Hit rate: ${hits}/${history.length} fights over SS line — near 50/50` }); }

  if (history.length >= 3) {
    const recentAvg = history.slice(0,3).reduce((s,h) => s + (h.sigStr || 0), 0) / 3;
    const trend = recentAvg - avgSS;
    if      (trend > 15) { score += 1;   reasons.push({ icon:'pos', text:`Recent form UP — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` }); }
    else if (trend < -15){ score -= 1;   reasons.push({ icon:'neg', text:`Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` }); }
  }

  if (db.style === 'striker') { score += 0.5; reasons.push({ icon:'pos', text:`Striker style — naturally high SS volume` }); }
  else if (db.style === 'grappler') { score -= 0.5; reasons.push({ icon:'neg', text:`Grappler style — may rely on TDs more than striking` }); }

  if (db.strAcc != null && db.strAcc > 52) { score += 0.3; reasons.push({ icon:'pos', text:`High accuracy (${db.strAcc}%) — lands efficiently, SS count reliable` }); }

  if (oppDB?.loaded) {
    const { ssScore: patSS, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, line_ss, null, null);
    score += patSS; reasons.push(...patReasons);
  }

  // DK Sportsbook is a sharp line — divergence from fantasy books is a signal
  if (dkLine != null && dkLine !== line_ss && Math.abs(dkLine - line_ss) >= 3) {
    if (dkLine < line_ss) {
      score -= 0.7;
      reasons.push({ icon: 'neg', text: `DK Sportsbook sets SS at ${dkLine} vs fantasy book ${line_ss} — sharp line implies less striking volume` });
    } else {
      score += 0.7;
      reasons.push({ icon: 'pos', text: `DK Sportsbook sets SS at ${dkLine} vs fantasy book ${line_ss} — sharp line implies more striking volume` });
    }
  }

  let lean: 'over'|'under'|'push', conf: number;
  if      (score >= 3)   { lean = 'over';  conf = Math.min(90, 68 + score * 4); }
  else if (score >= 1.5) { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5) { lean = 'over';  conf = 54; }
  else if (score <= -3)  { lean = 'under'; conf = Math.min(90, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5){ lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5){ lean = 'under'; conf = 54; }
  else                   { lean = 'push';  conf = 50; }

  const verdict = lean === 'over'
    ? `SS OVER ${line_ss} (avg ${avgSS.toFixed(1)}) — ${reasons[0]?.text}`
    : lean === 'under'
    ? `SS UNDER ${line_ss} (avg ${avgSS.toFixed(1)}) — ${reasons[0]?.text}`
    : `SS NO LEAN at ${line_ss} (avg ${avgSS.toFixed(1)})`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict, avg: avgSS, line: line_ss, type: 'ss' };
}

function calcTDLean(_name: string, db: FighterDB|null, line_td: number|null, oppDB: FighterDB|null, dkLine?: number|null): LeanResult|null {
  if (!line_td || !db || !db.loaded) return null;
  const history = (db.history || []).filter(h => h.td != null);
  if (history.length < 3) return null;

  const avgTD = history.reduce((s,h) => s + (h.td || 0), 0) / history.length;
  const reasons: LeanReason[] = [];
  let score = 0;

  const diff = avgTD - line_td;
  if      (diff > 3)   { score += 2.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) is ${diff.toFixed(1)} above line — strong over value` }); }
  else if (diff > 1.5) { score += 1.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) edges line by ${diff.toFixed(1)}` }); }
  else if (diff > 0.5) { score += 0.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) slightly above line` }); }
  else if (diff < -3)  { score -= 2.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` }); }
  else if (diff < -1.5){ score -= 1.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) trails line by ${Math.abs(diff).toFixed(1)}` }); }
  else if (diff < -0.5){ score -= 0.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) slightly below line` }); }
  else                 {               reasons.push({ icon:'neu', text:`Avg TDs (${avgTD.toFixed(1)}) near line — toss-up` }); }

  const hits = history.filter(h => (h.td || 0) > line_td).length;
  const rate = hits / history.length;
  if      (rate >= 0.75) { score += 2;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) exceeded TD line` }); }
  else if (rate >= 0.6)  { score += 1;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights over TD line` }); }
  else if (rate <= 0.25) { score -= 2;   reasons.push({ icon:'neg', text:`Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared TD line` }); }
  else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon:'neg', text:`Hit rate: ${hits}/${history.length} fights over TD line — under tendency` }); }
  else                   {               reasons.push({ icon:'neu', text:`Hit rate: ${hits}/${history.length} fights over TD line — near 50/50` }); }

  if (history.length >= 3) {
    const recentAvg = history.slice(0,3).reduce((s,h) => s + (h.td || 0), 0) / 3;
    const trend = recentAvg - avgTD;
    if      (trend > 2)  { score += 1;   reasons.push({ icon:'pos', text:`Recent form UP — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` }); }
    else if (trend < -2) { score -= 1;   reasons.push({ icon:'neg', text:`Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` }); }
  }

  if (db.style === 'grappler') { score += 1; reasons.push({ icon:'pos', text:`Grappler style — TDs are primary weapon` }); }
  else if (db.style === 'striker') { score -= 0.5; reasons.push({ icon:'neg', text:`Striker style — TDs not primary weapon` }); }

  if (db.tdDef != null && db.tdDef > 75) { score -= 0.5; reasons.push({ icon:'neg', text:`Opponent has strong TD defense — may limit attempts` }); }
  else if (db.tdDef != null && db.tdDef < 50) { score += 0.5; reasons.push({ icon:'pos', text:`Opponent has weak TD defense — good target for takedowns` }); }

  if (oppDB?.loaded) {
    const { tdScore: patTD, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, line_td, null);
    score += patTD; reasons.push(...patReasons);
  }

  if (dkLine != null && dkLine !== line_td && Math.abs(dkLine - line_td) >= 1) {
    if (dkLine < line_td) {
      score -= 0.7;
      reasons.push({ icon: 'neg', text: `DK Sportsbook sets TD at ${dkLine} vs fantasy book ${line_td} — sharp line implies fewer takedowns` });
    } else {
      score += 0.7;
      reasons.push({ icon: 'pos', text: `DK Sportsbook sets TD at ${dkLine} vs fantasy book ${line_td} — sharp line implies more takedowns` });
    }
  }

  let lean: 'over'|'under'|'push', conf: number;
  if      (score >= 3)   { lean = 'over';  conf = Math.min(90, 68 + score * 4); }
  else if (score >= 1.5) { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5) { lean = 'over';  conf = 54; }
  else if (score <= -3)  { lean = 'under'; conf = Math.min(90, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5){ lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5){ lean = 'under'; conf = 54; }
  else                   { lean = 'push';  conf = 50; }

  const verdict = lean === 'over'
    ? `TD OVER ${line_td} (avg ${avgTD.toFixed(1)}) — ${reasons[0]?.text}`
    : lean === 'under'
    ? `TD UNDER ${line_td} (avg ${avgTD.toFixed(1)}) — ${reasons[0]?.text}`
    : `TD NO LEAN at ${line_td} (avg ${avgTD.toFixed(1)})`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict, avg: avgTD, line: line_td, type: 'td' };
}

function calcFTLean(_name: string, db: FighterDB|null, line_ft: number|null, oppDB: FighterDB|null, dkLine?: number|null): LeanResult|null {
  if (!line_ft || !db || !db.loaded) return null;
  const history = (db.history || []).filter(h => Number.isFinite(Number(h.timeSecs)) && Number(h.timeSecs) > 0);
  if (history.length < 3) return null;

  const mins = history.map(h => (Number(h.timeSecs) / 60));
  const avgFT = mins.reduce((s, v) => s + v, 0) / mins.length;
  const reasons: LeanReason[] = [];
  let score = 0;

  const diff = avgFT - line_ft;
  if      (diff > 2.0) { score += 2.4; reasons.push({ icon:'pos', text:`Avg fight time (${avgFT.toFixed(1)}m) is ${diff.toFixed(1)}m above line` }); }
  else if (diff > 1.0) { score += 1.4; reasons.push({ icon:'pos', text:`Avg fight time (${avgFT.toFixed(1)}m) edges line by ${diff.toFixed(1)}m` }); }
  else if (diff > 0.4) { score += 0.5; reasons.push({ icon:'pos', text:`Avg fight time (${avgFT.toFixed(1)}m) slightly above line` }); }
  else if (diff < -2.0){ score -= 2.4; reasons.push({ icon:'neg', text:`Avg fight time (${avgFT.toFixed(1)}m) is ${Math.abs(diff).toFixed(1)}m below line` }); }
  else if (diff < -1.0){ score -= 1.4; reasons.push({ icon:'neg', text:`Avg fight time (${avgFT.toFixed(1)}m) trails line by ${Math.abs(diff).toFixed(1)}m` }); }
  else if (diff < -0.4){ score -= 0.5; reasons.push({ icon:'neg', text:`Avg fight time (${avgFT.toFixed(1)}m) slightly below line` }); }
  else                 {               reasons.push({ icon:'neu', text:`Avg fight time (${avgFT.toFixed(1)}m) near line — toss-up` }); }

  const hits = mins.filter(v => v > line_ft).length;
  const rate = hits / mins.length;
  if      (rate >= 0.75) { score += 1.6; reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${mins.length} fights (${Math.round(rate*100)}%) over fight-time line` }); }
  else if (rate >= 0.6)  { score += 0.9; reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${mins.length} fights over line` }); }
  else if (rate <= 0.25) { score -= 1.6; reasons.push({ icon:'neg', text:`Hit rate: only ${hits}/${mins.length} fights (${Math.round(rate*100)}%) over line` }); }
  else if (rate <= 0.4)  { score -= 0.9; reasons.push({ icon:'neg', text:`Hit rate: ${hits}/${mins.length} fights over line — under tendency` }); }
  else                   {               reasons.push({ icon:'neu', text:`Hit rate: ${hits}/${mins.length} fights over line — near 50/50` }); }

  if (db.finishRate != null) {
    if (db.finishRate > 0.65) { score -= 0.8; reasons.push({ icon:'neg', text:`High finish profile (${Math.round(db.finishRate*100)}%) can cap fight duration` }); }
    else if (db.finishRate < 0.35) { score += 0.6; reasons.push({ icon:'pos', text:`Decision-heavy profile supports longer fight time` }); }
  }

  if (db.fiveRoundRate != null && db.fiveRoundRate > 0.3) {
    score += 0.5;
    reasons.push({ icon:'pos', text:`Frequent 4-5 round sample profile increases duration upside` });
  }

  if (oppDB?.loaded && oppDB.finishRate != null && oppDB.finishRate > 0.65) {
    score -= 0.4;
    reasons.push({ icon:'neg', text:`Opponent finish profile increases early-stoppage risk` });
  }

  if (dkLine != null && dkLine !== line_ft && Math.abs(dkLine - line_ft) >= 0.5) {
    if (dkLine < line_ft) {
      score -= 0.7;
      reasons.push({ icon: 'neg', text: `DK Sportsbook sets FT at ${dkLine}m vs fantasy book ${line_ft}m — sharp line implies shorter fight` });
    } else {
      score += 0.7;
      reasons.push({ icon: 'pos', text: `DK Sportsbook sets FT at ${dkLine}m vs fantasy book ${line_ft}m — sharp line implies longer fight` });
    }
  }

  let lean: 'over'|'under'|'push', conf: number;
  if      (score >= 3)   { lean = 'over';  conf = Math.min(89, 68 + score * 4); }
  else if (score >= 1.5) { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5) { lean = 'over';  conf = 54; }
  else if (score <= -3)  { lean = 'under'; conf = Math.min(89, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5){ lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5){ lean = 'under'; conf = 54; }
  else                   { lean = 'push';  conf = 50; }

  const verdict = lean === 'over'
    ? `FT OVER ${line_ft}m (avg ${avgFT.toFixed(1)}m) — ${reasons[0]?.text}`
    : lean === 'under'
    ? `FT UNDER ${line_ft}m (avg ${avgFT.toFixed(1)}m) — ${reasons[0]?.text}`
    : `FT NO LEAN at ${line_ft}m (avg ${avgFT.toFixed(1)}m)`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict, avg: avgFT, line: line_ft, type: 'ft' };
}

// ── RENDER UTILITIES ──────────────────────────────────────────────────────
function activePlatformLine(f: AnalyzerFighter): number|null {
  const pick6Value = f.line_p6 ?? null;
  const udValue = f.line_ud ?? null;
  const ppValue = f.line_pp ?? null;
  const betrValue = f.line_betr ?? null;
  const dkValue = f.line_dk_ss ?? f.line_dk_td ?? null;

  if (currentPlatform === 'pick6') return pick6Value ?? udValue ?? ppValue ?? dkValue ?? betrValue ?? null;
  if (currentPlatform === 'underdog') return udValue ?? pick6Value ?? ppValue ?? dkValue ?? betrValue ?? null;
  if (currentPlatform === 'prizepicks') return ppValue ?? udValue ?? pick6Value ?? dkValue ?? betrValue ?? null;
  if (currentPlatform === 'draftkings_sportsbook') return dkValue ?? pick6Value ?? udValue ?? ppValue ?? betrValue ?? null;
  return betrValue ?? ppValue ?? pick6Value ?? udValue ?? dkValue ?? null;
}

function activePlatformLabel(f: AnalyzerFighter): string {
  if (currentPlatform === 'pick6' && f.line_p6 != null) return `Pick6 ${f.line_p6}`;
  if (currentPlatform === 'underdog' && f.line_ud != null) return `Underdog ${f.line_ud}`;
  if (currentPlatform === 'prizepicks' && f.line_pp != null) return `PrizePicks ${f.line_pp}`;
  if (currentPlatform === 'draftkings_sportsbook' && (f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null)) {
    return `DK SS ${f.line_dk_ss ?? '—'} / TD ${f.line_dk_td ?? '—'} / FT ${f.line_dk_ft ?? '—'}`;
  }
  if (f.line_betr != null) return `Betr ${f.line_betr}`;
  if (f.line_pp != null) return `PrizePicks ${f.line_pp}`;
  if (f.line_p6 != null) return `Pick6 ${f.line_p6}`;
  if (f.line_ud != null) return `Underdog ${f.line_ud}`;
  if (f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null) return `DK SS ${f.line_dk_ss ?? '—'} / TD ${f.line_dk_td ?? '—'} / FT ${f.line_dk_ft ?? '—'}`;
  return '—';
}

function activePlatformAvgFP(db: FighterDB): number | null {
  if (currentPlatform === 'pick6') return db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
  if (currentPlatform === 'underdog') return db.avgFP_ud ?? db.avgFP_p6 ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
  if (currentPlatform === 'prizepicks') return db.avgFP_pp ?? db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_betr ?? db.avgFP ?? null;
  if (currentPlatform === 'draftkings_sportsbook') return db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
  return db.avgFP_betr ?? db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP ?? null;
}

function ensureLineLeans(): void {
  // Assign percentile-based leans for fighters without stats
  const fightersWithLines = allFighters.filter(f => activePlatformLine(f) != null);
  if (fightersWithLines.length < 4) return; // Need minimum for percentiles

  const lines = fightersWithLines.map(f => activePlatformLine(f)!).sort((a, b) => a - b);
  const overThreshold = lines[Math.floor(lines.length * 0.75)]; // Top 25%
  const underThreshold = lines[Math.floor(lines.length * 0.25)]; // Bottom 25%

  fightersWithLines.forEach(f => {
    if (f.lean?.lean && f.lean.lean !== 'none') return; // Already has a lean
    const line = activePlatformLine(f);
    if (!line) return;

    let lean: 'over' | 'under' | 'push' = 'push';
    let conf = 50;
    const reasons: LeanReason[] = [];

    if (line >= overThreshold) {
      lean = 'over';
      conf = 60;
      reasons.push({ icon: 'pos', text: `Line in top 25% of all fighters — percentile-based over lean` });
    } else if (line <= underThreshold) {
      lean = 'under';
      conf = 60;
      reasons.push({ icon: 'neg', text: `Line in bottom 25% of all fighters — percentile-based under lean` });
    } else {
      reasons.push({ icon: 'neu', text: `Line in middle 50% — no strong percentile lean` });
    }

    const verdict = lean === 'over' ? `PERCENTILE OVER ${line} — top quartile line` :
                    lean === 'under' ? `PERCENTILE UNDER ${line} — bottom quartile line` :
                    `NO PERCENTILE LEAN at ${line}`;

    f.lean = { lean, conf, reasons, verdict };
  });
}

function _computeEffectiveLean(f: AnalyzerFighter): EffectiveLean {
  if (f.lean?.lean && f.lean.lean !== 'none') return { ...f.lean, _source: 'fp', _label: '' };
  if (f.lean_ss?.lean && f.lean_ss.lean !== 'none' && f.lean_ss.lean !== 'push')
    return { ...f.lean_ss, _source: 'ss', _label: ' (SS)' };
  if (f.lean_td?.lean && f.lean_td.lean !== 'none' && f.lean_td.lean !== 'push')
    return { ...f.lean_td, _source: 'td', _label: ' (TD)' };
  if (f.lean_ft?.lean && f.lean_ft.lean !== 'none' && f.lean_ft.lean !== 'push')
    return { ...f.lean_ft, _source: 'ft', _label: ' (FT)' };
  return { ...(f.lean || { lean: 'none', conf: 0, reasons: [], verdict: '' }), _source: 'fp', _label: '' };
}
function getEffectiveLean(f: AnalyzerFighter): EffectiveLean {
  return _leanCache?.get(f.name) ?? _computeEffectiveLean(f);
}
function primeCaches(): void {
  _leanCache = new Map();
  _fighterByNorm = new Map();
  for (const f of allFighters) {
    _leanCache.set(f.name, _computeEffectiveLean(f));
    const norm = (normalizeName(f.name) || f.name).toLowerCase();
    _fighterByNorm.set(norm, f);
  }
}

function sortFighters(fighters: AnalyzerFighter[], sortKey: string): AnalyzerFighter[] {
  const copy = [...fighters];
  const primarySSLine = (f: AnalyzerFighter): number => {
    if (currentPlatform === 'pick6') return f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? 0;
    if (currentPlatform === 'underdog') return f.line_ud_ss ?? f.line_p6_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? 0;
    if (currentPlatform === 'prizepicks') return f.line_pp_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_betr_ss ?? 0;
    return f.line_betr_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? 0;
  };
  const primaryFTLine = (f: AnalyzerFighter): number => {
    if (currentPlatform === 'pick6') return f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
    if (currentPlatform === 'underdog') return f.line_ud_ft ?? f.line_p6_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
    if (currentPlatform === 'prizepicks') return f.line_pp_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
    if (currentPlatform === 'draftkings_sportsbook') return f.line_dk_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? 0;
    return f.line_betr_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_dk_ft ?? 0;
  };
  const ssDelta = (f: AnalyzerFighter): number => {
    const avg = f.db?.avgSigStr ?? 0;
    const line = primarySSLine(f);
    return avg - line;
  };
  switch (sortKey) {
    case 'line':        return copy.sort((a, b) => (activePlatformLine(b) || 0) - (activePlatformLine(a) || 0));
    case 'ssline':      return copy.sort((a, b) => primarySSLine(b) - primarySSLine(a));
    case 'ftline':      return copy.sort((a, b) => primaryFTLine(b) - primaryFTLine(a));
    case 'avgss':       return copy.sort((a, b) => (b.db?.avgSigStr || 0) - (a.db?.avgSigStr || 0));
    case 'delta':       return copy.sort((a, b) => ssDelta(b) - ssDelta(a));
    case 'conf':        return copy.sort((a, b) => (getEffectiveLean(b).conf || 0) - (getEffectiveLean(a).conf || 0));
    case 'avgfp':       return copy.sort((a, b) => (b.db?.avgFP_p6 || 0) - (a.db?.avgFP_p6 || 0));
    case 'floor':       return copy.sort((a, b) => (b.db?.fpFloor || 0) - (a.db?.fpFloor || 0));
    case 'ceil':        return copy.sort((a, b) => (b.db?.fpCeiling || 0) - (a.db?.fpCeiling || 0));
    case 'consistency': return copy.sort((a, b) => (b.db?.fpConsistency || 0) - (a.db?.fpConsistency || 0));
    default: return copy;
  }
}

function renderModelHealthWidget(): void {
  const leans = allFighters.map(getEffectiveLean).filter(l => l.lean !== 'none' && l.conf > 0);
  const setText = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  if (!leans.length) {
    setText('mhHitRate', '--%');
    setText('mhHitTrend', 'Waiting for model data');
    setText('mhConfidence', '--%');
    setText('mhConfidenceTrend', 'No active leans');
    setText('mhCoverage', '0');
    setText('mhCoverageTrend', 'fighters with actionable leans');
    void renderLearningDiagnosticsWidget();
    return;
  }

  const hitProbs = leans
    .map(l => {
      // calibratedProbability (P over) takes precedence; fall back to conf/100 which already
      // represents the model's confidence that the directional lean is correct.
      if (l.calibratedProbability != null) {
        return l.lean === 'under' ? (1 - l.calibratedProbability) : l.calibratedProbability;
      }
      return Number.isFinite(l.conf) ? l.conf / 100 : null;
    })
    .filter((v): v is number => v != null);

  const avgHit = hitProbs.length ? Math.round((hitProbs.reduce((s, v) => s + v, 0) / hitProbs.length) * 100) : 0;
  const avgConf = Math.round(leans.reduce((s, l) => s + (l.conf || 0), 0) / leans.length);

  setText('mhHitRate', `${avgHit}%`);
  setText('mhHitTrend', avgHit >= 58 ? 'Calibrated edge stable' : avgHit >= 52 ? 'Moderate model edge' : 'Conservative edge profile');
  setText('mhConfidence', `${avgConf}%`);
  setText('mhConfidenceTrend', avgConf >= 70 ? 'High-confidence slate' : avgConf >= 55 ? 'Balanced confidence' : 'Low-confidence slate');
  setText('mhCoverage', `${leans.length}`);
  setText('mhCoverageTrend', 'fighters with actionable leans');

  void renderLearningDiagnosticsWidget();
}

async function renderLearningDiagnosticsWidget(): Promise<void> {
  const setText = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const hasWidget = !!document.getElementById('learningDiagnosticsWidget');
  if (!hasWidget) return;

  // Load data FIRST, then update DOM — avoids "0 resolved" flash on tab switches
  try {
    const archivePayload = await storageGet<Record<string, unknown>>([STORAGE_PROP_ARCHIVE_KEY]);
    const allRowsRaw = archivePayload[STORAGE_PROP_ARCHIVE_KEY];
    const allRows = Array.isArray(allRowsRaw) ? (allRowsRaw as PropArchiveRecord[]) : [];
    if (!allRows.length) return;

    const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
    const resolvedRows = allRows.filter((row) => {
      const ts = Date.parse(row.date);
      const line = Number(row.line);
      const result = Number(row.result);
      return Number.isFinite(ts)
        && ts >= londonTs
        && Number.isFinite(line)
        && Number.isFinite(result);
    });

    if (!resolvedRows.length) {
      setText('ldResolved', '0 resolved');
      setText('ldCoverage', 'No settled outcomes yet');
      setText('ldMarketAcc', 'SS --% · FP --%');
      setText('ldMarketAccMeta', 'Waiting for resolved results');
      setText('ldPatternWin', 'Top hit tag: --');
      setText('ldPatternMiss', 'Top miss tag: --');
      setText('ldDrilldownTitle', 'No drilldown yet');
      setText('ldDrilldownMeta', 'Need resolved outcomes');
      setText('ldDrilldownBody', 'No settled picks yet.');
      return;
    }

    const fighterCount = new Set(
      resolvedRows
        .map((row) => normalizeName(row.fighter)?.toLowerCase())
        .filter((name): name is string => !!name)
    ).size;
    const eventCount = new Set(
      resolvedRows
        .map((row) => String(row.event || '').trim())
        .filter((name) => !!name)
    ).size;
    setText('ldResolved', `${resolvedRows.length} resolved`);
    setText('ldCoverage', `${fighterCount} fighters across ${eventCount} event${eventCount === 1 ? '' : 's'} (archive window)`);

    const computeOverRate = (rows: PropArchiveRecord[]): { hits: number; total: number; pct: number | null } => {
      let hits = 0;
      let total = 0;
      for (const row of rows) {
        const line = Number(row.line);
        const result = Number(row.result);
        if (!Number.isFinite(line) || !Number.isFinite(result) || result === line) continue;
        total += 1;
        if (result > line) hits += 1;
      }
      return { hits, total, pct: total ? Math.round((hits / total) * 100) : null };
    };

    const ssStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'SS'));
    const fpStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'Fantasy'));
    const tdStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'Takedowns'));
    const ftStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'FightTime'));
    const ssLabel = ssStats.pct == null ? '--%' : `${ssStats.pct}%`;
    const fpLabel = fpStats.pct == null ? '--%' : `${fpStats.pct}%`;
    const tdLabel = tdStats.pct == null ? '--%' : `${tdStats.pct}%`;
    const ftLabel = ftStats.pct == null ? '--%' : `${ftStats.pct}%`;
    setText('ldMarketAcc', `SS ${ssLabel} · FP ${fpLabel}`);
    const tdFtMeta = [
      tdStats.total ? `TD ${tdLabel} (${tdStats.total})` : null,
      ftStats.total ? `FT ${ftLabel} (${ftStats.total})` : null,
    ].filter(Boolean).join(' · ');
    setText('ldMarketAccMeta', `${ssStats.total} SS samples · ${fpStats.total} FP samples${tdFtMeta ? ' · ' + tdFtMeta : ''}`);

    type PatternBucket = { label: string; wins: number; total: number; rate: number };
    const patternMap = new Map<string, { platform: string; propType: string; overWins: number; underWins: number; total: number }>();
    for (const row of resolvedRows) {
      const line = Number(row.line);
      const result = Number(row.result);
      if (!Number.isFinite(line) || !Number.isFinite(result) || result === line) continue;
      const platform = String(row.platform || 'unknown').toLowerCase();
      const propType = String(row.propType || 'Unknown');
      const key = `${platform}|${propType}`;
      const bucket = patternMap.get(key) || { platform, propType, overWins: 0, underWins: 0, total: 0 };
      bucket.total += 1;
      if (result > line) bucket.overWins += 1;
      if (result < line) bucket.underWins += 1;
      patternMap.set(key, bucket);
    }

    const toLabel = (platform: string, propType: string, side: 'OVER' | 'UNDER'): string => {
      const p = platform && platform !== 'unknown' ? platform.toUpperCase() : 'ALL BOOKS';
      return `${p} ${propType} ${side}`;
    };

    const candidates: PatternBucket[] = [];
    for (const bucket of patternMap.values()) {
      if (bucket.total < 2) continue;
      candidates.push({
        label: toLabel(bucket.platform, bucket.propType, 'OVER'),
        wins: bucket.overWins,
        total: bucket.total,
        rate: bucket.overWins / bucket.total,
      });
      candidates.push({
        label: toLabel(bucket.platform, bucket.propType, 'UNDER'),
        wins: bucket.underWins,
        total: bucket.total,
        rate: bucket.underWins / bucket.total,
      });
    }

    if (!candidates.length) {
      setText('ldPatternWin', 'Top hit tag: Need >=2 settled rows per tag');
      setText('ldPatternMiss', 'Top miss tag: Need >=2 settled rows per tag');
      setText('ldDrilldownTitle', 'Not enough pattern samples yet');
      setText('ldDrilldownMeta', `${resolvedRows.length} resolved rows captured`);
      setText('ldDrilldownBody', 'Keep grading events to unlock stronger tag diagnostics.');
      return;
    }

    const topHit = [...candidates].sort((a, b) => b.rate - a.rate || b.total - a.total)[0];
    const topMiss = [...candidates].sort((a, b) => a.rate - b.rate || b.total - a.total)[0];
    const hitPct = Math.round(topHit.rate * 100);
    const missPct = Math.round(topMiss.rate * 100);

    setText('ldPatternWin', `Top hit tag: ${topHit.label} (${hitPct}% · ${topHit.wins}/${topHit.total})`);
    setText('ldPatternMiss', `Top miss tag: ${topMiss.label} (${missPct}% · ${topMiss.wins}/${topMiss.total})`);
    setText('ldDrilldownTitle', `${topHit.label} is leading`);
    setText('ldDrilldownMeta', `Best tendency: ${hitPct}% over ${topHit.total} settled rows`);
    setText(
      'ldDrilldownBody',
      missPct <= 45
        ? `Caution zone: ${topMiss.label} is only ${missPct}% on ${topMiss.total} rows. Lower confidence or fade similar setups.`
        : `Weakest tendency is ${topMiss.label} at ${missPct}% on ${topMiss.total} rows. Keep this tag in moderate-confidence territory.`
    );
  } catch (e) {
    debugLog(`learning diagnostics render failed: ${(e as Error).message}`);
  }
}

function normalizeArchivePlatformLabel(label: string): string | null {
  const lower = label.trim().toLowerCase();
  if (!lower || lower === '—') return null;
  if (lower.startsWith('pick6')) return 'pick6';
  if (lower.startsWith('underdog')) return 'underdog';
  if (lower.startsWith('prizepicks')) return 'prizepicks';
  if (lower.startsWith('betr')) return 'betr';
  if (lower.startsWith('dk')) return 'draftkings_sportsbook';
  return null;
}

function renderBestPicks(container: HTMLElement, renderSeq = 0): Promise<void> {
  return (async () => {
  const mySeq = renderSeq;
  if (!allFighters.length) {
    container.innerHTML = '<div class="inline-empty-msg">No fighter data loaded yet</div>';
    renderModelHealthWidget();
    return;
  }
  const visibleFighters = applySourceVisibilityFilter(allFighters);
  if (!visibleFighters.length) {
    container.innerHTML = '<div class="inline-empty-msg">No fighters match selected source filters</div>';
    renderModelHealthWidget();
    return;
  }

  const archivePayload = await storageGet<Record<string, unknown>>([STORAGE_PROP_ARCHIVE_KEY]);
  if (mySeq !== bestPicksRenderSeq) return; // a newer render started while we awaited storage — bail
  const archiveRowsRaw = archivePayload[STORAGE_PROP_ARCHIVE_KEY];
  const archiveRows = Array.isArray(archiveRowsRaw) ? (archiveRowsRaw as PropArchiveRecord[]) : [];
  const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
  const roster = new Set(
    visibleFighters
      .map((f) => normalizeName(f.name)?.toLowerCase())
      .filter((name): name is string => !!name)
  );
  const recentResolvedRows = archiveRows.filter((row) => {
    const fighter = normalizeName(row.fighter)?.toLowerCase();
    const ts = Date.parse(row.date);
    return !!fighter
      && roster.has(fighter)
      && Number.isFinite(Number(row.line))
      && Number.isFinite(Number(row.result))
      && Number.isFinite(ts)
      && ts >= londonTs;
  });

  const bestPickConfidenceCache = new Map<string, number>();
  const bestPickReasonCache = new Map<string, string | null>();
  const bestPickLeanCache = new Map<string, EffectiveLean>();

  const lineForLeanSource = (f: AnalyzerFighter, source: EffectiveLean['_source']): number | null => {
    if (source === 'fp') return activePlatformLine(f);
    if (source === 'ss') {
      if (currentPlatform === 'pick6') return f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
      if (currentPlatform === 'underdog') return f.line_ud_ss ?? f.line_p6_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
      if (currentPlatform === 'prizepicks') return f.line_pp_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
      if (currentPlatform === 'draftkings_sportsbook') return f.line_dk_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? null;
      return f.line_betr_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_dk_ss ?? null;
    }
    if (source === 'td') {
      if (currentPlatform === 'pick6') return f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
      if (currentPlatform === 'underdog') return f.line_ud_td ?? f.line_p6_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
      if (currentPlatform === 'prizepicks') return f.line_pp_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
      if (currentPlatform === 'draftkings_sportsbook') return f.line_dk_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? null;
      return f.line_betr_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_dk_td ?? null;
    }
    if (source === 'ft') {
      if (currentPlatform === 'pick6') return f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
      if (currentPlatform === 'underdog') return f.line_ud_ft ?? f.line_p6_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
      if (currentPlatform === 'prizepicks') return f.line_pp_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
      if (currentPlatform === 'draftkings_sportsbook') return f.line_dk_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? null;
      return f.line_betr_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_dk_ft ?? null;
    }
    return null;
  };

  const getBestPickLean = (f: AnalyzerFighter): EffectiveLean => {
    const cached = bestPickLeanCache.get(f.name);
    if (cached) return cached;

    const candidates: EffectiveLean[] = [];
    if (f.lean?.lean && f.lean.lean !== 'none' && f.lean.lean !== 'push' && lineForLeanSource(f, 'fp') != null) {
      candidates.push({ ...f.lean, _source: 'fp', _label: '' });
    }
    if (f.lean_ss?.lean && f.lean_ss.lean !== 'none' && f.lean_ss.lean !== 'push' && lineForLeanSource(f, 'ss') != null) {
      candidates.push({ ...f.lean_ss, _source: 'ss', _label: ' (SS)' });
    }
    if (f.lean_td?.lean && f.lean_td.lean !== 'none' && f.lean_td.lean !== 'push' && lineForLeanSource(f, 'td') != null) {
      candidates.push({ ...f.lean_td, _source: 'td', _label: ' (TD)' });
    }
    if (f.lean_ft?.lean && f.lean_ft.lean !== 'none' && f.lean_ft.lean !== 'push' && lineForLeanSource(f, 'ft') != null) {
      candidates.push({ ...f.lean_ft, _source: 'ft', _label: ' (FT)' });
    }

    if (!candidates.length) {
      const fallback = getEffectiveLean(f);
      bestPickLeanCache.set(f.name, fallback);
      return fallback;
    }

    const sourceBonus = (source: EffectiveLean['_source']): number => {
      if (source === 'ft') return 1.8;
      if (source === 'ss' || source === 'td') return 1.2;
      return 0;
    };

    candidates.sort((a, b) => {
      const bScore = (b.conf || 0) + sourceBonus(b._source);
      const aScore = (a.conf || 0) + sourceBonus(a._source);
      if (bScore !== aScore) return bScore - aScore;
      return (b.ev || 0) - (a.ev || 0);
    });

    const selected = candidates[0];
    bestPickLeanCache.set(f.name, selected);
    return selected;
  };

  const formatSideOdds = (odds: number): string => {
    if (Math.abs(odds) >= 100) return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
    return `${odds.toFixed(2)}x`;
  };

  const impliedProbabilityFromSideOdds = (odds: number | null | undefined): number | null => {
    if (odds == null || !Number.isFinite(odds)) return null;
    // American odds branch.
    if (Math.abs(odds) >= 100) {
      if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
      return 100 / (odds + 100);
    }
    // Payout multiplier branch (e.g., 0.66x means 1 stake returns 1.66 total).
    if (odds > 0) return 1 / (1 + odds);
    return null;
  };

  const getLeanSideOdds = (f: AnalyzerFighter, el: EffectiveLean): number | null => {
    if (el.lean !== 'over' && el.lean !== 'under') return null;
    if (el._source === 'ss') return el.lean === 'over' ? (f.ss_over_odds ?? null) : (f.ss_under_odds ?? null);
    if (el._source === 'td') return el.lean === 'over' ? (f.td_over_odds ?? null) : (f.td_under_odds ?? null);
    if (el._source === 'ft') return el.lean === 'over' ? (f.ft_over_odds ?? null) : (f.ft_under_odds ?? null);
    return null;
  };

  const getOddsAdjustment = (f: AnalyzerFighter, el: EffectiveLean, baseConfidence: number): { delta: number; note: string | null } => {
    const sideOdds = getLeanSideOdds(f, el);
    const implied = impliedProbabilityFromSideOdds(sideOdds);
    if (sideOdds == null || implied == null) return { delta: 0, note: null };

    const overPricedPenalty = implied >= 0.6
      ? Math.min(10, ((implied - 0.6) * 40) + Math.max(0, (80 - baseConfidence) / 12))
      : 0;
    const plusMoneyBonus = implied <= 0.45
      ? Math.min(7, ((0.45 - implied) * 28) + Math.max(0, (baseConfidence - 58) / 18))
      : 0;

    const delta = Math.round(plusMoneyBonus - overPricedPenalty);
    if (Math.abs(delta) < 2) return { delta, note: null };

    const note = delta < 0
      ? `Side price ${formatSideOdds(sideOdds)} is juiced for ${el.lean}, so confidence was trimmed.`
      : `Side price ${formatSideOdds(sideOdds)} is favorable for ${el.lean}, so confidence was boosted.`;
    return { delta, note };
  };

  const getAdjustedBestPickConfidence = (f: AnalyzerFighter): number => {
    const cacheKey = f.name;
    const cached = bestPickConfidenceCache.get(cacheKey);
    if (cached != null) return cached;

    const el = getBestPickLean(f);
    const baseConfidence = el.conf || 0;
    const propType = el._source === 'fp' ? 'Fantasy' : el._source.toUpperCase();
    const platform = normalizeArchivePlatformLabel(activePlatformLabel(f));
    const matchingRows = recentResolvedRows.filter((row) => {
      if (String(row.propType) !== propType) return false;
      if (platform && String(row.platform || '').toLowerCase() !== platform) return false;
      return true;
    });

    if (matchingRows.length < 3) {
      bestPickConfidenceCache.set(cacheKey, baseConfidence);
      bestPickReasonCache.set(cacheKey, null);
      return baseConfidence;
    }

    let hits = 0;
    let total = 0;
    let directionalEdgeSum = 0;
    for (const row of matchingRows) {
      const line = Number(row.line);
      const result = Number(row.result);
      if (!Number.isFinite(line) || !Number.isFinite(result) || result === line) continue;
      const directionalEdge = el.lean === 'over' ? (result - line) : (line - result);
      total += 1;
      directionalEdgeSum += directionalEdge;
      if (directionalEdge > 0) hits += 1;
    }

    if (total < 3) {
      bestPickConfidenceCache.set(cacheKey, baseConfidence);
      bestPickReasonCache.set(cacheKey, null);
      return baseConfidence;
    }

    const hitRate = hits / total;
    const avgDirectionalEdge = directionalEdgeSum / total;
    const isStatOver = el.lean === 'over' && (el._source === 'ss' || el._source === 'td' || el._source === 'ft');
    const penalty = hitRate < 0.52
      ? Math.min(18, ((0.52 - hitRate) * 42) + (avgDirectionalEdge < 0 ? Math.min(8, Math.abs(avgDirectionalEdge) / 4) : 0) + (isStatOver ? 3 : 0))
      : 0;
    const bonus = hitRate > 0.62 && avgDirectionalEdge > 0
      ? Math.min(6, ((hitRate - 0.62) * 20) + Math.min(3, avgDirectionalEdge / 8))
      : 0;
    const oddsAdjustment = getOddsAdjustment(f, el, baseConfidence);
    const adjustedConfidence = Math.round(Math.max(0, Math.min(99, baseConfidence - penalty + bonus + oddsAdjustment.delta)));

    let note: string | null = null;
    if (penalty >= 4) {
      note = `Archive check: ${propType} ${el.lean}s on ${platform || 'active book'} are ${Math.round(hitRate * 100)}% over ${total} settled samples, so confidence was trimmed.`;
    } else if (bonus >= 3) {
      note = `Archive check: ${propType} ${el.lean}s on ${platform || 'active book'} are ${Math.round(hitRate * 100)}% over ${total} settled samples, so confidence was boosted.`;
    }
    if (oddsAdjustment.note) {
      note = note ? `${note} ${oddsAdjustment.note}` : oddsAdjustment.note;
    }

    bestPickConfidenceCache.set(cacheKey, adjustedConfidence);
    bestPickReasonCache.set(cacheKey, note);
    return adjustedConfidence;
  };

  const getBestPickArchiveNote = (f: AnalyzerFighter): string | null => {
    void getAdjustedBestPickConfidence(f);
    return bestPickReasonCache.get(f.name) ?? null;
  };

  type Tier = 'High' | 'Med' | 'Low';
  const pickTier = (f: AnalyzerFighter): { label: Tier; rank: number } => {
    const el = getBestPickLean(f);
    const db = f.db;
    const line = lineForLeanSource(f, el._source);
    const samples = db?.history?.length || 0;
    const conf = getAdjustedBestPickConfidence(f);
    const statLean = el._source === 'ss' || el._source === 'td' || el._source === 'ft';
    const highConfReq = statLean ? 78 : 72;
    const highSampleReq = statLean ? 8 : 7;
    const medConfReq = statLean ? 64 : 58;
    const medSampleReq = statLean ? 5 : 4;
    if (conf >= highConfReq && samples >= highSampleReq && line != null) return { label: 'High', rank: 3 };
    if (conf >= medConfReq && samples >= medSampleReq) return { label: 'Med', rank: 2 };
    return { label: 'Low', rank: 1 };
  };

  const bestPickSort = (a: AnalyzerFighter, b: AnalyzerFighter): number => {
    const ta = pickTier(a);
    const tb = pickTier(b);
    if (tb.rank !== ta.rank) return tb.rank - ta.rank;
    const ea = getBestPickLean(a);
    const eb = getBestPickLean(b);
    const adjA = getAdjustedBestPickConfidence(a);
    const adjB = getAdjustedBestPickConfidence(b);
    if (adjB !== adjA) return adjB - adjA;
    return ((eb.ev || 0) - (ea.ev || 0));
  };

  const overs  = visibleFighters.filter(f => getBestPickLean(f).lean === 'over').sort(bestPickSort).slice(0, 8);
  const unders = visibleFighters.filter(f => getBestPickLean(f).lean === 'under').sort(bestPickSort).slice(0, 8);
  void persistBestPicksSnapshot(overs, unders);

  // Feature 6: flag fighters whose opponent is in the SAME section (can't both dominate)
  const overNames = new Set(overs.map(f => f.name.toLowerCase()));
  const underNames = new Set(unders.map(f => f.name.toLowerCase()));
  const conflictFighters = new Set<string>();
  for (const f of overs)  { if (f.opponent && overNames.has(f.opponent.toLowerCase()))  conflictFighters.add(f.name); }
  for (const f of unders) { if (f.opponent && underNames.has(f.opponent.toLowerCase())) conflictFighters.add(f.name); }

  function buildSection(fighters: AnalyzerFighter[], type: 'over'|'under'): string {
    if (!fighters.length) return '';
    const title = type === 'over' ? 'Best Overs' : 'Best Unders';
    const typeClass = type === 'over' ? 'over' : 'under';
    const icon = type === 'over' ? '▲' : '▼';
    const rows = fighters.map((f, i) => {
      const el = getBestPickLean(f);
      const line = lineForLeanSource(f, el._source);
      const tier = pickTier(f);
      const archiveNote = getBestPickArchiveNote(f);
      const reason = archiveNote || el.verdict || el.reasons?.[0]?.text || '—';
      const srcTag = el._source !== 'fp' ? ` <span class="best-pick-source">(${el._source?.toUpperCase()} line)</span>` : '';

      // Feature 6: conflict tag
      const conflictTag = conflictFighters.has(f.name)
        ? ` <span class="best-pick-conflict" title="Opponent also picked in same direction — correlated picks">⚡ corr</span>` : '';

      // Feature 1: show best available line across platforms if a better one exists
      const src = el._source;
      const n = (v: number|null|undefined): number|null => v ?? null;
      const allLines: [string, number|null][] = src === 'fp'
        ? [['P6', n(f.line_p6)], ['UD', n(f.line_ud)], ['PP', n(f.line_pp)], ['BTR', n(f.line_betr)]]
        : src === 'ss'
        ? [['P6', n(f.line_p6_ss)], ['UD', n(f.line_ud_ss)], ['PP', n(f.line_pp_ss)], ['BTR', n(f.line_betr_ss)], ['DK', n(f.line_dk_ss)]]
        : src === 'td'
        ? [['P6', n(f.line_p6_td)], ['UD', n(f.line_ud_td)], ['PP', n(f.line_pp_td)], ['BTR', n(f.line_betr_td)], ['DK', n(f.line_dk_td)]]
        : [['P6', n(f.line_p6_ft)], ['UD', n(f.line_ud_ft)], ['PP', n(f.line_pp_ft)], ['BTR', n(f.line_betr_ft)], ['DK', n(f.line_dk_ft)]];
      const available = allLines.filter((x): x is [string, number] => x[1] != null);
      let lineShopTag = '';
      if (available.length > 1 && line != null) {
        const best = el.lean === 'over'
          ? available.reduce((a, b) => b[1] < a[1] ? b : a)
          : available.reduce((a, b) => b[1] > a[1] ? b : a);
        if (Math.abs(best[1] - line) >= 1.5) {
          lineShopTag = ` <span class="best-pick-lineshop" title="Better line on ${best[0]}">🏪 ${best[0]} ${best[1]}</span>`;
        }
      }

      return `<div class="best-pick-row">
        <div class="best-pick-rank">#${i+1}</div>
        <div><div class="best-pick-name">${f.name}${srcTag}${conflictTag}${lineShopTag}</div><div class="best-pick-reason">${reason}</div></div>
        <div class="best-pick-meta">
          <span class="best-pick-type ${typeClass}">${type.toUpperCase()}${el._label||''}</span>
          <span class="best-pick-tier ${tier.label.toLowerCase()}">${tier.label}</span>
          <span class="best-pick-platform">${activePlatformLabel(f)}</span>
        </div>
        <div class="best-pick-line">${line || '—'}</div>
      </div>`;
    }).join('');
    return `<div class="best-picks-section ${typeClass}"><div class="best-picks-header"><span class="best-picks-title">${icon} ${title}</span><span class="best-picks-count">${fighters.length} picks</span></div>${rows}</div>`;
  }

  const html = `<div class="best-picks-grid">${buildSection(overs, 'over')}${buildSection(unders, 'under')}</div>`;
  container.innerHTML = html || '<div class="inline-empty-msg">No leans calculated yet — wait for UFCStats to finish loading</div>';
  renderModelHealthWidget();
  })();
}

async function persistBestPicksSnapshot(overs: AnalyzerFighter[], unders: AnalyzerFighter[]): Promise<void> {
  try {
    const normalizePick = (f: AnalyzerFighter, lean: 'over' | 'under') => {
      const el = getEffectiveLean(f);
      return {
        fighter: f.name,
        opponent: f.opponent || null,
        lean,
        line: activePlatformLine(f),
        platform: activePlatformLabel(f),
        source: el._source || 'fp',
        confidence: el.conf || 0,
        verdict: el.verdict || '',
      };
    };

    const picks = [
      ...overs.map((f) => normalizePick(f, 'over')),
      ...unders.map((f) => normalizePick(f, 'under')),
    ];

    if (!picks.length) return;

    const eventName = (upcomingEventName || '').trim() || 'Unknown Event';
    const date = new Date().toISOString();
    const key = `${eventName}|${date.slice(0, 10)}`;

    const payload = await storageGet<Record<string, unknown>>([STORAGE_BEST_PICKS_SNAPSHOT_KEY]);
    const current = Array.isArray(payload[STORAGE_BEST_PICKS_SNAPSHOT_KEY])
      ? (payload[STORAGE_BEST_PICKS_SNAPSHOT_KEY] as Array<any>)
      : [];

    const snapshot = {
      key,
      event: eventName,
      date,
      total: picks.length,
      overs: overs.length,
      unders: unders.length,
      picks,
    };

    const merged = [snapshot, ...current.filter((x) => String(x?.key || '') !== key)].slice(0, 60);
    await storageSet({ [STORAGE_BEST_PICKS_SNAPSHOT_KEY]: merged });
  } catch (e) {
    debugLog(`snapshot save failed: ${(e as Error).message}`);
  }
}

async function persistAiLeanSnapshot(fighters: AnalyzerFighter[]): Promise<void> {
  try {
    if (!fighters.length) return;

    const eventName = (upcomingEventName || '').trim();
    const eventDate = (document.getElementById('eventDate')?.textContent || '').trim();
    if (!eventName) return;

    const picks = fighters
      .map((f) => {
        const el = getEffectiveLean(f);
        const activeLine = activePlatformLine(f);
        return {
          fighter: f.name,
          opponent: f.opponent || null,
          lean: el.lean,
          source: el._source || 'fp',
          confidence: el.conf || 0,
          verdict: el.verdict || '',
          score: el.score ?? null,
          activePlatform: normalizeArchivePlatformLabel(activePlatformLabel(f)),
          activeLine,
          lines: {
            pick6: { fp: f.line_p6 ?? null, ss: f.line_p6_ss ?? null, td: f.line_p6_td ?? null },
            underdog: { fp: f.line_ud ?? null, ss: f.line_ud_ss ?? null, td: f.line_ud_td ?? null },
            prizepicks: { fp: f.line_pp ?? null, ss: f.line_pp_ss ?? null, td: f.line_pp_td ?? null },
            betr: { fp: f.line_betr ?? null, ss: f.line_betr_ss ?? null, td: f.line_betr_td ?? null },
            draftkings_sportsbook: { ss: f.line_dk_ss ?? null, td: f.line_dk_td ?? null },
          },
        };
      })
      .filter((pick) => pick.lean !== 'none' && pick.lean !== 'push' && Number.isFinite(Number(pick.activeLine)));

    if (!picks.length) return;

    const keyDate = eventDate || new Date().toISOString().slice(0, 10);
    const key = `${eventName}|${keyDate}`;
    const signature = JSON.stringify(
      picks
        .map((pick) => ({ fighter: pick.fighter, lean: pick.lean, source: pick.source, line: pick.activeLine, confidence: pick.confidence }))
        .sort((a, b) => a.fighter.localeCompare(b.fighter))
    );

    const payload = await storageGet<Record<string, unknown>>([STORAGE_AI_LEAN_SNAPSHOT_KEY]);
    const current = Array.isArray(payload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
      ? (payload[STORAGE_AI_LEAN_SNAPSHOT_KEY] as Array<any>)
      : [];

    const existing = current.find((entry) => String(entry?.key || '') === key);
    if (existing && String(existing?.signature || '') === signature) return;

    const snapshot = {
      key,
      event: eventName,
      eventDate: keyDate,
      capturedAt: new Date().toISOString(),
      totalLeans: picks.length,
      overCount: picks.filter((pick) => pick.lean === 'over').length,
      underCount: picks.filter((pick) => pick.lean === 'under').length,
      signature,
      picks,
    };

    const merged = [snapshot, ...current.filter((entry) => String(entry?.key || '') !== key)].slice(0, 80);
    await storageSet({ [STORAGE_AI_LEAN_SNAPSHOT_KEY]: merged });
  } catch (e) {
    debugLog(`AI lean snapshot save failed: ${(e as Error).message}`);
  }
}

let _archiveAutoSettleFired = false;
let _archiveBiasSortKey: 'hitRate' | 'avgEdge' | 'total' = 'avgEdge';
const _h2hFighterMap = new Map<string, AnalyzerFighter>();

// ── OPENING LINE TRACKER ───────────────────────────────────────────────────
const _openingLines = new Map<string, number>();
let _openingLinesEventKey = '';

function openingLineKey(platform: string, stat: string, name: string): string {
  return `${platform}|${stat}|${name.toLowerCase().trim()}`;
}

async function loadOpeningLines(): Promise<void> {
  const stored = await storageGet<{ lines_open_v1?: { eventKey: string; lines: Record<string, number> } | null }>(['lines_open_v1']);
  const data = stored.lines_open_v1;
  if (!data?.lines) return;
  _openingLinesEventKey = data.eventKey || '';
  _openingLines.clear();
  for (const [k, v] of Object.entries(data.lines)) {
    if (Number.isFinite(v)) _openingLines.set(k, v);
  }
}

function snapshotOpeningLines(): void {
  const eventKey = inferredEventNameFromLines || 'unknown';
  if (eventKey !== _openingLinesEventKey && eventKey !== 'unknown') {
    _openingLines.clear();
    _openingLinesEventKey = eventKey;
  }

  const platformStats: Array<[string, string, (f: AnalyzerFighter) => number | null | undefined]> = [
    ['p6',   'fp', f => f.line_p6],
    ['p6',   'ss', f => f.line_p6_ss],
    ['p6',   'td', f => f.line_p6_td],
    ['p6',   'ft', f => f.line_p6_ft],
    ['ud',   'fp', f => f.line_ud],
    ['ud',   'ss', f => f.line_ud_ss],
    ['ud',   'td', f => f.line_ud_td],
    ['ud',   'ft', f => f.line_ud_ft],
    ['pp',   'fp', f => f.line_pp],
    ['pp',   'ss', f => f.line_pp_ss],
    ['pp',   'td', f => f.line_pp_td],
    ['pp',   'ft', f => f.line_pp_ft],
    ['betr', 'fp', f => f.line_betr],
    ['betr', 'ss', f => f.line_betr_ss],
    ['betr', 'td', f => f.line_betr_td],
    ['betr', 'ft', f => f.line_betr_ft],
    ['dk',   'ss', f => f.line_dk_ss],
    ['dk',   'td', f => f.line_dk_td],
    ['dk',   'ft', f => f.line_dk_ft],
  ];

  let changed = false;
  for (const fighter of allFighters) {
    for (const [plat, stat, getVal] of platformStats) {
      const val = getVal(fighter);
      if (val == null) continue;
      const key = openingLineKey(plat, stat, fighter.name);
      if (!_openingLines.has(key)) {
        _openingLines.set(key, val);
        changed = true;
      }
    }
  }

  if (changed || _openingLines.size > 0) {
    const obj: Record<string, number> = {};
    _openingLines.forEach((v, k) => { obj[k] = v; });
    void storageSet({ lines_open_v1: { eventKey: _openingLinesEventKey, lines: obj } });
  }
}
async function renderArchivePanel(container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="inline-empty-msg">Loading prop archive...</div>';

  // Auto-settle once per session if there are past unresolved events
  if (!_archiveAutoSettleFired) {
    _archiveAutoSettleFired = true;
    runtimeSendMessage<{ ok: boolean; settled: number }>({ type: 'GRADE_ARCHIVE' })
      .then(res => {
        if (res?.ok && res.settled > 0) {
          showToast(`✓ Auto-settled ${res.settled} result(s) from UFCStats`);
          void renderArchivePanel(container);
        }
      })
      .catch(() => {});
  }

  const [result, linesPayload] = await Promise.all([
    storageGet<Record<string, unknown>>([STORAGE_PROP_ARCHIVE_KEY]),
    storageGet<Record<string, unknown>>(STORAGE_LINE_KEYS as unknown as string[]),
  ]);
  const allRowsRaw = result[STORAGE_PROP_ARCHIVE_KEY];
  const allRows = Array.isArray(allRowsRaw) ? (allRowsRaw as PropArchiveRecord[]) : [];

  // Lines staleness — find most recent capturedAt across all platform payloads
  const linesCapturedAt = Math.max(0, ...STORAGE_LINE_KEYS.map(k => {
    const val = (linesPayload as Record<string, any>)[k];
    return Number(val?.capturedAt || 0);
  }));
  const stalenessMins = linesCapturedAt > 0 ? Math.floor((Date.now() - linesCapturedAt) / 60000) : null;
  const stalenessLabel = stalenessMins == null ? '' :
    stalenessMins < 5 ? '· Lines: just now' :
    stalenessMins < 60 ? `· Lines: ${stalenessMins}m ago` :
    `· Lines: ${Math.floor(stalenessMins / 60)}h ago`;

  const currentRoster = new Set(
    allFighters.map((f) => normalizeName(f.name)?.toLowerCase()).filter((n): n is string => !!n)
  );

  const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
  const nowTs    = Date.now();

  // Normalize event name to a dedup key — extract sorted fighter surnames from "UFC Fight Night: A vs B"
  function eventDedupeKey(name: string): string {
    const m = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
    if (!m) return name.toLowerCase().trim();
    const a = m[1].trim().split(/\s+/).pop()!.toLowerCase();
    const b = m[2].trim().split(/\s+/).pop()!.toLowerCase();
    return [a, b].sort().join('|');
  }

  // ── Per-event breakdown ────────────────────────────────────────────────
  // key = dedup key, value includes display name, date, and counts
  const eventMap = new Map<string, { display: string; date: number; hits: number; total: number; unresolved: number }>();
  for (const r of allRows.filter(r => Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) >= londonTs)) {
    const ev = r.event || 'Unknown';
    const key = eventDedupeKey(ev);
    const rDate = Date.parse(r.date);
    const bucket = eventMap.get(key) || { display: ev, date: rDate, hits: 0, total: 0, unresolved: 0 };
    // Prefer the longer, more descriptive event name as display name
    if (ev.length > bucket.display.length) bucket.display = ev;
    // Track earliest record date for this event
    if (rDate < bucket.date) bucket.date = rDate;
    if (Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result))) {
      bucket.total++;
      if (Number(r.result) > Number(r.line)) bucket.hits++;
    } else if (Number.isFinite(Number(r.line))) {
      bucket.unresolved++;
    }
    eventMap.set(key, bucket);
  }

  // ── AI lean snapshot accuracy per event ───────────────────────────────
  const aiSnapshotPayload = await storageGet<Record<string, unknown>>([STORAGE_AI_LEAN_SNAPSHOT_KEY]);
  const aiSnapshots: any[] = Array.isArray(aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
    ? (aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY] as any[])
    : [];

  // Returns { hits, total } for AI picks in a snapshot cross-referenced against archive rows for the same event.
  function computeAiAccuracy(snap: any, eventArchiveRows: PropArchiveRecord[]): { hits: number; total: number } {
    let hits = 0;
    let total = 0;
    for (const pick of (snap?.picks ?? []) as any[]) {
      const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
      const lean = String(pick?.lean || '');
      const source = String(pick?.source || 'fp');
      const activeLine = Number(pick?.activeLine);
      if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine)) continue;
      const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
      const match = eventArchiveRows
        .filter(r =>
          normalizeName(r.fighter)?.toLowerCase() === fighter &&
          String(r.propType) === propType &&
          Number.isFinite(Number(r.result))
        )
        .sort((a, b) => Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine))[0];
      if (!match) continue;
      total++;
      const res = Number(match.result);
      if (lean === 'over' && res > activeLine) hits++;
      if (lean === 'under' && res < activeLine) hits++;
    }
    return { hits, total };
  }

  // Map dedup key → best AI accuracy for that event
  const aiAccuracyMap = new Map<string, { hits: number; total: number }>();
  for (const snap of aiSnapshots) {
    const key = eventDedupeKey(String(snap?.event || ''));
    if (!key || aiAccuracyMap.has(key)) continue;  // keep first (most recent) snapshot per event
    const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === key);
    const acc = computeAiAccuracy(snap, eventArchiveRows);
    if (acc.total > 0) aiAccuracyMap.set(key, acc);
  }

  // Split into past events (show results) and upcoming (show as pending only)
  const pastEventRows = Array.from(eventMap.values())
    .filter(d => d.date <= nowTs)
    .sort((a, b) => b.date - a.date)
    .slice(0, 6);
  const upcomingEvents = Array.from(eventMap.values())
    .filter(d => d.date > nowTs);

  // Only count resolved rows from past events for stats
  const pastEventKeys = new Set(
    Array.from(eventMap.entries())
      .filter(([, d]) => d.date <= nowTs)
      .map(([k]) => k)
  );
  const resolvedRows = allRows.filter(r =>
    Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result)) &&
    Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) >= londonTs &&
    pastEventKeys.has(eventDedupeKey(r.event || ''))
  );
  const unresolvedCount = allRows.filter(r =>
    Number.isFinite(Number(r.line)) && !Number.isFinite(Number(r.result))
  ).length;

  // ── Fantasy hit rate ───────────────────────────────────────────────────
  const fantasyRows = resolvedRows.filter(r => r.propType === 'Fantasy');
  const fantasyHits  = fantasyRows.filter(r => Number(r.result) > Number(r.line)).length;
  const fantasyTotal = fantasyRows.length;
  const fantasyHitRate = fantasyTotal ? Math.round((fantasyHits / fantasyTotal) * 100) : 0;

  const fighterFantasy = new Map<string, { hits: number; total: number }>();
  for (const r of fantasyRows) {
    const key = normalizeName(r.fighter) || r.fighter;
    const entry = fighterFantasy.get(key) || { hits: 0, total: 0 };
    entry.total++;
    if (Number(r.result) > Number(r.line)) entry.hits++;
    fighterFantasy.set(key, entry);
  }
  const topFantasy = Array.from(fighterFantasy.entries())
    .filter(([fighter, v]) => v.total >= 2 && currentRoster.has(fighter.toLowerCase()))
    .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);

  // ── SS per-fighter hit rates ───────────────────────────────────────────
  const ssRows = resolvedRows.filter(r => String(r.propType) === 'SS');
  const fighterSS = new Map<string, { hits: number; total: number }>();
  for (const r of ssRows) {
    const key = normalizeName(r.fighter) || r.fighter;
    const entry = fighterSS.get(key) || { hits: 0, total: 0 };
    entry.total++;
    if (Number(r.result) > Number(r.line)) entry.hits++;
    fighterSS.set(key, entry);
  }
  const topSS = Array.from(fighterSS.entries())
    .filter(([fighter, v]) => v.total >= 2 && currentRoster.has(fighter.toLowerCase()))
    .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);
  const ssHits = ssRows.filter(r => Number(r.result) > Number(r.line)).length;

  // ── TD per-fighter hit rates ───────────────────────────────────────────
  const tdRows = resolvedRows.filter(r => String(r.propType) === 'TD');
  const fighterTD = new Map<string, { hits: number; total: number }>();
  for (const r of tdRows) {
    const key = normalizeName(r.fighter) || r.fighter;
    const entry = fighterTD.get(key) || { hits: 0, total: 0 };
    entry.total++;
    if (Number(r.result) > Number(r.line)) entry.hits++;
    fighterTD.set(key, entry);
  }
  const topTD = Array.from(fighterTD.entries())
    .filter(([fighter, v]) => v.total >= 2 && currentRoster.has(fighter.toLowerCase()))
    .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);
  const tdHits = tdRows.filter(r => Number(r.result) > Number(r.line)).length;

  // ── Platform bias ──────────────────────────────────────────────────────
  const biasMap = new Map<string, { platform: string; propType: string; hits: number; total: number; edgeSum: number }>();
  for (const r of resolvedRows.filter(r => !!r.platform)) {
    const key = `${String(r.platform).toLowerCase()}|${r.propType}`;
    const b = biasMap.get(key) || { platform: String(r.platform).toLowerCase(), propType: String(r.propType), hits: 0, total: 0, edgeSum: 0 };
    b.total++;
    b.edgeSum += Number(r.result) - Number(r.line);
    if (Number(r.result) > Number(r.line)) b.hits++;
    biasMap.set(key, b);
  }
  const biasRows = Array.from(biasMap.values())
    .filter(b => b.total >= 2)
    .map(b => ({ ...b, hitRate: Math.round((b.hits / b.total) * 100), avgEdge: Number((b.edgeSum / b.total).toFixed(1)) }))
    .sort((a, b) => Math.abs(b.avgEdge) - Math.abs(a.avgEdge) || b.total - a.total)
    .slice(0, 14);

  // ── HTML ───────────────────────────────────────────────────────────────
  const deleteBtn = (eventName: string) =>
    `<button class="archive-delete-event-btn" data-event="${eventName.replace(/"/g, '&quot;')}" title="Delete all records for this event" style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:0 4px;line-height:1">✕</button>`;

  const upcomingHtml = upcomingEvents.map(d =>
    `<div class="best-pick-row" style="opacity:0.6">
      <div class="best-pick-rank" style="font-size:10px;min-width:44px;color:var(--text-muted)">UPCOMING</div>
      <div style="flex:1"><div class="best-pick-name" style="font-size:12px">${d.display}</div><div class="best-pick-reason">${d.unresolved} lines archived · awaiting results</div></div>
      ${deleteBtn(d.display)}
    </div>`
  ).join('');

  const eventHtml = (pastEventRows.length || upcomingHtml)
    ? upcomingHtml + pastEventRows.map((d) => {
        const key = eventDedupeKey(d.display);
        const rate = d.total ? Math.round((d.hits / d.total) * 100) : null;
        const rateStr = rate !== null ? `overs: ${d.hits}/${d.total} (${rate}%)` : '—';
        const unresStr = d.unresolved > 0 ? `<span style="color:var(--text-muted);font-size:10px"> · ${d.unresolved} pending</span>` : '';
        const ai = aiAccuracyMap.get(key);
        const aiRate = ai ? Math.round((ai.hits / ai.total) * 100) : null;
        const aiStr = ai
          ? `<span style="color:${aiRate! >= 60 ? 'var(--green)' : aiRate! >= 45 ? 'var(--amber)' : 'var(--red)'};font-size:10px;margin-left:8px">AI picks: ${ai.hits}/${ai.total} (${aiRate}%)</span>`
          : '';
        return `<div class="best-pick-row">
          <div class="best-pick-rank" style="font-size:11px;min-width:44px">${rate !== null ? rate + '%' : '?'}</div>
          <div style="flex:1"><div class="best-pick-name" style="font-size:12px">${d.display}</div><div class="best-pick-reason">${rateStr}${unresStr}${aiStr}</div></div>
          ${deleteBtn(d.display)}
        </div>`;
      }).join('')
    : '<div class="inline-empty-msg">No event data yet</div>';

  const topFantasyHtml = topFantasy.length
    ? topFantasy.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${x.fighter}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">Fantasy</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
    : `<div class="inline-empty-msg">Need 2+ events per fighter — overall: ${fantasyHits}/${fantasyTotal} (${fantasyHitRate}%)</div>`;

  const topSSHtml = topSS.length
    ? topSS.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${x.fighter}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">SS</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
    : `<div class="inline-empty-msg">Need 2+ events per fighter — overall: ${ssHits}/${ssRows.length}</div>`;

  const topTDHtml = topTD.length
    ? topTD.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${x.fighter}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">TD</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
    : `<div class="inline-empty-msg">Need 2+ events per fighter — overall: ${tdHits}/${tdRows.length}</div>`;

  // Platform bias — sortable; sort key stored at module level so it persists across re-renders
  const sk = _archiveBiasSortKey;
  const sortFn = (a: typeof biasRows[0], b: typeof biasRows[0]): number => {
    if (sk === 'hitRate') return b.hitRate - a.hitRate;
    if (sk === 'total') return b.total - a.total;
    return Math.abs(b.avgEdge) - Math.abs(a.avgEdge);
  };
  const biasSorted = [...biasRows].sort(sortFn);
  const biasHdr = (label: string, key: string) =>
    `<span data-bias-sort="${key}" style="cursor:pointer;text-decoration:underline dotted;color:${sk === key ? 'var(--text)' : 'var(--text-muted)'}">${label}${sk === key ? ' ▼' : ''}</span>`;
  const biasHtml = biasSorted.length
    ? `<div style="display:flex;gap:12px;font-size:10px;margin-bottom:6px;padding:0 4px">
        <span style="flex:1;color:var(--text-muted)">Platform / Prop</span>
        ${biasHdr('Avg Edge', 'avgEdge')} &nbsp; ${biasHdr('Hit%', 'hitRate')} &nbsp; ${biasHdr('N', 'total')}
       </div>` +
      biasSorted.map(x => `<div class="best-pick-row">
        <div class="best-pick-rank">${x.platform.toUpperCase()}</div>
        <div><div class="best-pick-name">${x.propType}</div><div class="best-pick-reason">${x.total} records · avg edge ${x.avgEdge > 0 ? '+' : ''}${x.avgEdge}</div></div>
        <div class="best-pick-meta"><span class="best-pick-platform">Hit Rate</span></div>
        <div class="best-pick-line">${x.hitRate}%</div>
      </div>`).join('')
    : '<div class="inline-empty-msg">No resolved outcomes yet</div>';

  const statusLine = unresolvedCount > 0
    ? `<span style="color:var(--amber)">${unresolvedCount} unresolved records</span>`
    : `<span style="color:var(--green)">All records settled ✓</span>`;

  container.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <button id="archiveSettleBtn" class="btn btn-sm" style="background:var(--accent);color:#fff;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px">
        ⚡ Settle from UFCStats
      </button>
      <button id="archiveBackfillBtn" class="btn btn-sm" style="background:var(--surface2);color:var(--text);padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px">
        ↻ Force Backfill
      </button>
      <span style="font-size:11px;color:var(--text-muted)">${allRows.length} total records · ${statusLine} <span style="color:var(--text-muted)">${stalenessLabel}</span></span>
    </div>
    <div class="best-picks-section" style="margin-bottom:12px">
      <div class="best-picks-header"><span class="best-picks-title">Per-Event Results</span><span class="best-picks-count">${resolvedRows.length} resolved</span></div>
      ${eventHtml}
    </div>
    <div class="best-picks-grid">
      <div class="best-picks-section over">
        <div class="best-picks-header takes"><span class="best-picks-title">Fantasy Line Hit Rate (Current Roster)</span><span class="best-picks-count">${fantasyHits}/${fantasyTotal} · ${fantasyHitRate}%</span></div>
        ${topFantasyHtml}
      </div>
    </div>
    <div class="best-picks-grid" style="margin-top:12px">
      <div class="best-picks-section over">
        <div class="best-picks-header takes"><span class="best-picks-title">SS Hit Rate (Current Roster)</span><span class="best-picks-count">${ssHits}/${ssRows.length}</span></div>
        ${topSSHtml}
      </div>
      <div class="best-picks-section under">
        <div class="best-picks-header takes"><span class="best-picks-title">TD Hit Rate (Current Roster)</span><span class="best-picks-count">${tdHits}/${tdRows.length}</span></div>
        ${topTDHtml}
      </div>
    </div>
    <div class="best-picks-section" id="archiveBiasSection" style="margin-top:12px">
      <div class="best-picks-header"><span class="best-picks-title">Platform Bias by Prop Type</span><span class="best-picks-count">Resolved outcomes</span></div>
      ${biasHtml}
    </div>
  `;

  // Wire up action buttons
  document.getElementById('archiveSettleBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '⏳ Fetching results...';
    try {
      const res = await runtimeSendMessage<{ ok: boolean; settled: number; skipped: number; errors: string[] }>({ type: 'GRADE_ARCHIVE' });
      if (res?.ok) {
        showToast(`✓ Settled ${res.settled} records from UFCStats${res.errors.length ? ` (${res.errors.length} events not found yet)` : ''}`);
        void renderArchivePanel(container);
      } else {
        showToast('Settle failed — check console');
      }
    } catch {
      showToast('Settle error — extension may need reload');
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Settle from UFCStats';
    }
  });

  document.getElementById('archiveBackfillBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '⏳ Running...';
    try {
      const res = await runtimeSendMessage<{ ok: boolean; changed: number; unresolvedBefore: number; unresolvedAfter: number }>({ type: 'FORCE_BACKFILL' });
      if (res?.ok) {
        showToast(`✓ Backfill: ${res.changed} records resolved (${res.unresolvedAfter} still pending)`);
        void renderArchivePanel(container);
      }
    } catch {
      showToast('Backfill error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Force Backfill';
    }
  });

  // Platform bias sort headers
  container.querySelectorAll<HTMLElement>('[data-bias-sort]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.biasSort as 'hitRate' | 'avgEdge' | 'total';
      if (key) { _archiveBiasSortKey = key; void renderArchivePanel(container); }
    });
  });

  // Delete-event buttons
  container.querySelectorAll<HTMLButtonElement>('.archive-delete-event-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const eventName = btn.dataset.event || '';
      if (!eventName) return;
      if (!confirm(`Delete all archive records for "${eventName}"?`)) return;
      const res = await runtimeSendMessage<{ ok: boolean; deleted: number }>({ type: 'DELETE_ARCHIVE_EVENT', eventName });
      if (res?.ok) {
        showToast(`Deleted ${res.deleted} records for ${eventName}`);
        void renderArchivePanel(container);
      }
    });
  });
}

function renderFighters(): void {
  const container = document.getElementById('cardContainer');
  if (!container) return;
  container.innerHTML = '';
  if (currentView === 'bestpicks') { bestPicksRenderSeq++; void renderBestPicks(container, bestPicksRenderSeq); return; }
  if (currentView === 'archive') { void renderArchivePanel(container); return; }

  primeCaches();
  const _q = currentSearch.toLowerCase().trim();
  let fighters = allFighters.filter(f => {
    if (_q && !f.name.toLowerCase().includes(_q)) return false;
    if (currentView === 'over'  && getEffectiveLean(f).lean !== 'over')  return false;
    if (currentView === 'under' && getEffectiveLean(f).lean !== 'under') return false;
    return true;
  });
  fighters = applySourceVisibilityFilter(fighters);
  fighters = sortFighters(fighters, currentSort);

  if (fighters.length === 0) {
    container.innerHTML = '<div class="inline-empty-msg">No fighters match this filter</div>';
    renderModelHealthWidget();
    return;
  }
function sanitizeOpponentName(raw: unknown, selfName?: string): string | null {
  if (typeof raw !== 'string') return null;
  let val = raw.replace(/^\s*vs\.?\s*/i, '').replace(/\s+/g, ' ').trim();
  val = val.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*$/i, '').trim();
  val = val.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '').trim();
  val = val.replace(/\b(?:edt|est|cdt|cst|mdt|mst|pdt|pst|utc)\b.*$/i, '').trim();
  val = val.replace(/[^A-Za-z'\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!val || val.split(' ').length < 2) return null;
  if (selfName && val.toLowerCase() === selfName.toLowerCase()) return null;
  return val;
}

function sanitizeLooseOpponentToken(raw: unknown, selfName?: string): string | null {
  if (typeof raw !== 'string') return null;
  let val = raw.replace(/^\s*vs\.?\s*/i, '').replace(/\s+/g, ' ').trim();
  val = val.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*$/i, '').trim();
  val = val.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '').trim();
  val = val.replace(/\b(?:edt|est|cdt|cst|mdt|mst|pdt|pst|utc)\b.*$/i, '').trim();
  val = val.replace(/[^A-Za-z'\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!val) return null;
  if (selfName && val.toLowerCase() === selfName.toLowerCase()) return null;
  return val;
}

function findOpponentBySingleToken(token: string, selfName: string): AnalyzerFighter | null {
  const t = token.toLowerCase();
  const matches = allFighters.filter((x) => {
    if (x.name === selfName) return false;
    const parts = x.name.toLowerCase().split(' ');
    const last = parts[parts.length - 1] || '';
    return last === t;
  });
  return matches.length === 1 ? matches[0] : null;
}

function resolveOpponentEntry(fighter: AnalyzerFighter, explicitOpp: string | null, looseOpp: string | null): AnalyzerFighter | null {
  const rawOpp = explicitOpp || looseOpp;
  const fighterNorm = normalizeName(fighter.name) || fighter.name;
  const cardOpp = findOpponentFromUpcomingCard(fighter.name);
  const oppNorm = rawOpp ? (normalizeName(rawOpp) || rawOpp) : (cardOpp ? (normalizeName(cardOpp) || cardOpp) : null);
  const singleToken = looseOpp && looseOpp.split(' ').length === 1 ? looseOpp.toLowerCase() : null;

  // Fast-path: exact normalized name lookup via pre-built map (O(1) vs O(N) loop)
  if (oppNorm && _fighterByNorm) {
    const direct = _fighterByNorm.get(oppNorm.toLowerCase());
    if (direct && direct.name !== fighter.name) return direct;
  }

  let best: AnalyzerFighter | null = null;
  let bestScore = 0;
  let tieAtBest = false;

  for (const candidate of allFighters) {
    if (candidate.name === fighter.name) continue;

    const candidateNorm = normalizeName(candidate.name) || candidate.name;
    const candidateOppNorm = normalizeName(candidate.opponent || '') || null;
    let score = 0;

    if (oppNorm) {
      if (candidateNorm === oppNorm) score = Math.max(score, 100);
      else if (namesMatch(candidateNorm, oppNorm)) score = Math.max(score, 90);
      else if (rawOpp && namesMatch(candidate.name, rawOpp)) score = Math.max(score, 88);
    }

    if (singleToken) {
      const parts = candidateNorm.toLowerCase().split(' ');
      const first = parts[0] || '';
      const last = parts[parts.length - 1] || '';
      if (last === singleToken) score = Math.max(score, 82);
      else if (first === singleToken) score = Math.max(score, 78);
    }

    if (candidateOppNorm && (candidateOppNorm === fighterNorm || namesMatch(candidateOppNorm, fighterNorm))) {
      score = Math.max(score, 72);
    }

    if (score === 0) continue;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tieAtBest = false;
    } else if (score === bestScore) {
      tieAtBest = true;
    }
  }

  if (best && !tieAtBest) return best;

  const fallbackBySingleToken = singleToken ? findOpponentBySingleToken(singleToken, fighter.name) : null;
  if (fallbackBySingleToken) return fallbackBySingleToken;

  const fallbackByReverse = allFighters.find((x) => {
    if (x.name === fighter.name) return false;
    if (!x.opponent) return false;
    const xOppNorm = normalizeName(x.opponent) || x.opponent;
    return xOppNorm === fighterNorm || namesMatch(xOppNorm, fighterNorm);
  });
  return fallbackByReverse || null;
}
  const totalFights = Math.ceil(fighters.length / 2);
  const showFightGroups = currentSort === 'default' && currentView === 'all' && !currentSearch.trim();
  fighters.forEach((f, i) => {
    const explicitOpp = sanitizeOpponentName(f.opponent, f.name);
    const looseOpp = sanitizeLooseOpponentToken(f.opponent, f.name);
    const opp = explicitOpp || looseOpp;
    const oppEntry = resolveOpponentEntry(f, explicitOpp, looseOpp);
    if (i % 2 === 0 && showFightGroups) {
      const fightIndex = Math.floor(i / 2);
      let badgeText: string, badgeCls: string;
      if (fightIndex === 0) { badgeText = 'MAIN EVENT'; badgeCls = 'main'; }
      else if (fightIndex === 1) { badgeText = 'CO-MAIN'; badgeCls = 'co'; }
      else if (fightIndex < Math.ceil(totalFights * 0.55)) { badgeText = 'MAIN CARD'; badgeCls = 'card'; }
      else { badgeText = 'PRELIM'; badgeCls = 'prelim'; }
      const header = document.createElement('div');
      header.className = 'fight-group-header';
      header.innerHTML = `<div class="fight-group-line"></div><span class="fight-badge ${badgeCls}">${badgeText}</span><div class="fight-group-line"></div>`;
      container.appendChild(header);
    }
    debugLog(`TD/SS lookup: ${f.name} → rawOpp="${String(f.opponent ?? '')}" explicitOpp="${explicitOpp}" looseOpp="${looseOpp}" resolvedOpp="${opp}" oppEntry="${oppEntry?.name}" oppTdLine=${oppEntry?.line_p6_td ?? oppEntry?.line_ud_td ?? oppEntry?.line_pp_td ?? oppEntry?.line_betr_td ?? null} oppSsLine=${oppEntry?.line_p6_ss ?? oppEntry?.line_ud_ss ?? oppEntry?.line_pp_ss ?? oppEntry?.line_betr_ss ?? null} selfTdLine=${f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? null}`);
    const row = buildFighterRow(f, oppEntry ?? null);
    row.style.setProperty('--row-index', String(i % 18));
    container.appendChild(row);
    if (!showFightGroups && i % 2 === 1 && i < fighters.length - 1) {
      const sp = document.createElement('div');
      sp.style.cssText = 'height:8px';
      container.appendChild(sp);
    }
  });
  renderModelHealthWidget();
}

function buildFighterRow(f: AnalyzerFighter, oppEntry: AnalyzerFighter|null): HTMLDivElement {
  _h2hFighterMap.set(f.name.toLowerCase(), f);
  const db = f.db || {} as FighterDB;
  const lean = getEffectiveLean(f);
  const leanClass = lean.lean === 'over' ? 'lean-over' : lean.lean === 'under' ? 'lean-under' : lean.lean === 'push' ? 'lean-push' : 'lean-none';
  const leanSuffix = lean._label || '';
  const leanText  = lean.lean === 'over' ? `▲ OVER${leanSuffix}` : lean.lean === 'under' ? `▼ UNDER${leanSuffix}` : lean.lean === 'push' ? '~ PUSH' : db.loaded ? '—' : '⟳';
  const leanRGB = lean.lean === 'over' ? '0,232,122' : lean.lean === 'under' ? '255,58,96' : lean.lean === 'push' ? '240,192,64' : '50,58,88';
  const confPct = lean.conf || 0;
  const leanGradStyle = lean.lean !== 'none' && confPct > 0
    ? `background:linear-gradient(90deg,rgba(${leanRGB},0.22) ${confPct}%,rgba(${leanRGB},0.05) ${confPct}%);`
    : '';
  const confInlineLabel = confPct > 0 ? `<span class="lean-conf-inline">${confPct}%</span>` : '';
  const activeLine = activePlatformLine(f);
  const platformLabel = activePlatformLabel(f);
  const showSource = (s: 'p6'|'ud'|'pp'|'betr'|'dk') => !!sourceVisibility[s];
  const lineCell = (source: 'p6'|'ud'|'pp'|'betr'|'dk', stat: 'fp'|'ss'|'td'|'ft', value: number | null | undefined): string => {
    if (value == null || !showSource(source)) return '';
    const sourceLabel = source === 'p6' ? 'P6' : source === 'ud' ? 'UD' : source === 'pp' ? 'PP' : source === 'dk' ? 'DK' : 'BT';
    const openVal = _openingLines.get(openingLineKey(source, stat, f.name));
    const delta = (openVal != null) ? parseFloat((value - openVal).toFixed(1)) : null;
    const movementHtml = (delta != null && Math.abs(delta) >= 0.5)
      ? `<div class="line-movement ${delta > 0 ? 'mv-up' : 'mv-down'}" title="Opened: ${openVal}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</div>`
      : '';
    return `<div class="line-cell ${stat} src-${source}"><div class="line-platform"><span class="line-source-tag src-${source}">${sourceLabel}</span><span>${stat.toUpperCase()}</span></div><div class="line-value ${source}">${value}${movementHtml}</div></div>`;
  };

  function platformStatLine(entry: AnalyzerFighter | null, stat: 'ss' | 'td' | 'ft'): number | null {
    if (!entry) return null;
    const p6 = stat === 'ss' ? entry.line_p6_ss : stat === 'td' ? entry.line_p6_td : entry.line_p6_ft;
    const ud = stat === 'ss' ? entry.line_ud_ss : stat === 'td' ? entry.line_ud_td : entry.line_ud_ft;
    const pp = stat === 'ss' ? entry.line_pp_ss : stat === 'td' ? entry.line_pp_td : entry.line_pp_ft;
    const dk = stat === 'ss' ? entry.line_dk_ss : stat === 'td' ? entry.line_dk_td : entry.line_dk_ft;
    const bt = stat === 'ss' ? entry.line_betr_ss : stat === 'td' ? entry.line_betr_td : entry.line_betr_ft;
    if (currentPlatform === 'pick6') return p6 ?? ud ?? pp ?? dk ?? bt ?? null;
    if (currentPlatform === 'underdog') return ud ?? p6 ?? pp ?? dk ?? bt ?? null;
    if (currentPlatform === 'prizepicks') return pp ?? p6 ?? ud ?? dk ?? bt ?? null;
    if (currentPlatform === 'draftkings_sportsbook') return dk ?? p6 ?? ud ?? pp ?? bt ?? null;
    return bt ?? p6 ?? ud ?? pp ?? dk ?? null;
  }

  const oppSsLine = platformStatLine(oppEntry, 'ss');
  const oppTdLine = platformStatLine(oppEntry, 'td');
  const oppFpLine = oppEntry ? activePlatformLine(oppEntry) : null;
  const oppName   = oppEntry ? oppEntry.name : (f.opponent || null);
  debugLog(`SS/TD chart: ${f.name} → oppEntry="${oppEntry?.name ?? 'NOT FOUND'}" oppSsLine=${oppSsLine} oppTdLine=${oppTdLine} (opp ss p6=${oppEntry?.line_p6_ss ?? '—'} ud=${oppEntry?.line_ud_ss ?? '—'} pp=${oppEntry?.line_pp_ss ?? '—'} bt=${oppEntry?.line_betr_ss ?? '—'} | opp td p6=${oppEntry?.line_p6_td ?? '—'} ud=${oppEntry?.line_ud_td ?? '—'} pp=${oppEntry?.line_pp_td ?? '—'} bt=${oppEntry?.line_betr_td ?? '—'})`);

  type HistoryRow = { opp?: string | null; fp?: number | null; sigStr?: number | null; td?: number | null; timeSecs?: number | null };

  function formatMinutesAsClock(minutes: number | null | undefined): string {
    if (minutes == null || !Number.isFinite(minutes)) return '—';
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  function buildHistoryBars(
    fights: HistoryRow[] | undefined,
    valFn: (h: HistoryRow) => number | null | undefined,
    lineFP: number | null,
    lineSS: number | null,
    lineTD: number | null,
    lineFT: number | null,
    labelFn: 'fp'|'ss'|'td'|'ft'
  ): string {
    if (!fights?.length) return db.loaded
      ? '<div class="history-empty">No fight history found on UFCStats</div>'
      : '<div class="history-empty">⟳ Fetching from UFCStats...</div>';

    const recentRows = fights.slice(0, 8);
    const values = recentRows
      .map(valFn)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (!values.length) {
      return '<div class="history-empty">No stat samples available</div>';
    }

    const line = labelFn === 'fp' ? lineFP : labelFn === 'ss' ? lineSS : labelFn === 'td' ? lineTD : lineFT;
    const maxVal = Math.max(...values, (line || 0) * 1.3, 1);

    return recentRows.map((h) => {
      const val = valFn(h);
      if (val == null) return '';
      const pct = Math.min(100, (val / maxVal) * 100);
      const linePct = line ? Math.min(100, (line / maxVal) * 100) : null;
      const isOver = line ? val > line : true;
      const displayVal = labelFn === 'ft'
        ? formatMinutesAsClock(val)
        : (Number.isInteger(val) ? val : (val as number).toFixed(1));
      return `<div class="history-bar-row">
        <div class="history-opp">${h.opp || '?'}</div>
        <div class="history-bar-wrap">
          <div class="history-bar-fill ${isOver ? 'over-line' : 'under-line'}" style="width:${pct}%"></div>
          ${linePct != null ? `<div class="line-marker" style="left:${linePct}%"></div>` : ''}
        </div>
        <div class="history-bar-val">${displayVal}</div>
      </div>`;
    }).join('');
  }

  const fights    = db.history    || [];
  const oppFights = db.oppHistory || [];
  const ssLine = platformStatLine(f, 'ss');
  const tdLine = platformStatLine(f, 'td');
  const ftLine = platformStatLine(f, 'ft');
  const primarySSLine = ssLine;
  const avgSS = db.avgSigStr ?? null;
  const ssDelta = (avgSS != null && primarySSLine != null) ? avgSS - primarySSLine : null;
  const ssDeltaText = ssDelta == null ? '—' : `${ssDelta > 0 ? '+' : ''}${ssDelta.toFixed(1)}`;
  const ssDeltaClass = ssDelta == null ? '' : ssDelta >= 0 ? 'delta-plus' : 'delta-minus';

  const historyPlatform: 'pick6'|'underdog'|'prizepicks'|'betr' =
    currentPlatform === 'pick6' ? 'pick6' :
    currentPlatform === 'underdog' ? 'underdog' :
    currentPlatform === 'prizepicks' ? 'prizepicks' :
    'betr';

  const historyHTML   = buildHistoryBars(fights, h => getFightFantasyValueForPlatform(h, historyPlatform), activeLine, ssLine, tdLine, ftLine, 'fp');
  const ssHistoryHTML = buildHistoryBars(fights, h => h.sigStr, activeLine, ssLine, tdLine, ftLine, 'ss');
  const tdHistoryHTML = buildHistoryBars(fights, h => h.td,     activeLine, ssLine, tdLine, ftLine, 'td');
  const ftHistoryHTML = buildHistoryBars(
    fights,
    h => Number.isFinite(Number(h.timeSecs)) ? Number(h.timeSecs) / 60 : null,
    activeLine,
    ssLine,
    tdLine,
    ftLine,
    'ft'
  );
  const oppCompareFpLine = oppFpLine;
  const oppCompareSsLine = oppSsLine;
  const oppCompareTdLine = oppTdLine;
  const oppFPHistory  = buildHistoryBars(oppFights, h => getFightFantasyValueForPlatform(h, historyPlatform), oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'fp');
  const oppSSHistory  = buildHistoryBars(oppFights, h => h.sigStr, oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'ss');
  const oppTDHistory  = buildHistoryBars(oppFights, h => h.td,     oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'td');

  const leanReasons = lean.reasons || [];
  const proReasons = leanReasons.filter((r) => r.icon === 'pos');
  const riskReasons = leanReasons.filter((r) => r.icon === 'neg');
  const neutralReasons = leanReasons.filter((r) => r.icon !== 'pos' && r.icon !== 'neg');

  const reasonRow = (r: LeanReason) => `<div class="lean-point">
    <span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span>
    <span>${r.text}</span>
  </div>`;

  const groupedReasonsHTML = `
    <div class="lean-reason-groups">
      <div class="lean-reason-col pro">
        <div class="lean-reason-head">Pro</div>
        ${proReasons.length ? proReasons.map(reasonRow).join('') : '<div class="lean-point muted"><span class="lean-point-icon">·</span><span>No strong pro edge</span></div>'}
      </div>
      <div class="lean-reason-col risk">
        <div class="lean-reason-head">Risk</div>
        ${riskReasons.length ? riskReasons.map(reasonRow).join('') : '<div class="lean-point muted"><span class="lean-point-icon">·</span><span>No major risk flag</span></div>'}
      </div>
      ${neutralReasons.length ? `<div class="lean-reason-col neutral"><div class="lean-reason-head">Context</div>${neutralReasons.slice(0, 2).map(reasonRow).join('')}</div>` : ''}
    </div>`;

  function panelConfidence(samples: number, line: number | null): { label: 'High'|'Med'|'Low'; cls: 'high'|'med'|'low' } {
    if (samples >= 7 && line != null) return { label: 'High', cls: 'high' };
    if (samples >= 4) return { label: 'Med', cls: 'med' };
    return { label: 'Low', cls: 'low' };
  }

  function panelBadge(conf: { label: 'High'|'Med'|'Low'; cls: 'high'|'med'|'low' }): string {
    return ` <span class="panel-confidence ${conf.cls}">${conf.label}</span>`;
  }

  const fpConf = panelConfidence(fights.length, activeLine);
  const ssConf = panelConfidence(fights.length, ssLine);
  const tdConf = panelConfidence(fights.length, tdLine);
  const ftConf = panelConfidence(fights.length, ftLine);
  const oppFpConf = panelConfidence(oppFights.length, oppCompareFpLine);
  const oppSsConf = panelConfidence(oppFights.length, oppCompareSsLine);
  const oppTdConf = panelConfidence(oppFights.length, oppCompareTdLine);
  const leanConfBadge = panelBadge(lean.conf >= 72 && leanReasons.length >= 5 ? { label: 'High', cls: 'high' } : lean.conf >= 58 ? { label: 'Med', cls: 'med' } : { label: 'Low', cls: 'low' });

  const fpFloor    = db.fpFloor    != null ? db.fpFloor.toFixed(1)    : '...';
  const fpCeiling  = db.fpCeiling  != null ? db.fpCeiling.toFixed(1)  : '...';
  const fpConsistency = db.fpConsistency ?? null;
  const consistencyClass = fpConsistency != null ? (fpConsistency >= 70 ? 'consistency-high' : fpConsistency >= 45 ? 'consistency-mid' : 'consistency-low') : '';
  
  // #18: Peer Comparison Percentiles
  const peerPercentiles = calcPeerPercentileRanking(allFighters, f.name);
  const avgFPPercentileLabel = peerPercentiles.avgFPPercentile >= 75 ? '🔴' : peerPercentiles.avgFPPercentile >= 50 ? '🟡' : '🟢';
  
  const streakEmoji = db.streak?.type === 'hot' ? ' 🔥' : db.streak?.type === 'cold' ? ' ❄️' : '';
  const weightedAvg = db.avgFP_weighted ?? null;
  const platformAvgFP = activePlatformAvgFP(db);
  const weightedDiff = (weightedAvg != null && platformAvgFP != null) ? (weightedAvg - platformAvgFP) : null;
  const weightedArrow = weightedDiff == null ? '' : weightedDiff > 3 ? ' ↑' : weightedDiff < -3 ? ' ↓' : '';
  const mlAdjFP = calcMLAdjustedFP(db.history || [], f.moneyline ?? null);
  const mlAdjShift = (mlAdjFP != null && platformAvgFP != null) ? mlAdjFP - platformAvgFP : null;

  const fpTrend  = calcStatTrend(fights, h => getFightFantasyValueForPlatform(h, historyPlatform), 5);
  const ssTrend  = calcStatTrend(fights, h => h.sigStr ?? null, 4);
  const tdTrend  = calcStatTrend(fights, h => h.td   ?? null, 0.5);

  function trendChip(t: StatTrend, tooltip: string): string {
    if (t.direction === null || t.direction === 'flat' || t.delta == null) return '';
    const sign = t.delta > 0 ? '+' : '';
    return `<span class="stat-trend-chip ${t.direction}" title="${tooltip}">${t.direction === 'up' ? '↑' : '↓'} L3 ${sign}${t.delta}</span>`;
  }
  // Removed hitProb, badgeText, badgeCls, spikeEvent UI, and all oddsBadge/fantasy_over_odds/fantasy_under_odds logic
  const hitProb = null;
  const spikeEvent = null;

  interface SSAnalysis {
    name: string;
    currentLine: number | null;
    currentLineSource: string;
    currentLineText: string;
    avgText: string;
    vsLineText: string;
    matchupNotes: string;
    verdictText: string;
    confidenceText: string;
    edge: number;
    confidence: number;
    available: boolean;
  }

  function selectedBookLine(entry: AnalyzerFighter | null, stat: 'ss' | 'td'): number | null {
    if (!entry) return null;
    if (currentPlatform === 'pick6') return stat === 'ss' ? entry.line_p6_ss ?? null : entry.line_p6_td ?? null;
    if (currentPlatform === 'underdog') return stat === 'ss' ? entry.line_ud_ss ?? null : entry.line_ud_td ?? null;
    if (currentPlatform === 'prizepicks') return stat === 'ss' ? entry.line_pp_ss ?? null : entry.line_pp_td ?? null;
    if (currentPlatform === 'draftkings_sportsbook') return stat === 'ss' ? entry.line_dk_ss ?? null : entry.line_dk_td ?? null;
    return stat === 'ss' ? entry.line_betr_ss ?? null : entry.line_betr_td ?? null;
  }

  function anyBookLine(entry: AnalyzerFighter | null, stat: 'ss' | 'td'): number | null {
    if (!entry) return null;
    const p6 = stat === 'ss' ? entry.line_p6_ss : entry.line_p6_td;
    const ud = stat === 'ss' ? entry.line_ud_ss : entry.line_ud_td;
    const pp = stat === 'ss' ? entry.line_pp_ss : entry.line_pp_td;
    const dk = stat === 'ss' ? entry.line_dk_ss : entry.line_dk_td;
    const bt = stat === 'ss' ? entry.line_betr_ss : entry.line_betr_td;
    return p6 ?? ud ?? pp ?? dk ?? bt ?? null;
  }

  function formatLineSource(entry: AnalyzerFighter | null, stat: 'ss' | 'td', line: number | null): string {
    if (!entry || line == null) return 'none';
    const p6 = stat === 'ss' ? entry.line_p6_ss : entry.line_p6_td;
    const ud = stat === 'ss' ? entry.line_ud_ss : entry.line_ud_td;
    const pp = stat === 'ss' ? entry.line_pp_ss : entry.line_pp_td;
    const dk = stat === 'ss' ? entry.line_dk_ss : entry.line_dk_td;
    const bt = stat === 'ss' ? entry.line_betr_ss : entry.line_betr_td;
    if (p6 === line) return 'P6';
    if (ud === line) return 'UD';
    if (pp === line) return 'PP';
    if (dk === line) return 'DK';
    if (bt === line) return 'BT';
    return 'unknown';
  }

  function resolveAnalysisLine(entry: AnalyzerFighter | null, stat: 'ss' | 'td'): { line: number | null; source: string } {
    const selected = selectedBookLine(entry, stat);
    if (selected != null) return { line: selected, source: currentPlatform.toUpperCase() };
    const fallback = anyBookLine(entry, stat);
    if (fallback != null) return { line: fallback, source: `fallback ${formatLineSource(entry, stat, fallback)}` };
    return { line: null, source: 'missing' };
  }

  const fighterSsLineResolved = resolveAnalysisLine(f, 'ss');
  const opponentSsLineResolved = resolveAnalysisLine(oppEntry, 'ss');

  function buildSSAnalysis(
    fighterName: string,
    fighterDb: FighterDB | null,
    currentSsLine: number | null,
    lineSource: string,
    opponentDb: FighterDB | null,
  ): SSAnalysis {
    if (!fighterDb?.loaded || currentSsLine == null || !Number.isFinite(currentSsLine)) {
      return {
        name: fighterName,
        currentLine: currentSsLine,
        currentLineSource: lineSource,
        currentLineText: currentSsLine != null ? `${currentSsLine.toFixed(1)} (${lineSource})` : 'Unavailable',
        avgText: 'Unavailable',
        vsLineText: 'Insufficient line/history data',
        matchupNotes: 'Needs both current SS line and fighter history.',
        verdictText: 'No bet (insufficient data)',
        confidenceText: '0',
        edge: 0,
        confidence: 0,
        available: false,
      };
    }

    const ssSamples = (fighterDb.history || [])
      .map((h) => h.sigStr)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!ssSamples.length) {
      return {
        name: fighterName,
        currentLine: currentSsLine,
        currentLineSource: lineSource,
        currentLineText: `${currentSsLine.toFixed(1)} (${lineSource})`,
        avgText: 'Unavailable',
        vsLineText: 'No historical SS samples',
        matchupNotes: 'Unable to compute historical over/under hit profile.',
        verdictText: 'No bet (insufficient data)',
        confidenceText: '0',
        edge: 0,
        confidence: 0,
        available: false,
      };
    }

    const avg = ssSamples.reduce((s, v) => s + v, 0) / ssSamples.length;
    const overCount = ssSamples.filter((v) => v > currentSsLine).length;
    const underCount = ssSamples.length - overCount;
    const overRate = overCount / ssSamples.length;

    let matchupAdj = 0;
    const notes: string[] = [];
    if (lineSource.startsWith('fallback')) {
      notes.push(`Selected-book SS line missing; using ${lineSource}.`);
    }
    if (opponentDb?.loaded) {
      const oppStrDef = opponentDb.strDef;
      const oppSapm = opponentDb.sapm;
      const oppTdDef = opponentDb.tdDef;
      const oppAvgTd = opponentDb.avgTD;

      if (oppStrDef != null) {
        if (oppStrDef >= 60) { matchupAdj -= 4; notes.push(`Opponent striking defense ${oppStrDef}% suppresses clean SS volume.`); }
        else if (oppStrDef <= 45) { matchupAdj += 4; notes.push(`Opponent striking defense ${oppStrDef}% is exploitable for SS accumulation.`); }
      }
      if (oppSapm != null) {
        if (oppSapm >= 4.7) { matchupAdj += 2.5; notes.push(`Opponent absorbs ${oppSapm.toFixed(1)} sig strikes/min, pace supports overs.`); }
        else if (oppSapm <= 3.0) { matchupAdj -= 2.5; notes.push(`Opponent absorbs only ${oppSapm.toFixed(1)} sig strikes/min, downside for SS output.`); }
      }
      if (oppAvgTd != null && oppAvgTd >= 2.2) {
        matchupAdj -= 1.5;
        notes.push(`Opponent wrestling pressure (${oppAvgTd.toFixed(1)} TD avg) can suppress striking exchanges.`);
      }
      if (oppTdDef != null && oppTdDef < 50 && (fighterDb.avgTD ?? 0) > 1.3) {
        matchupAdj -= 1;
        notes.push('Fighter may choose grappling routes vs weak TD defense, reducing SS ceiling.');
      }
    } else {
      notes.push('Opponent profile not loaded; matchup adjustment limited to fighter history baseline.');
    }

    const projection = avg + matchupAdj;
    const verdict = projection >= currentSsLine ? 'OVER' : 'UNDER';
    const confidence = Math.max(
      45,
      Math.min(
        93,
        Math.round(
          52
          + Math.min(18, Math.abs(projection - currentSsLine) * 1.4)
          + Math.min(12, Math.abs(overRate - 0.5) * 100 * 0.24)
          + Math.min(8, ssSamples.length * 0.9)
        )
      )
    );

    const vsLineText = `${overCount}/${ssSamples.length} over (${(overRate * 100).toFixed(0)}%) · ${underCount}/${ssSamples.length} under`;
    const matchupNotes = notes.length ? notes.join(' ') : 'Neutral style/pace indicators.';

    return {
      name: fighterName,
      currentLine: currentSsLine,
      currentLineSource: lineSource,
      currentLineText: `${currentSsLine.toFixed(1)} (${lineSource})`,
      avgText: avg.toFixed(1),
      vsLineText,
      matchupNotes,
      verdictText: `${verdict} ${currentSsLine.toFixed(1)} (proj ${projection.toFixed(1)})`,
      confidenceText: String(confidence),
      edge: projection - currentSsLine,
      confidence,
      available: true,
    };
  }

  function buildKeyReasons(a: SSAnalysis, b: SSAnalysis): string {
    const reasons: string[] = [];
    if (a.available) reasons.push(`${a.name}: edge ${a.edge >= 0 ? '+' : ''}${a.edge.toFixed(1)} vs line`);
    if (b.available) reasons.push(`${b.name}: edge ${b.edge >= 0 ? '+' : ''}${b.edge.toFixed(1)} vs line`);
    if (!reasons.length) reasons.push('Insufficient SS line/history data for one or both sides');
    return reasons.join(' | ');
  }

  function validateSSOutput(a: SSAnalysis, b: SSAnalysis, keyReasons: string): boolean {
    const check1 = a.currentLine != null && b.currentLine != null;
    const check2 = a.avgText !== 'Unavailable' && b.avgText !== 'Unavailable' && a.vsLineText.length > 0 && b.vsLineText.length > 0;
    const check3 = (a.verdictText.includes('OVER') || a.verdictText.includes('UNDER') || a.verdictText.includes('No bet'))
      && (b.verdictText.includes('OVER') || b.verdictText.includes('UNDER') || b.verdictText.includes('No bet'));
    const check4 = keyReasons.length > 0;
    return check1 && check2 && check3 && check4;
  }

  let fighterSsAnalysis = buildSSAnalysis(f.name, db, fighterSsLineResolved.line, fighterSsLineResolved.source, oppEntry?.db || null);
  let opponentSsAnalysis = buildSSAnalysis(oppEntry?.name || (f.opponent || 'Opponent'), oppEntry?.db || null, opponentSsLineResolved.line, opponentSsLineResolved.source, db);

  // Self-correct once if selected-book line is missing by forcing best available line on both sides.
  let keyReasons = buildKeyReasons(fighterSsAnalysis, opponentSsAnalysis);
  if (!validateSSOutput(fighterSsAnalysis, opponentSsAnalysis, keyReasons)) {
    const fighterFallbackLine = anyBookLine(f, 'ss');
    const opponentFallbackLine = anyBookLine(oppEntry, 'ss');
    fighterSsAnalysis = buildSSAnalysis(f.name, db, fighterFallbackLine, formatLineSource(f, 'ss', fighterFallbackLine), oppEntry?.db || null);
    opponentSsAnalysis = buildSSAnalysis(oppEntry?.name || (f.opponent || 'Opponent'), oppEntry?.db || null, opponentFallbackLine, formatLineSource(oppEntry, 'ss', opponentFallbackLine), db);
    keyReasons = buildKeyReasons(fighterSsAnalysis, opponentSsAnalysis);
  }

  const strongest = Math.abs(fighterSsAnalysis.edge) >= Math.abs(opponentSsAnalysis.edge)
    ? fighterSsAnalysis
    : opponentSsAnalysis;
  const volatilityFlags: string[] = [];
  if ((db.fpStdDev ?? 0) > 22) volatilityFlags.push(`${f.name} high variance profile`);
  if ((oppEntry?.db?.fpStdDev ?? 0) > 22) volatilityFlags.push(`${oppEntry?.name || 'Opponent'} high variance profile`);
  if (!fighterSsAnalysis.available || !opponentSsAnalysis.available) volatilityFlags.push('incomplete opponent/line data');
  const recommendedLeans = [fighterSsAnalysis, opponentSsAnalysis]
    .filter((x) => x.available && x.confidence >= 62)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2)
    .map((x) => `${x.name}: ${x.verdictText} (${x.confidence}% conf)`);

  const ssAnalysisHtml = `
    <div class="detail-panel">
      <div class="detail-panel-title">SS Matchup Analyzer</div>
      <div class="lean-reason">
        <div><strong>### Fighter SS Analysis</strong></div>
        <div>- Name: ${fighterSsAnalysis.name}</div>
        <div>- Current SS line: ${fighterSsAnalysis.currentLineText}</div>
        <div>- Historical average SS: ${fighterSsAnalysis.avgText}</div>
        <div>- Historical performance vs similar lines: ${fighterSsAnalysis.vsLineText}</div>
        <div>- Matchup notes: ${fighterSsAnalysis.matchupNotes}</div>
        <div>- Over/Under verdict: ${fighterSsAnalysis.verdictText}</div>
        <div>- Confidence score (0-100): ${fighterSsAnalysis.confidenceText}</div>
        <br>
        <div><strong>### Opponent SS Analysis</strong></div>
        <div>- Name: ${opponentSsAnalysis.name}</div>
        <div>- Current SS line: ${opponentSsAnalysis.currentLineText}</div>
        <div>- Historical average SS: ${opponentSsAnalysis.avgText}</div>
        <div>- Historical performance vs similar lines: ${opponentSsAnalysis.vsLineText}</div>
        <div>- Matchup notes: ${opponentSsAnalysis.matchupNotes}</div>
        <div>- Over/Under verdict: ${opponentSsAnalysis.verdictText}</div>
        <div>- Confidence score (0-100): ${opponentSsAnalysis.confidenceText}</div>
        <br>
        <div><strong>### Final Summary</strong></div>
        <div>- Side with clearest value: ${strongest.available ? `${strongest.name} (${strongest.verdictText})` : 'No clear edge (insufficient data)'}</div>
        <div>- Key reasons: ${keyReasons}</div>
        <div>- Volatility / red flags: ${volatilityFlags.length ? volatilityFlags.join(' · ') : 'None flagged from fetched variance/style metrics'}</div>
        <div>- Recommended lean(s) for pick’em platforms: ${recommendedLeans.length ? recommendedLeans.join(' | ') : 'No SS lean above confidence threshold'}</div>
      </div>
    </div>`;

  const row = document.createElement('div') as HTMLDivElement;
  const rowLeanClass = lean.lean === 'over' ? ' lean-over-row' : lean.lean === 'under' ? ' lean-under-row' : '';
  row.className = 'fighter-row' + rowLeanClass;
  row.dataset['name'] = f.name;
  row.innerHTML = `
    <div class="fighter-main">
      <div class="fighter-info">
        <div class="fighter-flag">${db.country || '🏴'}</div>
        <div>
          <div class="fighter-name" title="${f.name}">${f.name}${streakEmoji}</div>
          <div class="fighter-record">${db.record || '—'} · ${db.style || '...'}</div>
        </div>
      </div>
      <div class="platform-lines">
        ${lineCell('p6', 'fp', f.line_p6)}
        ${lineCell('p6', 'ss', f.line_p6_ss)}
        ${lineCell('p6', 'td', f.line_p6_td)}
        ${lineCell('p6', 'ft', f.line_p6_ft)}
        ${lineCell('ud', 'fp', f.line_ud)}
        ${lineCell('ud', 'ss', f.line_ud_ss)}
        ${lineCell('ud', 'td', f.line_ud_td)}
        ${lineCell('ud', 'ft', f.line_ud_ft)}
        ${lineCell('betr', 'fp', f.line_betr)}
        ${lineCell('betr', 'ss', f.line_betr_ss)}
        ${lineCell('betr', 'td', f.line_betr_td)}
        ${lineCell('betr', 'ft', f.line_betr_ft)}
        ${lineCell('pp', 'fp', f.line_pp)}
        ${lineCell('pp', 'ss', f.line_pp_ss)}
        ${lineCell('pp', 'td', f.line_pp_td)}
        ${lineCell('pp', 'ft', f.line_pp_ft)}
        ${lineCell('dk', 'ss', f.line_dk_ss)}
        ${lineCell('dk', 'td', f.line_dk_td)}
        ${lineCell('dk', 'ft', f.line_dk_ft)}
        ${hasAnyVisibleSourceLine(f) ? '' : '<div class="line-value-empty">No visible source lines</div>'}
        <!-- Removed spikeEvent and odds badge UI -->
      </div>
      <div class="stats-mini">
        <div class="stat-mini-cell stat-fp" title="${mlAdjFP!=null?`ML-adjusted: ${mlAdjFP.toFixed(1)} FP (win/loss FP weighted by ${f.moneyline!=null?(f.moneyline<0?f.moneyline:'+'+f.moneyline):'-'} implied win prob). Raw avg: ${platformAvgFP!=null?platformAvgFP.toFixed(1):'—'}`:'Recent fantasy points average from UFCStats history'}">
          <div class="stat-mini-label">Avg FP</div>
          <div class="stat-mini-val">${mlAdjFP!=null?mlAdjFP.toFixed(1):(platformAvgFP!=null?platformAvgFP.toFixed(1):'...')} ${avgFPPercentileLabel}${mlAdjShift!=null&&Math.abs(mlAdjShift)>=3?`<span class="ml-adj-badge ${mlAdjShift>0?'pos':'neg'}">${mlAdjShift>0?'+':''}${mlAdjShift.toFixed(1)}</span>`:''}${trendChip(fpTrend,`Last 3 avg: ${fpTrend.recentAvg} · Career: ${fpTrend.careerAvg}`)}</div>
          <div class="fp-range-label">${db.fpFloor!=null?`${fpFloor}–${fpCeiling}`:''}</div>
        </div>
        <div class="stat-mini-cell stat-ss" title="Average significant strikes landed per fight"><div class="stat-mini-label">Avg SS</div><div class="stat-mini-val">${avgSS!=null?avgSS.toFixed(1):'...'}${trendChip(ssTrend,`SS last 3 avg: ${ssTrend.recentAvg} · Career: ${ssTrend.careerAvg}`)}</div></div>
        <div class="stat-mini-cell stat-ss" title="Current active platform SS betting line"><div class="stat-mini-label" title="Current active platform SS betting line">SS Line</div><div class="stat-mini-val">${primarySSLine!=null?primarySSLine.toFixed(1):'...'}</div></div>
        <div class="stat-mini-cell ${ssDeltaClass}" title="Delta = Avg SS minus active SS line. Positive favors over, negative favors under."><div class="stat-mini-label" title="Delta = Avg SS minus active SS line">SS Delta</div><div class="stat-mini-val">${ssDeltaText}</div></div>
      </div>
      <div class="lean-cell">
        <div class="lean-badge ${leanClass}" style="${leanGradStyle}" title="${lean.verdict}">${leanText}${confInlineLabel}</div>
        ${confPct > 0 ? `<div class="confidence-meter" title="Confidence strength: ${confPct}%"><div class="confidence-fill" style="width:${confPct}%; background: rgba(${leanRGB}, 0.8);"></div></div>` : ''}
        <!-- Removed hitProb, badgeText, and badgeCls UI -->
        ${lean.ev != null ? `<div class="ev-label">EV: ${lean.ev > 0 ? '+' : ''}${lean.ev}</div>` : ''}
        ${weightedAvg != null ? `<div class="weighted-avg-label">W.Avg: ${weightedAvg.toFixed(1)}</div>` : ''}
      </div>
      <div class="row-expand-slot"><button class="h2h-btn" data-fighter="${f.name}" title="Head-to-head vs ${f.opponent || 'opponent'}">⚔</button><span class="expand-arrow">▼</span></div>
    </div>
    <div class="fighter-detail">
      <div class="detail-grid">
        <div class="detail-panel"><div class="detail-panel-title">FP History vs Line (${platformLabel})</div>${historyHTML}${activeLine?`<div class="panel-meta"><div class="panel-meta-line"></div> Line: ${activeLine}</div>`:''}</div>
        <div class="detail-panel"><div class="detail-panel-title">Sig Strikes History${ssLine != null ? ` vs Line ${ssLine}` : ''}</div>${ssHistoryHTML}${ssLine != null ? `<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_ss||'—'} · UD: ${f.line_ud_ss||'—'} · PP: ${f.line_pp_ss||'—'} · BT: ${f.line_betr_ss||'—'}</div>` : ''}</div>
        <div class="detail-panel"><div class="detail-panel-title">Takedowns History${tdLine!=null?` vs Line ${tdLine}`:''}${trendChip(tdTrend,`TD last 3 avg: ${tdTrend.recentAvg} · Career: ${tdTrend.careerAvg}`)}</div>${tdHistoryHTML}${tdLine!=null?`<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_td||'—'} · UD: ${f.line_ud_td||'—'} · PP: ${f.line_pp_td||'—'} · BT: ${f.line_betr_td||'—'}</div>`:''}</div>
        <div class="detail-panel"><div class="detail-panel-title">Fight Time History${ftLine!=null?` vs Line ${formatMinutesAsClock(ftLine)}`:''}</div>${ftHistoryHTML}${ftLine!=null?`<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_ft!=null?formatMinutesAsClock(f.line_p6_ft):'—'} · UD: ${f.line_ud_ft!=null?formatMinutesAsClock(f.line_ud_ft):'—'} · PP: ${f.line_pp_ft!=null?formatMinutesAsClock(f.line_pp_ft):'—'} · BT: ${f.line_betr_ft!=null?formatMinutesAsClock(f.line_betr_ft):'—'}</div>`:''}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp FP Scored vs ${f.name}${oppCompareFpLine != null ? ` · ${oppName} line ${oppCompareFpLine}` : ''}</div>${oppFights.length?oppFPHistory:'<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp SS Scored vs ${f.name}${oppCompareSsLine != null ? ` · ${oppName} SS line ${oppCompareSsLine}` : ''}</div>${oppFights.length?oppSSHistory:'<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp TDs Scored vs ${f.name}${oppCompareTdLine != null ? ` · ${oppName} TD line ${oppCompareTdLine}` : ''}</div>${oppFights.length?oppTDHistory:'<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        ${ssAnalysisHtml}
        <div class="detail-panel">
          <div class="detail-panel-title">UFCStats Career Data</div>
          <span class="stat-val mid">${db.record||'...'}</span>
          <div class="stat-row"><span class="stat-label">SIG STRIKES / MIN</span><span class="stat-val ${db.slpm!=null&&db.slpm>5?'good':db.slpm!=null&&db.slpm>3?'mid':'low'}">${db.slpm!=null?db.slpm.toFixed(2):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">STRIKING ACC %</span><span class="stat-val ${db.strAcc!=null&&db.strAcc>48?'good':db.strAcc!=null&&db.strAcc>38?'mid':'low'}">${db.strAcc!=null?db.strAcc+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD AVG / 15 MIN</span><span class="stat-val ${db.avgTD!=null&&db.avgTD>2?'good':db.avgTD!=null&&db.avgTD>1?'mid':'low'}">${db.avgTD!=null?db.avgTD.toFixed(2):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD DEFENSE %</span><span class="stat-val ${db.tdDef!=null&&db.tdDef>70?'good':db.tdDef!=null&&db.tdDef>50?'mid':'low'}">${db.tdDef!=null?db.tdDef+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FINISH RATE</span><span class="stat-val ${db.finishRate!=null&&db.finishRate>0.6?'good':'mid'}">${db.finishRate!=null?Math.round(db.finishRate*100)+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">AVG FP (CALC)</span><span class="stat-val ${(db.avgFP??db.avgFP_p6)!=null&&activeLine!=null&&((db.avgFP??db.avgFP_p6) as number)>activeLine?'good':'low'}">${db.avgFP!=null?db.avgFP.toFixed(1):(db.avgFP_p6!=null?db.avgFP_p6.toFixed(1):'...')}</span></div>
          <div class="stat-row"><span class="stat-label">W.AVG FP (RECENT)</span><span class="stat-val ${weightedAvg!=null&&activeLine!=null&&weightedAvg>activeLine?'good':'low'}">${weightedAvg!=null?weightedAvg.toFixed(1):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP FLOOR / CEILING</span><span class="stat-val mid">${db.fpFloor!=null?`${fpFloor} / ${fpCeiling}`:'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP STD DEV</span><span class="stat-val ${db.fpStdDev!=null&&db.fpStdDev<15?'good':db.fpStdDev!=null&&db.fpStdDev<25?'mid':'low'}">${db.fpStdDev!=null?db.fpStdDev:'...'}</span></div>
          <div class="stat-row"><span class="stat-label">CONSISTENCY %</span><span class="stat-val ${consistencyClass}">${fpConsistency!=null?fpConsistency+'%':'...'}</span></div>
          ${db.fiveRoundRate!=null&&db.fiveRoundRate>0?`<div class="stat-row"><span class="stat-label">5-ROUND FIGHT RATE</span><span class="stat-val mid">${Math.round(db.fiveRoundRate*100)}%</span></div>`:''}
          ${db.detailUrl?`<div class="panel-link-wrap"><a href="${db.detailUrl}" target="_blank" class="panel-link">↗ View on UFCStats</a></div>`:''}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">Lean Analysis (FP)</div>
          <div class="lean-reason">${groupedReasonsHTML}</div>
          ${lean.verdict?`<div class="lean-verdict ${lean.lean}">${lean.verdict}</div>`:''}
        </div>
        ${f.lean_ss?`<div class="detail-panel">
          <div class="detail-panel-title">SS Lean (P6: ${f.line_p6_ss||'—'} · UD: ${f.line_ud_ss||'—'} · PP: ${f.line_pp_ss||'—'})</div>
          <div class="lean-reason">${f.lean_ss.reasons.map(r=>`<div class="lean-point"><span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ss.lean}">${f.lean_ss.verdict}</div>
        </div>`:''}
        ${f.lean_td?`<div class="detail-panel">
          <div class="detail-panel-title">TD Lean (P6: ${f.line_p6_td||'—'} · UD: ${f.line_ud_td||'—'} · PP: ${f.line_pp_td||'—'})</div>
          <div class="lean-reason">${f.lean_td.reasons.map(r=>`<div class="lean-point"><span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_td.lean}">${f.lean_td.verdict}</div>
        </div>`:''}
        ${f.lean_ft?`<div class="detail-panel">
          <div class="detail-panel-title">FT Lean (P6: ${f.line_p6_ft||'—'} · UD: ${f.line_ud_ft||'—'} · PP: ${f.line_pp_ft||'—'})</div>
          <div class="lean-reason">${f.lean_ft.reasons.map(r=>`<div class="lean-point"><span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ft.lean}">${f.lean_ft.verdict}</div>
        </div>`:''}
      </div>
    </div>`;
  return row;
}

function toggleRow(row: HTMLElement): void { row.classList.toggle('expanded'); }

// ── FIGHTER IMAGE FETCHER ──────────────────────────────────────────────────
const _fighterImgCache = new Map<string, string | null>();

function nameToUfcSlug(name: string): string {
  return name.toLowerCase()
    .replace(/['''`]/g, '')        // drop apostrophes (O'Neill → oneill)
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphen
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
}

async function fetchFighterImageUrl(name: string): Promise<string | null> {
  const slug = nameToUfcSlug(name);
  if (_fighterImgCache.has(slug)) return _fighterImgCache.get(slug) ?? null;

  const cacheKey = `ufc_img_v1_${slug}`;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await new Promise<Record<string, any>>(resolve =>
      chrome.storage.local.get([cacheKey], resolve)
    );
    if (stored[cacheKey] !== undefined) {
      _fighterImgCache.set(slug, stored[cacheKey]);
      return stored[cacheKey];
    }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`https://www.ufc.com/athlete/${slug}`, {
      signal: ctl.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timer);
    if (!res.ok) { _fighterImgCache.set(slug, null); return null; }
    const html = await res.text();
    // Try og:image and twitter:image in multiple attribute orderings
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    let url: string | null = null;
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1] && m[1].startsWith('http')) { url = m[1]; break; }
    }
    _fighterImgCache.set(slug, url);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [cacheKey]: url });
    }
    return url;
  } catch {
    clearTimeout(timer);
    _fighterImgCache.set(slug, null);
    return null;
  }
}

// ── HEAD-TO-HEAD MODAL ─────────────────────────────────────────────────────
function renderH2HModal(a: AnalyzerFighter, b: AnalyzerFighter): void {
  const modal = document.getElementById('h2hModal');
  const content = document.getElementById('h2hContent');
  if (!modal || !content) return;

  const da = a.db || {} as FighterDB;
  const db2 = b.db || {} as FighterDB;
  const leanA = getEffectiveLean(a);
  const leanB = getEffectiveLean(b);
  const lineA = activePlatformLine(a);
  const lineB = activePlatformLine(b);

  function leanBadge(lean: EffectiveLean): string {
    if (lean.lean === 'over') return `<span class="h2h-lean over">▲ OVER ${lean.conf}%</span>`;
    if (lean.lean === 'under') return `<span class="h2h-lean under">▼ UNDER ${lean.conf}%</span>`;
    return `<span class="h2h-lean none">—</span>`;
  }

  function ssLeanBadge(f: AnalyzerFighter): string {
    const l = f.lean_ss;
    if (!l || l.lean === 'none') return '<span class="h2h-lean none">—</span>';
    if (l.lean === 'over') return `<span class="h2h-lean over">▲ OVER ${l.conf}%</span>`;
    return `<span class="h2h-lean under">▼ UNDER ${l.conf}%</span>`;
  }

  function tdLeanBadge(f: AnalyzerFighter): string {
    const l = f.lean_td;
    if (!l || l.lean === 'none') return '<span class="h2h-lean none">—</span>';
    if (l.lean === 'over') return `<span class="h2h-lean over">▲ OVER ${l.conf}%</span>`;
    return `<span class="h2h-lean under">▼ UNDER ${l.conf}%</span>`;
  }

  // prettier-ignore
  function statRow(label: string, valA: string | number | null | undefined, valB: string | number | null | undefined, higherBetter = true): string {
    const na = valA == null ? null : Number(valA);
    const nb = valB == null ? null : Number(valB);
    let clsA = '', clsB = '';
    if (na != null && nb != null && Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
      const aBetter = higherBetter ? na > nb : na < nb;
      clsA = aBetter ? 'h2h-win' : 'h2h-lose';
      clsB = aBetter ? 'h2h-lose' : 'h2h-win';
    }
    const dispA = valA == null ? '—' : String(valA);
    const dispB = valB == null ? '—' : String(valB);
    return `<tr><td class="${clsA}">${dispA}</td><td class="h2h-label">${label}</td><td class="${clsB}">${dispB}</td></tr>`;
  }

  const ssLineA = a.line_p6_ss ?? a.line_ud_ss ?? a.line_pp_ss ?? a.line_betr_ss ?? null;
  const ssLineB = b.line_p6_ss ?? b.line_ud_ss ?? b.line_pp_ss ?? b.line_betr_ss ?? null;
  const tdLineA = a.line_p6_td ?? a.line_ud_td ?? a.line_pp_td ?? a.line_betr_td ?? null;
  const tdLineB = b.line_p6_td ?? b.line_ud_td ?? b.line_pp_td ?? b.line_betr_td ?? null;

  const avgFPA = da.avgFP_weighted ?? da.avgFP ?? null;
  const avgFPB = db2.avgFP_weighted ?? db2.avgFP ?? null;
  const avgSSA = da.avgSigStr != null ? da.avgSigStr : (da as any).avgSS ?? null;
  const avgSSB = db2.avgSigStr != null ? db2.avgSigStr : (db2 as any).avgSS ?? null;

  const moneyA = a.moneyline;
  const moneyB = b.moneyline;
  function formatML(ml: number | null | undefined): string {
    if (ml == null || !Number.isFinite(ml)) return '—';
    return ml > 0 ? `+${ml}` : String(ml);
  }

  content.innerHTML = `
    <div class="h2h-fighters">
      <div class="h2h-fighter-col h2h-side-a">
        <div class="h2h-img-wrap"><img id="h2hImgA" class="h2h-img" src="" alt="${a.name}" /></div>
        <div class="h2h-fighter-name">${a.name}</div>
        <div class="h2h-fighter-record">${da.record || '—'}</div>
      </div>
      <div class="h2h-vs">VS</div>
      <div class="h2h-fighter-col h2h-side-b">
        <div class="h2h-img-wrap"><img id="h2hImgB" class="h2h-img" src="" alt="${b.name}" /></div>
        <div class="h2h-fighter-name">${b.name}</div>
        <div class="h2h-fighter-record">${db2.record || '—'}</div>
      </div>
    </div>
    <table class="h2h-table">
      <thead><tr><th class="h2h-side-a">${a.name.split(' ').pop()}</th><th></th><th class="h2h-side-b">${b.name.split(' ').pop()}</th></tr></thead>
      <tbody>
        <tr><td>${da.style||'—'}</td><td class="h2h-label">STYLE</td><td>${db2.style||'—'}</td></tr>
        <tr><td>${da.country||'—'}</td><td class="h2h-label">COUNTRY</td><td>${db2.country||'—'}</td></tr>
        <tr><td colspan="3" class="h2h-section-head">LINES</td></tr>
        <tr><td>${lineA != null ? lineA : '—'}</td><td class="h2h-label">FP LINE</td><td>${lineB != null ? lineB : '—'}</td></tr>
        <tr><td>${ssLineA != null ? ssLineA : '—'}</td><td class="h2h-label">SS LINE</td><td>${ssLineB != null ? ssLineB : '—'}</td></tr>
        <tr><td>${tdLineA != null ? tdLineA : '—'}</td><td class="h2h-label">TD LINE</td><td>${tdLineB != null ? tdLineB : '—'}</td></tr>
        <tr><td>${formatML(moneyA)}</td><td class="h2h-label">MONEYLINE</td><td>${formatML(moneyB)}</td></tr>
        <tr><td colspan="3" class="h2h-section-head">PROJECTIONS</td></tr>
        ${statRow('AVG FP (W)', avgFPA != null ? avgFPA.toFixed(1) : null, avgFPB != null ? avgFPB.toFixed(1) : null)}
        ${statRow('FP FLOOR', da.fpFloor != null ? da.fpFloor.toFixed(1) : null, db2.fpFloor != null ? db2.fpFloor.toFixed(1) : null)}
        ${statRow('FP CEILING', da.fpCeiling != null ? da.fpCeiling.toFixed(1) : null, db2.fpCeiling != null ? db2.fpCeiling.toFixed(1) : null)}
        ${statRow('FP STD DEV', da.fpStdDev ?? null, db2.fpStdDev ?? null, false)}
        ${statRow('CONSISTENCY', da.fpConsistency != null ? da.fpConsistency+'%' : null, db2.fpConsistency != null ? db2.fpConsistency+'%' : null)}
        <tr><td colspan="3" class="h2h-section-head">STRIKING</td></tr>
        ${statRow('AVG SIG STR', avgSSA != null ? (avgSSA as number).toFixed(1) : null, avgSSB != null ? (avgSSB as number).toFixed(1) : null)}
        ${statRow('SLpM', da.slpm != null ? da.slpm.toFixed(2) : null, db2.slpm != null ? db2.slpm.toFixed(2) : null)}
        ${statRow('STR ACC %', da.strAcc != null ? da.strAcc+'%' : null, db2.strAcc != null ? db2.strAcc+'%' : null)}
        ${statRow('STR DEF %', da.strDef != null ? da.strDef+'%' : null, db2.strDef != null ? db2.strDef+'%' : null)}
        <tr><td colspan="3" class="h2h-section-head">GRAPPLING</td></tr>
        ${statRow('TD AVG/15', da.avgTD != null ? da.avgTD.toFixed(2) : null, db2.avgTD != null ? db2.avgTD.toFixed(2) : null)}
        ${statRow('TD ACC %', da.tdAcc != null ? da.tdAcc+'%' : null, db2.tdAcc != null ? db2.tdAcc+'%' : null)}
        ${statRow('TD DEF %', da.tdDef != null ? da.tdDef+'%' : null, db2.tdDef != null ? db2.tdDef+'%' : null)}
        <tr><td colspan="3" class="h2h-section-head">LEANS</td></tr>
        <tr><td>${leanBadge(leanA)}</td><td class="h2h-label">FP LEAN</td><td>${leanBadge(leanB)}</td></tr>
        <tr><td>${ssLeanBadge(a)}</td><td class="h2h-label">SS LEAN</td><td>${ssLeanBadge(b)}</td></tr>
        <tr><td>${tdLeanBadge(a)}</td><td class="h2h-label">TD LEAN</td><td>${tdLeanBadge(b)}</td></tr>
        ${da.finishRate != null || db2.finishRate != null ? statRow('FINISH RATE', da.finishRate != null ? Math.round(da.finishRate*100)+'%' : null, db2.finishRate != null ? Math.round(db2.finishRate*100)+'%' : null) : ''}
      </tbody>
    </table>`;

  modal.classList.remove('is-hidden');

  // Async load fighter images
  void Promise.all([fetchFighterImageUrl(a.name), fetchFighterImageUrl(b.name)]).then(([urlA, urlB]) => {
    const imgA = document.getElementById('h2hImgA') as HTMLImageElement | null;
    const imgB = document.getElementById('h2hImgB') as HTMLImageElement | null;
    if (imgA && urlA) { imgA.src = urlA; imgA.style.display = 'block'; }
    if (imgB && urlB) { imgB.src = urlB; imgB.style.display = 'block'; }
  });
}

// ── DATA LOADING ──────────────────────────────────────────────────────────
const NAME_ALIASES: Record<string, string> = {
  'Jung Young Lee':   'Jeongyeong Lee',
  'Jungyoung Lee':    'Jeongyeong Lee',
  'Su Sumudaerji':    'Su Mudaerji',
  'Sumudaerji Su':    'Su Mudaerji',
  'Sumudaerji':       'Su Mudaerji',
  'Damon Jackson':    'Donte Johnson',
  'Myktybek Orolbai': 'Myktybek Orolbai Uulu',
  'Orolbai':          'Myktybek Orolbai Uulu',
  'Kevin Vallejos':   'Kevin Vallejos',
  'Jose Miguel Delgado': 'Jose Delgado',
  'Jose M Delgado':   'Jose Delgado',
};

function normalizeName(name: string|null|undefined): string|null {
  if (!name || name === 'null' || name === 'undefined') return null;
  let n = name.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim();
  n = n.replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ');
  n = n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return NAME_ALIASES[n] || n;
}

function dedup(str: string): string { return str.replace(/(.)\1+/g, '$1'); }

function namesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const aParts = a.split(' '), bParts = b.split(' ');
  const aFirst = aParts[0], aLast = aParts[aParts.length - 1];
  const bFirst = bParts[0], bLast = bParts[bParts.length - 1];
  if (aLast === bLast && aFirst[0] === bFirst[0]) return true;
  if (dedup(a.toLowerCase()) === dedup(b.toLowerCase())) return true;
  if (aLast === bLast && (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))) return true;
  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return true;
  if (aLast === bLast && aLast.length > 4) return true;
  return false;
}

function resolveMoneylineFromMap(name: string): number | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const direct = fightOddsMoneylineByName[normalized];
  if (Number.isFinite(direct)) return direct;

  for (const [oddsName, odds] of Object.entries(fightOddsMoneylineByName)) {
    if (namesMatch(oddsName, normalized)) return odds;
  }
  return null;
}

interface RawLineFighter {
  name?: string;
  line_fp?: number | null;
  line_ss?: number | null;
  line_td?: number | null;
  line_ft?: number | null;
  line?: number | null;
  opponent?: string | null;
  ss_over_odds?: number | null;
  ss_under_odds?: number | null;
  td_over_odds?: number | null;
  td_under_odds?: number | null;
  ft_over_odds?: number | null;
  ft_under_odds?: number | null;
}

interface MergedLineEntry {
  name: string;
  line_p6: number | null;
  line_p6_ss: number | null;
  line_p6_td: number | null;
  line_p6_ft: number | null;
  line_ud: number | null;
  line_ud_ss: number | null;
  line_ud_td: number | null;
  line_ud_ft: number | null;
  line_pp: number | null;
  line_pp_ss: number | null;
  line_pp_td: number | null;
  line_pp_ft: number | null;
  line_dk_ss: number | null;
  line_dk_td: number | null;
  line_dk_ft: number | null;
  ss_over_odds: number | null;
  ss_under_odds: number | null;
  td_over_odds: number | null;
  td_under_odds: number | null;
  ft_over_odds: number | null;
  ft_under_odds: number | null;
  line_betr: number | null;
  line_betr_ss: number | null;
  line_betr_td: number | null;
  line_betr_ft: number | null;
  moneyline: number | null;
  opponent: string | null;
}

function createMergedLineEntry(name: string): MergedLineEntry {
  return {
    name,
    line_p6: null,
    line_p6_ss: null,
    line_p6_td: null,
    line_p6_ft: null,
    line_ud: null,
    line_ud_ss: null,
    line_ud_td: null,
    line_ud_ft: null,
    line_pp: null,
    line_pp_ss: null,
    line_pp_td: null,
    line_pp_ft: null,
    line_dk_ss: null,
    line_dk_td: null,
    line_dk_ft: null,
    ss_over_odds: null,
    ss_under_odds: null,
    td_over_odds: null,
    td_under_odds: null,
    ft_over_odds: null,
    ft_under_odds: null,
    line_betr: null,
    line_betr_ss: null,
    line_betr_td: null,
    line_betr_ft: null,
    moneyline: null,
    opponent: null,
  };
}

async function mergeAndEnrich(p6Fighters: RawLineFighter[], udFighters: RawLineFighter[], betrFighters: RawLineFighter[], ppFighters: RawLineFighter[] = [], dkFighters: RawLineFighter[] = []): Promise<void> {
  debugLog(`P6 fighters (${(p6Fighters||[]).length}): ${(p6Fighters||[]).map((f) => f.name).join(', ')}`);
  debugLog(`UD fighters (${(udFighters||[]).length}): ${(udFighters||[]).map((f) => f.name).join(', ')}`);
  const map: Record<string, MergedLineEntry> = {};

  function isValidFighterName(name: unknown): name is string {
    if (!name || typeof name !== 'string') return false;
    if (name.includes(':') || name.includes('(') || name.includes(')')) return false;
    if (name.length < 4 || name.length > 50) return false;
    const words = name.trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    if (!/^[A-Z]/.test(name)) return false;
    return true;
  }

  (p6Fighters || []).forEach((f) => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name);
    if (!n) return;
    if (!map[n]) map[n] = createMergedLineEntry(n);
    map[n].line_p6    = f.line_fp ?? f.line ?? null;
    map[n].line_p6_ss = f.line_ss ?? null;
    map[n].line_p6_td = f.line_td ?? null;
    map[n].line_p6_ft = f.line_ft ?? null;
    if (f.ss_over_odds != null) map[n].ss_over_odds = f.ss_over_odds;
    if (f.ss_under_odds != null) map[n].ss_under_odds = f.ss_under_odds;
    if (f.td_over_odds != null) map[n].td_over_odds = f.td_over_odds;
    if (f.td_under_odds != null) map[n].td_under_odds = f.td_under_odds;
    if (f.ft_over_odds != null) map[n].ft_over_odds = f.ft_over_odds;
    if (f.ft_under_odds != null) map[n].ft_under_odds = f.ft_under_odds;
    if (f.opponent) map[n].opponent = normalizeName(f.opponent);
  });

  function findOrCreateEntry(n: string): MergedLineEntry {
    if (map[n]) return map[n];
    const existing = Object.keys(map).find(k => namesMatch(k, n));
    if (existing) { if (existing !== n) debugLog(`Fuzzy merge: "${n}" → "${existing}"`); return map[existing]; }
    debugLog(`UD-only (no P6 match): "${n}"`);
    map[n] = createMergedLineEntry(n);
    return map[n];
  }

  (udFighters || []).forEach((f) => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name); if (!n) return;
    const entry = findOrCreateEntry(n);
    entry.line_ud    = f.line_fp ?? f.line ?? null;
    entry.line_ud_ss = f.line_ss ?? null;
    entry.line_ud_td = f.line_td ?? null;
    entry.line_ud_ft = f.line_ft ?? null;
    if (f.ss_over_odds != null) entry.ss_over_odds = f.ss_over_odds;
    if (f.ss_under_odds != null) entry.ss_under_odds = f.ss_under_odds;
    if (f.td_over_odds != null) entry.td_over_odds = f.td_over_odds;
    if (f.td_under_odds != null) entry.td_under_odds = f.td_under_odds;
    if (f.ft_over_odds != null) entry.ft_over_odds = f.ft_over_odds;
    if (f.ft_under_odds != null) entry.ft_under_odds = f.ft_under_odds;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
  });

  (betrFighters || []).forEach((f) => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name); if (!n) return;
    const entry = findOrCreateEntry(n);
    entry.line_betr    = f.line_fp ?? f.line ?? null;
    entry.line_betr_ss = f.line_ss ?? null;
    entry.line_betr_td = f.line_td ?? null;
    entry.line_betr_ft = f.line_ft ?? null;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
    // Betr lines are entered manually without opponents — look them up from the
    // upcoming card so the fighter survives the missing-opponent prune below.
    if (!entry.opponent) {
      const cardOpp = findOpponentFromUpcomingCard(n);
      if (cardOpp) entry.opponent = cardOpp;
    }
  });

  (ppFighters || []).forEach((f) => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name); if (!n) return;
    const entry = findOrCreateEntry(n);
    entry.line_pp    = f.line_fp ?? f.line ?? null;
    entry.line_pp_ss = f.line_ss ?? null;
    entry.line_pp_td = f.line_td ?? null;
    entry.line_pp_ft = f.line_ft ?? null;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
  });

  (dkFighters || []).forEach((f) => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name); if (!n) return;
    const entry = findOrCreateEntry(n);
    entry.line_dk_ss = f.line_ss ?? null;
    entry.line_dk_td = f.line_td ?? null;
    entry.line_dk_ft = f.line_ft ?? null;
    if (f.ss_over_odds != null) entry.ss_over_odds = f.ss_over_odds;
    if (f.ss_under_odds != null) entry.ss_under_odds = f.ss_under_odds;
    if (f.td_over_odds != null) entry.td_over_odds = f.td_over_odds;
    if (f.td_under_odds != null) entry.td_under_odds = f.td_under_odds;
    if (f.ft_over_odds != null) entry.ft_over_odds = f.ft_over_odds;
    if (f.ft_under_odds != null) entry.ft_under_odds = f.ft_under_odds;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
  });

  Object.values(map).forEach((entry) => {
    entry.moneyline = resolveMoneylineFromMap(entry.name);
  });

  const initialEntries = Object.values(map);
  let mergedEntries = initialEntries;
  if (initialEntries.length >= 6) {
    const beforeMissingOppPrune = mergedEntries.length;
    mergedEntries = mergedEntries.filter((entry) => {
      const opp = normalizeName(entry.opponent || '');
      return !!opp && opp !== entry.name;
    });
    if (mergedEntries.length >= 4) {
      debugLog(`Pruned missing-opponent fighters: ${beforeMissingOppPrune} -> ${mergedEntries.length}`);
    } else {
      // If source is too sparse, avoid wiping nearly everything.
      mergedEntries = initialEntries;
    }
  }

  if (mergedEntries.length >= 6) {
    const byName = new Map(mergedEntries.map((e) => [e.name, e] as const));
    const beforeReciprocalPrune = mergedEntries.length;
    mergedEntries = mergedEntries.filter((entry) => {
      const opp = normalizeName(entry.opponent || '');
      if (!opp) return false;
      const oppEntry = byName.get(opp);
      if (!oppEntry) return false;
      const oppOpp = normalizeName(oppEntry.opponent || '');
      return oppOpp === entry.name;
    });

    if (mergedEntries.length >= 4) {
      debugLog(`Pruned orphan fighters: ${beforeReciprocalPrune} -> ${mergedEntries.length}`);
    } else {
      // Avoid over-pruning if source data is too sparse/noisy.
      mergedEntries = initialEntries;
    }
  }

  if (mergedEntries.length >= 12) {
    const byName = new Map(mergedEntries.map((e) => [e.name, e] as const));
    const neighbors = new Map<string, Set<string>>();
    mergedEntries.forEach((e) => neighbors.set(e.name, new Set<string>()));

    for (const e of mergedEntries) {
      const opp = normalizeName(e.opponent || '');
      if (!opp) continue;
      if (!byName.has(opp)) continue;
      neighbors.get(e.name)?.add(opp);
      neighbors.get(opp)?.add(e.name);
    }

    const visited = new Set<string>();
    const components: string[][] = [];
    for (const name of byName.keys()) {
      if (visited.has(name)) continue;
      const queue: string[] = [name];
      const comp: string[] = [];
      visited.add(name);
      while (queue.length) {
        const cur = queue.shift() as string;
        comp.push(cur);
        for (const nxt of neighbors.get(cur) || []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
      components.push(comp);
    }

    components.sort((a, b) => b.length - a.length);
    const largest = components[0] || [];
    const second = components[1] || [];
    if (largest.length >= 8 && (second.length === 0 || largest.length >= second.length + 4)) {
      const keep = new Set(largest);
      const before = mergedEntries.length;
      mergedEntries = mergedEntries.filter((e) => keep.has(e.name));
      debugLog(`Pruned side clusters: ${before} -> ${mergedEntries.length} (largest cluster=${largest.length}, next=${second.length})`);
    }
  }

  allFighters = mergedEntries.map((f) => ({ ...f, db: { loaded: false } as FighterDB, lean: createEmptyLean() }));
  renderFighters();

  let entries: MergedLineEntry[] = mergedEntries;
  const dbResults = await Promise.all(entries.map((f) => fetchFighterStats(f.name)));
  const dbMap: Record<string, FighterDB> = {};
  entries.forEach((f, i) => { dbMap[f.name] = dbResults[i]; });

  const loadedCount = entries.filter((f) => !!dbMap[f.name]?.loaded).length;
  if (entries.length >= 12 && loadedCount >= 8) {
    const before = entries.length;
    const pruned = entries.filter((f) => !!dbMap[f.name]?.loaded);
    if (pruned.length >= 8) {
      entries = pruned;
      const keep = new Set(entries.map((e) => e.name));
      allFighters = allFighters.filter((f) => keep.has(f.name));
      debugLog(`Pruned unresolved UFCStats fighters: ${before} -> ${entries.length}`);
      renderFighters();
    }
  }

  const paired = new Set<string>();
  entries.forEach((f) => {
    if (paired.has(f.name)) return;
    const oppName = f.opponent;
    let opp: MergedLineEntry | null = null;
    if (oppName) {
      opp = entries.find((x) => x.name !== f.name && x.name === oppName)
         || entries.find((x) => x.name !== f.name && x.name.toLowerCase() === oppName.toLowerCase())
         || entries.find((x) => {
              if (x.name === f.name) return false;
              const xLast  = x.name.split(' ').pop()?.toLowerCase() || '';
              const oppLast = oppName.split(' ').pop()?.toLowerCase() || '';
              return xLast === oppLast && xLast.length > 3;
          })
        || null;
    }

    const dbA = dbMap[f.name];
    const dbB = opp ? dbMap[opp.name] : null;

    if (opp) {
      const idxA = allFighters.findIndex((x) => x.name === f.name);
      const idxB = allFighters.findIndex((x) => x.name === opp.name);
      if (idxA >= 0) allFighters[idxA].opponent = opp.name;
      if (idxB >= 0) allFighters[idxB].opponent = f.name;
    }

    const lineA_p6 = f.line_p6 ?? null;
    const lineA_ud = f.line_ud ?? null;
    const lineA_pp = f.line_pp ?? null;
    const lineA_betr = f.line_betr ?? null;
    const moneylineA = f.moneyline ?? null;
    const lineB_p6 = opp ? (opp.line_p6 ?? null) : null;
    const lineB_ud = opp ? (opp.line_ud ?? null) : null;
    const lineB_pp = opp ? (opp.line_pp ?? null) : null;
    const lineB_betr = opp ? (opp.line_betr ?? null) : null;
    const moneylineB = opp ? (opp.moneyline ?? null) : null;

    const leanA = calcLean(f.name, dbA, lineA_p6, lineA_ud, lineA_pp, lineA_betr, moneylineA, dbB, lineB_p6, lineB_ud, lineB_pp, lineB_betr, moneylineB);
    const leanB = opp ? calcLean(opp.name, dbB, lineB_p6, lineB_ud, lineB_pp, lineB_betr, moneylineB, dbA, lineA_p6, lineA_ud, lineA_pp, lineA_betr, moneylineA) : null;

    applyLean(f, dbA, leanA);
    if (opp && leanB) applyLean(opp, dbB, leanB);

    const ssLineA = f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
    const tdLineA = f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
    const ftLineA = f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
    const leanSSA = calcSSLean(f.name, dbA, ssLineA, dbB, f.line_dk_ss ?? null);
    const leanTDA = calcTDLean(f.name, dbA, tdLineA, dbB, f.line_dk_td ?? null);
    const leanFTA = calcFTLean(f.name, dbA, ftLineA, dbB, f.line_dk_ft ?? null);
    updateFighterLeans(f.name, leanSSA, leanTDA, leanFTA);

    if (opp) {
      const ssLineB = opp.line_p6_ss ?? opp.line_ud_ss ?? opp.line_pp_ss ?? opp.line_betr_ss ?? opp.line_dk_ss ?? null;
      const tdLineB = opp.line_p6_td ?? opp.line_ud_td ?? opp.line_pp_td ?? opp.line_betr_td ?? opp.line_dk_td ?? null;
      const ftLineB = opp.line_p6_ft ?? opp.line_ud_ft ?? opp.line_pp_ft ?? opp.line_betr_ft ?? opp.line_dk_ft ?? null;
      const leanSSB = calcSSLean(opp.name, dbB, ssLineB, dbA, opp.line_dk_ss ?? null);
      const leanTDB = calcTDLean(opp.name, dbB, tdLineB, dbA, opp.line_dk_td ?? null);
      const leanFTB = calcFTLean(opp.name, dbB, ftLineB, dbA, opp.line_dk_ft ?? null);
      updateFighterLeans(opp.name, leanSSB, leanTDB, leanFTB);
    }

    paired.add(f.name);
    if (opp) paired.add(opp.name);
  });

  debugLog('DEBUG fighters sample: ' + JSON.stringify(
    allFighters.slice(0,3).map((f) => ({ name: f.name, line_p6: f.line_p6, line_ud: f.line_ud, line_p6_td: f.line_p6_td, line_ud_td: f.line_ud_td })), null, 2));

  renderFighters();
  void persistAiLeanSnapshot(allFighters);
}

function applyLean(f: { name: string }, db: FighterDB|null, lean: LeanResult): void {
  const idx = allFighters.findIndex((x) => x.name === f.name);
  if (idx >= 0) {
    allFighters[idx].db = db || { loaded: false } as FighterDB;
    allFighters[idx].lean = lean || createEmptyLean();
  }
}

function updateFighterLeans(name: string, lean_ss: LeanResult|null, lean_td: LeanResult|null, lean_ft: LeanResult|null): void {
  const idx = allFighters.findIndex((x) => x.name === name);
  if (idx >= 0) {
    if (lean_ss) allFighters[idx].lean_ss = lean_ss;
    if (lean_td) allFighters[idx].lean_td = lean_td;
    if (lean_ft) allFighters[idx].lean_ft = lean_ft;
  }
}

// ── UI FUNCTIONS ──────────────────────────────────────────────────────────
interface PlatformLinesPayload {
  fighters: RawLineFighter[];
  capturedAt?: number;
}

interface AnalyzerDataPayload {
  pick6?: PlatformLinesPayload | null;
  underdog?: PlatformLinesPayload | null;
  betr?: PlatformLinesPayload | null;
  prizepicks?: PlatformLinesPayload | null;
  draftkings_sportsbook?: PlatformLinesPayload | null;
}

function updatePlatformBar(data: AnalyzerDataPayload): void {
  const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [];
  const pp = data.prizepicks?.fighters || [], dk = data.draftkings_sportsbook?.fighters || [];
  const el = (id: string) => document.getElementById(id);
  const countP6 = el('countP6'), countUD = el('countUD'), countBetr = el('countBetr'), countPP = el('countPP'), countDK = el('countDK');
  if (countP6)   countP6.textContent   = p6.length   ? `${p6.length}`   : '—';
  if (countUD)   countUD.textContent   = ud.length   ? `${ud.length}`   : '—';
  if (countBetr) countBetr.textContent = betr.length ? `${betr.length}` : '—';
  if (countPP)   countPP.textContent   = pp.length   ? `${pp.length}`   : '—';
  if (countDK)   countDK.textContent   = dk.length   ? `${dk.length}`   : '—';
  el('pillP6')?.classList.toggle('active', p6.length > 0);
  el('pillUD')?.classList.toggle('active', ud.length > 0);
  el('pillBetr')?.classList.toggle('active', betr.length > 0);
  el('pillPP')?.classList.toggle('active', pp.length > 0);
  el('pillDK')?.classList.toggle('active', dk.length > 0);
  if (currentPlatform === 'pick6' && p6.length === 0) {
    if (ud.length > 0) setActivePlatform('underdog');
    else if (pp.length > 0) setActivePlatform('prizepicks');
    else if (dk.length > 0) setActivePlatform('draftkings_sportsbook');
    else if (betr.length > 0) setActivePlatform('betr');
  } else if (currentPlatform === 'draftkings_sportsbook' && dk.length === 0) {
    if (p6.length > 0) setActivePlatform('pick6');
    else if (ud.length > 0) setActivePlatform('underdog');
    else if (pp.length > 0) setActivePlatform('prizepicks');
    else if (betr.length > 0) setActivePlatform('betr');
  }
  document.querySelector(`[data-platform="${currentPlatform}"]`)?.classList.add('platform-selected');
  const total = p6.length + ud.length + betr.length + pp.length + dk.length;
  const dot = el('extDot'), label = el('extLabel');
  if (!dot || !label) return;
  if (total === 0) { dot.className = 'ext-dot'; label.textContent = 'No extension data'; label.style.color = 'var(--text3)'; }
  else if (p6.length > 0) { dot.className = 'ext-dot live'; label.textContent = `Live · ${total} lines`; label.style.color = 'var(--green)'; }
  else { dot.className = 'ext-dot partial'; label.textContent = `Partial · ${total} lines`; label.style.color = 'var(--orange)'; }
}

async function loadData(): Promise<void> {
  if (isDataLoadInFlight) {
    queuedDataReload = true;
    return;
  }

  isDataLoadInFlight = true;
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spinning');

  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await syncUpcomingCardContext();
      await loadOpeningLines();
      const result = await storageGet<Record<string, any>>([...STORAGE_LINE_KEYS, STORAGE_ODDS_KEY, STORAGE_BETR_MANUAL_KEY]);
      const rawOdds = result[STORAGE_ODDS_KEY];
      fightOddsMoneylineByName = {};
      if (rawOdds && typeof rawOdds === 'object') {
        for (const [name, val] of Object.entries(rawOdds as Record<string, unknown>)) {
          const normalizedName = normalizeName(name);
          const odds = typeof val === 'number' ? val : Number(val);
          if (!normalizedName || !Number.isFinite(odds)) continue;
          fightOddsMoneylineByName[normalizedName] = odds;
        }
      }

      // Apply persisted manual Betr overrides on top of scraped lines_betr
      const manualBetr = result[STORAGE_BETR_MANUAL_KEY] as { fighters?: RawLineFighter[]; capturedAt?: number } | null;
      if (manualBetr?.fighters?.length) {
        const base = (result['lines_betr'] as { fighters?: RawLineFighter[]; capturedAt?: number } | null)?.fighters || [];
        const merged = applyBetrManualOverrides(base, manualBetr.fighters);
        result['lines_betr'] = { fighters: merged, capturedAt: manualBetr.capturedAt ?? Date.now() };
      }

      const filteredPick6 = filterPayloadToUpcomingCard(result['lines_pick6'] || null);
      const filteredUnderdog = filterPayloadToUpcomingCard(result['lines_underdog'] || null);
      const filteredBetr = filterPayloadToUpcomingCard(result['lines_betr'] || null);
      const filteredPrizePicks = filterPayloadToUpcomingCard(result['lines_prizepicks'] || null);
      const filteredDraftKings = filterPayloadToUpcomingCard(result['lines_draftkings_sportsbook'] || null);
      inferredEventNameFromLines = inferEventNameFromPayloads([
        filteredPick6,
        filteredUnderdog,
        filteredBetr,
        filteredPrizePicks,
        filteredDraftKings,
      ]);
      if (inferredEventNameFromLines) {
        upcomingEventName = inferredEventNameFromLines;
        const nameEl = document.getElementById('eventName');
        if (nameEl) nameEl.textContent = inferredEventNameFromLines;
      }
      await processData({
        pick6: pruneOrphanFighters(filteredPick6),
        underdog: pruneOrphanFighters(filteredUnderdog),
        betr: pruneOrphanFighters(filteredBetr),
        prizepicks: pruneOrphanFighters(filteredPrizePicks),
        draftkings_sportsbook: pruneOrphanFighters(filteredDraftKings),
      });
    } else {
      fightOddsMoneylineByName = {};
      await new Promise((resolve) => setTimeout(resolve, 400));
      await processData(DEMO_DATA);
    }
  } catch (e) {
    console.error('LoadData error:', e);
  } finally {
    if (icon) icon.classList.remove('spinning');
    isDataLoadInFlight = false;
    if (queuedDataReload) {
      queuedDataReload = false;
      // Fire one trailing refresh to collapse bursty update events.
      void loadData();
    }
  }
}

function requestDataReload(delayMs = 0): void {
  if (delayMs > 0) {
    setTimeout(() => { void loadData(); }, delayMs);
    return;
  }
  void loadData();
}

function startPeriodicDataReload(intervalMs = 60000): void {
  if (periodicRefreshTimer) clearInterval(periodicRefreshTimer);
  periodicRefreshTimer = setInterval(() => { requestDataReload(); }, intervalMs);
}

async function processData(data: AnalyzerDataPayload): Promise<void> {
  updatePlatformBar(data);
  const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [], pp = data.prizepicks?.fighters || [], dk = data.draftkings_sportsbook?.fighters || [];
  const empty = document.getElementById('emptyState'), container = document.getElementById('cardContainer');
  const fhr = document.getElementById('fighterHeaderRow');
  if (p6.length === 0 && ud.length === 0 && betr.length === 0 && pp.length === 0 && dk.length === 0) {
    if (empty) empty.style.display = 'block';
    if (container) container.style.display = 'none';
    if (fhr) fhr.classList.add('is-hidden');
    return;
  }
  if (empty) empty.style.display = 'none';
  if (container) container.style.display = 'block';
  if (fhr) fhr.classList.remove('is-hidden');
  showToast(`Loading ${p6.length || ud.length || betr.length || pp.length || dk.length} fighters + fetching UFCStats...`);
  await mergeAndEnrich(p6, ud, betr, pp, dk);
  snapshotOpeningLines();
  showToast(`Loaded ${allFighters.filter(f => f.db?.loaded).length} fighters with stats!`);
}

function showToast(msg: string): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function setButtonBusyState(
  button: HTMLButtonElement | null,
  isBusy: boolean,
  options: { busyText?: string; idleText?: string; busyOpacity?: string; idleOpacity?: string } = {},
): void {
  if (!button) return;
  button.disabled = isBusy;
  button.style.opacity = isBusy ? (options.busyOpacity ?? '0.6') : (options.idleOpacity ?? '1');
  if (isBusy && options.busyText) button.textContent = options.busyText;
  if (!isBusy && options.idleText) button.textContent = options.idleText;
}

function setIconSpinnerState(icon: HTMLElement | null, isSpinning: boolean, idleText = '⚡'): void {
  if (!icon) return;
  if (isSpinning) {
    icon.textContent = '⟳';
    icon.style.display = 'inline-block';
    icon.style.animation = 'spin 1s linear infinite';
    return;
  }
  icon.style.animation = '';
  icon.textContent = idleText;
}

// ── DEMO DATA ──────────────────────────────────────────────────────────────
const DEMO_DATA = {
  pick6: { fighters: [
    { name: "Josh Emmett",         line_fp: 82.5,  line_ss: 44.5, line_td: 0.5,  opponent: "Kevin Vallejos" },
    { name: "Kevin Vallejos",      line_fp: 62.5,  line_ss: 49.5, line_td: 0.5,  opponent: "Josh Emmett" },
    { name: "Amanda Lemos",        line_fp: 71.5,  line_ss: 55.5, line_td: 0.5,  opponent: "Gillian Robertson" },
    { name: "Gillian Robertson",   line_fp: 55.5,  line_ss: 22.5, line_td: 2.5,  opponent: "Amanda Lemos" },
    { name: "Oumar Sy",            line_fp: 74.5,  line_ss: 42.5, line_td: 1.5,  opponent: "Ion Cutelaba" },
    { name: "Ion Cutelaba",        line_fp: 68.5,  line_ss: 48.5, line_td: 0.5,  opponent: "Oumar Sy" },
    { name: "Vitor Petrino",       line_fp: 79.5,  line_ss: 39.5, line_td: 0.5,  opponent: "Steven Asplund" },
    { name: "Steven Asplund",      line_fp: 52.5,  line_ss: 34.5, line_td: null, opponent: "Vitor Petrino" },
    { name: "Andre Fili",          line_fp: 73.5,  line_ss: 55.5, line_td: 0.5,  opponent: "Jose Delgado" },
    { name: "Jose Delgado",        line_fp: 58.5,  line_ss: 44.5, line_td: 0.5,  opponent: "Andre Fili" },
    { name: "Brad Tavares",        line_fp: 68.5,  line_ss: 49.5, line_td: 0.5,  opponent: "Eryk Anders" },
    { name: "Eryk Anders",         line_fp: 64.5,  line_ss: 46.5, line_td: 0.5,  opponent: "Brad Tavares" },
    { name: "Bruno Silva",         line_fp: 72.5,  line_ss: 54.5, line_td: 0.5,  opponent: "Charles Johnson" },
    { name: "Charles Johnson",     line_fp: 66.5,  line_ss: 48.5, line_td: 0.5,  opponent: "Bruno Silva" },
    { name: "Piera Rodriguez",     line_fp: 68.5,  line_ss: 44.5, line_td: 1.5,  opponent: "Sam Hughes" },
    { name: "Sam Hughes",          line_fp: 55.5,  line_ss: 38.5, line_td: 0.5,  opponent: "Piera Rodriguez" },
  ], capturedAt: Date.now() },
  underdog: { fighters: [
    { name: "Josh Emmett",         line_fp: 80.5,  line_ss: 42.5, line_td: 0.5,  opponent: "Kevin Vallejos" },
    { name: "Kevin Vallejos",      line_fp: 60.5,  line_ss: 47.5, line_td: 0.5,  opponent: "Josh Emmett" },
    { name: "Amanda Lemos",        line_fp: 69.5,  line_ss: 53.5, line_td: 0.5,  opponent: "Gillian Robertson" },
    { name: "Gillian Robertson",   line_fp: 53.5,  line_ss: 21.5, line_td: 2.5,  opponent: "Amanda Lemos" },
    { name: "Oumar Sy",            line_fp: 72.5,  line_ss: 40.5, line_td: 1.5,  opponent: "Ion Cutelaba" },
    { name: "Ion Cutelaba",        line_fp: 66.5,  line_ss: 46.5, line_td: 0.5,  opponent: "Oumar Sy" },
    { name: "Vitor Petrino",       line_fp: 77.5,  line_ss: 37.5, line_td: 0.5,  opponent: "Steven Asplund" },
  ], capturedAt: Date.now() },
  betr: null,
  prizepicks: null,
} satisfies AnalyzerDataPayload;

interface RuntimeLineDropItem {
  platform?: string;
  type?: string;
  count?: number;
  fighter?: string;
  from?: number;
  to?: number;
  delta?: number;
}

interface RuntimeAnalyzerMessage {
  type?: 'LINES_DROPPED' | 'LINES_UPDATED' | string;
  drops?: RuntimeLineDropItem[];
  platform?: string;
  count?: number;
  event?: string;
  udCount?: number;
  p6Count?: number;
}

function toWatchPlatform(value: string | undefined): WatchPlatform {
  const normalized = String(value || 'underdog').toLowerCase();
  if (normalized.includes('pick6')) return 'pick6';
  if (normalized.includes('betr')) return 'betr';
  if (normalized.includes('prize')) return 'prizepicks';
  return 'underdog';
}

function toWatchedStat(value: string | undefined): WatchedStatType {
  const normalized = String(value || 'fp').toLowerCase();
  if (normalized.includes('ss')) return 'ss';
  if (normalized.includes('td')) return 'td';
  return 'fp';
}

// ── CHROME MESSAGE LISTENER ───────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg: RuntimeAnalyzerMessage) => {
    if (msg.type === 'LINES_DROPPED') {
      showLineDropAlert(msg);
      setWatcherVisualState('detected', 'Line Alert');
      const ts = Date.now();
      const converted: LineMovementEvent[] = (msg.drops || []).map((d, i: number) => ({
        id: `bg-${ts}-${i}`,
        timestamp: ts,
        fighter: d.fighter || 'Multiple fighters',
        platform: toWatchPlatform(d.platform),
        stat: toWatchedStat(d.type),
        from: Number(d.from ?? 0),
        to: Number(d.to ?? 0),
        delta: Number(d.delta ?? -1),
        direction: Number(d.delta ?? -1) < 0 ? 'drop' : 'rise',
      }));
      if (converted.length) {
        recentLineMoves = [...converted, ...recentLineMoves].slice(0, 120);
        renderLineMoveFeed();
      }
      requestDataReload(1500);
    }
    if (msg.type === 'LINES_UPDATED') {
      console.log('[UFC Analyzer] Lines updated:', msg.platform, msg.count);
      requestDataReload();
    }
    if (msg.type === 'ODDS_UPDATED') {
      console.log('[UFC Analyzer] Odds updated:', msg.count);
      requestDataReload();
    }
    if (msg.type === 'ARCHIVE_SETTLED') {
      const settled = (msg as any).settled ?? 0;
      showToast(`✓ Archive settled: ${settled} result${settled !== 1 ? 's' : ''} updated`);
      // If archive panel is open, re-render it
      if (currentView === 'archive') {
        const container = document.getElementById('cardContainer');
        if (container) void renderArchivePanel(container);
      }
    }
  });
}

function showLineDropAlert(msg: RuntimeAnalyzerMessage): void {
  const banner = document.getElementById('lineDropBanner');
  const txt    = document.getElementById('lineDropText');
  if (!banner) return;
  const event = msg.event || 'Upcoming UFC Event';
  const dropSummary = (msg.drops || [])
    .map((d) => `${d.platform} ${d.type} (${d.count} fighters)`)
    .join(' · ') || `${msg.udCount || 0} fighters on Underdog`;
  if (txt) txt.innerHTML = `🔔 <strong>LINES DROPPED!</strong> &nbsp;${event} — ${dropSummary}. Auto-loading now...`;
  banner.style.display = 'flex';
  banner.style.animation = 'pulseAlert 0.5s ease-in-out 3';
  setTimeout(() => { banner.style.display = 'none'; }, 25000);
}

function parseEventDateMs(raw: string): number {
  if (!raw) return NaN;
  const direct = new Date(raw).getTime();
  if (Number.isFinite(direct)) return direct;
  const fallback = new Date(`${raw} UTC`).getTime();
  return Number.isFinite(fallback) ? fallback : NaN;
}

function toIsoDateOrNull(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return new Date(ts).toISOString();
  return null;
}

function rosterNameSet(): Set<string> {
  const set = new Set<string>();
  for (const f of allFighters) {
    const n = normalizeName(f.name);
    if (n) set.add(n.toLowerCase());
  }
  return set;
}

async function archivePerformanceForRosterFighter(name: string, ufcData: UFCStatsData | null): Promise<void> {
  if (!ufcData?.fightHistory?.length) return;

  const fighterNorm = normalizeName(name);
  if (!fighterNorm) return;

  const roster = rosterNameSet();
  if (!roster.has(fighterNorm.toLowerCase())) return;

  const records: PropArchiveRecord[] = [];

  for (const fight of ufcData.fightHistory) {
    const dateIso = toIsoDateOrNull(fight.date);
    if (!dateIso) continue;
    const eventName = String(fight.event || '').trim();
    if (!eventName) continue;

    const opponent = normalizeName(fight.opponent) || fight.opponent || 'Unknown Opponent';
    const won = fight.result === 'win';

    if (fight.sigStr != null || fight.totStr != null || fight.kd != null || fight.td != null || fight.ctrlSecs != null) {
      const fantasy = calcFPForPlatform('pick6', fight.sigStr, fight.totStr, fight.ctrlSecs, fight.timeSecs, fight.kd, fight.td, fight.rev, won, fight.method, fight.round);
      records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'Fantasy', result: fantasy });
      if (fight.sigStr != null) records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'SS', result: Number(fight.sigStr) });
      if (fight.td != null) records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'TD', result: Number(fight.td) });
      if (fight.ctrlSecs != null) records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'Control', result: Number(fight.ctrlSecs) });
      if (fight.timeSecs != null) records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'FightTime', result: Number(fight.timeSecs) });

      await PropArchiveService.updateResult(fighterNorm, eventName, 'Fantasy', fantasy, { date: dateIso, opponent });
      if (fight.sigStr != null) await PropArchiveService.updateResult(fighterNorm, eventName, 'SS', Number(fight.sigStr), { date: dateIso, opponent });
      if (fight.td != null) await PropArchiveService.updateResult(fighterNorm, eventName, 'TD', Number(fight.td), { date: dateIso, opponent });
      if (fight.ctrlSecs != null) await PropArchiveService.updateResult(fighterNorm, eventName, 'Control', Number(fight.ctrlSecs), { date: dateIso, opponent });
      if (fight.timeSecs != null) await PropArchiveService.updateResult(fighterNorm, eventName, 'FightTime', Number(fight.timeSecs), { date: dateIso, opponent });
    }

    const oppStats = fight.oppStats;
    const oppName = normalizeName(oppStats?.oppName || opponent) || String(oppStats?.oppName || opponent || 'Unknown Opponent');
    if (oppStats && (oppStats.sigStr != null || oppStats.td != null || oppStats.kd != null || oppStats.ctrlSecs != null)) {
      const oppWon = fight.result === 'loss';
      const oppFantasy = calcFPForPlatform('pick6', oppStats.sigStr, oppStats.totStr, oppStats.ctrlSecs, fight.timeSecs, oppStats.kd, oppStats.td, null, oppWon, fight.method, fight.round);
      records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'Fantasy', result: oppFantasy });
      if (oppStats.sigStr != null) records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'SS', result: Number(oppStats.sigStr) });
      if (oppStats.td != null) records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'TD', result: Number(oppStats.td) });
      if (oppStats.ctrlSecs != null) records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'Control', result: Number(oppStats.ctrlSecs) });
      if (fight.timeSecs != null) records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'FightTime', result: Number(fight.timeSecs) });

      await PropArchiveService.updateResult(oppName, eventName, 'Fantasy', oppFantasy, { date: dateIso, opponent: fighterNorm });
      if (oppStats.sigStr != null) await PropArchiveService.updateResult(oppName, eventName, 'SS', Number(oppStats.sigStr), { date: dateIso, opponent: fighterNorm });
      if (oppStats.td != null) await PropArchiveService.updateResult(oppName, eventName, 'TD', Number(oppStats.td), { date: dateIso, opponent: fighterNorm });
      if (oppStats.ctrlSecs != null) await PropArchiveService.updateResult(oppName, eventName, 'Control', Number(oppStats.ctrlSecs), { date: dateIso, opponent: fighterNorm });
      if (fight.timeSecs != null) await PropArchiveService.updateResult(oppName, eventName, 'FightTime', Number(fight.timeSecs), { date: dateIso, opponent: fighterNorm });
    }
  }

  if (!records.length) return;
  await PropArchiveService.addProps(records);
}

async function runArchiveBackfillPass(): Promise<void> {
  try {
    const summary = await PropArchiveService.backfillUnresolvedFromKnownOutcomes({
      eventIncludes: 'ufc',
      maxScore: 12,
      minHoursBetweenRuns: 6,
    });
    if (summary.changed > 0) {
      debugLog(`[Archive Backfill] settled ${summary.changed} rows (${summary.unresolvedBefore} -> ${summary.unresolvedAfter})`);
    }
  } catch (e) {
    debugLog(`[Archive Backfill] failed: ${(e as Error).message}`);
  }
}

// ── LINE WATCHER SERVICE ──────────────────────────────────────────────────

interface WatcherStatusElements {
  statusEl: HTMLElement | null;
  pollBadge: HTMLElement | null;
  lastBadge: HTMLElement | null;
}

function getWatcherStatusElements(): WatcherStatusElements {
  return {
    statusEl: document.getElementById('watcherStatus'),
    // Removed pollBadge and lastBadge UI
    pollBadge: null,
    lastBadge: null,
  };
}

type WatcherVisualState = 'idle'|'watching'|'detected'|'error';

interface WatcherSnapshotPoint {
  fighter: string;
  platform: WatchPlatform;
  stat: WatchedStatType;
  value: number;
}

function setWatcherVisualState(state: WatcherVisualState, text?: string): void {
  const btn = document.getElementById('watcherToggleBtn');
  const txt = document.getElementById('watcherToggleText');
  if (!btn) return;
  btn.classList.remove('state-idle', 'state-watching', 'state-detected', 'state-error');
  btn.classList.add(`state-${state}`);
  if (txt) {
    txt.textContent = text || (state === 'watching' ? 'Watching' : state === 'detected' ? 'Line Alert' : state === 'error' ? 'Watch Error' : 'Watch Lines');
  }
}

function renderLineMoveFeed(): void {
  const list = document.getElementById('lineMoveList');
  if (!list) return;
  if (!recentLineMoves.length) {
    list.innerHTML = '<div class="line-move-item"><div class="meta">No movement events yet</div><div class="delta">--</div><div></div></div>';
    return;
  }
  list.innerHTML = recentLineMoves.slice(0, 12).map((e) => {
    const tm = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const deltaAbs = Math.abs(e.delta).toFixed(1);
    const deltaClass = e.direction === 'drop' ? 'drop' : 'rise';
    const spike = e.valueSpike ? '<span class="value-spike">VALUE SPIKE</span>' : '';
    const flags = [e.steam ? 'steam' : '', e.stealth ? 'stealth' : ''].filter(Boolean).join(' + ');
    return `<div class="line-move-item"><div class="meta">${e.fighter} · ${e.platform.toUpperCase()} ${e.stat.toUpperCase()} · ${tm}${flags ? ` · ${flags}` : ''}</div><div class="delta ${deltaClass}">${e.direction === 'drop' ? '-' : '+'}${deltaAbs}</div><div>${spike}</div></div>`;
  }).join('');
}

class LineDropService {
  private settings: LineWatchSettings = {
    enabled: false,
    direction: 'drop',
    threshold: 1.5,
    watchPlatforms: ['pick6', 'underdog', 'betr'],
    watchStats: ['fp', 'ss', 'td'],
    fighterAllowList: [],
    detectStealth: true,
    detectSteam: true,
    playSound: false,
  };
  private snapshot = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentPollMinutes: number | null = null;
  private isPaused = false;
  private lastPollAt: number | null = null;
  private stealthAccumulator = new Map<string, { cumulative: number; lastTs: number }>();
  private readonly settingsKey = 'analyzer_line_watch_settings';

  async init(): Promise<void> {
    await this.loadSettings();
    this.bindVisibilityHandlers();
    this.bindSettingsUI();
    this.updateStatusUI();
    renderLineMoveFeed();
    if (this.settings.enabled) await this.start();
  }

  async toggle(): Promise<void> {
    if (this.settings.enabled) await this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    this.settings.enabled = true;
    await this.saveSettings();
    setWatcherVisualState('watching');
    await this.pollNow(true);
    this.scheduleTimer();
    this.updateStatusUI();
    showToast('Line watch enabled');
  }

  async stop(): Promise<void> {
    this.settings.enabled = false;
    await this.saveSettings();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    setWatcherVisualState('idle');
    this.updateStatusUI();
    showToast('Line watch stopped');
  }

  async manualPoll(): Promise<void> {
    await this.pollNow(false);
  }

  getLatestSpikeForFighter(fighter: string): LineMovementEvent | null {
    return latestValueSpikeByFighter[fighter] || null;
  }

  private async loadSettings(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const data = await storageGet<Record<string, Partial<LineWatchSettings> | undefined>>([this.settingsKey]);
    const saved = data?.[this.settingsKey] as Partial<LineWatchSettings> | undefined;
    if (saved) this.settings = { ...this.settings, ...saved };
    this.syncSettingsToUI();
  }

  private async saveSettings(): Promise<void> {
    await storageSet({ [this.settingsKey]: this.settings });
  }

  private bindVisibilityHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      this.isPaused = document.hidden;
      if (this.isPaused) this.updateStatusUI('Paused (tab hidden)');
      else {
        this.updateStatusUI();
        if (this.settings.enabled) this.pollNow(false).catch(() => null);
      }
    });
  }

  private bindSettingsUI(): void {
    document.getElementById('watcherSettingsBtn')?.addEventListener('click', () => {
      const panel = document.getElementById('watcherSettingsPanel');
      if (!panel) return;
      panel.classList.toggle('is-hidden');
    });
    document.getElementById('watcherApplyBtn')?.addEventListener('click', async () => {
      this.readSettingsFromUI();
      await this.saveSettings();
      this.scheduleTimer();
      this.updateStatusUI();
      showToast('Watch settings updated');
    });
    document.getElementById('watcherManualPollBtn')?.addEventListener('click', () => this.manualPoll());
  }

  private syncSettingsToUI(): void {
    const setChecked = (id: string, value: boolean): void => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.checked = value;
    };
    const setVal = (id: string, value: string): void => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    setVal('watchDirection', this.settings.direction);
    setVal('watchThreshold', String(this.settings.threshold));
    setVal('watchFighterFilter', this.settings.fighterAllowList.join(', '));
    setChecked('watchP6', this.settings.watchPlatforms.includes('pick6'));
    setChecked('watchUD', this.settings.watchPlatforms.includes('underdog'));
    setChecked('watchBetr', this.settings.watchPlatforms.includes('betr'));
    setChecked('watchPP', this.settings.watchPlatforms.includes('prizepicks'));
    setChecked('watchFP', this.settings.watchStats.includes('fp'));
    setChecked('watchSS', this.settings.watchStats.includes('ss'));
    setChecked('watchTD', this.settings.watchStats.includes('td'));
    setChecked('watchStealth', this.settings.detectStealth);
    setChecked('watchSteam', this.settings.detectSteam);
    setChecked('watchSound', this.settings.playSound);
  }

  private readSettingsFromUI(): void {
    const q = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    const direction = (q('watchDirection')?.value || 'drop') as LineWatchSettings['direction'];
    const threshold = parseFloat(q('watchThreshold')?.value || '1.5');
    const fighterList = (q('watchFighterFilter')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const watchPlatforms: WatchPlatform[] = [
      (q('watchP6') as HTMLInputElement | null)?.checked ? 'pick6' : null,
      (q('watchUD') as HTMLInputElement | null)?.checked ? 'underdog' : null,
      (q('watchBetr') as HTMLInputElement | null)?.checked ? 'betr' : null,
      (q('watchPP') as HTMLInputElement | null)?.checked ? 'prizepicks' : null,
    ].filter((v): v is WatchPlatform => v != null);
    const watchStats: WatchedStatType[] = [
      (q('watchFP') as HTMLInputElement | null)?.checked ? 'fp' : null,
      (q('watchSS') as HTMLInputElement | null)?.checked ? 'ss' : null,
      (q('watchTD') as HTMLInputElement | null)?.checked ? 'td' : null,
    ].filter((v): v is WatchedStatType => v != null);
    this.settings = {
      ...this.settings,
      direction,
      threshold: Number.isFinite(threshold) ? Math.max(0.1, threshold) : 1.5,
      fighterAllowList: fighterList,
      watchPlatforms: watchPlatforms.length ? watchPlatforms : ['pick6', 'underdog', 'betr'],
      watchStats: watchStats.length ? watchStats : ['fp', 'ss', 'td'],
      detectStealth: !!(q('watchStealth') as HTMLInputElement | null)?.checked,
      detectSteam: !!(q('watchSteam') as HTMLInputElement | null)?.checked,
      playSound: !!(q('watchSound') as HTMLInputElement | null)?.checked,
    };
  }

  private scheduleTimer(): void {
    if (this.timer) clearInterval(this.timer);
    if (!this.settings.enabled) return;
    const mins = this.smartPollMinutes();
    this.currentPollMinutes = mins;
    this.timer = setInterval(() => {
      if (!this.settings.enabled || this.isPaused) return;
      this.pollNow(false).catch(() => null);
    }, mins * 60000);
  }

  private refreshTimerIfNeeded(): void {
    if (!this.settings.enabled) return;
    const nextMins = this.smartPollMinutes();
    if (this.currentPollMinutes === nextMins) return;
    this.scheduleTimer();
    this.updateStatusUI();
  }

  private smartPollMinutes(): number {
    const eventDateText = document.getElementById('eventDate')?.textContent || '';
    const eventMs = parseEventDateMs(eventDateText);
    const days = Number.isFinite(eventMs) ? ((eventMs - Date.now()) / 86400000) : 5;
    if (days <= 0.5) return 3;
    if (days <= 1.5) return 5;
    if (days <= 3) return 10;
    if (days <= 5) return 20;
    return 35;
  }

  private async getSnapshotPoints(): Promise<WatcherSnapshotPoint[]> {
    if (typeof chrome === 'undefined' || !chrome.storage) return [];
    const storage = await storageGet<Record<string, PlatformLinesPayload | null>>([...STORAGE_LINE_KEYS]);
    const platformMap: Array<{ platform: WatchPlatform; key: string }> = [
      { platform: 'pick6', key: 'lines_pick6' },
      { platform: 'underdog', key: 'lines_underdog' },
      { platform: 'betr', key: 'lines_betr' },
      { platform: 'prizepicks', key: 'lines_prizepicks' },
    ];
    const points: WatcherSnapshotPoint[] = [];
    platformMap.forEach(({ platform, key }) => {
      if (!this.settings.watchPlatforms.includes(platform)) return;
      const fighters = storage?.[key]?.fighters || [];
      fighters.forEach((f) => {
        const name = String(f.name || '').trim();
        if (!name) return;
        if (this.settings.fighterAllowList.length && !this.settings.fighterAllowList.some(n => name.toLowerCase().includes(n.toLowerCase()))) return;
        const pushPoint = (stat: WatchedStatType, value: unknown): void => {
          if (!this.settings.watchStats.includes(stat)) return;
          if (value == null || value === '') return;
          const num = Number(value);
          if (!Number.isFinite(num)) return;
          points.push({ fighter: name, platform, stat, value: num });
        };
        pushPoint('fp', f.line_fp ?? f.line);
        pushPoint('ss', f.line_ss);
        pushPoint('td', f.line_td);
      });
    });
    return points;
  }

  private shouldDirectionInclude(direction: 'drop'|'rise'): boolean {
    if (this.settings.direction === 'both') return true;
    return this.settings.direction === direction;
  }

  private detectEvents(points: WatcherSnapshotPoint[]): LineMovementEvent[] {
    const now = Date.now();
    const events: LineMovementEvent[] = [];

    points.forEach((p) => {
      const key = `${p.fighter}|${p.platform}|${p.stat}`;
      const prev = this.snapshot.get(key);
      this.snapshot.set(key, p.value);
      if (prev == null || prev === p.value) return;

      const delta = p.value - prev;
      const direction: 'drop'|'rise' = delta < 0 ? 'drop' : 'rise';
      if (!this.shouldDirectionInclude(direction)) return;

      const absDelta = Math.abs(delta);
      let stealth = false;
      if (absDelta < this.settings.threshold && this.settings.detectStealth) {
        const accum = this.stealthAccumulator.get(key) || { cumulative: 0, lastTs: now };
        const decay = (now - accum.lastTs) > 30 * 60000;
        const cumulative = (decay ? 0 : accum.cumulative) + absDelta;
        this.stealthAccumulator.set(key, { cumulative, lastTs: now });
        if (cumulative >= this.settings.threshold) stealth = true;
      }

      if (absDelta < this.settings.threshold && !stealth) return;

      const recentSame = recentLineMoves.filter(e => e.fighter === p.fighter && e.platform === p.platform && e.stat === p.stat && (now - e.timestamp) <= 20 * 60000);
      const steamMagnitude = recentSame.reduce((s, e) => s + Math.abs(e.delta), 0) + absDelta;
      const steam = this.settings.detectSteam && steamMagnitude >= (this.settings.threshold * 2.2) && recentSame.length >= 1;

      const spike = this.isValueSpike(p.fighter, direction, absDelta);

      events.push({
        id: `${key}|${now}`,
        timestamp: now,
        fighter: p.fighter,
        platform: p.platform,
        stat: p.stat,
        from: prev,
        to: p.value,
        delta,
        direction,
        stealth,
        steam,
        valueSpike: spike,
        notes: spike ? 'Value opportunity emerged after line move' : undefined,
      });
    });

    return events;
  }

  private isValueSpike(fighter: string, direction: 'drop'|'rise', absDelta: number): boolean {
    if (absDelta < Math.max(0.8, this.settings.threshold * 0.75)) return false;
    const f = allFighters.find(x => x.name.toLowerCase() === fighter.toLowerCase());
    if (!f) return false;
    const lean = getEffectiveLean(f);
    if (lean.conf < 62 || lean.lean === 'none' || lean.lean === 'push') return false;
    if (direction === 'drop' && lean.lean === 'over') return true;
    if (direction === 'rise' && lean.lean === 'under') return true;
    return false;
  }

  private emitAlert(events: LineMovementEvent[]): void {
    recentLineMoves = [...events, ...recentLineMoves].slice(0, 120);
    events.filter(e => e.valueSpike).forEach(e => { latestValueSpikeByFighter[e.fighter] = e; });
    renderLineMoveFeed();
    renderFighters();
    const first = events[0];
    setWatcherVisualState('detected', 'Line Alert');
    showLineDropAlert({
      event: document.getElementById('eventName')?.textContent || 'UFC card',
      drops: events.map(e => ({ platform: e.platform.toUpperCase(), type: e.stat.toUpperCase(), count: 1 })),
      udCount: events.length,
      p6Count: 0,
    });
    if (this.settings.playSound) this.playAlertSound();
    const spikeCount = events.filter(e => e.valueSpike).length;
    showToast(`Line move: ${first.fighter} ${first.stat.toUpperCase()} ${first.direction === 'drop' ? 'dropped' : 'rose'} ${Math.abs(first.delta).toFixed(1)}${spikeCount ? ` · ${spikeCount} value spike${spikeCount > 1 ? 's' : ''}` : ''}`);
  }

  private playAlertSound(): void {
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ac = new AudioContextCtor();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 660;
      gain.gain.value = 0.03;
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.12);
    } catch {
      // ignore audio failures
    }
  }

  private updateStatusUI(override?: string): void {
    const { statusEl, pollBadge, lastBadge } = getWatcherStatusElements();
    if (!statusEl || !pollBadge || !lastBadge) return;
    if (!this.settings.enabled) {
      statusEl.textContent = 'Idle · set filters, threshold, and direction then start watch';
      pollBadge.textContent = 'Poll: off';
      lastBadge.textContent = 'Last: --';
      setWatcherVisualState('idle', 'Watch Lines');
      return;
    }
    const poll = this.smartPollMinutes();
    const last = this.lastPollAt ? new Date(this.lastPollAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
    const mode = this.settings.direction === 'both' ? 'drops + rises' : `${this.settings.direction}s only`;
    const watching = override || `Watching ${this.settings.watchPlatforms.map(p => p.toUpperCase()).join('/')} · ${this.settings.watchStats.map(s => s.toUpperCase()).join('/')} · ${mode} ≥ ${this.settings.threshold}`;
    statusEl.textContent = watching;
    pollBadge.textContent = `Poll: ${poll}m`;
    lastBadge.textContent = `Last: ${last}`;
    if (!document.getElementById('watcherToggleBtn')?.classList.contains('state-detected')) {
      setWatcherVisualState('watching', 'Watching');
    }
  }

  async pollNow(initial = false): Promise<void> {
    if (!this.settings.enabled || this.isPaused) return;
    try {
      const points = await this.getSnapshotPoints();
      const events = this.detectEvents(points);
      this.lastPollAt = Date.now();
      this.refreshTimerIfNeeded();
      this.updateStatusUI();
      if (events.length) this.emitAlert(events);
      else if (!initial) setWatcherVisualState('watching', 'Watching');
      if (!initial && typeof chrome !== 'undefined' && chrome.runtime) {
        void runtimeSendMessage({ type: 'MANUAL_POLL_NOW' });
      }
    } catch (e) {
      console.error('[LineDropService] Poll error', e);
      setWatcherVisualState('error', 'Watch Error');
      this.updateStatusUI('Error polling lines — retrying on next cycle');
    }
  }
}

const lineDropService = new LineDropService();

function toggleWatcher(): void {
  lineDropService.toggle().catch((e) => {
    console.error('[LineDropService] toggle failed', e);
    setWatcherVisualState('error', 'Watch Error');
  });
}

// ── AUTO-SCRAPE ────────────────────────────────────────────────────────────
async function triggerAutoScrape(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    showToast('Extension not available — running in demo mode'); return;
  }
  const btn  = document.getElementById('autoScrapeBtn') as HTMLButtonElement|null;
  const icon = document.getElementById('autoScrapeIcon');
  setButtonBusyState(btn, true);
  setIconSpinnerState(icon, true);
  showToast('⚡ Fast auto-fetch: Underdog API first, tabs only if needed...');
  type AutoScrapeResponse = { status?: 'done' | 'already_running' | string; results?: Record<string, number> };
  let result: AutoScrapeResponse | null = null;
  try {
    result = await runtimeSendMessage<AutoScrapeResponse>({ type: 'AUTO_SCRAPE_LINES' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected auto-scrape error';
    showToast(`Auto-scrape failed: ${message}`);
    return;
  } finally {
    setIconSpinnerState(icon, false);
    setButtonBusyState(btn, false);
  }
  if (result?.status === 'done') {
    const totals = Object.values(result.results || {}).reduce((s: number, n) => s + n, 0);
    showToast(`✓ Fetched lines from ${Object.keys(result.results || {}).length} platforms — ${totals} fighters loaded`);
    requestDataReload();
  } else if (result?.status === 'already_running') {
    showToast('Auto-scrape already in progress...');
  } else {
    showToast('Auto-scrape complete — click Refresh to load');
    requestDataReload();
  }
}

// ── EVENT BANNER ──────────────────────────────────────────────────────────
function formatCountdown(eventDate: string): string {
  const now = Date.now();
  const target = parseEventDateMs(eventDate);
  if (!Number.isFinite(target)) return 'Date unavailable';
  const diff = target - now;
  if (diff <= 0) return 'LIVE NOW 🔴';
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000)  / 60000);
  if (days > 0)  return `${days}d ${hours}h until event`;
  if (hours > 0) return `${hours}h ${mins}m until event`;
  return `${mins}m until event`;
}

async function loadEventBanner(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  const banner = document.getElementById('eventBanner');
  const nameEl = document.getElementById('eventName');
  const dateEl = document.getElementById('eventDate');
  const cntEl  = document.getElementById('eventCountdown');
  if (banner) banner.style.display = 'flex';
  if (nameEl) nameEl.textContent = 'Detecting next UFC event...';

  const card = await syncUpcomingCardContext(true);
  if (!card) {
    upcomingCardPairs = [];
    upcomingEventName = '';
    if (banner) banner.style.display = 'none';
    debugLog('Upcoming card ignored: stale/invalid date in runtime+cache');
    return;
  }
  debugLog(`Upcoming card pairs loaded: ${upcomingCardPairs.length}`);

  const cardDate = card.date || '';

  if (nameEl) nameEl.textContent = card.event || 'Upcoming UFC Event';
  if (dateEl) dateEl.textContent = cardDate;
  if (cntEl) cntEl.textContent = formatCountdown(cardDate);

  if (eventCountdownTimer) clearInterval(eventCountdownTimer);
  eventCountdownTimer = setInterval(() => {
    if (cntEl) cntEl.textContent = formatCountdown(cardDate);
  }, 60000);

  if (card.fighters?.length && allFighters.length === 0) {
    debugLog(`Detected card: ${card.event} — ${card.fighters.length} fights`);
    const detected: AnalyzerFighter[] = [];
    card.fighters.forEach(({ f1, f2 }) => {
      detected.push(createPlaceholderAnalyzerFighter(f1, f2));
      detected.push(createPlaceholderAnalyzerFighter(f2, f1));
    });

    const result = await storageGet<Record<string, PlatformLinesPayload | null>>([...STORAGE_LINE_KEYS]);
    const hasRealData =
      (result['lines_pick6']?.fighters?.length || 0) +
      (result['lines_underdog']?.fighters?.length || 0) +
      (result['lines_prizepicks']?.fighters?.length || 0) +
      (result['lines_draftkings_sportsbook']?.fighters?.length || 0) +
      (result['lines_betr']?.fighters?.length || 0) > 0;
    if (!hasRealData) {
      showToast(`📅 Detected ${card.event} — ${card.fighters.length} fights found. Click ⚡ AUTO-FETCH LINES to get odds.`);
      allFighters = detected;
      renderFighters();
    }
  }
}

// ── BOOT ──────────────────────────────────────────────────────────────────
function setActivePlatform(platform: string): void {
  currentPlatform = platform;
  document.querySelectorAll('[data-platform]').forEach(b => b.classList.remove('platform-selected'));
  const target = document.querySelector(`[data-platform="${platform}"]`);
  if (target) target.classList.add('platform-selected');
  const nameEl = document.getElementById('platformActiveName');
  if (nameEl) nameEl.textContent = platform === 'pick6' ? 'Pick6' : platform === 'underdog' ? 'Underdog' : platform === 'prizepicks' ? 'PrizePicks' : platform === 'draftkings_sportsbook' ? 'DK Sportsbook' : 'Betr';
  renderFighters();
}

function bindSourceToggles(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.source-toggle[data-source]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = (btn.dataset.source || '') as 'p6'|'ud'|'pp'|'betr'|'dk';
      if (!(key in sourceVisibility)) return;

      sourceVisibility[key] = !sourceVisibility[key];
      if (!Object.values(sourceVisibility).some(Boolean)) {
        sourceVisibility[key] = true;
      }

      updateSourceToggleUI();
      renderFighters();
    });
  });
  updateSourceToggleUI();
}

function applyDensityMode(): void {
  const compact = currentDensity === 'compact';
  document.body.classList.toggle('compact-view', compact);
  const btn = document.getElementById('densityToggleBtn');
  if (btn) {
    btn.textContent = compact ? 'Detailed View' : 'Compact View';
    btn.classList.toggle('active', compact);
  }
}

function applyHistoryDensityMode(): void {
  const readable = currentHistoryDensity === 'readable';
  document.body.classList.toggle('readable-history', readable);
  const btn = document.getElementById('historyDensityToggleBtn');
  if (btn) {
    btn.textContent = readable ? 'History: Readable' : 'History: Compact';
    btn.classList.toggle('active', readable);
  }
}

function exportToCSV(): void {
  const fighters = allFighters.filter(f => getEffectiveLean(f).lean !== 'none');
  if (!fighters.length) {
    showToast('No leans to export');
    return;
  }
  const csv = [
    'Name,Opponent,Platform,Line,Lean,Confidence,BayesProb,CalibratedProb,ModelAgreement,KellyBetSize,EV,Verdict',
    ...fighters.map(f => {
      const el = getEffectiveLean(f);
      const line = activePlatformLine(f);
      const platform = activePlatformLabel(f);
      const bayesProb = el.bayesianProbability != null ? (el.bayesianProbability * 100).toFixed(1) : '';
      const calibratedProb = el.calibratedProbability != null ? (el.calibratedProbability * 100).toFixed(1) : '';
      const modelAgreement = el.ensembleAgreement != null ? (el.ensembleAgreement * 100).toFixed(1) : '';
      const kellyBetSize = el.kellyBetSize != null ? el.kellyBetSize.toFixed(2) : '';
      return `"${f.name}","${f.opponent || ''}","${platform}","${line || ''}","${el.lean}","${el.conf}","${bayesProb}","${calibratedProb}","${modelAgreement}","${kellyBetSize}","${el.ev || ''}","${el.verdict}"`;
    })
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ufc-leans-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported leans to CSV');
}

function runWalkForwardDiagnostics(): void {
  const engine = new BacktestingEngine();
  const eventsByDate = new Map<number, WalkForwardEvent>();
  let createdPredictions = 0;

  allFighters.forEach(f => {
    const line = activePlatformLine(f) ?? f.db?.avgFP ?? null;
    const history = (f.db?.history || []).filter(h => h.fp != null) as FightResult[];
    if (!line || history.length < 7) return;

    for (let i = 6; i < history.length; i++) {
      const train = history.slice(Math.max(0, i - 6), i);
      const trainFP = train.map(h => h.fp || 0);
      if (!trainFP.length) continue;

      const mean = trainFP.reduce((s, v) => s + v, 0) / trainFP.length;
      const variance = trainFP.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / trainFP.length;
      const std = Math.max(8, Math.sqrt(variance));
      const overProb = 1 / (1 + Math.exp(-((mean - line) / std)));
      const lean = overProb > 0.52 ? 'over' : overProb < 0.48 ? 'under' : 'push';
      if (lean === 'push') continue;

      const confidence = Math.min(0.95, Math.abs(overProb - 0.5) * 2 + 0.45);
      const expectedValue = lean === 'over' ? overProb : 1 - overProb;

      const ts = history[i].date ? new Date(history[i].date as string).getTime() : (Date.now() - (history.length - i) * 86400000);
      const eventTs = Number.isFinite(ts) ? ts : Date.now();

      if (!eventsByDate.has(eventTs)) {
        eventsByDate.set(eventTs, {
          timestamp: eventTs,
          predictions: [],
          actualResults: []
        });
      }

      const evt = eventsByDate.get(eventTs)!;
      evt.predictions.push({
        fighter: f.name,
        line,
        prediction: {
          lean,
          confidence,
          edge: Math.abs(overProb - 0.5) * 2,
          expectedValue
        }
      });
      evt.actualResults.push({
        fighter: f.name,
        actualFP: history[i].fp || 0
      });
      createdPredictions++;
    }
  });

  const events = Array.from(eventsByDate.values())
    .filter(e => e.predictions.length > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (events.length < 7) {
    showToast('Walk-forward needs more history (min 7 event buckets)');
    debugLog(`Walk-forward skipped: only ${events.length} event buckets`);
    return;
  }

  const result = engine.runWalkForwardValidation(events, 6);
  if (!result.folds.length) {
    showToast('Walk-forward produced no valid folds');
    debugLog('Walk-forward produced no folds after filtering');
    return;
  }

  const avgCal = result.folds.reduce((sum, f) => sum + f.calibrationScore, 0) / result.folds.length;
  const msg = `WF OK: acc ${(result.overallAccuracy * 100).toFixed(1)}% · brier ${result.overallBrierScore.toFixed(3)} · cal ${avgCal.toFixed(3)}`;
  showToast(msg);
  debugLog(`Walk-forward diagnostics: events=${events.length}, preds=${createdPredictions}, folds=${result.folds.length}`);
  result.folds.slice(0, 8).forEach((f, idx) => {
    debugLog(`WF fold ${idx + 1}: train=${f.trainSize}, test=${f.testSize}, acc=${(f.accuracy * 100).toFixed(1)}%, brier=${f.brierScore.toFixed(3)}, cal=${f.calibrationScore.toFixed(3)}`);
  });
}

function setExclusiveActive(selector: string, activeEl: Element): void {
  document.querySelectorAll(selector).forEach((el) => el.classList.remove('active'));
  activeEl.classList.add('active');
}

function bindExclusiveButtons(selector: string, onActivate: (el: HTMLElement) => void): void {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('click', () => {
      setExclusiveActive(selector, el);
      onActivate(el as HTMLElement);
    });
  });
}

// ── UI INIT ───────────────────────────────────────────────────────────────
function initAnalyzerCore(): void {
  // Platform switcher
  document.querySelectorAll('[data-platform]').forEach(btn => {
    btn.addEventListener('click', () => setActivePlatform((btn as HTMLElement).dataset['platform'] || 'pick6'));
  });
  setActivePlatform('pick6');
  bindSourceToggles();

  // Top-bar buttons
  document.getElementById('refreshBtn')?.addEventListener('click', loadData);
  document.getElementById('autoScrapeBtn')?.addEventListener('click', triggerAutoScrape);
  document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('densityToggleBtn')?.addEventListener('click', () => {
    currentDensity = currentDensity === 'compact' ? 'detailed' : 'compact';
    applyDensityMode();
  });
  document.getElementById('historyDensityToggleBtn')?.addEventListener('click', () => {
    currentHistoryDensity = currentHistoryDensity === 'compact' ? 'readable' : 'compact';
    applyHistoryDensityMode();
  });
  applyDensityMode();
  applyHistoryDensityMode();

  // Line drop / empty-state buttons
  document.getElementById('emptyStateAutoFetchBtn')?.addEventListener('click', triggerAutoScrape);

  // Watcher and event banner removed by request; ensure any prior background watcher is stopped.
  void runtimeSendMessage({ type: 'STOP_LINE_WATCHER' });

  // View tabs
  bindExclusiveButtons('.tab-btn[data-view]', (btn) => {
    currentView = btn.dataset['view'] || 'all';
    renderFighters();
  });

  // Debug panel toggle
  document.getElementById('debugToggleBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('debugPanelWrap');
    if (!wrap) return;
    const visible = !wrap.classList.contains('debug-panel-hidden');
    wrap.classList.toggle('debug-panel-hidden', visible);
    const tb = document.getElementById('debugToggleBtn');
    if (tb) tb.textContent = visible ? '⚡ DEBUG' : '✕ DEBUG';
  });

  // Card row expand/collapse
  document.getElementById('cardContainer')?.addEventListener('click', (e) => {
    const h2hBtn = (e.target as HTMLElement).closest('.h2h-btn');
    if (h2hBtn) {
      e.stopPropagation();
      const fighterName = (h2hBtn as HTMLElement).dataset['fighter'] || '';
      const fEntry = _h2hFighterMap.get(fighterName.toLowerCase());
      if (!fEntry) return;
      const oppName = (fEntry.opponent || '').toLowerCase();
      let oppEntry = _h2hFighterMap.get(oppName);
      if (!oppEntry) {
        for (const [key, val] of _h2hFighterMap) {
          if (key.includes(oppName) || oppName.includes(key)) { oppEntry = val; break; }
        }
      }
      if (oppEntry) renderH2HModal(fEntry, oppEntry);
      return;
    }
    const main = (e.target as HTMLElement).closest('.fighter-main');
    if (main) toggleRow((main.closest('.fighter-row') as HTMLElement));
  });

  // H2H modal close
  const h2hModal = document.getElementById('h2hModal');
  document.getElementById('h2hModalClose')?.addEventListener('click', () => h2hModal?.classList.add('is-hidden'));
  h2hModal?.addEventListener('click', (e) => { if (e.target === h2hModal) h2hModal.classList.add('is-hidden'); });

  // Search
  document.getElementById('fighterSearch')?.addEventListener('input', (e) => {
    currentSearch = (e.target as HTMLInputElement).value || '';
    renderFighters();
  });

  // Sort
  bindExclusiveButtons('.sort-btn[data-sort]', (btn) => {
    currentSort = btn.dataset['sort'] || 'default';
    renderFighters();
  });

  // Initial data load
  requestDataReload();
  startPeriodicDataReload(60000);
  void runArchiveBackfillPass();

  // Fighter modal
  document.getElementById('modalClose')?.addEventListener('click', () => {
    document.getElementById('fighterModal')?.classList.remove('open');
  });
  document.getElementById('fighterModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('fighterModal'))
      document.getElementById('fighterModal')?.classList.remove('open');
  });
  bindExclusiveButtons('.modal-tab', (tab) => {
    document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(tab.dataset['panel'] || '')?.classList.add('active');
  });
}

initAnalyzerCore();

// ── DEBUG PANEL BUTTONS ───────────────────────────────────────────────────
interface DebugCardSample {
  text?: string;
  aria?: string;
}

interface DebugCardEntry {
  samples?: DebugCardSample[];
  capturedAt?: number;
}

interface CachedHtmlFight {
  opponent?: string;
  kd?: number | null;
  sigStr?: number | null;
  totStr?: number | null;
  td?: number | null;
  ctrlSecs?: number | null;
  round?: number | null;
  method?: string;
}

interface CachedHtmlResponse {
  error?: string;
  html?: string;
  detailUrl?: string;
  fightHistory?: CachedHtmlFight[];
}

interface ClaudeApiResponse {
  error?: string;
  data?: {
    content?: Array<{ text?: string }>;
  };
}

interface OCRFighterRow {
  name?: string;
  fp?: number | null;
  ss?: number | null;
}

function getDebugPanelEl(): HTMLElement | null {
  return document.getElementById('debugPanel');
}

function setDebugPanelText(text: string): HTMLElement | null {
  const panel = getDebugPanelEl();
  if (!panel) return null;
  panel.textContent = text;
  return panel;
}

function appendDebugPanelText(panel: HTMLElement, text: string): void {
  panel.textContent += text;
}

function scrollDebugPanelToBottom(panel: HTMLElement): void {
  panel.scrollTop = panel.scrollHeight;
}

document.getElementById('dbgTestBtn')?.addEventListener('click', async () => {
  const panel = setDebugPanelText('Reading stored card debug + live lines data...\n');
  if (!panel) return;
  const all = await storageGet<Record<string, unknown>>([]);
  for (const platform of ['pick6', 'underdog']) {
    const key = `lines_${platform}`;
    const lineData = all[key] as PlatformLinesPayload | undefined;
    if (!lineData) { appendDebugPanelText(panel, `${platform}: no lines captured\n`); continue; }
    appendDebugPanelText(panel, `\n=== ${platform} captured fighters (${lineData.fighters?.length}) ===\n`);
    (lineData.fighters || []).slice(0, 5).forEach((f) => {
      appendDebugPanelText(panel, `  ${f.name}: fp=${f.line_fp ?? f.line} ss=${f.line_ss} td=${f.line_td} ft=${f.line_ft}\n`);
    });
  }
  for (const platform of STORAGE_LINE_DEBUG_KEYS) {
    const key = `debug_card_${platform}`;
    const debugEntry = all[key] as DebugCardEntry | undefined;
    if (!debugEntry) { appendDebugPanelText(panel, `\n${platform}: no card debug — visit the page\n`); continue; }
    appendDebugPanelText(panel, `\n=== ${platform} card text samples ===\n`);
    (debugEntry.samples || []).forEach((s, i: number) => { appendDebugPanelText(panel, `[${i}] ${s.text?.slice(0,800)}\n`); });
  }
  scrollDebugPanelToBottom(panel);
});

document.getElementById('dbgDumpBtn')?.addEventListener('click', async () => {
  const panel = setDebugPanelText('Trying UFC Stats URLs with browser headers...\n');
  if (!panel) return;
  const headers = { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5', 'Cache-Control': 'no-cache' };
  const urls = ['http://www.ufcstats.com/fighter-details/0bc62e3c498b5011', 'http://ufcstats.com/fighter-details/0bc62e3c498b5011'];
  for (const url of urls) {
    try {
      appendDebugPanelText(panel, `GET ${url}\n`);
      const res = await fetch(url, { headers, redirect: 'follow' as RequestRedirect, mode: 'cors' as RequestMode });
      const text = await res.text();
      appendDebugPanelText(panel, `Status: ${res.status} | Bytes: ${text.length} | Final URL: ${res.url}\n`);
      appendDebugPanelText(panel, `First 300 chars:\n${JSON.stringify(text.slice(0, 300))}\n\n`);
      if (text.length < 1000) continue;
      const trCount = (text.match(/<tr/gi)||[]).length;
      appendDebugPanelText(panel, `<tr> tags: ${trCount}\n`);
      ['b-fight-details__table-body','fighter-details','b-fight-details'].forEach(m => { appendDebugPanelText(panel, `  "${m}": ${text.includes(m)}\n`); });
      const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const dataRow = rows.find(r => r[1].includes('fighter-details') && r[1].includes('<td'));
      if (!dataRow) { appendDebugPanelText(panel, 'No data row with fighter-details link found\n'); continue; }
      const tds = [...dataRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      appendDebugPanelText(panel, `\nDATA ROW — ${tds.length} tds:\n`);
      tds.forEach((td, i) => {
        const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => p[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
        if (ps.length > 0) { appendDebugPanelText(panel, `  td[${i}]: "${ps[0]?.slice(0,45)}" | "${(ps[1]||'').slice(0,45)}"\n`); }
        else { appendDebugPanelText(panel, `  td[${i}]: "${td[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,60)}"\n`); }
      });
      appendDebugPanelText(panel, `\nRAW (first 1000 chars):\n${dataRow[1].slice(0,1000)}`);
      scrollDebugPanelToBottom(panel);
      return;
    } catch(e: unknown) { appendDebugPanelText(panel, `EXCEPTION: ${(e as Error).name}: ${(e as Error).message}\n\n`); }
  }
  appendDebugPanelText(panel, '\nAll URLs failed — UFC Stats may be blocking cross-origin requests.\n');
});

document.getElementById('dbgCopyBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('debugPanel');
  if (!panel) return;
  navigator.clipboard.writeText(panel.textContent || '').then(() => {
    const btn = document.getElementById('dbgCopyBtn');
    if (btn) { btn.textContent = '✓ COPIED'; setTimeout(() => { btn.textContent = 'COPY LOG'; }, 2000); }
  });
});

document.getElementById('dbgClearBtn')?.addEventListener('click', async () => {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const all = await storageGet<Record<string, unknown>>([]);
    const keys = Object.keys(all).filter(k => k.startsWith('ufcstats_'));
    keys.push('upcoming_ufc_card');
    await storageRemove(keys);
    const panel = document.getElementById('debugPanel');
    if (panel) panel.textContent = `Cleared ${keys.length} cached entries. Reloading...`;
    setTimeout(() => location.reload(), 800);
  }
});

document.getElementById('dbgBgDumpBtn')?.addEventListener('click', async () => {
  const panel = setDebugPanelText('Reading Max Holloway from cache (must be loaded in analyzer first)...\n');
  if (!panel) return;
  const resp = await runtimeSendMessage<CachedHtmlResponse>({ type: 'GET_CACHED_HTML', name: 'Max Holloway' });
  if (!resp || resp.error) {
    appendDebugPanelText(panel, `${resp?.error}\n`);
    appendDebugPanelText(panel, 'Scroll to Max Holloway in the analyzer to trigger a fetch, then try again.\n');
    return;
  }
  appendDebugPanelText(panel, `Cache hit! HTML: ${resp.html?.length} chars | URL: ${resp.detailUrl}\n`);
  appendDebugPanelText(panel, `\nParsed fights (${resp.fightHistory?.length}):\n`);
  (resp.fightHistory||[]).forEach((f, i: number) => {
    appendDebugPanelText(panel, `  [${i}] ${f.opponent} kd=${f.kd} sig=${f.sigStr} tot=${f.totStr} td=${f.td} ctrl=${f.ctrlSecs}s rnd=${f.round} method=${f.method}\n`);
  });
  appendDebugPanelText(panel, '\n--- RAW TD STRUCTURE ---\n');
  const rows = [...(resp.html||'').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter((r) => !r[1].includes('<th') && (r[1].match(/<td/gi)||[]).length > 5);
  appendDebugPanelText(panel, `Total rows: ${rows.length}, data rows: ${dataRows.length}\n`);
  if (dataRows.length > 0) {
    const row = dataRows[0][1];
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    tds.forEach((td, i: number) => {
      const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => p[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
      if (ps.length > 0) { appendDebugPanelText(panel, `td[${i}]: "${ps[0]?.slice(0,45)}" | "${(ps[1]||'').slice(0,45)}"\n`); }
    });
  }
  scrollDebugPanelToBottom(panel);
});

document.getElementById('dbgHideBtn')?.addEventListener('click', () => {
  const wrap = document.getElementById('debugPanelWrap');
  if (wrap) wrap.classList.add('debug-panel-hidden');
  const tb = document.getElementById('debugToggleBtn');
  if (tb) tb.textContent = '⚡ DEBUG';
});

// ── BETR SCREENSHOT READER ────────────────────────────────────────────────
(function() {
  const modal         = document.getElementById('manualModal');
  const openBtn       = document.getElementById('manualEntryBtn');
  const closeBtn      = document.getElementById('manualModalClose');
  const dropZone      = document.getElementById('betrDropZone');
  const fileInput     = document.getElementById('betrFileInput') as HTMLInputElement|null;
  const imageQueue    = document.getElementById('betrImageQueue');
  const analyzeBtn    = document.getElementById('betrAnalyzeBtn') as HTMLButtonElement|null;
  const analyzeStatus = document.getElementById('betrAnalyzeStatus');
  const extracted     = document.getElementById('betrExtracted');
  const extractedRows = document.getElementById('betrExtractedRows');
  const saveBtn       = document.getElementById('betrSaveBtn');
  const addRowBtn     = document.getElementById('betrAddRow');
  const saveStatus    = document.getElementById('betrSaveStatus');

  let queuedImages: { dataUrl: string; name: string }[] = [];

  closeBtn?.addEventListener('click', () => { if (modal) modal.classList.add('is-hidden'); });
  modal?.addEventListener('click', (e) => { if (e.target === modal && modal) modal.classList.add('is-hidden'); });

  function setDropZoneHighlight(active: boolean): void {
    if (!dropZone) return;
    if (active) {
      dropZone.style.borderColor = 'var(--orange)';
      dropZone.style.background = 'rgba(255,122,43,0.08)';
      return;
    }
    dropZone.style.borderColor = 'rgba(255,122,43,0.4)';
    dropZone.style.background = 'rgba(255,122,43,0.04)';
  }

  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); setDropZoneHighlight(true); });
  dropZone?.addEventListener('dragleave', () => { setDropZoneHighlight(false); });
  dropZone?.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    setDropZoneHighlight(false);
    if (e.dataTransfer) addFiles(Array.from(e.dataTransfer.files));
  });
  fileInput?.addEventListener('change', () => { if (fileInput.files) addFiles(Array.from(fileInput.files)); });

  function addFiles(files: File[]): void {
    files.filter(f => f.type.startsWith('image/')).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        queuedImages.push({ dataUrl, name: file.name });
        renderQueue();
      };
      reader.readAsDataURL(file);
    });
  }

  function renderQueue(): void {
    if (!imageQueue) return;
    imageQueue.innerHTML = '';
    queuedImages.forEach((img, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'betr-queue-item';
      wrap.innerHTML = `<img src="${img.dataUrl}" class="betr-queue-img"><button data-i="${i}" class="betr-queue-remove">✕</button><div class="betr-queue-name">${img.name}</div>`;
      (wrap.querySelector('button') as HTMLButtonElement).addEventListener('click', () => { queuedImages.splice(i, 1); renderQueue(); });
      imageQueue.appendChild(wrap);
    });
    if (analyzeBtn) {
      setButtonBusyState(analyzeBtn, queuedImages.length === 0, {
        busyOpacity: '0.4',
        idleOpacity: '1',
      });
    }
  }

  analyzeBtn?.addEventListener('click', async () => {
    if (!queuedImages.length) return;
    const apiKeyInput = document.getElementById('betrApiKey') as HTMLInputElement|null;
    const apiKey = apiKeyInput?.value?.trim();
    if (!apiKey) { if (analyzeStatus) analyzeStatus.textContent = '✗ Enter your Anthropic API key first'; return; }
    if (typeof chrome !== 'undefined' && chrome.storage) await storageSet({ betr_api_key: apiKey });
    setButtonBusyState(analyzeBtn, true, { busyText: '⟳ Reading...' });
    if (analyzeStatus) analyzeStatus.textContent = `Sending ${queuedImages.length} image(s) to AI...`;
    if (extracted) extracted.classList.add('is-hidden');
    try {
      const imageContent = queuedImages.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.dataUrl.split(';')[0].split(':')[1], data: img.dataUrl.split(',')[1] }
      }));
      const payload = {
        model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: `These are screenshots from the Betr fantasy sports app showing UFC fighter prop lines. Extract every fighter's lines.\nReturn ONLY a JSON array: [{"name":"First Last","fp":number_or_null,"ss":number_or_null}]` }] }]
      };
      const resp = await runtimeSendMessage<ClaudeApiResponse>({ type: 'CLAUDE_API', payload, apiKey });
      if (!resp) throw new Error('No response from analyzer runtime');
      if (resp?.error) throw new Error(resp.error);
      const data = resp.data;
      const text = data?.content?.map((c) => c.text || '').join('') || '';
      let fighters: OCRFighterRow[] = [];
      try { fighters = JSON.parse(text.replace(/```json|```/g, '').trim()) as OCRFighterRow[]; }
      catch(e) { throw new Error('Could not parse AI response: ' + text?.slice(0, 200)); }
      if (analyzeStatus) analyzeStatus.textContent = `✓ Found ${fighters.length} fighter(s)`;
      renderExtractedRows(fighters);
      if (extracted) extracted.classList.remove('is-hidden');
    } catch(err: unknown) {
      if (analyzeStatus) analyzeStatus.textContent = '✗ Error: ' + (err as Error).message;
    } finally {
      setButtonBusyState(analyzeBtn, false, { idleText: '🔍 READ WITH AI' });
    }
  });

  function renderExtractedRows(fighters: OCRFighterRow[]): void { if (extractedRows) { extractedRows.innerHTML = ''; fighters.forEach(f => addExtractedRow(f)); } }

  function addExtractedRow(f: OCRFighterRow = {}): void {
    if (!extractedRows) return;
    const row = document.createElement('div');
    row.className = 'betr-row';
    row.innerHTML = `<input type="text" class="betr-name betr-input name" value="${f.name || ''}" placeholder="Fighter name"><input type="number" class="betr-fp betr-input fp" value="${f.fp ?? ''}" placeholder="—" step="0.5"><input type="number" class="betr-ss betr-input ss" value="${f.ss ?? ''}" placeholder="—" step="0.5"><button class="betr-remove-btn">✕</button>`;
    (row.querySelector('button') as HTMLButtonElement).addEventListener('click', () => row.remove());
    extractedRows.appendChild(row);
  }

  addRowBtn?.addEventListener('click', () => addExtractedRow());

  openBtn?.addEventListener('click', async () => {
    if (modal) modal.classList.remove('is-hidden');
    // Pre-populate rows from currently stored BETR lines AND update event title
    if (extractedRows) {
      try {
        await syncUpcomingCardContext(true);
        const stored = await storageGet<{ lines_betr?: { fighters?: RawLineFighter[] } }>(['lines_betr']);

        // Do not fall back to UFCStats event text here; that feed can lag and show the wrong card.
        const eventName = (inferredEventNameFromLines || '').trim();
        const reviewTitle = modal?.querySelector('.betr-review-title') as HTMLElement | null;
        if (reviewTitle) {
          reviewTitle.textContent = eventName
            ? `${eventName} Lines \u2014 Review & Edit Before Saving`
            : 'Upcoming UFC Lines \u2014 Review & Edit Before Saving';
        }

        // Always refresh rows on modal open so stale event rows cannot linger between cards.
        extractedRows.innerHTML = '';
        const existing = stored['lines_betr']?.fighters || [];
        const filteredExisting = upcomingCardPairs.length
          ? existing.filter((f) => isUpcomingCardFighter(f.name) || isUpcomingCardFighter(f.opponent || ''))
          : existing;
        if (filteredExisting.length > 0) {
          renderExtractedRows(filteredExisting.map(f => ({ name: f.name || '', fp: f.line_fp ?? null, ss: f.line_ss ?? null })));
        } else {
          // No stored lines — pre-fill with the current card's known Betr lines so the user only needs to click Save.
          const BETR_PREFILL: OCRFighterRow[] = [
            { name: 'Alexia Thainara',    fp: 95.5,  ss: null  },
            { name: 'Navajo Stirling',    fp: 97.5,  ss: null  },
            { name: 'Chase Hooper',       fp: 85.5,  ss: null  },
            { name: 'Lance Gibson Jr.',   fp: 50.5,  ss: null  },
            { name: 'Ignacio Bahamondes', fp: 84.5,  ss: null  },
            { name: 'Tofiq Musayev',      fp: 50.5,  ss: null  },
            { name: 'Terrance McKinney',  fp: null,  ss: 20.5  },
            { name: 'Kyle Nelson',        fp: null,  ss: 15.5  },
            { name: 'Yousri Belgaroui',   fp: null,  ss: 48.5  },
            { name: 'Mansur Abdul-Malik', fp: null,  ss: 25.5  },
            { name: 'Lerryan Douglas',    fp: 95.5,  ss: 31.5  },
            { name: 'Julian Erosa',       fp: 50.5,  ss: 24.5  },
            { name: 'Michael Chiesa',     fp: 95.5,  ss: 20.5  },
            { name: 'Niko Price',         fp: null,  ss: 17.5  },
            { name: 'Maycee Barber',      fp: 75.5,  ss: 53.5  },
            { name: 'Alexa Grasso',       fp: null,  ss: 40.5  },
            { name: 'Israel Adesanya',    fp: null,  ss: 69.5  },
            { name: 'Joe Pyfer',          fp: null,  ss: 50.5  },
          ];
          renderExtractedRows(BETR_PREFILL);
        }
      } catch { /* no stored lines is fine */ }
    }
  });

  saveBtn?.addEventListener('click', async () => {
    if (!extractedRows) return;
    const rows = extractedRows.querySelectorAll('div');
    const fighters: RawLineFighter[] = [];
    rows.forEach(row => {
      const name = (row.querySelector('.betr-name') as HTMLInputElement)?.value?.trim();
      if (!name) return;
      const fp = parseFloat((row.querySelector('.betr-fp') as HTMLInputElement)?.value) || null;
      const ss = parseFloat((row.querySelector('.betr-ss') as HTMLInputElement)?.value) || null;
      if (fp || ss) fighters.push({ name, line_fp: fp, line_ss: ss, line_td: null });
    });
    if (!fighters.length) { if (saveStatus) saveStatus.textContent = '✗ No valid lines to save'; return; }
    const capturedAt = Date.now();
    const data = { fighters, capturedAt };
    if (typeof chrome !== 'undefined' && chrome.storage) {
      // Detect line movements before saving — compare against opening lines
      const movements: string[] = [];
      for (const fighter of fighters) {
        const fname = String(fighter.name || '').trim();
        if (!fname) continue;
        const checks: Array<[string, number | null]> = [
          ['fp', fighter.line_fp ?? null],
          ['ss', fighter.line_ss ?? null],
          ['td', fighter.line_td ?? null],
        ];
        for (const [stat, val] of checks) {
          if (val == null) continue;
          const key = openingLineKey('betr', stat, fname);
          const openVal = _openingLines.get(key);
          if (openVal != null && Math.abs(val - openVal) >= 0.5) {
            const delta = parseFloat((val - openVal).toFixed(1));
            movements.push(`${fname} ${stat.toUpperCase()} ${delta > 0 ? '▲+' : '▼'}${delta} (was ${openVal})`);
          }
        }
      }

      await storageSet({ lines_betr: data, [STORAGE_BETR_MANUAL_KEY]: data });

      if (movements.length) {
        const msg = `✓ Saved — Line moves: ${movements.join(' · ')}`;
        if (saveStatus) saveStatus.textContent = msg;
      } else {
        if (saveStatus) saveStatus.textContent = `✓ Saved ${fighters.length} Betr lines`;
      }
      const countBetr = document.getElementById('countBetr');
      if (countBetr) countBetr.textContent = fighters.length + ' fighters';
      document.getElementById('pillBetr')?.classList.add('active');
      setTimeout(() => { if (modal) modal.classList.add('is-hidden'); }, 800);
      const result = await storageGet<Record<string, PlatformLinesPayload | null>>([...STORAGE_BETR_LINE_KEYS]);
      const p6 = result['lines_pick6']?.fighters || [];
      const ud = result['lines_underdog']?.fighters || [];
      const bt = result['lines_betr']?.fighters || [];
      await mergeAndEnrich(p6, ud, bt);
      snapshotOpeningLines();
    }
  });
})();

// ── ADVANCED UI ENHANCEMENTS ──────────────────────────────────────────────

// Mouse tracking for interactive backgrounds
let mouseX = 50;
let mouseY = 50;
let dynamicEffectsInitialized = false;
let performanceMonitorStarted = false;

document.addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / window.innerWidth) * 100;
  mouseY = (e.clientY / window.innerHeight) * 100;
  document.documentElement.style.setProperty('--mouse-x', `${mouseX}%`);
  document.documentElement.style.setProperty('--mouse-y', `${mouseY}%`);
});

// Dynamic class toggling for enhanced effects
function addDynamicEffects(): void {
  // Add morphing classes randomly
  setInterval(() => {
    const cards = document.querySelectorAll('.fighter-card');
    cards.forEach(card => {
      if (Math.random() > 0.95) { // 5% chance
        card.classList.add('morphing');
        setTimeout(() => card.classList.remove('morphing'), 6000);
      }
    });
  }, 3000);

  // Add energy field effects to strong leans
  setInterval(() => {
    const strongLeans = document.querySelectorAll('.lean-indicator.strong');
    strongLeans.forEach(lean => {
      if (Math.random() > 0.8) { // 20% chance
        lean.classList.add('energy-field');
        setTimeout(() => lean.classList.remove('energy-field'), 4000);
      }
    });
  }, 5000);

  // Dynamic particle generation
  setInterval(() => {
    if (Math.random() > 0.9) { // 10% chance
      const particle = document.createElement('div');
      particle.className = 'quantum-particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.top = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 4 + 's';
      document.querySelector('.quantum-particles')?.appendChild(particle);
      setTimeout(() => particle.remove(), 8000);
    }
  }, 2000);
}

// Enhanced hover effects with sound-like feedback (visual)
document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('btn') || target.classList.contains('fighter-card') || target.classList.contains('line-cell')) {
    // Add ripple effect
    const ripple = document.createElement('div');
    ripple.style.position = 'absolute';
    ripple.style.border = '2px solid rgba(0,232,122,0.6)';
    ripple.style.borderRadius = '50%';
    ripple.style.width = '20px';
    ripple.style.height = '20px';
    ripple.style.left = '50%';
    ripple.style.top = '50%';
    ripple.style.transform = 'translate(-50%, -50%)';
    ripple.style.animation = 'ripple 0.6s ease-out';
    ripple.style.pointerEvents = 'none';
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }
});

// Performance monitoring and dynamic adjustments
let frameCount = 0;
let lastTime = performance.now();

function monitorPerformance(): void {
  if (!performanceMonitorStarted) performanceMonitorStarted = true;
  frameCount++;
  const currentTime = performance.now();
  if (currentTime - lastTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fps < 30) {
      // Reduce animations for performance
      document.documentElement.style.setProperty('--animation-duration', '0.1s');
    } else {
      document.documentElement.style.setProperty('--animation-duration', '0.3s');
    }
    frameCount = 0;
    lastTime = currentTime;
  }
  requestAnimationFrame(monitorPerformance);
}

// Initialize advanced effects
document.addEventListener('DOMContentLoaded', () => {
  if (!dynamicEffectsInitialized) {
    dynamicEffectsInitialized = true;
    addDynamicEffects();
  }
  if (!performanceMonitorStarted) monitorPerformance();

  // Add loading animation to body
  document.body.classList.add('loading');
  setTimeout(() => document.body.classList.remove('loading'), 1000);

  // Enhanced scroll effects
  let scrollTimeout: ReturnType<typeof setTimeout>;
  window.addEventListener('scroll', () => {
    document.body.classList.add('scrolling');
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      document.body.classList.remove('scrolling');
    }, 150);
  });
});

// Keyboard shortcuts for power users
function handleShortcutRefresh(): void {
  requestDataReload();
  // Add visual feedback
  document.body.style.animation = 'none';
  setTimeout(() => {
    document.body.style.animation = 'pulse 0.3s ease-in-out';
  }, 10);
}

function handleShortcutDebugToggle(): void {
  const debugPanel = document.getElementById('debugPanelWrap');
  if (debugPanel) {
    debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
  }
}

document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+R for rapid refresh
  if (e.ctrlKey && e.shiftKey && e.key === 'R') {
    e.preventDefault();
    handleShortcutRefresh();
  }

  // Ctrl+Shift+D for debug mode toggle
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    handleShortcutDebugToggle();
  }

});

// Auto-save user preferences
let preferencesTimeout: ReturnType<typeof setTimeout>;
const PREFS_STORAGE_KEY = 'ufc-analyzer-prefs';

interface AnalyzerPreferences {
  theme?: string;
  lastVisit?: number;
}

function readAnalyzerPreferences(): AnalyzerPreferences | null {
  const raw = localStorage.getItem(PREFS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalyzerPreferences;
  } catch (e) {
    console.warn('Failed to parse preferences:', e);
    return null;
  }
}

function savePreferences(): void {
  clearTimeout(preferencesTimeout);
  preferencesTimeout = setTimeout(() => {
    const prefs: AnalyzerPreferences = {
      theme: document.documentElement.className,
      lastVisit: Date.now()
    };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  }, 1000);
}

window.addEventListener('beforeunload', savePreferences);

// Load saved preferences
const savedPrefs = readAnalyzerPreferences();
if (savedPrefs?.theme) {
  document.documentElement.className = savedPrefs.theme;
}





