import type { PropArchiveRecord, PropType } from '../types/index.js';
export declare class PropArchiveService {
    private static readonly RESULT_MATCH_WINDOW_MS;
    private static chromeGet;
    private static chromeSet;
    private static getAllRecords;
    private static setAllRecords;
    static addProp(record: PropArchiveRecord): Promise<void>;
    static addProps(records: PropArchiveRecord[]): Promise<void>;
    static updateResult(fighter: string, event: string, propType: PropType, result: number, options?: {
        date?: string;
        opponent?: string | null;
    }): Promise<boolean>;
    static getFighterHistory(fighter: string): Promise<PropArchiveRecord[]>;
    static getPlatformHistory(fighter: string, platform: string, propType?: PropType): Promise<PropArchiveRecord[]>;
    static fighterHasFantasyLineHistory(fighter: string): Promise<boolean>;
    static fighterHasPerformanceHistory(fighter: string): Promise<boolean>;
    static backfillUnresolvedFromKnownOutcomes(options?: {
        eventIncludes?: string;
        maxScore?: number;
        minHoursBetweenRuns?: number;
    }): Promise<{
        changed: number;
        unresolvedBefore: number;
        unresolvedAfter: number;
    }>;
}
//# sourceMappingURL=PropArchiveService.d.ts.map