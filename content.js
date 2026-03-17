(function () {
  const host = window.location.hostname;

  // ── Inject page-context script for Underdog fetch interception ────────
  if (host.includes("underdogfantasy") || host.includes("underdogsports")) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    window.addEventListener("__ufc_underdog__", (e) => {
      const fighters = e.detail?.fighters || [];
      if (fighters.length > 0) {
        console.log("[UFC Ext] Underdog captured", fighters.length, "fighters via fetch intercept");
        chrome.runtime.sendMessage({ type: "LINES_CAPTURED", platform: "underdog", data: { fighters } });
      }
    });
  }

  // ── Underdog DOM scraper (fallback) ────────────────────────────────────
  // Card format: "Max Holloway\n\nHolloway vs Oliveira - Sat 10:20PM EST\n\n86.5\nSignificant Strikes\nHigher\nLower"
  function scrapeUnderdog() {
    const fighters = {};

    document.querySelectorAll('[data-testid="over-under-cell"]').forEach(cell => {
      const isMMA = cell.querySelector('[data-testid="test-icon-mma"]');
      if (!isMMA) return;
      const nameEl = cell.querySelector('[class*="nameAndButtons"] [class*="name"], [class*="playerName"], [class*="displayName"]');
      const name = nameEl?.textContent?.trim() || cell.querySelector("strong, h3, h4")?.textContent?.trim();
      if (!name) return;
      const cardText = cell.innerText || "";
      const cardLines = cardText.split("\n").map(l => l.trim()).filter(Boolean);

      // Find number followed by stat label
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

    return Object.values(fighters).filter(f => f.line_fp || f.line_ss || f.line_td);
  }

  // ── Pick6 DOM scraper ──────────────────────────────────────────────────
  function scrapePick6() {
    const fighters = {};
    const seen = new Set();

    // Each card has a cardButton with aria-label + stat type text
    document.querySelectorAll('[data-testid="cardButton"]').forEach(btn => {
      const nameMatch = (btn.getAttribute("aria-label") || "").match(/Open (.+?)'s stat/i);
      if (!nameMatch) return;
      const name = nameMatch[1].trim();
      const cardText = btn.closest("div[class]")?.innerText || "";
      const oppMatch = cardText.match(/vs\s+([^\n]+)/i);
      const opponent = oppMatch ? oppMatch[1].trim() : null;

      // Fantasy Points
      const fpMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Fantasy Points/i);
      if (fpMatch) {
        const line = parseFloat(fpMatch[1]);
        if (line > 5 && line < 500) {
          if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          fighters[name].line_fp = line;
          if (opponent) fighters[name].opponent = opponent;
        }
      }

      // Significant Strikes
      const ssMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
      if (ssMatch) {
        const line = parseFloat(ssMatch[1]);
        if (line > 0 && line < 400) {
          if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          fighters[name].line_ss = line;
          if (opponent) fighters[name].opponent = opponent;
        }
      }

      // Takedowns — handle "0.5", ".5", "Takedowns" or "Takedown" (singular)
      const tdMatch = cardText.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
      if (tdMatch) {
        const line = parseFloat(tdMatch[1]);
        if (!isNaN(line) && line >= 0 && line < 20) {
          if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
          fighters[name].line_td = line;
          if (opponent) fighters[name].opponent = opponent;
        }
      }
    });

    // Strategy 2: broader text scan if Strategy 1 found nothing
    if (Object.keys(fighters).length === 0) {
      document.querySelectorAll('[class*="PlayerCard"], [class*="player"], [class*="Pick"]').forEach(card => {
        const text = card.innerText || "";
        const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Fantasy Points/i);
        const ssMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
        const tdMatch = text.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
        if (!fpMatch && !ssMatch && !tdMatch) return;
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const vsIdx = lines.findIndex(l => /^vs\s/i.test(l));
        const name = vsIdx > 0 ? lines[vsIdx - 1] : lines[0];
        const opponent = vsIdx >= 0 ? lines[vsIdx].replace(/^vs\s*/i, "").trim() : null;
        if (!name || name.length < 3 || name.length > 40) return;
        if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
        if (fpMatch) fighters[name].line_fp = parseFloat(fpMatch[1]);
        if (ssMatch) fighters[name].line_ss = parseFloat(ssMatch[1]);
        if (tdMatch) fighters[name].line_td = parseFloat(tdMatch[1]);
        if (opponent) fighters[name].opponent = opponent;
      });
    }

    return Object.values(fighters).filter(f => f.line_fp || f.line_ss || f.line_td);
  }

  // ── Scroll to load all lazy-rendered cards ─────────────────────────────
  function scrollToLoadAll() {
    return new Promise(resolve => {
      let lastHeight = 0, stableCount = 0;
      const interval = setInterval(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) { stableCount++; if (stableCount >= 3) { clearInterval(interval); window.scrollTo(0, 0); setTimeout(resolve, 500); } }
        else { stableCount = 0; lastHeight = newHeight; }
      }, 600);
      setTimeout(() => { clearInterval(interval); resolve(); }, 12000);
    });
  }

  async function tryScrape(platform, scrapeFn) {
    await scrollToLoadAll();

    return new Promise((resolve) => {
      let bestResult = [];
      let stableCount = 0;
      let attempts = 0;

      const flush = () => {
        if (bestResult.length > 0) {
          chrome.runtime.sendMessage({ type: "LINES_CAPTURED", platform, data: { fighters: bestResult } });
        }
      };

      const interval = setInterval(() => {
        const fighters = scrapeFn();
        console.log(`[UFC Ext] ${platform} attempt ${attempts + 1}: ${fighters.length} fighters`);

        if (fighters.length > bestResult.length) {
          bestResult = fighters;
          stableCount = 0;
          flush();
        } else if (fighters.length === bestResult.length && bestResult.length > 0) {
          stableCount++;
        }

        attempts++;
        if ((stableCount >= 3 && bestResult.length > 0) || attempts >= 20) {
          clearInterval(interval);
          clearTimeout(timeout);
          flush();
          resolve(bestResult);
        }
      }, 1500);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        flush();
        resolve(bestResult);
      }, 35000);
    });
  }

  // ── DraftKings Sportsbook TD props scraper ────────────────────────────
  // Page format: "{Fighter} Total Takedowns Landed O/U" label, then "Over X.X" below
  function scrapeDKSportsbookTDs() {
    const fighters = {};

    // Strategy 1: Find all elements containing "Total Takedowns Landed O/U"
    // then grab the Over line value from the adjacent bet button
    const allEls = Array.from(document.querySelectorAll('*'));
    allEls.forEach(el => {
      if (el.children.length > 0) return; // leaf nodes only
      const text = (el.innerText || el.textContent || '').trim();
      const m = text.match(/^(.+?)\s+Total Takedowns Landed O\/U$/i);
      if (!m) return;
      const name = m[1].trim();
      if (!name || name.length < 3) return;

      // Walk up to find the container, then look for "Over X.X" nearby
      let container = el.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const containerText = container.innerText || '';
        // Match "Over 0.5" or "Over 1.5" pattern
        const overMatch = containerText.match(/Over\s+(\d+\.?\d*)/i);
        if (overMatch) {
          const v = parseFloat(overMatch[1]);
          if (!isNaN(v) && v >= 0 && v < 20) {
            fighters[name] = { name, line_fp: null, line_ss: null, line_td: v };
            return;
          }
        }
        container = container.parentElement;
      }
    });

    // Strategy 2: Full innerText scan for the known pattern
    if (Object.keys(fighters).length === 0) {
      const pageText = document.body.innerText;
      // Match: "{Name} Total Takedowns Landed O/U\nOver {X}\n" or nearby
      const regex = /([A-Z][a-zA-Z\s'-]{2,40})\s+Total Takedowns Landed O\/U[\s\S]{0,80}?Over\s+(\d+\.?\d*)/gi;
      let match;
      while ((match = regex.exec(pageText)) !== null) {
        const name = match[1].trim();
        const v = parseFloat(match[2]);
        if (!isNaN(v) && v >= 0 && v < 20 && !fighters[name]) {
          fighters[name] = { name, line_fp: null, line_ss: null, line_td: v };
        }
      }
    }

    // Strategy 3: Line-by-line scan of innerText
    if (Object.keys(fighters).length === 0) {
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(.+?)\s+Total Takedowns Landed O\/U$/i);
        if (!m) continue;
        const name = m[1].trim();
        // Look ahead up to 10 lines for "Over X.X"
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const overMatch = lines[j].match(/^Over\s+(\d+\.?\d*)$/i)
                         || lines[j].match(/^(\d+\.?\d+)$/);
          if (overMatch) {
            const v = parseFloat(overMatch[1]);
            if (!isNaN(v) && v >= 0 && v < 20) {
              if (!fighters[name]) fighters[name] = { name, line_fp: null, line_ss: null, line_td: v };
              break;
            }
          }
        }
      }
    }

    const result = Object.values(fighters).filter(f => f.line_td != null);
    console.log(`[UFC Ext] DK Sportsbook TD scrape: ${result.length} fighters found`, result.map(f => `${f.name}=${f.line_td}`));
    return result;
  }

  if (host.includes("underdogfantasy") || host.includes("underdogsports")) tryScrape("underdog", scrapeUnderdog);

  if (host.includes("draftkings")) {
    const url = window.location.href;
    if (url.includes('sportsbook') && (url.includes('/mma') || url.includes('/ufc') || url.includes('takedown') || url.includes('fight-prop'))) {
      // DK Sportsbook page — wait for page to render then scrape TD props if present
      setTimeout(() => {
        if (document.body.innerText.includes('Total Takedowns')) {
          tryScrape("pick6", scrapeDKSportsbookTDs);
        }
      }, 3000);
    } else {
      tryScrape("pick6", scrapePick6);
    }
  }
  if (host.includes("betr.app") || host.includes("betr")) {
    tryScrape("betr", () => {
      const fighters = {}, seen = new Set();
      document.querySelectorAll("*").forEach(el => {
        if (el.children.length > 6) return;
        const text = el.innerText || "";
        if (!text.includes("Fantasy") && !text.includes("Pts")) return;
        if (text.length > 400) return;
        const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy Points|Pts)/i);
        if (!fpMatch) return;
        const line = parseFloat(fpMatch[1]);
        if (line < 20 || line > 300) return;
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const name = lines[0];
        if (!name || name.length < 3 || name.length > 40 || /^\d/.test(name) || seen.has(name)) return;
        seen.add(name);
        fighters[name] = { name, line_fp: line, line_ss: null, line_td: null };
      });
      return Object.values(fighters);
    });
  }
})();

