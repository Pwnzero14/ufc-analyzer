import {
  StorageService,
  ScraperService,
  PropArchiveService,
} from './services/index.js';
import {
  AllLines,
  PropArchiveRecord,
  WeightClass,
} from './types/index.js';
import { CONFIG, FANTASY_SCORING, PRIZEPICKS_SCORING, NAME_ALIASES } from './config/index.js';
import { ufcstatsFetchText } from './services/ufcstats-fetch.js';

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
  n = n.replace(/\./g, '').replace(/-/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ');
  n = n
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
  // BestFightOdds renders single-word fighter names (Sumudaerji, Aoriqileng, etc.)
  // as "Name Name" in their markup. De-dupe so the analyzer's NAME_ALIASES map
  // (keyed on the single-word form) resolves to the canonical name.
  const parts = n.split(' ');
  if (parts.length === 2 && parts[0] === parts[1] && parts[0].length >= 4) {
    n = parts[0];
  }
  return n || null;
}

function parseBestFightOddsMoneylines(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rowRe = /<tr[^>]*>\s*<th[^>]*>\s*<a[^>]*href="\/fighters\/[^"]+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>\s*<\/th>([\s\S]*?)<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(html))) {
    const fighterName = normalizeOddsName(match[1]);
    if (!fighterName) continue;

    // Match only the current-odds spans (id="oID...") to avoid stale/non-ML values
    const odds = [...match[2].matchAll(/id="oID[^"]*">([+-]\d{2,4})</g)]
      .map((m) => Number(m[1]))
      .filter((v) => Number.isFinite(v));
    if (!odds.length) {
      // Fallback: any odds-shaped value in the row
      const fallback = [...match[2].matchAll(/>([+-]\d{2,4})</g)]
        .map((m) => Number(m[1]))
        .filter((v) => Number.isFinite(v));
      if (!fallback.length) continue;
      odds.push(...fallback);
    }

    // Use median instead of mean — more robust when some books haven't moved their line yet
    const sorted = [...odds].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    out[fighterName] = median;
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
// Event: UFC 327 — April 11, 2026
// IMPORTANT: update BETR_EVENT_DATE below whenever you update the fighter list.
// If the event date is in the past, this function refuses to seed and wipes any
// leftover stale Betr data — that's how RESET LINES survives a Chrome restart.
const BETR_EVENT_DATE = '2026-04-18';
async function initializeBetrLines() {
  // Staleness gate: if the seed's event has already happened, don't re-seed.
  // Wipe any existing Betr storage so the next analyzer load starts clean.
  const seedEventMs = new Date(`${BETR_EVENT_DATE}T23:59:59`).getTime();
  if (Number.isFinite(seedEventMs) && Date.now() > seedEventMs) {
    try {
      await new Promise<void>((res) =>
        chrome.storage.local.remove(['lines_betr', 'betr_seed_hash', 'betr_event_date'], () => res())
      );
      store.betr = { fighters: [], capturedAt: Date.now() };
      console.log(`[UFC] Betr seed skipped — event date ${BETR_EVENT_DATE} is past. Cleared stale lines_betr (manual overrides preserved).`);
    } catch (error) {
      console.error('[UFC] Failed to clear stale Betr lines:', error);
    }
    return;
  }

  // Skip the hardcoded seed if user already has manual Betr data.
  // The seed was for an earlier workflow; user now enters lines via screenshots.
  try {
    const existing = await new Promise<Record<string, any>>((res) =>
      chrome.storage.local.get(['lines_betr_manual_v1'], res)
    );
    const manualCount = existing?.lines_betr_manual_v1?.fighters?.length || 0;
    if (manualCount > 0) {
      const manual = existing.lines_betr_manual_v1;
      store.betr = { fighters: manual.fighters, capturedAt: manual.capturedAt || Date.now() };
      console.log(`[UFC] Betr seed skipped — user has ${manualCount} manual rows. Preserved.`);
      return;
    }
  } catch (error) {
    console.error('[UFC] Failed to check manual Betr data:', error);
  }

  const betrFighters = [
    // SS + FP
    { name: 'C. Radtke',      opponent: 'F. Prado',       line_ss: 32.5, line_fp: 81.5,  line_td: null },
    { name: 'K. Gastelum',    opponent: 'V. Luque',       line_ss: 50.5, line_fp: 89.5,  line_td: null },
    { name: 'V. Luque',       opponent: 'K. Gastelum',    line_ss: 40.5, line_fp: 50.5,  line_td: null },
    { name: 'M. Gamrot',      opponent: 'E. Ribovics',    line_ss: 45.5, line_fp: 85.5,  line_td: null },
    { name: 'A. Pico',        opponent: 'P. Pitbull',     line_ss: 41.5, line_fp: 90.5,  line_td: null },
    { name: 'P. Pitbull',     opponent: 'A. Pico',        line_ss: 30.5, line_fp: 50.5,  line_td: null },
    { name: 'A. Murzakanov',  opponent: 'P. Costa',       line_ss: 50.5, line_fp: 87.5,  line_td: null },

    // SS only
    { name: 'F. Prado',       opponent: 'C. Radtke',      line_ss: 32.5, line_fp: null,  line_td: null },
    { name: 'T. Suarez',      opponent: 'L. Godinez',     line_ss: 30.5, line_fp: null,  line_td: null },
    { name: 'L. Godinez',     opponent: 'T. Suarez',      line_ss: 28.5, line_fp: null,  line_td: null },
    { name: 'E. Ribovics',    opponent: 'M. Gamrot',      line_ss: 53.5, line_fp: null,  line_td: null },
    { name: 'K. Holland',     opponent: 'R. Brown',       line_ss: 50.5, line_fp: null,  line_td: null },
    { name: 'R. Brown',       opponent: 'K. Holland',     line_ss: 50.5, line_fp: null,  line_td: null },
    { name: 'C. Swanson',     opponent: 'N. Landwehr',    line_ss: 64.5, line_fp: null,  line_td: null },
    { name: 'N. Landwehr',    opponent: 'C. Swanson',     line_ss: 63.5, line_fp: null,  line_td: null },
    { name: 'D. Reyes',       opponent: 'J. Walker',      line_ss: 25.5, line_fp: null,  line_td: null },
    { name: 'J. Walker',      opponent: 'D. Reyes',       line_ss: 20.5, line_fp: null,  line_td: null },
    { name: 'J. Hokit',       opponent: 'C. Blaydes',     line_ss: 26.5, line_fp: null,  line_td: null },
    { name: 'C. Blaydes',     opponent: 'J. Hokit',       line_ss: 25.5, line_fp: null,  line_td: null },
    { name: 'P. Costa',       opponent: 'A. Murzakanov',  line_ss: 52.5, line_fp: null,  line_td: null },
    { name: 'C. Ulberg',      opponent: 'J. Procházka',   line_ss: 59.5, line_fp: null,  line_td: null },
    { name: 'J. Procházka',   opponent: 'C. Ulberg',      line_ss: 57.5, line_fp: null,  line_td: null },
  ];
  
  store.betr = {
    fighters: betrFighters,
    capturedAt: Date.now(),
  };

  // Deterministic fingerprint of the seed — only changes when the hardcoded
  // fighter list is updated for a new event.  The analyzer uses this to detect
  // stale betr baselines in lines_open_v1 and clear them.
  const betrSeedHash = betrFighters.map(f => f.name).sort().join('|');

  // Persist to Chrome storage — write lines + seed hash + event date atomically
  // so the analyzer never sees a new hash with old data or vice-versa.
  try {
    await new Promise<void>((res) =>
      chrome.storage.local.set({ betr_seed_hash: betrSeedHash, betr_event_date: BETR_EVENT_DATE }, () => res())
    );
    await StorageService.setLines('betr', betrFighters);
    await archivePlatformPropLines('betr', betrFighters);

    console.log('[UFC] Initialized and persisted Betr lines:', betrFighters.length, 'fighters, event:', BETR_EVENT_DATE, 'seedHash:', betrSeedHash.substring(0, 40));
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
  } else if (request.type === 'PICK6_PICK_GROUP_DETECTED') {
    // Cache the pickGroup so auto-fetch can construct working URLs (the bare /category/N URLs
    // redirect to the DK homepage without pickGroup). Updates only if changed to avoid noise.
    const pg = String(request.pickGroup || '').trim();
    if (pg && /^\d+$/.test(pg)) {
      chrome.storage.local.get(['pick6_active_pick_group'], (res) => {
        if (res?.pick6_active_pick_group !== pg) {
          chrome.storage.local.set({ pick6_active_pick_group: pg }, () => {
            console.log(`[UFC] Cached Pick6 pickGroup=${pg} from ${request.url}`);
          });
        }
      });
    }
  } else if (request.type === 'GET_LINES') {
    sendResponse(store);
  } else if (request.type === 'CLEAR_LINES') {
    handleClearLines().catch((e) => {
      console.error('[UFC] Clear handler error:', e);
    });
  } else if (request.type === 'CLEAR_BETR_LINES') {
    handleClearBetrLines().then(() => sendResponse({ ok: true })).catch((e) => {
      console.error('[UFC] Clear Betr error:', e);
      sendResponse({ ok: false });
    });
    return true;
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
        void updatePendingBadge();
        sendResponse({ ok: true, ...result });
      })
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  } else if (request.type === 'FORCE_BACKFILL') {
    PropArchiveService.backfillUnresolvedFromKnownOutcomes({ minHoursBetweenRuns: 0 })
      .then(result => {
        if (result.changed > 0) notifyAnalyzerTabs({ type: 'ARCHIVE_SETTLED', settled: result.changed });
        void updatePendingBadge();
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
  } else if (request.type === 'CLEANUP_ORPHAN_CARD_ROWS') {
    // Remove archive rows whose fighter is NOT on the current UFC card.
    // Scoped to the current event only. Saves a backup before deleting.
    // Options:
    //   dryRun=true → return what would be deleted without touching storage
    //   platform='pick6' → restrict to one platform (optional)
    const dryRun = Boolean(request.dryRun);
    const platformFilter = request.platform ? String(request.platform).toLowerCase() : null;
    (async () => {
      try {
        const card = await fetchUpcomingUFCCard(false);
        if (!card || !Array.isArray(card.fighters) || card.fighters.length === 0) {
          sendResponse({ ok: false, error: 'No upcoming UFC card available' });
          return;
        }
        const cardNames = new Set<string>();
        for (const bout of card.fighters) {
          const a = normalizeFighterName(bout.f1);
          const b = normalizeFighterName(bout.f2);
          if (a) cardNames.add(a);
          if (b) cardNames.add(b);
        }
        const normEvent = card.event.toLowerCase().replace(/[^a-z0-9]/g, '');

        const key = 'prop_archive_v1';
        const payload = await new Promise<Record<string, any>>((res) => chrome.storage.local.get([key], r => res(r || {})));
        const rows: any[] = Array.isArray(payload[key]) ? payload[key] : [];

        const orphans: any[] = [];
        const kept: any[] = [];
        for (const r of rows) {
          const ev = String(r?.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (ev !== normEvent) { kept.push(r); continue; }
          if (platformFilter && String(r?.platform || '').toLowerCase() !== platformFilter) { kept.push(r); continue; }
          const fname = normalizeFighterName(r?.fighter);
          if (fname && cardNames.has(fname)) { kept.push(r); continue; }
          orphans.push(r);
        }

        const orphanNames = Array.from(new Set(orphans.map(o => String(o?.fighter || '')))).sort();

        if (dryRun) {
          sendResponse({ ok: true, dryRun: true, wouldDelete: orphans.length, fighters: orphanNames, event: card.event });
          return;
        }

        // Backup before delete (respecting line data is irreplaceable).
        const backupKey = `prop_archive_orphan_backup_${Date.now()}`;
        await new Promise<void>((res) => chrome.storage.local.set({ [backupKey]: orphans }, () => res()));
        await new Promise<void>((res) => chrome.storage.local.set({ [key]: kept }, () => res()));
        sendResponse({ ok: true, deleted: orphans.length, fighters: orphanNames, event: card.event, backupKey });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
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
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 0 means "no payout" — Underdog API returns 0 (or omits) the multiplier
    // for sides that aren't offered. Treat as null so the caller doesn't think
    // the side is available. Real odds are either |american| >= 100 or
    // multipliers > 0 (typically 0.4x–2.5x range).
    if (raw === 0) return null;
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  const m = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const value = Number(m[0]);
  if (!Number.isFinite(value) || value === 0) return null;
  return value;
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
const LINE_REFRESH_ALARM      = 'ufc_line_refresh';

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

// PrizePicks-specific FP: only sig strikes, no non-sig/control/reversal,
// submission attempts score 4pts each, lower win bonuses, no quick-finish bonus.
function computeFP_PP(stats: {
  sigStrikes: number; td: number; kd: number; sub: number;
  won: boolean; method: string; round: number;
}): number {
  const s = PRIZEPICKS_SCORING;
  let fp = stats.sigStrikes * s.sigStrike
    + stats.td * s.takedown
    + stats.kd * s.knockdown
    + stats.sub * s.submissionAttempt;
  if (stats.won) {
    const m = stats.method.toLowerCase();
    const isFin = m.includes('ko') || m.includes('tko') || m.includes('sub');
    if (isFin) {
      if (stats.round === 1) fp += s.winBonus.round1;
      else if (stats.round === 2) fp += s.winBonus.round2;
      else if (stats.round === 3) fp += s.winBonus.round3;
      else fp += s.winBonus.round4Plus;
    } else {
      fp += s.winBonus.decision;
    }
  }
  return Math.round(fp * 10) / 10;
}

async function fetchFightDetails(url: string): Promise<Array<{
  name: string; won: boolean; ss: number; ssR1: number; totalStr: number; td: number;
  kd: number; rev: number; sub: number; ctrlSecs: number; method: string; round: number;
  fightTimeMins: number;
}>> {
  try {
    const html = await ufcstatsFetchText(url, { signal: AbortSignal.timeout(12000) });
    if (!html) return [];

    // Fighter names: first two fighter-details links on the page
    const nameMatches = [...html.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+?)\s*<\/a>/gi)];
    const names = nameMatches.slice(0, 2).map(m => m[1].trim()).filter(Boolean);
    if (names.length < 2) return [];

    // W/L status: first two person-status elements
    const statusMatches = [...html.matchAll(/person-status[^>]*>\s*([WLD])/gi)];
    const statuses = statusMatches.slice(0, 2).map(m => m[1].toUpperCase());

    // Method and round — UFCStats structure: <i>Label: </i>value</i>
    // e.g. "Round: </i> 3 </i>" — value is plain text after the label's closing tag
    const methodM = html.match(/Method:[^<]*<\/i>\s*([A-Za-z][^<\n]+)/i);
    const roundM  = html.match(/Round:[^<]*<\/i>\s*(\d+)/i);
    const timeM   = html.match(/Time:[^<]*<\/i>\s*(\d+):(\d+)/i);
    const method = methodM ? methodM[1].trim() : 'Decision';
    const round  = roundM  ? parseInt(roundM[1]) : 3;
    // Total fight time in minutes: completed rounds + time in last round
    const lastRoundMins = timeM ? (parseInt(timeM[1]) + parseInt(timeM[2]) / 60) : 5;
    const fightTimeMins = Math.round(((round - 1) * 5 + lastRoundMins) * 100) / 100;

    // UFCStats fight detail page tbodies: [0]=Totals, [1]=Per-round Totals, [2]=Sig Strikes, [3]=Per-round Sig Strikes.
    // Each data row has ONE <tr> with both fighters; each <td> separates values using <p> tags.
    const allTbodies = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)].map(m => m[1]);
    const firstTbody = allTbodies[0] || '';
    const perRoundTbody = allTbodies[1] || '';
    const firstRow = firstTbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1] || '';
    const cells = [...firstRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    // Per-round Totals: first data row = Round 1 (same column layout as Totals).
    const r1Row = perRoundTbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1] || '';
    const r1Cells = [...r1Row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);

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
      const ssR1M   = cellVal(r1Cells[2] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const ssR1    = ssR1M ? parseInt(ssR1M[1]) : 0;
      const totM    = cellVal(cells[4] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const totalStr = totM ? parseInt(totM[1]) : 0;
      const tdM     = cellVal(cells[5] ?? '', i).match(/(\d+)\s+of\s+\d+/);
      const td      = tdM ? parseInt(tdM[1]) : 0;
      const sub     = parseInt(cellVal(cells[7] ?? '', i)) || 0;
      const rev     = parseInt(cellVal(cells[8] ?? '', i)) || 0;
      const ctrl    = parseCtrlTime(cellVal(cells[9] ?? '', i) || '0:00');
      result.push({ name: names[i], won: statuses[i] === 'W', ss, ssR1, totalStr, td, kd, rev, sub, ctrlSecs: ctrl, method, round, fightTimeMins });
    }
    return result;
  } catch {
    return [];
  }
}

let _settleInProgress = false;
async function fetchAndSettleFromUFCStats(opts?: { forceEventName?: string; includeZeroResults?: boolean }): Promise<{ settled: number; skipped: number; errors: string[] }> {
  if (_settleInProgress) {
    console.log('[UFC Settle] Already running — skipping concurrent call');
    return { settled: 0, skipped: 0, errors: [] };
  }
  _settleInProgress = true;
  try {
    return await _fetchAndSettleFromUFCStats(opts);
  } finally {
    _settleInProgress = false;
  }
}
async function _fetchAndSettleFromUFCStats(opts?: { forceEventName?: string; includeZeroResults?: boolean }): Promise<{ settled: number; skipped: number; errors: string[] }> {
  let settled = 0, skipped = 0;
  const errors: string[] = [];

  // Inline normalizers matching PropArchiveService logic
  const _baseNorm  = (s: string) => s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  // Alias-aware name normalizer. Archive rows carry platform spellings (e.g.
  // "Yadong Song") while UFCStats parses the canonical form ("Song Yadong");
  // without this bridge those siblings never match and settle leaves orphans.
  // Re-normalize both sides of the shared NAME_ALIASES map so lookups agree
  // regardless of how the map's keys/values are cased in config.
  const _aliasLC: Record<string, string> = {};
  for (const [k, v] of Object.entries(NAME_ALIASES)) _aliasLC[_baseNorm(k)] = _baseNorm(v);
  const _normName  = (s: string) => { const base = _baseNorm(s); return _aliasLC[base] || base; };
  const _normEvent = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const _normProp  = (v: string) => {
    if (/^ss$/i.test(v)) return 'ss';
    if (/^td$/i.test(v)) return 'td';
    if (/^fantasy$/i.test(v) || /^fp$/i.test(v)) return 'fantasy';
    if (/^control$/i.test(v)) return 'control';
    if (/^ft$/i.test(v) || /^fight\s*time$/i.test(v) || /^fighttime$/i.test(v)) return 'fighttime';
    return v.toLowerCase();
  };

  try {
    // Load archive once. All modifications happen in-memory; write once at the end.
    const raw = await new Promise<Record<string, any>>((res) => chrome.storage.local.get(['prop_archive_v1'], res));
    const archive: PropArchiveRecord[] = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
    const unresolved = archive.filter(r => {
      if (!Number.isFinite(Number(r.line)) || Number(r.line) <= 0) return false;
      if (!Number.isFinite(Number(r.result))) return true; // truly unresolved
      if (opts?.includeZeroResults && Number(r.result) === 0) return true; // likely bad parse
      return false;
    });
    if (unresolved.length > 0 && unresolved.length <= 100) {
      const sample = unresolved.slice(0, 20);
      console.log('[UFC Settle] Unresolved sample:', sample.map(r => `${r.fighter}|${r.event}|${r.propType}|line=${r.line}`).join('\n  '));
    }
    if (!unresolved.length) {
      console.log('[UFC Settle] No unresolved records — archive is up to date');
      return { settled: 0, skipped: 0, errors: [] };
    }

    // Bulk apply: set result on matching archive records in-memory (no per-call read-modify-write).
    // Returns number of records updated.
    function applyResult(names: string[], event: string, propType: string, result: number): number {
      if (!Number.isFinite(result)) return 0;
      const nEvent = _normEvent(event);
      const nProp  = _normProp(propType);
      const nNames = new Set(names.map(_normName).filter(Boolean));
      let count = 0;
      for (const row of archive) {
        if (!nNames.has(_normName(String(row.fighter || '')))) continue;
        if (_normEvent(String(row.event || '')) !== nEvent) continue;
        if (_normProp(String(row.propType || '')) !== nProp) continue;
        if (Number.isFinite(Number(row.result)) && !opts?.includeZeroResults) continue; // already resolved
        row.result = result;
        count++;
      }
      return count;
    }

    const eventNames = [...new Set(unresolved.map(r => r.event))];
    console.log(`[UFC Settle] ${unresolved.length} unresolved records across ${eventNames.length} event(s): ${eventNames.join(' | ')}`);

    // Fetch completed events list from UFCStats
    const listHtml = await ufcstatsFetchText('http://www.ufcstats.com/statistics/events/completed?page=all', {
      signal: AbortSignal.timeout(15000),
    });
    if (!listHtml) throw new Error('UFCStats list fetch failed (challenge or network)');

    const completedEvents: Array<{ name: string; url: string; date: string }> = [];
    for (const rowM of [...listHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+?)\s*<\/a>/i);
      const dateM = row.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d+,\s+\d{4}/i);
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

    // Cache parsed results from matched events for fallback surname lookup
    type FightResult = Awaited<ReturnType<typeof fetchFightDetails>>[number];
    const matchedEventCache: Array<{ date: string; results: FightResult[] }> = [];
    const unmatchedEvents: string[] = [];

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
        console.log(`[UFC Settle] No completed UFCStats event matched: "${archiveEvent}" — will retry via fighter lookup`);
        unmatchedEvents.push(archiveEvent);
        continue;
      }
      console.log(`[UFC Settle] Matched "${archiveEvent}" → "${match.name}"`);

      // Fetch event page to get individual fight URLs
      const evHtml = await ufcstatsFetchText(match.url, { signal: AbortSignal.timeout(12000) });
      if (!evHtml) { errors.push(`Event page error: ${match.name}`); continue; }

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
      matchedEventCache.push({ date: match.date, results: allFightResults });

      // Map last-name → full name so "M Aswell" can match "Michael Aswell Jr"
      const lastNameMap = new Map<string, string>();
      for (const f of allFightResults) {
        if (!f.name) continue;
        const last = f.name.trim().split(/\s+/).pop()!.toLowerCase();
        lastNameMap.set(last, f.name);
      }

      // Map archive-side last-name → archive fighter names for this event. Catches the case where
      // archive holds the long form ("Cameron Rowston", "Wesley Schultz") but UFCStats uses the
      // short form ("Cam Rowston", "Wes Schultz"). The analyzer canonicalizes live via fuzzy merge,
      // but archive rows written before that canonicalization keep the original platform spelling.
      const archiveLastNameMap = new Map<string, Set<string>>();
      for (const r of unresolved) {
        if (r.event !== archiveEvent) continue;
        const an = String(r.fighter || '').trim();
        if (!an) continue;
        const last = an.split(/\s+/).pop()!.toLowerCase();
        if (!last) continue;
        let bucket = archiveLastNameMap.get(last);
        if (!bucket) { bucket = new Set(); archiveLastNameMap.set(last, bucket); }
        bucket.add(an);
      }

      for (const f of allFightResults) {
        if (!f.name) continue;
        const fp = computeFP({ sigStrikes: f.ss, totalStrikes: f.totalStr, td: f.td, kd: f.kd, rev: f.rev, ctrlSecs: f.ctrlSecs, won: f.won, method: f.method, round: f.round });
        const fpPP = computeFP_PP({ sigStrikes: f.ss, td: f.td, kd: f.kd, sub: f.sub, won: f.won, method: f.method, round: f.round });

        // Try exact name first, then abbreviated first-initial match (e.g. "M Aswell" → "Michael Aswell Jr")
        const namesToTry = new Set<string>([f.name]);
        const parts = f.name.trim().split(/\s+/);
        if (parts.length >= 2) {
          // "Michael Aswell Jr" → also try matching archive records whose last name matches
          namesToTry.add(`${parts[0][0]} ${parts.slice(1).join(' ')}`); // "M Aswell Jr"
          namesToTry.add(`${parts[0][0]} ${parts[parts.length - 1]}`);  // "M Aswell"
        }
        if (parts.length >= 3) {
          // "Lance Gibson Jr." → archive may store as "Lance Jr" (first + suffix, no middle)
          namesToTry.add(`${parts[0]} ${parts[parts.length - 1]}`); // "Lance Jr."
        }
        // Reverse direction: archive may hold a longer first-name variant than UFCStats.
        // Pull every unresolved-archive name on this card whose last name matches.
        const lastForArchive = parts[parts.length - 1]?.toLowerCase();
        if (lastForArchive) {
          const archiveNames = archiveLastNameMap.get(lastForArchive);
          if (archiveNames) for (const an of archiveNames) namesToTry.add(an);
        }

        const nameVariants = [f.name, ...Array.from(namesToTry)];
        // Pick6 'ctrl' lines are in minutes; UFCStats provides ctrlSecs.
        const ctrlMins = Math.round((f.ctrlSecs / 60) * 100) / 100;
        const n = applyResult(nameVariants, archiveEvent, 'SS', f.ss)
                + applyResult(nameVariants, archiveEvent, 'SS_R1', f.ssR1)
                + applyResult(nameVariants, archiveEvent, 'TD', f.td)
                + applyResult(nameVariants, archiveEvent, 'Fantasy', fp)
                + applyResult(nameVariants, archiveEvent, 'Fantasy_PP', fpPP)
                + applyResult(nameVariants, archiveEvent, 'FightTime', f.fightTimeMins)
                + applyResult(nameVariants, archiveEvent, 'ctrl', ctrlMins);
        if (n > 0) {
          console.log(`[UFC Settle] ${f.name}: SS=${f.ss} SS_R1=${f.ssR1} TD=${f.td} FP=${fp.toFixed(1)} FP_PP=${fpPP.toFixed(1)} FT=${f.fightTimeMins.toFixed(2)}min CTRL=${ctrlMins}min (${f.won ? 'W' : 'L'} R${f.round})`);
          settled++;
        }
      }
    }

    // Fallback: for unmatched events (e.g. stored as "Fight Night: A vs B" sub-fight),
    // find the closest-dated completed UFCStats event and settle the two fighters from it.
    if (unmatchedEvents.length > 0) {
      // Build a date → parsed results cache so we don't re-fetch the same event page twice
      const fetchedEventCache = new Map<string, { date: string; results: FightResult[] }>();

      // Pre-populate from this run's matched events (may be empty if main card already settled)
      for (const cached of matchedEventCache) {
        const key = cached.results.map(r => r.name).sort().join('|');
        fetchedEventCache.set(key, cached);
      }

      for (const archiveEvent of unmatchedEvents) {
        const surnames = eventSurnames(archiveEvent);
        if (surnames.size < 2) { errors.push(`No match: ${archiveEvent}`); skipped++; continue; }

        // First try already-fetched event caches
        let matchedEntry: { date: string; results: FightResult[] } | null = null;
        for (const entry of fetchedEventCache.values()) {
          const lastNames = new Set(entry.results.map(r => r.name?.trim().split(/\s+/).pop()?.toLowerCase()).filter(Boolean));
          if ([...surnames].every(s => lastNames.has(s))) { matchedEntry = entry; break; }
        }

        // If not found, find the closest-dated completed event by the archive record dates
        if (!matchedEntry) {
          const recordDates = unresolved
            .filter(r => r.event === archiveEvent && Number.isFinite(Date.parse(r.date)))
            .map(r => Date.parse(r.date));
          const recordDate = recordDates.length ? Math.max(...recordDates) : Date.now();

          // Sort completed events by proximity to the archive record date and try each
          const candidates = [...completedEvents]
            .map(ev => ({ ev, diff: Math.abs(new Date(ev.date).getTime() - recordDate) }))
            .sort((a, b) => a.diff - b.diff)
            .slice(0, 5); // try up to 5 nearest events

          for (const { ev } of candidates) {
            if (matchedEntry) break;
            const cacheKey = ev.url;
            let entry = fetchedEventCache.get(cacheKey);
            if (!entry) {
              try {
                const evHtml = await ufcstatsFetchText(ev.url, { signal: AbortSignal.timeout(12000) });
                if (!evHtml) continue;
                const fightUrls = [...new Set([...evHtml.matchAll(/href="(http[^"]*fight-details\/[a-f0-9]+)"/gi)].map(m => m[1]))];
                const results: FightResult[] = [];
                for (const fightUrl of fightUrls) {
                  results.push(...await fetchFightDetails(fightUrl));
                  await new Promise(r => setTimeout(r, 250));
                }
                entry = { date: ev.date, results };
                fetchedEventCache.set(cacheKey, entry);
                console.log(`[UFC Settle] Fallback fetched event "${ev.name}" (${results.length} fighters)`);
              } catch { continue; }
            }
            const lastNames = new Set(entry.results.map(r => r.name?.trim().split(/\s+/).pop()?.toLowerCase()).filter(Boolean));
            if ([...surnames].every(s => lastNames.has(s))) matchedEntry = entry;
          }
        }

        if (!matchedEntry) {
          console.log(`[UFC Settle] No completed UFCStats event matched: "${archiveEvent}"`);
          errors.push(`No match: ${archiveEvent}`); skipped++; continue;
        }

        console.log(`[UFC Settle] Fallback matched "${archiveEvent}" via fighter surname lookup`);
        // Build last-name → UFCStats result lookup for the matched card
        const cardLastNameMap = new Map<string, FightResult>();
        for (const f of matchedEntry.results) {
          if (!f.name) continue;
          const last = f.name.trim().split(/\s+/).pop()!.toLowerCase();
          cardLastNameMap.set(last, f);
        }
        // Iterate fighters actually stored in the archive under this sub-event,
        // look them up in the card results by last name, then settle.
        const archiveFighters = [...new Set(
          unresolved.filter(r => r.event === archiveEvent).map(r => r.fighter)
        )];
        console.log(`[UFC Settle] Fallback: ${archiveFighters.length} fighters stored under "${archiveEvent}"`);
        for (const archiveName of archiveFighters) {
          const last = archiveName.trim().split(/\s+/).pop()?.toLowerCase();
          const f = last ? cardLastNameMap.get(last) : undefined;
          if (!f) { console.log(`[UFC Settle] Fallback: no card result for archive name "${archiveName}" (last="${last}")`); skipped++; continue; }
          const fp = computeFP({ sigStrikes: f.ss, totalStrikes: f.totalStr, td: f.td, kd: f.kd, rev: f.rev, ctrlSecs: f.ctrlSecs, won: f.won, method: f.method, round: f.round });
          const fpPP = computeFP_PP({ sigStrikes: f.ss, td: f.td, kd: f.kd, sub: f.sub, won: f.won, method: f.method, round: f.round });
          const ctrlMins = Math.round((f.ctrlSecs / 60) * 100) / 100;
          const n = applyResult([archiveName], archiveEvent, 'SS', f.ss)
                  + applyResult([archiveName], archiveEvent, 'SS_R1', f.ssR1)
                  + applyResult([archiveName], archiveEvent, 'TD', f.td)
                  + applyResult([archiveName], archiveEvent, 'Fantasy', fp)
                  + applyResult([archiveName], archiveEvent, 'Fantasy_PP', fpPP)
                  + applyResult([archiveName], archiveEvent, 'FightTime', f.fightTimeMins)
                  + applyResult([archiveName], archiveEvent, 'ctrl', ctrlMins);
          if (n > 0) { console.log(`[UFC Settle] Fallback settled ${archiveName} (→${f.name}) under "${archiveEvent}"`); settled++; }
        }
      }
    }

    // Single write for all in-memory modifications (avoids per-record read-modify-write races)
    if (settled > 0) {
      await new Promise<void>((res, rej) => chrome.storage.local.set({ prop_archive_v1: archive }, () => {
        const err = chrome.runtime?.lastError;
        if (err) rej(new Error(err.message)); else res();
      }));
      console.log(`[UFC Settle] Wrote ${archive.length} records to storage`);

      // Post-write verification — confirms values actually landed in storage
      const _verify = await new Promise<any>((res) => chrome.storage.local.get(['prop_archive_v1'], res));
      const _written = Array.isArray(_verify.prop_archive_v1) ? _verify.prop_archive_v1 : [];
      const _postUnresolved = _written.filter((r: any) =>
        Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result))
      );
      console.log(`[UFC Settle] Post-write verify: ${_written.length} total, ${_postUnresolved.length} still unresolved`);
      if (_postUnresolved.length > 0) {
        console.log('[UFC Settle] Post-write still unresolved (first 8):\n  ' +
          _postUnresolved.slice(0, 8).map((r: any) =>
            `fighter="${r.fighter}" event="${r.event}" prop="${r.propType}" line=${r.line} result=${JSON.stringify(r.result)}`
          ).join('\n  ')
        );
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    console.error('[UFC Settle] Error:', e);
  }

  // After settlement, check if all records are now resolved — if so, clear Betr lines
  // since the event is over and manually-entered Betr lines are no longer needed.
  if (settled > 0) {
    try {
      const postRaw = await new Promise<Record<string, any>>((res) => chrome.storage.local.get(['prop_archive_v1'], res));
      const postArchive: any[] = Array.isArray(postRaw.prop_archive_v1) ? postRaw.prop_archive_v1 : [];
      const stillUnresolved = postArchive.filter((r: any) =>
        Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result))
      ).length;
      if (stillUnresolved === 0) {
        await handleClearBetrLines();
      }
    } catch (e) {
      console.error('[UFC Settle] Post-settle Betr cleanup check failed:', e);
    }
  }

  console.log(`[UFC Settle] Done — settled=${settled}, skipped=${skipped}, errors=${errors.length}`);
  return { settled, skipped, errors };
}

function toArchivePropTypeFromLineKey(lineKey: string, platform?: string): string {
  const key = lineKey.toLowerCase();
  if (key === 'line_fp') {
    return platform === 'prizepicks' ? 'Fantasy_PP' : 'Fantasy';
  }
  if (key === 'line_ss') return 'SS';
  if (key === 'line_ss_r1') return 'SS_R1';
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

async function getCancelledFighterNames(): Promise<Set<string>> {
  try {
    const data = await new Promise<Record<string, any>>(res => chrome.storage.local.get(['cancelled_fighters'], res));
    const cf = data['cancelled_fighters'];
    if (cf && typeof cf === 'object' && Array.isArray(cf.names)) {
      return new Set(cf.names.map((n: string) => n.toLowerCase()));
    }
  } catch { /* non-fatal */ }
  return new Set();
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
  const cancelled = await getCancelledFighterNames();
  const records: PropArchiveRecord[] = [];
  const dateIso = toIsoDate(card.date);

  for (const f of fighters) {
    const fighter = String(f?.name || '').trim();
    if (!fighter) continue;
    const fighterKey = normalizeFighterName(fighter);
    const opponent = sanitizeOpponentName(f?.opponent, fighter) || String(f?.opponent || '').trim() || 'Unknown Opponent';
    const opponentKey = normalizeFighterName(opponent);

    // Skip cancelled fighters
    if (fighterKey && cancelled.has(fighterKey)) continue;

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
        propType: toArchivePropTypeFromLineKey(key, platform),
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
      if (fighter.line_ss_r1 != null) merged.line_ss_r1 = fighter.line_ss_r1;
      if (fighter.line_td != null) merged.line_td = fighter.line_td;
      if (fighter.line_ft != null) {
        const ftLine = normalizeFightTimeLineToMinutes(fighter.line_ft);
        if (ftLine != null) merged.line_ft = ftLine;
      }
      if (fighter.line_ctrl != null) merged.line_ctrl = fighter.line_ctrl;
      if (fighter.ctrl_under_available != null) merged.ctrl_under_available = fighter.ctrl_under_available;
      if (fighter.ss_under_available != null) merged.ss_under_available = fighter.ss_under_available;
      if (fighter.td_under_available != null) merged.td_under_available = fighter.td_under_available;
      if (fighter.ss_over_odds != null) merged.ss_over_odds = fighter.ss_over_odds;
      if (fighter.ss_under_odds != null) merged.ss_under_odds = fighter.ss_under_odds;
      if (fighter.td_over_odds != null) merged.td_over_odds = fighter.td_over_odds;
      if (fighter.td_under_odds != null) merged.td_under_odds = fighter.td_under_odds;
      if (fighter.ft_over_odds != null) merged.ft_over_odds = fighter.ft_over_odds;
      if (fighter.ft_under_odds != null) merged.ft_under_odds = fighter.ft_under_odds;
      if (fighter.ctrl_over_odds != null) merged.ctrl_over_odds = fighter.ctrl_over_odds;
      if (fighter.ctrl_under_odds != null) merged.ctrl_under_odds = fighter.ctrl_under_odds;
      if (fighter.ud_ss_over_avail != null) merged.ud_ss_over_avail = fighter.ud_ss_over_avail;
      if (fighter.ud_ss_under_avail != null) merged.ud_ss_under_avail = fighter.ud_ss_under_avail;
      if (fighter.ud_td_over_avail != null) merged.ud_td_over_avail = fighter.ud_td_over_avail;
      if (fighter.ud_td_under_avail != null) merged.ud_td_under_avail = fighter.ud_td_under_avail;
      if (fighter.ud_ft_over_avail != null) merged.ud_ft_over_avail = fighter.ud_ft_over_avail;
      if (fighter.ud_ft_under_avail != null) merged.ud_ft_under_avail = fighter.ud_ft_under_avail;
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

    // Contamination guard: if a scrape returns fighters with zero overlap against the
    // current UFC card AND we already have data, the capture is from a non-UFC page
    // (e.g. a Pick6 category URL that redirected to the DK Fantasy home). Without this
    // guard, shouldReplaceSlate sees the low overlap and wipes the existing good data.
    if (existing.length > 0 && data.fighters.length > 0) {
      try {
        const card = await fetchUpcomingUFCCard(false);
        if (card && Array.isArray(card.fighters) && card.fighters.length > 0) {
          const overlap = countCardOverlap(card, data.fighters);
          if (overlap === 0) {
            console.warn(`[UFC] ${platform}: rejected capture of ${data.fighters.length} fighters — zero UFC card overlap (likely redirect contamination)`);
            return;
          }
        }
      } catch {
        // Card fetch failure shouldn't block capture — fall through to merge.
      }
    }

    const mergedFighters = mergeOrReplaceFighters(existing, data.fighters, platform);

    console.log(`[UFC] Merged ${platform}: existing ${existing.length}, incoming ${data.fighters.length}, merged ${mergedFighters.length}`);
    mergedFighters.forEach(f => {
      if (f.line_ss && f.line_td) {
        console.log(`[UFC] Fighter ${f.name} has SS: ${f.line_ss}, TD: ${f.line_td} | ss_under_avail=${(f as any).ss_under_available ?? 'null'} td_under_avail=${(f as any).td_under_available ?? 'null'}`);
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
  // Betr lines are manually entered — preserve them across clears.
  // They are cleared separately after settlement via handleClearBetrLines().
  store.prizepicks = null;
  store.draftkings_sportsbook = null;
  autoScrapeInProgress = false; // allow a fresh auto-fetch immediately after clear
  await StorageService.clearLines();
}

/** Clear Betr lines only — called after event settlement. */
async function handleClearBetrLines(): Promise<void> {
  store.betr = null;
  try {
    await new Promise<void>((res, rej) => chrome.storage.local.remove(['lines_betr', 'lines_betr_manual_v1'], () => {
      const err = chrome.runtime?.lastError;
      if (err) rej(new Error(err.message)); else res();
    }));
    console.log('[UFC] Cleared Betr lines (post-event)');
  } catch (e) {
    console.error('[UFC] Failed to clear Betr lines:', e);
  }
}

const STARTUP_MIGRATION_KEY = 'startup_migration_version';
const STARTUP_MIGRATION_VERSION = '2026-04-02-moicano-duncan-v3';

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

// ── AUTO-BACKUP ON STARTUP ────────────────────────────────────────────
// Silently saves a full chrome.storage.local snapshot to Downloads once
// per 24 hours. Prevents catastrophic data loss from Opera Remove+Re-add.
const AUTO_BACKUP_THROTTLE_KEY = '__autoBackupLastTs';
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTO_BACKUP_MIN_ARCHIVE = 10; // skip if archive has fewer than this many records

async function autoBackupOnStartup(): Promise<void> {
  try {
    const allData = await new Promise<Record<string, any>>((res) =>
      chrome.storage.local.get(null, res)
    );

    // Skip if storage is trivially small (post-wipe state)
    const archive: any[] = Array.isArray(allData.prop_archive_v1) ? allData.prop_archive_v1 : [];
    if (archive.length < AUTO_BACKUP_MIN_ARCHIVE) {
      console.log(`[UFC Auto-Backup] Skipped — only ${archive.length} archive records (min ${AUTO_BACKUP_MIN_ARCHIVE})`);
      return;
    }

    // Throttle: once per 24h
    const lastTs = typeof allData[AUTO_BACKUP_THROTTLE_KEY] === 'number' ? allData[AUTO_BACKUP_THROTTLE_KEY] : 0;
    if (Date.now() - lastTs < AUTO_BACKUP_INTERVAL_MS) {
      const hoursAgo = ((Date.now() - lastTs) / 3600000).toFixed(1);
      console.log(`[UFC Auto-Backup] Skipped — last backup was ${hoursAgo}h ago`);
      return;
    }

    // Build backup payload (same format as the manual 💾 Backup button)
    const { [AUTO_BACKUP_THROTTLE_KEY]: _omit, ...storageWithoutThrottle } = allData;
    const payload = JSON.stringify({
      __ufcBackup: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      autoBackup: true,
      keyCount: Object.keys(storageWithoutThrottle).length,
      archiveCount: archive.length,
      storage: storageWithoutThrottle,
    });

    // Convert to data URL for chrome.downloads
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(payload);
    const dateStr = new Date().toISOString().slice(0, 10); // 2026-04-16
    const filename = `ufc-auto-backup-${archive.length}rec-${dateStr}.json`;

    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        { url: dataUrl, filename, conflictAction: 'overwrite', saveAs: false },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    });

    // Record timestamp so we don't re-backup within 24h
    await setStorageRecord({ [AUTO_BACKUP_THROTTLE_KEY]: Date.now() });
    console.log(`[UFC Auto-Backup] Saved ${filename} (${archive.length} archive records, ${Object.keys(storageWithoutThrottle).length} keys)`);
  } catch (e) {
    console.error('[UFC Auto-Backup] Failed:', e);
  }
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
    if (lines.prizepicks) store.prizepicks = lines.prizepicks;
    if (lines.draftkings_sportsbook) store.draftkings_sportsbook = lines.draftkings_sportsbook;
    console.log('[UFC] Restored persisted lines on startup');

    // Always seed hardcoded Betr lines on startup — this ensures the latest
    // hardcoded data is authoritative and clears stale opening-line baselines.
    // Manual user adjustments persist in lines_betr_manual_v1 and are applied
    // on top by the analyzer via applyBetrManualOverrides.
    await initializeBetrLines();

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

      const nowTs = Date.now();

      if (card?.date && unresolved.length > 0) {
        const eventTs = parseEventDateMs(card.date);
        const liveEndTs  = eventTs + 8  * 60 * 60 * 1000; // 8h after event start
        const settleEndTs = eventTs + 28 * 60 * 60 * 1000; // 28h after event start

        if (Number.isFinite(eventTs) && nowTs >= eventTs && nowTs < settleEndTs) {
          console.log(`[UFC Settle] Startup catch-up: event "${card.event}" in window, ${unresolved.length} unresolved — settling now`);
          // Immediate settle
          runSettle().catch(e => console.error('[UFC Settle] Startup settle error:', e));

          // Re-schedule live alarm if still within the live window
          if (nowTs < liveEndTs) {
            chrome.alarms.get(LIVE_SETTLE_ALARM, (existing) => {
              if (!existing) {
                chrome.alarms.create(LIVE_SETTLE_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
                console.log('[UFC Settle] Live alarm rescheduled after startup catch-up');
              }
            });
          }
        }
      }

      // ── Stale pending outcomes auto-detect ─────────────────────────────────
      // Unresolved records from events older than the 28h live window — these
      // were never caught by the window-based catch-up above. Auto-settle once
      // and badge the icon so the user can see there are pending outcomes.
      const staleUnresolved = archive.filter((r: any) =>
        Number.isFinite(Number(r.line)) && Number(r.line) > 0 &&
        !Number.isFinite(Number(r.result)) &&
        Date.parse(r.date) < nowTs - 28 * 60 * 60 * 1000
      );
      void updatePendingBadge();
      if (staleUnresolved.length > 0) {
        const staleEvents = [...new Set(staleUnresolved.map((r: any) => String(r.event)))];
        console.log(`[UFC Settle] ${staleUnresolved.length} stale unresolved props across [${staleEvents.join(', ')}] — auto-settling`);
        runSettle().catch(e => console.error('[UFC Settle] Stale auto-settle error:', e));
      }
    } catch (e) {
      console.error('[UFC Settle] Startup catch-up error:', e);
    }

    // Auto-backup runs last — after all data is restored and settled
    await autoBackupOnStartup();

  } catch (error) {
    console.error('[UFC] Failed to restore lines:', error);
  }
})();

// ── AUTO-SCRAPE ORCHESTRATION ──────────────────────────────────────────
// Opens tabs for each platform, triggers scraping, closes tabs

const AUTO_SCRAPE_URLS: Record<'pick6'|'underdog'|'prizepicks'|'draftkings_sportsbook', string[]> = {
  pick6: [
    // 2026-05-15: DK consolidated UFC under unified MMA category (category/129).
    // category/46 (Fight Score) and category/47 (Takedowns) no longer exist under
    // ?sport=UFC; the MMA homepage SPA-navigates to category/129?sport=MMA&pickGroup=...
    // and the scraper clicks stat tabs from there.
    CONFIG.platforms.pick6.url,
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
    // 2026-05-15: DK restructured params — category=fights, stat moved to nav_1
    'https://sportsbook.draftkings.com/leagues/mma/ufc?category=fights&subcategory=fighter-props&nav_1=significant-strikes-o-u',
    'https://sportsbook.draftkings.com/leagues/mma/ufc?category=fights&subcategory=fighter-props&nav_1=takedowns-landed-o-u',
  ],
};

let autoScrapeInProgress = false;

interface UnderdogCoverage {
  total: number;
  fpCount: number;
  ssCount: number;
  tdCount: number;
  ctrlCount: number;
  allThreeCount: number;
}

function getUnderdogStatCoverage(
  fighters: Array<{ line_fp?: number | null; line_ss?: number | null; line_td?: number | null; line_ctrl?: number | null }>
): UnderdogCoverage {
  let fpCount = 0, ssCount = 0, tdCount = 0, ctrlCount = 0, allThreeCount = 0;
  for (const f of fighters) {
    if (f.line_fp != null) fpCount++;
    if (f.line_ss != null) ssCount++;
    if (f.line_td != null) tdCount++;
    if (f.line_ctrl != null) ctrlCount++;
    if (f.line_fp != null && f.line_ss != null && f.line_td != null) allThreeCount++;
  }
  return { total: fighters.length, fpCount, ssCount, tdCount, ctrlCount, allThreeCount };
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

function parseUnderdogApiFighters(data: any): Array<{ name: string; line_fp: number | null; line_ss: number | null; line_ss_r1: number | null; line_td: number | null; line_ft: number | null; opponent: string | null; ss_over_odds: number | null; ss_under_odds: number | null; td_over_odds: number | null; td_under_odds: number | null; ft_over_odds: number | null; ft_under_odds: number | null; ud_ss_over_avail: boolean | null; ud_ss_under_avail: boolean | null; ud_td_over_avail: boolean | null; ud_td_under_avail: boolean | null; ud_ft_over_avail: boolean | null; ud_ft_under_avail: boolean | null }> {
  const fighters: Record<string, { name: string; line_fp: number | null; line_ss: number | null; line_ss_r1: number | null; line_td: number | null; line_ft: number | null; opponent: string | null; ss_over_odds: number | null; ss_under_odds: number | null; td_over_odds: number | null; td_under_odds: number | null; ft_over_odds: number | null; ft_under_odds: number | null; ud_ss_over_avail: boolean | null; ud_ss_under_avail: boolean | null; ud_td_over_avail: boolean | null; ud_td_under_avail: boolean | null; ud_ft_over_avail: boolean | null; ud_ft_under_avail: boolean | null }> = {};
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
    let lineType: 'fp'|'ss'|'ss_r1'|'td'|'ft'|null = null;
    if (title.includes('significant strike') || title === 'significant strikes') {
      // Round-1-only variants (e.g. "Sig Strikes Rd 1", "Round 1 Significant Strikes")
      // get their own bucket so their (much lower) value can't overwrite the
      // total-fight SS line. Detect round-specificity before the generic branch.
      lineType = /\bround\b|\brd\.?\s*\d|\br\d\b/i.test(title) ? 'ss_r1' : 'ss';
    }
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
        line_ss_r1: null,
        line_td: null,
        line_ft: null,
        opponent: opponent || null,
        ss_over_odds: null,
        ss_under_odds: null,
        td_over_odds: null,
        td_under_odds: null,
        ft_over_odds: null,
        ft_under_odds: null,
        ud_ss_over_avail: null,
        ud_ss_under_avail: null,
        ud_td_over_avail: null,
        ud_td_under_avail: null,
        ud_ft_over_avail: null,
        ud_ft_under_avail: null,
      };
    }
    const normalizedStatValue = lineType === 'ft' ? normalizeFightTimeLineToMinutes(statValue) : statValue;
    // For SS and TD keep the highest value — total-fight lines are always greater than
    // per-round variants, so this ensures a round-specific duplicate never overwrites
    // the correct total-fight line.
    const existing = fighters[name][`line_${lineType}`];
    if ((lineType === 'ss' || lineType === 'td') && normalizedStatValue != null) {
      if (existing == null || normalizedStatValue > existing) {
        fighters[name][`line_${lineType}`] = normalizedStatValue;
      }
    } else {
      fighters[name][`line_${lineType}`] = normalizedStatValue;
    }
    const sideOdds = extractUnderdogSideOdds(line);
    // UD pick-em is one-sided for many props (only Higher button shows when the
    // Lower side isn't offered). Track which side UD actually surfaced so the
    // analyzer's Best Picks filter can drop UD-tagged candidates whose side
    // isn't tappable. true = UD offered this side, false = UD has the line but
    // didn't offer this side, null = no UD line for this stat at all.
    if (lineType === 'ss') {
      if (sideOdds.overOdds != null) fighters[name].ss_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].ss_under_odds = sideOdds.underOdds;
      fighters[name].ud_ss_over_avail = sideOdds.overOdds != null;
      fighters[name].ud_ss_under_avail = sideOdds.underOdds != null;
    } else if (lineType === 'td') {
      if (sideOdds.overOdds != null) fighters[name].td_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].td_under_odds = sideOdds.underOdds;
      fighters[name].ud_td_over_avail = sideOdds.overOdds != null;
      fighters[name].ud_td_under_avail = sideOdds.underOdds != null;
    } else if (lineType === 'ft') {
      if (sideOdds.overOdds != null) fighters[name].ft_over_odds = sideOdds.overOdds;
      if (sideOdds.underOdds != null) fighters[name].ft_under_odds = sideOdds.underOdds;
      fighters[name].ud_ft_over_avail = sideOdds.overOdds != null;
      fighters[name].ud_ft_under_avail = sideOdds.underOdds != null;
    }
    if (opponent) fighters[name].opponent = opponent;
  }

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_ss_r1 != null || f.line_td != null || f.line_ft != null);
}

