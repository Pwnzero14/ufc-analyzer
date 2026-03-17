#!/usr/bin/env node
// run.js — UFC Fight Card Predictor
// Fetches the upcoming UFC event from ufcstats.com, scores each fighter
// using career stats + recent fight history, and writes picks to picks.txt.
//
// Usage: node run.js

const https = require('https');
const http  = require('http');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────

function fetchUrl(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
      },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirects <= 0) return reject(new Error(`Too many redirects: ${url}`));
        return fetchUrl(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));

      const enc = res.headers['content-encoding'] || '';
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());

      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── UFCSTATS HTML PARSERS ────────────────────────────────────────────────────

function parseCareerStats(html) {
  const g  = re => { const m = html.match(re); return m ? parseFloat(m[1]) : null; };
  const gs = re => { const m = html.match(re); return m ? m[1].trim() : null; };
  return {
    slpm:   g(/SLpM[\s\S]*?<\/i>\s*([\d.]+)/),
    strAcc: g(/Str\. Acc\.[\s\S]*?<\/i>\s*([\d.]+)%/),
    sapm:   g(/SApM[\s\S]*?<\/i>\s*([\d.]+)/),
    strDef: g(/Str\. Def[\s\S]*?<\/i>\s*([\d.]+)%/),
    tdAvg:  g(/TD Avg\.[\s\S]*?<\/i>\s*([\d.]+)/),
    tdAcc:  g(/TD Acc\.[\s\S]*?<\/i>\s*([\d.]+)%/),
    tdDef:  g(/TD Def\.[\s\S]*?<\/i>\s*([\d.]+)%/),
    subAvg: g(/Sub\. Avg\.[\s\S]*?<\/i>\s*([\d.]+)/),
    record: gs(/Record:\s*([\d]+-[\d]+-[\d]+)/),
    height: gs(/Height[\s\S]*?<\/i>\s*([^<\n]+)/),
    reach:  gs(/Reach[\s\S]*?<\/i>\s*([^<\n]+)/),
    stance: gs(/STANCE[\s\S]*?<\/i>\s*([^<\n]+)/),
  };
}

function parseFightHistory(html) {
  const fights = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowM of rows) {
    const row = rowM[1];
    if (row.includes('<th')) continue;
    const resultM = row.match(/>\s*(win|loss)\s*</i);
    if (!resultM) continue;
    const wl = resultM[1].toLowerCase();
    const oppLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
    if (!oppLinks.length) continue;
    const opponent = oppLinks[oppLinks.length - 1][1].trim();
    if (!opponent || opponent === '--') continue;
    const methodM = row.match(/(KO\/TKO|Submission|U-DEC|S-DEC|M-DEC|DQ|NC)/i);
    let method = 'DEC';
    if (methodM) {
      const raw = methodM[1].toUpperCase();
      method = raw === 'SUBMISSION' ? 'SUB' : raw;
    }
    const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
    fights.push({ result: wl, opponent, method, date: dateM ? dateM[0] : null });
  }
  return fights.slice(0, 10);
}

// ─── FIGHTER DATA FETCH ───────────────────────────────────────────────────────
// ufcstats.com indexes fighters by the first letter of their last name via ?char=X&page=all.
// The ?query= param is JS-filtered client-side and returns all fighters when called directly.
// We try each non-first name part's initial left-to-right to handle compound last names
// (e.g. "Jack Della Maddalena" → try char=d first, finds it immediately).

const charPageCache = {};

async function fetchCharPage(char) {
  if (charPageCache[char]) return charPageCache[char];
  const html = await fetchUrl(`http://www.ufcstats.com/statistics/fighters?char=${char}&page=all`);
  charPageCache[char] = html;
  await sleep(300);
  return html;
}

