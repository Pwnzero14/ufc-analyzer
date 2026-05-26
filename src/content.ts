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

async function scrollToLoadAll(options = {}) {
  const timeoutMs = options.timeoutMs ?? SCRAPE_CONFIG.scroll.timeoutMs;
  const intervalMs = options.intervalMs ?? SCRAPE_CONFIG.scroll.intervalMs;

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
    // ── Primary: Pick6 fantasy card UI ──────────────────────────────────
    document.querySelectorAll('[data-testid="cardButton"]').forEach((btn) => {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const nameMatch = ariaLabel.match(/Open (.+?)'s stat/i);
      if (!nameMatch) return;
      const name = nameMatch[1].trim();
      const cardText = btn.closest('div[class]')?.innerText || '';
      const oppMatch = cardText.match(/vs\s+([^\n]+)/i);
      const opponent = oppMatch ? oppMatch[1].trim() : null;

      const fpMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)/i)
        || cardText.match(/(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/i)
        || cardText.match(/([\d]+\.?\d*)\s*\n?\s*(?:Score|Pts?\.?)\s*$/im)
        || cardText.match(/^(?:Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/im);
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

      // Control Time — minutes. Accepts "2:30 Control" or "2.5 Control Time".
      const ctrlMMSS = cardText.match(/(\d+):(\d{2})\s*\n?\s*Control(?:\s*Time)?/i);
      const ctrlDec  = cardText.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Control(?:\s*Time)?/i);
      let ctrlLine = null;
      if (ctrlMMSS) {
        const mm = parseInt(ctrlMMSS[1], 10), ss = parseInt(ctrlMMSS[2], 10);
        if (!isNaN(mm) && !isNaN(ss)) ctrlLine = parseFloat((mm + ss / 60).toFixed(2));
      } else if (ctrlDec) {
        const v = parseFloat(ctrlDec[1]);
        if (!isNaN(v)) ctrlLine = v;
      }
      if (ctrlLine != null && ctrlLine >= 0 && ctrlLine < 25) {
        if (!fighters[name]) {
          fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
        }
        fighters[name].line_ctrl = ctrlLine;
        // Pick6 sometimes only offers "More" (OVER) for Control Time — no Less/UNDER side.
        // Detect by checking if the card has a visible "Less" button. Scraping CTRL
        // happens on the Control Time tab, so Less-presence here reflects CTRL specifically.
        fighters[name].ctrl_under_available = /\bLess\b/i.test(cardText);
      }
    });

    // ── Secondary: Pick6 sports/props page (different card layout) ───────
    // Used on ?sport=UFC and /category/47 pages for SS and TD lines
    if (Object.keys(fighters).length === 0) {
      // Try pick-card or player-row style containers used on the sports prop pages
      const propCardSelectors = [
        '[class*="PickCard"]', '[class*="pick-card"]', '[class*="PlayerPick"]',
        '[class*="player-pick"]', '[class*="prop-card"]', '[class*="PropCard"]',
        '[class*="PickRow"]', '[class*="pick-row"]',
      ];
      document.querySelectorAll(propCardSelectors.join(',')).forEach((card) => {
        const text = card.innerText || '';
        const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)/i)
          || text.match(/(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/i);
        const ssMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
        const tdMatch = text.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
        if (!fpMatch && !ssMatch && !tdMatch) return;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        const vsIdx = lines.findIndex((l) => /^vs[.\s]/i.test(l));
        const name = vsIdx > 0 ? lines[vsIdx - 1] : lines[0];
        if (!name || name.length < 3 || name.length > 45) return;
        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent: null };
        if (fpMatch) fighters[name].line_fp = parseFloat(fpMatch[1]);
        if (ssMatch) fighters[name].line_ss = parseFloat(ssMatch[1]);
        if (tdMatch) fighters[name].line_td = parseFloat(tdMatch[1]);
      });
    }

    // ── Tertiary: scan for any element whose text matches a line + stat label ─
    // Broadest fallback for unknown card layouts on new Pick6 pages
    if (Object.keys(fighters).length === 0) {
      const allText = document.body.innerText || '';
      // Find all "NUMBER \n Significant Strikes" or "NUMBER \n Takedowns" patterns with surrounding name
      const lineBlocks = [...allText.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*\n+([\d]+\.?\d*)\s*\n?((?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)|Significant Strikes|Takedown)/gi)];
      for (const m of lineBlocks) {
        const name = m[1].trim();
        const val = parseFloat(m[2]);
        const stat = m[3].toLowerCase();
        if (!name || name.length > 45 || isNaN(val)) continue;
        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent: null };
        if (stat.includes('fantasy') || stat.includes('fight score')) fighters[name].line_fp = val;
        else if (stat.includes('significant')) fighters[name].line_ss = val;
        else if (stat.includes('takedown')) fighters[name].line_td = val;
      }
    }

    // ── Quaternary: generic PlayerCard fallback ──────────────────────────
    if (Object.keys(fighters).length === 0) {
      document.querySelectorAll('[class*="PlayerCard"], [class*="player"], [class*="Pick"]').forEach((card) => {
        const text = card.innerText || '';
        const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)/i)
          || text.match(/(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/i);
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

    const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td || f.line_ctrl);
    log('pick6', `Found ${result.length} fighters`);
    return result;
  } catch (error) {
    logError('pick6', 'DOM scrape failed', error);
    return [];
  }
}

