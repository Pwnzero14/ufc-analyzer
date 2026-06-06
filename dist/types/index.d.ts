export interface Fighter {
    name: string;
    line_fp?: number | null;
    line_ss?: number | null;
    line_ss_r1?: number | null;
    line_td?: number | null;
    line_ft?: number | null;
    line_ctrl?: number | null;
    opponent?: string | null;
    capturedAt?: number;
    ss_over_odds?: number | null;
    ss_under_odds?: number | null;
    td_over_odds?: number | null;
    td_under_odds?: number | null;
    ft_over_odds?: number | null;
    ft_under_odds?: number | null;
    ctrl_over_odds?: number | null;
    ctrl_under_odds?: number | null;
    ctrl_under_available?: boolean | null;
    ud_ss_over_avail?: boolean | null;
    ud_ss_under_avail?: boolean | null;
    ud_td_over_avail?: boolean | null;
    ud_td_under_avail?: boolean | null;
    ud_ft_over_avail?: boolean | null;
    ud_ft_under_avail?: boolean | null;
}
export interface PlatformLines {
    fighters: Fighter[];
    capturedAt?: number;
}
export interface AllLines {
    pick6?: PlatformLines;
    underdog?: PlatformLines;
    betr?: PlatformLines;
    prizepicks?: PlatformLines;
    draftkings_sportsbook?: PlatformLines;
}
export interface FightResult {
    opp: string;
    fp?: number | null;
    fp_p6?: number | null;
    fp_ud?: number | null;
    sigStr?: number | null;
    sigStrR1?: number | null;
    totStr?: number | null;
    ctrlSecs?: number | null;
    timeSecs?: number | null;
    td?: number | null;
    kd?: number | null;
    rev?: number | null;
    sub?: number | null;
    method?: string;
    result?: string;
    date?: string;
    round?: number;
    oppStats?: FightStats | null;
}
export interface FightStats {
    sigStr?: number | null;
    sigStrR1?: number | null;
    totStr?: number | null;
    ctrlSecs?: number | null;
    kd?: number | null;
    td?: number | null;
    rev?: number | null;
    sub?: number | null;
}
export interface CareerStats {
    slpm?: number | null;
    sapm?: number | null;
    strAcc?: number | null;
    strDef?: number | null;
    tdAvg?: number | null;
    tdAcc?: number | null;
    tdDef?: number | null;
    subAvg?: number | null;
    record?: string;
    height?: string;
    stance?: string;
}
export interface Streak {
    type: 'hot' | 'cold' | 'neutral';
    count: number;
    text: string;
}
export interface OppFightResult {
    opp: string | null;
    fp: number | null;
    sigStr: number | null;
    sigStrR1?: number | null;
    totStr: number | null;
    td: number | null;
    kd: number | null;
    sub?: number | null;
    ctrlSecs: number | null;
}
export interface FighterDB {
    record: string;
    country: string;
    avgFP?: number | null;
    avgFP_p6?: number | null;
    avgFP_ud?: number | null;
    avgFP_pp?: number | null;
    avgFP_betr?: number | null;
    avgSigStr?: number | null;
    avgTD?: number | null;
    avgTDperFight?: number | null;
    slpm?: number | null;
    sapm?: number | null;
    strAcc?: number | null;
    strDef?: number | null;
    tdDef?: number | null;
    tdAcc?: number | null;
    stance?: string | null;
    style: 'striker' | 'grappler' | 'balanced';
    finishRate?: number | null;
    avgFP_weighted?: number | null;
    fpFloor?: number | null;
    fpCeiling?: number | null;
    fpStdDev?: number | null;
    fpConsistency?: number | null;
    fpMedian?: number | null;
    ssStdDev?: number | null;
    avgTimeMins?: number | null;
    avgCtrlSecs?: number | null;
    avgFP_perRound?: number | null;
    streak?: Streak;
    fiveRoundRate?: number;
    history: FightResult[];
    oppHistory: OppFightResult[];
    loaded: boolean;
    detailUrl?: string | null;
}
export interface LineDropState {
    watching: boolean;
    lastP6Count: number;
    lastUDCount: number;
    lastUDFPCount?: number;
    detectedAt?: number | null;
    eventDate?: string | null;
    eventName?: string | null;
    detectedUD?: number | null;
    detectedUDFP?: number | null;
    detectedP6?: number | null;
    lastPollAt?: number | null;
    daysUntil?: number;
    _currentPollMins?: number;
}
export interface LineDrop {
    platform: string;
    type: string;
    count: number;
}
export type LineDirection = 'drop' | 'rise' | 'both';
export type WatchedStatType = 'fp' | 'ss' | 'td';
export type WatchPlatform = 'pick6' | 'underdog' | 'betr' | 'prizepicks' | 'dk';
export interface LineWatchSettings {
    enabled: boolean;
    direction: LineDirection;
    threshold: number;
    watchPlatforms: WatchPlatform[];
    watchStats: WatchedStatType[];
    fighterAllowList: string[];
    detectStealth: boolean;
    detectSteam: boolean;
    playSound: boolean;
}
export interface LineMovementEvent {
    id: string;
    timestamp: number;
    fighter: string;
    platform: WatchPlatform;
    stat: WatchedStatType;
    from: number;
    to: number;
    delta: number;
    direction: 'drop' | 'rise';
    stealth?: boolean;
    steam?: boolean;
    valueSpike?: boolean;
    rlm?: 'under' | 'over';
    rlmReason?: string;
    notes?: string;
}
export interface LineDropAlert {
    id: string;
    title: string;
    message: string;
    level: 'info' | 'success' | 'warning' | 'error';
    timestamp: number;
    events: LineMovementEvent[];
}
export interface FighterLineHistory {
    fighter: string;
    stat: WatchedStatType;
    points: Array<{
        timestamp: number;
        value: number;
        platform: WatchPlatform;
    }>;
}
/** Compact snapshot point: one timestamp with per-platform values */
export interface LineHistoryPoint {
    t: number;
    v: Record<string, number>;
}
/** Persisted line history for an entire event */
export interface LineHistoryStore {
    eventKey: string;
    updatedAt: number;
    /** Keys: "fighter_name_lower|stat" -> array of timestamped snapshots */
    series: Record<string, LineHistoryPoint[]>;
}
export type WeightClass = 'flyweight' | 'bantamweight' | 'featherweight' | 'lightweight' | 'welterweight' | 'middleweight' | 'lightHeavyweight' | 'heavyweight' | 'womenStrawweight' | 'womenFlyweight' | 'womenBantamweight' | 'womenFeatherweight';
export interface UFCFight {
    f1: string;
    f2: string;
    scheduledRounds?: number;
    weightClass?: WeightClass;
}
export interface UpcomingCard {
    event: string;
    date: string;
    url: string;
    fighters: UFCFight[];
    fetchedAt: number;
    location?: string;
}
export interface ScraperResult {
    platform: string;
    fighters: Fighter[];
    error?: string;
}
export interface AutoScrapeResult {
    status: 'done' | 'already_running';
    results?: Record<string, number>;
}
export interface AppError {
    code: string;
    message: string;
    platform?: string;
    timestamp: number;
    severity: 'debug' | 'warn' | 'error';
}
export type PropType = 'Fantasy' | 'Fantasy_PP' | 'SS' | 'SS_R1' | 'TD' | 'Control' | 'FightTime' | (string & {});
export interface PropArchiveRecord {
    fighter: string;
    opponent: string;
    event: string;
    date: string;
    platform?: string;
    propType: PropType;
    line?: number;
    openLine?: number;
    result: number;
}
export interface StatPrediction {
    line: number;
    lean: 'over' | 'under';
    confidence: number;
    reasons: string[];
}
export interface PropPrediction {
    fighter: string;
    opponent: string;
    scheduledRounds: number;
    weightClass?: WeightClass;
    ss: StatPrediction;
    td: StatPrediction;
    fantasy: StatPrediction;
}
export interface PredictionEvent {
    event: string;
    date: string;
    generatedAt: number;
    predictions: PropPrediction[];
    settled: boolean;
}
export interface PerClassModifier {
    default: number;
    flyweight?: number;
    bantamweight?: number;
    featherweight?: number;
    lightweight?: number;
    welterweight?: number;
    middleweight?: number;
    lightHeavyweight?: number;
    heavyweight?: number;
    womenStrawweight?: number;
    womenFlyweight?: number;
    womenBantamweight?: number;
    womenFeatherweight?: number;
}
export interface PredictorWeights {
    ss_pace_modifier: PerClassModifier;
    td_attempt_modifier: PerClassModifier;
    fp_global_modifier: PerClassModifier;
    fp_ss_weight: number;
    fp_td_weight: number;
    fp_ctrl_weight: number;
    fp_kd_weight: number;
    fp_win_weight: number;
    version: number;
}
export interface FighterTrend {
    fighter: string;
    ss_trend: number;
    td_trend: number;
    fp_trend: number;
    sampleCount: number;
    lastUpdated: number;
}
export interface LearningPredictionResult {
    fighter: string;
    weightClass?: WeightClass;
    predicted: {
        ss: number;
        td: number;
        fp: number;
    };
    actual: {
        ss: number;
        td: number;
        fp: number;
    };
    delta: {
        ss: number;
        td: number;
        fp: number;
    };
    effectiveDelta?: {
        ss: number;
        td: number;
        fp: number;
    };
}
export interface LearningSummary {
    avgAbsDeltaSS: number;
    avgAbsDeltaTD: number;
    avgAbsDeltaFP: number;
    bestPrediction: string;
    worstPrediction: string;
    weightAdjustments: Record<string, number>;
    trendUpdates: number;
}
export interface LearningResult {
    event: string;
    date: string;
    learnedAt: number;
    predictions: LearningPredictionResult[];
    summary: LearningSummary;
}
//# sourceMappingURL=index.d.ts.map