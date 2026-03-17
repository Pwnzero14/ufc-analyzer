// ── DEBUG PANEL ────────────────────────────────────────────────────────────
const debugMessages = [];
function debugLog(msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  console.log('[UFC]', msg);
  debugMessages.push(line);
  const panel = document.getElementById('debugPanel');
  if (panel) {
    panel.textContent = debugMessages.slice(-20).join('\n');
    panel.scrollTop = panel.scrollHeight;
  }
}

// ── UFC STATS MOCK DATA ──────────────────────────────────────────────────
// In production this would be fetched from ufcstats.com or a scraped JSON.
// Format: name (normalized) -> { record, avgFP_p6, avgFP_ud, sigStrikes, td, history }
// ── REAL UFC STATS via Extension ──────────────────────────────────────────
// Cache fetched fighter data in memory for this session
const statsCache = {};

// ── FANTASY SCORING (official — identical for Pick6 and Underdog) ────────
// Source: pick6.draftkings.com/pick6-rules-and-scoring-ufc
//         help.underdogfantasy.com/en/articles/10905385-pick-em-scoring-mma
//
// Sig Strike:    0.4 pts (counts as strike 0.2 + sig strike 0.2)
// Non-sig Strike:0.2 pts
// Control Time:  0.03 pts/second
// Takedown:      5 pts
// Reversal/Sweep:5 pts
// Knockdown:     10 pts
// Win R1:        90 pts  | Win R2: 70 pts | Win R3: 45 pts
// Win R4/R5:     40 pts  | Decision Win:  30 pts
// Quick Win Bonus (R1 ≤60s): +25 pts — not detectable from history totals, omitted
function winBonus(won, method, round) {
  if (!won) return 0;
  const isDec = /DEC/i.test(method || '');
  if (isDec) return 30;
  const r = round || 3;
  if (r === 1) return 90;
  if (r === 2) return 70;
  if (r === 3) return 45;
  return 40; // R4 or R5
}

// Both platforms use identical scoring — one formula
function calcFP(sigStr, totStr, ctrlSecs, kd, td, rev, won, method, round) {
  const nonSig = Math.max(0, (totStr || 0) - (sigStr || 0));
  return (sigStr  || 0) * 0.4
       + nonSig          * 0.2
       + (ctrlSecs || 0) * 0.03
       + (kd  || 0)      * 10
       + (td  || 0)      * 5
       + (rev || 0)      * 5
       + winBonus(won, method, round);
}


function isFinish(method) {
  return /KO|TKO|SUB/i.test(method || '');
}

function deriveStyle(careerStats) {
  if (!careerStats) return 'balanced';
  const { slpm, tdAvg, subAvg } = careerStats;
  if (tdAvg > 2 || subAvg > 0.5) return 'grappler';
  if (slpm > 5) return 'striker';
  return 'balanced';
}

// ── ANALYTICS HELPERS ─────────────────────────────────────────────────────

function detectStreak(history) {
  if (!history?.length) return { type: 'neutral', count: 0, text: '' };
  const recent = history.slice(0, 5);
  // Win/loss streak
  let winStreak = 0, lossStreak = 0;
  for (const h of recent) {
    if (h.result === 'win') { if (lossStreak === 0) winStreak++; else break; }
    else { if (winStreak === 0) lossStreak++; else break; }
  }
  if (winStreak >= 3) return { type: 'hot', count: winStreak, text: `${winStreak}-fight win streak` };
  if (lossStreak >= 2) return { type: 'cold', count: lossStreak, text: `${lossStreak}-fight losing streak` };
  // FP trend
  const fpFights = recent.filter(h => h.fp != null);
  if (fpFights.length >= 3) {
    let rising = 0, falling = 0;
    for (let i = 0; i < fpFights.length - 1; i++) {
      const delta = fpFights[i].fp - fpFights[i + 1].fp;
      if (delta > 5) rising++;
      else if (delta < -5) falling++;
    }
    if (rising >= 2) return { type: 'hot', count: rising, text: 'FP trending up last 3 fights' };
    if (falling >= 2) return { type: 'cold', count: falling, text: 'FP trending down last 3 fights' };
  }
  return { type: 'neutral', count: 0, text: '' };
}

// Recency-weighted average FP — most recent fight = highest weight (exponential decay 0.80)
function calcWeightedAvgFP(history) {
  const valid = history.filter(f => f.fp != null && f.fp > 0);
  if (!valid.length) return null;
  const weights = valid.map((_, i) => Math.pow(0.80, i));
  const totalW = weights.reduce((s, w) => s + w, 0);
  return parseFloat((valid.reduce((s, f, i) => s + (f.fp || 0) * weights[i], 0) / totalW).toFixed(1));
}

// Floor, ceiling, stdDev, consistency score (0–100), median
function calcFPStats(history) {
  const fps = history.filter(f => f.fp != null && f.fp > 0).map(f => f.fp);
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

// Per-round normalized FP (FP divided by round the fight ended in)
function calcPerRoundFP(history) {
  const valid = history.filter(f => f.fp != null && f.fp > 0 && f.round);
  if (!valid.length) return null;
  const perRound = valid.map(f => (f.fp || 0) / (f.round || 3));
  return parseFloat((perRound.reduce((s, v) => s + v, 0) / perRound.length).toFixed(1));
}

// Hit rate for last N fights
function calcRecentHitRate(history, line, n = 3) {
  if (!line || history.length < 2) return null;
  const recent = history.slice(0, n).filter(h => h.fp != null);
  if (!recent.length) return null;
  const hits = recent.filter(h => h.fp > line).length;
  return { hits, total: recent.length, rate: parseFloat((hits / recent.length).toFixed(2)) };
}

function buildFighterDB(name, ufcData) {
  if (!ufcData) {
    return {
      record: '—', country: '🏳️',
      avgFP_p6: null, avgFP_ud: null,
      avgSigStr: null, avgTD: null,
      style: 'balanced', finishRate: null,
      history: [], oppHistory: [], loaded: false, detailUrl: null
    };
  }

  const { careerStats, fightHistory, detailUrl } = ufcData;
  const history = (fightHistory || []).map(f => {
    const won = f.result === 'win';
    const fp = (f.sigStr != null)
      ? calcFP(f.sigStr, f.totStr, f.ctrlSecs, f.kd, f.td, f.rev, won, f.method, f.round)
      : null;
    return {
      opp: f.opponent, fp, fp_p6: fp, fp_ud: fp,
      sigStr: f.sigStr, totStr: f.totStr, ctrlSecs: f.ctrlSecs,
      td: f.td, kd: f.kd, rev: f.rev, method: f.method, result: f.result, date: f.date, round: f.round,
      oppStats: f.oppStats || null,  // opponent's raw stats in this fight (their SS, TD, FP scored)
    };
  }).filter(f => f.fp != null);

  const validFights = history.filter(f => f.fp > 0);
  const avgFP = validFights.length ? validFights.reduce((s,f) => s + f.fp, 0) / validFights.length : null;
  const avgFP_p6 = avgFP;
  const avgFP_ud = avgFP;

  // Compute avg sig strikes and avg TDs from actual fight history (more accurate than career rate)
  const fightsSS = history.filter(f => f.sigStr != null);
  const avgSigStr = fightsSS.length ? parseFloat((fightsSS.reduce((s,f) => s + f.sigStr, 0) / fightsSS.length).toFixed(1)) : (careerStats?.slpm ? parseFloat((careerStats.slpm * 15).toFixed(1)) : null);
  const fightsTD = history.filter(f => f.td != null);
  const avgTDperFight = fightsTD.length ? parseFloat((fightsTD.reduce((s,f) => s + f.td, 0) / fightsTD.length).toFixed(1)) : null;

  const finishes = validFights.filter(f => isFinish(f.method));
  const finishRate = validFights.length ? finishes.length / validFights.length : null;

  // ── NEW ANALYTICS METRICS ─────────────────────────────────────────────
  const avgFP_weighted = calcWeightedAvgFP(history);
  const fpStats        = calcFPStats(history);
  const avgFP_perRound = calcPerRoundFP(history);
  const streak         = detectStreak(history);
  const fiveRoundFights = history.filter(f => (f.round || 0) >= 4).length;
  const fiveRoundRate   = history.length > 0 ? parseFloat((fiveRoundFights / history.length).toFixed(2)) : 0;

  return {
    record: careerStats?.record || '—',
    country: '🏴',
    avgFP: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
    avgFP_p6: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
    avgFP_ud: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
    avgSigStr,
    avgTD: careerStats?.tdAvg || null,
    avgTDperFight,
    slpm: careerStats?.slpm || null,
    sapm: careerStats?.sapm || null,
    strAcc: careerStats?.strAcc || null,
    strDef: careerStats?.strDef || null,
    tdDef: careerStats?.tdDef || null,
    tdAcc: careerStats?.tdAcc || null,
    stance: careerStats?.stance || null,
    style: deriveStyle(careerStats),
    finishRate,
    avgFP_weighted: avgFP_weighted,
    fpFloor:        fpStats.floor,
    fpCeiling:      fpStats.ceiling,
    fpStdDev:       fpStats.stdDev,
    fpConsistency:  fpStats.consistency,
    fpMedian:       fpStats.median,
    avgFP_perRound,
    streak,
    fiveRoundRate,
    history,
    oppHistory: history
      .filter(f => f.oppStats != null)
      .map(f => {
        const os = f.oppStats;
        // Opponent won if the fighter lost
        const oppWon = f.result === 'loss';
        // Use the fight's method and round (shared context) for win bonus
        const fp = (os.sigStr != null)
          ? calcFP(os.sigStr, os.totStr, os.ctrlSecs, os.kd, os.td, null, oppWon, f.method, f.round)
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
      .filter(f => f.fp != null || f.sigStr != null),
    loaded: true,
    detailUrl: detailUrl || null,
  };
}

// ── UFCSTATS DIRECT FETCH (runs in extension page — no CORS/HTTP issues) ────

function parseCareerStats(html) {
  const stats = {};
  const li = (label) => {
    const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*)', 'i');
    const m = html.match(re);
    if (!m) return null;
    return m[1].replace(/&nbsp;/g, ' ').trim() || null;
  };
  const liNum = (label) => { const v = li(label); return v ? parseFloat(v) : null; };
  const liPct = (label) => {
    const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*?)([\\d.]+)%', 'i');
    const m = html.match(re);
    return m ? parseFloat(m[2]) : null;
  };
  stats.slpm   = liNum('SLpM');
  stats.strAcc = liPct('Str\\.?\\s*Acc\\.?');
  stats.sapm   = liNum('SApM');
  stats.strDef = liPct('Str\\.?\\s*Def\\.?');
  stats.tdAvg  = liNum('TD\\s*Avg\\.?');
  stats.tdAcc  = liPct('TD\\s*Acc\\.?');
  stats.tdDef  = liPct('TD\\s*Def\\.?');
  stats.subAvg = liNum('Sub\\.?\\s*Avg\\.?');
  const recM = html.match(/Record:\s*([\d]+-[\d]+-[\d]+)/i)
             || html.match(/<span[^>]*>\s*([\d]+-[\d]+-[\d]+)\s*<\/span>/);
  stats.record = recM ? recM[1] : null;
  const htM = html.match(/Height[^<]*<\/i>([^<\n]+)/i);
  stats.height = htM ? htM[1].replace(/&nbsp;/g,' ').trim() : null;
  const stanceM = html.match(/(?:STANCE|Stance)[^<]*<\/i>([^<\n]+)/i);
  stats.stance = stanceM ? stanceM[1].replace(/&nbsp;/g,' ').trim() : null;
  return stats;
}

function parseFightHistoryLinks(html) {
  const fights = [];
  const clean = (s) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    if (row.includes('<th')) continue;
    const fightLinkM = row.match(/href="(http[^"]*fight-details\/[a-f0-9]+)"/i);
    if (!fightLinkM) continue;
    const resultM = row.match(/>\s*(win|loss)\s*</i);
    if (!resultM) continue;
    const wl = resultM[1].toLowerCase();
    const oppLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
    if (oppLinks.length === 0) continue;
    const opponent = oppLinks[oppLinks.length - 1][1].trim();
    if (!opponent || opponent === '--') continue;
    const eventM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
    const event  = eventM ? eventM[1].trim() : '';
    const methodM = row.match(/(KO\/TKO|Submission|U-DEC|S-DEC|M-DEC|DQ|NC)/i);
    let method = 'DEC';
    if (methodM) { const raw = methodM[1].toUpperCase(); method = raw === 'SUBMISSION' ? 'SUB' : raw; }
    const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
    const date  = dateM ? dateM[0] : null;
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    let round = null;
    for (const t of tds) {
      if (t.includes(':')) continue;  // skip time cells like "5:00", "4:18"
      const n = parseInt(t);
      if (!isNaN(n) && n >= 1 && n <= 5 && t.trim().length <= 2) { round = n; break; }
    }
    fights.push({ result: wl, opponent, event, method, round, date, fightUrl: fightLinkM[1] });
  }
  return fights.slice(0, 10);
}

function parseFightDetailStats(html, fighterName, fighterDetailUrl) {
  const clean = (s) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let detailMethod = null;
  let detailRound = null;

  const methodM = html.match(/Method:\s*<\/i>\s*<i[^>]*>\s*([^<]+)/i);
  if (methodM) {
    const raw = methodM[1].trim().toLowerCase();
    if (raw.includes('ko') || raw.includes('tko')) detailMethod = 'KO/TKO';
    else if (raw.includes('sub')) detailMethod = 'SUB';
    else if (raw.includes('unanimous')) detailMethod = 'U-DEC';
    else if (raw.includes('split')) detailMethod = 'S-DEC';
    else if (raw.includes('majority')) detailMethod = 'M-DEC';
    else if (raw.includes('decision')) detailMethod = 'DEC';
    else if (raw.includes('no contest')) detailMethod = 'NC';
    else if (raw.includes('disq')) detailMethod = 'DQ';
  }

  const roundM = html.match(/Round:\s*<\/i>\s*(\d)/i);
  if (roundM) detailRound = parseInt(roundM[1]);

  // Find the Totals table (first table with KD + Ctrl headers)
  let totalsTable = null;
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      totalsTable = tableHtml;
      break;
    }
  }
  if (!totalsTable) return { method: detailMethod, round: detailRound };

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return { method: detailMethod, round: detailRound };

  // KEY INSIGHT: each <td> contains TWO <p> tags — one per fighter (stacked)
  // td[0] has: <p><a href=URL_F1>Fighter1</a></p>  <p><a href=URL_F2>Fighter2</a></p>
  // All other tds have: <p>stat_for_F1</p>  <p>stat_for_F2</p>
  // href uses NO quotes: href=http://www.ufcstats.com/fighter-details/ID
  // So we need to find which <p> index (0 or 1) corresponds to our fighter

  // There is only ONE data row — both fighters are stacked within it
  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });

  if (tds.length === 0) return { method: detailMethod, round: detailRound };

  // Find fighter index (0 or 1) from td[0] which has the fighter name links
  let fIdx = 0; // default to first fighter
  if (fighterDetailUrl) {
    const urlId = fighterDetailUrl.match(/fighter-details\/([a-f0-9]+)/i)?.[1];
    if (urlId) {
      // Check unquoted hrefs: href=http://...fighter-details/ID
      const td0 = tds[0];
      const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
      const hrefMatches = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/([a-f0-9]+)/gi)];
      const ids = hrefMatches.map(m => m[1]);
      const idx = ids.indexOf(urlId);
      if (idx >= 0) fIdx = idx;
    }
  }

  // Fallback: name match in td[0] p tags
  if (fIdx === 0 && tds[0]) {
    const nameParts = fighterName.toLowerCase().split(' ').filter(p => p.length > 2);
    if (tds[0][1] && nameParts.every(p => tds[0][1].toLowerCase().includes(p))) fIdx = 1;
  }

  // Extract stats at fIdx from each column
  // td[0]=names td[1]=KD td[2]=Sig.Str("X of Y") td[3]=Sig% td[4]=Tot.Str td[5]=TD td[6]=TD% td[7]=Sub td[8]=Rev td[9]=Ctrl
  const val = (colIdx) => tds[colIdx]?.[fIdx] || tds[colIdx]?.[0] || '';

  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  const sub    = firstNum(val(7));
  const rev    = firstNum(val(8));
  let ctrlSecs = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);
  return { kd, sigStr, totStr, td, sub, rev, ctrlSecs, method: detailMethod, round: detailRound };
}











