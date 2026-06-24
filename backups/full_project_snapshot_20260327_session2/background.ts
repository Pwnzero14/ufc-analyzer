import {
  StorageService,
  ScraperService,
  PropArchiveService,
} from './services/index.js';
import {
  AllLines,
  PropArchiveRecord,
} from './types/index.js';
import { CONFIG, FANTASY_SCORING } from './config/index.js';

// ── IN-MEMORY STORE ────────────────────────────────────────────────────
const store = { pick6: null as any, underdog: null as any, betr: null as any, prizepicks: null as any, draftkings_sportsbook: null as any };
const BEST_FIGHT_ODDS_URL = 'https://www.bestfightodds.com/';
const UFC_LONDON_CUTOFF_ISO = '2026-03-01T00:00:00.000Z';
let archiveEventOverride: string | null = null;

function toIsoDate(raw: string | null | undefined): string {
  if (!raw) return new Date().toISOString();
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return new Date(ts).toISOString();
  return new Date().toISOString();
}

function isAtOrAfterUfcLondon(rawDate: string | null | undefined): boolean {
  const eventTs = Date.parse(rawDate || '');
  const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
  if (!Number.isFinite(eventTs) || !Number.isFinite(londonTs)) return false;
  return eventTs >= londonTs;
}

function normalizeOddsName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  let n = name.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim();
  if (!n) return null;
  n = n.replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ');
  n = n
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
  return n || null;
}

function parseBestFightOddsMoneylines(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rowRe = /<tr[^>]*>\s*<th[^>]*>\s*<a[^>]*href="\/fighters\/[^"]+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>\s*<\/th>([\s\S]*?)<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const fighterName = normalizeOddsName(match[1]);
    if (!fighterName) continue;

    const odds = [...match[2].matchAll(/>([+-]\d{2,4})</g)]
      .map((m) => Number(m[1]))
      .filter((v) => Number.isFinite(v));
    if (!odds.length) continue;

    const consensus = Math.round(odds.reduce((a, b) => a + b, 0) / odds.length);
    out[fighterName] = consensus;
  }

  return out;
}

async function refreshFightOddsFromBestFightOdds(reason: string): Promise<number> {
  try {
    const res = await fetch(BEST_FIGHT_ODDS_URL, {
      signal: AbortSignal.timeout(20000),
      headers: {
        accept: 'text/html',
      },
    });
    if (!res.ok) {
      throw new Error(`BestFightOdds HTTP ${res.status}`);
    }

    const html = await res.text();
    const oddsByName = parseBestFightOddsMoneylines(html);
    const count = Object.keys(oddsByName).length;
    if (!count) {
      console.warn(`[UFC Odds] No moneyline odds parsed (${reason})`);
      return 0;
    }

    await StorageService.setFightOddsMoneyline(oddsByName);
    console.log(`[UFC Odds] Stored ${count} moneyline odds (${reason})`);
    notifyAnalyzerTabs({ type: 'ODDS_UPDATED', count, reason });
    return count;
  } catch (error) {
    console.error(`[UFC Odds] Failed to refresh moneyline odds (${reason}):`, error);
    return 0;
  }
}

// ── INITIALIZE BETR LINES FROM MANUAL INPUT ────────────────────────────
async function initializeBetrLines() {
  const betrFighters = [
    // Fantasy Pts (FP)
    { name: 'I. Baraniewski', opponent: 'A. Lane', line_ss: 18.5, line_fp: 109.5, line_td: null },
    { name: 'L. Riley', opponent: 'M. Aswell', line_ss: 68.5, line_fp: 77.5, line_td: null },
    { name: 'M. Evloev', opponent: 'L. Murphy', line_ss: 66.5, line_fp: 98.5, line_td: null },
    { name: 'R. Oliveira', opponent: 'S. Dyer', line_ss: null, line_fp: 50.5, line_td: null },
    { name: 'M. Pinto', opponent: 'Franco', line_ss: null, line_fp: 106.5, line_td: null },
    { name: 'M. Kondratavičius', opponent: 'Trocoli', line_ss: null, line_fp: 106.5, line_td: null },
    { name: 'C. Duncan', opponent: 'R. Dolidze', line_ss: 49.5, line_fp: 85.5, line_td: null },
    { name: 'R. Dolidze', opponent: 'C. Duncan', line_ss: 28.5, line_fp: 50.5, line_td: null },
    { name: 'S. Dyer', opponent: 'R. Oliveira', line_ss: null, line_fp: 81.5, line_td: null },
    
    // Sig Strikes (SS) only
    { name: 'K. Campbell', opponent: 'D. Silva', line_ss: 63.5, line_fp: null, line_td: null },
    { name: 'D. Silva', opponent: 'K. Campbell', line_ss: 58.5, line_fp: null, line_td: null },
    { name: 'L. Murphy', opponent: 'M. Evloev', line_ss: 56.5, line_fp: null, line_td: null },
    { name: 'M. Aswell', opponent: 'L. Riley', line_ss: 68.5, line_fp: null, line_td: null },
    { name: 'A. Lane', opponent: 'I. Baraniewski', line_ss: 11.5, line_fp: null, line_td: null },
    { name: 'M. Page', opponent: 'S. Patterson', line_ss: 25.5, line_fp: null, line_td: null },
    { name: 'S. Patterson', opponent: 'M. Page', line_ss: 23.5, line_fp: null, line_td: null },
  ];
  
  store.betr = {
    fighters: betrFighters,
    capturedAt: Date.now(),
  };
  
  // Persist to Chrome storage
  try {
    await StorageService.setLines('betr', betrFighters);
    await archivePlatformPropLines('betr', betrFighters);
    console.log('[UFC] Initialized and persisted Betr lines:', betrFighters.length, 'fighters');
  } catch (error) {
    console.error('[UFC] Failed to persist Betr lines:', error);
  }
}

// ── INCOMING LINES FROM CONTENT SCRIPT ────────────────────────────────
// Content script sends LINES_CAPTURED messages with scraped fighter data

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`[UFC BG] Message received from ${sender.url?.substring(0, 80) || 'unknown'}: type=${request.type}`);
  
  if (request.type === 'LINES_CAPTURED') {
    console.log(`[UFC BG] LINES_CAPTURED for platform="${request.platform}" with ${request.data?.fighters?.length || 0} fighters`);
    handleLinesCaptured(request.platform, request.data).catch((e) => {
      console.error('[UFC] Message handler error:', e);
    });
  } else if (request.type === 'GET_LINES') {
    sendResponse(store);
  } else if (request.type === 'CLEAR_LINES') {
    handleClearLines().catch((e) => {
      console.error('[UFC] Clear handler error:', e);
    });
  } else if (request.type === 'AUTO_SCRAPE_LINES') {
    autoScrapeAllPlatforms().then(sendResponse).catch((e) => {
      console.error('[UFC] Auto-scrape error:', e);
      sendResponse({ status: 'error', error: e.message });
    });
    return true; // indicates we'll respond asynchronously
  } else if (request.type === 'AUTO_SCRAPE_STATUS') {
    sendResponse({ inProgress: autoScrapeInProgress });
  } else if (request.type === 'GET_UPCOMING_CARD') {
    fetchUpcomingUFCCard(Boolean(request.forceRefresh))
      .then((card) => sendResponse({ card }))
      .catch((e) => {
        console.error('[UFC] GET_UPCOMING_CARD error:', e);
        sendResponse({ card: null });
      });
    return true;
  } else if (request.type === 'FIND_CARD_FOR_FIGHTERS') {
    findCardForFighters(Array.isArray(request.names) ? request.names : [])
      .then((card) => sendResponse({ card }))
      .catch(() => sendResponse({ card: null }));
    return true;
  } else if (request.type === 'ADD_BETR_LINES') {
    // Manually add Betr lines
    if (request.fighters && Array.isArray(request.fighters)) {
      store.betr = {
        fighters: request.fighters,
        capturedAt: Date.now(),
      };
      StorageService.setLines('betr', request.fighters)
        .then(() => archivePlatformPropLines('betr', request.fighters))
        .then(() => sendResponse({ ok: true, count: request.fighters.length }))
        .catch((e) => {
          console.error('[UFC] ADD_BETR_LINES persist error:', e);
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    } else {
      sendResponse({ ok: false, error: 'Invalid fighters format' });
    }
  } else if (request.type === 'REFRESH_FIGHT_ODDS') {
    refreshFightOddsFromBestFightOdds('manual')
      .then((count) => sendResponse({ ok: true, count }))
      .catch((e) => {
        console.error('[UFC] REFRESH_FIGHT_ODDS error:', e);
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  } else if (request.type === 'GRADE_ARCHIVE') {
    // includeZeroResults: re-settle records that were previously stored as 0 (likely a bad parse)
    fetchAndSettleFromUFCStats({ forceEventName: request.forceEventName, includeZeroResults: true })
      .then(async (result) => {
        if (result.settled > 0) {
          const bf = await PropArchiveService.backfillUnresolvedFromKnownOutcomes({ minHoursBetweenRuns: 0 });
          result.settled += bf.changed;
          notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled: result.settled });
        }
        sendResponse({ ok: true, ...result });
      })
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  } else if (request.type === 'FORCE_BACKFILL') {
    PropArchiveService.backfillUnresolvedFromKnownOutcomes({ minHoursBetweenRuns: 0 })
      .then(result => {
        if (result.changed > 0) notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled: result.changed });
        sendResponse({ ok: true, ...result });
      })
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  } else if (request.type === 'DELETE_ARCHIVE_EVENT') {
    const eventName = String(request.eventName || '').trim();
    if (!eventName) { sendResponse({ ok: false, deleted: 0 }); return false; }
    (async () => {
      try {
        const key = 'prop_archive_v1';
        const payload = await new Promise<Record<string, any>>((res) => chrome.storage.local.get([key], r => res(r || {})));
        const rows: any[] = Array.isArray(payload[key]) ? payload[key] : [];
        const normTarget = eventName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const kept = rows.filter(r => {
          const ev = String(r?.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return ev !== normTarget;
        });
        const deleted = rows.length - kept.length;
        await new Promise<void>((res) => chrome.storage.local.set({ [key]: kept }, () => res()));
        sendResponse({ ok: true, deleted });
      } catch (e) {
        sendResponse({ ok: false, deleted: 0, error: String(e) });
      }
    })();
    return true;
  }
  return false;
});

function normalizeFighterName(name: any): string | null {
  if (typeof name !== 'string') return null;
  return name.trim().toLowerCase();
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

function normalizeFightTimeLineToMinutes(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;

  // Convert round-based FT lines (1.5/2.5/3.5 rounds) into minutes.
  const roundedToHalf = Math.abs(value * 2 - Math.round(value * 2)) < 0.0001;
  if (value <= 5 && roundedToHalf) {
    return Number((value * 5).toFixed(1));
  }

  return value;
}

function normalizeFighterFightTimeLine<T extends Record<string, any>>(fighter: T): T {
  const normalized = normalizeFightTimeLineToMinutes(fighter?.line_ft);
  if (normalized == null || fighter?.line_ft === normalized) return fighter;
  return { ...fighter, line_ft: normalized };
}

function parseOddsValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  const m = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const value = Number(m[0]);
  return Number.isFinite(value) ? value : null;
}

function readOddsField(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const value = parseOddsValue(obj[key]);
    if (value != null) return value;
  }
  return null;
}