function getStatCoverage(fighters = []) {
  const total = fighters.length;
  const fpCount = fighters.filter((f) => f.line_fp != null).length;
  const ssCount = fighters.filter((f) => f.line_ss != null).length;
  const tdCount = fighters.filter((f) => f.line_td != null).length;
  const ctrlCount = fighters.filter((f) => f.line_ctrl != null).length;
  return { total, fpCount, ssCount, tdCount, ctrlCount };
}

async function scrapePick6AllStats() {
  try {
    const merged = [];
    let lastSentCount = 0;
    let lastSentCtrlCount = 0;

    // Send partial results immediately so the service worker can exit early.
    // Fires when fighter count grows OR when new CTRL data arrives (count alone
    // misses CTRL because it lands on an existing fighter, not a new row — which
    // would otherwise leave CTRL stuck in the content script until the final send).
    const sendInterim = () => {
      const valid = merged.filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null || f.line_ctrl != null);
      const ctrlCount = valid.filter((f) => f.line_ctrl != null).length;
      if (valid.length > lastSentCount || ctrlCount > lastSentCtrlCount) {
        lastSentCount = valid.length;
        lastSentCtrlCount = ctrlCount;
        try {
          chrome.runtime.sendMessage({ type: 'LINES_CAPTURED', platform: 'pick6', data: { fighters: valid } });
        } catch { /* extension context may be invalidated; ignore */ }
      }
    };

    const mergeInto = (incoming) => {
      const map = new Map(merged.map((f) => [String(f.name || '').toLowerCase(), f]));
      for (const f of incoming || []) {
        const key = String(f?.name || '').toLowerCase();
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, { ...f });
          continue;
        }
        const prev = map.get(key);
        if (f.line_fp   != null) prev.line_fp   = f.line_fp;
        if (f.line_ss   != null) prev.line_ss   = f.line_ss;
        if (f.line_td   != null) prev.line_td   = f.line_td;
        if (f.line_ctrl != null) prev.line_ctrl = f.line_ctrl;
        if (!prev.opponent && f.opponent) prev.opponent = f.opponent;
        map.set(key, prev);
      }
      merged.length = 0;
      merged.push(...Array.from(map.values()));
    };

    // Require FP/SS/TD breadth; CTRL is optional (Pick6 only offers it on some cards / some events).
    const hasEnoughCoverage = (c) => c.total >= 8 && c.fpCount >= 4 && c.ssCount >= 4 && c.tdCount >= 2;

    // 2026-05-15: DK consolidated UFC under MMA category/129. The page has a
    // Featured | UFC | MVP sub-tab row — click UFC first to filter to UFC fighters.
    // Idempotent if already active.
    await clickButtonByLabels('pick6', ['ufc'], 800);

    for (let attempt = 1; attempt <= 2; attempt++) {
      log('pick6', `Stat crawl attempt ${attempt}`);

      await scrollToLoadAll({ timeoutMs: 800, intervalMs: 200 });
      mergeInto(scrapePick6());
      sendInterim();

      let coverage = getStatCoverage(merged);
      if (hasEnoughCoverage(coverage)) break;

      if (coverage.fpCount < 4 && await clickButtonByLabels('pick6', ['fantasy points', 'fight score', 'fantasy score', 'fantasy point', 'fantasy pts', 'fight pts', 'score', 'popular'], 700)) {
        await scrollToLoadAll({ timeoutMs: 600, intervalMs: 200 });
        mergeInto(scrapePick6());
        sendInterim();
        coverage = getStatCoverage(merged);
      }

      if (coverage.ssCount < 4 && await clickButtonByLabels('pick6', ['significant strikes', 'significant strike', 'sig strikes'], 700)) {
        await scrollToLoadAll({ timeoutMs: 600, intervalMs: 200 });
        mergeInto(scrapePick6());
        sendInterim();
        coverage = getStatCoverage(merged);
      }

      if (coverage.tdCount < 2 && await clickButtonByLabels('pick6', ['takedowns', 'takedown'], 700)) {
        await scrollToLoadAll({ timeoutMs: 600, intervalMs: 200 });
        mergeInto(scrapePick6());
        sendInterim();
        coverage = getStatCoverage(merged);
      }

      // Control Time — 2026-05-15 layout has Control Time as a direct top-level pill
      // (was previously nested under a "Time" tab). Click it directly.
      const ctrlClicked = await clickButtonByLabels('pick6', ['control time', 'control mins', 'control minutes'], 700);
      if (ctrlClicked) {
        log('pick6', 'Clicked Control Time pill, scraping');
        await scrollToLoadAll({ timeoutMs: 800, intervalMs: 200 });
        mergeInto(scrapePick6());
        sendInterim();
        coverage = getStatCoverage(merged);
        log('pick6', `CTRL coverage after click: ctrl=${coverage.ctrlCount}/${coverage.total}`);
      }

      log('pick6', `Coverage after attempt ${attempt}: fighters=${coverage.total}, fp=${coverage.fpCount}, ss=${coverage.ssCount}, td=${coverage.tdCount}, ctrl=${coverage.ctrlCount}`);
      if (hasEnoughCoverage(coverage)) {
        break;
      }
      await sleep(150);
    }

    return merged.filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null || f.line_ctrl != null);
  } catch (error) {
    logError('pick6', 'Pick6 stat crawl failed, falling back to single-view scrape', error);
    return scrapePick6();
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

      // Parse opponent from matchup label (e.g. "Pico vs Pitbull", "Hokit vs Blaydes")
      let opponent = null;
      for (const line of cardLines) {
        const vsMatch = line.match(/^(\S+)\s+vs\.?\s+(\S+)/i);
        if (vsMatch) {
          const nameParts = name.split(/\s+/);
          const lastName = nameParts[nameParts.length - 1].toLowerCase();
          const side1 = vsMatch[1].toLowerCase();
          const side2 = vsMatch[2].toLowerCase();
          // The other side of the matchup is the opponent's last name
          if (side1 === lastName) opponent = vsMatch[2];
          else if (side2 === lastName) opponent = vsMatch[1];
          break;
        }
      }

      for (let i = 0; i < cardLines.length - 1; i++) {
        // Strip leading arrow/direction indicators (↑ ↓ ▲ ▼) that Underdog prepends
        // to lines that have moved — e.g. "↑ 27.5" → "27.5"
        const cleanLine = cardLines[i].replace(/^[↑↓▲▼⬆⬇]\s*/, '').trim();
        const numMatch = cleanLine.match(/^(\d+\.?\d*)$/);
        if (!numMatch) continue;

        const val = parseFloat(numMatch[1]);
        const label = (cardLines[i + 1] || '').toLowerCase();

        let lineType = null;
        if (label.includes('fantasy') || label.includes('pts')) lineType = 'fp';
        else if (label.includes('significant strike') || label.includes('sig. strike')) lineType = 'ss';
        else if (label.includes('takedown')) lineType = 'td';
        if (!lineType) continue;

        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
        fighters[name][`line_${lineType}`] = val;
        if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
      }
    });

    const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td || f.line_ctrl);
    log('underdog', `Found ${result.length} fighters`);
    return result;
  } catch (error) {
    logError('underdog', 'DOM scrape failed', error);
    return [];
  }
}