// Same as parseFightDetailStats but returns the OPPONENT's stats (fIdx ^ 1)
function parseFightDetailStatsOpponent(html, fighterName, fighterDetailUrl) {
  const clean = (s) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let totalsTable = null;
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      totalsTable = tableHtml;
      break;
    }
  }
  if (!totalsTable) return null;

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return null;

  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });
  if (tds.length === 0) return null;

  // Find which index is OUR fighter, then use the other one
  let fIdx = 0;
  if (fighterDetailUrl) {
    const urlId = fighterDetailUrl.match(/fighter-details\/([a-f0-9]+)/i)?.[1];
    if (urlId) {
      const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
      const hrefMatches = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/([a-f0-9]+)/gi)];
      const ids = hrefMatches.map(m => m[1]);
      const idx = ids.indexOf(urlId);
      if (idx >= 0) fIdx = idx;
    }
  }
  const oppIdx = fIdx === 0 ? 1 : 0;

  // Also extract opponent name from td[0]
  const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
  const nameLinks = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/[a-f0-9]+[^"'\s>]*[>\s]+([^<]+)/gi)];
  const oppName = nameLinks[oppIdx]?.[1]?.trim() || null;

  const val = (colIdx) => tds[colIdx]?.[oppIdx] || tds[colIdx]?.[0] || '';
  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  let ctrlSecs = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);

  return { oppName, kd, sigStr, totStr, td, ctrlSecs };
}

async function fetchFromUFCStats(name) {
  const cacheKey = `ufcstats_v38_${name.toLowerCase().replace(/\s+/g,'_')}`;
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const cached = await new Promise(r => chrome.storage.local.get([cacheKey], r));
    if (cached[cacheKey] && (Date.now() - cached[cacheKey].fetchedAt < 86400000)) {
      debugLog(`Cache hit: ${name}`);
      return cached[cacheKey];
    }
  }
  try {
    // Build a list of (char, firstName, lastName) candidates to try
    // Handles: Jr/Sr suffixes, compound prefixes (De/Van/Von), reversed Asian names
    const SUFFIXES = new Set(['jr','jr.','sr','sr.','ii','iii','iv']);
    const COMPOUND = new Set(['de','van','von','da','dos','del','di','le','la','du','el']);

    function nameCandidates(n) {
      const parts = n.trim().split(/\s+/);
      const clean = SUFFIXES.has(parts[parts.length-1].toLowerCase().replace('.',""))
        ? parts.slice(0,-1) : [...parts];
      const cands = [];
      if (clean.length >= 2) {
        const last = clean[clean.length-1], first = clean[0];
        cands.push({ char: last[0].toLowerCase(), first: first.toLowerCase(), last: last.toLowerCase() });
      }
      // Compound prefix: De Ridder → char='d', last='de ridder'
      if (clean.length >= 3 && COMPOUND.has(clean[clean.length-2].toLowerCase())) {
        const compLast = clean[clean.length-2] + ' ' + clean[clean.length-1];
        cands.push({ char: clean[clean.length-2][0].toLowerCase(), first: clean[0].toLowerCase(), last: compLast.toLowerCase() });
      }
      // Reversed name fallback: trigger when EITHER first OR last name is short (≤3 chars)
      // Short name = likely Asian family name (Su, Li, Wu, Zhang etc)
      // e.g. "Su Mudaerji" → first='Su'(2) is short → try reversed: char='s', last='su'
      const firstLen = clean[0].length;
      const lastLen  = clean[clean.length-1].length;
      if (clean.length === 2 && (firstLen <= 3 || lastLen <= 3)) {
        // Only reverse if it would produce a different candidate than primary
        const revLast  = clean[0].toLowerCase();
        const revFirst = clean[clean.length-1].toLowerCase();
        const revChar  = revLast[0];
        if (revChar !== cands[0]?.char || revLast !== cands[0]?.last) {
          cands.push({ char: revChar, first: revFirst, last: revLast });
        }
      }
      return cands;
    }

    const candidates = nameCandidates(name);
    debugLog(`Searching ${name} — ${candidates.length} candidate(s)`);

    // Cache alpha-listing pages to avoid re-fetching same letter for multiple fighters
    const pageCache = {};
    async function getAlphaPage(char) {
      if (pageCache[char]) return pageCache[char];
      const url = `http://www.ufcstats.com/statistics/fighters?char=${char}&page=all`;
      let res;
      try { res = await fetch(url); } catch(e) { debugLog(`Fetch error [${char}]: ${e.message}`); return ''; }
      if (!res.ok) { debugLog(`HTTP ${res.status} for char=${char}`); return ''; }
      const html = await res.text();
      pageCache[char] = html;
      debugLog(`Loaded [${char.toUpperCase()}] page: ${html.length} chars`);
      return html;
    }

    function findDetailUrl(html, firstLower, lastLower) {
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m;
      // Strict: both first and last name present in row
      while ((m = trRegex.exec(html)) !== null) {
        const row = m[1];
        const link = row.match(/href="(http:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
        if (!link) continue;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim().toLowerCase());
        const rowText = cells.join(' ');
        if (rowText.includes(firstLower) && rowText.includes(lastLower)) {
          return link[1].replace('http://ufcstats.com/','http://www.ufcstats.com/');
        }
      }
      // Loose fallback: exact last name cell match
      const trRegex2 = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m2;
      while ((m2 = trRegex2.exec(html)) !== null) {
        const row = m2[1];
        const link = row.match(/href="(http:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
        if (!link) continue;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim().toLowerCase());
        if (cells.some(t => t === lastLower)) {
          return link[1].replace('http://ufcstats.com/','http://www.ufcstats.com/');
        }
      }
      return null;
    }

    let detailUrl = null;
    for (const cand of candidates) {
      const html = await getAlphaPage(cand.char);
      if (!html) continue;
      detailUrl = findDetailUrl(html, cand.first, cand.last);
      if (detailUrl) {
        debugLog(`Matched: ${name} via [${cand.char.toUpperCase()}] first=${cand.first} last=${cand.last}`);
        break;
      }
    }

    if (!detailUrl) { debugLog(`✗ NOT FOUND: ${name}`); return null; }

    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) { debugLog(`Detail HTTP ${detailRes.status}`); return null; }
    const detailHtml = await detailRes.text();

    // Step 1: get career stats + list of fight-detail URLs from fighter page
    const careerStats = parseCareerStats(detailHtml);
    const fightLinks  = parseFightHistoryLinks(detailHtml);
    debugLog(`✓ ${name}: ${careerStats.record}, ${fightLinks.length} fight links found`);

    // Step 2: fetch each individual fight detail page for per-fight stats
    const fightHistory = [];
    const detailUrlId = detailUrl?.match(/fighter-details\/([a-f0-9]+)/i)?.[1] || 'unknown';
    debugLog(`detailUrl ID: ${detailUrlId}`);
    let firstFightHtmlStored = false;
    for (const fight of fightLinks) {
      try {
        const fRes  = await fetch(fight.fightUrl);
        const fHtml = await fRes.text();
        // Store first fight HTML for debug inspection
        if (!firstFightHtmlStored) {
          const debugKey = `debug_fight_html_${name.toLowerCase().replace(/\s+/g,'_')}`;
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [debugKey]: { html: fHtml.slice(0, 20000), url: fight.fightUrl, opponent: fight.opponent } });
          }
          firstFightHtmlStored = true;
        }
        const stats = parseFightDetailStats(fHtml, name, detailUrl);
        // Also parse opponent stats from the same page (fIdx ^ 1)
        const oppStats = parseFightDetailStatsOpponent(fHtml, name, detailUrl);
        // Use method/round from fight detail page (more reliable) — fall back to profile page values
        const method = stats?.method || fight.method;
        const round  = stats?.round  || fight.round;
        fightHistory.push({ ...fight, ...(stats || {}), method, round, oppStats: oppStats || null, fightUrl: undefined });
        debugLog(`  vs ${fight.opponent}: ${fight.result} kd=${stats?.kd} sig=${stats?.sigStr} tot=${stats?.totStr} td=${stats?.td} ctrl=${stats?.ctrlSecs}s rnd=${round} method=${method} urlMatch=${fHtml.includes(detailUrlId)}`);
      } catch(e) {
        debugLog(`  fight fetch error ${fight.fightUrl}: ${e.message}`);
        fightHistory.push({ ...fight, fightUrl: undefined });
      }
    }

    const result = {
      name, fetchedAt: Date.now(),
      careerStats,
      fightHistory,
      detailUrl,
    };
    const cacheKeyV3 = `ufcstats_v38_${name.toLowerCase().replace(/\s+/g,'_')}`;
    if (typeof chrome !== 'undefined' && chrome.storage) chrome.storage.local.set({ [cacheKeyV3]: result });
    debugLog(`✓ ${name}: stored ${fightHistory.length} fights with stats`);
    return result;
  } catch (e) {
    debugLog(`✗ ERROR ${name}: ${e.name}: ${e.message}`);
    return null;
  }
}

async function fetchFighterStats(name) {
  if (statsCache[name]?.loaded !== undefined) return statsCache[name];
  if (statsCache[name]?._promise) return statsCache[name]._promise;
  const promise = fetchFromUFCStats(name).then(ufcData => {
    const db = buildFighterDB(name, ufcData);
    statsCache[name] = db;
    return db;
  });
  statsCache[name] = { _promise: promise };
  return promise;
}

