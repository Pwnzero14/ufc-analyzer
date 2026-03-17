const store = { pick6: null, underdog: null, betr: null, prizepicks: null };

// ── LINE DROP DETECTOR ────────────────────────────────────────────────────
// Monitors Pick6 (DraftKings) and Underdog APIs every 5 min.
// When UFC lines appear that weren't there before, fires an auto-scrape
// and notifies any open analyzer tabs via chrome.tabs.sendMessage.

const LINE_DROP_STATE = {
  watching: false,
  lastP6Count: 0,
  lastUDCount: 0,
  lastPPCount: 0,
  detectedAt: null,
  detectedUD: null,
  detectedP6: null,
  detectedPP: null,
  lastP6ScrapedAt: null,
  eventDate: null,
  eventName: null,
};

async function quickCheckUnderdogLines() {
  const endpoints = [
    'https://api.underdogfantasy.com/v2/over_under_lines',
    'https://api.underdogfantasy.com/v1/over_under_lines',
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const lines = Object.values(data.over_under_lines || {});
      const appearances = data.appearances || {};
      let mmaCount = 0;
      lines.forEach(line => {
        const val = parseFloat(line.stat_value);
        if (isNaN(val) || val < 20 || val > 400) return;
        const title = (line.title || line.stat || line.display_stat || '').toLowerCase();
        if (title.includes('strike') || title.includes('takedown') || title.includes('round')) return;
        const app = appearances[line.appearance_id] || {};
        const sport = app.sport || '';
        if (sport && !/ufc|mma/i.test(sport)) return;
        mmaCount++;
      });
      return mmaCount;
    } catch(e) { /* continue */ }
  }
  return 0;
}

// ── PRIZEPICKS API ────────────────────────────────────────────────────────
// PrizePicks has a public API — no auth required, no tab needed.
const PP_API = 'https://api.prizepicks.com/projections?league_id=9&per_page=250&single_stat=true&include=new_player';

function parsePrizePicksResponse(data) {
  const fighters = {};
  try {
    const playerMap = {};
    (data.included || []).forEach(item => {
      if (item.type === 'new_player') playerMap[item.id] = item.attributes;
    });
    (data.data || []).forEach(proj => {
      if (proj.type !== 'Projection') return;
      const attrs = proj.attributes || {};
      const lineScore = parseFloat(attrs.line_score);
      if (isNaN(lineScore) || lineScore <= 0) return;
      const statType = (attrs.stat_type || '').toLowerCase();
      let lineField = null;
      if (statType.includes('fantasy') || statType.includes('pts')) {
        if (lineScore < 20 || lineScore > 400) return;
        lineField = 'line_fp';
      } else if (statType.includes('strike')) {
        if (lineScore < 5 || lineScore > 350) return;
        lineField = 'line_ss';
      } else if (statType.includes('takedown')) {
        if (lineScore < 0 || lineScore > 20) return;
        lineField = 'line_td';
      }
      if (!lineField) return;
      const playerId = proj.relationships?.new_player?.data?.id || attrs.new_player_id;
      if (!playerId) return;
      const player = playerMap[playerId];
      if (!player) return;
      const name = player.name || player.display_name;
      if (!name) return;
      // Filter to MMA only — PrizePicks league_id=9 should only return MMA but double-check
      const league = (player.league || player.sport || player.team_name || '').toUpperCase();
      if (league && !/MMA|UFC|FIGHT/i.test(league) && league.length > 2) return;
      const opponent = player.opponent_name || player.opponent || null;
      if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
      fighters[name][lineField] = lineScore;
      if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
    });
  } catch (e) { console.log('[PP parse error]', e.message); }
  return Object.values(fighters).filter(f => f.line_fp != null || f.line_ss != null || f.line_td != null);
}

async function quickCheckPrizePicksLines() {
  try {
    const res = await fetch(PP_API, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 0;
    const data = await res.json();
    // Count unique fighters from included players
    const players = (data.included || []).filter(x => x.type === 'new_player');
    return players.length > 0 ? players.length : Math.ceil((data.data || []).length / 3);
  } catch(e) { return 0; }
}

async function fetchPrizePicksFromBackground() {
  try {
    const res = await fetch(PP_API, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) { console.log('[PP] API error:', res.status); return 0; }
    const data = await res.json();
    const fighters = parsePrizePicksResponse(data);
    if (fighters.length > 0) {
      store.prizepicks = { fighters, capturedAt: Date.now() };
      chrome.storage.local.set({ lines_prizepicks: store.prizepicks });
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#4ae87a' });
      console.log(`[PP] Fetched ${fighters.length} fighters`);
      return fighters.length;
    }
  } catch(e) { console.log('[PP fetch error]', e.message); }
  return 0;
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function notifyAnalyzerTabs(msg) {
  const analyzerUrl = chrome.runtime.getURL('analyzer.html');
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (!tab.url) return;
      // Only notify open analyzer tabs (extension UI) to reduce noise
      if (tab.url === analyzerUrl || tab.url.startsWith(analyzerUrl)) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    });
  });
}

