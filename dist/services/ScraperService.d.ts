import { Fighter } from '../types/index.js';
/**
 * Unified scraper service for all platforms
 * Extracts DOM scraping logic with improved error handling and logging
 */
export declare class ScraperService {
    private static log;
    private static logError;
    static scrapePick6(): Fighter[];
    static scrapeUnderdog(): Fighter[];
    /**
     * Enhanced scraper for DraftKings Sportsbook UFC props
     * Captures both lines AND odds for Significant Strikes and Takedowns
     * Odds format: American (-110, -115, +100, etc.)
     */
    static scrapeDKSportsbookProps(): Fighter[];
    static scrapeDKSportsbookTDs(): Fighter[];
    static scrollToLoadAll(): Promise<void>;
    static tryScrape(platform: 'pick6' | 'underdog' | 'draftkings_sportsbook', scrapeFn: () => Fighter[]): Promise<Fighter[]>;
}
//# sourceMappingURL=ScraperService.d.ts.map