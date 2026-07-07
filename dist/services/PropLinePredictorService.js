// ── PROP LINE PREDICTOR SERVICE ──────────────────────────────────────────
// Predicts SS, TD, and Fantasy lines for upcoming fights using fighter history,
// opponent data, and self-learned weights. After settlement, runs a learning
// cycle to update fighter trends and formula weights.
import { FANTASY_SCORING, MODEL_VERSION } from '../config/index.js';
// ── Storage Keys ────────────────────────────────────────────────────────
const PREDICTIONS_KEY = 'prop_predictions_v1';
const WEIGHTS_KEY = 'prop_predictor_weights_v1';
const TRENDS_KEY = 'prop_predictor_trends_v1';
const LEARNING_LOG_KEY = 'prop_predictor_learning_log_v1';
// ── Helpers ─────────────────────────────────────────────────────────────
function chromeGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data)));
}
function chromeSet(values) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
            const err = chrome.runtime?.lastError;
            if (err)
                reject(new Error(err.message));
            else
                resolve();
        });
    });
}
function normName(s) {
    return s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function round1(v) {
    return Math.round(v * 2) / 2; // round to nearest 0.5
}
// ── Per-class modifier helpers ──────────────────────────────────────────
function makeModifier(v = 1.0) {
    return { default: v };
}
// Read the modifier for a given weight class; fall back to `default` when the
// class is unknown or has never been sampled.
function getMod(map, wc) {
    if (!wc)
        return map.default;
    const v = map[wc];
    return typeof v === 'number' ? v : map.default;
}
// Normalize a possibly-legacy (number) modifier field into a PerClassModifier.
// Old stored weights had `ss_pace_modifier: number` — migrate by moving that
// value into the `default` bucket. Idempotent for already-migrated values.
function ensureModifier(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return { default: v };
    if (v && typeof v === 'object' && typeof v.default === 'number') {
        return v;
    }
    return { default: 1.0 };
}
function clampModifier(map, lo, hi) {
    map.default = clamp(map.default, lo, hi);
    for (const k of Object.keys(map)) {
        if (k === 'default')
            continue;
        const val = map[k];
        if (typeof val === 'number')
            map[k] = clamp(val, lo, hi);
    }
}
// ── Default Weights ─────────────────────────────────────────────────────
const DEFAULT_WEIGHTS = {
    ss_pace_modifier: makeModifier(1.0),
    td_attempt_modifier: makeModifier(1.0),
    fp_global_modifier: makeModifier(1.0),
    fp_ss_weight: FANTASY_SCORING.sigStrike,
    fp_td_weight: FANTASY_SCORING.takedown,
    fp_ctrl_weight: FANTASY_SCORING.controlTimePerSec,
    fp_kd_weight: FANTASY_SCORING.knockdown,
    fp_win_weight: FANTASY_SCORING.winBonus.decision,
    version: 2,
};
// Learning-cycle hyperparams
const LEARNING_RATE = 0.1; // fraction of relative error applied per event
const MAX_STEP_PER_EVENT = 0.08; // cap per-event multiplicative change at ±8%
const MIN_CLASS_SAMPLES = 2; // need at least this many per-class samples to update a class-specific bucket
// ── Service ─────────────────────────────────────────────────────────────
export class PropLinePredictorService {
    // ── Storage Accessors ───────────────────────────────────────────────
    static async getWeights() {
        const raw = await chromeGet([WEIGHTS_KEY]);
        const stored = raw[WEIGHTS_KEY];
        if (!stored) {
            return {
                ...DEFAULT_WEIGHTS,
                ss_pace_modifier: makeModifier(),
                td_attempt_modifier: makeModifier(),
                fp_global_modifier: makeModifier(),
            };
        }
        // Migrate legacy numeric modifiers → PerClassModifier. Keeps older learned
        // bias alive by putting the stored scalar into `default`.
        const merged = {
            ...DEFAULT_WEIGHTS,
            ...stored,
            ss_pace_modifier: ensureModifier(stored.ss_pace_modifier),
            td_attempt_modifier: ensureModifier(stored.td_attempt_modifier),
            fp_global_modifier: ensureModifier(stored.fp_global_modifier),
        };
        return merged;
    }
    static async saveWeights(w) {
        await chromeSet({ [WEIGHTS_KEY]: w });
    }
    static async getTrends() {
        const raw = await chromeGet([TRENDS_KEY]);
        return Array.isArray(raw[TRENDS_KEY]) ? raw[TRENDS_KEY] : [];
    }
    static async saveTrends(trends) {
        // Prune to 200 most recently updated
        const sorted = [...trends].sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, 200);
        await chromeSet({ [TRENDS_KEY]: sorted });
    }
    static async getPredictions() {
        const raw = await chromeGet([PREDICTIONS_KEY]);
        const preds = Array.isArray(raw[PREDICTIONS_KEY]) ? raw[PREDICTIONS_KEY] : [];
        // Fix duplicated "vs" in event names (e.g. "UFC FN: A vs. B: A vs. B" → "UFC FN: A vs. B")
        for (const p of preds) {
            const m = p.event.match(/^(.+\bvs\.?\s+\S+)\s*:\s*\S+\s+vs\.?\s+\S+$/i);
            if (m)
                p.event = m[1];
        }
        return preds;
    }
    static async savePredictions(preds) {
        await chromeSet({ [PREDICTIONS_KEY]: preds.slice(-10) });
    }
    static async getLearningLog() {
        const raw = await chromeGet([LEARNING_LOG_KEY]);
        return Array.isArray(raw[LEARNING_LOG_KEY]) ? raw[LEARNING_LOG_KEY] : [];
    }
    // ── Find trend for a fighter ────────────────────────────────────────
    static findTrend(trends, fighter) {
        const key = normName(fighter);
        return trends.find(t => normName(t.fighter) === key) ?? null;
    }
    // ── Bookmaker prior from archived Betr FP lines ──────────────────────
    //
    // Past Betr fantasy lines for the same fighter are bookmaker-aggregated
    // information — they incorporate signals (camp news, weight cut rumors,
    // Vegas action) that the model can't see. Each individual line was set
    // for a specific opponent, so the noise is high — but the median across
    // many lines is a useful central-tendency estimate that regularizes
    // wild model predictions.
    //
    // Returns `{ median, sampleCount }` if ≥ MIN_BOOK_SAMPLES recent records
    // exist, else null. Recency window is 24 months — older lines reflect a
    // different version of the fighter.
    static computeBookPriorFP(archive, fighter) {
        const MIN_BOOK_SAMPLES = 5;
        const RECENCY_DAYS = 730;
        const cutoff = Date.now() - RECENCY_DAYS * 86400 * 1000;
        const key = normName(fighter);
        const lines = [];
        for (const r of archive) {
            if (normName(r.fighter) !== key)
                continue;
            if (r.platform !== 'betr')
                continue;
            if (r.propType !== 'Fantasy' && r.propType !== 'FP')
                continue;
            const lineVal = Number(r.line);
            if (!Number.isFinite(lineVal) || lineVal <= 0)
                continue;
            const recordTs = Date.parse(r.date);
            if (Number.isFinite(recordTs) && recordTs < cutoff)
                continue;
            lines.push(lineVal);
        }
        if (lines.length < MIN_BOOK_SAMPLES)
            return null;
        lines.sort((a, b) => a - b);
        const median = lines.length % 2 === 0
            ? (lines[lines.length / 2 - 1] + lines[lines.length / 2]) / 2
            : lines[(lines.length - 1) / 2];
        return { median, sampleCount: lines.length };
    }
    // ── Expected fight duration model ────────────────────────────────────
    //
    // Returns the expected actual length of this fight in minutes, alongside
    // the fighter's own historical average for ratio scaling. Counting-stat
    // predictions (SS, TD, FP base) should scale by `expectedMin / avgHistMin`
    // — this is what fixes early-finish blowups like Davey Grant where the
    // career average is built from 15-min fights but the matchup is highly
    // finishable.
    //
    // P(finish) blends fighter's own finish rate with opponent's finish-loss
    // rate; either side can end the fight early. E[finishMinute] is the mean
    // total-fight-duration across the fighter's past finish wins (falls back
    // to ~7.5 min when sample is too thin).
    static estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds) {
        const fighterFinishRate = fighterDB.finishRate ?? 0.45;
        let oppFinishLossRate = 0.45;
        if (opponentDB) {
            const oppLosses = opponentDB.history.filter(f => f.result === 'loss');
            const oppFinishLosses = oppLosses.filter(f => /KO|TKO|SUB/i.test(f.method || ''));
            oppFinishLossRate = oppLosses.length >= 2 ? oppFinishLosses.length / oppLosses.length : 0.45;
        }
        // Both fighters can end the fight; symmetric blend.
        const pFinish = clamp((fighterFinishRate + oppFinishLossRate) / 2, 0.10, 0.85);
        // E[finishMinute] from fighter's own finish wins (timeSecs is total fight duration).
        const finishWins = fighterDB.history.filter(f => f.result === 'win' && /KO|TKO|SUB/i.test(f.method || '')
            && Number.isFinite(Number(f.timeSecs)) && Number(f.timeSecs) > 0);
        const avgFinishMin = finishWins.length >= 2
            ? finishWins.reduce((s, f) => s + (Number(f.timeSecs) / 60), 0) / finishWins.length
            : 7.5;
        const fullLengthMin = scheduledRounds * 5;
        const expectedMin = pFinish * avgFinishMin + (1 - pFinish) * fullLengthMin;
        // Fighter's own historical avg fight duration — the denominator for ratio scaling.
        let avgHistMin = fighterDB.avgTimeMins ?? NaN;
        if (!Number.isFinite(avgHistMin) || avgHistMin < 1) {
            const valid = fighterDB.history.filter(f => Number.isFinite(Number(f.timeSecs)) && Number(f.timeSecs) > 0);
            avgHistMin = valid.length > 0
                ? valid.reduce((s, f) => s + Number(f.timeSecs) / 60, 0) / valid.length
                : (scheduledRounds === 5 ? 15 : 9); // league-typical fallback
        }
        return { expectedMin, pFinish, avgHistMin, avgFinishMin };
    }
    // ── SS Prediction ───────────────────────────────────────────────────
    static predictSS(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass) {
        const reasons = [];
        // Fighter's average sig strikes per fight
        const fighterAvgSS = fighterDB.avgSigStr ?? ((fighterDB.slpm ?? 3) * 15);
        reasons.push(`Avg SS: ${fighterAvgSS.toFixed(1)}`);
        // Opponent absorbed: use opponent's SAPM * 15 as proxy for how many strikes they absorb
        const oppAbsorbedSS = opponentDB ? ((opponentDB.sapm ?? 3) * 15) : fighterAvgSS;
        if (opponentDB)
            reasons.push(`Opp absorbs: ${oppAbsorbedSS.toFixed(1)} SS/fight`);
        // Expected-duration scaling replaces the naive scheduledRounds/3 multiplier.
        // fighterAvgSS (per-fight) is divided out implicitly: we rebase to the
        // fighter's own avg fight length, then re-scale to *this* fight's expected
        // length. So if the fighter normally goes 13 min but the matchup expects
        // 9 min (highly finishable opp), the SS line drops accordingly.
        const { expectedMin, pFinish, avgHistMin } = this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
        const durationModifier = avgHistMin > 0 ? expectedMin / avgHistMin : (scheduledRounds / 3);
        if (Math.abs(durationModifier - 1) > 0.05) {
            reasons.push(`Duration: ${expectedMin.toFixed(1)}min (P(fin) ${(pFinish * 100).toFixed(0)}%, ×${durationModifier.toFixed(2)})`);
        }
        else if (scheduledRounds === 5) {
            reasons.push('5-round fight');
        }
        // Core formula — pace modifier is per-weight-class so flyweight error doesn't drift heavyweight calibration
        const ssMod = getMod(weights.ss_pace_modifier, weightClass);
        let predicted = ((fighterAvgSS + oppAbsorbedSS) / 2) * ssMod * durationModifier;
        // Style adjustments
        if (fighterDB.style === 'striker') {
            predicted *= 1.08;
            reasons.push('Striker style (+8%)');
        }
        if (opponentDB?.style === 'grappler') {
            predicted *= 0.88;
            reasons.push('vs Grappler (-12%)');
        }
        // Apply learned trend
        if (trend && Math.abs(trend.ss_trend) > 0.5) {
            predicted += trend.ss_trend;
            reasons.push(`Trend adj: ${trend.ss_trend > 0 ? '+' : ''}${trend.ss_trend.toFixed(1)}`);
        }
        // Confidence
        const sampleSize = fighterDB.history.filter(f => f.sigStr != null).length;
        const confidence = clamp(40 + sampleSize * 3 + (fighterDB.fpConsistency ?? 50) * 0.15 + (opponentDB ? 10 : 0), 25, 90);
        const line = round1(clamp(predicted, 0.5, 200));
        const lean = predicted > fighterAvgSS ? 'over' : 'under';
        return { line, lean, confidence: Math.round(confidence), reasons };
    }
    // ── TD Prediction ───────────────────────────────────────────────────
    static predictTD(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass) {
        const reasons = [];
        // Fighter's TD per fight from history
        const tdPerFight = fighterDB.avgTDperFight ?? 0;
        reasons.push(`Avg TD/fight: ${tdPerFight.toFixed(1)}`);
        // Opponent TD defense rate (0-1)
        const oppTdDef = opponentDB ? (opponentDB.tdDef ?? 50) / 100 : 0.5;
        if (opponentDB)
            reasons.push(`Opp TD Def: ${(oppTdDef * 100).toFixed(0)}%`);
        // Expected-duration scaling — same logic as predictSS. TDs are time-distributed,
        // so a finish-prone matchup truncates the TD count.
        const { expectedMin, avgHistMin } = this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
        const durationModifier = avgHistMin > 0 ? expectedMin / avgHistMin : (scheduledRounds / 3);
        if (scheduledRounds === 5)
            reasons.push('5-round fight');
        // Core formula: attempts * success rate adjusted for opponent — per-class TD modifier
        const tdMod = getMod(weights.td_attempt_modifier, weightClass);
        let predicted = tdPerFight * (1 - oppTdDef * 0.5) * durationModifier * tdMod;
        // Style adjustments
        if (fighterDB.style === 'grappler') {
            predicted *= 1.15;
            reasons.push('Grappler style (+15%)');
        }
        if (opponentDB?.style === 'striker') {
            predicted *= 1.05;
            reasons.push('vs Striker (+5% TD opp)');
        }
        // Apply learned trend
        if (trend && Math.abs(trend.td_trend) > 0.1) {
            predicted += trend.td_trend;
            reasons.push(`Trend adj: ${trend.td_trend > 0 ? '+' : ''}${trend.td_trend.toFixed(1)}`);
        }
        // Confidence — TD is harder to predict, lower base
        const sampleSize = fighterDB.history.filter(f => f.td != null).length;
        const confidence = clamp(30 + sampleSize * 3 + (opponentDB ? 10 : 0) + (tdPerFight > 1 ? 10 : 0), 20, 85);
        const line = round1(clamp(predicted, 0.5, 20));
        const lean = predicted > tdPerFight ? 'over' : 'under';
        return { line, lean, confidence: Math.round(confidence), reasons };
    }
    // ── Calculate Betr FP for a single historical fight ──────────────────
    static calcBetrFP(f) {
        if (f.sigStr == null && f.totStr == null && f.kd == null && f.td == null && f.ctrlSecs == null)
            return null;
        const nonSig = Math.max(0, (f.totStr || 0) - (f.sigStr || 0));
        const won = f.result === 'win';
        let fp = (f.sigStr || 0) * FANTASY_SCORING.sigStrike
            + nonSig * FANTASY_SCORING.nonSigStrike
            + (f.ctrlSecs || 0) * FANTASY_SCORING.controlTimePerSec
            + (f.kd || 0) * FANTASY_SCORING.knockdown
            + (f.td || 0) * FANTASY_SCORING.takedown
            + (f.rev || 0) * FANTASY_SCORING.reversal;
        // Win bonus
        if (won) {
            const isDec = /DEC/i.test(f.method || '');
            if (isDec) {
                fp += FANTASY_SCORING.winBonus.decision;
            }
            else {
                const r = f.round || 3;
                if (r === 1)
                    fp += FANTASY_SCORING.winBonus.round1;
                else if (r === 2)
                    fp += FANTASY_SCORING.winBonus.round2;
                else if (r === 3)
                    fp += FANTASY_SCORING.winBonus.round3;
                else
                    fp += FANTASY_SCORING.winBonus.round4Plus;
                // Quick win bonus: R1 finish ≤60s
                if (r === 1 && (f.timeSecs || 9999) <= 60)
                    fp += FANTASY_SCORING.quickWinBonus;
            }
        }
        return fp;
    }
    // ── Fantasy Prediction (Betr Scoring) ───────────────────────────────
    //
    // Strategy: Calculate what each historical fight scored under Betr rules,
    // use recency-weighted average as baseline, then adjust for opponent
    // matchup (defensive stats, finish susceptibility) and scheduled rounds.
    static predictFantasy(fighterDB, opponentDB, scheduledRounds, weights, trend, ssLine, tdLine, weightClass, bookPriorFP) {
        const reasons = [];
        // ── Step 1: Compute per-fight Betr scores from raw history ──────
        const fightScores = [];
        const history = fighterDB.history;
        for (let i = 0; i < history.length; i++) {
            const f = history[i];
            const betrFP = this.calcBetrFP(f);
            if (betrFP == null)
                continue;
            fightScores.push({
                fp: betrFP,
                isRecent: i < 3, // first 3 in history = most recent fights
                rounds: f.round || 3,
                won: f.result === 'win',
                isFinish: /KO|TKO|SUB/i.test(f.method || ''),
                round: f.round || 3,
            });
        }
        // ── Step 2: Recency-weighted average ────────────────────────────
        // Weights: most recent fight = 1.0, then 0.85, 0.72, 0.61, 0.52, etc.
        let baseline;
        if (fightScores.length > 0) {
            let weightSum = 0;
            let fpSum = 0;
            for (let i = 0; i < fightScores.length; i++) {
                const w = Math.pow(0.85, i); // exponential decay
                fpSum += fightScores[i].fp * w;
                weightSum += w;
            }
            baseline = fpSum / weightSum;
            const plainAvg = fightScores.reduce((s, f) => s + f.fp, 0) / fightScores.length;
            reasons.push(`Betr avg: ${plainAvg.toFixed(1)} (${fightScores.length} fights)`);
            if (Math.abs(baseline - plainAvg) > 1) {
                reasons.push(`Recency-weighted: ${baseline.toFixed(1)}`);
            }
        }
        else if (fighterDB.avgFP_betr != null && fighterDB.avgFP_betr > 0) {
            baseline = fighterDB.avgFP_betr;
            reasons.push(`Betr platform avg: ${baseline.toFixed(1)}`);
        }
        else if (fighterDB.avgFP != null && fighterDB.avgFP > 0) {
            baseline = fighterDB.avgFP;
            reasons.push(`Career avg fallback: ${baseline.toFixed(1)}`);
        }
        else {
            // No history at all — build from predicted components as last resort
            baseline = ssLine * FANTASY_SCORING.sigStrike
                + ssLine * 0.3 * FANTASY_SCORING.nonSigStrike
                + tdLine * FANTASY_SCORING.takedown
                + FANTASY_SCORING.winBonus.decision * 0.5;
            reasons.push('No history — component estimate');
        }
        // ── Step 3: Expected-duration adjustment ─────────────────────────
        // Replaces the older "scheduled rounds vs avg history rounds" scaling with
        // a finish-aware duration estimate. Counting stats (sig strikes, ctrl time,
        // TDs) scale by expectedMin/avgHistMin; the win-bonus portion is held flat
        // since it's a step function of outcome, not a linear function of time.
        const { expectedMin, pFinish, avgHistMin, avgFinishMin } = this.estimateExpectedMinutes(fighterDB, opponentDB, scheduledRounds);
        if (fightScores.length >= 2 && avgHistMin > 0 && Math.abs(expectedMin - avgHistMin) > 0.5) {
            // Average historical win-bonus contribution to FP — this part doesn't scale with time.
            const winners = fightScores.filter(f => f.won);
            const avgWinBonus = winners.length > 0
                ? winners.reduce((s, f) => {
                    if (!f.isFinish)
                        return s + FANTASY_SCORING.winBonus.decision;
                    if (f.round === 1)
                        return s + FANTASY_SCORING.winBonus.round1;
                    if (f.round === 2)
                        return s + FANTASY_SCORING.winBonus.round2;
                    if (f.round === 3)
                        return s + FANTASY_SCORING.winBonus.round3;
                    return s + FANTASY_SCORING.winBonus.round4Plus;
                }, 0) / fightScores.length
                : 0;
            const countingStatPortion = Math.max(0, baseline - avgWinBonus);
            const durationRatio = expectedMin / avgHistMin;
            const oldBaseline = baseline;
            baseline = countingStatPortion * durationRatio + avgWinBonus;
            if (Math.abs(durationRatio - 1) > 0.05) {
                reasons.push(`Duration adj: ${expectedMin.toFixed(1)}min vs avg ${avgHistMin.toFixed(1)}min (×${durationRatio.toFixed(2)}) → ${oldBaseline.toFixed(1)}→${baseline.toFixed(1)}`);
            }
        }
        if (pFinish > 0.6) {
            reasons.push(`High P(finish) ${(pFinish * 100).toFixed(0)}% (E[finish] ${avgFinishMin.toFixed(1)}min)`);
        }
        // ── Step 4: Opponent matchup adjustments ────────────────────────
        let oppMultiplier = 1.0;
        const oppReasons = [];
        if (opponentDB) {
            // 4a. Striking absorption — opponent's SAPM vs league average (~3.5)
            //     High SAPM = opponent gets hit a lot = more striking FP for our fighter
            const oppSAPM = opponentDB.sapm ?? 3.5;
            const sapmDelta = (oppSAPM - 3.5) / 3.5; // e.g. SAPM=5 → +43%, SAPM=2 → -43%
            const strikingAdj = 1 + sapmDelta * 0.15; // dampen: ±6% per unit
            if (Math.abs(sapmDelta) > 0.1) {
                oppReasons.push(`Opp absorbs ${oppSAPM.toFixed(1)} S/min (${sapmDelta > 0 ? '+' : ''}${(sapmDelta * 15).toFixed(0)}%)`);
            }
            // 4b. Opponent striking defense — high strDef = harder to land
            const oppStrDef = opponentDB.strDef ?? 55;
            const strDefDelta = (55 - oppStrDef) / 100; // Below 55% = easier target
            const strDefAdj = 1 + strDefDelta * 0.20;
            if (Math.abs(strDefDelta) > 0.05) {
                oppReasons.push(`Opp str def ${oppStrDef}%`);
            }
            // 4c. Opponent TD defense — affects grappling scoring
            const oppTdDef = opponentDB.tdDef ?? 55;
            const tdDefDelta = (55 - oppTdDef) / 100;
            // Only applies to the grappling portion — estimate ~20% of FP from grappling
            const tdAdj = 1 + tdDefDelta * 0.08;
            if (Math.abs(tdDefDelta) > 0.05) {
                oppReasons.push(`Opp TD def ${oppTdDef}%`);
            }
            // 4d. Opponent finish susceptibility — affects win bonus expectation
            //     Look at opponent's loss history for KO/TKO/SUB losses
            const oppLosses = opponentDB.history.filter(f => f.result === 'loss');
            const oppFinishLosses = oppLosses.filter(f => /KO|TKO|SUB/i.test(f.method || ''));
            const oppFinishLossRate = oppLosses.length >= 2 ? oppFinishLosses.length / oppLosses.length : 0.45;
            // Compare to fighter's own finish rate
            const fighterFinishRate = fighterDB.finishRate ?? 0.45;
            // If fighter finishes often AND opponent gets finished often → boost win bonus
            const finishSynergyDelta = ((fighterFinishRate - 0.45) + (oppFinishLossRate - 0.45)) / 2;
            const finishAdj = 1 + finishSynergyDelta * 0.12;
            if (Math.abs(finishSynergyDelta) > 0.05) {
                oppReasons.push(`Finish synergy: ${fighterFinishRate > 0.5 ? 'finisher' : 'grinder'} vs ${oppFinishLossRate > 0.5 ? 'vulnerable' : 'durable'}`);
            }
            oppMultiplier = strikingAdj * strDefAdj * tdAdj * finishAdj;
            oppMultiplier = clamp(oppMultiplier, 0.78, 1.25); // cap total adjustment ±22%
        }
        let predicted = baseline * oppMultiplier;
        if (opponentDB && Math.abs(oppMultiplier - 1) > 0.01) {
            reasons.push(`Opp adj: ×${oppMultiplier.toFixed(2)} (${oppReasons.join('; ')})`);
        }
        // ── Step 5: Style matchup modifiers ─────────────────────────────
        if (fighterDB.style === 'grappler' && opponentDB?.style === 'grappler') {
            // Grappler vs grappler often neutralizes grappling → less ctrl time
            predicted *= 0.94;
            reasons.push('Grappler vs grappler (-6%)');
        }
        if (fighterDB.style === 'striker' && opponentDB?.style === 'striker') {
            // Striker vs striker = more action, more KD potential
            predicted *= 1.04;
            reasons.push('Striker vs striker (+4%)');
        }
        // ── Step 6: Apply learned trend ─────────────────────────────────
        if (trend && Math.abs(trend.fp_trend) > 1) {
            predicted += trend.fp_trend;
            reasons.push(`Trend: ${trend.fp_trend > 0 ? '+' : ''}${trend.fp_trend.toFixed(1)}`);
        }
        // ── Step 6b: Apply learned FP calibration modifier (per weight class) ───
        // This is the knob `runLearningCycle` turns to correct FP bias — per class so
        // heavyweight over-prediction doesn't drag flyweight calibration down.
        const fpMod = getMod(weights.fp_global_modifier, weightClass);
        if (Math.abs(fpMod - 1) > 0.005) {
            predicted *= fpMod;
            reasons.push(`FP cal (${weightClass ?? 'default'}): ×${fpMod.toFixed(3)}`);
        }
        // ── Step 6c: Blend bookmaker prior (median past Betr FP lines) ───
        // Bookmakers see signals the model doesn't (camp news, weight-cut chatter,
        // late action). When we have ≥5 recent (≤24mo) Betr FP lines for this
        // fighter, blend the median in as a 30% regularizer. This dampens wild
        // model predictions and brings projections closer to market consensus
        // when the fighter has a reasonable bookmaker history.
        if (bookPriorFP && bookPriorFP.sampleCount >= 5) {
            // Blend weight scales with sample size (5 → 0.20, 10 → 0.30, 20+ → 0.35).
            const blendW = clamp(0.10 + bookPriorFP.sampleCount * 0.02, 0.20, 0.35);
            const oldPredicted = predicted;
            predicted = (1 - blendW) * predicted + blendW * bookPriorFP.median;
            if (Math.abs(oldPredicted - predicted) > 1) {
                reasons.push(`Book prior: ${bookPriorFP.median.toFixed(1)} (n=${bookPriorFP.sampleCount}, w=${blendW.toFixed(2)}) → ${oldPredicted.toFixed(1)}→${predicted.toFixed(1)}`);
            }
        }
        // ── Step 7: Floor/ceiling sanity from history ────────────────────
        if (fighterDB.fpFloor != null && fighterDB.fpCeiling != null && fightScores.length >= 3) {
            // Don't predict outside reasonable range unless opponent adjustments push it
            const historicFloor = fighterDB.fpFloor * 0.85;
            const historicCeiling = fighterDB.fpCeiling * 1.1;
            if (predicted < historicFloor || predicted > historicCeiling) {
                const clamped = clamp(predicted, historicFloor, historicCeiling);
                reasons.push(`Clamped to historic range: ${historicFloor.toFixed(0)}-${historicCeiling.toFixed(0)}`);
                predicted = clamped;
            }
        }
        // ── Confidence ──────────────────────────────────────────────────
        const sampleSize = fightScores.length;
        const consistencyBonus = (fighterDB.fpConsistency ?? 50) * 0.25;
        const oppBonus = opponentDB ? 10 : 0;
        const recentBonus = sampleSize >= 3 ? 5 : 0;
        const confidence = clamp(30 + sampleSize * 4 + consistencyBonus + oppBonus + recentBonus, 20, 92);
        const historicalAvg = fighterDB.avgFP_betr ?? fighterDB.avgFP ?? predicted;
        const line = round1(clamp(predicted, 5, 250));
        const lean = predicted > historicalAvg ? 'over' : 'under';
        return { line, lean, confidence: Math.round(confidence), reasons };
    }
    // ── Predict All Stats for a Fighter ─────────────────────────────────
    static predictFighter(fighter, opponent, fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass, bookPriorFP) {
        const ss = this.predictSS(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass);
        const td = this.predictTD(fighterDB, opponentDB, scheduledRounds, weights, trend, weightClass);
        const fantasy = this.predictFantasy(fighterDB, opponentDB, scheduledRounds, weights, trend, ss.line, td.line, weightClass, bookPriorFP);
        return { fighter, opponent, scheduledRounds, modelVersion: MODEL_VERSION, weightClass: weightClass ?? undefined, ss, td, fantasy };
    }
    // ── Learning Cycle ──────────────────────────────────────────────────
    static async runLearningCycle(eventName, archiveRecords) {
        const predictions = await this.getPredictions();
        // Match ALL unsettled entries for this event — duplicates can occur when
        // predictions were re-generated under slightly different event-name strings
        // or auto-corrected after the fact. Learn from the first, mark all settled
        // so the duplicates don't double-update weights on subsequent clicks.
        const eventMatches = predictions.filter(p => !p.settled && normName(p.event).includes(normName(eventName).slice(0, 20)));
        const eventPred = eventMatches[0];
        if (!eventPred)
            return null;
        const weights = await this.getWeights();
        const trends = await this.getTrends();
        const results = [];
        // RLM-as-calibration: when the closing line moved meaningfully from open
        // on a prop, sharp action says the model was off by the RLM amount. Blend
        // the closing line into the truth target as a partial signal:
        //   effectiveActual = 0.7 × actual + 0.3 × closingLine  (only if |rlm| > threshold)
        // Trend EWMA + per-class weight updates use the resulting effectiveDelta.
        const RLM_FP = 5, RLM_SS = 3, RLM_TD = 0.5;
        const getMarketSignal = (fighter, propType) => {
            const fkey = normName(fighter);
            const matching = archiveRecords.filter(r => normName(r.fighter) === fkey &&
                r.propType === propType &&
                Number.isFinite(Number(r.openLine)) &&
                Number.isFinite(Number(r.line)));
            if (matching.length === 0)
                return null;
            const closes = matching.map(r => Number(r.line)).sort((a, b) => a - b);
            const drifts = matching.map(r => Number(r.line) - Number(r.openLine)).sort((a, b) => a - b);
            return {
                closingLine: closes[Math.floor(closes.length / 2)],
                rlm: drifts[Math.floor(drifts.length / 2)],
            };
        };
        const blendActual = (raw, market, threshold) => {
            if (!Number.isFinite(raw) || !market || Math.abs(market.rlm) <= threshold)
                return raw;
            return 0.7 * raw + 0.3 * market.closingLine;
        };
        for (const pred of eventPred.predictions) {
            const key = normName(pred.fighter);
            // Find matching settled archive records
            const ssActual = archiveRecords.find(r => normName(r.fighter) === key && r.propType === 'SS' && Number.isFinite(Number(r.result)));
            const tdActual = archiveRecords.find(r => normName(r.fighter) === key && r.propType === 'TD' && Number.isFinite(Number(r.result)));
            const fpActual = archiveRecords.find(r => normName(r.fighter) === key && (r.propType === 'Fantasy' || r.propType === 'FP') && Number.isFinite(Number(r.result)));
            const actual = {
                ss: ssActual ? Number(ssActual.result) : NaN,
                td: tdActual ? Number(tdActual.result) : NaN,
                fp: fpActual ? Number(fpActual.result) : NaN,
            };
            const predicted = { ss: pred.ss.line, td: pred.td.line, fp: pred.fantasy.line };
            const delta = {
                ss: actual.ss - predicted.ss,
                td: actual.td - predicted.td,
                fp: actual.fp - predicted.fp,
            };
            const ssMarket = getMarketSignal(pred.fighter, 'SS');
            const tdMarket = getMarketSignal(pred.fighter, 'TD');
            const fpMarket = getMarketSignal(pred.fighter, 'Fantasy');
            const effectiveActual = {
                ss: blendActual(actual.ss, ssMarket, RLM_SS),
                td: blendActual(actual.td, tdMarket, RLM_TD),
                fp: blendActual(actual.fp, fpMarket, RLM_FP),
            };
            const effectiveDelta = {
                ss: effectiveActual.ss - predicted.ss,
                td: effectiveActual.td - predicted.td,
                fp: effectiveActual.fp - predicted.fp,
            };
            results.push({ fighter: pred.fighter, weightClass: pred.weightClass, predicted, actual, delta, effectiveDelta });
            // Update fighter trend with sample-count-adaptive learning rate.
            // α = clamp(1 / (n+2), 0.10, 0.50) where n is pre-update sampleCount.
            // First sample → α=0.50 (absorb half), n=3 → 0.20, n=8+ → 0.10 (stabilize).
            let fighterTrend = this.findTrend(trends, pred.fighter);
            if (!fighterTrend) {
                fighterTrend = { fighter: pred.fighter, ss_trend: 0, td_trend: 0, fp_trend: 0, sampleCount: 0, lastUpdated: 0 };
                trends.push(fighterTrend);
            }
            const alpha = clamp(1 / (fighterTrend.sampleCount + 2), 0.10, 0.50);
            if (Number.isFinite(effectiveDelta.ss))
                fighterTrend.ss_trend = fighterTrend.ss_trend * (1 - alpha) + effectiveDelta.ss * alpha;
            if (Number.isFinite(effectiveDelta.td))
                fighterTrend.td_trend = fighterTrend.td_trend * (1 - alpha) + effectiveDelta.td * alpha;
            if (Number.isFinite(effectiveDelta.fp))
                fighterTrend.fp_trend = fighterTrend.fp_trend * (1 - alpha) + effectiveDelta.fp * alpha;
            fighterTrend.sampleCount++;
            fighterTrend.lastUpdated = Date.now();
        }
        // ── Per-class proportional weight updates ──────────────────────────
        // Each modifier (ss, td, fp) is now a PerClassModifier. We always update the
        // `default` bucket using all samples (so events with no class data still learn)
        // AND update each class-specific bucket that has ≥ MIN_CLASS_SAMPLES samples
        // this event. This means flyweight bias no longer leaks into heavyweight calibration.
        const weightAdj = {};
        const proportionalStep = (samples, pickActual, pickDelta, minActual) => {
            if (samples.length === 0)
                return null;
            const valid = samples.filter(r => Number.isFinite(pickDelta(r)));
            if (valid.length === 0)
                return null;
            const avgActual = valid.reduce((s, r) => s + pickActual(r), 0) / valid.length;
            if (avgActual < minActual)
                return null;
            const avgDelta = valid.reduce((s, r) => s + pickDelta(r), 0) / valid.length;
            const relErr = avgDelta / avgActual;
            return clamp(relErr * LEARNING_RATE, -MAX_STEP_PER_EVENT, MAX_STEP_PER_EVENT);
        };
        // Group results by weight class (undefined/unknown → 'default' bucket)
        const resultsByClass = new Map();
        for (const r of results) {
            const key = (r.weightClass ?? 'default');
            const bucket = resultsByClass.get(key) ?? [];
            bucket.push(r);
            resultsByClass.set(key, bucket);
        }
        const statConfigs = [
            { mod: 'ss_pace_modifier', label: 'ss', pickActual: r => r.actual.ss, pickDelta: r => r.effectiveDelta?.ss ?? r.delta.ss, minActual: 1 },
            { mod: 'td_attempt_modifier', label: 'td', pickActual: r => r.actual.td, pickDelta: r => r.effectiveDelta?.td ?? r.delta.td, minActual: 0.3 },
            { mod: 'fp_global_modifier', label: 'fp', pickActual: r => r.actual.fp, pickDelta: r => r.effectiveDelta?.fp ?? r.delta.fp, minActual: 5 },
        ];
        for (const cfg of statConfigs) {
            const map = weights[cfg.mod];
            // 1) Always update the `default` bucket using ALL samples — this is the fallback
            //    applied to classes we've never seen, and the most stable signal each event.
            const allStep = proportionalStep(results, cfg.pickActual, cfg.pickDelta, cfg.minActual);
            if (allStep != null) {
                const old = map.default;
                map.default = old * (1 + allStep);
                weightAdj[`${cfg.mod}.default`] = map.default - old;
            }
            // 2) Update each weight class that has enough samples to be trustworthy.
            //    Class-specific bucket is seeded from `default` (post-update) the first time
            //    we see that class, so it inherits accumulated bias rather than starting at 1.0.
            for (const [wc, bucket] of resultsByClass) {
                if (wc === 'default')
                    continue;
                const valid = bucket.filter(r => Number.isFinite(cfg.pickDelta(r)));
                if (valid.length < MIN_CLASS_SAMPLES)
                    continue;
                const step = proportionalStep(valid, cfg.pickActual, cfg.pickDelta, cfg.minActual);
                if (step == null)
                    continue;
                const old = typeof map[wc] === 'number' ? map[wc] : map.default;
                const next = old * (1 + step);
                map[wc] = next;
                weightAdj[`${cfg.mod}.${wc}`] = next - old;
            }
        }
        // Clamp every bucket to sane ranges
        clampModifier(weights.ss_pace_modifier, 0.7, 1.4);
        clampModifier(weights.td_attempt_modifier, 0.5, 1.6);
        clampModifier(weights.fp_global_modifier, 0.75, 1.30);
        weights.version++;
        // Persist
        await this.saveWeights(weights);
        await this.saveTrends(trends);
        // Build summary
        const allDeltas = results.filter(r => Number.isFinite(r.delta.ss) || Number.isFinite(r.delta.fp));
        const bestIdx = allDeltas.reduce((best, r, i) => {
            const score = Math.abs(r.delta.ss || 0) + Math.abs(r.delta.td || 0) + Math.abs(r.delta.fp || 0);
            const bestScore = Math.abs(allDeltas[best].delta.ss || 0) + Math.abs(allDeltas[best].delta.td || 0) + Math.abs(allDeltas[best].delta.fp || 0);
            return score < bestScore ? i : best;
        }, 0);
        const worstIdx = allDeltas.reduce((worst, r, i) => {
            const score = Math.abs(r.delta.ss || 0) + Math.abs(r.delta.td || 0) + Math.abs(r.delta.fp || 0);
            const worstScore = Math.abs(allDeltas[worst].delta.ss || 0) + Math.abs(allDeltas[worst].delta.td || 0) + Math.abs(allDeltas[worst].delta.fp || 0);
            return score > worstScore ? i : worst;
        }, 0);
        const meanAbs = (arr, pick) => {
            const valid = arr.filter(r => Number.isFinite(pick(r)));
            if (!valid.length)
                return 0;
            return valid.reduce((s, r) => s + Math.abs(pick(r)), 0) / valid.length;
        };
        const summary = {
            avgAbsDeltaSS: meanAbs(results, r => r.delta.ss),
            avgAbsDeltaTD: meanAbs(results, r => r.delta.td),
            avgAbsDeltaFP: meanAbs(results, r => r.delta.fp),
            bestPrediction: allDeltas[bestIdx]?.fighter ?? '—',
            worstPrediction: allDeltas[worstIdx]?.fighter ?? '—',
            weightAdjustments: weightAdj,
            trendUpdates: results.filter(r => Number.isFinite(r.delta.ss) || Number.isFinite(r.delta.td) || Number.isFinite(r.delta.fp)).length,
        };
        const learningResult = {
            event: eventName,
            date: new Date().toISOString(),
            learnedAt: Date.now(),
            predictions: results,
            summary,
        };
        // Append to log
        const log = await this.getLearningLog();
        log.push(learningResult);
        await chromeSet({ [LEARNING_LOG_KEY]: log.slice(-20) });
        // Mark settled — all duplicate entries, not just the one we learned from
        for (const p of eventMatches)
            p.settled = true;
        await this.savePredictions(predictions);
        return learningResult;
    }
}
//# sourceMappingURL=PropLinePredictorService.js.map