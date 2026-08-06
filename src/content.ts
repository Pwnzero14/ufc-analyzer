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
      // The nearest classed ancestor wraps only the card FACE — the More/Less button
      // row sits outside it, so probing that text found neither button and every
      // *_under_available flag came back false regardless of what the site showed.
      // Measured 2026-07-31 on the Takedowns tab: `More` present in the tight
      // container on 0 of 8 cards; walking up ONE level resolved Less correctly on
      // all 8 (true for Rebecki/Elliott/Tybura, false for the five More-only cards).
      // Walk up to the first ancestor that includes the button row, but stop before
      // any container holding more than one card — that would make Less look true
      // for everybody. Line parsing is unaffected: the wider text is a superset.
      // LINE PARSING stays on the tight container — proven correct on 8/8 cards, and
      // widening it for every stat regressed TD capture to zero. Only the Less probe
      // needs the wider text, so it gets its own variable and nothing else changes.
      const cardText = btn.closest('div[class]')?.innerText || '';
      // Button text: walk up to the first ancestor that actually contains the
      // More/Less row, stopping before any ancestor holding more than one card
      // (a grid container would make Less look true for everyone).
      const buttonText = (() => {
        let probe = btn.closest('div[class]');
        for (let i = 0; i < 6 && probe; i++) {
          const t = probe.innerText || '';
          if ((t.match(/\bvs\b/gi) || []).length > 1) break;
          if (/\bMore\b/i.test(t)) return t;
          probe = probe.parentElement?.closest('div[class]') || null;
        }
        return cardText;
      })();
      const hasLess = /\bLess\b/i.test(buttonText);
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
          // Underdogs get a More/OVER-only FP prop — detect the Less button so FP UNDERs
          // can be gated without relying on the (often-incomplete) moneyline odds map.
          fighters[name].fp_under_available = hasLess;
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
          // Pick6 sometimes only offers "More" (OVER) on SS — detect Less button.
          fighters[name].ss_under_available = hasLess;
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
          // Pick6 low takedown lines are often More/OVER-only — detect Less button.
          fighters[name].td_under_available = hasLess;
        }
      }

      // Control Time — minutes. Accepts "2:30 Control" or "2.5 Control Time".
      //
      // Pick6 renders this value with an ANIMATED ODOMETER: alongside the plain
      // "06:30" the DOM also carries one element per character, so innerText comes
      // back as "06:30 \n 0 \n 6 \n : \n 3 \n 0 \n Control Time". Those loose digits
      // sit between the value and the label and break the adjacency the pattern
      // below requires, so ONLY cards whose odometer happened to render the value
      // plainly twice ever matched. Measured on the live board 2026-08-06: 10 cards
      // carried Control Time, 4 matched, and CTRL landed for 2 after the merge.
      // Collapsing whitespace normalises both renderings to "<value><value>Control
      // Time", so one pattern covers each. mm is bounded to two digits because the
      // greedy form swallows the doubled value ("06:3006:30" -> mm=3006), which then
      // fails the < 25 sanity check below and silently drops the line.
      const ctrlCompact = cardText.replace(/\s+/g, '').match(/(\d{1,2}):(\d{2})Control(?:Time)?/i);
      const ctrlMMSS = ctrlCompact || cardText.match(/(\d+):(\d{2})\s*\n?\s*Control(?:\s*Time)?/i);
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
        fighters[name].ctrl_under_available = hasLess;
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
        if (fpMatch) { fighters[name].line_fp = parseFloat(fpMatch[1]); fighters[name].fp_under_available = /\bLess\b/i.test(text); }
        // Capture Less-button availability per stat (mirrors the primary path) so Pick6
        // OVER-only SS/TD unders get gated out of Best Picks. This is the path used on
        // the ?sport=UFC props page, so without it the gate never fires here.
        if (ssMatch) { fighters[name].line_ss = parseFloat(ssMatch[1]); fighters[name].ss_under_available = /\bLess\b/i.test(text); }
        if (tdMatch) { fighters[name].line_td = parseFloat(tdMatch[1]); fighters[name].td_under_available = /\bLess\b/i.test(text); }
      });
    }

    // ── Tertiary: scan for any element whose text matches a line + stat label ─
    // Broadest fallback for unknown card layouts on new Pick6 pages
    if (Object.keys(fighters).length === 0) {
      const allText = document.body.innerText || '';
      // Find all "NUMBER \n Significant Strikes" or "NUMBER \n Takedowns" patterns with surrounding name
      const lineBlocks = [...allText.matchAll(/([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*\n+([\d]+\.?\d*)\s*\n?((?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)|Significant Strikes|Takedown)/gi)];
      // Body-wide innerText has no per-card scoping, so the More/Less side-availability
      // buttons can't be tested against allText (any Less anywhere on the page would flag
      // every fighter). Locate each fighter's own card instead: find the leaf element whose
      // text is exactly the name and walk up until the container holds the More/Less
      // buttons. Without this, the tertiary path captured lines with NO availability flags,
      // and unplaceable Pick6 FP unders leaked whenever the moneyline couldn't identify the
      // dog (UFC 329: Tracy Cortez at a dead-even -110/-110).
      const cardTextByName = {};
      const findCardText = (name) => {
        if (name in cardTextByName) return cardTextByName[name];
        let found = null;
        const leaves = Array.from(document.querySelectorAll('div, span, p, h3, h4, a, button'))
          .filter((el) => el.children.length === 0 && (el.innerText || '').trim() === name);
        for (const el of leaves) {
          let c = el;
          for (let i = 0; i < 12 && c.parentElement; i++) {
            c = c.parentElement;
            const t = c.innerText || '';
            if (t.length > 1500) break; // grew past a single card — try the next leaf
            if (/\bMore\b/i.test(t) || /\bLess\b/i.test(t)) { found = t; break; }
          }
          if (found) break;
        }
        cardTextByName[name] = found;
        return found;
      };
      for (const m of lineBlocks) {
        const name = m[1].trim();
        const val = parseFloat(m[2]);
        const stat = m[3].toLowerCase();
        if (!name || name.length > 45 || isNaN(val)) continue;
        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent: null };
        const isFp = stat.includes('fantasy') || stat.includes('fight score') || /fight\s*(?:points?|pts?)/.test(stat);
        // Bound each stat like the structured paths do — the body-text scan happily grabs
        // stray UI digits (badges/multipliers) sitting next to a stat label (observed:
        // Pick6 "1" next to "Significant Strikes" stored as McGregor's SS line).
        if (isFp) { if (val > 5 && val < 500) fighters[name].line_fp = val; }
        else if (stat.includes('significant')) { if (val >= 4 && val < 400) fighters[name].line_ss = val; }
        else if (stat.includes('takedown')) { if (val >= 0 && val < 20) fighters[name].line_td = val; }
        // Per-stat Less-button flag: Pick6 cards show one stat per tab, so the card's
        // Less presence reflects the stat we just matched. Leave undefined when the
        // card can't be located (unknown ≠ More-only).
        const cardText = findCardText(name);
        if (cardText != null) {
          const less = /\bLess\b/i.test(cardText);
          if (isFp) fighters[name].fp_under_available = less;
          else if (stat.includes('significant')) fighters[name].ss_under_available = less;
          else if (stat.includes('takedown')) fighters[name].td_under_available = less;
        }
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
        if (fpMatch) { fighters[name].line_fp = parseFloat(fpMatch[1]); fighters[name].fp_under_available = /\bLess\b/i.test(text); }
        if (ssMatch) { fighters[name].line_ss = parseFloat(ssMatch[1]); fighters[name].ss_under_available = /\bLess\b/i.test(text); }
        if (tdMatch) { fighters[name].line_td = parseFloat(tdMatch[1]); fighters[name].td_under_available = /\bLess\b/i.test(text); }
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
    let lastSentCells = 0;

    // Send partial results immediately so the service worker can exit early.
    //
    // Fires when the fighter count grows OR when the total number of filled stat
    // cells grows. The cell count matters because EVERY stat after the first tab
    // lands on an EXISTING fighter rather than adding a row, so the count alone
    // goes flat and no send fires. This previously had a CTRL-only special case;
    // TD has the identical property and never got one, so a Takedowns pass that
    // added 8 lines to known fighters triggered no send at all — the TD data sat
    // here unsent, waiting to be carried out by the eventual CTRL send. When the
    // service worker hit its ctrlGrace timeout (background.ts ~2481) and closed
    // the tab first, TD and CTRL were lost together. Observed 2026-07-31: the
    // crawl logged `td=8, ctrl=13` while storage held TD: 0, CTRL: 0.
    // Counting cells covers FP/SS/TD/CTRL uniformly — no per-stat cases to forget.
    const statCells = (list) => list.reduce((n, f) =>
      n + (f.line_fp != null ? 1 : 0) + (f.line_ss != null ? 1 : 0)
        + (f.line_td != null ? 1 : 0) + (f.line_ctrl != null ? 1 : 0), 0);
    const sendInterim = () => {
      const valid = merged.filter((f) => f.line_fp != null || f.line_ss != null || f.line_td != null || f.line_ctrl != null);
      const cells = statCells(valid);
      if (valid.length > lastSentCount || cells > lastSentCells) {
        lastSentCount = valid.length;
        lastSentCells = cells;
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
        // Per-stat Less-button flags MUST merge alongside their line. This is an
        // allowlist, not a pass-through: a fighter is created by whichever stat tab
        // sees them first, and every later tab's flags were being dropped here even
        // though the scrape captured them correctly. Net effect — a fighter's TD line
        // arrived from the Takedowns tab while td_under_available stayed null, and the
        // analyzer reads a null TD flag as More-only (suppress-by-default), so EVERY
        // Pick6 TD UNDER was killed before it could be ranked. Measured 2026-07-31:
        // td_under_available === true on 0 of 8 Pick6 fighters holding a TD line,
        // while the site showed Less buttons on four of them. Same trap as the
        // mergeFighters allowlist in background.ts.
        if (f.fp_under_available   != null) prev.fp_under_available   = f.fp_under_available;
        if (f.ss_under_available   != null) prev.ss_under_available   = f.ss_under_available;
        if (f.td_under_available   != null) prev.td_under_available   = f.td_under_available;
        if (f.ctrl_under_available != null) prev.ctrl_under_available = f.ctrl_under_available;
        if (!prev.opponent && f.opponent) prev.opponent = f.opponent;
        map.set(key, prev);
      }
      merged.length = 0;
      merged.push(...Array.from(map.values()));
    };

    // Require FP/SS/TD breadth; CTRL is optional (Pick6 only offers it on some cards / some events).
    const hasEnoughCoverage = (c) => c.total >= 8 && c.fpCount >= 4 && c.ssCount >= 4 && c.tdCount >= 2;

    // CTRL is excluded from hasEnoughCoverage on purpose, but that same predicate
    // used to gate an early `break` placed BEFORE the Control Time pass below — so
    // whenever the first scrape already had FP/SS/TD breadth, the loop exited and
    // CTRL was never even ATTEMPTED. "Optional" silently became "never". Observed
    // 2026-08-06: Aug 1 captured ctrl=13/28, Aug 5 and Aug 6 both stored ZERO, with
    // line_ctrl absent from every row rather than null. Track whether the CTRL pass
    // has run so the early exit can only fire once CTRL has had its shot — that
    // keeps the speed win on the second attempt without dropping the stat.
    let ctrlAttempted = false;

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
      if (ctrlAttempted && hasEnoughCoverage(coverage)) break;

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

      // Control Time — Pick6 re-nested this under a parent "Time" tab (Fight Time /
      // Control Time sub-row appears only after Time is clicked). Click the parent
      // first to surface the sub-tabs, then the Control Time sub-tab. Waits bumped
      // beyond a single rAF tick to survive throttled inactive tabs.
      // Both wait for their control to exist. The Time tab and its Fight Time /
      // Control Time sub-pills render asynchronously (and sit on a different
      // category URL, so the click can navigate), which the old fixed 1000ms
      // gap did not reliably cover — the Control Time pill was probed once,
      // missed, and the whole CTRL pass was skipped.
      await clickButtonByLabelsWhenReady('pick6', ['time'], 1000, 6000);
      const ctrlClicked = await clickButtonByLabelsWhenReady('pick6', ['control time', 'control mins', 'control minutes'], 1200, 6000);
      ctrlAttempted = true;
      if (ctrlClicked) {
        log('pick6', 'Clicked Control Time pill, scraping');
        await scrollToLoadAll({ timeoutMs: 1200, intervalMs: 200 });
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
        else if (label.includes('significant strike') || label.includes('sig. strike')) {
          // Round-1-only variants get their own bucket so they don't overwrite the
          // total-fight SS line.
          lineType = /\bround\b|\brd\.?\s*\d|\br\d\b/i.test(label) ? 'ss_r1' : 'ss';
        }
        // "Takedown Attempts" is a different prop (attempts, not landed) — not fetched.
        else if (label.includes('takedown') && !label.includes('attempt')) lineType = 'td';
        if (!lineType) continue;
        // Takedown lines are bounded (~0.5–6.5); reject SS/FP-magnitude values that
        // would otherwise land in line_td and surface as a bogus "TD UNDER 59.5".
        if (lineType === 'td' && (val < 0 || val >= 20)) continue;

        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_ss_r1: null, line_td: null, opponent };
        fighters[name][`line_${lineType}`] = val;
        if (opponent && !fighters[name].opponent) fighters[name].opponent = opponent;
      }
    });

    const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_ss_r1 || f.line_td || f.line_ctrl);
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