// ── REAL LINE DROP SCHEDULE (corrected) ──────────────────────────────────
// Event is always SATURDAY. Lines drop on these days:
//   MONDAY    → Underdog SS/TD + PrizePicks SS/TD
//   WEDNESDAY → Pick6 (DraftKings Fantasy) FP lines
//   THURSDAY  → Pick6 FP (if not Wed), Betr FP starts, PP FP sometimes
//   FRIDAY    → Betr FP (latest), PrizePicks FP (latest)
//   NOTE: FP lines do NOT drop Monday. SS/TD are the Monday lines.

function getPlatformSchedule(eventSaturdayMs) {
  const daysUntil = (eventSaturdayMs - Date.now()) / 86400000;
  const schedule = [];
  // Sunday afternoon (6.5 days before Sat) is when UD/PP SS+TD first appear
  if (daysUntil <= 6.5) {
    schedule.push({ platform: 'underdog',   type: 'ss_td', label: 'Underdog SS/TD' });
    schedule.push({ platform: 'prizepicks', type: 'ss_td', label: 'PrizePicks SS/TD' });
  }
  // Wednesday: Pick6 FP (3.5 days before Sat)
  if (daysUntil <= 3.5) {
    schedule.push({ platform: 'pick6', type: 'fp', label: 'Pick6 FP' });
  }
  // Thursday-Friday: Betr FP + PrizePicks FP (2.5 days before Sat)
  if (daysUntil <= 2.5) {
    schedule.push({ platform: 'betr',       type: 'fp', label: 'Betr FP' });
    schedule.push({ platform: 'prizepicks', type: 'fp', label: 'PrizePicks FP' });
  }
  return schedule;
}

// Adaptive poll rate — slow on Sunday, tightens as each drop window opens:
//   >6.5 days  → null  (too early, outside window)
//   5.5-6.5    → 60min (Sunday: watching for afternoon SS/TD drop)
//   4-5.5      → 30min (Monday: lines populating, more fighters added)
//   2.5-4      → 15min (Wed: Pick6 FP expected)
//   0-2.5      → 5min  (Thu-Fri: Betr + PP FP, event approaching)
function getPollIntervalMinutes(daysUntil) {
  if (daysUntil > 6.5) return null;
  if (daysUntil > 5.5) return 60;
  if (daysUntil > 4)   return 30;
  if (daysUntil > 2.5) return 15;
  return 5;
}

