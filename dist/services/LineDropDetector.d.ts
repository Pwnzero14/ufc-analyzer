import { LineDropState, LineDrop } from '../types/index.js';
/**
 * Line drop detection and monitoring service
 * Handles predictable UFC line drop schedules and triggers automatic scraping
 */
export declare class LineDropDetector {
    private static log;
    private static logError;
    static getPlatformSchedule(eventSaturdayMs: number): Array<{
        platform: string;
        type: string;
        label: string;
    }>;
    static getPollIntervalMinutes(daysUntil: number): number | null;
    static quickCheckUnderdogLines(): Promise<number>;
    static detectDrops(schedule: Array<{
        platform: string;
        type: string;
        label: string;
    }>, udCount: number, prevUDCount: number, p6Count: number, prevP6Count: number, detectedUD: number | null, detectedP6: number | null): LineDrop[];
    static shouldUpdatePollRate(state: LineDropState, daysUntil: number): {
        shouldUpdate: boolean;
        newMinutes: number | null;
    };
    static isOutsideWindow(daysUntil: number): boolean;
    static formatSchedule(schedule: Array<{
        platform: string;
        type: string;
        label: string;
    }>): string;
    static logPollStatus(daysUntil: number, schedule: Array<{
        platform: string;
        type: string;
        label: string;
    }>, udCount: number, prevUDCount: number, p6Count: number, prevP6Count: number): void;
    static logLineDrops(drops: LineDrop[]): void;
    static logWatcherStart(eventName: string, eventDateStr: string, daysUntil: number, pollMins: number): void;
    static logWatcherStop(): void;
}
//# sourceMappingURL=LineDropDetector.d.ts.map