// ── LEAN ENGINE (now uses real data) ──────────────────────────────────────
// ── STYLE MATCHUP MATRIX ────────────────────────────────────────────────
// Returns score delta for fighter A vs opponent style B
// Positive = A benefits, Negative = A suppressed
function styleMatchupEdge(styleA, styleB, dbA, dbB) {
  const edges = [];
  let delta = 0;

  if (styleA === 'striker' && styleB === 'grappler') {
    // Grappler will drag striker to ground — suppresses striker volume
    // UFC 326 lesson: even 83% TD def can be neutralized by elite grapplers at new weight class
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
    // Grappler vs striker: grappler FP depends on TDs landing
    const oppTDDef = dbB?.tdDef || 50;
    if (oppTDDef > 75) {
      delta -= 1.5;
      edges.push({ icon: 'neg', text: `Opponent has strong TD defense (${oppTDDef}%) — grappler's main scoring route is compromised` });
    } else {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Striker opponent with average TD defense (${oppTDDef}%) — takedowns should be available` });
    }
  } else if (styleA === 'striker' && styleB === 'striker') {
    // Both strikers = high pace, benefits volume-based FP
    delta += 0.5;
    edges.push({ icon: 'pos', text: `Striker vs striker matchup — expect high output and volume, good for FP` });
  } else if (styleA === 'grappler' && styleB === 'grappler') {
    // Grappler vs grappler = neutralized, usually low scoring
    delta -= 1;
    edges.push({ icon: 'neg', text: `Grappler vs grappler — tends toward low-scoring, grinding fight` });
  }

  return { delta, edges };
}

// How well does the opponent suppress opponent FP historically?
// We look at what fighters averaged AGAINST this opponent in their history
function calcOpponentDefenseScore(oppDB, line) {
  if (!oppDB?.loaded || !oppDB.history?.length) return { delta: 0, edges: [] };
  const edges = [];
  let delta = 0;

  // Look at opponent's wins — when opp won, did the loser score low?
  // Use sig strikes absorbed by opponent as proxy for how much they get hit
  // If opponent has low sapm they're hard to hit — suppresses striker FP
  if (oppDB.sapm != null) {
    if (oppDB.sapm < 3.0) {
      delta -= 1;
      edges.push({ icon: 'neg', text: `Opponent absorbs only ${oppDB.sapm.toFixed(1)} sig strikes/min — very defensively sound, limits output` });
    } else if (oppDB.sapm > 5.0) {
      delta += 0.5;
      edges.push({ icon: 'pos', text: `Opponent absorbs ${oppDB.sapm.toFixed(1)} sig strikes/min — tends to be in high-output fights` });
    }
  }

  // Opponent TD defense suppresses grapplers
  if (oppDB.tdDef != null && oppDB.tdDef > 78) {
    delta -= 0.5;
    edges.push({ icon: 'neg', text: `Opponent's TD defense (${oppDB.tdDef}%) will limit takedown scoring opportunities` });
  }

  // If opponent has high finish rate as winner they end fights early — suppresses volume
  if (oppDB.finishRate != null && oppDB.finishRate > 0.70) {
    delta -= 1;
    edges.push({ icon: 'neg', text: `Opponent finishes ${Math.round(oppDB.finishRate*100)}% of fights — early stoppage risk suppresses counting stats` });
  }

  return { delta, edges };
}

// ── MATCHUP PATTERN ENGINE ────────────────────────────────────────────────
// Finds past opponents in fighter's history with similar defensive profile
// to the current opponent, and checks what the fighter scored against them.
// Returns { score, reasons } for FP, SS, and TD pattern edges.
function calcMatchupPatternEdge(db, oppDB, ssLine, tdLine, fpLine) {
  if (!db?.loaded || !oppDB?.loaded || !db.history?.length) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };

  const history = db.history.filter(h => h.sigStr != null);
  if (history.length < 2) return { score: 0, ssScore: 0, tdScore: 0, reasons: [] };

  const reasons = [];
  let score = 0, ssScore = 0, tdScore = 0;

  // ── SIMILARITY DIMENSIONS ─────────────────────────────────────────────
  // For each past fight, we use oppStats to infer the past opponent's
  // defensive quality. We also use statsCache to look up past opponents
  // by name if available.
  const oppStyle  = oppDB.style  || null;
  const oppStance = oppDB.stance || null;
  const oppStrDef = oppDB.strDef || null;  // % striking defense (higher = harder to hit)
  const oppTdDef  = oppDB.tdDef  || null;  // % TD defense

  // ── 1. STYLE-MATCHED FIGHTS ───────────────────────────────────────────
  // Look up past opponents in statsCache to get their style/stance
  if (oppStyle) {
    const styleMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && pastOppDB.style === oppStyle;
    });

    if (styleMatches.length >= 2) {
      const avgSS_vsStyle = styleMatches.filter(h => h.sigStr != null).reduce((s,h) => s + h.sigStr, 0) / styleMatches.length;
      const avgTD_vsStyle = styleMatches.filter(h => h.td != null).reduce((s,h) => s + h.td, 0) / styleMatches.length;
      const avgFP_vsStyle = styleMatches.filter(h => h.fp != null).reduce((s,h) => s + h.fp, 0) / styleMatches.length;

      const label = `vs ${oppStyle}s (${styleMatches.length} fights)`;

      if (ssLine) {
        const ssDiff = avgSS_vsStyle - ssLine;
        const ssHits = styleMatches.filter(h => h.sigStr > ssLine).length;
        if (ssDiff > 10) {
          ssScore += 1.5;
          reasons.push({ icon:'pos', text:`Avg ${avgSS_vsStyle.toFixed(0)} SS ${label} — ${ssHits}/${styleMatches.length} over SS line ${ssLine}` });
        } else if (ssDiff > 3) {
          ssScore += 0.8;
          reasons.push({ icon:'pos', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — slightly edges line ${ssLine}` });
        } else if (ssDiff < -10) {
          ssScore -= 1.5;
          reasons.push({ icon:'neg', text:`Only ${avgSS_vsStyle.toFixed(0)} avg SS ${label} — struggles to hit SS line ${ssLine} vs this style` });
        } else if (ssDiff < -3) {
          ssScore -= 0.8;
          reasons.push({ icon:'neg', text:`${avgSS_vsStyle.toFixed(0)} avg SS ${label} — below SS line ${ssLine}` });
        }
      }

      if (tdLine) {
        const tdDiff = avgTD_vsStyle - tdLine;
        const tdHits = styleMatches.filter(h => (h.td||0) > tdLine).length;
        if (tdDiff > 1.5) {
          tdScore += 1.5;
          reasons.push({ icon:'pos', text:`Avg ${avgTD_vsStyle.toFixed(1)} TDs ${label} — ${tdHits}/${styleMatches.length} over TD line ${tdLine}` });
        } else if (tdDiff > 0.5) {
          tdScore += 0.8;
          reasons.push({ icon:'pos', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — edges TD line ${tdLine}` });
        } else if (tdDiff < -1.5) {
          tdScore -= 1.5;
          reasons.push({ icon:'neg', text:`Only ${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — misses TD line ${tdLine} vs this style` });
        } else if (tdDiff < -0.5) {
          tdScore -= 0.8;
          reasons.push({ icon:'neg', text:`${avgTD_vsStyle.toFixed(1)} avg TDs ${label} — below TD line ${tdLine}` });
        }
      }

      if (fpLine) {
        const fpDiff = avgFP_vsStyle - fpLine;
        if (fpDiff > 8) { score += 1; reasons.push({ icon:'pos', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — ${styleMatches.filter(h=>h.fp>fpLine).length}/${styleMatches.length} over FP line` }); }
        else if (fpDiff < -8) { score -= 1; reasons.push({ icon:'neg', text:`Avg ${avgFP_vsStyle.toFixed(1)} FP ${label} — below FP line historically` }); }
      }
    }
  }

  // ── 2. STANCE-MATCHED FIGHTS ──────────────────────────────────────────
  if (oppStance) {
    const stanceMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      return pastOppDB?.loaded && (pastOppDB.stance || '').toLowerCase() === oppStance.toLowerCase();
    });

    if (stanceMatches.length >= 2) {
      const avgSS_vsStance = stanceMatches.filter(h => h.sigStr != null).reduce((s,h) => s + h.sigStr, 0) / stanceMatches.length;
      const avgTD_vsStance = stanceMatches.filter(h => h.td != null).reduce((s,h) => s + h.td, 0) / stanceMatches.length;
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

  // ── 3. STRIKING DEFENSE TIER MATCHING ────────────────────────────────
  // Classify opponent strDef into tiers, find fights vs same tier
  if (oppStrDef != null) {
    // Tier: elite (>65%), good (55-65%), average (45-55%), poor (<45%)
    const getStrDefTier = (d) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
    const oppTier = getStrDefTier(oppStrDef);

    const tierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.strDef == null) return false;
      return getStrDefTier(pastOppDB.strDef) === oppTier;
    });

    if (tierMatches.length >= 2) {
      const avgSS_tier = tierMatches.filter(h => h.sigStr != null).reduce((s,h) => s + h.sigStr, 0) / tierMatches.length;
      const ssHits = ssLine ? tierMatches.filter(h => h.sigStr > ssLine).length : 0;
      const tierLabel = `vs ${oppTier} strikedef opponents (${oppStrDef}% tier, ${tierMatches.length} fights)`;

      if (ssLine) {
        const ssDiff = avgSS_tier - ssLine;
        if (ssDiff > 10) {
          ssScore += 1.5;
          reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — ${ssHits}/${tierMatches.length} clears line` });
        } else if (ssDiff > 4) {
          ssScore += 0.8;
          reasons.push({ icon:'pos', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel}` });
        } else if (ssDiff < -10) {
          ssScore -= 1.5;
          reasons.push({ icon:'neg', text:`Only ${avgSS_tier.toFixed(0)} SS ${tierLabel} — elite defense suppresses output` });
        } else if (ssDiff < -4) {
          ssScore -= 0.8;
          reasons.push({ icon:'neg', text:`${avgSS_tier.toFixed(0)} avg SS ${tierLabel} — struggles vs this defense tier` });
        }
      }
    } else if (oppStrDef > 60 && ssLine) {
      // Even without tier matches, flag elite defense directly
      ssScore -= 0.5;
      reasons.push({ icon:'neg', text:`Opponent has elite striking defense (${oppStrDef}%) — expect suppressed SS output` });
    } else if (oppStrDef < 45 && ssLine) {
      ssScore += 0.5;
      reasons.push({ icon:'pos', text:`Opponent has poor striking defense (${oppStrDef}%) — easier to land, boosts SS ceiling` });
    }
  }

  // ── 4. TAKEDOWN DEFENSE TIER MATCHING ────────────────────────────────
  if (oppTdDef != null) {
    const getTdDefTier = (d) => d > 80 ? 'elite' : d > 65 ? 'good' : d > 50 ? 'average' : 'poor';
    const oppTdTier = getTdDefTier(oppTdDef);

    const tdTierMatches = history.filter(h => {
      const pastOppDB = statsCache[h.opp];
      if (!pastOppDB?.loaded || pastOppDB.tdDef == null) return false;
      return getTdDefTier(pastOppDB.tdDef) === oppTdTier;
    });

    if (tdTierMatches.length >= 2) {
      const avgTD_tier = tdTierMatches.filter(h => h.td != null).reduce((s,h) => s + h.td, 0) / tdTierMatches.length;
      const tdHits = tdLine ? tdTierMatches.filter(h => (h.td||0) > tdLine).length : 0;
      const tierLabel = `vs ${oppTdTier} tddef opponents (${oppTdDef}% tier, ${tdTierMatches.length} fights)`;

      if (tdLine) {
        const tdDiff = avgTD_tier - tdLine;
        if (tdDiff > 1.5) {
          tdScore += 1.5;
          reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — ${tdHits}/${tdTierMatches.length} clears line` });
        } else if (tdDiff > 0.5) {
          tdScore += 0.8;
          reasons.push({ icon:'pos', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` });
        } else if (tdDiff < -1.5) {
          tdScore -= 1.5;
          reasons.push({ icon:'neg', text:`Only ${avgTD_tier.toFixed(1)} avg TDs ${tierLabel} — wall keeps them out` });
        } else if (tdDiff < -0.5) {
          tdScore -= 0.8;
          reasons.push({ icon:'neg', text:`${avgTD_tier.toFixed(1)} avg TDs ${tierLabel}` });
        }
      }
    } else if (oppTdDef > 78 && tdLine) {
      tdScore -= 0.8;
      reasons.push({ icon:'neg', text:`Opponent has elite TD defense (${oppTdDef}%) — historical pattern suggests under on TDs` });
    } else if (oppTdDef < 50 && tdLine) {
      tdScore += 0.8;
      reasons.push({ icon:'pos', text:`Opponent has poor TD defense (${oppTdDef}%) — prime target for takedowns` });
    }
  }

  // ── 5. COMBINED PROFILE MATCH (style + strDef tier both match) ────────
  if (oppStyle && oppStrDef != null) {
    const getStrDefTier = (d) => d > 65 ? 'elite' : d > 55 ? 'good' : d > 45 ? 'average' : 'poor';
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
        const rate = comboMatches.filter(h=>h.sigStr>ssLine).length;
        if (Math.abs(diff) > 6) {
          const icon = diff > 0 ? 'pos' : 'neg';
          ssScore += diff > 0 ? 1.5 : -1.5;
          reasons.push({ icon, text:`🎯 Strong pattern: ${avgSS.toFixed(0)} avg SS ${lbl} — ${rate}/${comboMatches.length} clears line` });
        }
      }
      if (tdLine) {
        const diff = avgTD - tdLine;
        const rate = comboMatches.filter(h=>(h.td||0)>tdLine).length;
        if (Math.abs(diff) > 0.8) {
          const icon = diff > 0 ? 'pos' : 'neg';
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


function calcLean(name, db, line_p6, line_ud, line_pp, oppDB) {
  // Support old 5-arg call signature where oppDB was passed as 5th arg (no pp line)
  if (line_pp && typeof line_pp === 'object' && !oppDB) { oppDB = line_pp; line_pp = null; }
  const line = line_p6 || line_ud || line_pp;
  if (!line || !db || !db.loaded) return { lean: 'none', conf: 0, reasons: [], verdict: 'Loading stats...' };

  const fpKey = line_p6 ? 'fp_p6' : line_ud ? 'fp_ud' : 'fp_pp';
  const avgFP = line_p6 ? db.avgFP_p6 : (db.avgFP_ud ?? db.avgFP_p6); // PP uses same scoring
  const history = db.history || [];
  const reasons = [];
  let score = 0;

  // ── 1. FIGHTER'S OWN HISTORICAL AVG VS LINE ──────────────────────────
  if (avgFP != null) {
    const diff = avgFP - line;
    if (diff > 12)      { score += 2.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${diff.toFixed(1)} pts above the line — strong over value` }); }
    else if (diff > 5)  { score += 1.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${diff.toFixed(1)} pts above the line` }); }
    else if (diff > 1)  { score += 0.5; reasons.push({ icon: 'pos', text: `Historical avg (${avgFP.toFixed(1)} FP) slightly edges the line` }); }
    else if (diff < -12){ score -= 2.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) is ${Math.abs(diff).toFixed(1)} pts BELOW the line — line may be set too high` }); }
    else if (diff < -5) { score -= 1.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) trails the line by ${Math.abs(diff).toFixed(1)} pts` }); }
    else if (diff < -1) { score -= 0.5; reasons.push({ icon: 'neg', text: `Historical avg (${avgFP.toFixed(1)} FP) slightly below the line` }); }
    else                { reasons.push({ icon: 'neu', text: `Historical avg (${avgFP.toFixed(1)} FP) is essentially at the line — genuine toss-up` }); }
  } else {
    reasons.push({ icon: 'neu', text: `No historical FP data available — line analysis based on career stats only` });
  }

  // ── 2. HIT RATE ON THIS SPECIFIC LINE ────────────────────────────────
  if (history.length >= 3) {
    const hits = history.filter(h => h[fpKey] != null && h[fpKey] > line).length;
    const rate = hits / history.length;
    if (rate >= 0.75)      { score += 2;   reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) went over this exact line` }); }
    else if (rate >= 0.6)  { score += 1;   reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights over — consistent over tendency` }); }
    else if (rate <= 0.25) { score -= 2;   reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared this line — line is hard to hit` }); }
    else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} fights over — under tendency at this line` }); }
    else                   {               reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} fights over — nearly 50/50` }); }
  }

  // ── 3. RECENT FORM (last 3 fights trend) ─────────────────────────────
  if (history.length >= 3 && avgFP != null) {
    const recent = history.slice(0, 3);
    const recentAvg = recent.reduce((s,h) => s + (h[fpKey] || 0), 0) / recent.length;
    const trend = recentAvg - avgFP;
    if (trend > 8)       { score += 1;   reasons.push({ icon: 'pos', text: `Recent form trending UP — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` }); }
    else if (trend < -8) { score -= 1;   reasons.push({ icon: 'neg', text: `Recent form trending DOWN — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` }); }
  }

  // ── 4. FIGHTER STYLE ─────────────────────────────────────────────────
  if (db.style === 'striker') {
    if (db.slpm > 6)      { score += 1;   reasons.push({ icon: 'pos', text: `Elite volume striker (${db.slpm.toFixed(1)} SLpM) — naturally high FP ceiling` }); }
    else if (db.slpm > 4) { score += 0.3; reasons.push({ icon: 'pos', text: `Active striker (${db.slpm.toFixed(1)} SLpM)` }); }
  } else if (db.style === 'grappler') {
    if (db.avgTD > 3)     { score += 0.5; reasons.push({ icon: 'pos', text: `High-volume grappler (${db.avgTD.toFixed(1)} TD/15min) — TD scoring keeps floor high` }); }
    else                  { score -= 0.5; reasons.push({ icon: 'neg', text: `Grappler style — FP ceiling limited by finishing tendency and low strike volume` }); }
  }

  // ── 5. FINISH RISK (self) ────────────────────────────────────────────
  // UFC 326 lesson: Dober (11 KOs) and Rodrigues (R1 KO finisher) both killed their own over leans
  // High finishers end fights early, cutting off counting stats for BOTH fighters
  if (db.finishRate != null) {
    if (db.finishRate > 0.80) {
      score -= 1.5;
      reasons.push({ icon: 'neg', text: `Very high finish rate (${Math.round(db.finishRate*100)}%) — frequent early stoppages severely limit counting stats` });
    } else if (db.finishRate > 0.65) {
      score -= 1;
      reasons.push({ icon: 'neg', text: `High finish rate (${Math.round(db.finishRate*100)}%) as winner — early stoppages rob counting stats` });
    } else if (db.finishRate < 0.35 && history.length >= 4) {
      score += 0.5;
      reasons.push({ icon: 'pos', text: `Decision fighter (${Math.round((1-db.finishRate)*100)}% decisions) — fights go full rounds, maximizing volume` });
    }
  }

  // ── 6. OPPONENT MATCHUP (only when opponent data is available) ────────
  if (oppDB && oppDB.loaded) {
    // Opponent defense suppression
    const { delta: defDelta, edges: defEdges } = calcOpponentDefenseScore(oppDB, line);
    score += defDelta;
    reasons.push(...defEdges);

    // Style matchup
    const { delta: matchupDelta, edges: matchupEdges } = styleMatchupEdge(db.style, oppDB.style, db, oppDB);
    score += matchupDelta;
    reasons.push(...matchupEdges);

    // ── NEW: Matchup pattern analysis ──────────────────────────────────
    const { score: patScore, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, null, line);
    score += patScore;
    reasons.push(...patReasons);
  } else if (oppDB && !oppDB.loaded) {
    // Opponent found but stats still loading — note it but don't block lean
    reasons.push({ icon: 'neu', text: `Opponent stats loading — matchup analysis will update shortly` });
  }
  // If oppDB is null: opponent not identified/not on the slate — just skip silently

  // ── 7. STRIKING ACCURACY ─────────────────────────────────────────────
  if (db.strAcc != null) {
    if (db.strAcc > 52)      reasons.push({ icon: 'pos', text: `High striking accuracy (${db.strAcc}%) — efficient volume, good FP conversion` });
    else if (db.strAcc < 36) { score -= 0.3; reasons.push({ icon: 'neg', text: `Low striking accuracy (${db.strAcc}%) — volume doesn't always translate to landed strikes` }); }
  }

  // ── 8. FLOOR / CEILING VS LINE ─────────────────────────────────────────
  if (db.fpFloor != null && db.fpCeiling != null && line != null) {
    if (db.fpFloor > line) {
      score += 1.5;
      reasons.push({ icon: 'pos', text: `Elite floor: worst recorded game (${db.fpFloor.toFixed(1)} FP) still clears the line — low downside risk` });
    } else if (db.fpCeiling < line) {
      score -= 1.5;
      reasons.push({ icon: 'neg', text: `Hard ceiling: best recorded game (${db.fpCeiling.toFixed(1)} FP) misses the line — very hard to hit over` });
    } else if (db.fpFloor > line * 0.88 && history.length >= 4) {
      score += 0.5;
      reasons.push({ icon: 'pos', text: `Strong floor (${db.fpFloor.toFixed(1)} FP at ${Math.round((db.fpFloor/line)*100)}% of line) — rarely undershoots badly` });
    }
  }

  // ── 9. CONSISTENCY MODIFIER ─────────────────────────────────────────────
  if (db.fpConsistency != null && history.length >= 4) {
    if (db.fpConsistency >= 75) {
      score += 0.5;
      reasons.push({ icon: 'pos', text: `High consistency (${db.fpConsistency}%) — FP is predictable and reliable, boosts lean confidence` });
    } else if (db.fpConsistency <= 35) {
      score -= 0.5;
      reasons.push({ icon: 'neg', text: `Volatile fighter (${db.fpConsistency}% consistency) — high variance, line could go either way` });
    }
  }

  // ── 10. STREAK MODIFIER ──────────────────────────────────────────────────
  if (db.streak?.type === 'hot') {
    score += 0.5;
    reasons.push({ icon: 'pos', text: `🔥 Hot streak: ${db.streak.text}` });
  } else if (db.streak?.type === 'cold') {
    score -= 0.5;
    reasons.push({ icon: 'neg', text: `❄️ Cold streak: ${db.streak.text}` });
  }

  // ── 11. RECENCY DRIFT ────────────────────────────────────────────────────
  if (db.avgFP_weighted != null && avgFP != null) {
    const drift = db.avgFP_weighted - avgFP;
    if (drift > 10) {
      score += 0.5;
      reasons.push({ icon: 'pos', text: `Rising form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) outpacing career avg (${avgFP.toFixed(1)}) by ${drift.toFixed(1)} pts` });
    } else if (drift < -10) {
      score -= 0.5;
      reasons.push({ icon: 'neg', text: `Fading form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) lagging career avg (${avgFP.toFixed(1)}) by ${Math.abs(drift).toFixed(1)} pts` });
    }
  }

  // ── 12. FIVE-ROUND EXPERIENCE ────────────────────────────────────────────
  if (db.fiveRoundRate > 0.3 && db.avgFP_perRound && line) {
    const projFiveRound = db.avgFP_perRound * 5;
    if (projFiveRound > line * 1.1) {
      score += 0.3;
      reasons.push({ icon: 'pos', text: `${Math.round(db.fiveRoundRate*100)}% of fights go 4-5 rounds — FP ceiling expands significantly in long fights (proj ${projFiveRound.toFixed(1)} over 5R)` });
    }
  }

  // ── FINAL SCORE → LEAN ───────────────────────────────────────────────
  let lean, conf;
  if      (score >= 3)    { lean = 'over';  conf = Math.min(90, 68 + score * 4); }
  else if (score >= 1.5)  { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5)  { lean = 'over';  conf = 54; }
  else if (score <= -3)   { lean = 'under'; conf = Math.min(90, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5) { lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5) { lean = 'under'; conf = 54; }
  else                    { lean = 'push';  conf = 50; }

  // Cap confidence for highly volatile fighters — high variance = less reliable prediction
  if (db.fpConsistency != null && db.fpConsistency < 40 && lean !== 'push') {
    conf = Math.min(conf, 65);
  }
  // Boost confidence for very consistent fighters when score is strong
  if (db.fpConsistency != null && db.fpConsistency >= 80 && Math.abs(score) >= 2) {
    conf = Math.min(90, conf + 5);
  }

  const lineStr = line_p6 ? `P6 ${line_p6}` : `UD ${line_ud}`;
  const avgStr  = avgFP != null ? ` (avg ${avgFP.toFixed(1)})` : '';
  const verdict = lean === 'over'
    ? `LEAN OVER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'over value identified'}`
    : lean === 'under'
    ? `LEAN UNDER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'under value identified'}`
    : `NO STRONG LEAN at ${lineStr}${avgStr} — line appears fairly set`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict };
}