async function pollForLineDrops() {
  const saved = await storageGet(['line_drop_state']);
  Object.assign(LINE_DROP_STATE, saved.line_drop_state || {});
  if (!LINE_DROP_STATE.watching) return;

  const eventMs = LINE_DROP_STATE.eventDate ? new Date(LINE_DROP_STATE.eventDate).getTime() : null;
  if (!eventMs || isNaN(eventMs)) { console.log('[UFC LineWatch] No valid event date'); return; }

  const daysUntil = (eventMs - Date.now()) / 86400000;
  if (daysUntil > 6.5 || daysUntil < -1) {
    console.log(`[UFC LineWatch] Outside window (${daysUntil.toFixed(1)}d out), skipping poll`);
    return;
  }

  const schedule = getPlatformSchedule(eventMs);
  const udCount  = await quickCheckUnderdogLines();
  const ppCount  = await quickCheckPrizePicksLines();
  const p6Count  = store.pick6?.fighters?.length || 0;
  const prevUD   = LINE_DROP_STATE.lastUDCount || 0;
  const prevP6   = LINE_DROP_STATE.lastP6Count || 0;
  const prevPP   = LINE_DROP_STATE.lastPPCount || 0;

  LINE_DROP_STATE.lastUDCount = udCount;
  LINE_DROP_STATE.lastP6Count = p6Count;
  LINE_DROP_STATE.lastPPCount = ppCount;
  LINE_DROP_STATE.lastPollAt  = Date.now();
  LINE_DROP_STATE.daysUntil   = parseFloat(daysUntil.toFixed(2));

  console.log(`[UFC LineWatch] ${daysUntil.toFixed(1)}d out | UD:${udCount}(${prevUD}) P6:${p6Count}(${prevP6}) PP:${ppCount}(${prevPP}) | ${schedule.map(e=>e.label).join(', ')}`);

  const drops = [];

  // Underdog + PrizePicks SS/TD (Sunday/Monday window)
  if (schedule.find(e => e.platform === 'underdog') && !LINE_DROP_STATE.detectedUD) {
    if ((udCount > 3 && prevUD === 0) || udCount > prevUD + 4) {
      LINE_DROP_STATE.detectedUD = Date.now();
      drops.push({ platform: 'Underdog', type: 'SS/TD', count: udCount });
    }
  }
  if (schedule.find(e => e.platform === 'prizepicks') && !LINE_DROP_STATE.detectedPP) {
    if ((ppCount > 3 && prevPP === 0) || ppCount > prevPP + 4) {
      LINE_DROP_STATE.detectedPP = Date.now();
      drops.push({ platform: 'PrizePicks', type: 'SS/TD', count: ppCount });
    }
  }

  // Pick6 FP (Wednesday window) — auto-scrape if in window and no data yet
  if (schedule.find(e => e.platform === 'pick6')) {
    if (!LINE_DROP_STATE.detectedP6) {
      if (p6Count > 0 && ((p6Count > 3 && prevP6 === 0) || p6Count > prevP6 + 4)) {
        LINE_DROP_STATE.detectedP6 = Date.now();
        drops.push({ platform: 'Pick6', type: 'FP', count: p6Count });
      } else if (p6Count === 0) {
        // In Pick6 window but no data — trigger a background tab scrape (max once per hour)
        const lastScrape = LINE_DROP_STATE.lastP6ScrapedAt || 0;
        if (Date.now() - lastScrape > 3600000) {
          LINE_DROP_STATE.lastP6ScrapedAt = Date.now();
          console.log('[LineWatch] P6 in window, no data — triggering scrape');
          autoScrapeAllPlatforms().then(r => {
            const newP6 = store.pick6?.fighters?.length || 0;
            if (newP6 > 0 && !LINE_DROP_STATE.detectedP6) {
              LINE_DROP_STATE.detectedP6 = Date.now();
              notifyAnalyzerTabs({ type: 'LINES_DROPPED', drops: [{ platform: 'Pick6', type: 'FP', count: newP6 }], udCount, p6Count: newP6, ppCount, event: LINE_DROP_STATE.eventName, daysUntilEvent: parseFloat(daysUntil.toFixed(1)), detectedAt: Date.now() });
              chrome.storage.local.set({ line_drop_state: { ...LINE_DROP_STATE } });
            }
          }).catch(e => console.log('[LineWatch] P6 scrape error:', e.message));
        }
      }
    }
  }

  // PrizePicks FP (Thursday-Friday window)
  if (schedule.find(e => e.platform === 'prizepicks' && e.type === 'fp') && !LINE_DROP_STATE.detectedPPfp) {
    if (ppCount > prevPP) {
      LINE_DROP_STATE.detectedPPfp = Date.now();
      drops.push({ platform: 'PrizePicks', type: 'FP', count: ppCount });
    }
  }

  if (drops.length > 0) {
    console.log(`[UFC LineWatch] LINE DROP:`, drops.map(d=>`${d.platform} ${d.type}(${d.count})`).join(', '));
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7030' });
    notifyAnalyzerTabs({ type: 'LINES_DROPPED', drops, udCount, p6Count, ppCount, event: LINE_DROP_STATE.eventName, daysUntilEvent: parseFloat(daysUntil.toFixed(1)), detectedAt: Date.now() });
    autoScrapeAllPlatforms().catch(e => console.log('[LineWatch] scrape error:', e.message));
  }

  chrome.storage.local.set({ line_drop_state: { ...LINE_DROP_STATE } });
}

function startLineWatcher(eventName, eventDateStr) {
  if (LINE_DROP_STATE.watching) stopLineWatcher();
  const eventMs  = new Date(eventDateStr).getTime();
  const daysUntil = isNaN(eventMs) ? 3 : (eventMs - Date.now()) / 86400000;
  const pollMins = getPollIntervalMinutes(daysUntil) || 30;
  Object.assign(LINE_DROP_STATE, {
    watching: true, eventName, eventDate: eventDateStr,
    detectedUD: null, detectedP6: null,
    lastUDCount: 0, lastP6Count: 0, lastPollAt: null, daysUntil,
    _currentPollMins: pollMins,
  });
  console.log(`[UFC LineWatch] Started — "${eventName}" ${eventDateStr} (${daysUntil.toFixed(1)}d out) | Poll: ${pollMins}min`);
  console.log(`[UFC LineWatch] Schedule: Mon=UD/PP SS+TD · Wed=Pick6 FP · Thu-Fri=Betr+PP FP`);
  chrome.alarms.create('ufc_line_poll', { periodInMinutes: pollMins });
  chrome.storage.local.set({ line_drop_state: { ...LINE_DROP_STATE } });
}

function stopLineWatcher() {
  Object.assign(LINE_DROP_STATE, { watching: false, detectedUD: null, detectedP6: null });
  chrome.alarms.clear('ufc_line_poll');
  chrome.storage.local.remove('line_drop_state');
  console.log('[UFC LineWatch] Stopped.');
}