// ── DEBUG: dump first few card texts on Pick6/Underdog ─────────────────
if (typeof chrome !== 'undefined') {
  setTimeout(() => {
    const host = window.location.hostname;
    if (host.includes('draftkings')) {
      const url = window.location.href;
      if (url.includes('sportsbook')) {
        // Dump raw page text from sportsbook for debugging
        setTimeout(() => {
          const raw = document.body.innerText.slice(0, 3000);
          chrome.runtime.sendMessage({ type: 'DEBUG_CARD_TEXT', platform: 'sportsbook', samples: [{ text: raw }] });
        }, 4000);
      } else {
        const cards = document.querySelectorAll('[data-testid="cardButton"]');
        const samples = [];
        cards.forEach((btn, i) => {
          if (i >= 3) return;
          const text = btn.closest("div[class]")?.innerText || btn.innerText || '';
          samples.push({ aria: btn.getAttribute('aria-label'), text: text.slice(0, 300) });
        });
        chrome.runtime.sendMessage({ type: 'DEBUG_CARD_TEXT', platform: 'pick6', samples });
      }
    }
    if (host.includes('underdogfantasy') || host.includes('underdogsports')) {
      const cells = document.querySelectorAll('[data-testid="over-under-cell"]');
      const samples = [];
      cells.forEach((cell, i) => {
        if (i >= 3) return;
        samples.push({ text: cell.innerText?.slice(0, 300) });
      });
      chrome.runtime.sendMessage({ type: 'DEBUG_CARD_TEXT', platform: 'underdog', samples });
    }
  }, 3000);
}
