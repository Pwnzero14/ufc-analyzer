// HTML parsers for UFCStats fighter pages. Pure functions over raw HTML —
// no DOM, no module state, no fetch. Splits the per-fighter detail page
// into career stats, fight history rows, and per-fight detail tables for
// both the focal fighter and their opponent.
import type { CareerStats } from '../types/index.js';

export interface OppStats { oppName?: string|null; kd?: number|null; sigStr?: number|null; sigStrR1?: number|null; totStr?: number|null; td?: number|null; sub?: number|null; ctrlSecs?: number|null }
export interface UFCFightHistory { result: string; opponent: string; event: string; method: string; round: number|null; date: string|null; kd?: number|null; sigStr?: number|null; sigStrR1?: number|null; totStr?: number|null; td?: number|null; sub?: number|null; rev?: number|null; ctrlSecs?: number|null; timeSecs?: number|null; oppStats?: OppStats|null; fightUrl?: string }

export function parseCareerStats(html: string): CareerStats {
  const stats: CareerStats = {};
  const li = (label: string): string|null => {
    const re = new RegExp('<i[^>]*>\\s*' + label + ':?\\s*<\\/i>([^<]*)', 'i');
    const m = html.match(re);
    if (!m) return null;
    return m[1].replace(/&nbsp;/g, ' ').trim() || null;
  };
  const liNum = (label: string): number|null => { const v = li(label); return v ? parseFloat(v) : null; };
  const liPct = (label: string): number|null => {
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
  stats.record = recM ? recM[1] : undefined;
  const htM = html.match(/Height[^<]*<\/i>([^<\n]+)/i);
  stats.height = htM ? htM[1].replace(/&nbsp;/g,' ').trim() : undefined;
  const stanceM = html.match(/(?:STANCE|Stance)[^<]*<\/i>([^<\n]+)/i);
  stats.stance = stanceM ? stanceM[1].replace(/&nbsp;/g,' ').trim() : undefined;
  return stats;
}

export function parseFightHistoryLinks(html: string): UFCFightHistory[] {
  const fights: UFCFightHistory[] = [];
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowM[1];
    if (row.includes('<th')) continue;
    const fightLinkM = row.match(/href="(http[^"]*fight-details\/[a-f0-9]+)"/i);
    if (!fightLinkM) continue;
    const resultM = row.match(/>\s*(win|loss|draw|nc)\s*</i);
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
    let round: number|null = null;
    for (const t of tds) {
      if (t.includes(':')) continue;
      const n = parseInt(t);
      if (!isNaN(n) && n >= 1 && n <= 5 && t.trim().length <= 2) { round = n; break; }
    }
    fights.push({ result: wl, opponent, event, method, round, date, fightUrl: fightLinkM[1] });
  }
  return fights;
}

