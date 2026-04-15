import { AllLines, LineDropState, UpcomingCard, AppError } from '../types/index.js';
import { CONFIG } from '../config/index.js';

/**
 * Centralized storage service for chrome.storage.local
 * Provides validation, error handling, and consistent data access patterns
 */
export class StorageService {
  private static readonly FIGHT_ODDS_KEY = 'fight_odds_moneyline';

  private static logError(msg: string, error: unknown): void {
    const err = error instanceof Error ? error.message : String(error);
    console.error(`${CONFIG.logging.prefix} StorageService: ${msg}`, err);
  }

  private static log(msg: string): void {
    if (CONFIG.logging.debug) {
      console.log(`${CONFIG.logging.prefix} StorageService:`, msg);
    }
  }

  // ── LINES (Pick6, Underdog, Betr, PrizePicks, DraftKings Sportsbook) ──

  static async getLines(platform?: 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook'): Promise<AllLines> {
    try {
      const keys = platform
        ? [`lines_${platform}`]
        : ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
      const result = await this.chromeGet(keys);

      const lines: AllLines = {};
      if (result.lines_pick6) lines.pick6 = result.lines_pick6;
      if (result.lines_underdog) lines.underdog = result.lines_underdog;
      if (result.lines_betr) lines.betr = result.lines_betr;
      if (result.lines_prizepicks) lines.prizepicks = result.lines_prizepicks;
      if (result.lines_draftkings_sportsbook) lines.draftkings_sportsbook = result.lines_draftkings_sportsbook;

      return lines;
    } catch (error) {
      this.logError('Failed to get lines', error);
      return {};
    }
  }

  static async setLines(
    platform: 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook',
    fighters: any[]
  ): Promise<void> {
    try {
      if (!Array.isArray(fighters)) {
        throw new Error('Fighters must be an array');
      }
      const data = {
        fighters,
        capturedAt: Date.now(),
      };
      await this.chromeSet({ [`lines_${platform}`]: data });
      this.log(`Stored ${fighters.length} ${platform} fighters`);
    } catch (error) {
      this.logError(`Failed to set lines for ${platform}`, error);
      throw error;
    }
  }

  static async clearLines(): Promise<void> {
    try {
      await this.chromeClear(['lines_pick6', 'lines_underdog', 'lines_prizepicks', 'lines_draftkings_sportsbook']);
      this.log('Cleared all lines');
    } catch (error) {
      this.logError('Failed to clear lines', error);
      throw error;
    }
  }

  // ── FIGHT MONEYLINE ODDS ──────────────────────────────────────────────

  static async getFightOddsMoneyline(): Promise<Record<string, number>> {
    try {
      const result = await this.chromeGet([this.FIGHT_ODDS_KEY]);
      const raw = result[this.FIGHT_ODDS_KEY];
      if (!raw || typeof raw !== 'object') return {};

      const normalized: Record<string, number> = {};
      for (const [name, val] of Object.entries(raw)) {
        const n = typeof val === 'number' ? val : Number(val);
        if (!Number.isFinite(n)) continue;
        normalized[name] = n;
      }
      return normalized;
    } catch (error) {
      this.logError('Failed to get fight moneyline odds', error);
      return {};
    }
  }

  static async setFightOddsMoneyline(oddsByName: Record<string, number>): Promise<void> {
    try {
      const normalized: Record<string, number> = {};
      for (const [name, val] of Object.entries(oddsByName || {})) {
        const n = typeof val === 'number' ? val : Number(val);
        if (!Number.isFinite(n)) continue;
        normalized[name] = n;
      }
      await this.chromeSet({ [this.FIGHT_ODDS_KEY]: normalized });
      this.log(`Stored ${Object.keys(normalized).length} fight moneyline odds`);
    } catch (error) {
      this.logError('Failed to set fight moneyline odds', error);
      throw error;
    }
  }

  // ── LINE DROP STATE ────────────────────────────────────────────────────

