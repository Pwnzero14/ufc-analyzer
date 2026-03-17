// @ts-nocheck
/**
 * Content script for UFC fantasy lines scraping
 * Runs in the context of sportsbook & fantasy platform pages
 * Scrapes DOM to extract fighter lines and sends them to background service worker
 *
 * NOTE: This file must not use ESM imports because chrome content scripts are
 * injected as classic scripts (not modules). Keeping this file self-contained
 * avoids the "Cannot use import statement outside a module" error.
 */

const host = window.location.hostname;
console.log('[UFC Ext] content script loaded on', host);

const SCRAPE_CONFIG = {
  validation: {
    fp: { min: 5, max: 300 },
    ss: { min: 1, max: 300 },
    td: { min: 0.5, max: 20 },
  },
  scroll: {
    timeoutMs: 12000,
    intervalMs: 600,
  },
  scrape: {
    maxAttempts: 20,
    attemptIntervalMs: 1500,
    timeoutMs: 35000,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollToLoadAll() {
  const { timeoutMs, intervalMs } = SCRAPE_CONFIG.scroll;

  return new Promise((resolve) => {
    let lastHeight = 0;
    let stableCount = 0;

    const interval = setInterval(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const newHeight = document.body.scrollHeight;

      if (newHeight === lastHeight) {
        stableCount++;
        if (stableCount >= 3) {
          clearInterval(interval);
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
          return;
        }
      } else {
        stableCount = 0;
        lastHeight = newHeight;
      }
    }, intervalMs);

    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, timeoutMs);
  });
}

function log(platform, msg) {
  console.log(`[UFC Ext] ${platform}: ${msg}`);
}

function logError(platform, msg, error) {
  const err = error instanceof Error ? error.message : String(error);
  console.error(`[UFC Ext] ${platform} ERROR: ${msg}`, err);
}

function scrapePick6() {
  const fighters = {};

  try {
    document.querySelectorAll('[data-testid="cardButton"]').forEach((btn) => {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const nameMatch = ariaLabel.match(/Open (.+?)'s stat/i);
      if (!nameMatch) return;
      const name = nameMatch[1].trim();
      const cardText = btn.closest('div[class]')?.innerText || '';
      const oppMatch = cardText.match(/vs\s+([^\n]+)/i);
      const opponent = oppMatch ? oppMatch[1].trim() : null;

      const fpMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Fantasy Points/i);
      if (fpMatch) {
        const line = parseFloat(fpMatch[1]);
        if (line > 5 && line < 500) {
          if (!fighters[name]) {
            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          }
          fighters[name].line_fp = line;
        }
      }

      const ssMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
      if (ssMatch) {
        const line = parseFloat(ssMatch[1]);
        if (line > 0 && line < 400) {
          if (!fighters[name]) {
            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          }
          fighters[name].line_ss = line;
        }
      }

      const tdMatch = cardText.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
      if (tdMatch) {
        const line = parseFloat(tdMatch[1]);
        if (!isNaN(line) && line >= 0 && line < 20) {
          if (!fighters[name]) {
            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          }
          fighters[name].line_td = line;
        }
      }
    });

    if (Object.keys(fighters).length === 0) {
      document.querySelectorAll('[class*="PlayerCard"], [class*="player"], [class*="Pick"]').forEach((card) => {
        const text = card.innerText || '';
        const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Fantasy Points/i);
        const ssMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
        const tdMatch = text.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
        if (!fpMatch && !ssMatch && !tdMatch) return;

        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const vsIdx = lines.findIndex((l) => /^vs\s/i.test(l));
        const name = vsIdx > 0 ? lines[vsIdx - 1] : lines[0];
        const opponent = vsIdx >= 0 ? lines[vsIdx].replace(/^vs\s*/i, '').trim() : null;

        if (!name || name.length < 3 || name.length > 40) return;
        if (!fighters[name]) {
          fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
        }
        if (fpMatch) fighters[name].line_fp = parseFloat(fpMatch[1]);
        if (ssMatch) fighters[name].line_ss = parseFloat(ssMatch[1]);
        if (tdMatch) fighters[name].line_td = parseFloat(tdMatch[1]);
      });
    }

    const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td);
    log('pick6', `Found ${result.length} fighters`);
    return result;
  } catch (error) {
    logError('pick6', 'DOM scrape failed', error);
    return [];
  }
}

function scrapeUnderdog() {
  const fighters = {};

  try {
    document.querySelectorAll('[data-testid="over-under-cell"]').forEach((cell) => {
      const isMMA = cell.querySelector('[data-testid="test-icon-mma"]');
      if (!isMMA) return;

      const nameEl = cell.querySelector('[class*="nameAndButtons"] [class*="name"], [class*="playerName"], [class*="displayName"]');
      const name = nameEl?.textContent?.trim() || cell.querySelector('strong, h3, h4')?.textContent?.trim();
      if (!name) return;

      const cardText = cell.innerText || '';
      const cardLines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);

      for (let i = 0; i < cardLines.length - 1; i++) {
        const numMatch = cardLines[i].match(/^(\d+\.?\d*)$/);
        if (!numMatch) continue;

        const val = parseFloat(numMatch[1]);
        const label = (cardLines[i + 1] || '').toLowerCase();

        let lineType = null;
        if (label.includes('fantasy') || label.includes('pts')) lineType = 'fp';
        else if (label.includes('significant strike') || label.includes('sig. strike')) lineType = 'ss';
        else if (label.includes('takedown')) lineType = 'td';
        if (!lineType) continue;

        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null };
        fighters[name][`line_${lineType}`] = val;
      }
    });

    const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td);
    log('underdog', `Found ${result.length} fighters`);
    return result;
  } catch (error) {
    logError('underdog', 'DOM scrape failed', error);
    return [];
  }
}