function scrapePrizePicksCurrentView() {
  const fighters = {};

  const upsert = (name, type, value, opponent = null) => {
    if (!name || !type || value == null || isNaN(value)) return;
    if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_ss_r1: null, line_td: null, opponent };
    fighters[name][`line_${type}`] = value;
    if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
  };

  const parseFromText = (text) => {
    const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    const nameWithSuffix = lines.find((l) => /^[A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+)+(?:\s*-\s*[A-Z])?$/.test(l)) || null;
    const name = (nameWithSuffix || '').replace(/\s*-\s*[A-Z]$/, '').trim() || null;
    if (!name) return;

    const opponentLine = lines.find((l) => /^vs\.?\s+/i.test(l) || /^@\s*/.test(l));
    const opponent = opponentLine ? opponentLine.replace(/^vs\.?\s+|^@\s*/i, '').replace(/\s+Sat.*$/i, '').trim() : null;

    const fpMatch = text.match(/([\d]+\.?\d*)\s*(?:\n|\s)*Fantasy\s*(?:Points|Score)/i);
    // R1 SS regex must come BEFORE the generic SS regex — "RD 1 Significant Strikes"
    // would otherwise be captured by /Significant Strikes/ as a regular SS line.
    const ssR1Match = text.match(/([\d]+\.?\d*)\s*(?:\n|\s)*(?:RD\s*1|Round\s*1|R1)\s*Significant\s*Strikes?/i);
    const ssGenericMatch = text.match(/([\d]+\.?\d*)\s*(?:\n|\s)*Significant\s*Strikes?/i);
    const tdMatch = text.match(/([\d]+\.?\d*)\s*(?:\n|\s)*Takedowns?/i);

    if (fpMatch) upsert(name, 'fp', parseFloat(fpMatch[1]), opponent);
    if (ssR1Match) {
      upsert(name, 'ss_r1', parseFloat(ssR1Match[1]), opponent);
    } else if (ssGenericMatch) {
      // Only treat as regular SS if the line wasn't already matched as R1 SS
      upsert(name, 'ss', parseFloat(ssGenericMatch[1]), opponent);
    }
    if (tdMatch) upsert(name, 'td', parseFloat(tdMatch[1]), opponent);
  };

  const cardSelectors = [
    '[data-testid*="projection"]',
    '[class*="projection"]',
    '[class*="Projection"]',
    '[class*="board-card"]',
    '[class*="BoardCard"]',
    '[class*="pick-card"]',
    '[class*="PickCard"]',
    'button[class*="board"]',
  ];
  document.querySelectorAll(cardSelectors.join(',')).forEach((card) => {
    parseFromText(card.innerText || card.textContent || '');
  });

  if (Object.keys(fighters).length === 0) {
    const text = document.body.innerText || '';
    const blocks = text.split(/\n{2,}/g);
    blocks.forEach((b) => {
      if (!/Fantasy\s*(?:Points|Score)|Significant\s*Strikes?|Takedowns?/i.test(b)) return;
      parseFromText(b);
    });
  }

  return Object.values(fighters).filter((f) => f.line_fp != null || f.line_ss != null || f.line_ss_r1 != null || f.line_td != null);
}