// Alarm handler — poll and dynamically adjust rate as event approaches
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'ufc_line_poll') return;
  const saved = await new Promise(r => chrome.storage.local.get(['line_drop_state'], r));
  const s = saved.line_drop_state;
  if (!s?.watching) { chrome.alarms.clear('ufc_line_poll'); return; }
  Object.assign(LINE_DROP_STATE, s);
  await pollForLineDrops();
  // Recalculate poll interval — accelerates as event gets closer
  if (LINE_DROP_STATE.eventDate) {
    const daysUntil = (new Date(LINE_DROP_STATE.eventDate).getTime() - Date.now()) / 86400000;
    const newMins = getPollIntervalMinutes(daysUntil);
    if (!newMins) { chrome.alarms.clear('ufc_line_poll'); return; }
    const curMins = LINE_DROP_STATE._currentPollMins || 30;
    if (Math.abs(newMins - curMins) >= 5) {
      chrome.alarms.clear('ufc_line_poll');
      chrome.alarms.create('ufc_line_poll', { periodInMinutes: newMins });
      LINE_DROP_STATE._currentPollMins = newMins;
      chrome.storage.local.set({ line_drop_state: { ...LINE_DROP_STATE } });
      console.log(`[UFC LineWatch] Poll rate updated: ${curMins}min → ${newMins}min`);
    }
  }
});

// Restore watcher on service worker restart
(async () => {
  const result = await storageGet(['line_drop_state']);
  const s = result.line_drop_state;
  if (s?.watching) {
    Object.assign(LINE_DROP_STATE, s);
    console.log('[UFC LineWatch] Restored from storage');
  }
})();

// ── AUTO-SCRAPE ORCHESTRATION ──────────────────────────────────────────────
// Opens Pick6 + Underdog in background tabs, triggers scraping, then closes them.
// Called when the analyzer opens or when "Refresh Lines" is clicked.

const AUTO_SCRAPE_URLS = {
  pick6:    'https://pick6.draftkings.com/pick6/available-players?sport=MMA',
  underdog: 'https://underdogfantasy.com/pick-em/higher-lower',
};

let autoScrapeInProgress = false;

async function autoScrapeAllPlatforms() {
  if (autoScrapeInProgress) return { status: 'already_running' };
  autoScrapeInProgress = true;

  const results = {};
  const tabsToClose = [];

  try {
    // PrizePicks — direct API call, no tab needed
    const ppCount = await fetchPrizePicksFromBackground();
    results.prizepicks = ppCount;
    console.log(`[UFC Auto-Scrape] prizepicks: ${ppCount} fighters`);
    if (ppCount > 0) {
      notifyAnalyzerTabs({ type: 'LINES_UPDATED', platform: 'prizepicks', count: ppCount });
    }

    for (const [platform, url] of Object.entries(AUTO_SCRAPE_URLS)) {
      try {
        // Create tab in background (not focused)
        const tab = await chrome.tabs.create({ url, active: false });
        tabsToClose.push(tab.id);

        // Wait for tab to load fully
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          // Fallback timeout
          setTimeout(resolve, 15000);
        });

        // Give JS time to render
        await new Promise(r => setTimeout(r, 3000));

        // Inject content script to trigger scrape
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // Wait for lines to come in
        await new Promise(r => setTimeout(r, 5000));

        results[platform] = (store[platform]?.fighters?.length || 0);
        console.log(`[UFC Auto-Scrape] ${platform}: ${results[platform]} fighters`);
      } catch(e) {
        console.log(`[UFC Auto-Scrape] Error scraping ${platform}:`, e.message);
        results[platform] = 0;
      }
    }
  } finally {
    // Close all background tabs
    for (const tabId of tabsToClose) {
      try { await chrome.tabs.remove(tabId); } catch(e) {}
    }
    autoScrapeInProgress = false;
  }

  return { status: 'done', results };
}

// ── UPCOMING UFC CARD DETECTOR ─────────────────────────────────────────────
// Fetches the UFCStats events page to find the next upcoming event + fighters

async function fetchUpcomingUFCCard() {
  const cacheKey = 'upcoming_ufc_card';
  const cached = await storageGet([cacheKey]);
  // Cache for 2 hours
  if (cached[cacheKey] && (Date.now() - cached[cacheKey].fetchedAt < 7200000)) {
    return cached[cacheKey];
  }

  try {
    const res = await fetch('http://www.ufcstats.com/statistics/events/upcoming?page=all');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const events = [];
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const rowM of rows) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      if (!linkM) continue;
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
      const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
      if (!nameM || !dateM) continue;
      events.push({
        name: nameM[1].trim(),
        date: dateM[0],
        url: linkM[1]
      });
    }

    if (!events.length) throw new Error('No upcoming events found');

    // Sort by date, take next event
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    const nextEvent = events[0];

    // Fetch the event detail page to get the fighter card
    const evRes = await fetch(nextEvent.url);
    const evHtml = await evRes.text();

    const fighters = [];
    const fightRows = [...evHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const rowM of fightRows) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const nameLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
      if (nameLinks.length < 2) continue;
      const f1 = nameLinks[0][1].trim();
      const f2 = nameLinks[1][1].trim();
      if (f1 && f2 && f1 !== '--' && f2 !== '--') {
        fighters.push({ f1, f2 });
      }
    }

    const result = {
      event: nextEvent.name,
      date: nextEvent.date,
      url: nextEvent.url,
      fighters,
      fetchedAt: Date.now()
    };

    chrome.storage.local.set({ [cacheKey]: result });
    return result;
  } catch(e) {
    console.log('[UFC Card Detector] Error:', e.message);
    return null;
  }
}

