import { FighterDB, CareerStats, FightResult, FightStats, OppFightResult } from '../types/index.js';
import { FANTASY_SCORING, CONFIG } from '../config/index.js';

/**
 * Fantasy points calculation and fighter statistics service
 * Encapsulates all FP math and career stats building
 */
export class StatsCalculator {
  private static log(msg: string): void {
    if (CONFIG.logging.debug) {
      console.log('[UFC Stats]', msg);
    }
  }

  // ── FANTASY POINTS CALCULATION ─────────────────────────────────────────
  // Official scoring: pick6.draftkings.com/pick6-rules-and-scoring-ufc
  //                   help.underdogfantasy.com/en/articles/10905385-pick-em-scoring-mma

  static calcWinBonus(won: boolean, method?: string, round?: number): number {
    if (!won) return 0;

    const isDec = /DEC/i.test(method || '');
    if (isDec) return FANTASY_SCORING.winBonus.decision;

    const r = round || 3;
    if (r === 1) return FANTASY_SCORING.winBonus.round1;
    if (r === 2) return FANTASY_SCORING.winBonus.round2;
    if (r === 3) return FANTASY_SCORING.winBonus.round3;
    return FANTASY_SCORING.winBonus.round4Plus;
  }

  static calcFP(
    sigStr?: number | null,
    totStr?: number | null,
    ctrlSecs?: number | null,
    kd?: number | null,
    td?: number | null,
    rev?: number | null,
    won?: boolean,
    method?: string,
    round?: number
  ): number {
    const nonSigStr = Math.max(0, (totStr || 0) - (sigStr || 0));
    return (
      (sigStr || 0) * FANTASY_SCORING.sigStrike +
      nonSigStr * FANTASY_SCORING.nonSigStrike +
      (ctrlSecs || 0) * FANTASY_SCORING.controlTimePerSec +
      (kd || 0) * FANTASY_SCORING.knockdown +
      (td || 0) * FANTASY_SCORING.takedown +
      (rev || 0) * FANTASY_SCORING.reversal +
      this.calcWinBonus(won || false, method, round)
    );
  }

  // ── CAREER STYLE DETECTION ───────────────────────────────────────────

  private static deriveStyle(
    careerStats?: CareerStats
  ): 'striker' | 'grappler' | 'balanced' {
    if (!careerStats) return 'balanced';

    const { tdAvg, subAvg, slpm } = careerStats;

    if ((tdAvg || 0) > 2 || (subAvg || 0) > 0.5) return 'grappler';
    if ((slpm || 0) > 5) return 'striker';
    return 'balanced';
  }

  private static isFinish(method?: string): boolean {
    return /KO|TKO|SUB/i.test(method || '');
  }

  // ── BUILD FIGHTER DATABASE ────────────────────────────────────────────