// ── SS LEAN (Significant Strikes) ────────────────────────────────────────
function calcSSLean(name, db, line_ss, oppDB) {
  if (!line_ss || !db || !db.loaded) return null;
  const history = (db.history || []).filter(h => h.sigStr != null);
  if (history.length < 3) return null;

  const avgSS = history.reduce((s,h) => s + h.sigStr, 0) / history.length;
  const reasons = [];
  let score = 0;

  // 1. Avg vs line
  const diff = avgSS - line_ss;
  if      (diff > 20)  { score += 2.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) is ${diff.toFixed(1)} above line — strong over value` }); }
  else if (diff > 8)   { score += 1.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) edges the line by ${diff.toFixed(1)}` }); }
  else if (diff > 3)   { score += 0.5; reasons.push({ icon:'pos', text:`Avg SS (${avgSS.toFixed(1)}) slightly above line` }); }
  else if (diff < -20) { score -= 2.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` }); }
  else if (diff < -8)  { score -= 1.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) trails line by ${Math.abs(diff).toFixed(1)}` }); }
  else if (diff < -3)  { score -= 0.5; reasons.push({ icon:'neg', text:`Avg SS (${avgSS.toFixed(1)}) slightly below line` }); }
  else                 {               reasons.push({ icon:'neu', text:`Avg SS (${avgSS.toFixed(1)}) near line — toss-up` }); }

  // 2. Hit rate
  const hits = history.filter(h => h.sigStr > line_ss).length;
  const rate = hits / history.length;
  if      (rate >= 0.75) { score += 2;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) went over SS line` }); }
  else if (rate >= 0.6)  { score += 1;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights over SS line` }); }
  else if (rate <= 0.25) { score -= 2;   reasons.push({ icon:'neg', text:`Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared SS line` }); }
  else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon:'neg', text:`Hit rate: ${hits}/${history.length} fights over SS line — under tendency` }); }
  else                   {               reasons.push({ icon:'neu', text:`Hit rate: ${hits}/${history.length} fights over SS line — near 50/50` }); }

  // 3. Recent form
  if (history.length >= 3) {
    const recentAvg = history.slice(0,3).reduce((s,h) => s + h.sigStr, 0) / 3;
    const trend = recentAvg - avgSS;
    if      (trend > 15) { score += 1;   reasons.push({ icon:'pos', text:`Recent form UP — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` }); }
    else if (trend < -15){ score -= 1;   reasons.push({ icon:'neg', text:`Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` }); }
  }

  // 4. Style bonus
  if (db.style === 'striker') { score += 0.5; reasons.push({ icon:'pos', text:`Striker style — naturally high SS volume` }); }
  else if (db.style === 'grappler') { score -= 0.5; reasons.push({ icon:'neg', text:`Grappler style — may rely on TDs more than striking` }); }

  // 5. Opponent SS defense (use opponent strAcc as proxy)
  if (db.strAcc > 52) { score += 0.3; reasons.push({ icon:'pos', text:`High accuracy (${db.strAcc}%) — lands efficiently, SS count reliable` }); }

  // 6. Matchup pattern: performance vs similar opponents
  if (oppDB?.loaded) {
    const { ssScore: patSS, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, line_ss, null, null);
    score += patSS;
    reasons.push(...patReasons);
  }

  let lean, conf;
  if      (score >= 3)   { lean = 'over';  conf = Math.min(90, 68 + score * 4); }
  else if (score >= 1.5) { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5) { lean = 'over';  conf = 54; }
  else if (score <= -3)  { lean = 'under'; conf = Math.min(90, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5){ lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5){ lean = 'under'; conf = 54; }
  else                   { lean = 'push';  conf = 50; }

  const verdict = lean === 'over'
    ? `SS OVER ${line_ss} (avg ${avgSS.toFixed(1)}) — ${reasons[0]?.text}`
    : lean === 'under'
    ? `SS UNDER ${line_ss} (avg ${avgSS.toFixed(1)}) — ${reasons[0]?.text}`
    : `SS NO LEAN at ${line_ss} (avg ${avgSS.toFixed(1)})`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict, avg: avgSS, line: line_ss, type: 'ss' };
}