function extractUnderdogSideOdds(line: any): { overOdds: number | null; underOdds: number | null } {
  const overDirect = readOddsField(line, [
    'over_odds',
    'higher_odds',
    'over_payout_multiplier',
    'higher_payout_multiplier',
    'over_multiplier',
    'higher_multiplier',
  ]);
  const underDirect = readOddsField(line, [
    'under_odds',
    'lower_odds',
    'under_payout_multiplier',
    'lower_payout_multiplier',
    'under_multiplier',
    'lower_multiplier',
  ]);

  let overOdds = overDirect;
  let underOdds = underDirect;

  const outcomeBuckets = [
    line?.options,
    line?.choices,
    line?.outcomes,
    line?.selections,
    line?.pick_options,
    line?.selection_options,
    line?.over_under?.options,
    line?.over_under?.outcomes,
  ];

  for (const bucket of outcomeBuckets) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const sideText = String(
        entry.side
        || entry.choice
        || entry.pick
        || entry.selection
        || entry.outcome
        || entry.name
        || entry.label
        || entry.title
        || ''
      ).toLowerCase();
      const value = readOddsField(entry, [
        'odds',
        'american_odds',
        'payout_multiplier',
        'multiplier',
        'decimal_odds',
        'payout',
        'price',
      ]);
      if (value == null) continue;
      if (overOdds == null && /(higher|over)/.test(sideText)) overOdds = value;
      if (underOdds == null && /(lower|under)/.test(sideText)) underOdds = value;
    }
  }

  if (overOdds == null || underOdds == null) {
    for (const [key, raw] of Object.entries(line || {})) {
      if (typeof raw === 'object') continue;
      const value = parseOddsValue(raw);
      if (value == null) continue;
      const lowerKey = key.toLowerCase();
      const looksLikeOdds = /(odds|multiplier|price|payout)/.test(lowerKey);
      if (!looksLikeOdds) continue;
      if (overOdds == null && /(higher|over)/.test(lowerKey)) overOdds = value;
      if (underOdds == null && /(lower|under)/.test(lowerKey)) underOdds = value;
    }
  }

  return { overOdds, underOdds };
}

// ── UFC STATS RESULT SETTLER ──────────────────────────────────────────────
// Fetches actual fight results from ufcstats.com and settles archived prop lines.

const POST_EVENT_SETTLE_ALARM = 'ufc_post_event_settle';
const LIVE_SETTLE_ALARM       = 'ufc_live_settle';

function parseCtrlTime(ctrl: string): number {
  const m = ctrl.match(/^(\d+):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function computeFP(stats: {
  sigStrikes: number; totalStrikes: number; td: number; kd: number;
  rev: number; ctrlSecs: number; won: boolean; method: string; round: number;
}): number {
  const nonSig = Math.max(0, stats.totalStrikes - stats.sigStrikes);
  let fp = stats.sigStrikes * FANTASY_SCORING.sigStrike
    + nonSig * FANTASY_SCORING.nonSigStrike
    + stats.td * FANTASY_SCORING.takedown
    + stats.kd * FANTASY_SCORING.knockdown
    + stats.rev * FANTASY_SCORING.reversal
    + stats.ctrlSecs * FANTASY_SCORING.controlTimePerSec;
  if (stats.won) {
    const m = stats.method.toLowerCase();
    const isFin = m.includes('ko') || m.includes('tko') || m.includes('sub');
    if (isFin) {
      if (stats.round === 1) fp += FANTASY_SCORING.winBonus.round1;
      else if (stats.round === 2) fp += FANTASY_SCORING.winBonus.round2;
      else if (stats.round === 3) fp += FANTASY_SCORING.winBonus.round3;
      else fp += FANTASY_SCORING.winBonus.round4Plus;
    } else {
      fp += FANTASY_SCORING.winBonus.decision;
    }
  }
  return Math.round(fp * 10) / 10;
}

async function fetchFightDetails(url: string): Promise<Array<{
  name: string; won: boolean; ss: number; totalStr: number; td: number;
  kd: number; rev: number; ctrlSecs: number; method: string; round: number;
}>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const html = await res.text();

    // Fighter names: first two fighter-details links on the page
    const nameMatches = [...html.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+?)\s*<\/a>/gi)];
    const names = nameMatches.slice(0, 2).map(m => m[1].trim()).filter(Boolean);
    if (names.length < 2) return [];

    // W/L status: first two person-status elements
    const statusMatches = [...html.matchAll(/person-status[^>]*>\s*([WLD])/gi)];
    const statuses = statusMatches.slice(0, 2).map(m => m[1].toUpperCase());

    // Method and round
    const methodM = html.match(/Method:<\/i>\s*<i[^>]*>\s*([^<]+)/i);
    const roundM  = html.match(/Round:<\/i>\s*<i[^>]*>\s*(\d+)/i);
    const method = methodM ? methodM[1].trim() : 'Decision';
    const round  = roundM  ? parseInt(roundM[1]) : 3;

    // UFCStats fight detail page: the FIRST <tbody> is the Totals table.
    // Each data row has ONE <tr> with both fighters; each <td> separates values using <p> tags.
    const firstTbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || '';
    const firstRow = firstTbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1] || '';
    const cells = [...firstRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);

    // UFCStats separates per-fighter values using <p> tags (not <br>).
    // Split on </p> or <br>, strip tags, drop empties, return value at idx.
    const cellVal = (cellHtml: string, idx: number): string => {
      const parts = cellHtml
        .split(/<\/p>|<br\s*\/?>/i)
        .map(s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
        .filter(s => s.length > 0);
      return parts[idx] ?? '';
    };

    const result = [];
    // cols: [fighter-link, KD, Sig.Str "X of Y", Sig.Str%, Total "X of Y", TD "X of Y", TD%, Sub, Rev, Ctrl]
    for (let i = 0; i < 2; i++) {
      if (!names[i]) continue;
      const kd      = parseInt(cellVal(cells[1] ?? '', i)) || 0;
      const ssM     = cellVal(cells[2] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const ss      = ssM ? parseInt(ssM[1]) : 0;
      const totM    = cellVal(cells[4] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const totalStr = totM ? parseInt(totM[1]) : 0;
      const tdM     = cellVal(cells[5] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const td      = tdM ? parseInt(tdM[1]) : 0;
      const rev     = parseInt(cellVal(cells[8] ?? '', i)) || 0;
      const ctrl    = parseCtrlTime(cellVal(cells[9] ?? '', i) || '0:00');
      result.push({ name: names[i], won: statuses[i] === 'W', ss, totalStr, td, kd, rev, ctrlSecs: ctrl, method, round });
    }
    return result;
  } catch {
    return [];
  }
}

async function fetchAndSettleFromUFCStats(opts?: { forceEventName?: string; includeZeroResults?: boolean }): Promise<{ settled: number; skipped: number; errors: string[] }> {
  let settled = 0, skipped = 0;
  const errors: string[] = [];

  try {
    // Load unresolved archive records.
    // When includeZeroResults=true (manual trigger), also re-settle records where result===0
    // since that usually means a previous settle run stored wrong values (parsing failure).
    const raw = await new Promise<Record<string, any>>((res) => chrome.storage.local.get(['prop_archive_v1'], res));
    const archive: PropArchiveRecord[] = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
    const unresolved = archive.filter(r => {
      if (!Number.isFinite(Number(r.line)) || Number(r.line) <= 0) return false;
      if (!Number.isFinite(Number(r.result))) return true; // truly unresolved
      if (opts?.includeZeroResults && Number(r.result) === 0) return true; // likely bad parse
      return false;
    });
    if (!unresolved.length) {
      console.log('[UFC Settle] No unresolved records — archive is up to date');
      return { settled: 0, skipped: 0, errors: [] };
    }

    const eventNames = [...new Set(unresolved.map(r => r.event))];
    console.log(`[UFC Settle] ${unresolved.length} unresolved records across ${eventNames.length} event(s): ${eventNames.join(' | ')}`);

    // Fetch completed events list from UFCStats
    const listRes = await fetch('http://www.ufcstats.com/statistics/events/completed?page=all', {
      signal: AbortSignal.timeout(15000),
    });
    if (!listRes.ok) throw new Error(`UFCStats list HTTP ${listRes.status}`);
    const listHtml = await listRes.text();

    const completedEvents: Array<{ name: string; url: string; date: string }> = [];
    for (const rowM of [...listHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+?)\s*<\/a>/i);
      const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
      if (linkM && nameM) completedEvents.push({ name: nameM[1].trim(), url: linkM[1], date: dateM ? dateM[0] : '' });
    }
    console.log(`[UFC Settle] Found ${completedEvents.length} completed UFC events on UFCStats`);

    const normalizeEv = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Extract last names from "UFC Fight Night: A vs B" → Set{lastA, lastB}
    function eventSurnames(name: string): Set<string> {
      const m = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
      if (!m) return new Set();
      const a = m[1].trim().split(/\s+/).pop()!.toLowerCase();
      const b = m[2].trim().split(/\s+/).pop()!.toLowerCase();
      return new Set([a, b]);
    }

    for (const archiveEvent of eventNames) {
      if (opts?.forceEventName && !archiveEvent.toLowerCase().includes(opts.forceEventName.toLowerCase())) continue;

      // Match archive event name to completed event — try exact, then surname-set match
      const norm = normalizeEv(archiveEvent);
      const archiveSurnames = eventSurnames(archiveEvent);
      const match = completedEvents.find(ev => {
        const n = normalizeEv(ev.name);
        if (n === norm) return true;
        // Partial tail match (handles minor spelling differences)
        const tail = norm.slice(-24);
        if (tail.length >= 10 && (n.includes(tail) || tail.includes(n.slice(-24)))) return true;
        // Surname-set match: order-independent (e.g. "Murphy vs Evloev" ↔ "Evloev vs Murphy")
        if (archiveSurnames.size >= 2) {
          const evSurnames = eventSurnames(ev.name);
          if (evSurnames.size >= 2 && [...archiveSurnames].every(s => evSurnames.has(s))) return true;
        }
        return false;
      });

      if (!match) {
        console.log(`[UFC Settle] No completed UFCStats event matched: "${archiveEvent}"`);
        errors.push(`No match: ${archiveEvent}`);
        skipped++;
        continue;
      }
      console.log(`[UFC Settle] Matched "${archiveEvent}" → "${match.name}"`);

      // Fetch event page to get individual fight URLs
      const evRes = await fetch(match.url, { signal: AbortSignal.timeout(12000) });
      if (!evRes.ok) { errors.push(`Event page error: ${match.name}`); continue; }
      const evHtml = await evRes.text();

      const fightUrls = [...new Set(
        [...evHtml.matchAll(/href="(http[^"]*fight-details\/[a-f0-9]+)"/gi)].map(m => m[1])
      )];
      console.log(`[UFC Settle] ${fightUrls.length} fights found for ${match.name}`);

      // Build a name alias map: last name → full UFCStats name, for fuzzy matching abbreviated archive names
      const allFightResults: typeof import('./background.js') extends never ? never : Awaited<ReturnType<typeof fetchFightDetails>> = [];
      for (const fightUrl of fightUrls) {
        const fightResults = await fetchFightDetails(fightUrl);
        allFightResults.push(...fightResults);
        await new Promise(r => setTimeout(r, 250));
      }

      console.log(`[UFC Settle] Parsed ${allFightResults.length} fighter results from ${fightUrls.length} fights`);

      // Map last-name → full name so "M Aswell" can match "Michael Aswell Jr"
      const lastNameMap = new Map<string, string>();
      for (const f of allFightResults) {
        if (!f.name) continue;
        const last = f.name.trim().split(/\s+/).pop()!.toLowerCase();
        lastNameMap.set(last, f.name);
      }

      for (const f of allFightResults) {
        if (!f.name) continue;
        const fp = computeFP({ sigStrikes: f.ss, totalStrikes: f.totalStr, td: f.td, kd: f.kd, rev: f.rev, ctrlSecs: f.ctrlSecs, won: f.won, method: f.method, round: f.round });

        // Try exact name first, then abbreviated first-initial match (e.g. "M Aswell" → "Michael Aswell Jr")
        const namesToTry = new Set<string>([f.name]);
        const parts = f.name.trim().split(/\s+/);
        if (parts.length >= 2) {
          // "Michael Aswell Jr" → also try matching archive records whose last name matches
          namesToTry.add(`${parts[0][0]} ${parts.slice(1).join(' ')}`); // "M Aswell Jr"
          namesToTry.add(`${parts[0][0]} ${parts[parts.length - 1]}`);  // "M Aswell"
        }

        let didSettle = false;
        for (const name of namesToTry) {
          const a = await PropArchiveService.updateResult(name, archiveEvent, 'SS' as any,      f.ss, { date: match.date });
          const b = await PropArchiveService.updateResult(name, archiveEvent, 'TD' as any,      f.td, { date: match.date });
          const c = await PropArchiveService.updateResult(name, archiveEvent, 'Fantasy' as any, fp,   { date: match.date });
          if (a || b || c) didSettle = true;
        }
        if (didSettle) {
          console.log(`[UFC Settle] ${f.name}: SS=${f.ss} TD=${f.td} FP=${fp.toFixed(1)} (${f.won ? 'W' : 'L'} R${f.round})`);
          settled++;
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    console.error('[UFC Settle] Error:', e);
  }

  console.log(`[UFC Settle] Done — settled=${settled}, skipped=${skipped}, errors=${errors.length}`);
  return { settled, skipped, errors };
}

function toArchivePropTypeFromLineKey(lineKey: string): string {
  const key = lineKey.toLowerCase();
  if (key === 'line_fp') return 'Fantasy';
  if (key === 'line_ss') return 'SS';
  if (key === 'line_td') return 'TD';
  if (key.includes('control')) return 'Control';
  if (key.includes('fighttime') || key.includes('fight_time')) return 'FightTime';
  return key.replace(/^line_/, '').replace(/_/g, ' ');
}

function getRosterNameSet(): Set<string> {
  const out = new Set<string>();
  const pools = [store.pick6?.fighters, store.underdog?.fighters, store.betr?.fighters, store.prizepicks?.fighters];
  for (const fighters of pools) {
    for (const f of fighters || []) {
      const n = normalizeFighterName(f?.name);
      if (n) out.add(n);
    }
  }
  return out;
}

async function archivePlatformPropLines(
  platform: 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook',
  fighters: Array<any>,
): Promise<void> {
  if (!fighters?.length) return;

  const card = await fetchUpcomingUFCCard(false);
  if (!card || !isAtOrAfterUfcLondon(card.date)) return;

  const inferredEvent = inferEventFromSlate(fighters) || inferEventFromStoreSlate();
  const overlap = countCardOverlap(card, fighters);
  if (inferredEvent) archiveEventOverride = inferredEvent;

  let archiveEventName: string;
  if (overlap >= 4) {
    archiveEventName = card.event;
  } else {
    const fallback = inferredEvent || archiveEventOverride || null;
    if (!fallback) {
      console.warn(`[UFC Archive] Skipping — card mismatch (overlap=${overlap}) and no inferred event (card=${card.event})`);
      return;
    }
    archiveEventName = fallback;
  }

  if (archiveEventName !== card.event) {
    console.warn(`[UFC Archive] Card mismatch detected (overlap=${overlap}), using inferred event: ${archiveEventName}`);
    await rewriteRecentArchiveEventName(card.event, archiveEventName);
  }

  const roster = getRosterNameSet();
  const records: PropArchiveRecord[] = [];
  const dateIso = toIsoDate(card.date);

  for (const f of fighters) {
    const fighter = String(f?.name || '').trim();
    if (!fighter) continue;
    const fighterKey = normalizeFighterName(fighter);
    const opponent = sanitizeOpponentName(f?.opponent, fighter) || String(f?.opponent || '').trim() || 'Unknown Opponent';
    const opponentKey = normalizeFighterName(opponent);

    const isRostered = fighterKey ? roster.has(fighterKey) : false;
    const isOpponentRostered = opponentKey ? roster.has(opponentKey) : false;
    if (!isRostered && !isOpponentRostered) continue;

    for (const [key, rawVal] of Object.entries(f)) {
      if (!key.startsWith('line_')) continue;
      const line = Number(rawVal);
      if (!Number.isFinite(line) || line <= 0) continue;
      records.push({
        fighter,
        opponent,
        event: archiveEventName,
        date: dateIso,
        platform,
        propType: toArchivePropTypeFromLineKey(key),
        line,
        result: Number.NaN,
      });
    }
  }

  if (!records.length) return;
  await PropArchiveService.addProps(records);
  console.log(`[UFC Archive] Archived ${records.length} ${platform} prop lines for ${archiveEventName}`);
}

async function rewriteRecentArchiveEventName(fromEvent: string, toEvent: string): Promise<void> {
  try {
    if (!fromEvent || !toEvent || fromEvent === toEvent) return;
    const key = 'prop_archive_v1';
    const payload = await new Promise<Record<string, any>>((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result || {}));
    });
    const rows = Array.isArray(payload[key]) ? payload[key] : [];
    if (!rows.length) return;

    const now = Date.now();
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    let changed = 0;

    const updated = rows.map((r: any) => {
      if (!r || typeof r !== 'object') return r;
      const ev = String(r.event || '').trim();
      const ts = Date.parse(String(r.date || ''));
      if (ev === fromEvent && Number.isFinite(ts) && Math.abs(now - ts) <= twoWeeksMs) {
        changed += 1;
        return { ...r, event: toEvent };
      }
      return r;
    });

    if (changed > 0) {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [key]: updated }, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
      console.log(`[UFC Archive] Rewrote ${changed} recent archive rows from "${fromEvent}" to "${toEvent}"`);
    }
  } catch (e) {
    console.warn('[UFC Archive] Failed to rewrite stale event names:', e);
  }
}

function countCardOverlap(card: UpcomingCardCache, fighters: Array<any>): number {
  const names = new Set<string>();
  for (const f of fighters || []) {
    const n1 = normalizeFighterName(f?.name);
    const n2 = normalizeFighterName(String(f?.opponent || ''));
    if (n1) names.add(n1);
    if (n2) names.add(n2);
  }

  let score = 0;
  for (const bout of card.fighters || []) {
    const a = normalizeFighterName(bout.f1);
    const b = normalizeFighterName(bout.f2);
    if (a && names.has(a)) score++;
    if (b && names.has(b)) score++;
  }
  return score;
}

function inferEventFromSlate(fighters: Array<any>): string | null {
  const pairCounts = new Map<string, { a: string; b: string; count: number }>();

  for (const f of fighters || []) {
    const aRaw = String(f?.name || '').trim();
    const bRaw = sanitizeOpponentName(f?.opponent, aRaw) || String(f?.opponent || '').trim();
    const a = normalizeFighterName(aRaw);
    const b = normalizeFighterName(bRaw);
    if (!a || !b || a === b) continue;

    const names = [aRaw, bRaw].sort((x, y) => x.localeCompare(y));
    const key = `${normalizeFighterName(names[0])}|${normalizeFighterName(names[1])}`;
    const existing = pairCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      pairCounts.set(key, { a: names[0], b: names[1], count: 1 });
    }
  }

  let best: { a: string; b: string; count: number } | null = null;
  for (const v of pairCounts.values()) {
    if (!best || v.count > best.count) best = v;
  }
  if (!best || best.count < 2) return null;
  return `UFC Fight Night: ${best.a} vs ${best.b}`;
}