// Restore persisted data on service worker startup
chrome.storage.local.get(['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks'], (result) => {
  if (result.lines_pick6)      store.pick6      = result.lines_pick6;
  if (result.lines_underdog)   store.underdog   = result.lines_underdog;
  if (result.lines_betr)       store.betr       = result.lines_betr;
  if (result.lines_prizepicks) store.prizepicks = result.lines_prizepicks;
});

function parseUnderdogResponse(data) {
  const fighters = {};
  try {
    const overUnderLines = data.over_under_lines || {};
    const appearances    = data.appearances       || {};
    const players        = data.players           || {};
    const overUnders     = data.over_under || data.over_unders || {};

    Object.values(overUnderLines).forEach(line => {
      const statValue = parseFloat(line.stat_value);
      if (isNaN(statValue) || statValue < 20 || statValue > 300) return;
      if (line.status && line.status !== 'active') return;

      // Filter to Fantasy Points lines only — skip sig strikes, fight time, etc.
      const title = (line.title || line.stat || line.stat_type || line.display_stat || '').toLowerCase();
      const isOther = title.includes('strike') || title.includes('round')
                   || title.includes('time')   || title.includes('takedown')
                   || title.includes('knockdown') || title.includes('submission')
                   || title.includes('control') || title.includes('reversal');
      if (isOther) return;

      const appearance = appearances[line.appearance_id] || {};
      const player     = players[appearance.player_id]   || {};
      const name       = player.full_name || player.name;
      if (!name) return;

      const sport = appearance.sport || '';
      if (sport && !/ufc|mma/i.test(sport)) return;

      // Find opponent
      const ouId  = line.over_under_id;
      const ou    = overUnders[ouId] || {};
      const ouAppIds = ou.over_under_appearance_ids || (ou.appearance_id ? [ou.appearance_id] : []);
      const oppAppId = ouAppIds.find(id => id !== line.appearance_id);
      const oppPlayer = oppAppId ? (players[(appearances[oppAppId] || {}).player_id] || {}) : {};
      const opponent = oppPlayer.full_name || oppPlayer.name || null;

      // Keep highest line per fighter
      if (!fighters[name] || statValue > fighters[name].line) {
        fighters[name] = { name, line: statValue, opponent };
      }
    });
  } catch (e) { console.log('[UD parse error]', e); }
  return Object.values(fighters);
}

async function fetchUnderdogFromBackground(token) {
  const endpoints = [
    "https://api.underdogfantasy.com/v1/over_under_lines",
    "https://api.underdogfantasy.com/v2/over_under_lines",
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) continue;
      const data = await res.json();
      const fighters = parseUnderdogResponse(data);
      if (fighters.length > 0) {
        store["underdog"] = { fighters, capturedAt: Date.now() };
        chrome.storage.local.set({ lines_underdog: store["underdog"] });
        chrome.action.setBadgeText({ text: "✓" });
        chrome.action.setBadgeBackgroundColor({ color: "#4ae87a" });
        return fighters.length;
      }
    } catch (e) { console.log("Fetch error:", url, e.message); }
  }
  return 0;
}

// ── UFC STATS SCRAPER ──────────────────────────────────────────────────────

function parseCareerStats(html) {
  const stats = {};
  const g = (re) => { const m = html.match(re); return m ? parseFloat(m[1]) : null; };
  const gs = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };

  stats.slpm   = g(/SLpM[\s\S]*?<\/i>\s*([\d.]+)/);
  stats.strAcc = g(/Str\. Acc\.[\s\S]*?<\/i>\s*([\d.]+)%/);
  stats.sapm   = g(/SApM[\s\S]*?<\/i>\s*([\d.]+)/);
  stats.strDef = g(/Str\. Def[\s\S]*?<\/i>\s*([\d.]+)%/);
  stats.tdAvg  = g(/TD Avg\.[\s\S]*?<\/i>\s*([\d.]+)/);
  stats.tdAcc  = g(/TD Acc\.[\s\S]*?<\/i>\s*([\d.]+)%/);
  stats.tdDef  = g(/TD Def\.[\s\S]*?<\/i>\s*([\d.]+)%/);
  stats.subAvg = g(/Sub\. Avg\.[\s\S]*?<\/i>\s*([\d.]+)/);

  const rec = html.match(/Record:\s*([\d]+-[\d]+-[\d]+)/);
  stats.record = rec ? rec[1] : null;
  stats.height = gs(/Height[\s\S]*?<\/i>\s*([^<\n]+)/);
  stats.reach  = gs(/Reach[\s\S]*?<\/i>\s*([^<\n]+)/);
  stats.stance = gs(/STANCE[\s\S]*?<\/i>\s*([^<\n]+)/);
  return stats;
}

