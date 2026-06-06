import { FANTASY_SCORING, PRIZEPICKS_SCORING } from '../config/index.js';
export function scoringFor(platform) {
    return platform === 'prizepicks' ? PRIZEPICKS_SCORING : FANTASY_SCORING;
}
export function winBonusForPlatform(platform, won, method, round) {
    if (!won)
        return 0;
    const wb = scoringFor(platform).winBonus;
    if (/DEC/i.test(method || ''))
        return wb.decision;
    const r = round || 3;
    if (r === 1)
        return wb.round1;
    if (r === 2)
        return wb.round2;
    if (r === 3)
        return wb.round3;
    return wb.round4Plus;
}
export function calcFPForPlatform(platform, sigStr, totStr, ctrlSecs, timeSecs, kd, td, rev, sub, won, method, round) {
    const s = scoringFor(platform);
    const nonSig = Math.max(0, (totStr || 0) - (sigStr || 0));
    let fp = (sigStr || 0) * s.sigStrike
        + nonSig * s.nonSigStrike
        + (ctrlSecs || 0) * s.controlTimePerSec
        + (kd || 0) * s.knockdown
        + (td || 0) * s.takedown
        + (rev || 0) * s.reversal
        + winBonusForPlatform(platform, won, method, round);
    // PrizePicks: submission attempts score 4pts each (other platforms: 0)
    if (platform === 'prizepicks') {
        fp += (sub || 0) * PRIZEPICKS_SCORING.submissionAttempt;
    }
    if (platform !== 'prizepicks' && won && isFinish(method) && (round || 0) === 1 && (timeSecs || 9999) <= 60) {
        fp += FANTASY_SCORING.quickWinBonus;
    }
    return fp;
}
export function calcFP(sigStr, totStr, ctrlSecs, kd, td, rev, won, method, round) {
    return calcFPForPlatform('pick6', sigStr, totStr, ctrlSecs, null, kd, td, rev, null, won, method, round);
}
export function getFightFantasyValueForPlatform(h, platform) {
    const won = h.result === 'win';
    const canReconstruct = h.sigStr != null || h.totStr != null || h.kd != null || h.td != null || h.ctrlSecs != null;
    if (platform === 'pick6') {
        if (canReconstruct) {
            return calcFPForPlatform('pick6', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, h.sub, won, h.method, h.round);
        }
        if (h.fp_p6 != null)
            return h.fp_p6;
        if (h.fp != null)
            return h.fp;
        return null;
    }
    if (platform === 'underdog') {
        if (canReconstruct) {
            return calcFPForPlatform('underdog', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, h.sub, won, h.method, h.round);
        }
        if (h.fp_ud != null)
            return h.fp_ud;
        return null;
    }
    if (platform === 'prizepicks') {
        if (canReconstruct) {
            return calcFPForPlatform('prizepicks', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, h.sub, won, h.method, h.round);
        }
        return null;
    }
    if (canReconstruct) {
        return calcFPForPlatform('betr', h.sigStr, h.totStr, h.ctrlSecs, h.timeSecs, h.kd, h.td, h.rev, h.sub, won, h.method, h.round);
    }
    return h.fp ?? null;
}
export function isFinish(method) {
    return /KO|TKO|SUB/i.test(method || '');
}
export function deriveStyle(careerStats) {
    if (!careerStats)
        return 'balanced';
    const { tdAvg, subAvg, slpm, strAcc } = careerStats;
    // Grappler: meaningful takedown or submission output
    if ((tdAvg != null && tdAvg > 2.0) || (subAvg != null && subAvg > 0.5))
        return 'grappler';
    // Striker: notable striking volume with limited wrestling (catches kickboxers like Izzy ~4.26 SLPM)
    if (slpm != null && slpm > 3.5 && (tdAvg == null || tdAvg < 1.5))
        return 'striker';
    // High-accuracy striker even with moderate volume
    if (strAcc != null && strAcc > 50 && slpm != null && slpm > 3.0 && (tdAvg == null || tdAvg < 1.5))
        return 'striker';
    return 'balanced';
}
//# sourceMappingURL=fantasy-scoring.js.map