function inferEventFromStoreSlate(): string | null {
  const all: Array<any> = [];
  for (const key of ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook'] as const) {
    const rows = store[key]?.fighters || [];
    for (const r of rows) all.push(r);
  }
  return inferEventFromSlate(all);
}

function mergeFighters(
  existing: Array<any> = [],
  incoming: Array<any> = []
): Array<any> {
  const map = new Map<string, any>();

  const push = (fighter: any) => {
    fighter = normalizeFighterFightTimeLine(fighter || {});
    const key = normalizeFighterName(fighter?.name);
    if (!key) return;
    
    if (!map.has(key)) {
      map.set(key, { ...fighter });
    } else {
      const prev = map.get(key);
      // Merge only non-null properties to avoid nulls overwriting existing values
      const merged = { ...prev };
      if (fighter.line_fp != null) merged.line_fp = fighter.line_fp;
      if (fighter.line_ss != null) merged.line_ss = fighter.line_ss;
      if (fighter.line_td != null) merged.line_td = fighter.line_td;
      if (fighter.line_ft != null) {
        const ftLine = normalizeFightTimeLineToMinutes(fighter.line_ft);
        if (ftLine != null) merged.line_ft = ftLine;
      }
      if (fighter.ss_over_odds != null) merged.ss_over_odds = fighter.ss_over_odds;
      if (fighter.ss_under_odds != null) merged.ss_under_odds = fighter.ss_under_odds;
      if (fighter.td_over_odds != null) merged.td_over_odds = fighter.td_over_odds;
      if (fighter.td_under_odds != null) merged.td_under_odds = fighter.td_under_odds;
      if (fighter.ft_over_odds != null) merged.ft_over_odds = fighter.ft_over_odds;
      if (fighter.ft_under_odds != null) merged.ft_under_odds = fighter.ft_under_odds;
      const cleanOpponent = sanitizeOpponentName(fighter.opponent, fighter.name);
      if (cleanOpponent != null) merged.opponent = cleanOpponent;
      map.set(key, merged);
    }
  };

  if (CONFIG.logging.debug) {
    console.log(`[UFC] mergeFighters - existing: ${existing.length}, incoming: ${incoming.length}`);
  }

  existing.forEach(push);
  incoming.forEach(push);

  const result = Array.from(map.values());
  if (CONFIG.logging.debug) {
    console.log(`[UFC] mergeFighters - merged: ${result.length}`);
  }
  return result;
}

function countNameOverlap(existing: Array<any>, incoming: Array<any>): number {
  const existingNames = new Set<string>();
  for (const f of existing || []) {
    const n = normalizeFighterName(f?.name);
    if (n) existingNames.add(n);
  }
  let overlap = 0;
  for (const f of incoming || []) {
    const n = normalizeFighterName(f?.name);
    if (n && existingNames.has(n)) overlap += 1;
  }
  return overlap;
}

function shouldReplaceSlate(existing: Array<any>, incoming: Array<any>): boolean {
  if (!existing.length || incoming.length < 8) return false;
  const overlap = countNameOverlap(existing, incoming);
  const incomingOverlapRatio = overlap / Math.max(1, incoming.length);
  const existingOverlapRatio = overlap / Math.max(1, existing.length);
  // If overlap is low in both directions, this is likely a new event slate.
  return incomingOverlapRatio < 0.35 && existingOverlapRatio < 0.45;
}