function findButtonByText(labels) {
  const wanted = labels.map((s) => s.toLowerCase());
  const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
  const scored = candidates
    .map((el) => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!txt || txt.length > 64) return null;
      const matches = wanted.some((label) => {
        if (label.length <= 4) return txt === label;
        return txt === label || txt.includes(label);
      });
      if (!matches) return null;
      const role = String(el.getAttribute('role') || '').toLowerCase();
      const className = String(el.getAttribute('class') || '').toLowerCase();
      const score =
        (el.tagName === 'BUTTON' ? 4 : 0)
        + (role === 'button' ? 3 : 0)
        + ((el as any).onclick ? 2 : 0)
        + (className.includes('chip') || className.includes('tab') ? 2 : 0)
        + (txt.length <= 24 ? 1 : 0);
      return { el, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].el : null;
}

function getPrizePicksCardCount(): number {
  const cardSelectors = [
    '[data-testid*="projection"]',
    '[class*="projection"]',
    '[class*="Projection"]',
    '[class*="board-card"]',
    '[class*="BoardCard"]',
    '[class*="pick-card"]',
    '[class*="PickCard"]',
  ];
  return document.querySelectorAll(cardSelectors.join(',')).length;
}

async function waitForPrizePicksBoardReady(timeoutMs = 18000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cardCount = getPrizePicksCardCount();
    const hasMmaChip = !!findButtonByText(['mma']);
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const hasRelevantStats = /significant\s*strikes?|takedowns?|fantasy\s*(points|score)/i.test(bodyText);

    if (cardCount >= 4 || (hasMmaChip && hasRelevantStats)) {
      log('prizepicks', `Board ready: cards=${cardCount}, mmaChip=${hasMmaChip}, statText=${hasRelevantStats}`);
      return true;
    }
    await sleep(400);
  }
  log('prizepicks', 'Board readiness timed out');
  return false;
}

