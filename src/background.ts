import {
  StorageService,
  ScraperService,
} from './services/index.js';
import {
  AllLines,
} from './types/index.js';
import { CONFIG } from './config/index.js';

// ── IN-MEMORY STORE ────────────────────────────────────────────────────
const store = { pick6: null as any, underdog: null as any, betr: null as any };

// ── INITIALIZE BETR LINES FROM MANUAL INPUT ────────────────────────────
async function initializeBetrLines() {
  const betrFighters = [
    // Fantasy Pts (FP)
    { name: 'I. Baraniewski', opponent: 'A. Lane', line_ss: null, line_fp: 106.5, line_td: null },
    { name: 'L. Riley', opponent: 'M. Aswell', line_ss: 68.5, line_fp: 77.5, line_td: null },
    { name: 'M. Evloev', opponent: 'L. Murphy', line_ss: 66.5, line_fp: 89.5, line_td: null },
    { name: 'R. Oliveira', opponent: 'S. Dyer', line_ss: null, line_fp: 50.5, line_td: null },
    { name: 'M. Pinto', opponent: 'Franco', line_ss: null, line_fp: 106.5, line_td: null },
    { name: 'M. Kondratavičius', opponent: 'Trocoli', line_ss: null, line_fp: 103.5, line_td: null },
    { name: 'C. Duncan', opponent: 'R. Dolidze', line_ss: 49.5, line_fp: 85.5, line_td: null },
    { name: 'R. Dolidze', opponent: 'C. Duncan', line_ss: 28.5, line_fp: 50.5, line_td: null },
    
    // Sig Strikes (SS) only
    { name: 'S. Dyer', opponent: 'R. Oliveira', line_ss: 81.5, line_fp: null, line_td: null },
    { name: 'K. Campbell', opponent: 'D. Silva', line_ss: 63.5, line_fp: null, line_td: null },
    { name: 'D. Silva', opponent: 'K. Campbell', line_ss: 58.5, line_fp: null, line_td: null },
    { name: 'L. Murphy', opponent: 'M. Evloev', line_ss: 56.5, line_fp: null, line_td: null },
    { name: 'M. Aswell', opponent: 'L. Riley', line_ss: 101.0, line_fp: null, line_td: null },
    { name: 'A. Lane', opponent: 'I. Baraniewski', line_ss: null, line_fp: null, line_td: null },
  ];
  
  store.betr = {
    fighters: betrFighters,
    capturedAt: Date.now(),
  };
  
  // Persist to Chrome storage
  try {
    await StorageService.setLines('betr', betrFighters);
    console.log('[UFC] Initialized and persisted Betr lines:', betrFighters.length, 'fighters');
  } catch (error) {
    console.error('[UFC] Failed to persist Betr lines:', error);
  }
}

// ── INCOMING LINES FROM CONTENT SCRIPT ────────────────────────────────
// Content script sends LINES_CAPTURED messages with scraped fighter data

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'LINES_CAPTURED') {
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
    fetchUpcomingUFCCard()
      .then((card) => sendResponse({ card }))
      .catch((e) => {
        console.error('[UFC] GET_UPCOMING_CARD error:', e);
        sendResponse({ card: null });
      });
    return true;
  } else if (request.type === 'ADD_BETR_LINES') {
    // Manually add Betr lines
    if (request.fighters && Array.isArray(request.fighters)) {
      store.betr = {
        fighters: request.fighters,
        capturedAt: Date.now(),
      };
      sendResponse({ ok: true, count: request.fighters.length });
    } else {
      sendResponse({ ok: false, error: 'Invalid fighters format' });
    }
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

function mergeFighters(
  existing: Array<any> = [],
  incoming: Array<any> = []
): Array<any> {
  const map = new Map<string, any>();

  const push = (fighter: any) => {
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
      const cleanOpponent = sanitizeOpponentName(fighter.opponent, fighter.name);
      if (cleanOpponent != null) merged.opponent = cleanOpponent;
      map.set(key, merged);
    }
  };

  console.log(`[UFC] mergeFighters - existing names:`, existing.map(f => `"${f?.name}"`).join(', '));
  console.log(`[UFC] mergeFighters - incoming names:`, incoming.map(f => `"${f?.name}"`).join(', '));

  existing.forEach(push);
  incoming.forEach(push);

  const result = Array.from(map.values());
  console.log(`[UFC] mergeFighters - merged names:`, result.map(f => `"${f?.name}"`).join(', '));
  return result;
}

