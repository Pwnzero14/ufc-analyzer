// Style-vs-style matchup edges + opponent-defense screen + historical
// pattern matching against past opponents of similar style/stance/defense
// tier. All three return LeanReason[] arrays consumed by the lean engine.
import type { FighterDB, FightResult } from '../types/index.js';

export interface LeanReason { icon: 'pos' | 'neg' | 'neu'; text: string }

export function styleMatchupEdge(styleA: string, styleB: string, dbA: FighterDB, dbB: FighterDB): { delta: number; edges: LeanReason[] } {
  const edges: LeanReason[] = [];
  let delta = 0;
  if (styleA === 'striker' && styleB === 'grappler') {
    const oppTD = dbB?.avgTD || 0;
    const myTDDef = dbA?.tdDef || 50;
    if (oppTD > 2.5) {
      const suppression = myTDDef < 55 ? -2.5 : myTDDef < 70 ? -2.0 : -1.5;
      delta += suppression;
      edges.push({ icon: 'neg', text: `Grappler opponent (${oppTD.toFixed(1)} TD/15min) will neutralize striking — TD def ${myTDDef}% offers ${myTDDef > 75 ? 'some' : 'limited'} protection` });
    } else if (oppTD > 1.5) {
      delta -= 1.0;
      edges.push({ icon: 'neg', text: `Grappler opponent (${oppTD.toFixed(1)} TD/15min) — moderate suppression risk for SS volume` });
    } else {
      delta -= 0.5;
      edges.push({ icon: 'neg', text: `Faces grappler but opponent has limited TD output — some suppression risk` });
    }
  } else if (styleA === 'grappler' && styleB === 'striker') {
    const oppTDDef = dbB?.tdDef || 50;
    if (oppTDDef > 75) {
      delta -= 1.5;
      edges.push({ icon: 'neg', text: `Opponent has strong TD defense (${oppTDDef}%) — grappler's main scoring route is compromised` });
    } else {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Striker opponent with average TD defense (${oppTDDef}%) — takedowns should be available` });
    }
  } else if (styleA === 'striker' && styleB === 'striker') {
    delta += 0.5;
    edges.push({ icon: 'pos', text: `Striker vs striker matchup — expect high output and volume, good for FP` });
  } else if (styleA === 'grappler' && styleB === 'grappler') {
    delta -= 1;
    edges.push({ icon: 'neg', text: `Grappler vs grappler — tends toward low-scoring, grinding fight` });
  } else if (styleA === 'balanced' && styleB === 'grappler') {
    const oppTD = dbB?.avgTD || 0;
    const myTDDef = dbA?.tdDef || 50;
    if (oppTD > 2.0) {
      delta -= 1.0;
      edges.push({ icon: 'neg', text: `Well-rounded fighter vs grappler (${oppTD.toFixed(1)} TD/15min) — takedown pressure may limit SS output (TD def: ${myTDDef}%)` });
    } else {
      edges.push({ icon: 'neu', text: `Balanced vs grappler — wrestling exposure moderate; watch fight time line` });
    }
  } else if (styleA === 'balanced' && styleB === 'striker') {
    const oppSLPM = dbB?.slpm ?? 0;
    if (oppSLPM > 4.5) {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Well-rounded vs high-volume striker (${oppSLPM.toFixed(1)} SLPM) — high-pace fight favors FP output` });
    } else {
      edges.push({ icon: 'neu', text: `Balanced vs striker — pace matchup, lean direction driven by stats` });
    }
  } else if (styleA === 'striker' && styleB === 'balanced') {
    const oppTD = dbB?.avgTD || 0;
    if (oppTD > 1.5) {
      delta -= 0.5;
      edges.push({ icon: 'neg', text: `Striker vs well-rounded opponent — occasional wrestling (${oppTD.toFixed(1)} TD/15min) may interrupt striking rhythm` });
    } else {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Striker vs balanced opponent with low TD threat — striking output should flow freely` });
    }
  } else if (styleA === 'grappler' && styleB === 'balanced') {
    const oppTDDef = dbB?.tdDef || 50;
    edges.push({ icon: oppTDDef > 65 ? 'neg' : 'pos', text: `Grappler vs balanced opponent (TD def ${oppTDDef}%) — ${oppTDDef > 65 ? 'above-average TD defense may limit takedown scoring' : 'solid opportunity to score via takedowns'}` });
  } else if (styleA === 'balanced' && styleB === 'balanced') {
    edges.push({ icon: 'neu', text: `Balanced vs balanced — mixed-style fight; outcome and scoring volume hard to predict` });
  }
  return { delta, edges };
}

export function calcOpponentDefenseScore(oppDB: FighterDB, _line: number): { delta: number; edges: LeanReason[] } {
  if (!oppDB?.loaded || !oppDB.history?.length) return { delta: 0, edges: [] };
  const edges: LeanReason[] = [];
  let delta = 0;
  if (oppDB.sapm != null) {
    if (oppDB.sapm < 3.0) {
      delta -= 1;
      edges.push({ icon: 'neg', text: `Opponent absorbs only ${oppDB.sapm.toFixed(1)} sig strikes/min — very defensively sound, limits output` });
    } else if (oppDB.sapm > 5.0) {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Opponent absorbs ${oppDB.sapm.toFixed(1)} sig strikes/min — tends to be in high-output fights` });
    }
  }
  if (oppDB.tdDef != null && oppDB.tdDef > 78) {
    delta -= 0.5;
    edges.push({ icon: 'neg', text: `Opponent's TD defense (${oppDB.tdDef}%) will limit takedown scoring opportunities` });
  }
  if (oppDB.finishRate != null && oppDB.finishRate > 0.70) {
    delta -= 1;
    edges.push({ icon: 'neg', text: `Opponent finishes ${Math.round(oppDB.finishRate*100)}% of fights — early stoppage risk suppresses counting stats` });
  }
  return { delta, edges };
}