function clickLikeUser(el) {
  const opts = { bubbles: true, cancelable: true, view: window } as any;
  el.dispatchEvent(new MouseEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

async function clickButtonByLabels(context, labels, waitMs = 900): Promise<boolean> {
  const btn = findButtonByText(labels);
  if (!btn) {
    log(context, `Chip not found: ${labels.join(' | ')}`);
    return false;
  }
  clickLikeUser(btn);
  await sleep(waitMs);
  return true;
}

async function clickPrizePicksButton(labels, waitMs = 900): Promise<boolean> {
  return clickButtonByLabels('prizepicks', labels, waitMs);
}

async function scrapePrizePicksAllStats() {
  try {
    const merged = [];
    const mergeInto = (incoming) => {
      const map = new Map(merged.map((f) => [String(f.name || '').toLowerCase(), f]));
      for (const f of incoming) {
        const key = String(f?.name || '').toLowerCase();
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, { ...f });
        } else {
          const prev = map.get(key);
          if (f.line_fp != null) prev.line_fp = f.line_fp;
          if (f.line_ss != null) prev.line_ss = f.line_ss;
          if (f.line_ss_r1 != null) prev.line_ss_r1 = f.line_ss_r1;
          if (f.line_td != null) prev.line_td = f.line_td;
          if (!prev.opponent && f.opponent) prev.opponent = f.opponent;
          map.set(key, prev);
        }
      }
      merged.length = 0;
      merged.push(...Array.from(map.values()));
    };

    await waitForPrizePicksBoardReady();

    for (let attempt = 1; attempt <= 3; attempt++) {
      log('prizepicks', `Crawl attempt ${attempt}`);

      // Ensure sport is MMA first.
      await clickPrizePicksButton(['mma'], 1600);
      await scrollToLoadAll({ timeoutMs: 4500, intervalMs: 400 });

      // Collect from current tab first.
      const firstPass = scrapePrizePicksCurrentView();
      log('prizepicks', `Current tab pass: ${firstPass.length} fighters`);
      mergeInto(firstPass);

      // Then explicitly walk SS and TD tabs inside the same page.
      if (await clickPrizePicksButton(['significant strikes', 'significant strike'], 1300)) {
        await scrollToLoadAll({ timeoutMs: 5000, intervalMs: 400 });
        const ssPass = scrapePrizePicksCurrentView();
        log('prizepicks', `SS tab pass: ${ssPass.length} fighters`);
        mergeInto(ssPass);
      }

      if (await clickPrizePicksButton(['rd 1 significant strikes', 'round 1 significant strikes', 'r1 significant strikes'], 1300)) {
        await scrollToLoadAll({ timeoutMs: 5000, intervalMs: 400 });
        const ssR1Pass = scrapePrizePicksCurrentView();
        log('prizepicks', `RD1 SS tab pass: ${ssR1Pass.length} fighters`);
        mergeInto(ssR1Pass);
      }

      if (await clickPrizePicksButton(['takedowns', 'takedown'], 1300)) {
        await scrollToLoadAll({ timeoutMs: 5000, intervalMs: 400 });
        const tdPass = scrapePrizePicksCurrentView();
        log('prizepicks', `TD tab pass: ${tdPass.length} fighters`);
        mergeInto(tdPass);
      }

      // Try to return to a fantasy-points style tab if present.
      if (await clickPrizePicksButton(['fantasy points', 'fantasy score', 'popular'], 1000)) {
        await scrollToLoadAll({ timeoutMs: 4000, intervalMs: 400 });
        const fpPass = scrapePrizePicksCurrentView();
        log('prizepicks', `FP/Popular tab pass: ${fpPass.length} fighters`);
        mergeInto(fpPass);
      }

      if (merged.length > 0) break;
      await sleep(1200);
    }

    const result = merged.filter((f) => f.line_fp != null || f.line_ss != null || f.line_ss_r1 != null || f.line_td != null);
    log('prizepicks', `Found ${result.length} fighters after MMA+stat tab crawl`);
    return result;
  } catch (error) {
    logError('prizepicks', 'DOM scrape failed', error);
    return [];
  }
}