function parseFightHistoryLinks(html) {
  // Fighter detail page has fight history rows with: Opponent, Event, W/L, Method, Round, Time
  // and a link to each fight's detail page (fight-details/XXXXX)
  // We parse those links + result/method/round here, then fetch fight detail pages separately
  const fights = [];
  const clean = (s) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowM of rows) {
    const row = rowM[1];
    if (row.includes('<th')) continue;

    // Must have a fight-details link
    const fightLinkM = row.match(/href="(http[^"]*fight-details\/[a-f0-9]+)"/i);
    if (!fightLinkM) continue;
    const fightUrl = fightLinkM[1];

    // Must have win/loss
    const resultM = row.match(/>\s*(win|loss)\s*</i);
    if (!resultM) continue;
    const wl = resultM[1].toLowerCase();

    // Opponent name from fighter-details link
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

    // Round: plain <td> cell with a single digit, skip time cells like "5:00"
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    let round = null;
    for (const t of tds) {
      if (t.includes(':')) continue;
      const n = parseInt(t);
      if (!isNaN(n) && n >= 1 && n <= 5 && t.trim().length <= 2) { round = n; break; }
    }

    fights.push({ result: wl, opponent, event, method, round, date, fightUrl });
  }
  return fights.slice(0, 10);
}

function parseFightDetailStats(html, fighterName, fighterDetailUrl) {
  const clean = (s) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let detailMethod = null;
  let detailRound = null;

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

  const roundM = html.match(/Round:\s*<\/i>\s*(\d)/i);
  if (roundM) detailRound = parseInt(roundM[1]);

  // Find the Totals table (first table with KD + Ctrl headers)
  let totalsTable = null;
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      totalsTable = tableHtml;
      break;
    }
  }
  if (!totalsTable) return { method: detailMethod, round: detailRound };

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return { method: detailMethod, round: detailRound };

  // KEY INSIGHT: each <td> contains TWO <p> tags — one per fighter (stacked)
  // td[0] has: <p><a href=URL_F1>Fighter1</a></p>  <p><a href=URL_F2>Fighter2</a></p>
  // All other tds have: <p>stat_for_F1</p>  <p>stat_for_F2</p>
  // href uses NO quotes: href=http://www.ufcstats.com/fighter-details/ID
  // So we need to find which <p> index (0 or 1) corresponds to our fighter

  // There is only ONE data row — both fighters are stacked within it
  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });

  if (tds.length === 0) return { method: detailMethod, round: detailRound };

  // Find fighter index (0 or 1) from td[0] which has the fighter name links
  let fIdx = 0; // default to first fighter
  if (fighterDetailUrl) {
    const urlId = fighterDetailUrl.match(/fighter-details\/([a-f0-9]+)/i)?.[1];
    if (urlId) {
      // Check unquoted hrefs: href=http://...fighter-details/ID
      const td0 = tds[0];
      const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
      const hrefMatches = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/([a-f0-9]+)/gi)];
      const ids = hrefMatches.map(m => m[1]);
      const idx = ids.indexOf(urlId);
      if (idx >= 0) fIdx = idx;
    }
  }

  // Fallback: name match in td[0] p tags
  if (fIdx === 0 && tds[0]) {
    const nameParts = fighterName.toLowerCase().split(' ').filter(p => p.length > 2);
    if (tds[0][1] && nameParts.every(p => tds[0][1].toLowerCase().includes(p))) fIdx = 1;
  }

  // Extract stats at fIdx from each column
  // td[0]=names td[1]=KD td[2]=Sig.Str("X of Y") td[3]=Sig% td[4]=Tot.Str td[5]=TD td[6]=TD% td[7]=Sub td[8]=Rev td[9]=Ctrl
  const val = (colIdx) => tds[colIdx]?.[fIdx] || tds[colIdx]?.[0] || '';

  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  const sub    = firstNum(val(7));
  const rev    = firstNum(val(8));
  let ctrlSecs = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);
  return { kd, sigStr, totStr, td, sub, rev, ctrlSecs, method: detailMethod, round: detailRound };
}