function mergeOrReplaceFighters(existing: Array<any>, incoming: Array<any>, platform: string): Array<any> {
  const normalizedIncoming = mergeFighters([], incoming);
  if (!existing.length) return normalizedIncoming;
  if (shouldReplaceSlate(existing, normalizedIncoming)) {
    console.warn(
      `[UFC] ${platform}: detected likely new slate, replacing ${existing.length} stale fighters with ${normalizedIncoming.length} incoming fighters`
    );
    return normalizedIncoming;
  }
  return mergeFighters(existing, normalizedIncoming);
}

async function handleLinesCaptured(platform: string, data: any): Promise<void> {
  try {
    if (!data?.fighters || !Array.isArray(data.fighters)) return;

    // Get current stored data from chrome.storage (source of truth)
    const platformKey = platform as 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook';
    const allStored = await StorageService.getLines();
    const stored = allStored[platformKey];
    const existing = stored?.fighters || [];
    const mergedFighters = mergeOrReplaceFighters(existing, data.fighters, platform);

    console.log(`[UFC] Merged ${platform}: existing ${existing.length}, incoming ${data.fighters.length}, merged ${mergedFighters.length}`);
    mergedFighters.forEach(f => {
      if (f.line_ss && f.line_td) {
        console.log(`[UFC] Fighter ${f.name} has SS: ${f.line_ss}, TD: ${f.line_td}`);
      }
    });

    // Update both in-memory store and persistent storage
    store[platformKey] = {
      fighters: mergedFighters,
      capturedAt: Date.now(),
    };

    await StorageService.setLines(platformKey, mergedFighters);
    await archivePlatformPropLines(platformKey, mergedFighters);

    // Notify analyzer tabs to refresh with the new data
    notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform, count: mergedFighters.length });
  } catch (error) {
    console.error(`[UFC] Error handling ${platform} lines:`, error);
  }
}

async function handleClearLines(): Promise<void> {
  store.pick6 = null;
  store.underdog = null;
  store.betr = null;
  store.prizepicks = null;
  store.draftkings_sportsbook = null;
  await StorageService.clearLines();
}

const STARTUP_MIGRATION_KEY = 'startup_migration_version';
const STARTUP_MIGRATION_VERSION = '2026-03-23-cache-reset-v1';

async function getStorageRecord(keys: string[]): Promise<Record<string, any>> {
  return await new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

async function setStorageRecord(values: Record<string, any>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function removeStorageKeys(keys: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function runStartupMigrationIfNeeded(): Promise<void> {
  const record = await getStorageRecord([STARTUP_MIGRATION_KEY]);
  const applied = String(record[STARTUP_MIGRATION_KEY] || '');
  if (applied === STARTUP_MIGRATION_VERSION) return;

  await StorageService.clearLines();
  await removeStorageKeys(['upcoming_ufc_card']);
  await setStorageRecord({ [STARTUP_MIGRATION_KEY]: STARTUP_MIGRATION_VERSION });
  console.log(`[UFC] Applied startup cache migration: ${STARTUP_MIGRATION_VERSION}`);
}

// ── RESTORE PERSISTED DATA ON STARTUP ──────────────────────────────────

(async () => {
  try {
    await runStartupMigrationIfNeeded();

    const lines = await StorageService.getLines();
    const normalizePersistedPlatform = async (platform: 'pick6' | 'underdog' | 'prizepicks' | 'draftkings_sportsbook') => {
      const payload = lines[platform];
      if (!payload?.fighters?.length) return;
      let changed = false;
      const normalizedFighters = payload.fighters.map((fighter: any) => {
        const normalized = normalizeFighterFightTimeLine(fighter);
        if (normalized !== fighter) changed = true;
        return normalized;
      });
      if (!changed) return;
      lines[platform] = { ...payload, fighters: normalizedFighters };
      await StorageService.setLines(platform, normalizedFighters);
      console.log(`[UFC] Normalized persisted FT lines to minutes for ${platform}`);
    };

    await normalizePersistedPlatform('pick6');
    await normalizePersistedPlatform('underdog');
    await normalizePersistedPlatform('prizepicks');
    await normalizePersistedPlatform('draftkings_sportsbook');

    if (lines.pick6) store.pick6 = lines.pick6;
    if (lines.underdog) store.underdog = lines.underdog;
    if (lines.betr) store.betr = lines.betr;
    if (lines.prizepicks) store.prizepicks = lines.prizepicks;
    if (lines.draftkings_sportsbook) store.draftkings_sportsbook = lines.draftkings_sportsbook;
    console.log('[UFC] Restored persisted lines on startup');

    await refreshFightOddsFromBestFightOdds('startup');

    // ── Startup catch-up settle ─────────────────────────────────────────
    // If the browser was closed during the event, alarms never fired.
    // On startup: if an event is currently in progress (or ended < 28h ago)
    // and we still have unresolved archive records, settle immediately and
    // reschedule the live alarm so polling continues.
    try {
      const raw = await new Promise<Record<string, any>>((res) =>
        chrome.storage.local.get(['upcoming_ufc_card', 'prop_archive_v1'], res)
      );
      const card = raw.upcoming_ufc_card as UpcomingCardCache | undefined;
      const archive: any[] = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
      const unresolved = archive.filter(r =>
        Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result))
      );

      if (card?.date && unresolved.length > 0) {
        const eventTs = parseEventDateMs(card.date);
        const now = Date.now();
        const liveEndTs  = eventTs + 8  * 60 * 60 * 1000; // 8h after event start
        const settleEndTs = eventTs + 28 * 60 * 60 * 1000; // 28h after event start

        if (Number.isFinite(eventTs) && now >= eventTs && now < settleEndTs) {
          console.log(`[UFC Settle] Startup catch-up: event "${card.event}" in window, ${unresolved.length} unresolved — settling now`);
          // Immediate settle
          runSettle().catch(e => console.error('[UFC Settle] Startup settle error:', e));

          // Re-schedule live alarm if still within the live window
          if (now < liveEndTs) {
            chrome.alarms.get(LIVE_SETTLE_ALARM, (existing) => {
              if (!existing) {
                chrome.alarms.create(LIVE_SETTLE_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
                console.log('[UFC Settle] Live alarm rescheduled after startup catch-up');
              }
            });
          }
        }
      }
    } catch (e) {
      console.error('[UFC Settle] Startup catch-up error:', e);
    }

  } catch (error) {
    console.error('[UFC] Failed to restore lines:', error);
  }
})();

// ── AUTO-SCRAPE ORCHESTRATION ──────────────────────────────────────────
// Opens tabs for each platform, triggers scraping, closes tabs

const AUTO_SCRAPE_URLS: Record<'pick6'|'underdog'|'prizepicks'|'draftkings_sportsbook', string[]> = {
  pick6: [
    // Start from the live UFC board; older available-players routes now 404.
    CONFIG.platforms.pick6.url,
    // TD props page — category/47 is Takedowns; pickGroup is event-specific so omit it
    'https://pick6.draftkings.com/category/47?sport=UFC',
    // Fight Score (FP) props page — category/46 is Fight Score on Pick6
    'https://pick6.draftkings.com/category/46?sport=UFC',
  ],
  underdog: [
    // Prioritize stat-specific pages first so SS/TD capture completes quickly.
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA?filter_id=8cbf8104-618b-435d-a5c5-ba71d8912a20&filter_type=PickemStat',
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA?filter_id=17cfbc8d-3c16-46b8-abc9-4ca34e546be4&filter_type=PickemStat',
    CONFIG.platforms.underdog.url,
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA',
  ],
  prizepicks: [
    'https://app.prizepicks.com/board',
  ],
  draftkings_sportsbook: [
    // DraftKings Sportsbook UFC Fighter Props (SS + TD + Odds)
    'https://sportsbook.draftkings.com/leagues/mma/ufc?category=fighter-props&subcategory=significant-strikes-o-u',
    'https://sportsbook.draftkings.com/leagues/mma/ufc?category=fighter-props&subcategory=takedowns-landed-o-u',
  ],
};

let autoScrapeInProgress = false;

interface UnderdogCoverage {
  total: number;
  fpCount: number;
  ssCount: number;
  tdCount: number;
  allThreeCount: number;
}

function getUnderdogStatCoverage(
  fighters: Array<{ line_fp?: number | null; line_ss?: number | null; line_td?: number | null }>
): UnderdogCoverage {
  let fpCount = 0, ssCount = 0, tdCount = 0, allThreeCount = 0;
  for (const f of fighters) {
    if (f.line_fp != null) fpCount++;
    if (f.line_ss != null) ssCount++;
    if (f.line_td != null) tdCount++;
    if (f.line_fp != null && f.line_ss != null && f.line_td != null) allThreeCount++;
  }
  return { total: fighters.length, fpCount, ssCount, tdCount, allThreeCount };
}

function hasEnoughUnderdogStatCoverage(coverage: UnderdogCoverage, expectedFighters: number = 20): boolean {
  // Require meaningful card breadth + cross-stat overlap before ending auto-fetch.
  const minTotal = Math.max(12, Math.floor(expectedFighters * 0.7));
  const minByStat = Math.max(6, Math.floor(minTotal * 0.45));
  const minAllThree = Math.max(4, Math.floor(minTotal * 0.3));
  return (
    coverage.total >= minTotal
    && coverage.fpCount >= minByStat
    && coverage.ssCount >= minByStat
    && coverage.tdCount >= minByStat
    && coverage.allThreeCount >= minAllThree
  );
}

async function shouldAttemptPick6Scrape(): Promise<boolean> {
  // Pick6 now posts MMA FP/SS/TD reliably enough to always try during auto-fetch.
  return true;
}

function hasEnoughPick6StatCoverage(coverage: UnderdogCoverage, expectedFighters: number = 20): boolean {
  const minTotal = Math.max(10, Math.floor(expectedFighters * 0.55));
  const minByStat = Math.max(4, Math.floor(minTotal * 0.35));
  const minAllThree = Math.max(2, Math.floor(minTotal * 0.16));
  return (
    coverage.total >= minTotal
    && coverage.fpCount >= minByStat
    && coverage.ssCount >= minByStat
    && coverage.tdCount >= minByStat
    && coverage.allThreeCount >= minAllThree
  );
}

function hasEnoughPrizePicksStatCoverage(coverage: UnderdogCoverage, expectedFighters: number = 20): boolean {
  const minTotal = Math.max(8, Math.floor(expectedFighters * 0.45));
  const minByStat = Math.max(4, Math.floor(minTotal * 0.35));
  // PrizePicks boards can be thinner; require at least one of SS/TD with broad fighter coverage.
  return (
    coverage.total >= minTotal
    && coverage.fpCount >= minByStat
    && (coverage.ssCount >= minByStat || coverage.tdCount >= minByStat)
  );
}

function parseUnderdogApiFighters(data: any): Array<{ name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; line_ft: number | null; opponent: string | null; ss_over_odds: number | null; ss_under_odds: number | null; td_over_odds: number | null; td_under_odds: number | null; ft_over_odds: number | null; ft_under_odds: number | null }> {
  const fighters: Record<string, { name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; line_ft: number | null; opponent: string | null; ss_over_odds: number | null; ss_under_odds: number | null; td_over_odds: number | null; td_under_odds: number | null; ft_over_odds: number | null; ft_under_odds: number | null }> = {};
  const linesRaw = data?.over_under_lines || {};
  const lines = Array.isArray(linesRaw) ? linesRaw : Object.values(linesRaw);
  const appearancesRaw = data?.appearances || {};
  const playersRaw = data?.players || {};
  const matchups = data?.over_under || data?.over_unders || data?.over_under_appearances || {};

  const appearancesArr = Array.isArray(appearancesRaw) ? appearancesRaw : Object.values(appearancesRaw);
  const playersArr = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);

  const appearanceById = new Map<string, any>(
    appearancesArr
      .filter((a: any) => a?.id)
      .map((a: any) => [String(a.id), a])
  );
  const playerById = new Map<string, any>(
    playersArr
      .filter((p: any) => p?.id)
      .map((p: any) => [String(p.id), p])
  );
  const appearancesByMatchId = new Map<string, any[]>();
  for (const app of appearancesArr as any[]) {
    if (!app?.match_id || !app?.player_id) continue;
    const key = String(app.match_id);
    const bucket = appearancesByMatchId.get(key) || [];
    bucket.push(app);
    appearancesByMatchId.set(key, bucket);
  }

  for (const line of lines as any[]) {
    if (!line) continue;
    if (line.status && line.status !== 'active') continue;
    const statValue = parseFloat(String(line.stat_value ?? line.line_score ?? ''));
    if (!Number.isFinite(statValue) || statValue < 0) continue;

    const title = String(
      line.title
      || line.stat
      || line.stat_type
      || line.display_stat
      || line.over_under?.appearance_stat?.display_stat
      || line.over_under?.title
      || ''
    ).toLowerCase();
    let lineType: 'fp'|'ss'|'td'|'ft'|null = null;
    if (title.includes('significant strike') || title === 'significant strikes') lineType = 'ss';
    else if (title.includes('takedown') && !title.includes('def')) lineType = 'td';
    else if (title.includes('fight time') || title.includes('fighttime') || title.includes('fight lasts') || title.includes('fight duration')) lineType = 'ft';
    else if (title.includes('fantasy') || title.includes(' pts') || title === 'fantasy points' || title === '') lineType = 'fp';
    if (!lineType) continue;

    const appearanceId = line.appearance_id
      || line.over_under?.appearance_stat?.appearance_id
      || line.over_under?.appearance_id
      || null;
    const app = appearanceId ? appearanceById.get(String(appearanceId)) || {} : {};
    const player = app?.player_id ? playerById.get(String(app.player_id)) || {} : {};

    const sport = String(
      player?.sport_id
      || app?.sport
      || app?.sport_id
      || app?.league
      || app?.league_name
      || ''
    ).toLowerCase();
    if (sport && !/ufc|mma/.test(sport)) continue;

    const derivedName = `${player?.first_name || ''} ${player?.last_name || ''}`.trim();
    const name = (player?.full_name || player?.name || derivedName || '').trim();
    if (!name) continue;

    let opponent: string | null = null;
    const matchupId = app.over_under_id || line.over_under_id || line.over_under?.id;
    const mu = matchupId ? matchups[matchupId] : null;
    if (mu) {
      const ids = mu.over_under_appearance_ids || mu.appearance_ids || [];
      const otherAppId = Array.isArray(ids)
        ? ids.find((id: string) => String(id) !== String(appearanceId || ''))
        : null;
      if (otherAppId && appearanceById.has(String(otherAppId))) {
        const otherApp = appearanceById.get(String(otherAppId));
        const otherPlayer = otherApp?.player_id ? playerById.get(String(otherApp.player_id)) || {} : {};
        const otherName = `${otherPlayer?.first_name || ''} ${otherPlayer?.last_name || ''}`.trim();
        opponent = (otherPlayer?.full_name || otherPlayer?.name || otherName || null);
      }
    } else if (app?.match_id) {
      // v1 fallback: infer opponent from other appearance in same match.
      const peerApps = appearancesByMatchId.get(String(app.match_id)) || [];
      const otherApp = peerApps.find((a) => String(a?.id) !== String(app?.id || '')) || null;
      if (otherApp?.player_id) {
        const otherPlayer = playerById.get(String(otherApp.player_id)) || {};
        const otherName = `${otherPlayer?.first_name || ''} ${otherPlayer?.last_name || ''}`.trim();
        opponent = (otherPlayer?.full_name || otherPlayer?.name || otherName || null);
      }
    }

    if (!fighters[name]) {
      fighters[name] = {
        name,
        line_fp: null,
        line_ss: null,
        line_td: null,
        line_ft: null,
        opponent: opponent || null,
        ss_over_odds: null,
        ss_under_odds: null,
        td_over_odds: null,
        td_under_odds: null,
        ft_over_odds: null,
        ft_under_odds: null,
      };
    }
    const normalizedStatValue = lineType === 'ft' ? normalizeFightTimeLineToMinutes(statValue) : statValue;
    fighters[name][`line_${lineType}`] = normalizedStatValue;
    const sideOdds = extractUnderdogSideOdds(line);
    if (lineType === 'ss') {
      if (sideOdds.overOdds != null) fighters[name].ss_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].ss_under_odds = sideOdds.underOdds;
    } else if (lineType === 'td') {
      if (sideOdds.overOdds != null) fighters[name].td_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].td_under_odds = sideOdds.underOdds;
    } else if (lineType === 'ft') {
      if (sideOdds.overOdds != null) fighters[name].ft_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].ft_under_odds = sideOdds.underOdds;
    }
    if (opponent) fighters[name].opponent = opponent;
  }

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null || f.line_ft != null);
}