function scrapeDKSportsbookTDs() {
  const fighters = {};

  try {
    const allEls = Array.from(document.querySelectorAll('*'));
    allEls.forEach((el) => {
      if (el.children.length > 0) return;
      const text = (el.innerText || el.textContent || '').trim();
      const m = text.match(/^(.+?)\s+Total Takedowns Landed O\/U$/i);
      if (!m) return;

      const name = m[1].trim();
      if (!name || name.length < 3) return;

      let container = el;
      for (let i = 0; i < 10; i++) {
        if (!container.parentElement) break;
        container = container.parentElement;
        const containerText = container.innerText || '';
        const overMatch = containerText.match(/Over\s+([\d.]+)/i);
        if (overMatch) {
          const line = parseFloat(overMatch[1]);
          if (!isNaN(line) && line >= 0 && line < 20) {
            if (!fighters[name]) {
              fighters[name] = { name, line_fp: null, line_ss: null, line_td: null };
            }
            fighters[name].line_td = line;
          }
          break;
        }
      }
    });

    const result = Object.values(fighters).filter((f) => f.line_td != null);
    log('draftkings_sportsbook', `Found ${result.length} fighter TDs`);
    return result;
  } catch (error) {
    logError('draftkings_sportsbook', 'DOM scrape failed', error);
    return [];
  }
}

async function tryScrape(platform, scrapeFn) {
  await scrollToLoadAll();

  const { maxAttempts, attemptIntervalMs, timeoutMs } = SCRAPE_CONFIG.scrape;
  let bestResult = [];
  let stableCount = 0;
  let attempts = 0;

  return new Promise((resolve) => {
    const flush = () => {
      if (bestResult.length > 0) {
        log(platform, `Flushed ${bestResult.length} fighters`);
      }
    };

    const interval = setInterval(() => {
      try {
        const fighters = scrapeFn();
        log(platform, `Attempt ${attempts + 1}: ${fighters.length} fighters`);
        if (fighters.length > bestResult.length) {
          bestResult = fighters;
          stableCount = 0;
          flush();
        } else if (fighters.length === bestResult.length && bestResult.length > 0) {
          stableCount++;
        }

        attempts++;
        if ((stableCount >= 3 && bestResult.length > 0) || attempts >= maxAttempts) {
          clearInterval(interval);
          clearTimeout(timeout);
          flush();
          resolve(bestResult);
        }
      } catch (error) {
        logError(platform, `Scrape attempt ${attempts + 1} failed`, error);
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(bestResult);
        }
      }
    }, attemptIntervalMs);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      flush();
      resolve(bestResult);
    }, timeoutMs);
  });
}

// ── INJECT PAGE-CONTEXT SCRIPT FOR UNDERDOG ────────────────────────────
// Underdog uses fetch interception to capture API data

if (host.includes('underdogfantasy') || host.includes('underdogsports')) {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    window.addEventListener('__ufc_underdog__', (e: any) => {
      const fighters = e.detail?.fighters || [];
      if (fighters.length > 0) {
        console.log('[UFC Ext] Underdog captured', fighters.length, 'fighters via fetch intercept');
        chrome.runtime.sendMessage({
          type: 'LINES_CAPTURED',
          platform: 'underdog',
          data: { fighters },
        });
      }
    });
  } catch (error) {
    console.error('[UFC Ext] Error setting up Underdog injection:', error);
  }
}

// ── MAIN SCRAPING ORCHESTRATION ────────────────────────────────────────

async function main(): Promise<void> {
  try {
    // Pick6
    if (host.includes('draftkings.com') && host.includes('pick6')) {
      console.log('[UFC Ext] Detected Pick6, starting scrape...');
      const fighters = await tryScrape('pick6', () => scrapePick6());
      if (fighters.length > 0) {
        chrome.runtime.sendMessage({
          type: 'LINES_CAPTURED',
          platform: 'pick6',
          data: { fighters },
        });
      }
      return;
    }

    // Underdog DOM scraper (fallback)
    if (host.includes('underdogfantasy') || host.includes('underdogsports')) {
      console.log('[UFC Ext] Detected Underdog, starting DOM scrape...');
      const fighters = await tryScrape('underdog', () => scrapeUnderdog());
      if (fighters.length > 0) {
        chrome.runtime.sendMessage({
          type: 'LINES_CAPTURED',
          platform: 'underdog',
          data: { fighters },
        });
      }
      return;
    }

    // DraftKings Sportsbook (MMA Fighter Props)
    if (host.includes('sportsbook.draftkings.com') && window.location.pathname.includes('ufc')) {
      console.log('[UFC Ext] Detected DraftKings Sportsbook MMA, starting scrape...');
      const fighters = await tryScrape('draftkings_sportsbook', () => scrapeDKSportsbookTDs());
      if (fighters.length > 0) {
        chrome.runtime.sendMessage({
          type: 'LINES_CAPTURED',
          platform: 'pick6', // Store as pick6 for consolidation
          data: { fighters },
        });
      }
      return;
    }

    console.log('[UFC Ext] No matching platform detected for scraping');
  } catch (error) {
    console.error('[UFC Ext] Main scraping error:', error);
  }
}

// Run on inject
main().catch((e) => console.error('[UFC Ext] Unhandled error:', e));
