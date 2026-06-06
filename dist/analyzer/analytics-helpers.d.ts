import type { FightResult } from '../types/index.js';
export declare function detectStreak(history: FightResult[]): {
    type: 'hot' | 'cold' | 'neutral';
    count: number;
    text: string;
};
export declare function calcWeightedAvgFP(history: FightResult[]): number | null;
export declare function calcFPStats(history: FightResult[]): {
    floor: number | null;
    ceiling: number | null;
    stdDev: number | null;
    consistency: number | null;
    median: number | null;
};
export declare function calcPerRoundFP(history: FightResult[]): number | null;
//# sourceMappingURL=analytics-helpers.d.ts.map