  static buildFighterDB(name: string, ufcData?: any): FighterDB {
    if (!ufcData) {
      return {
        record: '—',
        country: '🏳️',
        avgFP: null,
        avgFP_p6: null,
        avgFP_ud: null,
        avgSigStr: null,
        avgTD: null,
        style: 'balanced',
        finishRate: null,
        history: [],
        oppHistory: [],
        loaded: false,
        detailUrl: null,
      };
    }

    const { careerStats, fightHistory, detailUrl } = ufcData;
    const careerStats_ = careerStats || {};

    // Build fight history with FP calculations
    const history: FightResult[] = (fightHistory || [])
      .map((f: any) => {
        const won = f.result === 'win';
        const fp =
          f.sigStr != null
            ? this.calcFP(f.sigStr, f.totStr, f.ctrlSecs, f.kd, f.td, f.rev, won, f.method, f.round)
            : null;

        return {
          opp: f.opponent,
          fp,
          fp_p6: fp,
          fp_ud: fp,
          sigStr: f.sigStr,
          totStr: f.totStr,
          ctrlSecs: f.ctrlSecs,
          td: f.td,
          kd: f.kd,
          rev: f.rev,
          method: f.method,
          result: f.result,
          date: f.date,
          round: f.round,
          oppStats: f.oppStats || null,
        };
      })
      .filter((f: FightResult) => f.fp != null);

    // Calculate averages
    const validFights = history.filter((f) => (f.fp || 0) > 0);
    const avgFP =
      validFights.length > 0
        ? validFights.reduce((s, f) => s + (f.fp || 0), 0) / validFights.length
        : null;

    // Average significant strikes from fight history
    const fightsSS = history.filter((f) => f.sigStr != null);
    const avgSigStr =
      fightsSS.length > 0
        ? parseFloat((fightsSS.reduce((s, f) => s + (f.sigStr || 0), 0) / fightsSS.length).toFixed(1))
        : careerStats_?.slpm
          ? parseFloat((careerStats_.slpm * 15).toFixed(1))
          : null;

    // Average TD from fight history
    const fightsTD = history.filter((f) => f.td != null);
    const avgTDperFight =
      fightsTD.length > 0
        ? parseFloat((fightsTD.reduce((s, f) => s + (f.td || 0), 0) / fightsTD.length).toFixed(1))
        : null;

    // Finish rate
    const finishes = validFights.filter((f) => this.isFinish(f.method));
    const finishRate = validFights.length > 0 ? finishes.length / validFights.length : null;

    // Opponent performance history
    const oppHistory: OppFightResult[] = history
      .filter((f) => f.oppStats != null)
      .map((f) => {
        const os = f.oppStats!;
        const oppWon = f.result === 'loss';
        const fp =
          os.sigStr != null
            ? this.calcFP(os.sigStr, os.totStr, os.ctrlSecs, os.kd, os.td, (os as any).rev ?? null, oppWon, f.method, f.round)
            : null;

        return {
          opp: f.opp,
          fp: fp != null ? parseFloat(fp.toFixed(1)) : null,
          sigStr: os.sigStr ?? null,
          totStr: os.totStr ?? null,
          td: os.td ?? null,
          kd: os.kd ?? null,
          ctrlSecs: os.ctrlSecs ?? null,
        };
      })
      .filter((f) => f.fp != null || f.sigStr != null);

    this.log(`Built stats for ${name}: ${history.length} fights, avg FP=${avgFP?.toFixed(1)}`);

    return {
      record: careerStats_?.record || '—',
      country: '🏴',
      avgFP: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
      avgFP_p6: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
      avgFP_ud: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
      avgSigStr,
      avgTD: careerStats_?.tdAvg || null,
      avgTDperFight,
      slpm: careerStats_?.slpm || null,
      sapm: careerStats_?.sapm || null,
      strAcc: careerStats_?.strAcc || null,
      strDef: careerStats_?.strDef || null,
      tdDef: careerStats_?.tdDef || null,
      tdAcc: careerStats_?.tdAcc || null,
      stance: careerStats_?.stance || null,
      style: this.deriveStyle(careerStats_),
      finishRate,
      history,
      oppHistory,
      loaded: true,
      detailUrl: detailUrl || null,
    };
  }

  // ── PARSING UTILITIES ──────────────────────────────────────────────────

  static parseCareerStats(html: string): CareerStats {
    const stats: CareerStats = {};

    const li = (label: string): string | null => {
      const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*)', 'i');
      const m = html.match(re);
      if (!m) return null;
      return (m[1] || '').replace(/&nbsp;/g, ' ').trim() || null;
    };

    const liNum = (label: string): number | null => {
      const v = li(label);
      return v ? parseFloat(v) : null;
    };

    const liPct = (label: string): number | null => {
      const re = new RegExp(
        '<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*?)(\\d+\\.?\\d*)%',
        'i'
      );
      const m = html.match(re);
      return m ? parseFloat(m[2]) : null;
    };

    stats.slpm = liNum('SLpM');
    stats.strAcc = liPct('Str\\.?\\s*Acc\\.?');
    stats.sapm = liNum('SApM');
    stats.strDef = liPct('Str\\.?\\s*Def\\.?');
    stats.tdAvg = liNum('TD\\s*Avg\\.?');
    stats.tdAcc = liPct('TD\\s*Acc\\.?');
    stats.tdDef = liPct('TD\\s*Def\\.?');
    stats.subAvg = liNum('Sub\\.?\\s*Avg\\.?');

    const recM =
      html.match(/Record:\s*([\d]+-[\d]+-[\d]+)/i) ||
      html.match(/<span[^>]*>\s*([\d]+-[\d]+-[\d]+)\s*<\/span>/);
    stats.record = recM ? recM[1] : undefined;

    const htM = html.match(/Height[^<]*<\/i>([^<\n]+)/i);
    stats.height = htM ? htM[1].replace(/&nbsp;/g, ' ').trim() : undefined;

    const stanceM = html.match(/(?:STANCE|Stance)[^<]*<\/i>([^<\n]+)/i);
    stats.stance = stanceM ? stanceM[1].replace(/&nbsp;/g, ' ').trim() : undefined;

    return stats;
  }
}