async function fetchUnderdogFromBackground(): Promise<UnderdogCoverage> {
  const endpoints = CONFIG.api.underdog || [];
  let mergedFighters = store.underdog?.fighters || [];
  for (const url of endpoints) {
    let parsedAny = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const timeoutMs = 18000 + (attempt - 1) * 6000;
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) continue;
        const data = await res.json();
        const fighters = parseUnderdogApiFighters(data);
        if (!fighters.length) continue;

        mergedFighters = mergeOrReplaceFighters(mergedFighters, fighters, 'underdog');
        const coverage = getUnderdogStatCoverage(mergedFighters);
        console.log(`[UFC Auto-Scrape] underdog API endpoint: ${url} (try ${attempt}) → fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
        parsedAny = true;
        break;
      } catch (e) {
        console.warn(`[UFC Auto-Scrape] underdog API failed for endpoint (try ${attempt}):`, url, e);
        await new Promise((r) => setTimeout(r, 450 * attempt));
      }
    }
    if (!parsedAny) {
      console.warn('[UFC Auto-Scrape] underdog API gave no usable fighters for endpoint:', url);
    }
  }

  if (mergedFighters.length) {
    store.underdog = { fighters: mergedFighters, capturedAt: Date.now() };
    await StorageService.setLines('underdog', mergedFighters);
    await archivePlatformPropLines('underdog', mergedFighters);
    notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform: 'underdog', count: mergedFighters.length });
  }
  return getUnderdogStatCoverage(mergedFighters);
}

function parsePrizePicksApiFighters(data: any): Array<{ name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; line_ft: number | null; opponent: string | null }> {
  const fighters: Record<string, { name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; line_ft: number | null; opponent: string | null }> = {};
  const projections = Array.isArray(data?.data) ? data.data : [];
  const included = Array.isArray(data?.included) ? data.included : [];

  const playerById = new Map<string, any>();
  const leagueById = new Map<string, string>();
  for (const inc of included) {
    if (!inc?.id) continue;
    if (inc.type === 'new_player' || inc.type === 'player') {
      playerById.set(String(inc.id), inc);
    } else if (inc.type === 'league') {
      const leagueName = String(
        inc?.attributes?.name
        || inc?.attributes?.display_name
        || inc?.attributes?.abbreviation
        || ''
      ).trim();
      leagueById.set(String(inc.id), leagueName);
    }
  }

  const upsert = (name: string, type: 'fp'|'ss'|'td'|'ft', value: number, opponent: string | null = null) => {
    if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, line_ft: null, opponent };
    fighters[name][`line_${type}`] = type === 'ft' ? normalizeFightTimeLineToMinutes(value) : value;
    if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
  };

  for (const p of projections) {
    if (!p || p.type !== 'projection') continue;
    const attrs = p.attributes || {};

    // Keep only MMA/UFC projections from the board payload.
    const leagueRelId = p.relationships?.league?.data?.id ? String(p.relationships.league.data.id) : '';
    const leagueName = String(leagueById.get(leagueRelId) || '').toLowerCase();
    if (!/\bmma\b|\bufc\b/.test(leagueName)) continue;

    const stat = String(attrs.stat_type || '').toLowerCase();
    let lineType: 'fp'|'ss'|'td'|'ft'|null = null;

    if (stat.includes('significant strike')) lineType = 'ss';
    else if (stat.includes('takedown')) lineType = 'td';
    else if (stat.includes('fight time') || stat.includes('fighttime') || stat.includes('fight duration') || stat.includes('rounds')) lineType = 'ft';
    else if (stat.includes('fantasy score') || stat.includes('fantasy points')) lineType = 'fp';
    if (!lineType) continue;

    const line = parseFloat(String(attrs.line_score ?? ''));
    if (!Number.isFinite(line) || line < 0) continue;

    const playerRelId = p.relationships?.new_player?.data?.id
      || p.relationships?.player?.data?.id
      || null;
    const player = playerRelId ? playerById.get(String(playerRelId)) : null;

    const rawName = String(
      player?.attributes?.name
      || attrs.description
      || ''
    ).trim();

    // Skip team/game descriptors and keep likely fighter names only.
    const name = rawName.replace(/\s*-\s*[A-Z]$/i, '').trim();
    if (!name || name.split(' ').length < 2 || /\d/.test(name)) continue;

    const opponentRaw = String(player?.attributes?.opponent || '').trim();
    const opponent = opponentRaw && opponentRaw.split(' ').length >= 2 ? opponentRaw : null;

    upsert(name, lineType, line, opponent);
  }

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null || f.line_ft != null);
}

async function fetchPrizePicksFromBackground(): Promise<UnderdogCoverage> {
  const endpoints = [
    'https://api.prizepicks.com/projections?per_page=250&single_stat=false',
    'https://api.prizepicks.com/projections?single_stat=false',
  ];

  let mergedFighters = store.prizepicks?.fighters || [];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          accept: 'application/json',
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const fighters = parsePrizePicksApiFighters(data);
      if (!fighters.length) continue;

      mergedFighters = mergeOrReplaceFighters(mergedFighters, fighters, 'prizepicks');
      const coverage = getUnderdogStatCoverage(mergedFighters);
      console.log(`[UFC Auto-Scrape] prizepicks API endpoint: ${url} -> fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
    } catch (e) {
      console.warn('[UFC Auto-Scrape] prizepicks API failed for endpoint:', url, e);
    }
  }

  if (mergedFighters.length) {
    store.prizepicks = { fighters: mergedFighters, capturedAt: Date.now() };
    await StorageService.setLines('prizepicks', mergedFighters);
    await archivePlatformPropLines('prizepicks', mergedFighters);
    notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform: 'prizepicks', count: mergedFighters.length });
  }

  return getUnderdogStatCoverage(mergedFighters);
}

async function waitForPlatformCapture(
  platform: keyof typeof store,
  baselineCount: number,
  baselineCapturedAt: number,
  timeoutMs: number,
  pollMs: number = 1000,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = store[platform]?.fighters?.length || 0;
    const capturedAt = store[platform]?.capturedAt || 0;
    // Count may stay flat across SS/TD tabs; capturedAt change still means new payload merged.
    if (count > baselineCount || capturedAt > baselineCapturedAt) return count;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return store[platform]?.fighters?.length || 0;
}

