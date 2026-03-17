import { Fighter, ScraperResult } from '../types/index.js';
import { CONFIG, FANTASY_SCORING } from '../config/index.js';

/**
 * Unified scraper service for all platforms
 * Extracts DOM scraping logic with improved error handling and logging
 */
export class ScraperService {
  private static log(platform: string, msg: string): void {
    if (CONFIG.logging.debug) {
      console.log(`[UFC Ext] ${platform}: ${msg}`);
    }
  }

  private static logError(platform: string, msg: string, error?: unknown): void {
    const err = error instanceof Error ? error.message : String(error);
    console.error(`[UFC Ext] ${platform} ERROR: ${msg}`, err);
  }

  // ── PICK6 (DraftKings Fantasy) ─────────────────────────────────────────

  static scrapePick6(): Fighter[] {
    const fighters: Record<string, Fighter> = {};
    const config = CONFIG.selectors.pick6;

    try {
      // Strategy 1: Use cardButton data-testid selector
      document.querySelectorAll(config.cardButton).forEach((btn) => {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const nameMatch = ariaLabel.match(/Open (.+?)'s stat/i);
        if (!nameMatch) return;

        const name = nameMatch[1].trim();
        const cardText = (btn.closest('div[class]') as HTMLElement)?.innerText || '';
        const oppMatch = cardText.match(/vs\s+([^\n]+)/i);
        const opponent = oppMatch ? oppMatch[1].trim() : null;

        // Fantasy Points
        const fpMatch = cardText.match(/([\d]+\.?\d*)\s*\n?\s*Fantasy Points/i);
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
          }
        }
      });

      // Fallback Strategy 2: Broader selector
      if (Object.keys(fighters).length === 0) {
        document.querySelectorAll(config.playerCard).forEach((card) => {
          const text = (card as HTMLElement).innerText || '';
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

      const result = Object.values(fighters).filter(
        (f) => f.line_fp || f.line_ss || f.line_td
      );
      this.log('pick6', `Found ${result.length} fighters`);
      return result;
    } catch (error) {
      this.logError('pick6', 'DOM scrape failed', error);
      return [];
    }
  }

  // ── UNDERDOG FANTASY ───────────────────────────────────────────────────

  static scrapeUnderdog(): Fighter[] {
    const fighters: Record<string, Fighter> = {};
    const config = CONFIG.selectors.underdog;

    try {
      document.querySelectorAll(config.overUnderCell).forEach((cell) => {
        const isMMA = cell.querySelector(config.mmaIcon);
        if (!isMMA) return;

        const nameEl = cell.querySelector(config.nameSelector) as HTMLElement;
        const name = nameEl?.textContent?.trim() || cell.querySelector('strong, h3, h4')?.textContent?.trim();
        if (!name) return;

        const cardText = (cell as HTMLElement).innerText || '';
        const cardLines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);

        // Find number followed by stat label
        for (let i = 0; i < cardLines.length - 1; i++) {
          const numMatch = cardLines[i].match(/^(\d+\.?\d*)$/);
          if (!numMatch) continue;

          const val = parseFloat(numMatch[1]);
          const label = (cardLines[i + 1] || '').toLowerCase();

          let lineType: 'fp' | 'ss' | 'td' | null = null;
          if (label.includes('fantasy') || label.includes('pts')) lineType = 'fp';
          else if (label.includes('significant strike') || label.includes('sig. strike'))
            lineType = 'ss';
          else if (label.includes('takedown')) lineType = 'td';

          if (!lineType) continue;

          if (!fighters[name]) {
            fighters[name] = { name, line_fp: null, line_ss: null, line_td: null };
          }
          fighters[name][`line_${lineType}`] = val;
        }
      });

      const result = Object.values(fighters).filter(
        (f) => f.line_fp || f.line_ss || f.line_td
      );
      this.log('underdog', `Found ${result.length} fighters`);
      return result;
    } catch (error) {
      this.logError('underdog', 'DOM scrape failed', error);
      return [];
    }
  }

  // ── DRAFTKINGS SPORTSBOOK TAKEDOWN PROPS ───────────────────────────────

  static scrapeDKSportsbookTDs(): Fighter[] {
    const fighters: Record<string, Fighter> = {};

    try {
      const allEls = Array.from(document.querySelectorAll('*'));
      allEls.forEach((el) => {
        // Only leaf nodes
        if (el.children.length > 0) return;

        const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
        const m = text.match(/^(.+?)\s+Total Takedowns Landed O\/U$/i);
        if (!m) return;

        const name = m[1].trim();
        if (!name || name.length < 3) return;

        // Walk up to find container, then look for "Over X.X"
        let container = el as HTMLElement;
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

      const result = Object.values(fighters).filter((f) => f.line_td !== null);
      this.log('draftkings_sportsbook', `Found ${result.length} fighter TDs`);
      return result;
    } catch (error) {
      this.logError('draftkings_sportsbook', 'DOM scrape failed', error);
      return [];
    }
  }

  // ── SCROLL TO LOAD LAZY CONTENT ────────────────────────────────────────

  static async scrollToLoadAll(): Promise<void> {
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
        } else {
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

  static async tryScrape(
    platform: 'pick6' | 'underdog' | 'draftkings_sportsbook',
    scrapeFn: () => Fighter[]
  ): Promise<Fighter[]> {
    const { maxAttempts, attemptIntervalMs, timeoutMs } = CONFIG.polling.scrape;

    await this.scrollToLoadAll();

    return new Promise((resolve) => {
      let bestResult: Fighter[] = [];
      let stableCount = 0;
      let attempts = 0;

      const flush = (): void => {
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