/**
 * Same as clickButtonByLabels but POLLS for the control to appear instead of
 * probing the DOM once.
 *
 * Needed for chips that only exist after a previous click has rendered (Pick6's
 * Fight Time / Control Time sub-pills appear only once the Time tab is open, and
 * those tabs live on different category URLs so the click can trigger a real
 * navigation). The single-probe version raced that render: it looked once, found
 * nothing, logged "Chip not found" and returned false — so the Control Time pass
 * silently never ran and CTRL stayed 0 no matter how long the service worker
 * waited. Confirmed by watching the fetch: it opened Time and never clicked
 * Control Time.
 */
async function clickButtonByLabelsWhenReady(context, labels, waitMs = 900, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let btn = findButtonByText(labels);
  while (!btn && Date.now() < deadline) {
    await sleep(200);
    btn = findButtonByText(labels);
  }
  if (!btn) {
    log(context, `Chip not found after ${timeoutMs}ms: ${labels.join(' | ')}`);
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

function scrapeDKBetHandle(): Array<{ name: string; pct: number }> {
  try {
    const results: Array<{ name: string; pct: number }> = [];
    const widgets = document.querySelectorAll('[data-testid="bet-breakdown"]');
    if (widgets.length === 0) {
      const fallback = [...document.querySelectorAll('*')].find(
        (n) => (n.textContent || '').trim().toLowerCase() === '% of bets placed'
      );
      if (fallback) {
        let box: Element | null = fallback;
        for (let i = 0; i < 5 && box?.parentElement; i++) box = box.parentElement;
        if (box) {
          const names = box.querySelectorAll('.cb-bet-breakdown__team-name');
          const pcts = box.querySelectorAll('.cb-bet-breakdown__team-percentage');
          for (let i = 0; i < names.length && i < pcts.length; i++) {
            const name = (names[i].textContent || '').trim();
            const pct = parseInt((pcts[i].textContent || '').replace('%', ''), 10);
            if (name && Number.isFinite(pct)) results.push({ name, pct });
          }
        }
      }
      return results;
    }
    widgets.forEach((w) => {
      const names = w.querySelectorAll('.cb-bet-breakdown__team-name');
      const pcts = w.querySelectorAll('.cb-bet-breakdown__team-percentage');
      for (let i = 0; i < names.length && i < pcts.length; i++) {
        const name = (names[i].textContent || '').trim();
        const pct = parseInt((pcts[i].textContent || '').replace('%', ''), 10);
        if (name && Number.isFinite(pct)) results.push({ name, pct });
      }
    });
    console.log(`[UFC Ext] DK bet-handle: found ${results.length} entries`, results);
    return results;
  } catch (error) {
    console.error('[UFC Ext] DK bet-handle scrape failed:', error);
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

    // DraftKings Event page — "% of bets placed" scrape (opportunistic)
    if (host.includes('sportsbook.draftkings.com') && window.location.pathname.startsWith('/event/')) {
      console.log('[UFC Ext] DK event page detected, scraping bet-handle...');
      await new Promise((r) => setTimeout(r, 2000));
      const handles = scrapeDKBetHandle();
      if (handles.length >= 2) {
        chrome.runtime.sendMessage({ type: 'BET_HANDLE_CAPTURED', data: handles });
      }
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