// statsCache passed in as a param (was a module-scope const in analyzer.ts).
// Behavior identical — caller in analyzer.ts threads the same map through.
export function calcMatchupPatternEdge(db: FighterDB, oppDB: FighterDB, ssLine: number|null, tdLine: number|null, fpLine: number|null, statsCache: Record<string, FighterDB>): { score: number; ssScore: number; tdScore: number; reasons: LeanReason[] } {
  if (!db?.loaded || !oppDB?.loaded || !db.history?.length) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };
  const history = db.history.filter(h => h.sigStr != null);
  if (history.length < 2) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };

  const reasons: LeanReason[] = [];
  let score = 0, ssScore = 0, tdScore = 0;
  const oppStyle  = oppDB.style  || null;
  const oppStance = oppDB.stance || null;
  const oppStrDef = oppDB.strDef ?? null;
  const oppTdDef  = oppDB.tdDef  ?? null;

  if (oppStyle) {
    const styleMatches = history.filter((h: FightResult) => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && pastOppDB.style === oppStyle;
    });
    if (styleMatches.length >= 2) {
      const avgSS_vsStyle = styleMatches.filter((h: FightResult) => h.sigStr != null).reduce((s: number,h: FightResult) => s + (h.sigStr || 0), 0) / styleMatches.length;
      const avgTD_vsStyle = styleMatches.filter((h: FightResult) => h.td != null).reduce((s: number,h: FightResult) => s + (h.td || 0), 0) / styleMatches.length;
      const avgFP_vsStyle = styleMatches.filter((h: FightResult) => h.fp != null).reduce((s: number,h: FightResult) => s + (h.fp || 0), 0) / styleMatches.length;
      const label = `vs ${oppStyle}s (${styleMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_vsStyle - ssLine;
        const ssHits = styleMatches.filter(h => (h.sigStr || 0) > ssLine).length;
        if (ssDiff > 10) { ssScore += 1.5; reasons.push({ icon:'pos', text:`Avg ${avgSS_vsStyle.toFixed(0)} SS ${label} — ${ssHits}/${styleMatches.length} over SS line ${ssLine}` }); }
        else if (ssDiff > 3) { ssScore += 0.8; reasons.push({ icon:'pos', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — slightly edges line ${ssLine}` }); }
        else if (ssDiff < -10) { ssScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgSS_vsStyle.toFixed(0)} avg SS ${label} — struggles to hit SS line ${ssLine} vs this style` }); }
        else if (ssDiff < -3) { ssScore -= 0.8; reasons.push({ icon:'neg', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — below SS line ${ssLine}` }); }
      }
      if (tdLine) {
        const tdDiff = avgTD_vsStyle - tdLine;
        const tdHits = styleMatches.filter(h => (h.td||0) > tdLine).length;
        if (tdDiff > 1.5) { tdScore += 1.5; reasons.push({ icon:'pos', text:`Avg ${avgTD_vsStyle.toFixed(1)} TDs ${label} — ${tdHits}/${styleMatches.length} over TD line ${tdLine}` }); }
        else if (tdDiff > 0.5) { tdScore += 0.8; reasons.push({ icon:'pos', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — edges TD line ${tdLine}` }); }
        else if (tdDiff < -1.5) { tdScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — misses TD line ${tdLine} vs this style` }); }
        else if (tdDiff < -0.5) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — below TD line ${tdLine}` }); }
      }
      if (fpLine) {
        const fpDiff = avgFP_vsStyle - fpLine;
        if (fpDiff > 8) { score += 1; reasons.push({ icon:'pos', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — ${styleMatches.filter(h=>(h.fp||0)>fpLine).length}/${styleMatches.length} over FP line` }); }
        else if (fpDiff < -8) { score -= 1; reasons.push({ icon:'neg', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — below FP line historically` }); }
      }
    }
  }

  if (oppStance) {
    const stanceMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && (pastOppDB.stance || '').toLowerCase() === oppStance.toLowerCase();
    });
    if (stanceMatches.length >= 2) {
      const avgSS_vsStance = stanceMatches.filter(h => h.sigStr != null).reduce((s,h) => s + (h.sigStr || 0), 0) / stanceMatches.length;
      const avgTD_vsStance = stanceMatches.filter(h => h.td != null).reduce((s,h) => s + (h.td || 0), 0) / stanceMatches.length;
      const label = `vs ${oppStance} opponents (${stanceMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_vsStance - ssLine;
        if (ssDiff > 12) { ssScore += 1.2; reasons.push({ icon:'pos', text:`Avg ${avgSS_vsStance.toFixed(0)} SS ${label}` }); }
        else if (ssDiff < -12) { ssScore -= 1.2; reasons.push({ icon:'neg', text:`Only ${avgSS_vsStance.toFixed(0)} avg SS ${label} — stance creates problems` }); }
      }
      if (tdLine) {
        const tdDiff = avgTD_vsStance - tdLine;
        if (tdDiff > 1) { tdScore += 0.8; reasons.push({ icon:'pos', text:`Avg ${avgTD_vsStance.toFixed(1)} TDs ${label}` }); }
        else if (tdDiff < -1) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`Only ${avgTD_vsStance.toFixed(1)} avg TDs ${label}` }); }
      }
    }
  }

  if (oppStrDef != null) {
    const getStrDefTier = (d: number) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
    const oppTier = getStrDefTier(oppStrDef);
    const tierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.strDef == null) return false;
      return getStrDefTier(pastOppDB.strDef) === oppTier;
    });
    if (tierMatches.length >= 2) {
      const avgSS_tier = tierMatches.filter(h => h.sigStr != null).reduce((s,h) => s + (h.sigStr || 0), 0) / tierMatches.length;
      const ssHits = ssLine ? tierMatches.filter(h => (h.sigStr || 0) > ssLine).length : 0;
      const tierLabel = `vs ${oppTier} strikedef opponents (${oppStrDef}% tier, ${tierMatches.length} fights)`;
      if (ssLine) {
        const ssDiff = avgSS_tier - ssLine;
        if (ssDiff > 10) { ssScore += 1.5; reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — ${ssHits}/${tierMatches.length} clears line` }); }
        else if (ssDiff > 4) { ssScore += 0.8; reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel}` }); }
        else if (ssDiff < -10) { ssScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgSS_tier.toFixed(0)} SS ${tierLabel} — elite defense suppresses output` }); }
        else if (ssDiff < -4) { ssScore -= 0.8; reasons.push({ icon:'neg', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — struggles vs this defense tier` }); }
      }
    } else if (oppStrDef > 60 && ssLine) {
      ssScore -= 0.5; reasons.push({ icon:'neg', text:`Opponent has elite striking defense (${oppStrDef}%) — expect suppressed SS output` });
    } else if (oppStrDef < 45 && ssLine) {
      ssScore += 0.5; reasons.push({ icon:'pos', text:`Opponent has poor striking defense (${oppStrDef}%) — easier to land, boosts SS ceiling` });
    }
  }

  if (oppTdDef != null) {
    const getTdDefTier = (d: number) => d > 80 ? 'elite' : d > 65 ? 'good' : d > 50 ? 'average' : 'poor';
    const oppTdTier = getTdDefTier(oppTdDef);
    const tdTierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.tdDef == null) return false;
      return getTdDefTier(pastOppDB.tdDef) === oppTdTier;
    });
    if (tdTierMatches.length >= 2) {
      const avgTD_tier = tdTierMatches.filter(h => h.td != null).reduce((s,h) => s + (h.td || 0), 0) / tdTierMatches.length;
      const tdHits = tdLine ? tdTierMatches.filter(h => (h.td||0) > tdLine).length : 0;
      const tierLabel = `vs ${oppTdTier} tddef opponents (${oppTdDef}% tier, ${tdTierMatches.length} fights)`;
      if (tdLine) {
        const tdDiff = avgTD_tier - tdLine;
        if (tdDiff > 1.5) { tdScore += 1.5; reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — ${tdHits}/${tdTierMatches.length} clears line` }); }
        else if (tdDiff > 0.5) { tdScore += 0.8; reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` }); }
        else if (tdDiff < -1.5) { tdScore -= 1.5; reasons.push({ icon:'neg', text:`Only ${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — wall keeps them out` }); }
        else if (tdDiff < -0.5) { tdScore -= 0.8; reasons.push({ icon:'neg', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` }); }
      }
    } else if (oppTdDef > 78 && tdLine) {
      tdScore -= 0.8; reasons.push({ icon:'neg', text:`Opponent has elite TD defense (${oppTdDef}%) — historical pattern suggests under on TDs` });
    } else if (oppTdDef < 50 && tdLine) {
      tdScore += 0.8; reasons.push({ icon:'pos', text:`Opponent has poor TD defense (${oppTdDef}%) — prime target for takedowns` });
    }
  }

  if (oppStyle && oppStrDef != null) {
    const getStrDefTier = (d: number) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
    const oppTier = getStrDefTier(oppStrDef);
    const comboMatches = history.filter(h => {
      const p = statsCache[h.opp];
      return p?.loaded && p.style === oppStyle && p.strDef != null && getStrDefTier(p.strDef) === oppTier;
    });
    if (comboMatches.length >= 2) {
      const avgSS = comboMatches.reduce((s,h) => s + (h.sigStr||0), 0) / comboMatches.length;
      const avgTD = comboMatches.reduce((s,h) => s + (h.td||0),     0) / comboMatches.length;
      const avgFP = comboMatches.reduce((s,h) => s + (h.fp||0),     0) / comboMatches.length;
      const lbl = `vs similar ${oppStyle}/${oppTier}-def opponents (${comboMatches.length} fights)`;
      if (ssLine) {
        const diff = avgSS - ssLine;
        const rate = comboMatches.filter(h=>(h.sigStr||0)>ssLine).length;
        if (Math.abs(diff) > 6) {
          const icon: 'pos'|'neg' = diff > 0 ? 'pos' : 'neg';
          ssScore += diff > 0 ? 1.5 : -1.5;
          reasons.push({ icon, text:`🎯 Strong pattern: ${avgSS.toFixed(0)} avg SS ${lbl} — ${rate}/${comboMatches.length} clears line` });
        }
      }
      if (tdLine) {
        const diff = avgTD - tdLine;
        const rate = comboMatches.filter(h=>(h.td||0)>tdLine).length;
        if (Math.abs(diff) > 0.8) {
          const icon: 'pos'|'neg' = diff > 0 ? 'pos' : 'neg';
          tdScore += diff > 0 ? 1.5 : -1.5;
          reasons.push({ icon, text:`🎯 Strong pattern: ${avgTD.toFixed(1)} avg TDs ${lbl} — ${rate}/${comboMatches.length} clears line` });
        }
      }
      if (fpLine) {
        const diff = avgFP - fpLine;
        if (Math.abs(diff) > 10) {
          score += diff > 0 ? 1 : -1;
          reasons.push({ icon: diff>0?'pos':'neg', text:`🎯 ${avgFP.toFixed(1)} avg FP ${lbl}` });
        }
      }
    }
  }
  return { score, ssScore, tdScore, reasons };
}