export function parseFightDetailStats(html: string, fighterName: string, fighterDetailUrl: string|null): { kd?: number|null; sigStr?: number|null; sigStrR1?: number|null; totStr?: number|null; td?: number|null; sub?: number|null; rev?: number|null; ctrlSecs?: number|null; timeSecs?: number|null; method?: string|null; round?: number|null } {
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s: string) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  let detailMethod: string|null = null;
  let detailRound: number|null = null;

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
  const roundM = html.match(/Round:\s*<\/i>\s*(?:<[^>]+>\s*)*(\d+)/i)
    || html.match(/Round:\s*(\d+)/i);
  if (roundM) detailRound = parseInt(roundM[1]);
  let detailTimeSecs: number|null = null;
  const timeM = html.match(/Time:\s*<\/i>\s*(?:<[^>]+>\s*)*(\d+):(\d{2})/i)
    || html.match(/Time:\s*(\d+):(\d{2})/i)
    || html.match(/\b(\d+):(\d{2})\b(?=[^<]*$)/i);
  if (timeM) {
    const roundClockSecs = parseInt(timeM[1]) * 60 + parseInt(timeM[2]);
    // UFCStats "Time" is the stoppage clock within the final round, not full fight duration.
    // Convert to total elapsed seconds so FT charts/leans use true duration minutes.
    if (detailRound && detailRound >= 1) detailTimeSecs = ((detailRound - 1) * 5 * 60) + roundClockSecs;
    else detailTimeSecs = roundClockSecs;
  }

  // UFCStats fight detail page has two tables matching kd+ctrl headers:
  //   [0] Totals (one data row per fighter, aggregated across all rounds)
  //   [1] Per-round Totals (multiple data rows per fighter — first row = Round 1)
  const kdCtrlTables: string[] = [];
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      kdCtrlTables.push(tableHtml);
    }
  }
  const totalsTable = kdCtrlTables[0] || null;
  const perRoundTable = kdCtrlTables[1] || null;
  if (!totalsTable) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

  const rows = [...totalsTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const dataRows = rows.filter(r => !r[1].includes('<th') && r[1].includes('<td'));
  if (dataRows.length === 0) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

  const row = dataRows[0][1];
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
    const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
    return ps;
  });
  if (tds.length === 0) return { method: detailMethod, round: detailRound, timeSecs: detailTimeSecs };

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
  if (fIdx === 0 && tds[0]) {
    const nameParts = fighterName.toLowerCase().split(' ').filter(p => p.length > 2);
    if (tds[0][1] && nameParts.every(p => tds[0][1].toLowerCase().includes(p))) fIdx = 1;
  }

  const val = (colIdx: number) => tds[colIdx]?.[fIdx] || tds[colIdx]?.[0] || '';
  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  const sub    = firstNum(val(7));
  const rev    = firstNum(val(8));
  let ctrlSecs: number|null = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);

  // Per-round R1 sig strikes: parse first data row of the Per-round Totals table.
  // Same column layout as Totals; same fIdx (fighter position within <p> tags).
  let sigStrR1: number|null = null;
  if (perRoundTable) {
    const prRows = [...perRoundTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .filter(r => !r[1].includes('<th') && r[1].includes('<td'));
    if (prRows.length > 0) {
      const r1Tds = [...prRows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
        const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
        return ps;
      });
      const r1Val = (colIdx: number) => r1Tds[colIdx]?.[fIdx] || r1Tds[colIdx]?.[0] || '';
      sigStrR1 = firstNum(r1Val(2));
    }
  }

  return { kd, sigStr, sigStrR1, totStr, td, sub, rev, ctrlSecs, timeSecs: detailTimeSecs, method: detailMethod, round: detailRound };
}

export function parseFightDetailStatsOpponent(html: string, fighterName: string, fighterDetailUrl: string|null): OppStats|null {
  const clean = (s: string) => (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  const firstNum = (s: string) => { const m = (s||'').match(/(\d+)/); return m ? parseInt(m[1]) : null; };

  const kdCtrlTables: string[] = [];
  for (const tableM of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableM[1];
    const thead = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    const headers = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(h => h[1].replace(/<[^>]+>/g,'').trim().toLowerCase());
    if (headers.some(h => h === 'kd') && headers.some(h => h.includes('ctrl'))) {
      kdCtrlTables.push(tableHtml);
    }
  }
  const totalsTable = kdCtrlTables[0] || null;
  const perRoundTable = kdCtrlTables[1] || null;
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

  const td0Html = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)][0]?.[1] || '';
  const nameLinks = [...td0Html.matchAll(/href=(?:["']?)http[^"'\s>]*fighter-details\/[a-f0-9]+[^"'\s>]*[>\s]+([^<]+)/gi)];
  const oppName = nameLinks[oppIdx]?.[1]?.trim() || null;

  const val = (colIdx: number) => tds[colIdx]?.[oppIdx] || tds[colIdx]?.[0] || '';
  const kd     = firstNum(val(1));
  const sigStr = firstNum(val(2));
  const totStr = firstNum(val(4));
  const td     = firstNum(val(5));
  const sub    = firstNum(val(7));
  let ctrlSecs: number|null = null;
  const ctrlM  = val(9).match(/(\d+):(\d{2})/);
  if (ctrlM) ctrlSecs = parseInt(ctrlM[1]) * 60 + parseInt(ctrlM[2]);

  // R1 sig strikes for the opponent (= R1 SS allowed by the focal fighter).
  let sigStrR1: number|null = null;
  if (perRoundTable) {
    const prRows = [...perRoundTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .filter(r => !r[1].includes('<th') && r[1].includes('<td'));
    if (prRows.length > 0) {
      const r1Tds = [...prRows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => {
        const ps = [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => clean(p[1]));
        return ps;
      });
      const r1Val = (colIdx: number) => r1Tds[colIdx]?.[oppIdx] || r1Tds[colIdx]?.[0] || '';
      sigStrR1 = firstNum(r1Val(2));
    }
  }

  return { oppName, kd, sigStr, sigStrR1, totStr, td, sub, ctrlSecs };
}