async function fetchFighterFromUFCStats(name) {
  const cacheKey = `ufcstats_v38_${name.toLowerCase().replace(/\s+/g,'_')}`;
  const cached = await storageGet([cacheKey]);
  if (cached[cacheKey] && (Date.now() - cached[cacheKey].fetchedAt < 86400000)) {
    console.log(`[UFC] Cache hit: ${name}`);
    return cached[cacheKey];
  }

  try {
    const nameParts = name.trim().split(' ');
    const lastName  = nameParts[nameParts.length - 1];
    const firstName = nameParts[0];

    const searchUrl = `http://www.ufcstats.com/statistics/fighters?query=${encodeURIComponent(lastName)}&action=searchFighters`;
    const searchRes = await fetch(searchUrl);
    const searchHtml = await searchRes.text();

    let detailUrl = null;
    const firstLower = firstName.toLowerCase();
    const lastLower = lastName.toLowerCase();
    for (const rowM of searchHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowM[1];
      const linkM = row.match(/href="(http:\/\/www\.ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
      if (!linkM) continue;
      const rowText = row.replace(/<[^>]+>/g,'').toLowerCase();
      if (rowText.includes(firstLower) && rowText.includes(lastLower)) {
        detailUrl = linkM[1];
        break;
      }
    }

    if (!detailUrl) {
      console.log(`[UFC] Not found: ${name}`);
      return null;
    }

    const detailRes = await fetch(detailUrl);
    const detailHtml = await detailRes.text();
    const careerStats = parseCareerStats(detailHtml);
    const fightLinks = parseFightHistoryLinks(detailHtml);

    const fightHistory = [];
    for (const fight of fightLinks.slice(0, 10)) {
      try {
        const fRes = await fetch(fight.fightUrl);
        const fHtml = await fRes.text();
        const stats = parseFightDetailStats(fHtml, name, detailUrl);
        const method = stats?.method || fight.method;
        const round = stats?.round || fight.round;
        fightHistory.push({ ...fight, ...(stats || {}), method, round, fightUrl: undefined });
      } catch (e) {
        console.log(`[UFC] Fight fetch error: ${fight.fightUrl}`, e.message);
        fightHistory.push({ ...fight, fightUrl: undefined });
      }
    }

    const result = { name, fetchedAt: Date.now(), careerStats, fightHistory, detailUrl };
    await storageSet({ [cacheKey]: result });
    return result;
  } catch (e) {
    console.log(`[UFC] Error fetching stats for ${name}:`, e.message);
    return null;
  }
}

// ── MESSAGE HANDLER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "LINES_CAPTURED") {
    const { platform, data } = msg;
    const incoming = data?.fighters || [];
    if (incoming.length > 0) {
      const storageKey = `lines_${platform}`;
      chrome.storage.local.get([storageKey], (result) => {
        const existing = result[storageKey]?.fighters || store[platform]?.fighters || [];
        const mergedMap = {};
        existing.forEach(f => { mergedMap[f.name] = { ...f }; });

        // Fuzzy last-name lookup for sportsbook TD merging
        function findKey(incomingName) {
          if (mergedMap[incomingName]) return incomingName;
          const norm = n => n.toLowerCase().replace(/[^a-z]/g,'');
          const inLast = norm(incomingName.split(' ').pop());
          const inFirst = norm(incomingName.split(' ')[0]);
          return Object.keys(mergedMap).find(k => {
            const kLast = norm(k.split(' ').pop());
            const kFirst = norm(k.split(' ')[0]);
            return kLast === inLast && (kFirst[0] === inFirst[0]);
          }) || null;
        }

        incoming.forEach(f => {
          const key = findKey(f.name);
          // If only line_td (sportsbook scrape), only update existing entries — don't create ghosts
          const tdOnly = f.line_fp == null && f.line == null && f.line_ss == null && f.line_td != null;
          if (!key && tdOnly) return; // skip sportsbook-only fighters not in Pick6
          const useKey = key || f.name;
          if (!mergedMap[useKey]) {
            mergedMap[useKey] = { name: f.name, line_fp: null, line_ss: null, line_td: null, opponent: null };
          }
          if (f.line_fp  != null) mergedMap[useKey].line_fp  = f.line_fp;
          if (f.line     != null && f.line_fp == null) mergedMap[useKey].line_fp = f.line;
          if (f.line_ss  != null) mergedMap[useKey].line_ss  = f.line_ss;
          if (f.line_td  != null) mergedMap[useKey].line_td  = f.line_td;
          if (f.opponent != null) mergedMap[useKey].opponent = f.opponent;
        });
        const merged = Object.values(mergedMap);
        store[platform] = { fighters: merged, capturedAt: Date.now() };
        chrome.storage.local.set({ [storageKey]: store[platform] });
        chrome.action.setBadgeText({ text: "✓" });
        chrome.action.setBadgeBackgroundColor({ color: "#4ae87a" });
      });
    }
  }

  if (msg.type === "DEBUG_CARD_TEXT") {
    chrome.storage.local.set({ [`debug_card_${msg.platform}`]: { samples: msg.samples, capturedAt: Date.now() } });
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_LINES") {
    chrome.storage.local.get(["lines_pick6", "lines_underdog", "lines_betr", "lines_prizepicks"], (result) => {
      sendResponse({
        pick6:      result.lines_pick6      || null,
        underdog:   result.lines_underdog   || null,
        betr:       result.lines_betr       || null,
        prizepicks: result.lines_prizepicks || null,
      });
    });
    return true;
  }

  if (msg.type === "CLEAR_LINES") {
    chrome.storage.local.remove(["lines_pick6", "lines_underdog", "lines_betr", "lines_prizepicks"]);
    store.pick6 = null; store.underdog = null; store.betr = null; store.prizepicks = null;
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
  }

  if (msg.type === "FETCH_UNDERDOG_BG" && msg.token) {
    fetchUnderdogFromBackground(msg.token).then(n => sendResponse({ count: n }));
    return true;
  }

  if (msg.type === "CLAUDE_API" && msg.payload) {
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": msg.apiKey || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(msg.payload)
    }).then(async r => {
      const text = await r.text();
      try {
        const data = JSON.parse(text);
        if (!r.ok) sendResponse({ error: `API ${r.status}: ${data?.error?.message || text.slice(0,200)}` });
        else sendResponse({ data });
      } catch(e) {
        sendResponse({ error: `HTTP ${r.status} — ${text.slice(0,200)}` });
      }
    }).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === "FETCH_FIGHTER_STATS" && msg.name) {
    fetchFighterFromUFCStats(msg.name).then(data => sendResponse({ data }));
    return true;
  }

  if (msg.type === "FETCH_RAW_HTML" && msg.url) {
    fetch(msg.url).then(r => r.text()).then(html => {
      sendResponse({ html, length: html.length });
    }).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === "FETCH_RAW_FIGHTER_HTML") {
    const name = msg.name || 'Max Holloway';
    const parts = name.trim().split(' ');
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];
    const searchUrl = `http://www.ufcstats.com/statistics/fighters?query=${encodeURIComponent(lastName)}&action=searchFighters`;
    fetch(searchUrl).then(r => r.text()).then(searchHtml => {
      // Dump ALL rows from search results with their cell text so we can see the real structure
      const rows = [...searchHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const rowDump = rows.slice(0, 10).map((r, i) => {
        const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,30));
        const link = (r[1].match(/href="([^"]*fighter-details[^"]+)"/) || [])[1] || '';
        return `ROW${i}: [${cells.join(' | ')}] link=${link.slice(-20)}`;
      }).join('\n');

      // Try a looser match — just find any row with a fighter-details link
      let detailUrl = null;
      for (const r of rows) {
        const link = r[1].match(/href="(http[^"]*fighter-details\/[a-f0-9]+)"/i);
        if (!link) continue;
        const text = r[1].replace(/<[^>]+>/g,'').toLowerCase();
        if (text.includes(firstName.toLowerCase()) || text.includes(lastName.toLowerCase())) {
          detailUrl = link[1].replace('http://ufcstats.com/','http://www.ufcstats.com/');
          break;
        }
      }

      if (!detailUrl) {
        sendResponse({ error: `Not found: ${name}`, searchHtml: searchHtml.slice(0, 300), rowDump });
        return;
      }

      return fetch(detailUrl).then(r => r.text()).then(detailHtml => {
        sendResponse({ html: detailHtml, length: detailHtml.length, detailUrl });
      });
    }).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === "GET_CACHED_HTML" && msg.name) {
    const cacheKey = `ufcstats_v2_${msg.name.toLowerCase().replace(/\s+/g,'_')}`;
    chrome.storage.local.get([cacheKey], (result) => {
      const cached = result[cacheKey];
      if (!cached) { sendResponse({ error: 'Not in cache — load the analyzer first to fetch this fighter' }); return; }
      sendResponse({ html: cached.rawHtmlSnippet || '', detailUrl: cached.detailUrl, fightHistory: cached.fightHistory });
    });
    return true;
  }

  if (msg.type === "START_LINE_WATCHER") {
    startLineWatcher(msg.eventName, msg.eventDate);
    sendResponse({ ok: true, watching: true });
    return true;
  }

  if (msg.type === "STOP_LINE_WATCHER") {
    stopLineWatcher();
    sendResponse({ ok: true, watching: false });
    return true;
  }

  if (msg.type === "GET_WATCHER_STATUS") {
    chrome.storage.local.get(['line_drop_state'], (result) => {
      sendResponse({ state: result.line_drop_state || { watching: false } });
    });
    return true;
  }

  if (msg.type === "MANUAL_POLL_NOW") {
    pollForLineDrops().then(() => sendResponse({ lastUDCount: LINE_DROP_STATE.lastUDCount }));
    return true;
  }

  if (msg.type === "AUTO_SCRAPE_LINES") {
    autoScrapeAllPlatforms().then(result => sendResponse(result));
    return true;
  }

  if (msg.type === "GET_UPCOMING_CARD") {
    fetchUpcomingUFCCard().then(card => sendResponse({ card }));
    return true;
  }

  if (msg.type === "AUTO_SCRAPE_STATUS") {
    sendResponse({ inProgress: autoScrapeInProgress });
    return true;
  }

  if (msg.type === "CLEAR_STATS_CACHE") {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter(k => k.startsWith('ufcstats_'));
      chrome.storage.local.remove(keys);
      sendResponse({ cleared: keys.length });
    });
    return true;
  }
});
