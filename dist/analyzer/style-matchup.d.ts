import type { FighterDB } from '../types/index.js';
export interface LeanReason {
    icon: 'pos' | 'neg' | 'neu';
    text: string;
}
export declare function styleMatchupEdge(styleA: string, styleB: string, dbA: FighterDB, dbB: FighterDB): {
    delta: number;
    edges: LeanReason[];
};
export declare function calcOpponentDefenseScore(oppDB: FighterDB, _line: number): {
    delta: number;
    edges: LeanReason[];
};
export declare function calcMatchupPatternEdge(db: FighterDB, oppDB: FighterDB, ssLine: number | null, tdLine: number | null, fpLine: number | null, statsCache: Record<string, FighterDB>): {
    score: number;
    ssScore: number;
    tdScore: number;
    reasons: LeanReason[];
};
//# sourceMappingURL=style-matchup.d.ts.map