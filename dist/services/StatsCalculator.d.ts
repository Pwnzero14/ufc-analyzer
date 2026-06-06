import { FighterDB, CareerStats } from '../types/index.js';
/**
 * Fantasy points calculation and fighter statistics service
 * Encapsulates all FP math and career stats building
 */
export declare class StatsCalculator {
    private static log;
    static calcWinBonus(won: boolean, method?: string, round?: number): number;
    static calcFP(sigStr?: number | null, totStr?: number | null, ctrlSecs?: number | null, kd?: number | null, td?: number | null, rev?: number | null, won?: boolean, method?: string, round?: number): number;
    private static deriveStyle;
    private static isFinish;
    static buildFighterDB(name: string, ufcData?: any): FighterDB;
    static parseCareerStats(html: string): CareerStats;
}
//# sourceMappingURL=StatsCalculator.d.ts.map