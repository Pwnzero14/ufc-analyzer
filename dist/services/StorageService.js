import { CONFIG } from '../config/index.js';
/**
 * Centralized storage service for chrome.storage.local
 * Provides validation, error handling, and consistent data access patterns
 */
export class StorageService {
    static logError(msg, error) {
        const err = error instanceof Error ? error.message : String(error);
        console.error(`${CONFIG.logging.prefix} StorageService: ${msg}`, err);
    }
    static log(msg) {
        if (CONFIG.logging.debug) {
            console.log(`${CONFIG.logging.prefix} StorageService:`, msg);
        }
    }
    // ── LINES (Pick6, Underdog, Betr, PrizePicks, DraftKings Sportsbook) ──
    static async getLines(platform) {
        try {
            const keys = platform
                ? [`lines_${platform}`]
                : ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
            const result = await this.chromeGet(keys);
            const lines = {};
            if (result.lines_pick6)
                lines.pick6 = result.lines_pick6;
            if (result.lines_underdog)
                lines.underdog = result.lines_underdog;
            if (result.lines_betr)
                lines.betr = result.lines_betr;
            if (result.lines_prizepicks)
                lines.prizepicks = result.lines_prizepicks;
            if (result.lines_draftkings_sportsbook)
                lines.draftkings_sportsbook = result.lines_draftkings_sportsbook;
            return lines;
        }
        catch (error) {
            this.logError('Failed to get lines', error);
            return {};
        }
    }
    static async setLines(platform, fighters) {
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
        }
        catch (error) {
            this.logError(`Failed to set lines for ${platform}`, error);
            throw error;
        }
    }
    static async clearLines() {
        try {
            await this.chromeClear(['lines_pick6', 'lines_underdog', 'lines_prizepicks', 'lines_draftkings_sportsbook']);
            this.log('Cleared all lines');
        }
        catch (error) {
            this.logError('Failed to clear lines', error);
            throw error;
        }
    }
    // ── FIGHT MONEYLINE ODDS ──────────────────────────────────────────────
    static async getFightOddsMoneyline() {
        try {
            const result = await this.chromeGet([this.FIGHT_ODDS_KEY]);
            const raw = result[this.FIGHT_ODDS_KEY];
            if (!raw || typeof raw !== 'object')
                return {};
            const normalized = {};
            for (const [name, val] of Object.entries(raw)) {
                const n = typeof val === 'number' ? val : Number(val);
                if (!Number.isFinite(n))
                    continue;
                normalized[name] = n;
            }
            return normalized;
        }
        catch (error) {
            this.logError('Failed to get fight moneyline odds', error);
            return {};
        }
    }
    static async setFightOddsMoneyline(oddsByName) {
        try {
            const normalized = {};
            for (const [name, val] of Object.entries(oddsByName || {})) {
                const n = typeof val === 'number' ? val : Number(val);
                if (!Number.isFinite(n))
                    continue;
                normalized[name] = n;
            }
            await this.chromeSet({ [this.FIGHT_ODDS_KEY]: normalized });
            this.log(`Stored ${Object.keys(normalized).length} fight moneyline odds`);
        }
        catch (error) {
            this.logError('Failed to set fight moneyline odds', error);
            throw error;
        }
    }
    // ── LINE DROP STATE ────────────────────────────────────────────────────
    static async getLineDropState() {
        try {
            const result = await this.chromeGet(['line_drop_state']);
            return result.line_drop_state || null;
        }
        catch (error) {
            this.logError('Failed to get line drop state', error);
            return null;
        }
    }
    static async setLineDropState(state) {
        try {
            await this.chromeSet({ line_drop_state: { ...state } });
            this.log('Updated line drop state');
        }
        catch (error) {
            this.logError('Failed to set line drop state', error);
            throw error;
        }
    }
    static async clearLineDropState() {
        try {
            await this.chromeClear(['line_drop_state']);
            this.log('Cleared line drop state');
        }
        catch (error) {
            this.logError('Failed to clear line drop state', error);
            throw error;
        }
    }
    // ── UPCOMING CARD ──────────────────────────────────────────────────────
    static async getUpcomingCard() {
        try {
            const result = await this.chromeGet(['upcoming_ufc_card']);
            const card = result.upcoming_ufc_card;
            // Check cache expiration
            if (card && Date.now() - card.fetchedAt < CONFIG.polling.storage.cacheExpireMs) {
                return card;
            }
            return null;
        }
        catch (error) {
            this.logError('Failed to get upcoming card', error);
            return null;
        }
    }
    static async setUpcomingCard(card) {
        try {
            await this.chromeSet({ upcoming_ufc_card: card });
            this.log(`Cached upcoming card: ${card.event}`);
        }
        catch (error) {
            this.logError('Failed to set upcoming card', error);
            throw error;
        }
    }
    static async setLastCompletedCard(card) {
        try {
            await this.chromeSet({ last_completed_ufc_card: card });
            this.log(`Cached last completed card: ${card.event}`);
        }
        catch (error) {
            this.logError('Failed to set last completed card', error);
        }
    }
    // ── FIGHTER STATS CACHE ────────────────────────────────────────────────
    static async getFighterStats(name) {
        try {
            const key = `fighter_stats_${name.replace(/\s+/g, '_')}`;
            const result = await this.chromeGet([key]);
            return result[key] || null;
        }
        catch (error) {
            this.logError(`Failed to get fighter stats for ${name}`, error);
            return null;
        }
    }
    static async setFighterStats(name, stats) {
        try {
            const key = `fighter_stats_${name.replace(/\s+/g, '_')}`;
            await this.chromeSet({ [key]: { ...stats, cachedAt: Date.now() } });
        }
        catch (error) {
            this.logError(`Failed to set fighter stats for ${name}`, error);
        }
    }
    // ── ERROR LOG ──────────────────────────────────────────────────────────
    static async addError(error) {
        try {
            const result = await this.chromeGet(['error_log']);
            const log = result.error_log || [];
            log.push(error);
            // Keep only last 100 errors
            const trimmed = log.slice(-100);
            await this.chromeSet({ error_log: trimmed });
        }
        catch (error) {
            this.logError('Failed to log error', error);
        }
    }
    static async getErrorLog() {
        try {
            const result = await this.chromeGet(['error_log']);
            return result.error_log || [];
        }
        catch (error) {
            this.logError('Failed to get error log', error);
            return [];
        }
    }
    static async clearErrorLog() {
        try {
            await this.chromeClear(['error_log']);
        }
        catch (error) {
            this.logError('Failed to clear error log', error);
        }
    }
    // ── CHROME STORAGE PRIMITIVES (with promise wrappers) ────────────────
    static chromeGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => {
                resolve(result || {});
            });
        });
    }
    static chromeSetRaw(obj) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(obj, () => {
                const err = chrome.runtime.lastError;
                if (err)
                    reject(new Error(err.message));
                else
                    resolve();
            });
        });
    }
    // Write wrapper with automatic quota recovery. chrome.storage.local has a ~10 MB
    // cap; when old archive backups fill it, every line write fails with
    // "Resource::kQuotaBytes quota exceeded" and platforms silently stop persisting
    // (UD/DK go blank). On a quota error we prune stale *backup* keys — keeping the
    // newest per family and never touching the live archive (prop_archive_v1),
    // platform lines (lines_*), or any non-backup key — then retry the write once.
    static chromeSet(obj) {
        return this.chromeSetRaw(obj).catch(async (err) => {
            if (!this.isQuotaError(err))
                throw err;
            const pruned = await this.pruneBackupsForQuota();
            if (pruned <= 0)
                throw err;
            console.warn(`${CONFIG.logging.prefix} StorageService: quota hit — pruned ${pruned} old backup key(s), retrying write`);
            return this.chromeSetRaw(obj);
        });
    }
    static isQuotaError(error) {
        const msg = error instanceof Error ? error.message : String(error);
        return /quota/i.test(msg);
    }
    // Thin redundant backup keys to reclaim space. A "backup" key contains "backup"
    // (case-insensitive). Keys are grouped into families by stripping a trailing
    // _<epoch>; the newest per family is kept and the rest deleted. Never deletes the
    // live archive (prop_archive_v1), platform lines (lines_*), or any non-backup key.
    static async pruneBackupsForQuota() {
        const all = await new Promise((resolve) => {
            chrome.storage.local.get(null, (r) => resolve(r || {}));
        });
        const backupKeys = Object.keys(all).filter((k) => /backup/i.test(k) && k !== 'prop_archive_v1');
        if (!backupKeys.length)
            return 0;
        const trailingNum = (k) => Number((k.match(/_(\d+)$/) || [])[1] || 0);
        const familyOf = (k) => k.replace(/_\d+$/, '');
        const families = new Map();
        for (const k of backupKeys) {
            const arr = families.get(familyOf(k)) || [];
            arr.push(k);
            families.set(familyOf(k), arr);
        }
        const toDelete = [];
        for (const keys of families.values()) {
            if (keys.length <= 1)
                continue; // keep a family's only (newest) backup
            const sorted = keys.slice().sort((a, b) => trailingNum(a) - trailingNum(b));
            toDelete.push(...sorted.slice(0, -1)); // delete all but the newest
        }
        if (!toDelete.length)
            return 0;
        await this.chromeClear(toDelete);
        this.log(`Quota recovery: pruned ${toDelete.length} backup key(s): ${toDelete.join(', ')}`);
        return toDelete.length;
    }
    static chromeClear(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(keys, () => {
                const err = chrome.runtime.lastError;
                if (err)
                    reject(new Error(err.message));
                else
                    resolve();
            });
        });
    }
}
StorageService.FIGHT_ODDS_KEY = 'fight_odds_moneyline';
//# sourceMappingURL=StorageService.js.map