function scrapeDKSportsbookProps() {
  const fighters = {};
  const href = (window.location.href || '').toLowerCase();
  // 2026-05-15: DK moved stat selector from `subcategory=` to `nav_1=`; keep both for safety.
  const preferSS = href.includes('nav_1=significant-strikes-o-u') || href.includes('subcategory=significant-strikes-o-u');
  const preferTD = href.includes('nav_1=takedowns-landed-o-u') || href.includes('subcategory=takedowns-landed-o-u');

  const ensure = (name) => {
    if (!fighters[name]) {
      fighters[name] = {
        name,
        line_fp: null,
        line_ss: null,
        line_td: null,
        ss_over_odds: null,
        ss_under_odds: null,
        td_over_odds: null,
        td_under_odds: null,
      };
    }
    return fighters[name];
  };

  try {
    const pageText = document.body?.innerText || '';
    const allEls = Array.from(document.querySelectorAll('span, td, div, p, button, li'));
    log('draftkings_sportsbook', `DOM elements=${allEls.length}, pageText=${pageText.length}`);

    // Strategy 1: Leaf-node prop labels + parent-container line/odds extraction
    allEls.forEach((el) => {
      if (el.children.length > 0) return;

      const text = ((el.innerText || el.textContent || '') + '').trim();
      if (!text) return;

      const ssMatch = text.match(/^(.+?)\s+(?:Total\s+)?Significant\s+Strikes?(?:\s+Landed)?(?:\s+O\/U)?$/i);
      const tdMatch = text.match(/^(.+?)\s+(?:Total\s+)?Takedowns?(?:\s+Landed)?(?:\s+O\/U)?$/i);
      if (!ssMatch && !tdMatch) return;

      const name = (ssMatch ? ssMatch[1] : tdMatch[1]).trim();
      if (!name || name.length < 3) return;

      let container = el;
      for (let i = 0; i < 15; i++) {
        if (!container.parentElement) break;
        container = container.parentElement;
        const containerText = container.innerText || '';

        const overLineMatch = containerText.match(/Over\s+([\d.]+)\s*([+-]?\d{2,4})?/i);
        if (!overLineMatch) continue;

        const line = parseFloat(overLineMatch[1]);
        const overOdds = overLineMatch[2] ? parseInt(overLineMatch[2], 10) : null;
        const underMatch = containerText.match(/Under\s+[\d.]+\s*([+-]?\d{2,4})?/i);
        const underOdds = underMatch && underMatch[1] ? parseInt(underMatch[1], 10) : null;

        if (ssMatch && !Number.isNaN(line) && line > 0 && line < 200) {
          const f = ensure(name);
          f.line_ss = line;
          if (overOdds != null) f.ss_over_odds = overOdds;
          if (underOdds != null) f.ss_under_odds = underOdds;
          break;
        }

        if (tdMatch && !Number.isNaN(line) && line >= 0 && line < 20) {
          const f = ensure(name);
          f.line_td = line;
          if (overOdds != null) f.td_over_odds = overOdds;
          if (underOdds != null) f.td_under_odds = underOdds;
          break;
        }
      }
    });

    // Strategy 2: Regex fallback from page text
    if (Object.keys(fighters).length === 0 && pageText.length > 0) {
      const ssRegex = /([A-Z][a-zA-Z\s'\-]{2,40})\s+(?:Total\s+)?Significant\s+Strikes?(?:\s+Landed)?(?:\s+O\/U)?[\s\S]{0,220}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,150}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
      const tdRegex = /([A-Z][a-zA-Z\s'\-]{2,40})\s+(?:Total\s+)?Takedowns?(?:\s+Landed)?(?:\s+O\/U)?[\s\S]{0,220}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,150}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;

      let m;
      while ((m = ssRegex.exec(pageText)) !== null) {
        const name = m[1].trim();
        const line = parseFloat(m[2]);
        if (name && !Number.isNaN(line) && line >= 4 && line < 220) {
          const f = ensure(name);
          f.line_ss = line;
          if (m[3]) f.ss_over_odds = parseInt(m[3], 10);
          if (m[4]) f.ss_under_odds = parseInt(m[4], 10);
        }
      }

      while ((m = tdRegex.exec(pageText)) !== null) {
        const name = m[1].trim();
        const line = parseFloat(m[2]);
        if (name && !Number.isNaN(line) && line >= 0 && line < 20) {
          const f = ensure(name);
          f.line_td = line;
          if (m[3]) f.td_over_odds = parseInt(m[3], 10);
          if (m[4]) f.td_under_odds = parseInt(m[4], 10);
        }
      }

      // Subcategory-aware generic fallback when label text differs.
      if (Object.keys(fighters).length === 0 && (preferSS || preferTD)) {
        const genericRegex = /([A-Z][a-zA-Z\s'\-]{2,40})[\s\S]{0,120}?Over\s+([\d.]+)\s*([+-]?\d{2,4})?[\s\S]{0,120}?Under\s+[\d.]+\s*([+-]?\d{2,4})?/gi;
        let m;
        while ((m = genericRegex.exec(pageText)) !== null) {
          const name = m[1].trim();
          const line = parseFloat(m[2]);
          if (!name || Number.isNaN(line)) continue;
          const f = ensure(name);

          if (preferSS && line >= 4 && line < 220) {
            f.line_ss = line;
            if (m[3]) f.ss_over_odds = parseInt(m[3], 10);
            if (m[4]) f.ss_under_odds = parseInt(m[4], 10);
          } else if (preferTD && line >= 0 && line < 20) {
            f.line_td = line;
            if (m[3]) f.td_over_odds = parseInt(m[3], 10);
            if (m[4]) f.td_under_odds = parseInt(m[4], 10);
          }
        }
      }
    }

    const result = Object.values(fighters).filter((f) => f.line_ss != null || f.line_td != null);
    log('draftkings_sportsbook', `Found ${result.length} fighters (SS/TD)`);
    return result;
  } catch (error) {
    logError('draftkings_sportsbook', 'DOM scrape failed', error);
    return [];
  }
}

function getScrapeProfile(platform) {
  const base = SCRAPE_CONFIG.scrape;
  if (platform === 'pick6') {
    return {
      maxAttempts: 7,
      attemptIntervalMs: 700,
      timeoutMs: 8000,
      stableTarget: 1,
      minAttemptsBeforeResolve: 2,
      scrollTimeoutMs: 2800,
      scrollIntervalMs: 300,
    };
  }

  return {
    maxAttempts: base.maxAttempts,
    attemptIntervalMs: base.attemptIntervalMs,
    timeoutMs: base.timeoutMs,
    stableTarget: 3,
    minAttemptsBeforeResolve: 4,
    scrollTimeoutMs: SCRAPE_CONFIG.scroll.timeoutMs,
    scrollIntervalMs: SCRAPE_CONFIG.scroll.intervalMs,
  };
}

async function tryScrape(platform, scrapeFn) {
  const scrapeStart = performance.now();
  log(platform, `Scrape START at T=0`);

  const {
    maxAttempts,
    attemptIntervalMs,
    timeoutMs,
    stableTarget,
    minAttemptsBeforeResolve,
    scrollTimeoutMs,
    scrollIntervalMs,
  } = getScrapeProfile(platform);

  let bestResult = [];
  let stableCount = 0;
  let attempts = 0;
  let scrollFinished = false;

  const scrollStart = performance.now();
  scrollToLoadAll({ timeoutMs: scrollTimeoutMs, intervalMs: scrollIntervalMs })
    .catch((error) => logError(platform, 'Scroll prefetch failed', error))
    .finally(() => {
      scrollFinished = true;
      const scrollElapsed = performance.now() - scrollStart;
      log(platform, `Scroll finished at T+${scrollElapsed.toFixed(0)}ms`);
    });

  return new Promise((resolve) => {
    let interval = null;
    let timeout = null;

    const flush = () => {
      if (bestResult.length > 0) {
        log(platform, `Flushed ${bestResult.length} fighters`);
      }
    };

    const finish = () => {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      flush();
      const totalElapsed = performance.now() - scrapeStart;
      log(platform, `Scrape COMPLETE at T+${totalElapsed.toFixed(0)}ms: ${bestResult.length} fighters`);
      resolve(bestResult);
    };

    const runAttempt = () => {
      try {
        const fighters = scrapeFn();
        const attemptElapsed = performance.now() - scrapeStart;
        log(platform, `Attempt ${attempts + 1} at T+${attemptElapsed.toFixed(0)}ms: ${fighters.length} fighters`);
        if (fighters.length > bestResult.length) {
          bestResult = fighters;
          stableCount = 0;
          flush();
        } else if (fighters.length === bestResult.length && bestResult.length > 0) {
          stableCount++;
        }

        attempts++;

        const stableEnough = stableCount >= stableTarget && attempts >= minAttemptsBeforeResolve;
        const scrollSettledEnough = scrollFinished && bestResult.length > 0 && attempts >= minAttemptsBeforeResolve;
        if ((stableEnough && bestResult.length > 0) || scrollSettledEnough || attempts >= maxAttempts) {
          finish();
        }
      } catch (error) {
        logError(platform, `Scrape attempt ${attempts + 1} failed`, error);
        attempts++;
        if (attempts >= maxAttempts) {
          finish();
        }
      }
    };

    runAttempt();
    interval = setInterval(runAttempt, attemptIntervalMs);

    timeout = setTimeout(finish, timeoutMs);
  });
}

// ── INJECT PAGE-CONTEXT SCRIPT FOR UNDERDOG ────────────────────────────
// Underdog uses fetch interception to capture API data

// Pick6: capture the current pickGroup as soon as we land on a working URL.
// Auto-fetch URLs without pickGroup get redirected (DraftKings serves the homepage
// first, then React SPA-navigates to the deep URL with pickGroup for logged-in users).
// Poll window.location for ~15s so we catch the pickGroup whether it's in the initial
// URL or only appears after the SPA navigation settles. Stops as soon as we find one.
if (host.includes('pick6.draftkings.com')) {
  let lastSentPickGroup: string | null = null;
  const checkPickGroup = () => {
    try {
      const pickGroupMatch = window.location.search.match(/[?&]pickGroup=(\d+)/);
      const sportMatch = window.location.search.match(/[?&]sport=([A-Za-z]+)/);
      // 2026-05-15: DK consolidated UFC under MMA; accept either so we don't drop captures.
      const sport = sportMatch ? sportMatch[1].toUpperCase() : '';
      if (!pickGroupMatch || !sportMatch || (sport !== 'UFC' && sport !== 'MMA')) return false;
      const pickGroup = pickGroupMatch[1];
      if (pickGroup === lastSentPickGroup) return true;
      lastSentPickGroup = pickGroup;
      chrome.runtime.sendMessage({
        type: 'PICK6_PICK_GROUP_DETECTED',
        pickGroup,
        url: window.location.href,
      });
      console.log('[UFC Ext] pick6: captured pickGroup=' + pickGroup);
      return true;
    } catch (e) {
      console.error('[UFC Ext] pick6 pickGroup capture failed:', e);
      return false;
    }
  };
  if (!checkPickGroup()) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (checkPickGroup() || attempts >= 15) clearInterval(interval);
    }, 1000);
  }
}

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
  console.log('[UFC Ext] ===== CONTENT SCRIPT RUNNING ===== URL:', window.location.href, 'host:', host, 'pathname:', window.location.pathname);

  try {
    // Pick6
    if (host.includes('draftkings.com') && host.includes('pick6')) {
      console.log('[UFC Ext] Detected Pick6, starting scrape...');
      let fighters = await scrapePick6AllStats();
      if ((fighters?.length || 0) === 0) {
        fighters = await tryScrape('pick6', () => scrapePick6());
      }
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

    // PrizePicks board
    if (host.includes('prizepicks.com') && window.location.pathname.includes('/board')) {
      console.log('[UFC Ext] Detected PrizePicks board, starting scrape...');
      const fighters = await scrapePrizePicksAllStats();
      chrome.runtime.sendMessage({
        type: 'LINES_CAPTURED',
        platform: 'prizepicks',
        data: { fighters },
      });
      return;
    }

    // DraftKings Sportsbook (MMA Fighter Props - SS + TD with Odds)
    console.log('[UFC Ext] Checking DraftKings Sportsbook: host.includes("sportsbook.draftkings.com")=', host.includes('sportsbook.draftkings.com'), ', pathname.includes("ufc")=', window.location.pathname.includes('ufc'));
    if (host.includes('sportsbook.draftkings.com') && window.location.pathname.includes('ufc')) {
      console.log('[UFC Ext] Detected DraftKings Sportsbook MMA, starting scrape with odds capture...');
      
      // DraftKings has lazy-loaded content, scroll to trigger rendering
      try {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((r) => setTimeout(r, 800));
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        console.log('[UFC Ext] Error scrolling DraftKings page:', e);
      }
      
      const fighters = await tryScrape('draftkings_sportsbook', () => scrapeDKSportsbookProps());
      if (fighters.length > 0) {
        chrome.runtime.sendMessage({
          type: 'LINES_CAPTURED',
          platform: 'draftkings_sportsbook',
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