async function fetchUnderdogFromBackground(): Promise<UnderdogCoverage> {
  const endpoints = CONFIG.api.underdog || [];
  let mergedFighters = store.underdog?.fighters || [];
  for (const url of endpoints) {
    let parsedAny = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const timeoutMs = 18000 + (attempt - 1) * 6000;
        const res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(timeoutMs) });
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

function parsePrizePicksApiFighters(data: any): Array<{ name: string; line_fp: number | null; line_ss: number | null; line_ss_r1: number | null; line_td: number | null; line_ft: number | null; opponent: string | null }> {
  const fighters: Record<string, { name: string; line_fp: number | null; line_ss: number | null; line_ss_r1: number | null; line_td: number | null; line_ft: number | null; opponent: string | null }> = {};
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

  const upsert = (name: string, type: 'fp'|'ss'|'ss_r1'|'td'|'ft', value: number, opponent: string | null = null) => {
    if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_ss_r1: null, line_td: null, line_ft: null, opponent };
    const normalized = type === 'ft' ? normalizeFightTimeLineToMinutes(value) : value;
    // For SS and TD, keep the highest value seen — standard total-fight lines are always
    // greater than any round-specific duplicate that may slip through. (ss_r1 is its own
    // bucket and isn't subject to this dedup.)
    const existing = fighters[name][`line_${type}`];
    if ((type === 'ss' || type === 'td') && normalized != null && existing != null && normalized < existing) {
      // skip — existing value is higher (more likely to be the correct total-fight line)
    } else {
      fighters[name][`line_${type}`] = normalized;
    }
    if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
  };

  for (const p of projections) {
    if (!p || p.type !== 'projection') continue;
    const attrs = p.attributes || {};

    // Keep only MMA/UFC projections from the board payload.
    const leagueRelId = p.relationships?.league?.data?.id ? String(p.relationships.league.data.id) : '';
    const leagueName = String(leagueById.get(leagueRelId) || '').toLowerCase();
    if (!/\bmma\b|\bufc\b/.test(leagueName)) continue;

    // Only keep standard base lines — skip demon (boosted) and goblin (easier) variants.
    // If odds_type is present and not "standard", it's a special-mode line.
    const oddsType = String(attrs.odds_type || attrs.projection_type || '').toLowerCase();
    if (oddsType && oddsType !== 'standard') continue;

    const stat = String(attrs.stat_type || '').toLowerCase();
    const isRound1 = /\brd\s*1\b|\bround\s*1\b|\br1\b|\b1st\s*round\b/.test(stat);
    let lineType: 'fp'|'ss'|'ss_r1'|'td'|'ft'|null = null;

    if (stat.includes('significant strike')) lineType = isRound1 ? 'ss_r1' : 'ss';
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

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_ss_r1 != null || f.line_td != null || f.line_ft != null);
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
        // Pick6 must open active so Chrome doesn't throttle rAF — React's view
        // updates after stat-tab clicks rely on rAF and don't fire reliably in
        // background tabs (CTRL/TD/SS captures all fail in inactive tabs). The
        // tab auto-closes in the finally block when the scrape ends, returning
        // focus to whatever tab was active before.
        const tab = await chrome.tabs.create({ url, active: true });
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

      const elapsedMs = Date.now() - started;
      // CTRL is the LAST tab the content script clicks (Time → Control Time). If we've
      // captured FP/SS/TD but not yet CTRL, give the scraper extra time to finish that pass
      // before closing tabs. Some events don't offer CTRL on Pick6 — cap the extra wait so
      // we don't hang forever on those.
      const ctrlSeen = coverage.ctrlCount > 0;
      const ctrlGraceMet = ctrlSeen || elapsedMs >= 9000;

      if (hasEnoughPick6StatCoverage(coverage, expectedFighters) && ctrlGraceMet) {
        console.log(`[UFC Auto-Scrape] pick6 concurrent coverage complete at T+${Date.now() - globalStart}ms: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, ctrl=${coverage.ctrlCount}, all3=${coverage.allThreeCount}`);
        break;
      }

      const receivedAnyPayload = count > baselineCount || capturedAt > baselineCapturedAt;
      const quietLongEnough = receivedAnyPayload && lastChangeAt > 0 && (Date.now() - lastChangeAt >= 1500);
      // Only early-exit if we have multi-stat coverage — never on SS-only data
      const hasMultiStatCoverage = coverage.fpCount >= 4 || coverage.tdCount >= 4;
      const enoughDataEarly = hasMultiStatCoverage && count >= 9 && elapsedMs >= 3000 && ctrlGraceMet;
      const quietExitAllowed = elapsedMs >= 4000 && count >= 7 && hasMultiStatCoverage && ctrlGraceMet;
      if ((quietLongEnough && quietExitAllowed) || enoughDataEarly) {
        console.log(`[UFC Auto-Scrape] pick6 concurrent scrape settled at T+${Date.now() - globalStart}ms (${loopCount} loops): fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, ctrl=${coverage.ctrlCount}, all3=${coverage.allThreeCount} (${enoughDataEarly ? 'early exit' : 'quiet time'})`);
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

// Merge DK-scraped moneylines on top of existing BFO odds (DK is live and liquid).
async function mergeDKMoneylines(dkOdds: Record<string, number>): Promise<void> {
  try {
    const res = await chrome.storage.local.get('fight_odds_moneyline');
    const existing: Record<string, number> = (res.fight_odds_moneyline as Record<string, number>) || {};
    const merged = { ...existing, ...dkOdds };
    await StorageService.setFightOddsMoneyline(merged);
    notifyAnalyzerTabs({ type: 'ODDS_UPDATED', count: Object.keys(merged).length, reason: 'dk-sportsbook' });
  } catch (e) {
    console.error('[UFC Odds] Failed to merge DK moneylines:', e);
  }
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
      // has the most complete combined view available. EXCEPTION: Underdog fetches via an
      // authenticated API and merges onto existing lines (fetchUnderdogFromBackground), so
      // clearing it first means a transient/rate-limited/401 miss blanks UD entirely
      // ("UD no data"). Skip the pre-clear for UD: a failed fetch then keeps last-good
      // lines, while a successful fetch still merges/replaces them.
      if (platform !== 'underdog') {
        store[platform] = null;
        try { await chrome.storage.local.remove([`lines_${platform}`]); } catch { /* ok */ }
      }

      let urls = AUTO_SCRAPE_URLS[platform];
      // Pick6 /category/N URLs redirect to the homepage without pickGroup. Inject the
      // cached pickGroup (set by content script when user visits a working URL) so the
      // tabs land on the per-event view that has Time→Control Time tabs.
      if (platform === 'pick6') {
        try {
          const cached = await new Promise<Record<string, any>>((res) =>
            chrome.storage.local.get(['pick6_active_pick_group'], (r) => res(r || {}))
          );
          const pg = cached.pick6_active_pick_group;
          if (pg && /^\d+$/.test(String(pg))) {
            urls = urls.map((u) =>
              u.includes('/category/') && !u.includes('pickGroup=')
                ? `${u}&pickGroup=${pg}`
                : u
            );
            console.log(`[UFC Auto-Scrape] Pick6 using cached pickGroup=${pg}`);
          } else {
            console.warn('[UFC Auto-Scrape] Pick6 has no cached pickGroup — open a Pick6 UFC URL once to populate it');
          }
        } catch (e) {
          console.error('[UFC Auto-Scrape] Pick6 pickGroup lookup failed:', e);
        }
      }
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
                  const preferML = href.includes('category=fight-odds') && !href.includes('subcategory=');
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

                  // ── Subcategory-aware element scraper ─────────────────
                  // On DK subcategory pages (?subcategory=significant-strikes-o-u),
                  // the prop label is a section header at the top, NOT paired with
                  // each fighter name. So Pass 1 (which expects "Name Sig Strikes"
                  // in one element) finds nothing. This pass finds fighter-name
                  // elements directly and walks up to grab Over/Under values.
                  if (!Object.keys(out).length && (preferSS || preferTD || preferFT)) {
                    const propJunk = /strikes|takedown|fight\s*time|over|under|more|less|odds|pick|parlay|sgp|boost|promo/i;
                    const nameEls = allEls.filter((el) => {
                      if ((el as HTMLElement).children.length > 0) return false;
                      const t = (((el as HTMLElement).innerText || el.textContent || '') + '').trim();
                      if (!t || t.length < 4 || t.length > 40) return false;
                      if (!/^[A-Z]/.test(t)) return false;
                      if (propJunk.test(t)) return false;
                      if (/^\d|^[+-]\d/.test(t)) return false;
                      // Must look like a person's name: at least two words, letters/spaces/hyphens/apostrophes
                      if (!/^[A-Za-z][A-Za-z'\-]+\s+[A-Za-z][A-Za-z'\-]+/.test(t)) return false;
                      return true;
                    });

                    for (const el of nameEls) {
                      const name = (((el as HTMLElement).innerText || el.textContent || '') + '').trim();
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

                        if (preferSS && Number.isFinite(line) && line >= 4 && line < 220) {
                          const f = ensure(name);
                          f.line_ss = line;
                          if (overOdds != null) f.ss_over_odds = overOdds;
                          if (underOdds != null) f.ss_under_odds = underOdds;
                          break;
                        }
                        if (preferTD && Number.isFinite(line) && line >= 0 && line < 20) {
                          const f = ensure(name);
                          f.line_td = line;
                          if (overOdds != null) f.td_over_odds = overOdds;
                          if (underOdds != null) f.td_under_odds = underOdds;
                          break;
                        }
                        if (preferFT && Number.isFinite(line) && line > 0 && line <= 30) {
                          const f = ensure(name);
                          f.line_ft = line;
                          if (overOdds != null) f.ft_over_odds = overOdds;
                          if (underOdds != null) f.ft_under_odds = underOdds;
                          break;
                        }
                        break;
                      }
                    }
                  }

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

                    // Subcategory-aware generic text fallback with junk-name filtering.
                    if (!Object.keys(out).length && (preferSS || preferTD || preferFT)) {
                      const propJunkText = /strikes|takedown|fight\s*time|significant|parlay|boost|sgp|promo|category|subcategory|ufc|mma|over|under|more|less/i;
                      const genericRegex = /([A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?)[\s\S]{0,120}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,120}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/g;
                      while ((m = genericRegex.exec(pageText)) !== null) {
                        const name = m[1].trim();
                        const line = parseFloat(m[2]);
                        if (!name || !Number.isFinite(line)) continue;
                        if (propJunkText.test(name)) continue;
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

                  // ── Fight-odds page: scrape moneylines ─────────────────
                  const moneylines: Record<string, number> = {};
                  if (preferML) {
                    // Element-based: look for name elements paired with adjacent odds
                    const nameEls = Array.from(document.querySelectorAll(
                      '[class*="event-cell__name-text"], [class*="participant-name"], [class*="event-cell__name"]'
                    ));
                    for (const el of nameEls) {
                      const name = ((el as HTMLElement).innerText || el.textContent || '').trim();
                      if (!name || name.length < 4 || !/^[A-Z]/.test(name)) continue;
                      // Walk up to find sibling/parent odds button
                      const parent = el.closest('[class*="event-cell"], [class*="participant"]') || el.parentElement;
                      if (!parent) continue;
                      const oddsEl = parent.querySelector('[class*="sportsbook-odds"], [class*="american"], button[aria-label*="odds"]');
                      if (!oddsEl) continue;
                      const oddsText = ((oddsEl as HTMLElement).innerText || oddsEl.textContent || '').replace(/\s/g, '');
                      const oddsMatch = oddsText.match(/^([+-]\d{2,4})$/);
                      if (oddsMatch) {
                        moneylines[name] = parseInt(oddsMatch[1], 10);
                      }
                    }

                    // Text-based fallback: fighter name line followed by odds line
                    if (Object.keys(moneylines).length < 2) {
                      const lines = pageText.split('\n').map((l: string) => l.trim()).filter(Boolean);
                      for (let i = 0; i < lines.length - 1; i++) {
                        const nameMatch = lines[i].match(/^([A-Z][a-zA-Z'\s\-.]{3,35})$/);
                        const oddsMatch = lines[i + 1].match(/^([+-]\d{2,4})$/);
                        if (nameMatch && oddsMatch) {
                          moneylines[nameMatch[1].trim()] = parseInt(oddsMatch[1], 10);
                        }
                      }
                    }
                  }

                  return {
                    fighters: Object.values(out).filter((f: any) => f.line_ss != null || f.line_td != null || f.line_ft != null),
                    moneylines,
                    debug: {
                      pageTextLen: pageText.length,
                      hasSS: /Significant\s+Strikes/i.test(pageText),
                      hasTD: /Takedowns?/i.test(pageText),
                      hasFT: /Fight\s+Time/i.test(pageText),
                      preferML,
                      preferSS,
                      preferTD,
                      preferFT,
                      mlCount: Object.keys(moneylines).length,
                    },
                  };
                },
              });

              const payload = injected?.[0]?.result as any;
              const directFighters = Array.isArray(payload?.fighters) ? payload.fighters : [];
              console.log(`[UFC Auto-Scrape] DraftKings direct scrape debug:`, payload?.debug || {});

              // Merge any DK fight-odds moneylines into the shared odds store
              const dkMLs = payload?.moneylines as Record<string, number> | undefined;
              if (dkMLs && Object.keys(dkMLs).length > 0) {
                await mergeDKMoneylines(dkMLs);
                console.log(`[UFC Auto-Scrape] DraftKings moneylines merged: ${Object.keys(dkMLs).length} fighters`);
              }

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
  scheduledRounds?: number;
  weightClass?: WeightClass;
}

// Map a UFCStats "Weight class" cell string to our internal WeightClass enum.
// Returns null for catchweight/openweight/unknown — those fall through to `default` calibration.
function parseWeightClass(raw: string): WeightClass | null {
  const s = raw.toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const isWomen = /\bwomen/.test(s) || /\bw\s+(?:straw|fly|bantam|feather)weight\b/.test(s);
  if (isWomen) {
    if (/strawweight/.test(s)) return 'womenStrawweight';
    if (/flyweight/.test(s)) return 'womenFlyweight';
    if (/featherweight/.test(s)) return 'womenFeatherweight';
    if (/bantamweight/.test(s)) return 'womenBantamweight';
    return null;
  }
  if (/light\s*heavyweight/.test(s)) return 'lightHeavyweight';
  if (/heavyweight/.test(s)) return 'heavyweight';
  if (/middleweight/.test(s)) return 'middleweight';
  if (/welterweight/.test(s)) return 'welterweight';
  if (/lightweight/.test(s)) return 'lightweight';
  if (/featherweight/.test(s)) return 'featherweight';
  if (/bantamweight/.test(s)) return 'bantamweight';
  if (/flyweight/.test(s)) return 'flyweight';
  return null;
}

interface UpcomingCardCache {
  event: string;
  date: string;
  url: string;
  fighters: UpcomingCardFighter[];
  fetchedAt: number;
  location?: string;
}

function parseEventDateMs(raw: string | null | undefined): number {
  if (!raw) return NaN;
  // UFCStats uses "Apr. 4, 2026" — the period makes Date.parse return NaN in V8.
  const normalized = raw.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./gi, '$1');
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : NaN;
}

function isCardDateUsable(raw: string | null | undefined): boolean {
  const ts = parseEventDateMs(raw);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  // parseEventDateMs returns midnight of event day; UFC fights start ~10 PM event day
  // and end ~1-2 AM the next morning. 30h grace keeps the card usable through fight
  // night and into the morning after, when result absorption typically runs.
  return ts >= now - 30 * 60 * 60 * 1000;
}

async function fetchUpcomingUFCCard(forceRefresh = false): Promise<UpcomingCardCache | null> {
  const hit = await StorageService.getUpcomingCard();
  if (!forceRefresh && hit && hit.fetchedAt && Date.now() - hit.fetchedAt < 2 * 60 * 60 * 1000 && isCardDateUsable(hit.date)) {
    return hit as UpcomingCardCache;
  }

  try {
    const html = await ufcstatsFetchText(CONFIG.api.ufcstats.upcoming);
    if (!html) throw new Error('UFCStats upcoming fetch failed (challenge or network)');

    const events: Array<{ name: string; date: string; url: string; ts: number }> = [];
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rowM of rows) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
      const dateM = row.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d+,\s+\d{4}/i);
      if (!linkM || !nameM || !dateM) continue;
      const ts = parseEventDateMs(dateM[0]);
      if (!Number.isFinite(ts)) continue;
      events.push({ name: nameM[1].trim(), date: dateM[0], url: linkM[1], ts });
    }
    if (!events.length) return null;

    const now = Date.now();
    // Include events within the past 36h so a card that UFCStats moved to the completed
    // page early (e.g. the day before the event) still wins over a distant future card.
    const futureish = events.filter((e) => e.ts >= now - 36 * 60 * 60 * 1000);
    const pool = futureish.length ? futureish : events;
    pool.sort((a, b) => a.ts - b.ts);
    let nextEvent = pool[0];

    // If the nearest event is still >7 days away, check the completed page for a card
    // that is within ±3 days of today (UFCStats sometimes moves cards to completed early).
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    if (!nextEvent || nextEvent.ts - now > sevenDays) {
      try {
        const compHtml = await ufcstatsFetchText(CONFIG.api.ufcstats.completed);
        if (compHtml) {
          const compEvents: Array<{ name: string; date: string; url: string; ts: number }> = [];
          const compRows = [...compHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
          for (const rowM of compRows) {
            const row = rowM[1];
            if (row.includes('<th')) continue;
            const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
            const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
            const dateM = row.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d+,\s+\d{4}/i);
            if (!linkM || !nameM || !dateM) continue;
            const ts = parseEventDateMs(dateM[0]);
            if (!Number.isFinite(ts)) continue;
            compEvents.push({ name: nameM[1].trim(), date: dateM[0], url: linkM[1], ts });
          }
          // Look for an event close to today on the completed page
          const closeEnough = compEvents
            .filter((e) => Math.abs(e.ts - now) < threeDays)
            .sort((a, b) => Math.abs(a.ts - now) - Math.abs(b.ts - now));
          if (closeEnough.length) {
            console.log(`[UFC Card] Upcoming page had no close event; using completed page: ${closeEnough[0].name}`);
            nextEvent = closeEnough[0];
          }
        }
      } catch (e) {
        console.warn('[UFC Card] Completed page fallback failed:', e);
      }
    }

    // Also cache the most recently completed event (within 14 days) for report card ordering
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const recentPast = events
      .filter((e) => e.ts < now && e.ts >= now - fourteenDays)
      .sort((a, b) => b.ts - a.ts);
    if (recentPast.length) {
      const lastEvent = recentPast[0];
      try {
        const lastHtml = await ufcstatsFetchText(lastEvent.url);
        if (lastHtml) {
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

    const evHtml = await ufcstatsFetchText(nextEvent.url);
    if (!evHtml) throw new Error('UFCStats event page fetch failed (challenge or network)');

    // Parse venue location from event detail page
    const locationMatch = evHtml.match(/Location:\s*([^<]+)/i);
    const location = locationMatch?.[1]?.trim() || undefined;
    if (location) console.log(`[UFC Card] Location: ${location}`);

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
      // Extract scheduled rounds and weight class from the td cells.
      // UFCStats event page columns: W/L • Fighter • KD • STR • TD • SUB • Weight class • Method • Round • Time
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
      let scheduledRounds = 3;
      let weightClass: WeightClass | null = null;
      for (const cell of cells) {
        const clean = cell.replace(/<[^>]+>/g, '').trim();
        if (!weightClass) {
          const wc = parseWeightClass(clean);
          if (wc) weightClass = wc;
        }
        if (clean === '5') scheduledRounds = 5;
      }
      fighters.push({ f1, f2, scheduledRounds, weightClass: weightClass ?? undefined });
    }

    const card: UpcomingCardCache = {
      event: nextEvent.name,
      date: nextEvent.date,
      url: nextEvent.url,
      fighters,
      fetchedAt: Date.now(),
      location,
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
      const dateM = row.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d+,\s+\d{4}/i);
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
      const html = await ufcstatsFetchText(src);
      if (!html) continue;
      const evts = parseEventList(html);
      // Check most recent events first (completed page is reverse-chronological)
      const sorted = evts.slice().sort((a, b) => Math.abs(Date.now() - a.ts) - Math.abs(Date.now() - b.ts));
      for (const evt of sorted.slice(0, 8)) {
        try {
          const evHtml = await ufcstatsFetchText(evt.url);
          if (!evHtml) continue;
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

  // ── Line refresh alarm: auto-scrape lines on fight week/day ──
  // Stop refreshing once the event starts (lines are locked in).
  if (now < eventTs) {
    chrome.alarms.clear(LINE_REFRESH_ALARM, () => {
      const hoursUntilEvent = msUntilEvent / (60 * 60 * 1000);
      // Fight day (<24h out): every 45 min. Thu/Fri (1-3 days out): every 90 min.
      // Earlier fight week (3-7 days): every 4h. Beyond 7 days: don't schedule.
      let periodMin: number | null = null;
      if (hoursUntilEvent <= 24)       periodMin = 45;
      else if (hoursUntilEvent <= 72)  periodMin = 90;
      else if (hoursUntilEvent <= 168) periodMin = 240;

      if (periodMin != null) {
        chrome.alarms.create(LINE_REFRESH_ALARM, { delayInMinutes: periodMin, periodInMinutes: periodMin });
        console.log(`[UFC Lines] Line refresh alarm set every ${periodMin} min (${Math.round(hoursUntilEvent)}h until event)`);
      }
    });
  } else {
    chrome.alarms.clear(LINE_REFRESH_ALARM);
  }
}

// Update the extension icon badge with the count of past-event unresolved props.
// Badge is amber with count when pending, cleared when all settled.
async function updatePendingBadge(): Promise<void> {
  try {
    const raw = await new Promise<Record<string, any>>((res) =>
      chrome.storage.local.get(['prop_archive_v1'], res)
    );
    const archive: any[] = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
    const nowTs = Date.now();
    const pendingCount = archive.filter(r =>
      Number.isFinite(Number(r.line)) && Number(r.line) > 0 &&
      !Number.isFinite(Number(r.result)) &&
      Date.parse(r.date) < nowTs
    ).length;
    chrome.action.setBadgeText({ text: pendingCount > 0 ? String(pendingCount) : '' });
    if (pendingCount > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#e8a838' });
    }
  } catch (e) {
    console.warn('[UFC Badge] Failed to update badge:', e);
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
  void updatePendingBadge();
}

// Fire when the scheduled post-event or live alarm triggers
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LINE_REFRESH_ALARM) {
    console.log('[UFC Lines] Auto-refresh alarm fired — scraping all platforms...');
    // Stop refreshing once event has started
    chrome.storage.local.get(['upcoming_ufc_card'], (res) => {
      const card = res?.upcoming_ufc_card as UpcomingCardCache | undefined;
      const eventTs = card?.date ? parseEventDateMs(card.date) : NaN;
      if (Number.isFinite(eventTs) && Date.now() >= eventTs) {
        chrome.alarms.clear(LINE_REFRESH_ALARM);
        console.log('[UFC Lines] Event started — line refresh alarm cleared');
        return;
      }
      autoScrapeAllPlatforms().catch(e => console.error('[UFC Lines] Auto-refresh error:', e));
    });
    return;
  }

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