async function handleLinesCaptured(platform: string, data: any): Promise<void> {
  try {
    if (!data?.fighters || !Array.isArray(data.fighters)) return;

    // Get current stored data from chrome.storage (source of truth)
    const platformKey = platform as 'pick6' | 'underdog' | 'betr';
    const allStored = await StorageService.getLines();
    const stored = allStored[platformKey];
    const existing = stored?.fighters || [];
    const mergedFighters = mergeFighters(existing, data.fighters);

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
  await StorageService.clearLines();
}

// ── RESTORE PERSISTED DATA ON STARTUP ──────────────────────────────────

(async () => {
  try {
    const lines = await StorageService.getLines();
    if (lines.pick6) store.pick6 = lines.pick6;
    if (lines.underdog) store.underdog = lines.underdog;
    if (lines.betr) store.betr = lines.betr;
    console.log('[UFC] Restored persisted lines on startup');
    
    // Initialize or refresh Betr lines if missing or outdated
    if (!lines.betr || (lines.betr?.fighters?.length || 0) < 14) {
      console.log('[UFC] Refreshing Betr lines (expected 14, got', lines.betr?.fighters?.length || 0, ')');
      await initializeBetrLines();
    }
  } catch (error) {
    console.error('[UFC] Failed to restore lines:', error);
  }
})();

// ── AUTO-SCRAPE ORCHESTRATION ──────────────────────────────────────────
// Opens tabs for each platform, triggers scraping, closes tabs

const AUTO_SCRAPE_URLS: Record<'pick6'|'underdog', string[]> = {
  pick6: [
    // Fantasy Points page first
    CONFIG.platforms.pick6.url,
    // SS props page (Pick6 UFC sports)
    'https://pick6.draftkings.com/?sport=UFC',
    // TD props page
    'https://pick6.draftkings.com/category/47?sport=UFC&pickGroup=143952',
  ],
  underdog: [
    // Prioritize stat-specific pages first so SS/TD capture completes quickly.
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA?filter_id=8cbf8104-618b-435d-a5c5-ba71d8912a20&filter_type=PickemStat',
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA?filter_id=17cfbc8d-3c16-46b8-abc9-4ca34e546be4&filter_type=PickemStat',
    CONFIG.platforms.underdog.url,
    'https://app.underdogfantasy.com/pick-em/higher-lower/all/MMA',
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
  const total = fighters.length;
  const fpCount = fighters.filter((f) => f.line_fp != null).length;
  const ssCount = fighters.filter((f) => f.line_ss != null).length;
  const tdCount = fighters.filter((f) => f.line_td != null).length;
  const allThreeCount = fighters.filter((f) => f.line_fp != null && f.line_ss != null && f.line_td != null).length;
  return { total, fpCount, ssCount, tdCount, allThreeCount };
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
  const minTotal = Math.max(10, Math.floor(expectedFighters * 0.6));
  const minByStat = Math.max(5, Math.floor(minTotal * 0.4));
  const minAllThree = Math.max(3, Math.floor(minTotal * 0.2));
  return (
    coverage.total >= minTotal
    && coverage.fpCount >= minByStat
    && coverage.ssCount >= minByStat
    && coverage.tdCount >= minByStat
    && coverage.allThreeCount >= minAllThree
  );
}

function parseUnderdogApiFighters(data: any): Array<{ name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; opponent: string | null }> {
  const fighters: Record<string, { name: string; line_fp: number | null; line_ss: number | null; line_td: number | null; opponent: string | null }> = {};
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
    let lineType: 'fp'|'ss'|'td'|null = null;
    if (title.includes('significant strike') || title === 'significant strikes') lineType = 'ss';
    else if (title.includes('takedown') && !title.includes('def')) lineType = 'td';
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

    if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent: opponent || null };
    fighters[name][`line_${lineType}`] = statValue;
    if (opponent) fighters[name].opponent = opponent;
  }

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null);
}