async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  // Fast-path: if tab already reached complete before listener registration, return immediately.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.status === 'complete') return;
  } catch {
    // Fall through to listener+timeout strategy.
  }

  await new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: any) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

async function scrapePick6UrlsConcurrently(
  urls: string[],
  expectedFighters: number,
  attemptLog: Array<{ method: 'api' | 'tab' | 'skip'; url: string; count: number }>,
): Promise<number> {
  const baselineCount = store.pick6?.fighters?.length || 0;
  const baselineCapturedAt = store.pick6?.capturedAt || 0;
  const tabs: number[] = [];
  const globalStart = Date.now();

  try {
    console.log(`[UFC Auto-Scrape] Pick6 concurrent scrape START at T=0`);

    const createdTabs = await Promise.all(
      urls.map(async (url, idx) => {
        const urlStart = Date.now();
        const tab = await chrome.tabs.create({ url, active: false });
        const tabId = tab.id ?? null;
        const createElapsed = Date.now() - urlStart;
        if (tabId != null) {
          tabs.push(tabId);
          console.log(`[UFC Auto-Scrape] Pick6 tab ${idx+1} created at T+${createElapsed}ms: ${url}`);
        }
        
        if (tabId != null) {
          const loadStart = Date.now();
          await waitForTabLoad(tabId, 3500);
          const loadElapsed = Date.now() - loadStart;
          console.log(`[UFC Auto-Scrape] Pick6 tab ${idx+1} loaded at T+${Date.now() - globalStart}ms (load took ${loadElapsed}ms)`);
          
          const settleDelayMs = url.includes('category/') ? 450 : 250;
          await new Promise((r) => setTimeout(r, settleDelayMs));
          console.log(`[UFC Auto-Scrape] Pick6 tab ${idx+1} settled at T+${Date.now() - globalStart}ms`);
        }
        return { url, tabId };
      })
    );

    for (const entry of createdTabs) {
      attemptLog.push({ method: 'tab', url: entry.url, count: 0 });
    }

    console.log(`[UFC Auto-Scrape] All Pick6 tabs created/loaded. Starting capture wait at T+${Date.now() - globalStart}ms`);

    const started = Date.now();
    let lastChangeAt = 0;
    let lastSeenCapturedAt = baselineCapturedAt;
    let lastSeenCount = baselineCount;
    let bestCount = baselineCount;
    let loopCount = 0;

    while (Date.now() - started < 12000) {
      loopCount++;
      const count = store.pick6?.fighters?.length || 0;
      const capturedAt = store.pick6?.capturedAt || 0;
      const coverage = getUnderdogStatCoverage(store.pick6?.fighters || []);

      if (count > bestCount) {
        bestCount = count;
        console.log(`[UFC Auto-Scrape] Pick6 data received at T+${Date.now() - globalStart}ms: ${count} fighters (fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount})`);
      }

      if (count > lastSeenCount || capturedAt > lastSeenCapturedAt) {
        lastSeenCount = count;
        lastSeenCapturedAt = capturedAt;
        lastChangeAt = Date.now();
      }

      if (hasEnoughPick6StatCoverage(coverage, expectedFighters)) {
        console.log(`[UFC Auto-Scrape] pick6 concurrent coverage complete at T+${Date.now() - globalStart}ms: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
        break;
      }

      const elapsedMs = Date.now() - started;
      const receivedAnyPayload = count > baselineCount || capturedAt > baselineCapturedAt;
      const quietLongEnough = receivedAnyPayload && lastChangeAt > 0 && (Date.now() - lastChangeAt >= 1500);
      // Only early-exit if we have multi-stat coverage — never on SS-only data
      const hasMultiStatCoverage = coverage.fpCount >= 4 || coverage.tdCount >= 4;
      const enoughDataEarly = hasMultiStatCoverage && count >= 9 && elapsedMs >= 3000;
      const quietExitAllowed = elapsedMs >= 4000 && count >= 7 && hasMultiStatCoverage;
      if ((quietLongEnough && quietExitAllowed) || enoughDataEarly) {
        console.log(`[UFC Auto-Scrape] pick6 concurrent scrape settled at T+${Date.now() - globalStart}ms (${loopCount} loops): fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount} (${enoughDataEarly ? 'early exit' : 'quiet time'})`);
        break;
      }

      await new Promise((r) => setTimeout(r, 220));
    }

    const finalCount = store.pick6?.fighters?.length || bestCount;
    for (const entry of attemptLog) {
      if (entry.method === 'tab') entry.count = finalCount;
    }
    return finalCount;
  } finally {
    await Promise.all(
      tabs.map(async (tabId) => {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          // already closed
        }
      })
    );
  }
}

async function scrapePick6ActiveFallback(
  urls: string[],
  baselineCount: number,
  baselineCapturedAt: number,
  attemptLog: Array<{ method: 'api' | 'tab' | 'skip'; url: string; count: number }>,
): Promise<number> {
  for (const url of urls) {
    let tabId: number | null = null;
    try {
      const tab = await chrome.tabs.create({ url, active: true });
      tabId = tab.id ?? null;
      if (tabId == null) continue;

      await waitForTabLoad(tabId, 18000);
      await new Promise((r) => setTimeout(r, 2200));

      // Force reinjection in case auto content-script injection missed this tab lifecycle.
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['dist/content.js'],
        });
      } catch {
        // If reinjection fails, continue and rely on existing injected script.
      }

      const count = await waitForPlatformCapture('pick6', baselineCount, baselineCapturedAt, 20000, 900);
      attemptLog.push({ method: 'tab', url: `${url} [active-fallback]`, count });
      if (count > 0) return count;
    } catch (error) {
      attemptLog.push({ method: 'tab', url: `${url} [active-fallback]`, count: 0 });
      console.error('[UFC Auto-Scrape] Pick6 active fallback failed:', url, error);
    } finally {
      if (tabId != null) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          // already closed
        }
      }
    }
  }
  return store.pick6?.fighters?.length || 0;
}

async function autoScrapeAllPlatforms(): Promise<any> {
  if (autoScrapeInProgress) {
    return { status: 'already_running' };
  }

  autoScrapeInProgress = true;
  const autoScrapeStart = Date.now();
  console.log(`[UFC Auto-Scrape] AUTO-SCRAPE STARTED at T=0`);
  const results: Record<string, number> = {};
  const attempts: Record<string, { method: 'api' | 'tab' | 'skip'; url: string; count: number }[]> = {};
  let expectedUnderdogFighters = 20;

  try {
    // Betr lines are entered manually (not auto-scraped) — do not clear them here.

    try {
      const card = await fetchUpcomingUFCCard();
      if (card?.fighters?.length) {
        expectedUnderdogFighters = Math.max(12, card.fighters.length * 2);
      }
    } catch {
      // Keep default expectation if card lookup fails.
    }

    const orderedPlatforms: Array<keyof typeof AUTO_SCRAPE_URLS> = ['underdog', 'pick6', 'prizepicks', 'draftkings_sportsbook'];
    
    // Run all platforms in parallel
    await Promise.all(orderedPlatforms.map(async (platform) => {
      // Clear this platform individually right before fetching so stale data doesn't leak,
      // while leaving all OTHER platforms' stored lines intact so the analyzer always
      // has the most complete combined view available.
      store[platform] = null;
      try { await chrome.storage.local.remove([`lines_${platform}`]); } catch { /* ok */ }

      const urls = AUTO_SCRAPE_URLS[platform];
      let bestCount = 0;
      attempts[platform] = [];

      // Underdog is most reliable through API; only fall back to tabs if API returns no fighters.
      if (platform === 'underdog') {
        const api = await fetchUnderdogFromBackground();
        attempts[platform].push({ method: 'api', url: `CONFIG.api.underdog (fp=${api.fpCount}, ss=${api.ssCount}, td=${api.tdCount}, all3=${api.allThreeCount})`, count: api.total });
        if (api.total > bestCount) bestCount = api.total;
        const hasGoodBreadth = api.total >= Math.max(12, Math.floor(expectedUnderdogFighters * 0.55));
        const hasEnoughCoverage = hasEnoughUnderdogStatCoverage(api, expectedUnderdogFighters);
        if (api.total > 0 && (hasEnoughCoverage || hasGoodBreadth)) {
          results[platform] = bestCount;
          return;
        }
      }

      // PrizePicks is more reliable through API than UI chips in background tabs.
      if (platform === 'prizepicks') {
        const api = await fetchPrizePicksFromBackground();
        attempts[platform].push({ method: 'api', url: `api.prizepicks.com/projections (fp=${api.fpCount}, ss=${api.ssCount}, td=${api.tdCount}, all3=${api.allThreeCount})`, count: api.total });
        if (api.total > bestCount) bestCount = api.total;
        if (api.total > 0) {
          results[platform] = bestCount;
          return;
        }
      }

      if (platform === 'pick6') {
        const shouldAttempt = await shouldAttemptPick6Scrape();
        if (!shouldAttempt) {
          attempts[platform].push({ method: 'skip', url: 'pick6 skipped: props likely not posted yet', count: 0 });
          results[platform] = 0;
          return;
        }
      }

      const uniqueUrlsAll = Array.from(new Set(urls));
      const uniqueUrls = platform === 'underdog' ? uniqueUrlsAll.slice(0, 2) : uniqueUrlsAll;

      if (platform === 'pick6') {
        const pick6Start = Date.now();
        try {
          console.log(`[UFC Auto-Scrape] Starting Pick6 concurrent fetch at T+${pick6Start - (autoScrapeStart || pick6Start)}ms`);
          bestCount = await scrapePick6UrlsConcurrently(uniqueUrls, expectedUnderdogFighters, attempts[platform]);
          if (bestCount === 0) {
            console.warn('[UFC Auto-Scrape] Pick6 concurrent scrape returned 0 fighters. Running active-tab fallback...');
            const baselineCount = store.pick6?.fighters?.length || 0;
            const baselineCapturedAt = store.pick6?.capturedAt || 0;
            bestCount = await scrapePick6ActiveFallback(uniqueUrls, baselineCount, baselineCapturedAt, attempts[platform]);
          }
          const pick6Elapsed = Date.now() - pick6Start;
          console.log(`[UFC Auto-Scrape] pick6 concurrent result: ${bestCount} fighters (took ${pick6Elapsed}ms)`);
        } catch (error) {
          uniqueUrls.forEach((url) => attempts[platform].push({ method: 'tab', url, count: 0 }));
          console.error('[UFC Auto-Scrape] Error scraping pick6 concurrently:', error);
        }
        results[platform] = bestCount;
        return;
      }

      for (const url of uniqueUrls) {
        if (platform === 'underdog') {
          const currentCoverage = getUnderdogStatCoverage(store.underdog?.fighters || []);
          if (hasEnoughUnderdogStatCoverage(currentCoverage, expectedUnderdogFighters)) {
            console.log(`[UFC Auto-Scrape] underdog coverage complete early: fighters=${currentCoverage.total}, fp=${currentCoverage.fpCount}, ss=${currentCoverage.ssCount}, td=${currentCoverage.tdCount}, all3=${currentCoverage.allThreeCount}`);
            break;
          }
        } else if (platform === 'prizepicks') {
          const ppCoverage = getUnderdogStatCoverage(store.prizepicks?.fighters || []);
          if (hasEnoughPrizePicksStatCoverage(ppCoverage, expectedUnderdogFighters)) {
            console.log(`[UFC Auto-Scrape] prizepicks coverage complete early: fighters=${ppCoverage.total}, fp=${ppCoverage.fpCount}, ss=${ppCoverage.ssCount}, td=${ppCoverage.tdCount}, all3=${ppCoverage.allThreeCount}`);
            break;
          }
        }

        let tabId: number | null = null;
        try {
          const baselineCount = store[platform]?.fighters?.length || 0;
          const baselineCapturedAt = store[platform]?.capturedAt || 0;
          const tab = await chrome.tabs.create({ url, active: false });
          tabId = tab.id ?? null;

          if (tabId != null) {
            const loadTimeoutMs = platform === 'underdog' ? 9000 : platform === 'draftkings_sportsbook' ? 12000 : 15000;
            await waitForTabLoad(tabId, loadTimeoutMs);
          }

          const settleDelayMs = platform === 'underdog' ? 900 : platform === 'draftkings_sportsbook' ? 2500 : 1500;
          await new Promise((r) => setTimeout(r, settleDelayMs));

          let count = 0;

          if (platform === 'draftkings_sportsbook' && tabId != null) {
            try {
              const injected = await chrome.scripting.executeScript({
                target: { tabId },
                func: async () => {
                  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
                  const out: Record<string, any> = {};
                  const href = (window.location.href || '').toLowerCase();
                  const preferSS = href.includes('subcategory=significant-strikes-o-u');
                  const preferTD = href.includes('subcategory=takedowns-landed-o-u');
                  const preferFT = href.includes('subcategory=fight-time-o-u') || href.includes('subcategory=fight-time');

                  const ensure = (name: string) => {
                    if (!out[name]) {
                      out[name] = {
                        name,
                        line_fp: null,
                        line_ss: null,
                        line_td: null,
                        line_ft: null,
                        ss_over_odds: null,
                        ss_under_odds: null,
                        td_over_odds: null,
                        td_under_odds: null,
                        ft_over_odds: null,
                        ft_under_odds: null,
                      };
                    }
                    return out[name];
                  };

                  for (let i = 0; i < 4; i++) {
                    window.scrollTo(0, document.body.scrollHeight);
                    await sleep(450);
                  }
                  window.scrollTo(0, 0);
                  await sleep(700);

                  const pageText = document.body?.innerText || '';
                  const allEls = Array.from(document.querySelectorAll('span, td, div, p, button, li'));

                  allEls.forEach((el) => {
                    if ((el as HTMLElement).children.length > 0) return;
                    const text = (((el as HTMLElement).innerText || el.textContent || '') + '').trim();
                    if (!text) return;

                    const ssMatch = text.match(/^(.+?)\s+(?:Total\s+)?Significant\s+Strikes?(?:\s+Landed)?(?:\s+O\/U)?$/i);
                    const tdMatch = text.match(/^(.+?)\s+(?:Total\s+)?Takedowns?(?:\s+Landed)?(?:\s+O\/U)?$/i);
                    const ftMatch = text.match(/^(.+?)\s+Fight\s+Time(?:\s*\(Mins?\))?(?:\s+O\/U)?$/i);
                    if (!ssMatch && !tdMatch && !ftMatch) return;

                    const name = (ssMatch ? ssMatch[1] : tdMatch ? tdMatch[1] : ftMatch![1]).trim();
                    if (!name || name.length < 3) return;

                    let container: HTMLElement = el as HTMLElement;
                    for (let j = 0; j < 15; j++) {
                      if (!container.parentElement) break;
                      container = container.parentElement;
                      const t = container.innerText || '';

                      const over = t.match(/Over\s+([\d.]+)\s*([+-]?\d{2,4})?/i);
                      if (!over) continue;
                      const line = parseFloat(over[1]);
                      const overOdds = over[2] ? parseInt(over[2], 10) : null;
                      const under = t.match(/Under\s+[\d.]+\s*([+-]?\d{2,4})?/i);
                      const underOdds = under && under[1] ? parseInt(under[1], 10) : null;

                      if (ssMatch && Number.isFinite(line) && line > 0 && line < 200) {
                        const f = ensure(name);
                        f.line_ss = line;
                        if (overOdds != null) f.ss_over_odds = overOdds;
                        if (underOdds != null) f.ss_under_odds = underOdds;
                        break;
                      }
                      if (tdMatch && Number.isFinite(line) && line >= 0 && line < 20) {
                        const f = ensure(name);
                        f.line_td = line;
                        if (overOdds != null) f.td_over_odds = overOdds;
                        if (underOdds != null) f.td_under_odds = underOdds;
                        break;
                      }
                      if (ftMatch && Number.isFinite(line) && line > 0 && line <= 30) {
                        const f = ensure(name);
                        f.line_ft = line;
                        if (overOdds != null) f.ft_over_odds = overOdds;
                        if (underOdds != null) f.ft_under_odds = underOdds;
                        break;
                      }
                    }
                  });

                  if (!Object.keys(out).length && pageText) {
                    const ssRegex = /([A-Z][a-zA-Z\s'\-]{2,40})\s+(?:Total\s+)?Significant\s+Strikes?(?:\s+Landed)?(?:\s+O\/U)?[\s\S]{0,220}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,150}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
                    const tdRegex = /([A-Z][a-zA-Z\s'\-]{2,40})\s+(?:Total\s+)?Takedowns?(?:\s+Landed)?(?:\s+O\/U)?[\s\S]{0,220}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,150}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
                    const ftRegex = /([A-Z][a-zA-Z\s'\-]{2,40})\s+Fight\s+Time(?:\s*\(Mins?\))?(?:\s+O\/U)?[\s\S]{0,220}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,150}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
                    let m: RegExpExecArray | null;
                    while ((m = ssRegex.exec(pageText)) !== null) {
                      const name = m[1].trim();
                      const line = parseFloat(m[2]);
                      if (!name || !Number.isFinite(line) || line < 4 || line >= 220) continue;
                      const f = ensure(name);
                      f.line_ss = line;
                      if (m[3]) f.ss_over_odds = parseInt(m[3], 10);
                      if (m[4]) f.ss_under_odds = parseInt(m[4], 10);
                    }
                    while ((m = tdRegex.exec(pageText)) !== null) {
                      const name = m[1].trim();
                      const line = parseFloat(m[2]);
                      if (!name || !Number.isFinite(line) || line < 0 || line >= 20) continue;
                      const f = ensure(name);
                      f.line_td = line;
                      if (m[3]) f.td_over_odds = parseInt(m[3], 10);
                      if (m[4]) f.td_under_odds = parseInt(m[4], 10);
                    }
                    while ((m = ftRegex.exec(pageText)) !== null) {
                      const name = m[1].trim();
                      const line = parseFloat(m[2]);
                      if (!name || !Number.isFinite(line) || line <= 0 || line > 30) continue;
                      const f = ensure(name);
                      f.line_ft = line;
                      if (m[3]) f.ft_over_odds = parseInt(m[3], 10);
                      if (m[4]) f.ft_under_odds = parseInt(m[4], 10);
                    }

                    // Subcategory-aware generic fallback for pages where prop label wording changes.
                    if (!Object.keys(out).length && (preferSS || preferTD || preferFT)) {
                      const genericRegex = /([A-Z][a-zA-Z\s'\-]{2,40})[\s\S]{0,120}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,120}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
                      while ((m = genericRegex.exec(pageText)) !== null) {
                        const name = m[1].trim();
                        const line = parseFloat(m[2]);
                        if (!name || !Number.isFinite(line)) continue;
                        const f = ensure(name);
                        if (preferSS && line >= 4 && line < 220) {
                          f.line_ss = line;
                          if (m[3]) f.ss_over_odds = parseInt(m[3], 10);
                          if (m[4]) f.ss_under_odds = parseInt(m[4], 10);
                        } else if (preferTD && line >= 0 && line < 20) {
                          f.line_td = line;
                          if (m[3]) f.td_over_odds = parseInt(m[3], 10);
                          if (m[4]) f.td_under_odds = parseInt(m[4], 10);
                        } else if (preferFT && line > 0 && line <= 30) {
                          f.line_ft = line;
                          if (m[3]) f.ft_over_odds = parseInt(m[3], 10);
                          if (m[4]) f.ft_under_odds = parseInt(m[4], 10);
                        }
                      }
                    }
                  }

                  return {
                    fighters: Object.values(out).filter((f: any) => f.line_ss != null || f.line_td != null || f.line_ft != null),
                    debug: {
                      pageTextLen: pageText.length,
                      hasSS: /Significant\s+Strikes/i.test(pageText),
                      hasTD: /Takedowns?/i.test(pageText),
                      hasFT: /Fight\s+Time/i.test(pageText),
                      preferSS,
                      preferTD,
                      preferFT,
                    },
                  };
                },
              });

              const payload = injected?.[0]?.result as any;
              const directFighters = Array.isArray(payload?.fighters) ? payload.fighters : [];
              console.log(`[UFC Auto-Scrape] DraftKings direct scrape debug:`, payload?.debug || {});

              if (directFighters.length > 0) {
                await handleLinesCaptured('draftkings_sportsbook', { fighters: directFighters });
                count = store.draftkings_sportsbook?.fighters?.length || directFighters.length;
              }
            } catch (e) {
              console.warn('[UFC Auto-Scrape] DraftKings direct scrape injection failed:', e);
            }
          }

          if (count === 0) {
            const timeoutMs = platform === 'underdog' ? 7000 : 30000;
            count = await waitForPlatformCapture(
              platform as keyof typeof store,
              baselineCount,
              baselineCapturedAt,
              timeoutMs,
              1000,
            );
          }

          attempts[platform].push({ method: 'tab', url, count });
          if (count > bestCount) bestCount = count;
          console.log(`[UFC Auto-Scrape] ${platform} via ${url}: ${count} fighters`);

          if (platform === 'underdog') {
            const coverage = getUnderdogStatCoverage(store.underdog?.fighters || []);
            console.log(`[UFC Auto-Scrape] underdog coverage after tab: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
            if (hasEnoughUnderdogStatCoverage(coverage, expectedUnderdogFighters)) {
              break;
            }
          } else if (platform === 'prizepicks') {
            const coverage = getUnderdogStatCoverage(store.prizepicks?.fighters || []);
            console.log(`[UFC Auto-Scrape] prizepicks coverage after tab: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
            if (hasEnoughPrizePicksStatCoverage(coverage, expectedUnderdogFighters)) {
              break;
            }
          }
        } catch (error) {
          attempts[platform].push({ method: 'tab', url, count: 0 });
          console.error(`[UFC Auto-Scrape] Error scraping ${platform} via URL:`, url, error);
        } finally {
          if (tabId != null) {
            try {
              await chrome.tabs.remove(tabId);
            } catch {
              // already closed
            }
          }
        }
      }
      results[platform] = bestCount;
    }));
  } finally {
    const totalElapsed = Date.now() - autoScrapeStart;
    console.log(`[UFC Auto-Scrape] AUTO-SCRAPE COMPLETE in ${totalElapsed}ms. Results: ${Object.entries(results).map(([p, c]) => `${p}=${c}`).join(', ')}`);
    autoScrapeInProgress = false;
    await refreshFightOddsFromBestFightOdds('auto-scrape');
  }

  return { status: 'done', results, attempts };
}

interface UpcomingCardFighter {
  f1: string;
  f2: string;
}

interface UpcomingCardCache {
  event: string;
  date: string;
  url: string;
  fighters: UpcomingCardFighter[];
  fetchedAt: number;
}

function parseEventDateMs(raw: string | null | undefined): number {
  if (!raw) return NaN;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : NaN;
}

function isCardDateUsable(raw: string | null | undefined): boolean {
  const ts = parseEventDateMs(raw);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  // Accept event dates up to 6 hours after the event start to cover same-night use,
  // but ensure the day-after the event properly expires the cache.
  return ts >= now - 6 * 60 * 60 * 1000;
}

async function fetchUpcomingUFCCard(forceRefresh = false): Promise<UpcomingCardCache | null> {
  const hit = await StorageService.getUpcomingCard();
  if (!forceRefresh && hit && hit.fetchedAt && Date.now() - hit.fetchedAt < 2 * 60 * 60 * 1000 && isCardDateUsable(hit.date)) {
    // If the cached event is more than 10 days away, bust the cache to check for a closer event
    const cachedTs = parseEventDateMs(hit.date);
    const tenDays = 10 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(cachedTs) && cachedTs - Date.now() < tenDays) {
      return hit as UpcomingCardCache;
    }
  }

  try {
    const res = await fetch(CONFIG.api.ufcstats.upcoming);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const events: Array<{ name: string; date: string; url: string; ts: number }> = [];
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rowM of rows) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
      const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
      if (!linkM || !nameM || !dateM) continue;
      const ts = parseEventDateMs(dateM[0]);
      if (!Number.isFinite(ts)) continue;
      events.push({ name: nameM[1].trim(), date: dateM[0], url: linkM[1], ts });
    }
    if (!events.length) return null;

    const now = Date.now();
    // Only consider truly upcoming events — exclude past events so a completed card
    // (e.g. UFC London the day after) doesn't shadow the next real card.
    const futureish = events.filter((e) => e.ts >= now);
    const pool = futureish.length ? futureish : events;
    pool.sort((a, b) => a.ts - b.ts);
    const nextEvent = pool[0];

    // Also cache the most recently completed event (within 14 days) for report card ordering
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const recentPast = events
      .filter((e) => e.ts < now && e.ts >= now - fourteenDays)
      .sort((a, b) => b.ts - a.ts);
    if (recentPast.length) {
      const lastEvent = recentPast[0];
      try {
        const lastRes = await fetch(lastEvent.url);
        if (lastRes.ok) {
          const lastHtml = await lastRes.text();
          const lastFighters: UpcomingCardFighter[] = [];
          const lastRows = [...lastHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
          for (const rowM of lastRows) {
            const row = rowM[1];
            if (row.includes('<th')) continue;
            const nameLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
            if (nameLinks.length < 2) continue;
            const f1 = nameLinks[0][1].trim();
            const f2 = nameLinks[1][1].trim();
            if (!f1 || !f2 || f1 === '--' || f2 === '--') continue;
            lastFighters.push({ f1, f2 });
          }
          if (lastFighters.length) {
            await StorageService.setLastCompletedCard({
              event: lastEvent.name, date: lastEvent.date, url: lastEvent.url,
              fighters: lastFighters, fetchedAt: Date.now(),
            });
          }
        }
      } catch { /* non-fatal */ }
    }

    const evRes = await fetch(nextEvent.url);
    if (!evRes.ok) throw new Error(`Event HTTP ${evRes.status}`);
    const evHtml = await evRes.text();

    const fighters: UpcomingCardFighter[] = [];
    const fightRows = [...evHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rowM of fightRows) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const nameLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
      if (nameLinks.length < 2) continue;
      const f1 = nameLinks[0][1].trim();
      const f2 = nameLinks[1][1].trim();
      if (!f1 || !f2 || f1 === '--' || f2 === '--') continue;
      fighters.push({ f1, f2 });
    }

    const card: UpcomingCardCache = {
      event: nextEvent.name,
      date: nextEvent.date,
      url: nextEvent.url,
      fighters,
      fetchedAt: Date.now(),
    };
    await StorageService.setUpcomingCard(card);
    schedulePostEventAlarm(card);
    return card;
  } catch (e) {
    console.error('[UFC] fetchUpcomingUFCCard failed:', e);
    return null;
  }
}

// ── FIND CARD FOR LOADED FIGHTERS ────────────────────────────────────────
// Searches both UFCStats upcoming and completed events for one whose fighters
// overlap with the provided names array. Used by report card when cached card
// doesn't match the event whose lines are currently loaded.
async function findCardForFighters(names: string[]): Promise<UpcomingCardCache | null> {
  const nameSet = new Set(names.map(n => n.toLowerCase().replace(/[^a-z ]/g, '')));
  const parseFighters = (html: string): UpcomingCardFighter[] => {
    const result: UpcomingCardFighter[] = [];
    for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const links = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
      if (links.length < 2) continue;
      const f1 = links[0][1].trim();
      const f2 = links[1][1].trim();
      if (!f1 || !f2 || f1 === '--' || f2 === '--') continue;
      result.push({ f1, f2 });
    }
    return result;
  };
  const parseEventList = (html: string) => {
    const evts: Array<{ name: string; date: string; url: string; ts: number }> = [];
    for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
      const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
      if (!linkM || !nameM || !dateM) continue;
      const ts = parseEventDateMs(dateM[0]);
      if (!Number.isFinite(ts)) continue;
      evts.push({ name: nameM[1].trim(), date: dateM[0], url: linkM[1], ts });
    }
    return evts;
  };
  const overlaps = (fighters: UpcomingCardFighter[]) => {
    let count = 0;
    for (const { f1, f2 } of fighters) {
      if (nameSet.has(f1.toLowerCase().replace(/[^a-z ]/g, '')) ||
          nameSet.has(f2.toLowerCase().replace(/[^a-z ]/g, ''))) count++;
    }
    return count >= Math.ceil(fighters.length * 0.4);
  };
  try {
    const sources = [
      'http://www.ufcstats.com/statistics/events/upcoming?page=all',
      'http://www.ufcstats.com/statistics/events/completed?page=1',
    ];
    for (const src of sources) {
      const res = await fetch(src);
      if (!res.ok) continue;
      const html = await res.text();
      const evts = parseEventList(html);
      // Check most recent events first (completed page is reverse-chronological)
      const sorted = evts.slice().sort((a, b) => Math.abs(Date.now() - a.ts) - Math.abs(Date.now() - b.ts));
      for (const evt of sorted.slice(0, 8)) {
        try {
          const evRes = await fetch(evt.url);
          if (!evRes.ok) continue;
          const evHtml = await evRes.text();
          const fighters = parseFighters(evHtml);
          if (fighters.length >= 6 && overlaps(fighters)) {
            const card: UpcomingCardCache = {
              event: evt.name, date: evt.date, url: evt.url,
              fighters, fetchedAt: Date.now(),
            };
            await StorageService.setLastCompletedCard(card);
            return card;
          }
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    console.error('[UFC] findCardForFighters failed:', e);
  }
  return null;
}

// ── POST-EVENT ALARM ────────────────────────────────────────────────────

function schedulePostEventAlarm(card: UpcomingCardCache): void {
  const eventTs = parseEventDateMs(card.date);
  if (!Number.isFinite(eventTs)) return;

  // Don't schedule alarms for events more than 14 days away — the card detector
  // sometimes picks up a future event (e.g. Della Maddalena vs Prates) when the
  // sportsbooks post lines early. We only want alarms for the truly next event.
  const msUntilEvent = eventTs - Date.now();
  if (msUntilEvent > 14 * 24 * 60 * 60 * 1000) {
    console.log(`[UFC Settle] Skipping alarm — "${card.event}" is more than 14 days away`);
    return;
  }

  const now = Date.now();

  // ── Live settle: poll UFCStats every 5 min from event start for 8 hours ──
  // UFCStats posts each fight as it completes, so this grades fights in real time.
  const liveEndTs = eventTs + 8 * 60 * 60 * 1000; // event start + 8h
  if (now < liveEndTs) {
    // Start polling at event time (or immediately if event already started)
    const liveStartTs = Math.max(now + 60000, eventTs); // at least 1 min from now
    chrome.alarms.create(LIVE_SETTLE_ALARM, { when: liveStartTs, periodInMinutes: 5 });
    console.log(`[UFC Settle] Live alarm scheduled from ${new Date(liveStartTs).toISOString()} every 5 min for "${card.event}"`);
  } else {
    // Event window already passed — attempt settle immediately (non-blocking)
    console.log(`[UFC Settle] Event "${card.event}" already past, attempting settle now`);
    fetchAndSettleFromUFCStats().then(({ settled }) => {
      if (settled > 0) notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled });
    }).catch(() => {});
  }

  // ── Post-event settle: one final pass 28h after event start ──
  // Ensures any stats UFCStats posts late (corrections, slow events) get captured.
  const alarmTs = eventTs + 28 * 60 * 60 * 1000;
  if (alarmTs > now) {
    chrome.alarms.create(POST_EVENT_SETTLE_ALARM, { when: alarmTs });
    console.log(`[UFC Settle] Post-event alarm set for ${new Date(alarmTs).toISOString()} ("${card.event}")`);
  }
}

async function runSettle(): Promise<void> {
  const { settled, errors } = await fetchAndSettleFromUFCStats();
  if (settled > 0) {
    console.log(`[UFC Settle] Settled ${settled} record(s)`);
    notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled });
  }
  if (errors.length) console.log(`[UFC Settle] Errors: ${errors.join(', ')}`);
  // Backfill propagates results to any related unresolved rows
  const { changed } = await PropArchiveService.backfillUnresolvedFromKnownOutcomes({ minHoursBetweenRuns: 0 });
  if (changed > 0) {
    console.log(`[UFC Settle] Backfill: ${changed} additional records resolved`);
    notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled: changed });
  }
}

// Fire when the scheduled post-event or live alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LIVE_SETTLE_ALARM) {
    console.log('[UFC Settle] Live alarm fired — checking UFCStats for new results...');
    // Stop the live alarm once we're past the 8h event window
    const raw = chrome.storage.local.get(['upcoming_ufc_card'], (res) => {
      const card = res?.upcoming_ufc_card as UpcomingCardCache | undefined;
      const eventTs = card?.date ? parseEventDateMs(card.date) : NaN;
      if (Number.isFinite(eventTs) && Date.now() > eventTs + 8 * 60 * 60 * 1000) {
        chrome.alarms.clear(LIVE_SETTLE_ALARM);
        console.log('[UFC Settle] Live alarm window ended — alarm cleared');
      }
    });
    void raw; // suppress unused var
    runSettle().catch(e => console.error('[UFC Settle] Live settle error:', e));
    return;
  }

  if (alarm.name === POST_EVENT_SETTLE_ALARM) {
    console.log('[UFC Settle] Post-event alarm fired — final settle pass from UFCStats...');
    // Cancel live alarm — post-event alarm takes over
    chrome.alarms.clear(LIVE_SETTLE_ALARM);
    runSettle().catch(e => console.error('[UFC Settle] Post-event settle error:', e));
  }
});

// ── NOTIFY ANALYZER TABS ───────────────────────────────────────────────

function notifyAnalyzerTabs(msg: any): void {
  const analyzerUrl = chrome.runtime.getURL('analyzer.html');
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.url) return;
      if (tab.url === analyzerUrl || tab.url.startsWith(analyzerUrl)) {
        chrome.tabs.sendMessage(tab.id!, msg).catch(() => {});
      }
    });
  });
}


// Export for testing
(globalThis as any).ufc_data = {
  store,
};
