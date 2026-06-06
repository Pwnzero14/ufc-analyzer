import { AllLines, LineDropState, UpcomingCard, AppError } from '../types/index.js';
/**
 * Centralized storage service for chrome.storage.local
 * Provides validation, error handling, and consistent data access patterns
 */
export declare class StorageService {
    private static readonly FIGHT_ODDS_KEY;
    private static logError;
    private static log;
    static getLines(platform?: 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook'): Promise<AllLines>;
    static setLines(platform: 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'draftkings_sportsbook', fighters: any[]): Promise<void>;
    static clearLines(): Promise<void>;
    static getFightOddsMoneyline(): Promise<Record<string, number>>;
    static setFightOddsMoneyline(oddsByName: Record<string, number>): Promise<void>;
    static getLineDropState(): Promise<LineDropState | null>;
    static setLineDropState(state: LineDropState): Promise<void>;
    static clearLineDropState(): Promise<void>;
    static getUpcomingCard(): Promise<UpcomingCard | null>;
    static setUpcomingCard(card: UpcomingCard): Promise<void>;
    static setLastCompletedCard(card: UpcomingCard): Promise<void>;
    static getFighterStats(name: string): Promise<any | null>;
    static setFighterStats(name: string, stats: any): Promise<void>;
    static addError(error: AppError): Promise<void>;
    static getErrorLog(): Promise<AppError[]>;
    static clearErrorLog(): Promise<void>;
    private static chromeGet;
    private static chromeSet;
    private static chromeClear;
}
//# sourceMappingURL=StorageService.d.ts.map