async function fetchFighterData(name) {
  try {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return null;

    let detailUrl  = null;
    const triedChars = new Set();

    // Try each non-first-name word's initial left-to-right
    for (const part of parts.slice(1)) {
      const char = part[0].toLowerCase();
      if (triedChars.has(char)) continue;
      triedChars.add(char);

      try {
        const charHtml = await fetchCharPage(char);
        for (const rowM of charHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const row   = rowM[1];
          const linkM = row.match(/href="(http:\/\/www\.ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
          if (!linkM) continue;
          const rowText = row.replace(/<[^>]+>/g, '').toLowerCase();
          // Every part of the fighter's name must appear in the row text
          if (parts.every(p => rowText.includes(p.toLowerCase()))) {
            detailUrl = linkM[1];
            break;
          }
        }
        if (detailUrl) break;
      } catch (e) { /* try next char */ }
    }

    if (!detailUrl) {
      console.log(`    [!] Not found on ufcstats: ${name}`);
      return null;
    }

    const detailHtml = await fetchUrl(detailUrl);
    await sleep(200);
    const careerStats  = parseCareerStats(detailHtml);
    const fightHistory = parseFightHistory(detailHtml);

    return { name, careerStats, fightHistory, detailUrl };
  } catch (e) {
    console.log(`    [!] Error fetching ${name}: ${e.message}`);
    return null;
  }
}

// ─── PREDICTION ENGINE ────────────────────────────────────────────────────────

function parseRecord(rec) {
  if (!rec) return { w: 0, l: 0, d: 0, total: 0 };
  const m = rec.match(/(\d+)-(\d+)-(\d+)/);
  if (!m) return { w: 0, l: 0, d: 0, total: 0 };
  const [, w, l, d] = m.map(Number);
  return { w, l, d, total: w + l + d };
}

function scoreFighter(data) {
  if (!data) return { score: 50, notes: ['No data — defaulting to 50'] };

  const { careerStats, fightHistory } = data;
  let score = 50;
  const notes = [];

  // Win rate from official record (±15 pts)
  const rec = parseRecord(careerStats.record);
  if (rec.total > 0) {
    const winRate = rec.w / rec.total;
    score += (winRate - 0.5) * 30;
    notes.push(`Record: ${careerStats.record}  (${(winRate * 100).toFixed(0)}% win rate)`);
  }

  // Recent form — last 5 fights weighted most-recent (±~13 pts)
  const recent = fightHistory.slice(0, 5);
  if (recent.length > 0) {
    let form = 0;
    recent.forEach((f, i) => {
      const w = (5 - i) / 15;
      form += f.result === 'win' ? w : -w;
    });
    score += form * 20;
    notes.push(`Recent (last ${recent.length}): ${recent.map(f => (f.result === 'win' ? 'W' : 'L')).join(' ')}`);
  }

  // Net striking: SLpM − SApM (±10 pts)
  if (careerStats.slpm != null && careerStats.sapm != null) {
    const net = careerStats.slpm - careerStats.sapm;
    score += Math.max(-10, Math.min(10, net * 2));
    notes.push(`Striking: ${careerStats.slpm} SLpM  ${careerStats.strAcc ?? '?'}% acc  /  ${careerStats.sapm} SApM  (net ${net >= 0 ? '+' : ''}${net.toFixed(2)})`);
  }

  // Finish rate bonus (+0–5 pts)
  const wins     = fightHistory.filter(f => f.result === 'win');
  const finishes = wins.filter(f => f.method === 'KO/TKO' || f.method === 'SUB');
  if (wins.length > 0) {
    const finRate = finishes.length / wins.length;
    score += finRate * 5;
    notes.push(`Finish rate: ${(finRate * 100).toFixed(0)}%  (${finishes.length}/${wins.length} wins by KO/TKO or SUB)`);
  }

  // Grappling (+0–5 pts)
  if (careerStats.tdAvg != null) {
    score += Math.min(5, careerStats.tdAvg * 1.5);
    notes.push(`Grappling: ${careerStats.tdAvg} TD/15min  ${careerStats.tdAcc ?? '?'}% acc  /  ${careerStats.subAvg ?? 0} Sub avg`);
  }

  return { score: Math.max(0, Math.min(100, score)), notes };
}

function confidenceLabel(gap) {
  if (gap >= 15) return 'HIGH';
  if (gap >= 7)  return 'MEDIUM';
  return 'LOW';
}

// Fantasy points estimate (Pick6/Underdog-style scoring)
// Sig strikes ~0.4 pts, TDs ~5 pts, finish bonus ~25 pts
function estimateFantasyPoints(data) {
  if (!data) return { fp: 0, label: 'UNKNOWN', breakdown: [] };
  const { careerStats, fightHistory } = data;
  let fp = 0;
  const breakdown = [];

  // Sig strikes per ~10 min avg fight time * 0.4 pts
  if (careerStats.slpm != null) {
    const strikes = careerStats.slpm * 10;
    const pts     = strikes * 0.4;
    fp += pts;
    breakdown.push(`Sig strikes ~${strikes.toFixed(0)}/fight × 0.4 = ${pts.toFixed(0)} pts`);
  }

  // Takedowns per fight (tdAvg is per 15 min → scale to ~10 min) × 5 pts
  if (careerStats.tdAvg != null) {
    const tds = careerStats.tdAvg * (10 / 15);
    const pts  = tds * 5;
    fp += pts;
    breakdown.push(`TDs ~${tds.toFixed(1)}/fight × 5 = ${pts.toFixed(0)} pts`);
  }

  // Expected finish bonus
  const wins     = fightHistory.filter(f => f.result === 'win');
  const finishes = wins.filter(f => f.method === 'KO/TKO' || f.method === 'SUB');
  if (wins.length > 0) {
    const finRate = finishes.length / wins.length;
    const pts     = finRate * 25;
    fp += pts;
    breakdown.push(`Finish bonus ${(finRate * 100).toFixed(0)}% × 25 = ${pts.toFixed(0)} pts`);
  }

  const label = fp >= 100 ? 'ELITE' : fp >= 70 ? 'HIGH' : fp >= 45 ? 'MEDIUM' : 'LOW';
  return { fp: Math.round(fp), label, breakdown };
}

// ─── OUTPUT FORMATTER ─────────────────────────────────────────────────────────

function buildPicksText(eventData, fights) {
  const lines = [];
  const now   = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
  const DIV   = '═'.repeat(70);
  const div   = '─'.repeat(70);

  lines.push(DIV);
  lines.push('  UFC FIGHT CARD PREDICTIONS & FANTASY PICKS');
  lines.push(DIV);
  lines.push(`  Generated : ${now} ET`);
  lines.push(`  Event     : ${eventData.name}`);
  lines.push(`  Date      : ${eventData.date}`);
  lines.push(`  Source    : ${eventData.url}`);
  lines.push(DIV);
  lines.push('');

  const summary = [];

  fights.forEach((fight, idx) => {
    const { f1Name, f2Name, f1Data, f2Data, f1Score, f2Score } = fight;

    const f1FP = estimateFantasyPoints(f1Data);
    const f2FP = estimateFantasyPoints(f2Data);

    const pickName  = f1Score.score >= f2Score.score ? f1Name : f2Name;
    const otherName = pickName === f1Name ? f2Name : f1Name;
    const pickScore  = Math.max(f1Score.score, f2Score.score);
    const otherScore = Math.min(f1Score.score, f2Score.score);
    const gap        = pickScore - otherScore;
    const conf       = confidenceLabel(gap);
    const pickFP     = pickName === f1Name ? f1FP : f2FP;

    summary.push({ pickName, otherName, conf, pickFP });

    lines.push(div);
    lines.push(`  FIGHT ${idx + 1}:  ${f1Name.toUpperCase()}  vs.  ${f2Name.toUpperCase()}`);
    lines.push(div);
    lines.push('');
    lines.push(`  ★ PICK:  ${pickName}  [${conf} confidence]  (score diff: ${gap.toFixed(1)})`);
    lines.push('');

    // Fighter 1
    lines.push(`  ${f1Name}  —  Prediction score: ${f1Score.score.toFixed(1)} / 100`);
    f1Score.notes.forEach(n => lines.push(`    • ${n}`));
    if (!f1Data) lines.push(`    • Fighter stats not found on ufcstats.com`);
    lines.push(`    Fantasy value: ${f1FP.label}  (~${f1FP.fp} FP estimated)`);
    f1FP.breakdown.forEach(b => lines.push(`      - ${b}`));
    lines.push('');

    // Fighter 2
    lines.push(`  ${f2Name}  —  Prediction score: ${f2Score.score.toFixed(1)} / 100`);
    f2Score.notes.forEach(n => lines.push(`    • ${n}`));
    if (!f2Data) lines.push(`    • Fighter stats not found on ufcstats.com`);
    lines.push(`    Fantasy value: ${f2FP.label}  (~${f2FP.fp} FP estimated)`);
    f2FP.breakdown.forEach(b => lines.push(`      - ${b}`));
    lines.push('');
  });

  // Summary table
  lines.push(DIV);
  lines.push('  PICKS AT A GLANCE');
  lines.push(DIV);
  lines.push('');
  summary.forEach((p, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}.  ${p.pickName.padEnd(28)} over  ${p.otherName.padEnd(28)} [${p.conf}]`);
  });
  lines.push('');

  // Fantasy rankings
  lines.push(DIV);
  lines.push('  FANTASY RANKINGS  (by estimated FP, highest first)');
  lines.push(DIV);
  lines.push('');
  const allPlayers = fights.flatMap(f => [
    { name: f.f1Name, ...estimateFantasyPoints(f.f1Data) },
    { name: f.f2Name, ...estimateFantasyPoints(f.f2Data) },
  ]).sort((a, b) => b.fp - a.fp);

  allPlayers.forEach((p, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}.  ${p.name.padEnd(28)} ${p.label.padEnd(8)}  ~${p.fp} FP`);
  });
  lines.push('');

  lines.push(div);
  lines.push('  METHODOLOGY');
  lines.push(div);
  lines.push('  Prediction scores weight: win rate (30%), recent form (20%),');
  lines.push('  net striking (20%), finish rate (10%), grappling (10%).');
  lines.push('  FP estimates use: sig strikes × 0.4 + TDs × 5 + finish bonus.');
  lines.push('  Data sourced from ufcstats.com. Cross-reference with current odds.');
  lines.push(div);
  lines.push('');

  return lines.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('┌─────────────────────────────────────┐');
  console.log('│   UFC Fight Card Predictor — run.js │');
  console.log('└─────────────────────────────────────┘');

  // 1. Fetch upcoming events list
  console.log('\n[1/3] Fetching upcoming events from ufcstats.com...');
  let eventData;
  try {
    const html   = await fetchUrl('http://www.ufcstats.com/statistics/events/upcoming?page=all');
    const events = [];

    for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
      if (!linkM) continue;
      const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
      const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
      if (!nameM || !dateM) continue;
      events.push({ name: nameM[1].trim(), date: dateM[0], url: linkM[1] });
    }

    if (!events.length) throw new Error('No upcoming events found on the page');
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    eventData = events[0];
    console.log(`    → ${eventData.name} (${eventData.date})`);
  } catch (e) {
    console.error('    FAILED:', e.message);
    process.exit(1);
  }

  // 2. Fetch fight card
  console.log('\n[2/3] Fetching fight card...');
  let matchups = [];
  try {
    await sleep(500);
    const evHtml = await fetchUrl(eventData.url);

    for (const rowM of evHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row = rowM[1];
      if (row.includes('<th')) continue;
      const nameLinks = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
      if (nameLinks.length < 2) continue;
      const f1 = nameLinks[0][1].trim();
      const f2 = nameLinks[1][1].trim();
      if (f1 && f2 && f1 !== '--' && f2 !== '--') matchups.push({ f1, f2 });
    }

    if (!matchups.length) throw new Error('No fights found on the event page');
    console.log(`    → ${matchups.length} fights found`);
    matchups.forEach(({ f1, f2 }, i) => console.log(`      ${i + 1}. ${f1} vs ${f2}`));
  } catch (e) {
    console.error('    FAILED:', e.message);
    process.exit(1);
  }

  // 3. Fetch stats for each fighter
  console.log('\n[3/3] Fetching fighter stats (may take a moment)...');
  const fights = [];
  for (const { f1, f2 } of matchups) {
    console.log(`\n  ${f1} vs ${f2}`);
    console.log(`    Fetching: ${f1}`);
    const f1Data = await fetchFighterData(f1);
    await sleep(400);
    console.log(`    Fetching: ${f2}`);
    const f2Data = await fetchFighterData(f2);
    await sleep(400);
    fights.push({
      f1Name:  f1,
      f2Name:  f2,
      f1Data,
      f2Data,
      f1Score: scoreFighter(f1Data),
      f2Score: scoreFighter(f2Data),
    });
  }

  // 4. Write picks
  const output  = buildPicksText(eventData, fights);
  const outPath = path.join(__dirname, 'picks.txt');
  fs.writeFileSync(outPath, output, 'utf8');

  console.log('\n' + '─'.repeat(50));
  console.log(`Picks written → ${outPath}`);
  console.log('─'.repeat(50));
  console.log('QUICK PICKS:');
  fights.forEach((f, i) => {
    const pick = f.f1Score.score >= f.f2Score.score ? f.f1Name : f.f2Name;
    const opp  = pick === f.f1Name ? f.f2Name : f.f1Name;
    const gap  = Math.abs(f.f1Score.score - f.f2Score.score);
    console.log(`  ${i + 1}. ${pick} over ${opp}  [${confidenceLabel(gap)}]`);
  });
  console.log('─'.repeat(50));
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
