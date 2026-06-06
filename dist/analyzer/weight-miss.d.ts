export type WeightMissSeverity = 'small' | 'moderate' | 'big' | 'extreme' | 'unknown';
export interface WeightMissSignal {
    lbsOver: number | null;
    severity: WeightMissSeverity;
    source: string;
}
export declare const _weightMissSignals: Map<string, WeightMissSignal>;
export declare function severityFromLbs(lbs: number | null): WeightMissSeverity;
export declare const MANUAL_WEIGHT_MISS_KEY = "weight_miss_manual_v1";
export interface ManualWeightMissEntry {
    lbsOver: number;
    addedAt: number;
}
export type ManualWeightMissMap = Record<string, ManualWeightMissEntry>;
export declare function parseWeightMissFromTitle(title: string, _fighterName: string): WeightMissSignal | null;
//# sourceMappingURL=weight-miss.d.ts.map