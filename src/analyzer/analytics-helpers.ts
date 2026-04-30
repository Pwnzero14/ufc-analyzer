// Pure analytics helpers over FightResult[]. Streak detection, weighted FP
// average (recency-weighted, decay 0.80), floor/ceiling/stdDev/consistency,
// per-round FP. No state, no DOM, no fetch.
import type { FightResult } from '../types/index.js';

export function detectStreak(history: FightResult[]): { type: 'hot'|'cold'|'neutral'; count: number; text: string } {
  if (!history?.length) return { type: 'neutral', count: 0, text: '' };
  const recent = history.slice(0, 5);
  let winStreak = 0, lossStreak = 0;
  for (const h of recent) {
    if (h.result === 'win') { if (lossStreak === 0) winStreak++; else break; }
    else { if (winStreak === 0) lossStreak++; else break; }
  }
  if (winStreak >= 3) return { type: 'hot', count: winStreak, text: `${winStreak}-fight win streak` };
  if (lossStreak >= 2) return { type: 'cold', count: lossStreak, text: `${lossStreak}-fight losing streak` };
  const fpFights = recent.filter(h => h.fp != null);
  if (fpFights.length >= 3) {
    let rising = 0, falling = 0;
    for (let i = 0; i < fpFights.length - 1; i++) {
      const delta = (fpFights[i].fp || 0) - (fpFights[i + 1].fp || 0);
      if (delta > 5) rising++;
      else if (delta < -5) falling++;
    }
    if (rising >= 2) return { type: 'hot', count: rising, text: 'FP trending up last 3 fights' };
    if (falling >= 2) return { type: 'cold', count: falling, text: 'FP trending down last 3 fights' };
  }
  return { type: 'neutral', count: 0, text: '' };
}

export function calcWeightedAvgFP(history: FightResult[]): number|null {
  const valid = history.filter(f => f.fp != null && f.fp! > 0);
  if (!valid.length) return null;
  const weights = valid.map((_, i) => Math.pow(0.80, i));
  const totalW = weights.reduce((s, w) => s + w, 0);
  return parseFloat((valid.reduce((s, f, i) => s + (f.fp || 0) * weights[i], 0) / totalW).toFixed(1));
}

export function calcFPStats(history: FightResult[]): { floor: number|null; ceiling: number|null; stdDev: number|null; consistency: number|null; median: number|null } {
  const fps = history.filter(f => f.fp != null && f.fp! > 0).map(f => f.fp as number);
  if (!fps.length) return { floor: null, ceiling: null, stdDev: null, consistency: null, median: null };
  if (fps.length === 1) return { floor: parseFloat(fps[0].toFixed(1)), ceiling: parseFloat(fps[0].toFixed(1)), stdDev: 0, consistency: 100, median: parseFloat(fps[0].toFixed(1)) };
  const sorted = [...fps].sort((a, b) => a - b);
  const median = parseFloat(sorted[Math.floor(sorted.length / 2)].toFixed(1));
  const floor  = parseFloat(sorted[0].toFixed(1));
  const ceiling = parseFloat(sorted[sorted.length - 1].toFixed(1));
  const mean   = fps.reduce((s, v) => s + v, 0) / fps.length;
  const stdDev = parseFloat(Math.sqrt(fps.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / fps.length).toFixed(1));
  const cv     = mean > 0 ? stdDev / mean : 1;
  const consistency = Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));
  return { floor, ceiling, stdDev, consistency, median };
}

export function calcPerRoundFP(history: FightResult[]): number|null {
  const valid = history.filter(f => f.fp != null && f.fp! > 0 && f.round);
  if (!valid.length) return null;
  const perRound = valid.map(f => (f.fp || 0) / (f.round || 3));
  return parseFloat((perRound.reduce((s, v) => s + v, 0) / perRound.length).toFixed(1));
}
