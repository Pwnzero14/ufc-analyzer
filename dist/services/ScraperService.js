import { CONFIG } from '../config/index.js';
/**
 * Unified scraper service for all platforms
 * Extracts DOM scraping logic with improved error handling and logging
 */
export class ScraperService {
    static log(platform, msg) {
        if (CONFIG.logging.debug) {
            console.log(`[UFC Ext] ${platform}: ${msg}`);
        }
    }
    static logError(platform, msg, error) {
        const err = error instanceof Error ? error.message : String(error);
        console.error(`[UFC Ext] ${platform} ERROR: ${msg}`, err);
    }
    // ── PICK6 (DraftKings Fantasy) ─────────────────────────────────────────
    static scrapePick6() {
        const fighters = {};
        const config = CONFIG.selectors.pick6;
        try {
            // Strategy 1: Use cardButton data-testid selector
            document.querySelectorAll(config.cardButton).forEach((btn) => {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const nameMatch = ariaLabel.match(/Open (.+?)'s stat/i);
                if (!nameMatch)
                    return;
                const name = nameMatch[1].trim();
                const cardText = btn.closest('div[class]')?.innerText || '';
                const oppMatch = cardText.match(/vs\s+([^\n]+)/i);
                const opponent = oppMatch ? oppMatch[1].trim() : null;
                // Fantasy Points
                const fpMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)/i)
                    || cardText.match(/(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/i)
                    || cardText.match(/([\d]+\.?\d*)\s*\n?\s*(?:Score|Pts?\.?)\s*$/im)
                    || cardText.match(/^(?:Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/im);
                if (fpMatch) {
                    const line = parseFloat(fpMatch[1]);
                    const valid = line > 5 && line < 500;
                    if (valid) {
                        if (!fighters[name]) {
                            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
                        }
                        fighters[name].line_fp = line;
                    }
                }
                // Significant Strikes
                const ssMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
                if (ssMatch) {
                    const line = parseFloat(ssMatch[1]);
                    const valid = line > 0 && line < 400;
                    if (valid) {
                        if (!fighters[name]) {
                            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
                        }
                        fighters[name].line_ss = line;
                        // Pick6 sometimes only offers "More" (OVER) on SS — detect Less button.
                        fighters[name].ss_under_available = /\bLess\b/i.test(cardText);
                    }
                }
                // Takedowns
                const tdMatch = cardText.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
                if (tdMatch) {
                    const line = parseFloat(tdMatch[1]);
                    if (!isNaN(line) && line >= 0 && line < 20) {
                        if (!fighters[name]) {
                            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
                        }
                        fighters[name].line_td = line;
                        // Pick6 low takedown lines are often More/OVER-only — detect Less button.
                        fighters[name].td_under_available = /\bLess\b/i.test(cardText);
                    }
                }
                // Control Time — stored in minutes. Matches either decimal minutes
                // ("2.5 Control Time") or mm:ss ("2:30 Control"). Cap at 25 min guard.
                const ctrlMatchMMSS = cardText.match(/(\d+):(\d{2})\s*\n?\s*Control(?:\s*Time)?/i);
                const ctrlMatchDec = cardText.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Control(?:\s*Time)?/i);
                let ctrlLine = null;
                if (ctrlMatchMMSS) {
                    const mins = parseInt(ctrlMatchMMSS[1], 10);
                    const secs = parseInt(ctrlMatchMMSS[2], 10);
                    if (!isNaN(mins) && !isNaN(secs))
                        ctrlLine = parseFloat((mins + secs / 60).toFixed(2));
                }
                else if (ctrlMatchDec) {
                    const v = parseFloat(ctrlMatchDec[1]);
                    if (!isNaN(v))
                        ctrlLine = v;
                }
                if (ctrlLine != null && ctrlLine >= 0 && ctrlLine < 25) {
                    if (!fighters[name]) {
                        fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
                    }
                    fighters[name].line_ctrl = ctrlLine;
                    // Pick6 CTRL UNDERs are only sometimes offered — detect by presence of "Less" button.
                    fighters[name].ctrl_under_available = /\bLess\b/i.test(cardText);
                }
            });
            // Fallback Strategy 2: Broader selector
            if (Object.keys(fighters).length === 0) {
                document.querySelectorAll(config.playerCard).forEach((card) => {
                    const text = card.innerText || '';
                    const fpMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)/i)
                        || text.match(/(?:Fantasy|Fight)\s*(?:Points?|Score|Pts?\.?)\s*\n?\s*([\d]+\.?\d*)/i);
                    const ssMatch = text.match(/([\d]+\.?\d*)\s*\n?\s*Significant Strikes/i);
                    const tdMatch = text.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Takedowns?/i);
                    const ctrlMatchMMSS = text.match(/(\d+):(\d{2})\s*\n?\s*Control(?:\s*Time)?/i);
                    const ctrlMatchDec = text.match(/((?:\d+\.?\d*|\.\d+))\s*\n?\s*Control(?:\s*Time)?/i);
                    if (!fpMatch && !ssMatch && !tdMatch && !ctrlMatchMMSS && !ctrlMatchDec)
                        return;
                    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
                    const vsIdx = lines.findIndex((l) => /^vs\s/i.test(l));
                    const name = vsIdx > 0 ? lines[vsIdx - 1] : lines[0];
                    const opponent = vsIdx >= 0 ? lines[vsIdx].replace(/^vs\s*/i, '').trim() : null;
                    if (!name || name.length < 3 || name.length > 40)
                        return;
                    if (!fighters[name]) {
                        fighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
                    }
                    if (fpMatch)
                        fighters[name].line_fp = parseFloat(fpMatch[1]);
                    if (ssMatch)
                        fighters[name].line_ss = parseFloat(ssMatch[1]);
                    if (tdMatch)
                        fighters[name].line_td = parseFloat(tdMatch[1]);
                    if (ctrlMatchMMSS) {
                        const m = parseInt(ctrlMatchMMSS[1], 10);
                        const s = parseInt(ctrlMatchMMSS[2], 10);
                        if (!isNaN(m) && !isNaN(s))
                            fighters[name].line_ctrl = parseFloat((m + s / 60).toFixed(2));
                    }
                    else if (ctrlMatchDec) {
                        const v = parseFloat(ctrlMatchDec[1]);
                        if (!isNaN(v) && v >= 0 && v < 25)
                            fighters[name].line_ctrl = v;
                    }
                });
            }
            const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td || f.line_ctrl);
            this.log('pick6', `Found ${result.length} fighters`);
            return result;
        }
        catch (error) {
            this.logError('pick6', 'DOM scrape failed', error);
            return [];
        }
    }
    // ── UNDERDOG FANTASY ───────────────────────────────────────────────────
    static scrapeUnderdog() {
        const fighters = {};
        const config = CONFIG.selectors.underdog;
        try {
            document.querySelectorAll(config.overUnderCell).forEach((cell) => {
                const isMMA = cell.querySelector(config.mmaIcon);
                if (!isMMA)
                    return;
                const nameEl = cell.querySelector(config.nameSelector);
                const name = nameEl?.textContent?.trim() || cell.querySelector('strong, h3, h4')?.textContent?.trim();
                if (!name)
                    return;
                const cardText = cell.innerText || '';
                const cardLines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
                // Find number followed by stat label
                for (let i = 0; i < cardLines.length - 1; i++) {
                    // Strip leading arrow/direction indicators (↑ ↓ ▲ ▼) that Underdog prepends
                    // to lines that have moved — e.g. "↑ 27.5" → "27.5"
                    const cleanLine = cardLines[i].replace(/^[↑↓▲▼⬆⬇]\s*/, '').trim();
                    const numMatch = cleanLine.match(/^(\d+\.?\d*)$/);
                    if (!numMatch)
                        continue;
                    const val = parseFloat(numMatch[1]);
                    const label = (cardLines[i + 1] || '').toLowerCase();
                    let lineType = null;
                    if (label.includes('fantasy') || label.includes('pts'))
                        lineType = 'fp';
                    else if (label.includes('significant strike') || label.includes('sig. strike'))
                        lineType = 'ss';
                    else if (label.includes('takedown'))
                        lineType = 'td';
                    if (!lineType)
                        continue;
                    if (!fighters[name]) {
                        fighters[name] = { name, line_fp: null, line_ss: null, line_td: null };
                    }
                    fighters[name][`line_${lineType}`] = val;
                }
            });
            const result = Object.values(fighters).filter((f) => f.line_fp || f.line_ss || f.line_td);
            this.log('underdog', `Found ${result.length} fighters`);
            return result;
        }
        catch (error) {
            this.logError('underdog', 'DOM scrape failed', error);
            return [];
        }
    }
    // ── DRAFTKINGS SPORTSBOOK PROPS (SS + TD) WITH ODDS ─────────────────────
    /**
     * Enhanced scraper for DraftKings Sportsbook UFC props
     * Captures both lines AND odds for Significant Strikes and Takedowns
     * Odds format: American (-110, -115, +100, etc.)
     */
    static scrapeDKSportsbookProps() {
        const fighters = {};
        try {
            const pageText = document.body.innerText || '';
            const allEls = Array.from(document.querySelectorAll('span, td, div, p, button, li'));
            this.log('draftkings_sportsbook', `Scraping ${allEls.length} DOM elements. Page text length: ${pageText.length}`);
            // ── STRATEGY 1: DOM-based scraping with odds extraction ────────────
            allEls.forEach((el) => {
                if (el.children.length > 0)
                    return; // leaf nodes only
                const text = (el.innerText || el.textContent || '').trim();
                // Match: "{Fighter} Total Significant Strikes Landed O/U"
                // More flexible: handle variations like newlines, extra spaces
                const ssMatch = text.match(/^(.+?)\s+Total\s+Significant\s+Strikes?\s+Landed\s+O\/U$/i);
                if (ssMatch) {
                    const name = ssMatch[1].trim();
                    if (!name || name.length < 3)
                        return;
                    let container = el;
                    for (let i = 0; i < 15; i++) {
                        if (!container.parentElement)
                            break;
                        container = container.parentElement;
                        const containerText = container.innerText || '';
                        // Look for pattern: "Over {line} {odds}" or "Over {line}\n{odds}"
                        const lineOddsMatch = containerText.match(/Over\s+([\d.]+)\s*(-?\d+)?/i);
                        if (lineOddsMatch) {
                            const line = parseFloat(lineOddsMatch[1]);
                            const odds = lineOddsMatch[2] ? parseInt(lineOddsMatch[2], 10) : null;
                            if (!isNaN(line) && line > 0 && line < 200) {
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
                                fighters[name].line_ss = line;
                                if (odds)
                                    fighters[name].ss_over_odds = odds;
                                // Also try to capture under odds if present in same container
                                const underOddsMatch = containerText.match(/Under\s+[\d.]+\s*(-?\d+)?/i);
                                if (underOddsMatch && underOddsMatch[1]) {
                                    fighters[name].ss_under_odds = parseInt(underOddsMatch[1], 10);
                                }
                            }
                            break;
                        }
                    }
                }
                // Match: "{Fighter} Total Takedowns Landed O/U"
                const tdMatch = text.match(/^(.+?)\s+Total\s+Takedowns?\s+Landed\s+O\/U$/i);
                if (tdMatch) {
                    const name = tdMatch[1].trim();
                    if (!name || name.length < 3)
                        return;
                    let container = el;
                    for (let i = 0; i < 15; i++) {
                        if (!container.parentElement)
                            break;
                        container = container.parentElement;
                        const containerText = container.innerText || '';
                        // Look for pattern: "Over {line} {odds}"
                        const lineOddsMatch = containerText.match(/Over\s+([\d.]+)\s*(-?\d+)?/i);
                        if (lineOddsMatch) {
                            const line = parseFloat(lineOddsMatch[1]);
                            const odds = lineOddsMatch[2] ? parseInt(lineOddsMatch[2], 10) : null;
                            if (!isNaN(line) && line >= 0 && line < 20) {
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
                                fighters[name].line_td = line;
                                if (odds)
                                    fighters[name].td_over_odds = odds;
                                // Capture under odds if present
                                const underOddsMatch = containerText.match(/Under\s+[\d.]+\s*(-?\d+)?/i);
                                if (underOddsMatch && underOddsMatch[1]) {
                                    fighters[name].td_under_odds = parseInt(underOddsMatch[1], 10);
                                }
                            }
                            break;
                        }
                    }
                }
            });
            // ── STRATEGY 2: Fallback text-based parsing ───────────────────────
            if (Object.keys(fighters).length === 0) {
                // Pattern: "{Name} {PropType} O/U\nOver {line} {odds}\nUnder {line} {odds}"
                const ssRegex = /([A-Z][a-zA-Z\s'-]{2,40})\s+Total Significant Strikes Landed O\/U[\s\S]{0,150}?Over\s+([\d.]+)\s*(-?\d+)?[\s\S]{0,80}?Under\s+[\d.]+\s*(-?\d+)?/gi;
                let match;
                while ((match = ssRegex.exec(pageText)) !== null) {
                    const name = match[1].trim();
                    const line = parseFloat(match[2]);
                    const overOdds = match[3] ? parseInt(match[3], 10) : null;
                    const underOdds = match[4] ? parseInt(match[4], 10) : null;
                    if (!isNaN(line) && line > 0 && line < 200) {
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
                        fighters[name].line_ss = line;
                        if (overOdds)
                            fighters[name].ss_over_odds = overOdds;
                        if (underOdds)
                            fighters[name].ss_under_odds = underOdds;
                    }
                }
                const tdRegex = /([A-Z][a-zA-Z\s'-]{2,40})\s+Total Takedowns Landed O\/U[\s\S]{0,150}?Over\s+([\d.]+)\s*(-?\d+)?[\s\S]{0,80}?Under\s+[\d.]+\s*(-?\d+)?/gi;
                while ((match = tdRegex.exec(pageText)) !== null) {
                    const name = match[1].trim();
                    const line = parseFloat(match[2]);
                    const overOdds = match[3] ? parseInt(match[3], 10) : null;
                    const underOdds = match[4] ? parseInt(match[4], 10) : null;
                    if (!isNaN(line) && line >= 0 && line < 20) {
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
                        fighters[name].line_td = line;
                        if (overOdds)
                            fighters[name].td_over_odds = overOdds;
                        if (underOdds)
                            fighters[name].td_under_odds = underOdds;
                    }
                }
            }
            // ── STRATEGY 3: Generic fighter + prop detection ──────────────────
            // Fallback if strategies 1-2 find nothing. Look for any fighter name
            // followed by numeric lines anywhere on page
            if (Object.keys(fighters).length === 0) {
                this.log('draftkings_sportsbook', 'Trying strategy 3: generic pattern matching');
                // Look for patterns like:
                // Fighter Name
                // 92.5
                // -110
                const lines = pageText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
                for (let i = 0; i < lines.length - 2; i++) {
                    const nameCandidate = lines[i];
                    const numberCandidate = lines[i + 1];
                    const oddsCandidate = lines[i + 2];
                    // Check if this looks like: Name, Number, Odds
                    const nameMatch = nameCandidate.match(/^[A-Z][a-zA-Z\s'-]{2,40}$/);
                    const numberMatch = numberCandidate.match(/^([\d.]+)$/);
                    const oddsMatch = oddsCandidate.match(/^(-?\d{2,4})$|^[A-Z]{1,3}$|^Over|^Under/i);
                    if (nameMatch && numberMatch && oddsMatch) {
                        const name = nameMatch[0].trim();
                        const value = parseFloat(numberMatch[1]);
                        if (!isNaN(value) && value > 0.5 && value < 200) {
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
                            // Guess if this is SS or TD based on magnitude
                            if (value > 20) {
                                fighters[name].line_ss = value;
                            }
                            else {
                                fighters[name].line_td = value;
                            }
                            // Try to parse odds if it's a number
                            if (oddsMatch[1]) {
                                const odds = parseInt(oddsMatch[1], 10);
                                if (value > 20) {
                                    fighters[name].ss_over_odds = odds;
                                }
                                else {
                                    fighters[name].td_over_odds = odds;
                                }
                            }
                        }
                    }
                }
                if (Object.keys(fighters).length > 0) {
                    this.log('draftkings_sportsbook', `Strategy 3 found ${Object.keys(fighters).length} fighters`);
                }
            }
            // Filter fighters with at least one line
            const result = Object.values(fighters).filter((f) => f.line_ss !== null || f.line_td !== null);
            this.log('draftkings_sportsbook', `Found ${result.length} fighters with props. Samples: ${result
                .slice(0, 3)
                .map((f) => `${f.name} (SS: ${f.line_ss || '—'} @${f.ss_over_odds || '—'}, TD: ${f.line_td || '—'} @${f.td_over_odds || '—'})`)
                .join('; ')}`);
            return result;
        }
        catch (error) {
            this.logError('draftkings_sportsbook', 'Props scrape failed', error);
            return [];
        }
    }
    // ── LEGACY: DRAFTKINGS SPORTSBOOK TAKEDOWN PROPS (for backward compat) ──
    static scrapeDKSportsbookTDs() {
        return this.scrapeDKSportsbookProps();
    }
    // ── SCROLL TO LOAD LAZY CONTENT ────────────────────────────────────────
    static async scrollToLoadAll() {
        const { scrollTimeoutMs, scrollIntervalMs } = CONFIG.polling.scrape;
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
                }
                else {
                    stableCount = 0;
                    lastHeight = newHeight;
                }
            }, scrollIntervalMs);
            setTimeout(() => {
                clearInterval(interval);
                resolve();
            }, scrollTimeoutMs);
        });
    }
    // ── UNIFIED TRY-SCRAPE WITH RETRIES ────────────────────────────────────
    static async tryScrape(platform, scrapeFn) {
        const { maxAttempts, attemptIntervalMs, timeoutMs } = CONFIG.polling.scrape;
        await this.scrollToLoadAll();
        return new Promise((resolve) => {
            let bestResult = [];
            let stableCount = 0;
            let attempts = 0;
            const flush = () => {
                if (bestResult.length > 0) {
                    this.log(platform, `Flushed ${bestResult.length} fighters`);
                }
            };
            const interval = setInterval(() => {
                try {
                    const fighters = scrapeFn();
                    this.log(platform, `Attempt ${attempts + 1}: ${fighters.length} fighters`);
                    if (fighters.length > bestResult.length) {
                        bestResult = fighters;
                        stableCount = 0;
                        flush();
                    }
                    else if (fighters.length === bestResult.length && bestResult.length > 0) {
                        stableCount++;
                    }
                    attempts++;
                    if ((stableCount >= 3 && bestResult.length > 0) || attempts >= maxAttempts) {
                        clearInterval(interval);
                        clearTimeout(timeout);
                        flush();
                        resolve(bestResult);
                    }
                }
                catch (error) {
                    this.logError(platform, `Scrape attempt ${attempts + 1} failed`, error);
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
}
//# sourceMappingURL=ScraperService.js.map