async function fetchUnderdogFromBackground(): Promise<UnderdogCoverage> {
  const endpoints = CONFIG.api.underdog || [];
  let mergedFighters = store.underdog?.fighters || [];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      const fighters = parseUnderdogApiFighters(data);
      if (!fighters.length) continue;

      mergedFighters = mergeFighters(mergedFighters, fighters);
      const coverage = getUnderdogStatCoverage(mergedFighters);
      console.log(`[UFC Auto-Scrape] underdog API endpoint: ${url} → fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
    } catch (e) {
      console.warn('[UFC Auto-Scrape] underdog API failed for endpoint:', url, e);
    }
  }

  if (mergedFighters.length) {
    store.underdog = { fighters: mergedFighters, capturedAt: Date.now() };
    await StorageService.setLines('underdog', mergedFighters);
    notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform: 'underdog', count: mergedFighters.length });
  }
  return getUnderdogStatCoverage(mergedFighters);
}

async function waitForPlatformCapture(
  platform: keyof typeof store,
  baselineCount: number,
  baselineCapturedAt: number,
  timeoutMs: number,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = store[platform]?.fighters?.length || 0;
    const capturedAt = store[platform]?.capturedAt || 0;
    // Count may stay flat across SS/TD tabs; capturedAt change still means new payload merged.
    if (count > baselineCount || capturedAt > baselineCapturedAt) return count;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return store[platform]?.fighters?.length || 0;
}

async function autoScrapeAllPlatforms(): Promise<any> {
  if (autoScrapeInProgress) {
    return { status: 'already_running' };
  }

  autoScrapeInProgress = true;
  const results: Record<string, number> = {};
  const attempts: Record<string, { method: 'api' | 'tab' | 'skip'; url: string; count: number }[]> = {};
  let expectedUnderdogFighters = 20;
  let preservedBetr: any = null;

  try {
    // Preserve manually-entered Betr lines — we never clear betr during auto-fetch
    preservedBetr = store.betr;

    try {
      const card = await fetchUpcomingUFCCard();
      if (card?.fighters?.length) {
        expectedUnderdogFighters = Math.max(12, card.fighters.length * 2);
      }
    } catch {
      // Keep default expectation if card lookup fails.
    }

    const orderedPlatforms: Array<keyof typeof AUTO_SCRAPE_URLS> = ['underdog', 'pick6'];
    for (const platform of orderedPlatforms) {
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
        const hasEnoughCoverage = hasEnoughUnderdogStatCoverage(api, expectedUnderdogFighters);
        if (api.total > 0 && hasEnoughCoverage) {
          results[platform] = bestCount;
          continue;
        }
      }

      if (platform === 'pick6') {
        const shouldAttempt = await shouldAttemptPick6Scrape();
        if (!shouldAttempt) {
          attempts[platform].push({ method: 'skip', url: 'pick6 skipped: props likely not posted yet', count: 0 });
          results[platform] = 0;
          continue;
        }
      }

      const uniqueUrls = Array.from(new Set(urls));
      for (const url of uniqueUrls) {
        if (platform === 'underdog') {
          const currentCoverage = getUnderdogStatCoverage(store.underdog?.fighters || []);
          if (hasEnoughUnderdogStatCoverage(currentCoverage, expectedUnderdogFighters)) {
            console.log(`[UFC Auto-Scrape] underdog coverage complete early: fighters=${currentCoverage.total}, fp=${currentCoverage.fpCount}, ss=${currentCoverage.ssCount}, td=${currentCoverage.tdCount}, all3=${currentCoverage.allThreeCount}`);
            break;
          }
        } else if (platform === 'pick6') {
          const pick6Coverage = getUnderdogStatCoverage(store.pick6?.fighters || []);
          if (hasEnoughPick6StatCoverage(pick6Coverage, expectedUnderdogFighters)) {
            console.log(`[UFC Auto-Scrape] pick6 coverage complete early: fighters=${pick6Coverage.total}, fp=${pick6Coverage.fpCount}, ss=${pick6Coverage.ssCount}, td=${pick6Coverage.tdCount}, all3=${pick6Coverage.allThreeCount}`);
            break;
          }
        }

        let tabId: number | null = null;
        try {
          const baselineCount = store[platform]?.fighters?.length || 0;
          const baselineCapturedAt = store[platform]?.capturedAt || 0;
          const tab = await chrome.tabs.create({ url, active: false });
          tabId = tab.id ?? null;

          // Wait for tab to load
          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: any) => {
              if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(resolve, 15000);
          });

          // Content script already auto-runs via manifest.json declaration on these URLs
          // Just wait briefly for initial DOM rendering to stabilize
          await new Promise((r) => setTimeout(r, 1500));

          // Wait for content script to capture lines (scraper can run for ~35s).
          // Do not inject manually — rely on manifest auto-injection for speed
          const timeoutMs = platform === 'underdog' ? 12000 : 30000;
          const count = await waitForPlatformCapture(
            platform as keyof typeof store,
            baselineCount,
            baselineCapturedAt,
            timeoutMs,
          );
          attempts[platform].push({ method: 'tab', url, count });
          if (count > bestCount) bestCount = count;
          console.log(`[UFC Auto-Scrape] ${platform} via ${url}: ${count} fighters`);

          if (platform === 'underdog') {
            const coverage = getUnderdogStatCoverage(store.underdog?.fighters || []);
            console.log(`[UFC Auto-Scrape] underdog coverage after tab: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
            if (hasEnoughUnderdogStatCoverage(coverage, expectedUnderdogFighters)) {
              break;
            }
          } else if (platform === 'pick6') {
            const coverage = getUnderdogStatCoverage(store.pick6?.fighters || []);
            console.log(`[UFC Auto-Scrape] pick6 coverage after tab: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, all3=${coverage.allThreeCount}`);
            if (hasEnoughPick6StatCoverage(coverage, expectedUnderdogFighters)) {
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
    }
  } finally {
    autoScrapeInProgress = false;
    // Restore manually-entered Betr lines
    if (preservedBetr?.fighters?.length) {
      store.betr = preservedBetr;
      await StorageService.setLines('betr', preservedBetr.fighters);
      notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform: 'betr', count: preservedBetr.fighters.length });
    }
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
  // Accept event dates from yesterday onward to avoid stale old cards.
  return ts >= now - 24 * 60 * 60 * 1000;
}

async function fetchUpcomingUFCCard(): Promise<UpcomingCardCache | null> {
  const hit = await StorageService.getUpcomingCard();
  if (hit && hit.fetchedAt && Date.now() - hit.fetchedAt < 2 * 60 * 60 * 1000 && isCardDateUsable(hit.date)) {
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
    const futureish = events.filter((e) => e.ts >= now - 24 * 60 * 60 * 1000);
    const pool = futureish.length ? futureish : events;
    pool.sort((a, b) => a.ts - b.ts);
    const nextEvent = pool[0];

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
    return card;
  } catch (e) {
    console.error('[UFC] fetchUpcomingUFCCard failed:', e);
    return null;
  }
}

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