// ── TD LEAN (Takedowns) ───────────────────────────────────────────────────
function calcTDLean(name, db, line_td, oppDB) {
  if (!line_td || !db || !db.loaded) return null;
  const history = (db.history || []).filter(h => h.td != null);
  if (history.length < 3) return null;

  const avgTD = history.reduce((s,h) => s + h.td, 0) / history.length;
  const reasons = [];
  let score = 0;

  // 1. Avg vs line
  const diff = avgTD - line_td;
  if      (diff > 3)   { score += 2.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) is ${diff.toFixed(1)} above line — strong over value` }); }
  else if (diff > 1.5) { score += 1.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) edges line by ${diff.toFixed(1)}` }); }
  else if (diff > 0.5) { score += 0.5; reasons.push({ icon:'pos', text:`Avg TDs (${avgTD.toFixed(1)}) slightly above line` }); }
  else if (diff < -3)  { score -= 2.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` }); }
  else if (diff < -1.5){ score -= 1.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) trails line by ${Math.abs(diff).toFixed(1)}` }); }
  else if (diff < -0.5){ score -= 0.5; reasons.push({ icon:'neg', text:`Avg TDs (${avgTD.toFixed(1)}) slightly below line` }); }
  else                 {               reasons.push({ icon:'neu', text:`Avg TDs (${avgTD.toFixed(1)}) near line — toss-up` }); }

  // 2. Hit rate
  const hits = history.filter(h => h.td > line_td).length;
  const rate = hits / history.length;
  if      (rate >= 0.75) { score += 2;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights (${Math.round(rate*100)}%) exceeded TD line` }); }
  else if (rate >= 0.6)  { score += 1;   reasons.push({ icon:'pos', text:`Hit rate: ${hits}/${history.length} fights over TD line` }); }
  else if (rate <= 0.25) { score -= 2;   reasons.push({ icon:'neg', text:`Hit rate: only ${hits}/${history.length} fights (${Math.round(rate*100)}%) cleared TD line` }); }
  else if (rate <= 0.4)  { score -= 1;   reasons.push({ icon:'neg', text:`Hit rate: ${hits}/${history.length} fights over TD line — under tendency` }); }
  else                   {               reasons.push({ icon:'neu', text:`Hit rate: ${hits}/${history.length} fights over TD line — near 50/50` }); }

  // 3. Recent form
  if (history.length >= 3) {
    const recentAvg = history.slice(0,3).reduce((s,h) => s + h.td, 0) / 3;
    const trend = recentAvg - avgTD;
    if      (trend > 2)  { score += 1;   reasons.push({ icon:'pos', text:`Recent form UP — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` }); }
    else if (trend < -2) { score -= 1;   reasons.push({ icon:'neg', text:`Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` }); }
  }

  // 4. Style
  if (db.style === 'grappler') { score += 1; reasons.push({ icon:'pos', text:`Grappler style — TDs are primary weapon` }); }
  else if (db.style === 'striker') { score -= 0.5; reasons.push({ icon:'neg', text:`Striker style — TDs not primary weapon` }); }

  // 5. Opponent TD defense
  if (db.tdDef > 75) { score -= 0.5; reasons.push({ icon:'neg', text:`Opponent has strong TD defense — may limit attempts` }); }
  else if (db.tdDef < 50) { score += 0.5; reasons.push({ icon:'pos', text:`Opponent has weak TD defense — good target for takedowns` }); }

  // 6. Matchup pattern: performance vs similar opponents
  if (oppDB?.loaded) {
    const { tdScore: patTD, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, line_td, null);
    score += patTD;
    reasons.push(...patReasons);
  }
  let lean, conf;
  if      (score >= 3)   { lean = 'over';  conf = Math.min(90, 68 + score * 4); }
  else if (score >= 1.5) { lean = 'over';  conf = Math.min(74, 56 + score * 5); }
  else if (score >= 0.5) { lean = 'over';  conf = 54; }
  else if (score <= -3)  { lean = 'under'; conf = Math.min(90, 68 + Math.abs(score) * 4); }
  else if (score <= -1.5){ lean = 'under'; conf = Math.min(74, 56 + Math.abs(score) * 5); }
  else if (score <= -0.5){ lean = 'under'; conf = 54; }
  else                   { lean = 'push';  conf = 50; }

  const verdict = lean === 'over'
    ? `TD OVER ${line_td} (avg ${avgTD.toFixed(1)}) — ${reasons[0]?.text}`
    : lean === 'under'
    ? `TD UNDER ${line_td} (avg ${avgTD.toFixed(1)}) — ${reasons[0]?.text}`
    : `TD NO LEAN at ${line_td} (avg ${avgTD.toFixed(1)})`;

  return { lean, conf: Math.round(conf), score: parseFloat(score.toFixed(2)), reasons, verdict, avg: avgTD, line: line_td, type: 'td' };
}



// ── RENDER ────────────────────────────────────────────────────────────────
let currentView = 'all';
let currentPlatform = 'pick6'; // 'pick6' or 'underdog'
let allFighters = [];
let currentSearch = '';
let currentSort   = 'default'; // 'default'|'line'|'conf'|'avgfp'|'floor'|'ceil'|'consistency'

function activePlatformLine(f) {
  // Prefer FP line, then SS, then TD within the selected platform.
  const pick6 = f.line_p6 ?? f.line_fp ?? null;
  const pick6_ss = f.line_p6_ss ?? f.line_ss ?? null;
  const pick6_td = f.line_p6_td ?? f.line_td ?? null;

  const ud = f.line_ud ?? null;
  const ud_ss = f.line_ud_ss ?? null;
  const ud_td = f.line_ud_td ?? null;

  const betr = f.line_betr ?? null;
  const betr_ss = f.line_betr_ss ?? null;
  const betr_td = f.line_betr_td ?? null;

  const pp = f.line_pp ?? null;
  const pp_ss = f.line_pp_ss ?? null;
  const pp_td = f.line_pp_td ?? null;

  const pick6Value = pick6 ?? pick6_ss ?? pick6_td;
  const udValue    = ud    ?? ud_ss    ?? ud_td;
  const betrValue  = betr  ?? betr_ss  ?? betr_td;
  const ppValue    = pp    ?? pp_ss    ?? pp_td;
  if (currentPlatform === 'pick6')      return pick6Value ?? udValue ?? ppValue ?? betrValue ?? null;
  if (currentPlatform === 'underdog')   return udValue ?? pick6Value ?? ppValue ?? betrValue ?? null;
  if (currentPlatform === 'prizepicks') return ppValue ?? udValue ?? pick6Value ?? betrValue ?? null;
  return betrValue ?? ppValue ?? pick6Value ?? udValue ?? null;
}

function activePlatformLabel(f) {
  if (currentPlatform === 'pick6'       && f.line_p6)  return `Pick6 ${f.line_p6}`;
  if (currentPlatform === 'underdog'    && f.line_ud)  return `Underdog ${f.line_ud}`;
  if (currentPlatform === 'prizepicks'  && f.line_pp)  return `PrizePicks ${f.line_pp}`;
  if (f.line_betr)  return `Betr ${f.line_betr}`;
  if (f.line_pp)    return `PrizePicks ${f.line_pp}`;
  if (f.line_p6)    return `Pick6 ${f.line_p6}`;
  if (f.line_ud)    return `Underdog ${f.line_ud}`;
  return '—';
}

function ensureLineLeans() {
  // No-op: we don't fake leans based on line rank.
  // Fighters show "⏳ Loading" until real stats come back from UFCStats.
  // This avoids misleading rank-based pseudo-leans that have no statistical basis.
}

// Priority: FP lean → SS lean → TD lean
// Returns lean object augmented with _source ('fp'|'ss'|'td') and _label for badge display
function getEffectiveLean(f) {
  if (f.lean?.lean && f.lean.lean !== 'none') return { ...f.lean, _source: 'fp', _label: '' };
  if (f.lean_ss?.lean && f.lean_ss.lean !== 'none' && f.lean_ss.lean !== 'push')
    return { ...f.lean_ss, _source: 'ss', _label: ' (SS)' };
  if (f.lean_td?.lean && f.lean_td.lean !== 'none' && f.lean_td.lean !== 'push')
    return { ...f.lean_td, _source: 'td', _label: ' (TD)' };
  return f.lean || { lean: 'none', conf: 0, reasons: [], verdict: '', _source: 'fp', _label: '' };
}

function sortFighters(fighters, sortKey) {
  const copy = [...fighters];
  switch (sortKey) {
    case 'line':        return copy.sort((a, b) => (activePlatformLine(b) || 0) - (activePlatformLine(a) || 0));
    case 'conf':        return copy.sort((a, b) => (getEffectiveLean(b).conf || 0) - (getEffectiveLean(a).conf || 0));
    case 'avgfp':       return copy.sort((a, b) => (b.db?.avgFP_p6 || 0) - (a.db?.avgFP_p6 || 0));
    case 'floor':       return copy.sort((a, b) => (b.db?.fpFloor || 0) - (a.db?.fpFloor || 0));
    case 'ceil':        return copy.sort((a, b) => (b.db?.fpCeiling || 0) - (a.db?.fpCeiling || 0));
    case 'consistency': return copy.sort((a, b) => (b.db?.fpConsistency || 0) - (a.db?.fpConsistency || 0));
    default: return copy;
  }
}

function renderBestPicks(container) {
  if (!allFighters.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-family:\'JetBrains Mono\',monospace;font-size:12px;">No fighter data loaded yet</div>';
    return;
  }

  ensureLineLeans();

  const overs  = allFighters.filter(f => getEffectiveLean(f).lean === 'over')
    .sort((a,b) => (getEffectiveLean(b).conf||0) - (getEffectiveLean(a).conf||0)).slice(0, 8);
  const unders = allFighters.filter(f => getEffectiveLean(f).lean === 'under')
    .sort((a,b) => (getEffectiveLean(b).conf||0) - (getEffectiveLean(a).conf||0)).slice(0, 8);

  function buildSection(fighters, type) {
    if (!fighters.length) return '';
    const headerClass = type === 'over' ? 'takes' : 'avoids';
    const title = type === 'over' ? '⚡ Best Overs' : '⚡ Best Unders';
    const typeColor = type === 'over' ? 'var(--green)' : 'var(--red)';
    const rows = fighters.map((f, i) => {
      const el = getEffectiveLean(f);
      const line = activePlatformLine(f);
      const reason = el.verdict || el.reasons?.[0]?.text || '—';
      const srcTag = el._source !== 'fp' ? ` <span style="opacity:0.6;font-size:10px">(${el._source?.toUpperCase()} line)</span>` : '';
      return `<div class="best-pick-row">
        <div class="best-pick-rank">#${i+1}</div>
        <div>
          <div class="best-pick-name">${f.name}${srcTag}</div>
          <div class="best-pick-reason">${reason}</div>
        </div>
        <div class="best-pick-meta">
          <span class="best-pick-type" style="color:${typeColor}">${type.toUpperCase()}${el._label||''}</span>
          <span class="best-pick-platform">${activePlatformLabel(f)}</span>
        </div>
        <div class="best-pick-line">${line || '—'}</div>
      </div>`;
    }).join('');
    return `<div class="best-picks-section"><div class="best-picks-header ${headerClass}">${title}</div>${rows}</div>`;
  }

  const html = buildSection(overs, 'over') + buildSection(unders, 'under');
  container.innerHTML = html || '<div style="text-align:center;padding:40px;color:var(--text3);font-family:\'JetBrains Mono\',monospace;font-size:12px;">No leans calculated yet — wait for UFCStats to finish loading</div>';
}

function renderFighters() {
  const container = document.getElementById('cardContainer');
  container.innerHTML = '';
  if (currentView === 'bestpicks') { renderBestPicks(container); return; }

  ensureLineLeans();

  let fighters = allFighters;

  // Search filter
  if (currentSearch.trim()) {
    const q = currentSearch.toLowerCase().trim();
    fighters = fighters.filter(f => f.name.toLowerCase().includes(q));
  }

  // View filter
  if (currentView === 'over')  fighters = fighters.filter(f => getEffectiveLean(f).lean === 'over');
  if (currentView === 'under') fighters = fighters.filter(f => getEffectiveLean(f).lean === 'under');

  // Sort
  fighters = sortFighters(fighters, currentSort);

  if (fighters.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3);font-size:12px;font-family:\'IBM Plex Mono\',monospace;">No fighters match this filter</div>';
    return;
  }
  const totalFights = Math.ceil(fighters.length / 2);
  const showFightGroups = currentSort === 'default' && currentView === 'all' && !currentSearch.trim();
  fighters.forEach((f, i) => {
    const opp = f.opponent && f.opponent !== 'null' && f.opponent !== 'undefined' ? f.opponent : null;
    const oppEntry = opp
      ? (allFighters.find(x => x.name === opp)
         || allFighters.find(x => namesMatch(x.name, opp)))
      : null;
    // Fight group header at start of each pair
    if (i % 2 === 0 && showFightGroups) {
      const fightIndex = Math.floor(i / 2);
      let badgeText, badgeCls;
      if (fightIndex === 0) { badgeText = 'MAIN EVENT'; badgeCls = 'main'; }
      else if (fightIndex === 1) { badgeText = 'CO-MAIN'; badgeCls = 'co'; }
      else if (fightIndex < Math.ceil(totalFights * 0.55)) { badgeText = 'MAIN CARD'; badgeCls = 'card'; }
      else { badgeText = 'PRELIM'; badgeCls = 'prelim'; }
      const header = document.createElement('div');
      header.className = 'fight-group-header';
      header.innerHTML = `<div class="fight-group-line"></div><span class="fight-badge ${badgeCls}">${badgeText}</span><div class="fight-group-line"></div>`;
      container.appendChild(header);
    }
    debugLog(`TD lookup: ${f.name} → opp="${opp}" oppEntry="${oppEntry?.name}" oppTdLine=${oppEntry?.line_p6_td ?? oppEntry?.line_ud_td ?? null} selfTdLine=${f.line_p6_td}`);
    container.appendChild(buildFighterRow(f, oppEntry));
    // Spacer after second fighter in pair (no group headers) or always when not showing groups
    if (!showFightGroups && i % 2 === 1 && i < fighters.length - 1) {
      const sp = document.createElement('div');
      sp.style.cssText = 'height:8px';
      container.appendChild(sp);
    }
  });
}

function buildFighterRow(f, oppEntry) {
  const db = f.db || {};
  const lean = getEffectiveLean(f);
  const leanClass = lean.lean === 'over' ? 'lean-over' : lean.lean === 'under' ? 'lean-under' : lean.lean === 'push' ? 'lean-push' : 'lean-none';
  const leanSuffix = lean._label || '';
  const leanText  = lean.lean === 'over' ? `▲ OVER${leanSuffix}` : lean.lean === 'under' ? `▼ UNDER${leanSuffix}` : lean.lean === 'push' ? '~ PUSH' : db.loaded ? '—' : '⟳';
  const confFillClass = lean.lean === 'under' ? 'under' : lean.lean === 'push' ? 'push' : '';
  // Gradient confidence fill baked into badge background
  const leanRGB = lean.lean === 'over' ? '0,232,122' : lean.lean === 'under' ? '255,58,96' : lean.lean === 'push' ? '240,192,64' : '50,58,88';
  const confPct = lean.conf || 0;
  const leanGradStyle = lean.lean !== 'none' && confPct > 0
    ? `background:linear-gradient(90deg,rgba(${leanRGB},0.22) ${confPct}%,rgba(${leanRGB},0.05) ${confPct}%);`
    : '';
  const confInlineLabel = confPct > 0 ? `<span class="lean-conf-inline">${confPct}%</span>` : '';
  const activeLine = activePlatformLine(f);
  const platformLabel = activePlatformLabel(f);
  // Opponent lines — opp history panels compare past opponents against the CURRENT opponent's line
  // e.g. for Oliveira's opp SS panel, line = Max's SS line (92.5/86.5), not Oliveira's
  const oppSsLine = oppEntry ? (oppEntry.line_p6_ss ?? oppEntry.line_ud_ss ?? oppEntry.line_betr_ss ?? null) : null;
  const oppTdLine = oppEntry ? (oppEntry.line_p6_td ?? oppEntry.line_ud_td ?? oppEntry.line_betr_td ?? null) : null;
  const oppFpLine = oppEntry ? activePlatformLine(oppEntry) : null;
  const oppName   = oppEntry ? oppEntry.name : (f.opponent || null);

  function buildHistoryBars(fights, valFn, lineFP, lineSS, lineTD, labelFn) {
    if (!fights?.length) return db.loaded
      ? '<div style="color:var(--text3);font-size:11px;font-family:\'IBM Plex Mono\',monospace;">No fight history found on UFCStats</div>'
      : '<div style="color:var(--text3);font-size:11px;font-family:\'IBM Plex Mono\',monospace;">⟳ Fetching from UFCStats...</div>';
    return fights.slice(0,8).map(h => {
      const val = valFn(h);
      if (val == null) return '';
      const line = labelFn === 'fp' ? lineFP : labelFn === 'ss' ? lineSS : lineTD;
      const maxVal = Math.max(...fights.map(valFn).filter(v => v != null), (line || 0) * 1.3, 1);
      const pct = Math.min(100, (val / maxVal) * 100);
      const linePct = line ? Math.min(100, (line / maxVal) * 100) : null;
      const isOver = line ? val > line : true;
      return `<div class="history-bar-row">
        <div class="history-opp">${h.opp || '?'}</div>
        <div class="history-bar-wrap">
          <div class="history-bar-fill ${isOver ? 'over-line' : 'under-line'}" style="width:${pct}%"></div>
          ${linePct != null ? `<div class="line-marker" style="left:${linePct}%"></div>` : ''}
        </div>
        <div class="history-bar-val">${Number.isInteger(val) ? val : val.toFixed(1)}</div>
      </div>`;
    }).join('');
  }

  const fights    = db.history    || [];
  const oppFights = db.oppHistory || [];
  const ssLine = f.line_p6_ss ?? f.line_ud_ss ?? f.line_betr_ss ?? null;
  const tdLine = f.line_p6_td ?? f.line_ud_td ?? null;

  const historyHTML   = buildHistoryBars(fights,    h => h.fp, activeLine, ssLine, tdLine, 'fp');
  const ssHistoryHTML = buildHistoryBars(fights,    h => h.sigStr, activeLine, ssLine, tdLine, 'ss');
  const tdHistoryHTML = buildHistoryBars(fights,    h => h.td, activeLine, ssLine, tdLine, 'td');
  // Opp history: compare past opponents' FP/SS/TD against the CURRENT opponent's line
  // e.g. Oliveira's opp SS panel uses Max's SS line so you see which past opponents exceeded Max's number
  // Only use opponent's line — never fall back to fighter's own line (that was the old bug)
  const oppFPHistory  = buildHistoryBars(oppFights, h => h.fp,     oppFpLine,  oppSsLine, oppTdLine, 'fp');
  const oppSSHistory  = buildHistoryBars(oppFights, h => h.sigStr, oppFpLine,  oppSsLine, oppTdLine, 'ss');
  const oppTDHistory  = buildHistoryBars(oppFights, h => h.td,     oppFpLine,  oppSsLine, oppTdLine, 'td');

  const reasonsHTML = lean.reasons?.map(r => `<div class="lean-point">
    <span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span>
    <span>${r.text}</span>
  </div>`).join('') || '';

  const fpFloor    = db.fpFloor != null ? db.fpFloor.toFixed(1) : '...';
  const fpCeiling  = db.fpCeiling != null ? db.fpCeiling.toFixed(1) : '...';
  const fpConsistency = db.fpConsistency != null ? db.fpConsistency : null;
  const consistencyClass = fpConsistency != null ? (fpConsistency >= 70 ? 'consistency-high' : fpConsistency >= 45 ? 'consistency-mid' : 'consistency-low') : '';
  const consistencyLabel = fpConsistency != null ? (fpConsistency >= 70 ? 'STEADY' : fpConsistency >= 45 ? 'VOLATILE' : 'WILD') : '...';
  const streakEmoji = db.streak?.type === 'hot' ? ' 🔥' : db.streak?.type === 'cold' ? ' ❄️' : '';
  const weightedAvg = db.avgFP_weighted;
  const weightedDiff = (weightedAvg != null && db.avgFP_p6 != null) ? (weightedAvg - db.avgFP_p6) : null;
  const weightedArrow = weightedDiff == null ? '' : weightedDiff > 3 ? ' ↑' : weightedDiff < -3 ? ' ↓' : '';

  const row = document.createElement('div');
  const rowLeanClass = lean.lean === 'over' ? ' lean-over-row' : lean.lean === 'under' ? ' lean-under-row' : '';
  // lean already from getEffectiveLean — row coloring reflects best available signal (FP > SS > TD)
  row.className = 'fighter-row' + rowLeanClass;
  row.dataset.name = f.name;
  row.innerHTML = `
    <div class="fighter-main">
      <div class="fighter-info">
        <div class="fighter-flag">${db.country || '🏴'}</div>
        <div>
          <div class="fighter-name">${f.name}${streakEmoji}</div>
          <div class="fighter-record">${db.record || '—'} · ${db.style || '...'}</div>
        </div>
      </div>
      <div class="platform-lines">
        ${f.line_p6    != null ? `<div class="line-cell"><div class="line-platform">P6 FP</div><div class="line-value p6">${f.line_p6}</div></div>` : ''}
        ${f.line_p6_ss != null ? `<div class="line-cell"><div class="line-platform">P6 SS</div><div class="line-value p6">${f.line_p6_ss}</div></div>` : ''}
        ${f.line_p6_td != null ? `<div class="line-cell"><div class="line-platform">P6 TD</div><div class="line-value p6">${f.line_p6_td}</div></div>` : ''}
        ${f.line_ud    != null ? `<div class="line-cell"><div class="line-platform">UD FP</div><div class="line-value ud">${f.line_ud}</div></div>` : ''}
        ${f.line_ud_ss != null ? `<div class="line-cell"><div class="line-platform">UD SS</div><div class="line-value ud">${f.line_ud_ss}</div></div>` : ''}
        ${f.line_ud_td != null ? `<div class="line-cell"><div class="line-platform">UD TD</div><div class="line-value ud">${f.line_ud_td}</div></div>` : ''}
        ${f.line_betr  != null ? `<div class="line-cell"><div class="line-platform">BT FP</div><div class="line-value" style="color:var(--orange)">${f.line_betr}</div></div>` : ''}
        ${f.line_betr_ss != null ? `<div class="line-cell"><div class="line-platform">BT SS</div><div class="line-value" style="color:var(--orange)">${f.line_betr_ss}</div></div>` : ''}
        ${f.line_pp    != null ? `<div class="line-cell"><div class="line-platform">PP FP</div><div class="line-value" style="color:var(--cyan)">${f.line_pp}</div></div>` : ''}
        ${f.line_pp_ss != null ? `<div class="line-cell"><div class="line-platform">PP SS</div><div class="line-value" style="color:var(--cyan)">${f.line_pp_ss}</div></div>` : ''}
        ${f.line_pp_td != null ? `<div class="line-cell"><div class="line-platform">PP TD</div><div class="line-value" style="color:var(--cyan)">${f.line_pp_td}</div></div>` : ''}
        ${f.line_p6 == null && f.line_ud == null && f.line_betr == null && f.line_pp == null && f.line_ud_ss == null && f.line_p6_ss == null && f.line_pp_ss == null ? `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);letter-spacing:0.06em;">No lines yet</div>` : ''}
      </div>
      <div class="stats-mini">
        <div class="stat-mini-cell">
          <div class="stat-mini-label">Avg FP${weightedArrow}</div>
          <div class="stat-mini-val">${db.avgFP_p6!=null?db.avgFP_p6.toFixed(1):'...'}</div>
          <div class="fp-range-label">${db.fpFloor!=null?`${fpFloor}–${fpCeiling}`:''}</div>
        </div>
        <div class="stat-mini-cell">
          <div class="stat-mini-label">Avg SS</div>
          <div class="stat-mini-val">${db.avgSigStr!=null?db.avgSigStr.toFixed(1):'...'}</div>
        </div>
        <div class="stat-mini-cell">
          <div class="stat-mini-label">Avg TDs</div>
          <div class="stat-mini-val">${db.avgTDperFight!=null?db.avgTDperFight.toFixed(1):'...'}</div>
        </div>
        <div class="stat-mini-cell">
          <div class="stat-mini-label">CONSIST</div>
          <div class="consistency-badge ${consistencyClass}">${fpConsistency!=null?fpConsistency+'%':'...'}</div>
        </div>
      </div>
      <div class="lean-cell">
        <div class="lean-badge ${leanClass}" style="${leanGradStyle}">${leanText}${confInlineLabel}</div>
        ${weightedAvg != null ? `<div class="weighted-avg-label">W.Avg: ${weightedAvg.toFixed(1)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px">
        <span class="expand-arrow">▼</span>
      </div>
    </div>
    <div class="fighter-detail">
      <div class="detail-grid">
        <div class="detail-panel">
          <div class="detail-panel-title">FP History vs Line (${platformLabel})</div>
          ${historyHTML}
          ${activeLine?`<div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text3);font-family:'IBM Plex Mono',monospace"><div style="width:10px;height:2px;background:var(--gold);display:inline-block"></div> Line: ${activeLine}</div>`:''}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">Sig Strikes History${ssLine?` vs Line ${ssLine}`:''}</div>
          ${ssHistoryHTML}
          ${ssLine?`<div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text3);font-family:'IBM Plex Mono',monospace"><div style="width:10px;height:2px;background:var(--gold);display:inline-block"></div> P6: ${f.line_p6_ss||'—'} · UD: ${f.line_ud_ss||'—'}</div>`:''}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">Takedowns History${tdLine?` vs Line ${tdLine}`:''}</div>
          ${tdHistoryHTML}
          ${tdLine?`<div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text3);font-family:'IBM Plex Mono',monospace"><div style="width:10px;height:2px;background:var(--gold);display:inline-block"></div> P6: ${f.line_p6_td||'—'} · UD: ${f.line_ud_td||'—'}</div>`:''}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">⚔️ Opp FP Scored vs ${f.name}${oppFpLine != null ? ` · vs ${oppName || 'opp'} FP line ${oppFpLine}` : ''}</div>
          ${oppFights.length?oppFPHistory:'<div style="color:var(--text3);font-size:11px;font-family:\'IBM Plex Mono\',monospace">Clear cache & reload to fetch</div>'}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">⚔️ Opp SS Scored vs ${f.name}${oppSsLine != null ? ` · vs ${oppName || 'opp'} SS line ${oppSsLine}` : ''}</div>
          ${oppFights.length?oppSSHistory:'<div style="color:var(--text3);font-size:11px;font-family:\'IBM Plex Mono\',monospace">Clear cache & reload to fetch</div>'}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">⚔️ Opp TDs Scored vs ${f.name}${oppTdLine != null ? ` · vs ${oppName || 'opp'} TD line ${oppTdLine}` : ''}</div>
          ${oppFights.length?oppTDHistory:'<div style="color:var(--text3);font-size:11px;font-family:\'IBM Plex Mono\',monospace">Clear cache & reload to fetch</div>'}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">UFCStats Career Data</div>
          <span class="stat-val" style="color:var(--gold)">${db.record||'...'}</span>
          <div class="stat-row"><span class="stat-label">SIG STRIKES / MIN</span><span class="stat-val ${db.slpm>5?'good':db.slpm>3?'mid':'low'}">${db.slpm!=null?db.slpm.toFixed(2):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">STRIKING ACC %</span><span class="stat-val ${db.strAcc>48?'good':db.strAcc>38?'mid':'low'}">${db.strAcc!=null?db.strAcc+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD AVG / 15 MIN</span><span class="stat-val ${db.avgTD>2?'good':db.avgTD>1?'mid':'low'}">${db.avgTD!=null?db.avgTD.toFixed(2):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD DEFENSE %</span><span class="stat-val ${db.tdDef>70?'good':db.tdDef>50?'mid':'low'}">${db.tdDef!=null?db.tdDef+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FINISH RATE</span><span class="stat-val ${db.finishRate>0.6?'good':'mid'}">${db.finishRate!=null?Math.round(db.finishRate*100)+'%':'...'}</span></div>
          <div class="stat-row"><span class="stat-label">AVG FP (CALC)</span><span class="stat-val ${(db.avgFP||db.avgFP_p6)>activeLine?'good':'low'}">${db.avgFP!=null?db.avgFP.toFixed(1):(db.avgFP_p6!=null?db.avgFP_p6.toFixed(1):'...')}</span></div>
          <div class="stat-row"><span class="stat-label">W.AVG FP (RECENT)</span><span class="stat-val ${weightedAvg!=null&&weightedAvg>activeLine?'good':'low'}">${weightedAvg!=null?weightedAvg.toFixed(1):'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP FLOOR / CEILING</span><span class="stat-val mid">${db.fpFloor!=null?`${fpFloor} / ${fpCeiling}`:'...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP STD DEV</span><span class="stat-val ${db.fpStdDev!=null&&db.fpStdDev<15?'good':db.fpStdDev<25?'mid':'low'}">${db.fpStdDev!=null?db.fpStdDev:'...'}</span></div>
          <div class="stat-row"><span class="stat-label">CONSISTENCY %</span><span class="stat-val ${consistencyClass}">${fpConsistency!=null?fpConsistency+'%':'...'}</span></div>
          ${db.fiveRoundRate>0?`<div class="stat-row"><span class="stat-label">5-ROUND FIGHT RATE</span><span class="stat-val mid">${Math.round(db.fiveRoundRate*100)}%</span></div>`:''}
          ${db.detailUrl?`<div style="margin-top:8px"><a href="${db.detailUrl}" target="_blank" style="color:var(--blue);font-family:'IBM Plex Mono',monospace;font-size:10px;">↗ View on UFCStats</a></div>`:''}
        </div>
        <div class="detail-panel">
          <div class="detail-panel-title">Lean Analysis (FP)</div>
          <div class="lean-reason">${reasonsHTML}</div>
          ${lean.verdict?`<div class="lean-verdict ${lean.lean}">${lean.verdict}</div>`:''}
        </div>
        ${f.lean_ss?`<div class="detail-panel">
          <div class="detail-panel-title">SS Lean (P6: ${f.line_p6_ss||'—'} · UD: ${f.line_ud_ss||'—'} · PP: ${f.line_pp_ss||'—'})</div>
          <div class="lean-reason">${f.lean_ss.reasons.map(r=>`<div class="lean-point"><span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ss.lean}">${f.lean_ss.verdict}</div>
        </div>`:''}
        ${f.lean_td?`<div class="detail-panel">
          <div class="detail-panel-title">TD Lean (P6: ${f.line_p6_td||'—'} · UD: ${f.line_ud_td||'—'} · PP: ${f.line_pp_td||'—'})</div>
          <div class="lean-reason">${f.lean_td.reasons.map(r=>`<div class="lean-point"><span class="lean-point-icon ${r.icon==='pos'?'pos':r.icon==='neg'?'neg':''}">${r.icon==='pos'?'↑':r.icon==='neg'?'↓':'→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_td.lean}">${f.lean_td.verdict}</div>
        </div>`:''}
      </div>
    </div>`;
  return row;
}


function toggleRow(row) { row.classList.toggle('expanded'); }

// ── DATA LOADING ──────────────────────────────────────────────────────────
// Known cross-platform name aliases (normalized → canonical)
// These handle cases where Pick6 and Underdog spell names differently
const NAME_ALIASES = {
  // Korean name romanization differences
  'Jung Young Lee':   'Jeongyeong Lee',
  'Jungyoung Lee':    'Jeongyeong Lee',
  // Pick6 scraping artifact: "Su Sumudaerji" should be "Su Mudaerji"
  'Su Sumudaerji':    'Su Mudaerji',
  'Sumudaerji Su':    'Su Mudaerji',
  // Betr uses single-word name
  'Sumudaerji':       'Su Mudaerji',
  // Damon Jackson was my misread — correct name is Donte Johnson
  'Damon Jackson':    'Donte Johnson',
  // Emmett vs Vallejos card variations
  'Myktybek Orolbai': 'Myktybek Orolbai Uulu',
  'Orolbai':          'Myktybek Orolbai Uulu',
  'Kevin Vallejos':   'Kevin Vallejos',
  'Jose Miguel Delgado': 'Jose Delgado',
  'Jose M Delgado':   'Jose Delgado',
};

function normalizeName(name) {
  if (!name || name === 'null' || name === 'undefined') return null;
  // Strip non-printable/invisible unicode that causes silent mismatches
  let n = name.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim();
  n = n.replace(/\./g, '')    // Strip periods: "Jr." → "Jr"
       .replace(/-/g, ' ')    // Hyphens to spaces: "Jung-young" → "Jung young"
       .replace(/\s+/g, ' '); // Normalize spaces
  // Title-case
  n = n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  // Apply alias table
  return NAME_ALIASES[n] || n;
}

// Collapse repeated letters for comparison: "Brunno" → "Bruno", "Connoor" → "Connor"
function dedup(str) {
  return str.replace(/(.)\1+/g, '$1');
}

// Aggressive fuzzy match — handles different romanizations, repeated letters, hyphens, etc.
function namesMatch(a, b) {
  if (a === b) return true;
  const aParts = a.split(' '), bParts = b.split(' ');
  const aFirst = aParts[0], aLast = aParts[aParts.length - 1];
  const bFirst = bParts[0], bLast = bParts[bParts.length - 1];

  // Same last name + same first letter of first name (e.g. "Jeongyeong Lee" vs "Jung Young Lee")
  if (aLast === bLast && aFirst[0] === bFirst[0]) return true;

  // Deduplicated match (handles "Brunno" vs "Bruno", "Connoor" vs "Connor")
  if (dedup(a.toLowerCase()) === dedup(b.toLowerCase())) return true;

  // Same last + first starts with the other's first (handles abbreviation)
  if (aLast === bLast && (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))) return true;

  // One is prefix of the other (e.g. "Raul Rosas" vs "Raul Rosas Jr")
  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return true;

  // Last name only match — only if last name is long enough (>4 chars) to be unique-ish
  if (aLast === bLast && aLast.length > 4) return true;

  return false;
}

async function mergeAndEnrich(p6Fighters, udFighters, betrFighters, ppFighters) {
  debugLog(`P6 fighters (${(p6Fighters||[]).length}): ${(p6Fighters||[]).map(f=>f.name).join(', ')}`);
  debugLog(`UD fighters (${(udFighters||[]).length}): ${(udFighters||[]).map(f=>f.name).join(', ')}`);
  const map = {};
  // Sanity check: valid fighter name = 2-5 words, no colons/parens, starts with capital letter
  function isValidFighterName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.includes(':') || name.includes('(') || name.includes(')')) return false;
    if (name.length < 4 || name.length > 50) return false;
    const words = name.trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    if (!/^[A-Z]/.test(name)) return false;
    return true;
  }

  (p6Fighters || []).forEach(f => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name);
    if (!map[n]) map[n] = { name:n, line_p6:null, line_p6_ss:null, line_p6_td:null, line_ud:null, line_ud_ss:null, line_ud_td:null, line_pp:null, line_pp_ss:null, line_pp_td:null, opponent:null };
    // Support both old {line} format and new {line_fp, line_ss, line_td} format
    map[n].line_p6    = f.line_fp ?? f.line ?? null;
    map[n].line_p6_ss = f.line_ss ?? null;
    map[n].line_p6_td = f.line_td ?? null;
    if (f.opponent) map[n].opponent = normalizeName(f.opponent);
  });

  function findOrCreateEntry(n) {
    if (map[n]) return map[n];
    const existing = Object.keys(map).find(k => namesMatch(k, n));
    if (existing) {
      if (existing !== n) debugLog(`Fuzzy merge: "${n}" → "${existing}"`);
      return map[existing];
    }
    debugLog(`UD-only (no P6 match): "${n}"`);
    map[n] = { name:n, line_p6:null, line_p6_ss:null, line_p6_td:null, line_ud:null, line_ud_ss:null, line_ud_td:null, line_pp:null, line_pp_ss:null, line_pp_td:null, opponent:null };
    return map[n];
  }

  // Like findOrCreateEntry but returns null if fighter not already in map (for sportsbook-only data)
  function findExistingEntry(n) {
    if (map[n]) return map[n];
    const existing = Object.keys(map).find(k => namesMatch(k, n));
    if (existing) return map[existing];
    return null;
  }

  (udFighters || []).forEach(f => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name);
    const entry = findOrCreateEntry(n);
    entry.line_ud    = f.line_fp ?? f.line ?? null;
    entry.line_ud_ss = f.line_ss ?? null;
    entry.line_ud_td = f.line_td ?? null;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
  });

  (betrFighters || []).forEach(f => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name);
    const entry = findOrCreateEntry(n);
    entry.line_betr    = f.line_fp ?? f.line ?? null;
    entry.line_betr_ss = f.line_ss ?? null;
    entry.line_betr_td = f.line_td ?? null;
  });

  (ppFighters || []).forEach(f => {
    if (!isValidFighterName(f.name)) return;
    const n = normalizeName(f.name);
    const entry = findOrCreateEntry(n);
    entry.line_pp    = f.line_fp ?? f.line ?? null;
    entry.line_pp_ss = f.line_ss ?? null;
    entry.line_pp_td = f.line_td ?? null;
    if (f.opponent) entry.opponent = normalizeName(f.opponent);
  });

  // Cross-fill TD lines: if fighter A has no TD line but B (their opponent) has a TD line,
  // and A's opponent field points to B, fill A's line from the sportsbook data via B's stored opp line.
  // This fixes cases where sportsbook stored the line under a slightly different name variant.
  const allEntries = Object.values(map);
  allEntries.forEach(f => {
    if (f.line_p6_td != null || f.line_ud_td != null) return; // already has TD line
    if (!f.opponent) return;
    const opp = allEntries.find(x => x.name === f.opponent || namesMatch(x.name, f.opponent));
    if (!opp) return;
    // If opp has a TD line and opp's opponent is this fighter, the lines are already correct
    // Nothing to cross-fill here — the TD line lookup (oppEntry.line_p6_td) handles it correctly
  });

  // Render placeholder rows immediately
  allFighters = Object.values(map).map(f => ({ ...f, db: { loaded: false }, lean: { lean: 'none', conf: 0, reasons: [], verdict: '' } }));
  renderFighters();

  // Fetch all fighter stats in parallel
  const entries = Object.values(map);
  const dbResults = await Promise.all(entries.map(f => fetchFighterStats(f.name)));
  const dbMap = {};
  entries.forEach((f, i) => { dbMap[f.name] = dbResults[i]; });

  // Full head-to-head analysis with opponent context
  const paired = new Set();
  entries.forEach(f => {
    if (paired.has(f.name)) return;
    const oppName = f.opponent;

    // Strict opponent lookup: exact name match first, then last-name fallback
    let opp = null;
    if (oppName) {
      opp = entries.find(x => x.name === oppName)
         || entries.find(x => x.name.toLowerCase() === oppName.toLowerCase())
         || entries.find(x => {
              const xLast  = x.name.split(' ').pop().toLowerCase();
              const oppLast = oppName.split(' ').pop().toLowerCase();
              return xLast === oppLast && xLast.length > 3; // avoid short surname false-positives
            });
    }

    const dbA = dbMap[f.name];
    const dbB = opp ? dbMap[opp.name] : null; // explicitly null when no opponent found

    // Write opponent name back to both allFighters entries so renderFighters can look it up
    if (opp) {
      const idxA = allFighters.findIndex(x => x.name === f.name);
      const idxB = allFighters.findIndex(x => x.name === opp.name);
      if (idxA >= 0) allFighters[idxA].opponent = opp.name;
      if (idxB >= 0) allFighters[idxB].opponent = f.name;
    }

    // calcLean now takes opponent DB for matchup analysis
    // Use active platform line as primary, other as fallback
    const lineA_p6 = currentPlatform === 'pick6'       ? (f.line_p6 ?? f.line_ud ?? null) : null;
    const lineA_ud = currentPlatform === 'underdog'    ? (f.line_ud ?? f.line_p6 ?? null) : null;
    const lineA_pp = currentPlatform === 'prizepicks'  ? (f.line_pp ?? f.line_ud ?? f.line_p6 ?? null) : null;
    const lineB_p6 = opp ? (currentPlatform === 'pick6'      ? (opp.line_p6 ?? opp.line_ud ?? null) : null) : null;
    const lineB_ud = opp ? (currentPlatform === 'underdog'   ? (opp.line_ud ?? opp.line_p6 ?? null) : null) : null;
    const lineB_pp = opp ? (currentPlatform === 'prizepicks' ? (opp.line_pp ?? opp.line_ud ?? opp.line_p6 ?? null) : null) : null;
    const leanA = calcLean(f.name, dbA, lineA_p6, lineA_ud, lineA_pp, dbB);
    const leanB = opp ? calcLean(opp.name, dbB, lineB_p6, lineB_ud, lineB_pp, dbA) : null;

    applyLean(f, dbA, leanA);
    if (opp) applyLean(opp, dbB, leanB);

    // Compute SS and TD leans
    const ssLineA = f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? null;
    const tdLineA = f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? null;
    const leanSSA = calcSSLean(f.name, dbA, ssLineA, dbB);
    const leanTDA = calcTDLean(f.name, dbA, tdLineA, dbB);
    updateFighterLeans(f.name, leanSSA, leanTDA);

    if (opp) {
      const ssLineB = opp.line_p6_ss ?? opp.line_ud_ss ?? opp.line_pp_ss ?? opp.line_betr_ss ?? null;
      const tdLineB = opp.line_p6_td ?? opp.line_ud_td ?? opp.line_pp_td ?? opp.line_betr_td ?? null;
      const leanSSB = calcSSLean(opp.name, dbB, ssLineB, dbA);
      const leanTDB = calcTDLean(opp.name, dbB, tdLineB, dbA);
      updateFighterLeans(opp.name, leanSSB, leanTDB);
    }

    paired.add(f.name);
    if (opp) paired.add(opp.name);
  });

  // Debug: show structure of first few fighters to verify line field names
  debugLog('DEBUG fighters sample: ' + JSON.stringify(
    allFighters.slice(0,3).map(f => ({
      name: f.name,
      keys: Object.keys(f).filter(k => k.includes('line') || k === 'lean' || k === 'db'),
      sample: {
        line_p6: f.line_p6,
        line_ud: f.line_ud,
        line_fp: f.line_fp,
        line_p6_td: f.line_p6_td,
        line_ud_td: f.line_ud_td,
        line_td: f.line_td,
      }
    })), null, 2));

  renderFighters();
}

function applyLean(f, db, lean) {
  const idx = allFighters.findIndex(x => x.name === f.name);
  if (idx >= 0) { allFighters[idx].db = db || { loaded: false }; allFighters[idx].lean = lean || { lean: 'none', conf: 0, reasons: [], verdict: '' }; }
}

function updateFighterLeans(name, lean_ss, lean_td) {
  const idx = allFighters.findIndex(x => x.name === name);
  if (idx >= 0) {
    if (lean_ss) allFighters[idx].lean_ss = lean_ss;
    if (lean_td) allFighters[idx].lean_td = lean_td;
  }
}

function updatePlatformBar(data) {
  const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [];
  const pp = data.prizepicks?.fighters || [];
  document.getElementById('countP6').textContent   = p6.length   ? `${p6.length}`   : '—';
  document.getElementById('countUD').textContent   = ud.length   ? `${ud.length}`   : '—';
  document.getElementById('countBetr').textContent = betr.length ? `${betr.length}` : '—';
  const ppPill = document.getElementById('countPP');
  if (ppPill) ppPill.textContent = pp.length ? `${pp.length}` : '—';
  document.getElementById('pillP6').classList.toggle('active', p6.length > 0);
  document.getElementById('pillUD').classList.toggle('active', ud.length > 0);
  document.getElementById('pillBetr').classList.toggle('active', betr.length > 0);
  document.getElementById('pillPP')?.classList.toggle('active', pp.length > 0);
  // Auto-select best available platform if current one has no data
  if (currentPlatform === 'pick6' && p6.length === 0) {
    if (ud.length > 0) setActivePlatform('underdog');
    else if (pp.length > 0) setActivePlatform('prizepicks');
    else if (betr.length > 0) setActivePlatform('betr');
  }
  // Re-apply selected indicator (in case pills were re-rendered)
  document.querySelector(`[data-platform="${currentPlatform}"]`)?.classList.add('platform-selected');
  const total = p6.length + ud.length + betr.length + pp.length;
  const dot = document.getElementById('extDot'), label = document.getElementById('extLabel');
  if (total === 0) { dot.className = 'ext-dot'; label.textContent = 'No extension data'; label.style.color = 'var(--text3)'; }
  else if (p6.length > 0) { dot.className = 'ext-dot live'; label.textContent = `Live · ${total} lines`; label.style.color = 'var(--green)'; }
  else { dot.className = 'ext-dot partial'; label.textContent = `Partial · ${total} lines`; label.style.color = 'var(--orange)'; }
}

function loadData() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('spinning');
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks'], (result) => {
      processData({ pick6: result.lines_pick6 || null, underdog: result.lines_underdog || null, betr: result.lines_betr || null, prizepicks: result.lines_prizepicks || null })
        .then(() => icon.classList.remove('spinning'))
        .catch(e => { console.error('LoadData error:', e); icon.classList.remove('spinning'); });
    });
  } else {
    setTimeout(() => { processData(DEMO_DATA).then(() => icon.classList.remove('spinning')).catch(e => icon.classList.remove('spinning')); }, 400);
  }
}

async function processData(data) {
  updatePlatformBar(data);
  const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [], pp = data.prizepicks?.fighters || [];
  const empty = document.getElementById('emptyState'), container = document.getElementById('cardContainer');
  if (p6.length === 0 && ud.length === 0 && betr.length === 0 && pp.length === 0) {
    empty.style.display = 'block'; container.style.display = 'none'; return;
  }
  empty.style.display = 'none'; container.style.display = 'block';
  const fhr = document.getElementById('fighterHeaderRow');
  if (fhr) fhr.style.display = 'grid';
  showToast(`Loading ${p6.length || ud.length || pp.length} fighters + fetching UFCStats...`);
  await mergeAndEnrich(p6, ud, betr, pp);
  showToast(`Loaded ${allFighters.filter(f => f.db?.loaded).length} fighters with stats!`);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

const DEMO_DATA = {
  // UFC Fight Night: Emmett vs. Vallejos — March 14 2026
  // Lines are placeholder estimates — scrape Pick6/UD/DK for real lines
  pick6: { fighters: [
    // MAIN CARD
    { name: "Josh Emmett",         line_fp: 82.5,  line_ss: 44.5, line_td: 0.5,  opponent: "Kevin Vallejos" },
    { name: "Kevin Vallejos",      line_fp: 62.5,  line_ss: 49.5, line_td: 0.5,  opponent: "Josh Emmett" },
    { name: "Amanda Lemos",        line_fp: 71.5,  line_ss: 55.5, line_td: 0.5,  opponent: "Gillian Robertson" },
    { name: "Gillian Robertson",   line_fp: 55.5,  line_ss: 22.5, line_td: 2.5,  opponent: "Amanda Lemos" },
    { name: "Oumar Sy",            line_fp: 74.5,  line_ss: 42.5, line_td: 1.5,  opponent: "Ion Cutelaba" },
    { name: "Ion Cutelaba",        line_fp: 68.5,  line_ss: 48.5, line_td: 0.5,  opponent: "Oumar Sy" },
    { name: "Vitor Petrino",       line_fp: 79.5,  line_ss: 39.5, line_td: 0.5,  opponent: "Steven Asplund" },
    { name: "Steven Asplund",      line_fp: 52.5,  line_ss: 34.5, line_td: null, opponent: "Vitor Petrino" },
    { name: "Andre Fili",          line_fp: 73.5,  line_ss: 55.5, line_td: 0.5,  opponent: "Jose Delgado" },
    { name: "Jose Delgado",        line_fp: 58.5,  line_ss: 44.5, line_td: 0.5,  opponent: "Andre Fili" },
    { name: "Marwan Rahiki",       line_fp: 66.5,  line_ss: 48.5, line_td: 0.5,  opponent: "Harry Hardwick" },
    { name: "Harry Hardwick",      line_fp: 62.5,  line_ss: 52.5, line_td: 0.5,  opponent: "Marwan Rahiki" },
    // PRELIMS
    { name: "Brad Tavares",        line_fp: 68.5,  line_ss: 49.5, line_td: 0.5,  opponent: "Eryk Anders" },
    { name: "Eryk Anders",         line_fp: 64.5,  line_ss: 46.5, line_td: 0.5,  opponent: "Brad Tavares" },
    { name: "Chris Curtis",        line_fp: 74.5,  line_ss: 58.5, line_td: null, opponent: "Myktybek Orolbai" },
    { name: "Bruno Silva",         line_fp: 72.5,  line_ss: 54.5, line_td: 0.5,  opponent: "Charles Johnson" },
    { name: "Charles Johnson",     line_fp: 66.5,  line_ss: 48.5, line_td: 0.5,  opponent: "Bruno Silva" },
    { name: "Piera Rodriguez",     line_fp: 68.5,  line_ss: 44.5, line_td: 1.5,  opponent: "Sam Hughes" },
    { name: "Sam Hughes",          line_fp: 55.5,  line_ss: 38.5, line_td: 0.5,  opponent: "Piera Rodriguez" },
  ], capturedAt: Date.now() },
  underdog: { fighters: [
    { name: "Josh Emmett",         line_fp: 80.5,  line_ss: 42.5, line_td: 0.5,  opponent: "Kevin Vallejos" },
    { name: "Kevin Vallejos",      line_fp: 60.5,  line_ss: 47.5, line_td: 0.5,  opponent: "Josh Emmett" },
    { name: "Amanda Lemos",        line_fp: 69.5,  line_ss: 53.5, line_td: 0.5,  opponent: "Gillian Robertson" },
    { name: "Gillian Robertson",   line_fp: 53.5,  line_ss: 21.5, line_td: 2.5,  opponent: "Amanda Lemos" },
    { name: "Oumar Sy",            line_fp: 72.5,  line_ss: 40.5, line_td: 1.5,  opponent: "Ion Cutelaba" },
    { name: "Ion Cutelaba",        line_fp: 66.5,  line_ss: 46.5, line_td: 0.5,  opponent: "Oumar Sy" },
    { name: "Vitor Petrino",       line_fp: 77.5,  line_ss: 37.5, line_td: 0.5,  opponent: "Steven Asplund" },
  ], capturedAt: Date.now() },
  betr: null
};

// ── LINE DROP NOTIFICATION LISTENER ──────────────────────────────────────
// Background service worker sends this when it detects lines went live
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LINES_DROPPED') {
      // Lines just dropped! Show a big alert and auto-reload
      showLineDropAlert(msg);
      setTimeout(() => loadData(), 1500);
    }

    if (msg.type === 'LINES_UPDATED') {
      // New lines were captured; refresh view
      console.log('[UFC Analyzer] Lines updated:', msg.platform, msg.count);
      loadData();
    }
  });
}

function showLineDropAlert(msg) {
  const banner = document.getElementById('lineDropBanner');
  const txt    = document.getElementById('lineDropText');
  if (!banner) return;

  const event = msg.event || 'Upcoming UFC Event';
  // Build a readable drop summary e.g. "Underdog SS/TD (18 fighters), Pick6 FP (22 fighters)"
  const dropSummary = (msg.drops || [])
    .map(d => `${d.platform} ${d.type} (${d.count} fighters)`)
    .join(' · ') || `${msg.udCount || 0} fighters on Underdog`;

  txt.innerHTML = `🔔 <strong>LINES DROPPED!</strong> &nbsp;${event} — ${dropSummary}. Auto-loading now...`;
  banner.style.display = 'flex';
  banner.style.animation = 'pulseAlert 0.5s ease-in-out 3';
  setTimeout(() => { banner.style.display = 'none'; }, 25000);
}

// ── LINE WATCHER UI ───────────────────────────────────────────────────────
let watcherUIInterval = null;

function updateWatcherUI() {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  chrome.runtime.sendMessage({ type: 'GET_WATCHER_STATUS' }, (resp) => {
    const state    = resp?.state || {};
    const btnEl    = document.getElementById('watcherToggleBtn');
    const statusEl = document.getElementById('watcherStatus');
    if (!btnEl || !statusEl) return;

    if (state.watching) {
      const days    = state.daysUntil != null ? state.daysUntil : '?';
      const pollMin = state._currentPollMins || 30;
      const lastChk = state.lastPollAt ? new Date(state.lastPollAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'pending';

      // Build what's been detected so far
      const detected = [];
      if (state.detectedUD) detected.push('UD SS/TD ✓');
      if (state.detectedPP) detected.push('PP SS/TD ✓');
      if (state.detectedP6) detected.push('Pick6 FP ✓');
      if (state.detectedPPfp) detected.push('PP FP ✓');

      // Build what's next to watch for
      const daysN = parseFloat(days);
      let nextWatch = '';
      if (daysN > 6.5)       nextWatch = 'Waiting for Sunday (window opens soon)';
      else if (daysN > 5.5)  nextWatch = 'Watching: UD/PP SS+TD (Sunday afternoon drop)';
      else if (daysN > 4)    nextWatch = 'Watching: UD/PP SS+TD (Mon — lines still populating)';
      else if (daysN > 3.5)  nextWatch = 'Watching: UD/PP SS+TD + Pick6 FP (Wed window)';
      else if (daysN > 2.5)  nextWatch = 'Watching: Pick6 FP (Wed)';
      else if (daysN > 0)    nextWatch = 'Watching: Betr + PP FP (Thu–Fri)';
      else                   nextWatch = 'Event today — watching for last-minute lines';

      btnEl.textContent = '👁 Watching — Click to Stop';
      btnEl.style.background   = 'rgba(255,112,48,0.15)';
      btnEl.style.color        = 'var(--orange)';
      btnEl.style.borderColor  = 'rgba(255,112,48,0.4)';

      let statusParts = [`Poll: every ${pollMin}min`, `Last: ${lastChk}`, nextWatch];
      if (detected.length) statusParts.push(detected.join(' · '));
      statusEl.textContent = statusParts.join(' · ');
      statusEl.style.color = 'var(--orange)';

    } else {
      btnEl.textContent = '👁 Watch for Line Drop';
      btnEl.style.background  = 'rgba(100,100,150,0.1)';
      btnEl.style.color       = 'var(--text2)';
      btnEl.style.borderColor = 'rgba(100,100,150,0.25)';
      // Show the real schedule as a reminder
      statusEl.textContent = 'Off · Sun/Mon=UD+PP SS+TD (auto) · Wed=Pick6 FP (auto) · Thu–Fri=PP FP (auto) · Betr=manual only · polls 5–60min';
      statusEl.style.color = 'var(--text3)';
    }
  });
}

function toggleWatcher() {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  chrome.runtime.sendMessage({ type: 'GET_WATCHER_STATUS' }, (resp) => {
    const state = resp?.state || {};
    if (state.watching) {
      chrome.runtime.sendMessage({ type: 'STOP_LINE_WATCHER' }, () => {
        showToast('Line watcher stopped');
        updateWatcherUI();
      });
    } else {
      // Auto-detect event info for the watcher
      chrome.runtime.sendMessage({ type: 'GET_UPCOMING_CARD' }, (cardResp) => {
        const card = cardResp?.card;
        const eventName = card?.event || 'Next UFC Event';
        const eventDate = card?.date  || '';
        chrome.runtime.sendMessage({ type: 'START_LINE_WATCHER', eventName, eventDate }, () => {
          showToast(`👁 Now watching for ${eventName} lines — polls every 5 min`);
          updateWatcherUI();
          // Do an immediate poll
          chrome.runtime.sendMessage({ type: 'MANUAL_POLL_NOW' }, (r) => {
            debugLog(`Immediate poll: ${r?.lastUDCount || 0} UD lines found`);
          });
        });
      });
    }
  });
}

// ── AUTO-SCRAPE LINES ─────────────────────────────────────────────────────
// Tells the background service worker to open Pick6 + Underdog in background
// tabs, scrape them, store results, and notify the analyzer to reload.

async function triggerAutoScrape() {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    showToast('Extension not available — running in demo mode');
    return;
  }
  const btn = document.getElementById('autoScrapeBtn');
  const icon = document.getElementById('autoScrapeIcon');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  icon.textContent = '⟳';
  // Animate the icon
  icon.style.display = 'inline-block';
  icon.style.animation = 'spin 1s linear infinite';

  showToast('⚡ Opening Pick6 + Underdog tabs to fetch live lines...');

  chrome.runtime.sendMessage({ type: 'AUTO_SCRAPE_LINES' }, (result) => {
    icon.style.animation = '';
    icon.textContent = '⚡';
    btn.disabled = false;
    btn.style.opacity = '1';

    if (result?.status === 'done') {
      const totals = Object.values(result.results || {}).reduce((s, n) => s + n, 0);
      showToast(`✓ Fetched lines from ${Object.keys(result.results || {}).length} platforms — ${totals} fighters loaded`);
      loadData();
    } else if (result?.status === 'already_running') {
      showToast('Auto-scrape already in progress...');
    } else {
      showToast('Auto-scrape complete — click Refresh to load');
      loadData();
    }
  });
}

// ── UPCOMING EVENT BANNER ─────────────────────────────────────────────────
function formatCountdown(eventDate) {
  const now = Date.now();
  const target = new Date(eventDate + ' 2026').getTime(); // append year for parsing
  const diff = target - now;
  if (diff <= 0) return 'LIVE NOW 🔴';

  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000)  / 60000);

  if (days > 0)  return `${days}d ${hours}h until event`;
  if (hours > 0) return `${hours}h ${mins}m until event`;
  return `${mins}m until event`;
}

async function loadEventBanner() {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  const banner = document.getElementById('eventBanner');
  const nameEl = document.getElementById('eventName');
  const dateEl = document.getElementById('eventDate');
  const cntEl  = document.getElementById('eventCountdown');

  banner.style.display = 'flex';
  nameEl.textContent = 'Detecting next UFC event...';

  chrome.runtime.sendMessage({ type: 'GET_UPCOMING_CARD' }, (resp) => {
    const card = resp?.card;
    if (!card) { banner.style.display = 'none'; return; }

    nameEl.textContent = card.event || 'Upcoming UFC Event';
    dateEl.textContent = card.date || '';
    cntEl.textContent  = formatCountdown(card.date);

    // Countdown tick
    setInterval(() => {
      cntEl.textContent = formatCountdown(card.date);
    }, 60000);

    // Auto-populate DEMO_DATA fighter names from the detected card
    // (lines still need to come from Pick6/Underdog, but names are pre-filled)
    if (card.fighters?.length && typeof allFighters !== 'undefined' && allFighters.length === 0) {
      debugLog(`Detected card: ${card.event} — ${card.fighters.length} fights`);
      const detected = [];
      card.fighters.forEach(({ f1, f2 }) => {
        detected.push({ name: f1, line_fp: null, line_ss: null, line_td: null, opponent: f2 });
        detected.push({ name: f2, line_fp: null, line_ss: null, line_td: null, opponent: f1 });
      });
      // Only use detected fighters if no real lines have come in yet
      chrome.storage.local.get(['lines_pick6', 'lines_underdog'], (result) => {
        const hasRealData = (result.lines_pick6?.fighters?.length || 0) + (result.lines_underdog?.fighters?.length || 0) > 0;
        if (!hasRealData) {
          showToast(`📅 Detected ${card.event} — ${card.fighters.length} fights found. Click ⚡ AUTO-FETCH LINES to get odds.`);
          allFighters = detected.map(f => ({ ...f, db: { loaded: false }, lean: { lean: 'none', conf: 0, reasons: [], verdict: '' } }));
          renderFighters();
        }
      });
    }
  });
}

// ── BOOT ─────────────────────────────────────────────────────────────────
// Platform pill switching (pills now double as platform selector)
function setActivePlatform(platform) {
  currentPlatform = platform;
  document.querySelectorAll('[data-platform]').forEach(b => b.classList.remove('platform-selected'));
  const target = document.querySelector(`[data-platform="${platform}"]`);
  if (target) target.classList.add('platform-selected');
  const nameEl = document.getElementById('platformActiveName');
  if (nameEl) nameEl.textContent = platform === 'pick6' ? 'Pick6' : platform === 'underdog' ? 'Underdog' : platform === 'prizepicks' ? 'PrizePicks' : 'Betr';
  renderFighters();
}
document.querySelectorAll('[data-platform]').forEach(btn => {
  btn.addEventListener('click', () => setActivePlatform(btn.dataset.platform));
});
// Set initial active platform indicator
setActivePlatform('pick6');

document.getElementById('refreshBtn').addEventListener('click', loadData);
document.getElementById('autoScrapeBtn')?.addEventListener('click', triggerAutoScrape);
document.getElementById('watcherToggleBtn')?.addEventListener('click', toggleWatcher);

// Load event banner + watcher status on startup
loadEventBanner();
updateWatcherUI();
// Keep watcher UI fresh every 30s
watcherUIInterval = setInterval(updateWatcherUI, 30000);

document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    currentView = view;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFighters();
  });
});

// Debug panel toggle
document.getElementById('debugToggleBtn')?.addEventListener('click', () => {
  const wrap = document.getElementById('debugPanelWrap');
  if (!wrap) return;
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'block';
  document.getElementById('debugToggleBtn').textContent = visible ? '⚡ DEBUG' : '✕ DEBUG';
});

// Event delegation for fighter table rows
document.getElementById('cardContainer').addEventListener('click', (e) => {
  const main = e.target.closest('.fighter-main');
  if (main) toggleRow(main.closest('.fighter-row'));
});

// Search input
document.getElementById('fighterSearch')?.addEventListener('input', (e) => {
  currentSearch = e.target.value || '';
  renderFighters();
});

// Sort buttons
document.querySelectorAll('.sort-btn[data-sort]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFighters();
  });
});

loadData();
setInterval(loadData, 60000);

// ── FIGHTER MODAL WIRING ──────────────────────────────────────────────────
document.getElementById('modalClose')?.addEventListener('click', () => {
  document.getElementById('fighterModal').classList.remove('open');
});
document.getElementById('fighterModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('fighterModal'))
    document.getElementById('fighterModal').classList.remove('open');
});
document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel)?.classList.add('active');
  });
});



// ── DEBUG PANEL BUTTON WIRING ─────────────────────────────────────────────
// All functions here — no inline onclick/script allowed in extension pages (CSP)

document.getElementById('dbgTestBtn')?.addEventListener('click', async () => {
  const panel = document.getElementById('debugPanel');
  panel.textContent = 'Reading stored card debug + live lines data...\n';
  const all = await new Promise(r => chrome.storage.local.get(null, r));

  // Show raw captured lines data
  for (const platform of ['pick6', 'underdog']) {
    const key = `lines_${platform}`;
    if (!all[key]) { panel.textContent += `${platform}: no lines captured\n`; continue; }
    panel.textContent += `\n=== ${platform} captured fighters (${all[key].fighters?.length}) ===\n`;
    (all[key].fighters || []).slice(0, 5).forEach(f => {
      panel.textContent += `  ${f.name}: fp=${f.line_fp ?? f.line} ss=${f.line_ss} td=${f.line_td}\n`;
    });
  }

  // Show card debug samples
  for (const platform of ['pick6', 'underdog', 'sportsbook']) {
    const key = `debug_card_${platform}`;
    if (!all[key]) { panel.textContent += `\n${platform}: no card debug — visit the page\n`; continue; }
    panel.textContent += `\n=== ${platform} card text samples ===\n`;
    (all[key].samples || []).forEach((s, i) => {
      panel.textContent += `[${i}] ${s.text?.slice(0,800)}\n`;
    });
  }
  panel.scrollTop = panel.scrollHeight;
});

document.getElementById('dbgDumpBtn')?.addEventListener('click', async () => {
  const panel = document.getElementById('debugPanel');
  panel.textContent = 'Trying UFC Stats URLs with browser headers...\n';

  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
  };

  const urls = [
    'http://www.ufcstats.com/fighter-details/0bc62e3c498b5011',
    'http://ufcstats.com/fighter-details/0bc62e3c498b5011',
  ];

  for (const url of urls) {
    try {
      panel.textContent += `GET ${url}\n`;
      const res = await fetch(url, { headers, redirect: 'follow', mode: 'cors' });
      const text = await res.text();
      panel.textContent += `Status: ${res.status} | Bytes: ${text.length} | Final URL: ${res.url}\n`;
      panel.textContent += `First 300 chars:\n${JSON.stringify(text.slice(0, 300))}\n\n`;

      if (text.length < 1000) continue;

      const trCount = (text.match(/<tr/gi)||[]).length;
      panel.textContent += `<tr> tags: ${trCount}\n`;
      ['b-fight-details__table-body','fighter-details','b-fight-details'].forEach(m => {
        panel.textContent += `  "${m}": ${text.includes(m)}\n`;
      });

      const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      const dataRow = rows.find(r => r[1].includes('fighter-details') && r[1].includes('<td'));
      if (!dataRow) { panel.textContent += 'No data row with fighter-details link found\n'; continue; }

      const tds = [...dataRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      panel.textContent += `\nDATA ROW — ${tds.length} tds:\n`;
      tds.forEach((td, i) => {
        const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
          .map(p => p[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
        if (ps.length > 0) {
          panel.textContent += `  td[${i}]: "${ps[0]?.slice(0,45)}" | "${(ps[1]||'').slice(0,45)}"\n`;
        } else {
          panel.textContent += `  td[${i}]: "${td[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,60)}"\n`;
        }
      });
      panel.textContent += `\nRAW (first 1000 chars):\n${dataRow[1].slice(0,1000)}`;
      panel.scrollTop = panel.scrollHeight;
      return;
    } catch(e) {
      panel.textContent += `EXCEPTION: ${e.name}: ${e.message}\n\n`;
    }
  }
  panel.textContent += '\nAll URLs failed — UFC Stats may be blocking cross-origin requests.\nTry the FETCH VIA BG button instead.\n';
});

document.getElementById('dbgCopyBtn')?.addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('debugPanel').textContent)
    .then(() => { document.getElementById('dbgCopyBtn').textContent = '✓ COPIED'; setTimeout(() => { document.getElementById('dbgCopyBtn').textContent = 'COPY LOG'; }, 2000); });
});

document.getElementById('dbgClearBtn')?.addEventListener('click', async () => {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const all = await new Promise(r => chrome.storage.local.get(null, r));
    const keys = Object.keys(all).filter(k => k.startsWith('ufcstats_'));
    await new Promise(r => chrome.storage.local.remove(keys, r));
    document.getElementById('debugPanel').textContent = `Cleared ${keys.length} cached entries. Reloading...`;
    setTimeout(() => location.reload(), 800);
  }
});

document.getElementById('dbgBgDumpBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('debugPanel');
  panel.textContent = 'Reading Max Holloway from cache (must be loaded in analyzer first)...\n';
  chrome.runtime.sendMessage({ type: 'GET_CACHED_HTML', name: 'Max Holloway' }, (resp) => {
    if (!resp || resp.error) {
      panel.textContent += `${resp?.error}\n`;
      panel.textContent += 'Scroll to Max Holloway in the analyzer to trigger a fetch, then try again.\n';
      return;
    }

    const html = resp.html;
    panel.textContent += `Cache hit! HTML: ${html.length} chars | URL: ${resp.detailUrl}\n`;

    // Show parsed fights we got
    panel.textContent += `\nParsed fights (${resp.fightHistory?.length}):\n`;
    (resp.fightHistory||[]).forEach((f,i) => {
      panel.textContent += `  [${i}] ${f.opponent} kd=${f.kd} sig=${f.sigStr} tot=${f.totStr} td=${f.td} ctrl=${f.ctrlSecs}s rnd=${f.round} method=${f.method}\n`;
    });

    // Now dump the raw HTML structure of first fight row
    panel.textContent += '\n--- RAW TD STRUCTURE of first data row ---\n';
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const dataRows = rows.filter(r => !r[1].includes('<th') && (r[1].match(/<td/gi)||[]).length > 5);
    panel.textContent += `Total rows: ${rows.length}, data rows: ${dataRows.length}\n`;

    if (dataRows.length > 0) {
      const row = dataRows[0][1];
      const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      panel.textContent += `TDs: ${tds.length}\n`;
      tds.forEach((td, i) => {
        const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
          .map(p => p[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
        if (ps.length > 0) {
          panel.textContent += `td[${i}]: "${ps[0]?.slice(0,45)}" | "${(ps[1]||'').slice(0,45)}"\n`;
        } else {
          panel.textContent += `td[${i}]: "${td[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,60)}"\n`;
        }
      });
      panel.textContent += `\nRAW (1500 chars):\n${row.slice(0,1500)}`;
    }
    panel.scrollTop = panel.scrollHeight;
  });
});

document.getElementById('dbgHideBtn')?.addEventListener('click', () => {
  document.getElementById('debugPanelWrap').style.display = 'none';
});

// ── BETR SCREENSHOT READER ────────────────────────────────────────────────
(function() {
  const modal       = document.getElementById('manualModal');
  const openBtn     = document.getElementById('manualEntryBtn');
  const closeBtn    = document.getElementById('manualModalClose');
  const dropZone    = document.getElementById('betrDropZone');
  const fileInput   = document.getElementById('betrFileInput');
  const imageQueue  = document.getElementById('betrImageQueue');
  const analyzeBtn  = document.getElementById('betrAnalyzeBtn');
  const analyzeStatus = document.getElementById('betrAnalyzeStatus');
  const extracted   = document.getElementById('betrExtracted');
  const extractedRows = document.getElementById('betrExtractedRows');
  const saveBtn     = document.getElementById('betrSaveBtn');
  const addRowBtn   = document.getElementById('betrAddRow');
  const saveStatus  = document.getElementById('betrSaveStatus');

  let queuedImages = []; // [{dataUrl, file}]

  closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  // ── Drag & drop ──
  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--orange)'; dropZone.style.background = 'rgba(255,122,43,0.08)'; });
  dropZone?.addEventListener('dragleave', () => { dropZone.style.borderColor = 'rgba(255,122,43,0.4)'; dropZone.style.background = 'rgba(255,122,43,0.04)'; });
  dropZone?.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(255,122,43,0.4)';
    dropZone.style.background = 'rgba(255,122,43,0.04)';
    addFiles([...e.dataTransfer.files]);
  });
  fileInput?.addEventListener('change', () => addFiles([...fileInput.files]));

  function addFiles(files) {
    files.filter(f => f.type.startsWith('image/')).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target.result;
        queuedImages.push({ dataUrl, name: file.name });
        renderQueue();
      };
      reader.readAsDataURL(file);
    });
  }

  function renderQueue() {
    imageQueue.innerHTML = '';
    queuedImages.forEach((img, i) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;display:inline-block;';
      wrap.innerHTML = `
        <img src="${img.dataUrl}" style="height:80px;width:auto;border-radius:6px;border:1px solid var(--border2);object-fit:cover;">
        <button data-i="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:10px;line-height:18px;text-align:center;">✕</button>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--text3);margin-top:2px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${img.name}</div>`;
      wrap.querySelector('button').addEventListener('click', () => { queuedImages.splice(i, 1); renderQueue(); });
      imageQueue.appendChild(wrap);
    });
    if (analyzeBtn) {
      analyzeBtn.disabled = queuedImages.length === 0;
      analyzeBtn.style.opacity = queuedImages.length > 0 ? '1' : '0.4';
    }
  }

  // ── AI extraction ──
  analyzeBtn?.addEventListener('click', async () => {
    if (!queuedImages.length) return;
    const apiKeyInput = document.getElementById('betrApiKey');
    const apiKey = apiKeyInput?.value?.trim();
    if (!apiKey) { analyzeStatus.textContent = '✗ Enter your Anthropic API key first'; return; }
    // Save key for next time
    chrome.storage.local.set({ betr_api_key: apiKey });
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '⟳ Reading...';
    analyzeStatus.textContent = `Sending ${queuedImages.length} image(s) to AI...`;
    extracted.style.display = 'none';

    try {
      // Build multi-image message
      const imageContent = queuedImages.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.dataUrl.split(';')[0].split(':')[1], data: img.dataUrl.split(',')[1] }
      }));

      const payload = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `These are screenshots from the Betr fantasy sports app showing UFC fighter prop lines. Betr currently offers Fantasy Points and Significant Strikes props only (no Takedowns). Extract every fighter's lines you can see.

Return ONLY a JSON array, no markdown, no explanation. Each object:
{"name": "First Last", "fp": number_or_null, "ss": number_or_null}

- "fp" = Fantasy Points line (typically 20-300)
- "ss" = Significant Strikes line (typically 5-300)
- Use null if that stat type is not shown for a fighter
- Include ALL fighters visible across ALL screenshots
- Use full names where visible, abbreviated names if that's all that's shown`
            }
          ]
        }]
      };

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'CLAUDE_API', payload, apiKey }, resp => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp?.error) reject(new Error(resp.error));
          else resolve(resp.data);
        });
      });

      const data = result;
      const text = data.content?.map(c => c.text || '').join('');
      let fighters = [];
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        fighters = JSON.parse(clean);
      } catch(e) {
        throw new Error('Could not parse AI response: ' + text?.slice(0, 200));
      }

      analyzeStatus.textContent = `✓ Found ${fighters.length} fighter(s)`;
      renderExtractedRows(fighters);
      extracted.style.display = 'block';
    } catch(err) {
      analyzeStatus.textContent = '✗ Error: ' + err.message;
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '🔍 READ WITH AI';
    }
  });

  function inputStyle(color) {
    return `background:var(--bg3);border:1px solid var(--border);color:${color};font-family:'IBM Plex Mono',monospace;font-size:12px;padding:4px 6px;border-radius:4px;width:100%;text-align:center;`;
  }

  function renderExtractedRows(fighters) {
    extractedRows.innerHTML = '';
    fighters.forEach((f, i) => addExtractedRow(f));
  }

  function addExtractedRow(f = {}) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:180px 80px 80px 28px;gap:6px;align-items:center;';
    row.innerHTML = `
      <input type="text"  class="betr-name" value="${f.name || ''}" placeholder="Fighter name" style="${inputStyle('var(--text)')}">
      <input type="number" class="betr-fp"  value="${f.fp  ?? ''}" placeholder="—" step="0.5" style="${inputStyle('var(--blue)')}">
      <input type="number" class="betr-ss"  value="${f.ss  ?? ''}" placeholder="—" step="0.5" style="${inputStyle('var(--gold)')}">
      <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0;">✕</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    extractedRows.appendChild(row);
  }

  addRowBtn?.addEventListener('click', () => addExtractedRow());

  // ── Auto-load UFC 326 Betr lines on open ──
  const UFC326_LINES = [
    { name: 'Luis Fernandez',        fp: 83.5,  ss: 28.5 },
    { name: 'Rafael Bellato',        fp: null,  ss: 24.5 },
    { name: 'Rodolfo Tobias',        fp: null,  ss: 20.5 },
    { name: 'Damir Nurgozhay',       fp: null,  ss: 18.5 },
    { name: 'Sumudaerji',            fp: null,  ss: 48.5 },
    { name: 'Jesus Aguilar',         fp: null,  ss: 32.5 },
    { name: 'Cameron Durden',        fp: null,  ss: 40.5 },
    { name: 'Nandor Tumendemberel',  fp: null,  ss: 33.5 },
    { name: 'Randy Turcios',         fp: null,  ss: 42.5 },
    { name: 'Adrian Montes',         fp: null,  ss: 40.5 },
    { name: 'Donte Johnson',         fp: 104.5, ss: 19.5 },
    { name: 'Chris Brundage',        fp: null,  ss: 16.5 },
    { name: 'Xuejun Long',           fp: null,  ss: 55.5 },
    { name: 'Cody Garbrandt',        fp: null,  ss: 31.5 },
    { name: 'Gilberto Rodrigues',    fp: null,  ss: 31.5 },
    { name: 'Bruno Ferreira',        fp: null,  ss: 25.5 },
    { name: 'Michael Johnson',       fp: null,  ss: 49.5 },
    { name: 'Drew Dober',            fp: null,  ss: 44.5 },
    { name: 'Raul Rosas Jr',         fp: 86.5,  ss: 29.5 },
    { name: 'Rob Font',              fp: null,  ss: 25.5 },
    { name: 'Caio Borralho',         fp: 84.5,  ss: 39.5 },
    { name: 'Reinier de Ridder',     fp: null,  ss: 25.5 },
    { name: 'Max Holloway',          fp: null,  ss: 90.5 },
    { name: 'Charles Oliveira',      fp: null,  ss: 50.5 },
    { name: 'Jonny Lee',             fp: 86.5,  ss: null },
    { name: 'Gilberto Bolanos',      fp: 50.5,  ss: null },
  ];

  openBtn?.addEventListener('click', () => {
    modal.style.display = 'block';
    if (!extractedRows.children.length) {
      extracted.style.display = 'block';
      renderExtractedRows(UFC326_LINES);
    }
  });

  // ── Save ──
  saveBtn?.addEventListener('click', () => {
    const rows = extractedRows.querySelectorAll('div');
    const fighters = [];
    rows.forEach(row => {
      const name = row.querySelector('.betr-name')?.value?.trim();
      if (!name) return;
      const fp = parseFloat(row.querySelector('.betr-fp')?.value) || null;
      const ss = parseFloat(row.querySelector('.betr-ss')?.value) || null;
      if (fp || ss) fighters.push({ name, line_fp: fp, line_ss: ss, line_td: null });
    });
    if (!fighters.length) { saveStatus.textContent = '✗ No valid lines to save'; return; }

    const data = { fighters, capturedAt: Date.now() };
    chrome.storage.local.set({ lines_betr: data }, () => {
      saveStatus.textContent = `✓ Saved ${fighters.length} Betr lines`;
      document.getElementById('countBetr').textContent = fighters.length + ' fighters';
      document.getElementById('pillBetr').classList.add('active');
      setTimeout(() => { modal.style.display = 'none'; }, 800);
      // Trigger re-render with new betr data included
      chrome.storage.local.get(['lines_pick6','lines_underdog','lines_betr'], result => {
        const p6 = result.lines_pick6?.fighters || [];
        const ud = result.lines_underdog?.fighters || [];
        const bt = result.lines_betr?.fighters || [];
        mergeAndEnrich(p6, ud, bt);
      });
    });
  });
})();


