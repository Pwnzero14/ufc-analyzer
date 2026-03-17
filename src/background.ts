import {
  StorageService,
  ScraperService,
  LineDropDetector,
} from './services/index.js';
import {
  AllLines,
  LineDropState,
  LineDrop,
} from './types/index.js';
import { CONFIG } from './config/index.js';

// ── IN-MEMORY STORE ────────────────────────────────────────────────────
const store = { pick6: null as any, underdog: null as any, betr: null as any };

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
  }
  return false;
});

function normalizeFighterName(name: any): string | null {
  if (typeof name !== 'string') return null;
  return name.trim().toLowerCase();
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
      if (fighter.opponent != null) merged.opponent = fighter.opponent;
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
  } catch (error) {
    console.error('[UFC] Failed to restore lines:', error);
  }
})();

// ── AUTO-SCRAPE ORCHESTRATION ──────────────────────────────────────────
// Opens tabs for each platform, triggers scraping, closes tabs

const AUTO_SCRAPE_URLS = {
  pick6: CONFIG.platforms.pick6.url,
  underdog: CONFIG.platforms.underdog.url,
};

let autoScrapeInProgress = false;

async function autoScrapeAllPlatforms(): Promise<any> {
  if (autoScrapeInProgress) {
    return { status: 'already_running' };
  }

  autoScrapeInProgress = true;
  const results: Record<string, number> = {};
  const tabsToClose: number[] = [];

  try {
    for (const [platform, url] of Object.entries(AUTO_SCRAPE_URLS)) {
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabsToClose.push(tab.id!);

        // Wait for tab to load
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, info: any) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(resolve, 15000); // Fallback
        });

        // Wait for rendering
        await new Promise((r) => setTimeout(r, 3000));

        // Inject scraper
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          files: ['dist/content.js'],
        });

        // Wait for results
        await new Promise((r) => setTimeout(r, 5000));

        const count = store[platform as keyof typeof store]?.fighters?.length || 0;
        results[platform] = count;
        console.log(`[UFC Auto-Scrape] ${platform}: ${count} fighters`);
      } catch (error) {
        console.error(`[UFC Auto-Scrape] Error scraping ${platform}:`, error);
        results[platform] = 0;
      }
    }
  } finally {
    // Close all tabs
    for (const tabId of tabsToClose) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        // Already closed
      }
    }
    autoScrapeInProgress = false;
  }

  return { status: 'done', results };
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

// ── INLINE LINE DROP DETECTION & MONITORING ────────────────────────────

const LINE_DROP_STATE = {
  watching: false,
  lastP6Count: 0,
  lastUDCount: 0,
  detectedAt: null as number | null,
  eventDate: null as string | null,
  eventName: null as string | null,
  detectedUD: null as number | null,
  detectedP6: null as number | null,
  lastPollAt: null as number | null,
  daysUntil: 0,
  _currentPollMins: 30,
} as LineDropState;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CONFIG.polling.storage.pollAlarmName) return;

  const saved = await StorageService.getLineDropState();
  if (!saved?.watching) {
    chrome.alarms.clear(CONFIG.polling.storage.pollAlarmName);
    return;
  }

  Object.assign(LINE_DROP_STATE, saved);
  await pollForLineDrops();

  // Recalculate poll interval
  if (LINE_DROP_STATE.eventDate) {
    const eventMs = new Date(LINE_DROP_STATE.eventDate).getTime();
    const daysUntil = (eventMs - Date.now()) / 86400000;
    const update = LineDropDetector.shouldUpdatePollRate(LINE_DROP_STATE, daysUntil);

    if (update.shouldUpdate && update.newMinutes) {
      chrome.alarms.clear(CONFIG.polling.storage.pollAlarmName);
      chrome.alarms.create(CONFIG.polling.storage.pollAlarmName, {
        periodInMinutes: update.newMinutes,
      });
      LINE_DROP_STATE._currentPollMins = update.newMinutes;
      await StorageService.setLineDropState(LINE_DROP_STATE);
      console.log(
        `[UFC LineWatch] Poll rate updated: ${LINE_DROP_STATE._currentPollMins}min → ${update.newMinutes}min`
      );
    }
  }
});