  static async getLineDropState(): Promise<LineDropState | null> {
    try {
      const result = await this.chromeGet(['line_drop_state']);
      return result.line_drop_state || null;
    } catch (error) {
      this.logError('Failed to get line drop state', error);
      return null;
    }
  }

  static async setLineDropState(state: LineDropState): Promise<void> {
    try {
      await this.chromeSet({ line_drop_state: { ...state } });
      this.log('Updated line drop state');
    } catch (error) {
      this.logError('Failed to set line drop state', error);
      throw error;
    }
  }

  static async clearLineDropState(): Promise<void> {
    try {
      await this.chromeClear(['line_drop_state']);
      this.log('Cleared line drop state');
    } catch (error) {
      this.logError('Failed to clear line drop state', error);
      throw error;
    }
  }

  // ── UPCOMING CARD ──────────────────────────────────────────────────────

  static async getUpcomingCard(): Promise<UpcomingCard | null> {
    try {
      const result = await this.chromeGet(['upcoming_ufc_card']);
      const card = result.upcoming_ufc_card;

      // Check cache expiration
      if (card && Date.now() - card.fetchedAt < CONFIG.polling.storage.cacheExpireMs) {
        return card;
      }
      return null;
    } catch (error) {
      this.logError('Failed to get upcoming card', error);
      return null;
    }
  }

  static async setUpcomingCard(card: UpcomingCard): Promise<void> {
    try {
      await this.chromeSet({ upcoming_ufc_card: card });
      this.log(`Cached upcoming card: ${card.event}`);
    } catch (error) {
      this.logError('Failed to set upcoming card', error);
      throw error;
    }
  }

  static async setLastCompletedCard(card: UpcomingCard): Promise<void> {
    try {
      await this.chromeSet({ last_completed_ufc_card: card });
      this.log(`Cached last completed card: ${card.event}`);
    } catch (error) {
      this.logError('Failed to set last completed card', error);
    }
  }

  // ── FIGHTER STATS CACHE ────────────────────────────────────────────────

  static async getFighterStats(name: string): Promise<any | null> {
    try {
      const key = `fighter_stats_${name.replace(/\s+/g, '_')}`;
      const result = await this.chromeGet([key]);
      return result[key] || null;
    } catch (error) {
      this.logError(`Failed to get fighter stats for ${name}`, error);
      return null;
    }
  }

  static async setFighterStats(name: string, stats: any): Promise<void> {
    try {
      const key = `fighter_stats_${name.replace(/\s+/g, '_')}`;
      await this.chromeSet({ [key]: { ...stats, cachedAt: Date.now() } });
    } catch (error) {
      this.logError(`Failed to set fighter stats for ${name}`, error);
    }
  }

  // ── ERROR LOG ──────────────────────────────────────────────────────────

  static async addError(error: AppError): Promise<void> {
    try {
      const result = await this.chromeGet(['error_log']);
      const log = result.error_log || [];
      log.push(error);
      // Keep only last 100 errors
      const trimmed = log.slice(-100);
      await this.chromeSet({ error_log: trimmed });
    } catch (error) {
      this.logError('Failed to log error', error);
    }
  }

  static async getErrorLog(): Promise<AppError[]> {
    try {
      const result = await this.chromeGet(['error_log']);
      return result.error_log || [];
    } catch (error) {
      this.logError('Failed to get error log', error);
      return [];
    }
  }

  static async clearErrorLog(): Promise<void> {
    try {
      await this.chromeClear(['error_log']);
    } catch (error) {
      this.logError('Failed to clear error log', error);
    }
  }

  // ── CHROME STORAGE PRIMITIVES (with promise wrappers) ────────────────

  private static chromeGet(keys: string[]): Promise<Record<string, any>> {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result || {});
      });
    });
  }

  private static chromeSet(obj: Record<string, any>): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  private static chromeClear(keys: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }
}
