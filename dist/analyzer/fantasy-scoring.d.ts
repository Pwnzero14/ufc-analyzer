import type { CareerStats } from '../types/index.js';
export type HistoricalScoringPlatform = 'pick6' | 'underdog' | 'prizepicks' | 'betr';
export declare function scoringFor(platform: HistoricalScoringPlatform): {
    readonly sigStrike: 0.4;
    readonly nonSigStrike: 0.2;
    readonly controlTimePerSec: 0.03;
    readonly takedown: 5;
    readonly reversal: 5;
    readonly knockdown: 10;
    readonly quickWinBonus: 25;
    readonly winBonus: {
        readonly round1: 90;
        readonly round2: 70;
        readonly round3: 45;
        readonly round4Plus: 40;
        readonly decision: 30;
    };
} | {
    readonly sigStrike: 0.5;
    readonly nonSigStrike: 0;
    readonly controlTimePerSec: 0;
    readonly takedown: 5;
    readonly reversal: 0;
    readonly knockdown: 10;
    readonly submissionAttempt: 4;
    readonly winBonus: {
        readonly round1: 50;
        readonly round2: 40;
        readonly round3: 30;
        readonly round4Plus: 20;
        readonly decision: 10;
    };
};
export declare function winBonusForPlatform(platform: HistoricalScoringPlatform, won: boolean, method: string | null | undefined, round: number | null | undefined): number;
export declare function calcFPForPlatform(platform: HistoricalScoringPlatform, sigStr: number | null | undefined, totStr: number | null | undefined, ctrlSecs: number | null | undefined, timeSecs: number | null | undefined, kd: number | null | undefined, td: number | null | undefined, rev: number | null | undefined, sub: number | null | undefined, won: boolean, method: string | null | undefined, round: number | null | undefined): number;
export declare function calcFP(sigStr: number | null | undefined, totStr: number | null | undefined, ctrlSecs: number | null | undefined, kd: number | null | undefined, td: number | null | undefined, rev: number | null | undefined, won: boolean, method: string | null | undefined, round: number | null | undefined): number;
export declare function getFightFantasyValueForPlatform(h: {
    result?: string | null;
    fp?: number | null;
    fp_p6?: number | null;
    fp_ud?: number | null;
    sigStr?: number | null;
    totStr?: number | null;
    ctrlSecs?: number | null;
    timeSecs?: number | null;
    kd?: number | null;
    td?: number | null;
    rev?: number | null;
    sub?: number | null;
    method?: string | null;
    round?: number | null;
}, platform: 'pick6' | 'underdog' | 'prizepicks' | 'betr'): number | null;
export declare function isFinish(method: string | null | undefined): boolean;
export declare function deriveStyle(careerStats: CareerStats | null | undefined): 'striker' | 'grappler' | 'balanced';
//# sourceMappingURL=fantasy-scoring.d.ts.map