async function pollForLineDrops(): Promise<void> {
  const saved = await StorageService.getLineDropState();
  Object.assign(LINE_DROP_STATE, saved || {});

  if (!LINE_DROP_STATE.watching) return;

  const eventMs = LINE_DROP_STATE.eventDate ? new Date(LINE_DROP_STATE.eventDate).getTime() : null;
  if (!eventMs || isNaN(eventMs)) {
    console.log('[UFC LineWatch] No valid event date');
    return;
  }

  const daysUntil = (eventMs - Date.now()) / 86400000;

  if (LineDropDetector.isOutsideWindow(daysUntil)) {
    console.log(`[UFC LineWatch] Outside window (${daysUntil.toFixed(1)}d out), skipping poll`);
    return;
  }

  const schedule = LineDropDetector.getPlatformSchedule(eventMs);
  const udCount = await LineDropDetector.quickCheckUnderdogLines();
  const p6Count = store.pick6?.fighters?.length || 0;
  const prevUD = LINE_DROP_STATE.lastUDCount;
  const prevP6 = LINE_DROP_STATE.lastP6Count;

  LINE_DROP_STATE.lastUDCount = udCount;
  LINE_DROP_STATE.lastP6Count = p6Count;
  LINE_DROP_STATE.lastPollAt = Date.now();
  LINE_DROP_STATE.daysUntil = parseFloat(daysUntil.toFixed(2));

  LineDropDetector.logPollStatus(daysUntil, schedule, udCount, prevUD, p6Count, prevP6);

  const drops = LineDropDetector.detectDrops(
    schedule,
    udCount,
    prevUD,
    p6Count,
    prevP6,
    LINE_DROP_STATE.detectedUD ?? null,
    LINE_DROP_STATE.detectedP6 ?? null
  );

  if (drops.length > 0) {
    LineDropDetector.logLineDrops(drops);

    // Set badge
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7030' });

    // Notify analyzer
    notifyAnalyzerTabs({
      type: 'LINES_DROPPED',
      drops,
      udCount,
      p6Count,
      event: LINE_DROP_STATE.eventName,
      daysUntilEvent: parseFloat(daysUntil.toFixed(1)),
      detectedAt: Date.now(),
    });

    // Auto-scrape
    autoScrapeAllPlatforms().catch((e) => {
      console.error('[LineWatch] Auto-scrape error:', e);
    });

    // Update state
    if (drops.some((d) => d.platform === 'Underdog')) {
      LINE_DROP_STATE.detectedUD = Date.now();
    }
    if (drops.some((d) => d.platform === 'Pick6')) {
      LINE_DROP_STATE.detectedP6 = Date.now();
    }
  }

  await StorageService.setLineDropState({ ...LINE_DROP_STATE });
}

function startLineWatcher(eventName: string, eventDateStr: string): void {
  if (LINE_DROP_STATE.watching) stopLineWatcher();

  const eventMs = new Date(eventDateStr).getTime();
  const daysUntil = isNaN(eventMs) ? 3 : (eventMs - Date.now()) / 86400000;
  const pollMins = LineDropDetector.getPollIntervalMinutes(daysUntil) || 30;

  Object.assign(LINE_DROP_STATE, {
    watching: true,
    eventName,
    eventDate: eventDateStr,
    detectedUD: null,
    detectedP6: null,
    lastUDCount: 0,
    lastP6Count: 0,
    lastPollAt: null,
    daysUntil,
    _currentPollMins: pollMins,
  });

  LineDropDetector.logWatcherStart(eventName, eventDateStr, daysUntil, pollMins);

  chrome.alarms.create(CONFIG.polling.storage.pollAlarmName, { periodInMinutes: pollMins });
  StorageService.setLineDropState({ ...LINE_DROP_STATE }).catch((e) => {
    console.error('[UFC] Failed to save line drop state:', e);
  });
}

function stopLineWatcher(): void {
  Object.assign(LINE_DROP_STATE, { watching: false, detectedUD: null, detectedP6: null });
  chrome.alarms.clear(CONFIG.polling.storage.pollAlarmName);
  StorageService.clearLineDropState().catch((e) => {
    console.error('[UFC] Failed to clear line drop state:', e);
  });
  LineDropDetector.logWatcherStop();
}

// Restore watcher on service worker restart
(async () => {
  const saved = await StorageService.getLineDropState();
  if (saved?.watching) {
    Object.assign(LINE_DROP_STATE, saved);
    console.log('[UFC LineWatch] Restored from storage');
  }
})();

// Export for testing
(globalThis as any).ufc_data = {
  store,
  LINE_DROP_STATE,
  startLineWatcher,
  stopLineWatcher,
};
