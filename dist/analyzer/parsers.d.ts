import type { CareerStats } from '../types/index.js';
export interface OppStats {
    oppName?: string | null;
    kd?: number | null;
    sigStr?: number | null;
    sigStrR1?: number | null;
    totStr?: number | null;
    td?: number | null;
    sub?: number | null;
    ctrlSecs?: number | null;
}
export interface UFCFightHistory {
    result: string;
    opponent: string;
    event: string;
    method: string;
    round: number | null;
    date: string | null;
    kd?: number | null;
    sigStr?: number | null;
    sigStrR1?: number | null;
    sigStrBody?: number | null;
    sigStrLeg?: number | null;
    totStr?: number | null;
    td?: number | null;
    sub?: number | null;
    rev?: number | null;
    ctrlSecs?: number | null;
    timeSecs?: number | null;
    oppStats?: OppStats | null;
    fightUrl?: string;
}
export declare function parseCareerStats(html: string): CareerStats;
export declare function parseFightHistoryLinks(html: string): UFCFightHistory[];
export declare function parseFightDetailStats(html: string, fighterName: string, fighterDetailUrl: string | null): {
    kd?: number | null;
    sigStr?: number | null;
    sigStrR1?: number | null;
    sigStrBody?: number | null;
    sigStrLeg?: number | null;
    totStr?: number | null;
    td?: number | null;
    sub?: number | null;
    rev?: number | null;
    ctrlSecs?: number | null;
    timeSecs?: number | null;
    method?: string | null;
    round?: number | null;
};
export declare function parseFightDetailStatsOpponent(html: string, fighterName: string, fighterDetailUrl: string | null): OppStats | null;
//# sourceMappingURL=parsers.d.ts.map