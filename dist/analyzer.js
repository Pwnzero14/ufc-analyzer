import { NAME_ALIASES } from './config/index.js';
import { PropArchiveService, PropLinePredictorService } from './services/index.js';
import { ufcstatsFetchText } from './services/ufcstats-fetch.js';
import { _weightMissSignals, parseWeightMissFromTitle, severityFromLbs, MANUAL_WEIGHT_MISS_KEY } from './analyzer/weight-miss.js';
import { _newsCache, _newsAlertFighters, NEWS_INJURY_KEYWORDS, fetchFighterNews, } from './analyzer/news.js';
import { calcFPForPlatform, getFightFantasyValueForPlatform, isFinish, deriveStyle, } from './analyzer/fantasy-scoring.js';
import { DEFAULT_VENUE, resolveVenueFactor } from './analyzer/venue-factors.js';
import { fetchFighterImageUrl, fetchFighterCountry } from './analyzer/fighter-image.js';
import { styleMatchupEdge, calcOpponentDefenseScore, calcMatchupPatternEdge, } from './analyzer/style-matchup.js';
import { parseCareerStats, parseFightHistoryLinks, parseFightDetailStats, parseFightDetailStatsOpponent, } from './analyzer/parsers.js';
import { detectStreak, calcWeightedAvgFP, calcFPStats, calcPerRoundFP, } from './analyzer/analytics-helpers.js';
function createEmptyLean(verdict = '') {
    return { lean: 'none', conf: 0, reasons: [], verdict };
}
function createPlaceholderAnalyzerFighter(name, opponent) {
    return {
        name,
        line_p6: null,
        line_p6_ss: null,
        line_p6_td: null,
        line_p6_ft: null,
        line_p6_ctrl: null,
        line_ud: null,
        line_ud_ss: null,
        line_ud_ss_r1: null,
        line_ud_ss_body: null,
        line_ud_ss_leg: null,
        line_ud_td: null,
        line_ud_ft: null,
        line_ud_ctrl: null,
        line_betr: null,
        line_betr_ss: null,
        line_betr_td: null,
        line_betr_ft: null,
        line_betr_ctrl: null,
        line_pp: null,
        line_pp_ss: null,
        line_pp_ss_r1: null,
        line_pp_ss_body: null,
        line_pp_ss_leg: null,
        line_pp_td: null,
        line_pp_ft: null,
        line_pp_ctrl: null,
        moneyline: null,
        opponent,
        db: { loaded: false },
        lean: createEmptyLean(),
        lean_ss: null,
        lean_ss_r1: null,
        lean_td: null,
        lean_ft: null,
        lean_ctrl: null,
        line_dk_ss: null,
        line_dk_td: null,
        line_dk_ft: null,
        line_dk_ctrl: null,
    };
}
// ── MODULE STATE ───────────────────────────────────────────────────────────
const debugMessages = [];
const statsCache = {};
const statsCachePromises = {};
// Manual style overrides — bypass deriveStyle's threshold classifier when the
// user knows better (e.g. Costa flagged grappler from sub finishes vs lower
// competition but is actually a brawler; Allen flagged balanced but has the
// grappling edge in a specific matchup). Loaded from chrome.storage.local at
// init, read synchronously by buildFighterDB.
const FIGHTER_STYLE_OVERRIDE_KEY = 'fighter_style_override_v1';
const _fighterStyleOverrides = new Map();
let currentView = 'all';
let currentPlatform = 'pick6';
let trendWindow = 3; // 0 = career (no windowed chip)
let allFighters = [];
let _leanCache = null;
let _fighterByNorm = null;
// Fighter-level archive accuracy: normName → propType → {hits, total}
let _fighterArchiveStats = null;
// Per-fighter open→current drift for unresolved archive rows. Keyed by lowercased normalized fighter name,
// then propType, then lowercased platform. Used to apply a market-validation bump to live AI confidence.
let _fighterClvDrift = null;
const CONFIDENCE_MEMORY_VERSION = 1;
let _confidenceMemoryCache = null;
const _archetypeLearnerCache = new Map();
/** Normalize an archive result for comparison with its line.
 *  FT results were historically stored in seconds; lines are in minutes. */
function normalizeArchiveResult(propType, result) {
    if (propType === 'FightTime' && result > 25)
        return result / 60;
    return result;
}
async function loadFighterArchiveStats() {
    const payload = await storageGet([STORAGE_PROP_ARCHIVE_KEY]);
    const rows = Array.isArray(payload[STORAGE_PROP_ARCHIVE_KEY])
        ? payload[STORAGE_PROP_ARCHIVE_KEY]
        : [];
    const map = new Map();
    for (const r of rows) {
        if (!r.fighter || !Number.isFinite(Number(r.line)) || !Number.isFinite(Number(r.result)))
            continue;
        const key = (normalizeName(r.fighter) || r.fighter).toLowerCase();
        const pt = String(r.propType || 'Unknown');
        if (!map.has(key))
            map.set(key, {});
        const entry = map.get(key);
        if (!entry[pt])
            entry[pt] = { hits: 0, total: 0 };
        entry[pt].total++;
        if (normalizeArchiveResult(pt, Number(r.result)) > Number(r.line))
            entry[pt].hits++;
    }
    _fighterArchiveStats = map;
}
async function loadFighterClvDrift() {
    const payload = await storageGet([STORAGE_PROP_ARCHIVE_KEY]);
    const rows = Array.isArray(payload[STORAGE_PROP_ARCHIVE_KEY])
        ? payload[STORAGE_PROP_ARCHIVE_KEY]
        : [];
    const map = new Map();
    for (const r of rows) {
        if (!r.fighter)
            continue;
        if (Number.isFinite(Number(r.result)))
            continue; // resolved — not a live market
        const openLine = Number(r.openLine);
        const line = Number(r.line);
        if (!Number.isFinite(openLine) || !Number.isFinite(line))
            continue;
        const key = (normalizeName(r.fighter) || r.fighter).toLowerCase();
        const pt = String(r.propType || 'Unknown');
        const plat = String(r.platform || '').toLowerCase();
        if (!map.has(key))
            map.set(key, {});
        const byProp = map.get(key);
        if (!byProp[pt])
            byProp[pt] = {};
        byProp[pt][plat] = { openLine, line };
    }
    _fighterClvDrift = map;
}
// ── NEWS CACHE ─────────────────────────────────────────────────────────────
// NewsItem, _newsCache, _newsAlertFighters, NEWS_INJURY_KEYWORDS, fetchFighterNews
// extracted to ./analyzer/news.ts — re-imported via the import block above.
// ── WEIGHT-MISS DETECTION ──────────────────────────────────────────────────
// Extracted to ./analyzer/weight-miss.ts — re-exported via the import above.
let fightOddsMoneylineByName = {};
// DK bonus payloads captured alongside moneylines (representing-country codes
// and DK's own vig-free win probabilities).
let dkCountryByName = {};
let dkTrueProbByName = {};
let dkBetHandleByName = {};
let currentSearch = '';
let currentSort = 'default';
let sourceVisibility = {
    p6: true,
    ud: true,
    pp: true,
    betr: true,
    dk: true,
};
let currentDensity = 'detailed';
let currentHistoryDensity = 'compact';
let recentLineMoves = [];
let latestValueSpikeByFighter = {};
let isDataLoadInFlight = false;
let queuedDataReload = false;
let bestPicksRenderSeq = 0;
// Display-only name prettifier — restores apostrophes the fantasy platforms strip
// (e.g. "Sean Omalley" -> "Sean O'Malley"). Lookups, keys, and storage keep the raw name.
const PRETTY_SURNAMES = {
    omalley: "O'Malley",
    oneill: "O'Neill",
    osullivan: "O'Sullivan",
    obrien: "O'Brien",
    oconnell: "O'Connell",
    oconnor: "O'Connor",
};
// Count-up ticker for metric strip values. Parses the numeric part of strings
// like "67%", "+60%", "14" and tweens it; non-numeric strings are set directly.
function animateNumberText(el, value, durationMs = 700) {
    const m = value.match(/^([+-]?)(\d+(?:\.\d+)?)(.*)$/);
    if (!m || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = value;
        return;
    }
    const sign = m[1], target = parseFloat(m[2]), suffix = m[3];
    const decimals = m[2].includes('.') ? m[2].split('.')[1].length : 0;
    const start = performance.now();
    const tick = (now) => {
        const p = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = `${sign}${(target * eased).toFixed(decimals)}${suffix}`;
        if (p < 1)
            requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
// Country name -> compact code for the avatar badge (fallback: first 3 letters)
const COUNTRY_SHORT = {
    'United States': 'USA', 'Brazil': 'BRA', 'Russia': 'RUS', 'United Kingdom': 'GBR',
    'England': 'ENG', 'Ireland': 'IRL', 'Mexico': 'MEX', 'Canada': 'CAN', 'Australia': 'AUS',
    'New Zealand': 'NZL', 'Georgia': 'GEO', 'Spain': 'ESP', 'France': 'FRA', 'Germany': 'GER',
    'Poland': 'POL', 'Sweden': 'SWE', 'Netherlands': 'NED', 'Nigeria': 'NGR', 'Cameroon': 'CMR',
    'South Africa': 'RSA', 'China': 'CHN', 'Japan': 'JPN', 'South Korea': 'KOR',
    'Kazakhstan': 'KAZ', 'Kyrgyzstan': 'KGZ', 'Uzbekistan': 'UZB', 'Tajikistan': 'TJK',
    'Azerbaijan': 'AZE', 'Armenia': 'ARM', 'Chile': 'CHI', 'Argentina': 'ARG', 'Peru': 'PER',
    'Ecuador': 'ECU', 'Venezuela': 'VEN', 'Cuba': 'CUB', 'Jamaica': 'JAM', 'Italy': 'ITA',
    'Switzerland': 'SUI', 'Austria': 'AUT', 'Czech Republic': 'CZE', 'Slovakia': 'SVK',
    'Serbia': 'SRB', 'Croatia': 'CRO', 'Bosnia and Herzegovina': 'BIH', 'Moldova': 'MDA',
    'Romania': 'ROU', 'Ukraine': 'UKR', 'Belarus': 'BLR', 'Lithuania': 'LTU', 'Iceland': 'ISL',
    'Norway': 'NOR', 'Denmark': 'DEN', 'Finland': 'FIN', 'Portugal': 'POR', 'Morocco': 'MAR',
    'Iran': 'IRI', 'Israel': 'ISR', 'Turkey': 'TUR', 'Thailand': 'THA', 'Philippines': 'PHI',
    'Indonesia': 'INA', 'India': 'IND', 'Mongolia': 'MGL', 'Scotland': 'SCO', 'Wales': 'WAL',
};
function countryShort(c) {
    return COUNTRY_SHORT[c] ?? c.slice(0, 3).toUpperCase();
}
// Hydrates any .bp-avatar-img[data-name] inside root from the cached headshot pipeline.
function hydrateAvatarImgs(root) {
    root.querySelectorAll('.bp-avatar-img[data-name]').forEach(img => {
        const nm = img.dataset['name'] || '';
        if (!nm || img.src)
            return;
        void fetchFighterImageUrl(nm)
            .then(url => {
            if (!url)
                return;
            img.onload = () => img.parentElement?.classList.add('has-img');
            img.src = url;
        })
            .catch(() => { });
    });
}
// ── "Since you were away" briefing ─────────────────────────────────────────
// Snapshots active lines + effective leans per visit (localStorage) and shows
// a dismissible strip summarizing what changed while you were gone.
const VISIT_SNAPSHOT_KEY = 'visit_snapshot_v1';
function renderVisitBriefing() {
    const el = document.getElementById('visitBriefing');
    if (!el || !allFighters.length)
        return;
    let prev = null;
    try {
        prev = JSON.parse(localStorage.getItem(VISIT_SNAPSHOT_KEY) || 'null');
    }
    catch {
        prev = null;
    }
    const lines = {};
    const leans = {};
    const stats = ['fp', 'ss', 'td', 'ft', 'ctrl'];
    for (const f of allFighters) {
        leans[f.name] = getEffectiveLean(f).lean;
        for (const s of stats) {
            const ln = getSourceActiveLine(f, s);
            if (ln != null && Number.isFinite(Number(ln)))
                lines[`${f.name}|${s}`] = Number(ln);
        }
    }
    const snap = { ts: Date.now(), lines, leans };
    const save = () => { try {
        localStorage.setItem(VISIT_SNAPSHOT_KEY, JSON.stringify(snap));
    }
    catch { /* quota */ } };
    if (!prev) {
        save();
        return;
    }
    const gapMs = Date.now() - prev.ts;
    if (gapMs < 30 * 60 * 1000)
        return; // same visit cluster — keep baseline
    if (gapMs > 7 * 24 * 3600 * 1000) {
        save();
        return;
    } // ancient snapshot — not meaningful
    const moves = [];
    for (const [k, v] of Object.entries(lines)) {
        const pv = prev.lines[k];
        if (pv != null && Math.abs(v - pv) >= 0.5) {
            const [name, stat] = k.split('|');
            moves.push({ name, stat: (stat || '').toUpperCase(), from: pv, to: v, d: v - pv });
        }
    }
    moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const flips = [];
    for (const [name, lv] of Object.entries(leans)) {
        const pv = prev.leans[name];
        if (pv != null && pv !== lv && (lv === 'over' || lv === 'under'))
            flips.push({ name, from: pv, to: lv });
    }
    if (!moves.length && !flips.length) {
        save();
        el.classList.add('is-hidden');
        return;
    }
    const ago = gapMs < 3600e3 ? `${Math.round(gapMs / 60000)}m` : gapMs < 86400e3 ? `${Math.round(gapMs / 3600e3)}h` : `${Math.round(gapMs / 86400e3)}d`;
    const big = moves[0];
    const movesStr = moves.length
        ? `<span class="vb-item">📈 <b>${moves.length}</b> line${moves.length > 1 ? 's' : ''} moved${big ? ` · biggest: <b>${prettyName(big.name)}</b> ${big.stat} ${big.from}→${big.to} <span class="${big.d > 0 ? 'vb-up' : 'vb-down'}">${big.d > 0 ? '▲' : '▼'}${Math.abs(big.d).toFixed(1)}</span>` : ''}</span>`
        : '';
    const flipsStr = flips.length
        ? `<span class="vb-item">🔄 <b>${flips.length}</b> lean${flips.length > 1 ? 's' : ''} flipped: ${flips.slice(0, 3).map(x => `<b>${prettyName(x.name)}</b> ${x.from === 'none' ? '' : x.from.toUpperCase() + '→'}${x.to.toUpperCase()}`).join(', ')}${flips.length > 3 ? '…' : ''}</span>`
        : '';
    el.innerHTML = `<span class="vb-title">⏱ Since your last visit · ${ago} ago</span>${movesStr}${flipsStr}<button class="vb-close" title="Dismiss">✕</button>`;
    el.classList.remove('is-hidden');
    el.querySelector('.vb-close')?.addEventListener('click', () => el.classList.add('is-hidden'));
    save();
}
// Shimmer skeleton shown while heavy panels (archive/calibration) load.
function loadingSkeleton(label) {
    const section = `<div class="skel-section"><div class="skel-bar skel-title"></div><div class="skel-bar"></div><div class="skel-bar skel-w70"></div><div class="skel-bar skel-w45"></div></div>`;
    return `<div class="skel-wrap" aria-label="${label}" title="${label}">${section}${section}${section}</div>`;
}
function prettyName(name) {
    const raw = (name ?? '').toString();
    if (!raw)
        return raw;
    return raw.split(' ').map(w => {
        const key = w.toLowerCase().replace(/[^a-z]/g, '');
        const mapped = PRETTY_SURNAMES[key];
        if (!mapped)
            return w;
        return w === w.toUpperCase() && w.length > 2 ? mapped.toUpperCase() : mapped;
    }).join(' ');
}
let eventCountdownTimer = null;
let periodicRefreshTimer = null;
let upcomingCardPairs = [];
let upcomingEventName = '';
let upcomingEventTs = 0;
let inferredEventNameFromLines = '';
// Cancelled fighters — excluded from display/archival even if DFS sites still list them
const CANCELLED_FIGHTERS_KEY = 'cancelled_fighters';
let cancelledFighterNames = new Set();
let cancelledFightPairs = [];
// Maps normalized fighter name → scheduled rounds (3 or 5) from upcoming card scrape
const scheduledRoundsMap = new Map();
// VENUE_DB / VenueFactorEntry / DEFAULT_VENUE / resolveVenueFactor extracted
// to ./analyzer/venue-factors.ts — re-imported via the import block above.
let currentVenueFactor = DEFAULT_VENUE;
let currentVenueLabel = '';
function buildEventDisplayName(event, fighters) {
    if (/\bvs\.?\b/i.test(event))
        return event;
    const pair = fighters?.find(f => f.scheduledRounds === 5) || fighters?.[0];
    if (!pair)
        return event;
    const lastName = (s) => s.trim().split(/\s+/).pop() || s;
    return `${event}: ${lastName(pair.f1)} vs. ${lastName(pair.f2)}`;
}
;
function strictCardNameMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb)
        return false;
    if (na === nb)
        return true;
    const aParts = na.split(' ');
    const bParts = nb.split(' ');
    // Single-word name (e.g. platform opponent listed as just "Valenzuela")
    // matches the multi-word side's last word, gated on a distinctive length
    // to avoid common-surname collisions like "Silva" or "Jones".
    if (aParts.length === 1 || bParts.length === 1) {
        const single = aParts.length === 1 ? aParts[0] : bParts[0];
        const multi = aParts.length === 1 ? bParts : aParts;
        if (multi.length < 2)
            return false;
        if (single.length < 6)
            return false;
        return multi[multi.length - 1] === single;
    }
    const aFirst = aParts[0];
    const aLast = aParts[aParts.length - 1];
    const bFirst = bParts[0];
    const bLast = bParts[bParts.length - 1];
    if (aLast === bLast && aFirst[0] === bFirst[0] && (aFirst.length >= 3 || bFirst.length >= 3)) {
        return true;
    }
    // Compressed-form fallback: platforms may drop middle/trailing surnames that
    // UFCStats keeps (e.g. "Norma Dumont" vs "Norma Dumont Viana",
    // "Talita Alencar" vs "Ana Talita De Oliviera Alencar"). Match if every word
    // of the shorter name appears in the longer name in the same order, and at
    // least 2 words line up — enough signal to avoid coincidental first-name
    // collisions.
    const [shortParts, longParts] = aParts.length <= bParts.length ? [aParts, bParts] : [bParts, aParts];
    let li = 0;
    let matched = 0;
    for (const sw of shortParts) {
        while (li < longParts.length && longParts[li] !== sw)
            li++;
        if (li >= longParts.length)
            break;
        matched++;
        li++;
    }
    return matched === shortParts.length && matched >= 2;
}
function findOpponentFromUpcomingCard(name) {
    for (const pair of upcomingCardPairs) {
        if (strictCardNameMatch(name, pair.f1))
            return pair.f2;
        if (strictCardNameMatch(name, pair.f2))
            return pair.f1;
    }
    return null;
}
function isUpcomingCardFighter(name) {
    if (!name || !upcomingCardPairs.length)
        return false;
    if (cancelledFighterNames.has((normalizeName(name) || name).toLowerCase()))
        return false;
    return upcomingCardPairs.some((pair) => strictCardNameMatch(name, pair.f1) || strictCardNameMatch(name, pair.f2));
}
function isCancelledFighter(name) {
    if (!name)
        return false;
    return cancelledFighterNames.has((normalizeName(name) || name).toLowerCase());
}
async function loadCancelledFighters() {
    try {
        const data = await storageGet([CANCELLED_FIGHTERS_KEY]);
        const cf = data[CANCELLED_FIGHTERS_KEY];
        const eventKey = (upcomingEventName || inferredEventNameFromLines || '').toLowerCase();
        if (cf && typeof cf === 'object' && Array.isArray(cf.names) && cf.event?.toLowerCase() === eventKey) {
            cancelledFighterNames = new Set(cf.names.map((n) => n.toLowerCase()));
            cancelledFightPairs = Array.isArray(cf.pairs) ? cf.pairs : [];
        }
        else {
            cancelledFighterNames = new Set();
            cancelledFightPairs = [];
        }
    }
    catch {
        cancelledFighterNames = new Set();
        cancelledFightPairs = [];
    }
}
async function saveCancelledFighters() {
    const eventKey = upcomingEventName || inferredEventNameFromLines || '';
    if (!eventKey || cancelledFighterNames.size === 0) {
        cancelledFightPairs = [];
        try {
            await new Promise(r => chrome.storage.local.remove([CANCELLED_FIGHTERS_KEY], r));
        }
        catch { }
        return;
    }
    const payload = { event: eventKey, names: Array.from(cancelledFighterNames), pairs: cancelledFightPairs };
    await new Promise((res) => chrome.storage.local.set({ [CANCELLED_FIGHTERS_KEY]: payload }, res));
}
async function cancelFight(f1, f2) {
    const n1 = (normalizeName(f1) || f1).toLowerCase();
    const n2 = (normalizeName(f2) || f2).toLowerCase();
    if (n1)
        cancelledFighterNames.add(n1);
    if (n2)
        cancelledFighterNames.add(n2);
    cancelledFightPairs.push({ f1, f2 });
    await saveCancelledFighters();
    showToast(`Fight cancelled: ${f1} vs ${f2} — hidden from lines`);
    requestDataReload();
}
async function restoreCancelledFight(f1, f2) {
    const n1 = (normalizeName(f1) || f1).toLowerCase();
    const n2 = (normalizeName(f2) || f2).toLowerCase();
    cancelledFighterNames.delete(n1);
    cancelledFighterNames.delete(n2);
    cancelledFightPairs = cancelledFightPairs.filter(p => (normalizeName(p.f1) || p.f1).toLowerCase() !== n1 || (normalizeName(p.f2) || p.f2).toLowerCase() !== n2);
    await saveCancelledFighters();
    showToast(`Restored: ${f1} vs ${f2}`);
    requestDataReload();
}
function filterPayloadToUpcomingCard(payload) {
    if (!payload?.fighters?.length || !upcomingCardPairs.length)
        return payload || null;
    // If the cached card is >10 days away it's the wrong event — don't filter.
    if (Number.isFinite(upcomingEventTs) && upcomingEventTs - Date.now() > 10 * 24 * 60 * 60 * 1000)
        return payload;
    const fighters = payload.fighters.filter((fighter) => {
        const fighterName = normalizeName(String(fighter?.name || ''));
        const opponentName = normalizeName(String(fighter?.opponent || ''));
        if (isUpcomingCardFighter(fighterName))
            return true;
        if (opponentName && isUpcomingCardFighter(opponentName))
            return true;
        return false;
    });
    // Safety: if matching is too sparse, the cached card is likely stale and would hide valid lines.
    // In that case pass through unfiltered instead of showing a misleading tiny subset.
    const matchRatio = fighters.length / Math.max(1, payload.fighters.length);
    if (fighters.length === 0 || matchRatio < 0.5)
        return payload;
    return { ...payload, fighters };
}
function pruneOrphanFighters(payload) {
    if (!payload?.fighters?.length)
        return payload || null;
    // Only prune on larger slates where orphan rows are almost always stale carry-over.
    if (payload.fighters.length < 10)
        return payload;
    const fighters = payload.fighters.filter((fighter) => {
        const name = normalizeName(String(fighter?.name || ''));
        const opponent = normalizeName(String(fighter?.opponent || ''));
        if (!name)
            return false;
        return !!opponent;
    });
    if (!fighters.length)
        return payload;
    return { ...payload, fighters };
}
function inferEventNameFromPayloads(payloads) {
    const pairCounts = new Map();
    for (const payload of payloads) {
        for (const f of payload?.fighters || []) {
            const a = normalizeName(String(f?.name || ''));
            const b = normalizeName(String(f?.opponent || ''));
            if (!a || !b || a === b)
                continue;
            const names = [a, b].sort((x, y) => x.localeCompare(y));
            const key = `${names[0]}|${names[1]}`;
            const hit = pairCounts.get(key);
            if (hit)
                hit.count += 1;
            else
                pairCounts.set(key, { a: names[0], b: names[1], count: 1 });
        }
    }
    let best = null;
    for (const v of pairCounts.values()) {
        if (!best || v.count > best.count)
            best = v;
    }
    if (!best || best.count < 2)
        return '';
    return `UFC Fight Night: ${best.a} vs ${best.b}`;
}
function isUsableUpcomingCard(card) {
    if (!card || !card.date)
        return false;
    const ts = parseEventDateMs(card.date);
    if (!Number.isFinite(ts))
        return false;
    // parseEventDateMs returns midnight of event day; UFC fights start ~10 PM event day
    // and end ~1-2 AM the next morning. 30h grace keeps the card usable through fight
    // night and into the morning after, when result absorption typically runs.
    return ts >= Date.now() - 30 * 60 * 60 * 1000;
}
function applyUpcomingCardContext(card) {
    if (!card) {
        upcomingCardPairs = [];
        upcomingEventName = '';
        scheduledRoundsMap.clear();
        return;
    }
    scheduledRoundsMap.clear();
    upcomingCardPairs = (card.fighters || [])
        .map((fight) => {
        const f1 = normalizeName(fight.f1);
        const f2 = normalizeName(fight.f2);
        if (!f1 || !f2 || f1 === f2)
            return null;
        const rounds = fight.scheduledRounds ?? 3;
        scheduledRoundsMap.set(f1, rounds);
        scheduledRoundsMap.set(f2, rounds);
        const pair = { f1, f2 };
        if (fight.weightClass)
            pair.weightClass = fight.weightClass;
        return pair;
    })
        .filter((p) => p != null);
    upcomingEventName = buildEventDisplayName(card.event || '', card.fighters);
    upcomingEventTs = parseEventDateMs(card.date || '');
    // Resolve venue/altitude/cage factors from location
    const venueResult = resolveVenueFactor(card.location);
    currentVenueFactor = venueResult.factor;
    currentVenueLabel = venueResult.label;
    debugLog(`Venue: "${currentVenueLabel}" alt=${currentVenueFactor.altitudeMeters}m cage=${currentVenueFactor.cageSizeFt}ft`);
}
// Locate the headliner (main event) pair by parsing the event title rather than
// relying on positional inference. UFCStats event-page fight ordering is not
// reliably "prelims first, main event last" for upcoming events, so we identify
// the main event by matching "X vs Y" in the event name against upcomingCardPairs.
// Returns null if no title is set, the regex doesn't match, or no pair lines up.
function findHeadlinerPair() {
    if (!upcomingCardPairs.length)
        return null;
    const title = upcomingEventName || inferredEventNameFromLines;
    if (!title)
        return null;
    const m = title.match(/:\s*(.+?)\s+vs\.?\s+(.+)$/i);
    if (!m)
        return null;
    const h1 = m[1].trim();
    const h2 = m[2].trim();
    for (const pair of upcomingCardPairs) {
        const matches = (raw) => {
            if (strictCardNameMatch(raw, pair.f1) || strictCardNameMatch(raw, pair.f2))
                return true;
            const nr = normalizeName(raw) || raw.toLowerCase().trim();
            if (namesMatch(nr, pair.f1) || namesMatch(nr, pair.f2))
                return true;
            // Event titles use surname only — match against last word of full name
            if (pair.f1.endsWith(' ' + nr) || pair.f2.endsWith(' ' + nr))
                return true;
            return false;
        };
        if (matches(h1) && matches(h2)) {
            return { f1: pair.f1, f2: pair.f2 };
        }
    }
    // Fallback: the pair with scraped 5R is the main event — reliable for
    // identification even though we don't trust scraped rounds for projections.
    for (const pair of upcomingCardPairs) {
        if (scheduledRoundsMap.get(pair.f1) === 5 && scheduledRoundsMap.get(pair.f2) === 5) {
            return { f1: pair.f1, f2: pair.f2 };
        }
    }
    return null;
}
async function syncUpcomingCardContext(forceRefresh = false) {
    if (typeof chrome === 'undefined' || !chrome.runtime)
        return null;
    const resp = await runtimeSendMessage({ type: 'GET_UPCOMING_CARD', forceRefresh });
    const cached = await storageGet(['upcoming_ufc_card']);
    const runtimeCard = isUsableUpcomingCard(resp?.card) ? resp.card : null;
    const cachedCard = isUsableUpcomingCard(cached['upcoming_ufc_card']) ? cached['upcoming_ufc_card'] : null;
    const card = runtimeCard || cachedCard || null;
    if (!card) {
        applyUpcomingCardContext(null);
        await storageRemove(['upcoming_ufc_card']);
        return null;
    }
    applyUpcomingCardContext(card);
    return card;
}
function hasSourceLine(f, source) {
    if (source === 'p6')
        return f.line_p6 != null || f.line_p6_ss != null || f.line_p6_td != null || f.line_p6_ft != null;
    if (source === 'ud')
        return f.line_ud != null || f.line_ud_ss != null || f.line_ud_td != null || f.line_ud_ft != null;
    if (source === 'pp')
        return f.line_pp != null || f.line_pp_ss != null || f.line_pp_td != null || f.line_pp_ft != null;
    if (source === 'dk')
        return f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null;
    return f.line_betr != null || f.line_betr_ss != null || f.line_betr_td != null || f.line_betr_ft != null;
}
function hasAnyVisibleSourceLine(f) {
    const keys = ['p6', 'ud', 'pp', 'betr', 'dk'];
    return keys.some((k) => sourceVisibility[k] && hasSourceLine(f, k));
}
function applySourceVisibilityFilter(fighters) {
    return fighters.filter((f) => hasAnyVisibleSourceLine(f) || isUpcomingCardFighter(f.name));
}
function updateSourceToggleUI() {
    const buttons = document.querySelectorAll('.source-toggle[data-source]');
    buttons.forEach((btn) => {
        const key = (btn.dataset.source || '');
        const enabled = !!sourceVisibility[key];
        btn.classList.toggle('active', enabled);
    });
}
let sourceButtonsExpanded = false;
function updateSourceRowVisibility(hasLines) {
    const sourceRow = document.getElementById('sourceToggleRow');
    if (!sourceRow)
        return;
    if (!hasLines) {
        sourceRow.style.display = 'none';
        return;
    }
    sourceRow.style.display = '';
    const trigger = document.getElementById('sourceToggleTrigger');
    const buttons = document.getElementById('sourceToggleButtons');
    const text = document.getElementById('sourceTriggerText');
    const caret = document.getElementById('sourceTriggerCaret');
    if (!trigger || !buttons || !text || !caret)
        return;
    const enabled = Object.values(sourceVisibility).filter(Boolean).length;
    const allActive = enabled === 5;
    const showButtons = sourceButtonsExpanded || !allActive;
    buttons.style.display = showButtons ? '' : 'none';
    text.textContent = `Sources ${enabled}/5`;
    caret.textContent = showButtons ? '▴' : '▾';
    trigger.setAttribute('aria-expanded', showButtons ? 'true' : 'false');
    trigger.classList.toggle('is-filtered', !allActive);
}
const STORAGE_LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr', 'lines_prizepicks', 'lines_draftkings_sportsbook'];
const STORAGE_BETR_MANUAL_KEY = 'lines_betr_manual_v1';
const STORAGE_ODDS_KEY = 'fight_odds_moneyline';
const STORAGE_PROP_ARCHIVE_KEY = 'prop_archive_v1';
const STORAGE_BEST_PICKS_SNAPSHOT_KEY = 'best_picks_snapshots_v1';
const STORAGE_AI_LEAN_SNAPSHOT_KEY = 'ai_lean_snapshots_v1';
const STORAGE_BAYESIAN_PRIORS_KEY = 'bayesian_priors_v1';
const UFC_LONDON_CUTOFF_ISO = '2026-03-01T00:00:00.000Z';
const STORAGE_CORE_LINE_KEYS = ['lines_pick6', 'lines_underdog'];
const STORAGE_BETR_LINE_KEYS = ['lines_pick6', 'lines_underdog', 'lines_betr'];
const STORAGE_LINE_DEBUG_KEYS = ['pick6', 'underdog', 'sportsbook'];
function storageGet(keys) {
    if (typeof chrome === 'undefined' || !chrome.storage)
        return Promise.resolve({});
    return new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data)));
}
function storageSet(values) {
    if (typeof chrome === 'undefined' || !chrome.storage)
        return Promise.resolve();
    return new Promise((resolve) => chrome.storage.local.set(values, () => resolve()));
}
function storageRemove(keys) {
    if (typeof chrome === 'undefined' || !chrome.storage)
        return Promise.resolve();
    return new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));
}
// Apply user-adjusted Betr lines on top of whatever is in lines_betr.
// Manual non-null values win; fighters only in manual are added whole.
function applyBetrManualOverrides(base, manual) {
    const result = base.map(f => ({ ...f }));
    for (const m of manual) {
        const mName = String(m.name || '').trim().toLowerCase();
        if (!mName)
            continue;
        const existing = result.find(f => String(f.name || '').trim().toLowerCase() === mName);
        if (existing) {
            if (m.line_fp != null)
                existing.line_fp = m.line_fp;
            if (m.line_ss != null)
                existing.line_ss = m.line_ss;
            if (m.line_td != null)
                existing.line_td = m.line_td;
            if (m.line_ft != null)
                existing.line_ft = m.line_ft;
            if (m.line_ctrl != null)
                existing.line_ctrl = m.line_ctrl;
        }
        else {
            result.push({ ...m });
        }
    }
    return result;
}
function runtimeSendMessage(payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime)
        return Promise.resolve(null);
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(payload, (resp) => {
            if (chrome.runtime.lastError) {
                resolve(null);
                return;
            }
            resolve((resp ?? null));
        });
    });
}
// ── DEBUG PANEL ────────────────────────────────────────────────────────────
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
// ── FANTASY SCORING ────────────────────────────────────────────────────────
// Extracted to ./analyzer/fantasy-scoring.ts.
// ── BUILD FIGHTER DB ───────────────────────────────────────────────────────
function buildFighterDB(name, ufcData) {
    if (!ufcData) {
        return {
            record: '—', country: '🏳️',
            avgFP_p6: null, avgFP_ud: null, avgFP_pp: null, avgFP_betr: null,
            avgSigStr: null, avgTD: null,
            style: 'balanced', finishRate: null,
            history: [], oppHistory: [], loaded: false, detailUrl: null
        };
    }
    const { careerStats, fightHistory, detailUrl } = ufcData;
    const history = (fightHistory || []).map(f => {
        const won = f.result === 'win';
        const fpP6 = (f.sigStr != null)
            ? calcFPForPlatform('pick6', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, f.sub, won, f.method, f.round)
            : null;
        const fpUd = (f.sigStr != null)
            ? calcFPForPlatform('underdog', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, f.sub, won, f.method, f.round)
            : null;
        return {
            opp: f.opponent, fp: fpP6, fp_p6: fpP6, fp_ud: fpUd,
            sigStr: f.sigStr, sigStrR1: f.sigStrR1, sigStrBody: f.sigStrBody, sigStrLeg: f.sigStrLeg, totStr: f.totStr, ctrlSecs: f.ctrlSecs, timeSecs: f.timeSecs,
            td: f.td, kd: f.kd, rev: f.rev, sub: f.sub, method: f.method, result: f.result, date: f.date ?? undefined, round: f.round ?? undefined,
            oppStats: f.oppStats,
        };
    }).filter(f => f.fp != null);
    const validFights = history.filter(f => f.fp > 0);
    const avgFP = validFights.length ? validFights.reduce((s, f) => s + (f.fp || 0), 0) / validFights.length : null;
    const p6Samples = history.map((f) => f.fp_p6).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const udSamples = history.map((f) => f.fp_ud).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const ppSamples = (fightHistory || [])
        .map((f) => {
        const won = f.result === 'win';
        if (f.sigStr == null)
            return null;
        return calcFPForPlatform('prizepicks', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, f.sub, won, f.method, f.round);
    })
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const betrSamples = (fightHistory || [])
        .map((f) => {
        const won = f.result === 'win';
        if (f.sigStr == null)
            return null;
        return calcFPForPlatform('betr', f.sigStr, f.totStr, f.ctrlSecs, f.timeSecs, f.kd, f.td, f.rev, f.sub, won, f.method, f.round);
    })
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgFP_p6 = p6Samples.length ? parseFloat((p6Samples.reduce((s, v) => s + v, 0) / p6Samples.length).toFixed(1)) : null;
    const avgFP_ud = udSamples.length ? parseFloat((udSamples.reduce((s, v) => s + v, 0) / udSamples.length).toFixed(1)) : null;
    const avgFP_pp = ppSamples.length ? parseFloat((ppSamples.reduce((s, v) => s + v, 0) / ppSamples.length).toFixed(1)) : null;
    const avgFP_betr = betrSamples.length ? parseFloat((betrSamples.reduce((s, v) => s + v, 0) / betrSamples.length).toFixed(1)) : null;
    const fightsSS = history.filter(f => f.sigStr != null);
    const avgSigStr = fightsSS.length
        ? parseFloat((fightsSS.reduce((s, f) => s + (f.sigStr || 0), 0) / fightsSS.length).toFixed(1))
        : (careerStats?.slpm != null ? parseFloat((careerStats.slpm * 15).toFixed(1)) : null);
    const ssVals = fightsSS.map(f => f.sigStr);
    const ssStdDev = ssVals.length >= 2
        ? parseFloat(Math.sqrt(ssVals.reduce((s, v) => s + Math.pow(v - ssVals.reduce((a, b) => a + b, 0) / ssVals.length, 2), 0) / ssVals.length).toFixed(1))
        : null;
    const fightsTD = history.filter(f => f.td != null);
    const avgTDperFight = fightsTD.length ? parseFloat((fightsTD.reduce((s, f) => s + (f.td || 0), 0) / fightsTD.length).toFixed(1)) : null;
    const finishes = validFights.filter(f => isFinish(f.method));
    const finishRate = validFights.length ? finishes.length / validFights.length : null;
    const avgFP_weighted = calcWeightedAvgFP(history);
    const fpStats = calcFPStats(history);
    const avgFP_perRound = calcPerRoundFP(history);
    const streak = detectStreak(history);
    const fiveRoundFights = history.filter(f => (f.round || 0) >= 4).length;
    const fiveRoundRate = history.length > 0 ? parseFloat((fiveRoundFights / history.length).toFixed(2)) : 0;
    const timeSamples = history.filter(h => h.timeSecs != null && h.timeSecs > 0).map(h => h.timeSecs / 60);
    const avgTimeMins = timeSamples.length >= 2
        ? parseFloat((timeSamples.reduce((s, v) => s + v, 0) / timeSamples.length).toFixed(1))
        : null;
    // Control time average (seconds) across fights where the fighter was in an MMA bout.
    // 0 is a legitimate sample — never filter it out, only null/undefined. Grapplers vs
    // pure strikers differ primarily in their ceiling; including zeros preserves that.
    const ctrlSamples = history.filter(h => Number.isFinite(Number(h.ctrlSecs))).map(h => Number(h.ctrlSecs));
    const avgCtrlSecs = ctrlSamples.length >= 2
        ? parseFloat((ctrlSamples.reduce((s, v) => s + v, 0) / ctrlSamples.length).toFixed(1))
        : null;
    return {
        record: careerStats?.record || '—',
        country: '🏴',
        avgFP: avgFP ? parseFloat(avgFP.toFixed(1)) : null,
        avgFP_p6,
        avgFP_ud,
        avgFP_pp,
        avgFP_betr,
        avgSigStr,
        ssStdDev,
        avgTD: careerStats?.tdAvg || null,
        avgTDperFight,
        slpm: careerStats?.slpm || null,
        sapm: careerStats?.sapm || null,
        strAcc: careerStats?.strAcc || null,
        strDef: careerStats?.strDef || null,
        tdDef: careerStats?.tdDef || null,
        tdAcc: careerStats?.tdAcc || null,
        stance: careerStats?.stance || null,
        style: _fighterStyleOverrides.get(name.trim().toLowerCase()) ?? deriveStyle(careerStats),
        finishRate,
        avgFP_weighted,
        fpFloor: fpStats.floor,
        fpCeiling: fpStats.ceiling,
        fpStdDev: fpStats.stdDev,
        fpConsistency: fpStats.consistency,
        fpMedian: fpStats.median,
        avgFP_perRound,
        streak,
        fiveRoundRate,
        avgTimeMins,
        avgCtrlSecs,
        history,
        oppHistory: history
            .filter(f => f.oppStats != null)
            .map(f => {
            const os = f.oppStats;
            const oppWon = f.result === 'loss';
            const fp = (os.sigStr != null)
                ? calcFPForPlatform('pick6', os.sigStr, os.totStr, os.ctrlSecs, f.timeSecs, os.kd, os.td, null, os.sub, oppWon, f.method, f.round)
                : null;
            return {
                opp: f.opp,
                result: oppWon ? 'win' : 'loss',
                fp: fp != null ? parseFloat(fp.toFixed(1)) : null,
                fp_p6: fp != null ? parseFloat(fp.toFixed(1)) : null,
                sigStr: os.sigStr ?? null,
                sigStrR1: os.sigStrR1 ?? null,
                sigStrBody: os.sigStrBody ?? null,
                sigStrLeg: os.sigStrLeg ?? null,
                totStr: os.totStr ?? null,
                td: os.td ?? null,
                kd: os.kd ?? null,
                rev: null,
                sub: os.sub ?? null,
                ctrlSecs: os.ctrlSecs ?? null,
                timeSecs: f.timeSecs ?? null,
                method: f.method ?? null,
                round: f.round ?? null,
            };
        })
            .filter(f => f.fp != null || f.sigStr != null),
        loaded: true,
        detailUrl: detailUrl || null,
    };
}
// ── UFC STATS FETCH ────────────────────────────────────────────────────────
// Platform names sometimes don't match UFCStats: alt first names (Timothy Angel
// Cuamba → Timmy Cuamba) or typos on UFCStats's side (Bernardo Sopaj → Benardo
// Sopaj). Map is keyed by lowercased platform name, value is the UFCStats name
// to search instead. Add new entries when the candidate-search-by-first+last
// can't find a real fighter.
const UFCSTATS_NAME_ALIASES = {
    'timothy angel cuamba': 'Timmy Cuamba',
    'bernardo sopaj': 'Benardo Sopaj',
    'george tuco tokkos': 'Tuco Tokkos',
    'doo ho choi': 'Dooho Choi',
    'thomas gantt': 'Tommy Gantt',
    // Analyzer canonicalizes to "Su Mudaerji" (so historical archive keys keep
    // matching) but UFCStats lists him as the single-word "Sumudaerji". Bridge
    // here so the alpha-index lookup uses the single-word form.
    'su mudaerji': 'Sumudaerji',
};
async function fetchFromUFCStats(name) {
    const aliased = UFCSTATS_NAME_ALIASES[name.trim().toLowerCase()];
    if (aliased && aliased !== name) {
        debugLog(`Alias: ${name} → ${aliased}`);
        name = aliased;
    }
    const cacheKey = `ufcstats_v51_${name.toLowerCase().replace(/\s+/g, '_')}`;
    if (typeof chrome !== 'undefined' && chrome.storage) {
        const cached = await storageGet([cacheKey]);
        if (cached[cacheKey] && (Date.now() - cached[cacheKey].fetchedAt < 86400000)) {
            debugLog(`Cache hit: ${name}`);
            return cached[cacheKey];
        }
    }
    try {
        const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);
        const COMPOUND = new Set(['de', 'van', 'von', 'da', 'dos', 'del', 'di', 'le', 'la', 'du', 'el', 'abdul']);
        function nameCandidates(n) {
            // Strip apostrophes so "Sean O'Malley" ↔ platform "Sean Omalley" both resolve.
            const parts = n.replace(/['’]/g, '').trim().split(/\s+/);
            const hasSuffix = SUFFIXES.has(parts[parts.length - 1].toLowerCase().replace('.', ''));
            const cleanParts = hasSuffix ? parts.slice(0, -1) : [...parts];
            const cands = [];
            // 4+ word names: platforms often prepend given names UFCStats drops (Juan Adrian
            // Luna Martinetti → Adrian Luna Martinetti). Try altFirst-based candidates FIRST,
            // because the raw first+last variant can grab the wrong fighter (a different
            // Martinetti with the same last name).
            if (cleanParts.length >= 4) {
                const altFirst = cleanParts[1].toLowerCase();
                const altLast = cleanParts[cleanParts.length - 1].toLowerCase();
                // Juan Adrian Luna Martinetti: UFCStats may index under 'l' with compound last "Luna Martinetti".
                const altCompLast = cleanParts.slice(2).join(' ').toLowerCase();
                cands.push({ char: cleanParts[2][0].toLowerCase(), first: altFirst, last: altCompLast });
                // Ana Talita De Oliviera Alencar: UFCStats lists her as just "Talita Alencar" — simple last.
                cands.push({ char: altLast[0], first: altFirst, last: altLast });
            }
            if (cleanParts.length >= 3) {
                // Mayra Bueno Silva: UFCStats lists her as first="Mayra", last="Bueno Silva" —
                // indexed under 'b', not 's'. Without this candidate, the 's' page has no Mayra row
                // and we fall through to a Silva-only match grabbing the wrong fighter.
                const compLast = cleanParts[cleanParts.length - 2] + ' ' + cleanParts[cleanParts.length - 1];
                cands.push({ char: cleanParts[cleanParts.length - 2][0].toLowerCase(), first: cleanParts[0].toLowerCase(), last: compLast.toLowerCase() });
                // Norma Dumont Viana: UFCStats drops the trailing Portuguese surname and
                // lists her as just "Norma Dumont" — try the middle word as the last name.
                const midLast = cleanParts[cleanParts.length - 2].toLowerCase();
                cands.push({ char: midLast[0], first: cleanParts[0].toLowerCase(), last: midLast });
            }
            if (cleanParts.length >= 2) {
                const last = cleanParts[cleanParts.length - 1], first = cleanParts[0];
                // When name has a Jr/Sr suffix, try "Gibson Jr" first to avoid matching
                // an older fighter with the same base last name (e.g. old "Lance Gibson" vs current "Lance Gibson Jr.")
                if (hasSuffix) {
                    const suffix = parts[parts.length - 1].toLowerCase().replace('.', '');
                    const lastWithSuffix = last.toLowerCase() + ' ' + suffix;
                    cands.push({ char: last[0].toLowerCase(), first: first.toLowerCase(), last: lastWithSuffix });
                }
                cands.push({ char: last[0].toLowerCase(), first: first.toLowerCase(), last: last.toLowerCase() });
            }
            // Chinese / Asian fighter convention: UFCStats sometimes indexes by the
            // family name's initial (which platforms put in the FIRST cell) instead
            // of the given name's initial. For "Song Yadong" we already search ?char=y
            // — also try ?char=s with the same first/last. Safe because findDetailUrl
            // requires both cells to match exactly.
            if (cleanParts.length === 2) {
                const first = cleanParts[0].toLowerCase();
                const last = cleanParts[1].toLowerCase();
                if (first[0] !== last[0]) {
                    cands.push({ char: first[0], first, last });
                }
            }
            // Single-word fighters (Aoriqileng, Sumudaerji). UFCStats indexes some of
            // these with the name in just one cell (first OR last) and the other
            // empty. Empty-cell wildcards are gated in findDetailUrl so they only
            // match rows where the corresponding cell is actually empty.
            if (cleanParts.length === 1) {
                const single = cleanParts[0].toLowerCase();
                cands.push({ char: single[0], first: single, last: '' });
                cands.push({ char: single[0], first: '', last: single });
            }
            const firstLen = cleanParts[0].length;
            const lastLen = cleanParts[cleanParts.length - 1].length;
            if (cleanParts.length === 2 && (firstLen <= 3 || lastLen <= 3)) {
                const revLast = cleanParts[0].toLowerCase();
                const revFirst = cleanParts[cleanParts.length - 1].toLowerCase();
                const revChar = revLast[0];
                if (revChar !== cands[0]?.char || revLast !== cands[0]?.last) {
                    cands.push({ char: revChar, first: revFirst, last: revLast });
                }
            }
            return cands;
        }
        const candidates = nameCandidates(name);
        debugLog(`Searching ${name} — ${candidates.length} candidate(s)`);
        const pageCache = {};
        async function getAlphaPage(char) {
            if (pageCache[char])
                return pageCache[char];
            const url = `http://www.ufcstats.com/statistics/fighters?char=${char}&page=all`;
            const html = await ufcstatsFetchText(url);
            if (!html) {
                debugLog(`Fetch failed for char=${char}`);
                return '';
            }
            pageCache[char] = html;
            debugLog(`Loaded [${char.toUpperCase()}] page: ${html.length} chars`);
            return html;
        }
        function findDetailUrl(html, firstLower, lastLower) {
            // Require BOTH the First and Last cells to match — prevents grabbing the wrong same-last-name
            // fighter when the right one isn't on this page (e.g. Mayra Bueno Silva searched on 's' page).
            const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let m;
            while ((m = trRegex.exec(html)) !== null) {
                const row = m[1];
                const link = row.match(/href="(http:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/[a-f0-9]+)"/i);
                if (!link)
                    continue;
                const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
                    .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().toLowerCase().replace(/['’]/g, '').replace(/-/g, ' '));
                const firstCell = cells[0] || '';
                const lastCell = cells[1] || '';
                // Empty firstLower/lastLower mean "this cell must be empty" — used by
                // single-word fighters where UFCStats puts the name in just one cell.
                const firstOk = firstLower
                    ? (firstCell === firstLower || firstCell.startsWith(firstLower + ' ') || firstCell.endsWith(' ' + firstLower) || firstCell.includes(' ' + firstLower + ' '))
                    : !firstCell;
                const lastOk = lastLower
                    ? (lastCell === lastLower || lastCell.startsWith(lastLower + ' ') || lastCell.endsWith(' ' + lastLower) || lastCell.includes(' ' + lastLower + ' '))
                    : !lastCell;
                if (firstOk && lastOk) {
                    return link[1].replace('http://ufcstats.com/', 'http://www.ufcstats.com/');
                }
            }
            return null;
        }
        let detailUrl = null;
        for (const cand of candidates) {
            const html = await getAlphaPage(cand.char);
            if (!html)
                continue;
            detailUrl = findDetailUrl(html, cand.first, cand.last);
            if (detailUrl) {
                debugLog(`Matched: ${name} via [${cand.char.toUpperCase()}] first=${cand.first} last=${cand.last}`);
                break;
            }
        }
        if (!detailUrl) {
            debugLog(`✗ NOT FOUND: ${name}`);
            return null;
        }
        const detailHtml = await ufcstatsFetchText(detailUrl);
        if (!detailHtml) {
            debugLog(`Detail fetch failed for ${name}`);
            return null;
        }
        const careerStats = parseCareerStats(detailHtml);
        const fightLinks = parseFightHistoryLinks(detailHtml);
        debugLog(`✓ ${name}: ${careerStats.record}, ${fightLinks.length} fight links found`);
        const detailUrlId = detailUrl?.match(/fighter-details\/([a-f0-9]+)/i)?.[1] || 'unknown';
        debugLog(`detailUrl ID: ${detailUrlId}`);
        // Fetch all fight detail pages in parallel batches of 5
        const BATCH_SIZE = 5;
        const fightHistory = new Array(fightLinks.length);
        for (let b = 0; b < fightLinks.length; b += BATCH_SIZE) {
            const batch = fightLinks.slice(b, b + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(async (fight) => {
                const text = await ufcstatsFetchText(fight.fightUrl);
                if (text == null)
                    throw new Error('challenge or fetch failed');
                return text;
            }));
            for (let i = 0; i < batch.length; i++) {
                const fight = batch[i];
                const idx = b + i;
                const settled = results[i];
                if (settled.status === 'fulfilled') {
                    const fHtml = settled.value;
                    const stats = parseFightDetailStats(fHtml, name, detailUrl);
                    const oppStats = parseFightDetailStatsOpponent(fHtml, name, detailUrl);
                    const method = stats?.method || fight.method;
                    const round = stats?.round || fight.round;
                    fightHistory[idx] = { ...fight, ...(stats || {}), method, round, oppStats: oppStats || null, fightUrl: undefined };
                    debugLog(`  vs ${fight.opponent}: ${fight.result} kd=${stats?.kd} sig=${stats?.sigStr} tot=${stats?.totStr} td=${stats?.td} ctrl=${stats?.ctrlSecs}s rnd=${round} method=${method} urlMatch=${fHtml.includes(detailUrlId)}`);
                }
                else {
                    debugLog(`  fight fetch error ${fight.fightUrl}: ${settled.reason.message}`);
                    fightHistory[idx] = { ...fight, fightUrl: undefined };
                }
            }
        }
        const result = { name, fetchedAt: Date.now(), careerStats, fightHistory, detailUrl };
        if (typeof chrome !== 'undefined' && chrome.storage)
            chrome.storage.local.set({ [cacheKey]: result });
        debugLog(`✓ ${name}: stored ${fightHistory.length} fights with stats`);
        return result;
    }
    catch (e) {
        debugLog(`✗ ERROR ${name}: ${e.name}: ${e.message}`);
        return null;
    }
}
async function fetchFighterStats(name) {
    if (statsCache[name] !== undefined)
        return statsCache[name];
    if (name in statsCachePromises)
        return statsCachePromises[name];
    const promise = fetchFromUFCStats(name).then(ufcData => {
        archivePerformanceForRosterFighter(name, ufcData).catch((e) => {
            debugLog(`archive error ${name}: ${e.message}`);
        });
        const db = buildFighterDB(name, ufcData);
        statsCache[name] = db;
        return db;
    });
    statsCachePromises[name] = promise;
    return promise;
}
// ── STYLE MATCHUP MATRIX ──────────────────────────────────────────────────
// styleMatchupEdge / calcOpponentDefenseScore / calcMatchupPatternEdge
// extracted to ./analyzer/style-matchup.ts. calcMatchupPatternEdge takes
// statsCache as its last param — call sites below thread it through.
// ── AI ENHANCEMENTS: Multivariate Scoring System ──────────────────────────
/** #11: Weighted Recent Form Curve - Exponential decay prioritizes recent fights */
function calcWeightedFormTrend(history) {
    if (history.length < 3)
        return { trend: 0, label: 'Insufficient recent history' };
    const recent = history.slice(0, 5);
    const weights = recent.map((_, i) => Math.pow(0.75, i)); // 0.75 = recent fights worth 75% of previous
    const totalW = weights.reduce((s, w) => s + w, 0);
    const weightedAvg = recent.reduce((s, f, i) => s + (f.fp || 0) * weights[i], 0) / totalW;
    const careerAvg = history.reduce((s, f) => s + (f.fp || 0), 0) / history.length;
    const trend = weightedAvg - careerAvg;
    const label = trend > 5 ? '📈 Strong uptrend' : trend > 2 ? '📈 Slight uptrend' : trend < -5 ? '📉 Strong downtrend' : trend < -2 ? '📉 Slight downtrend' : '➡️ Stable';
    return { trend, label };
}
function calcStatTrend(history, getValue, threshold, n = 3) {
    const allVals = history
        .map(getValue)
        .filter((v) => v != null && Number.isFinite(v) && v > 0);
    // Need enough total fights so that career avg is meaningful beyond the recent window
    if (allVals.length < n + 2)
        return { recentAvg: null, careerAvg: null, delta: null, direction: null };
    const recentVals = allVals.slice(0, n);
    const recentAvg = recentVals.reduce((s, v) => s + v, 0) / recentVals.length;
    const careerAvg = allVals.reduce((s, v) => s + v, 0) / allVals.length;
    const delta = parseFloat((recentAvg - careerAvg).toFixed(1));
    const direction = delta > threshold ? 'up' : delta < -threshold ? 'down' : 'flat';
    return {
        recentAvg: parseFloat(recentAvg.toFixed(1)),
        careerAvg: parseFloat(careerAvg.toFixed(1)),
        delta,
        direction,
    };
}
/** #12: Opponent Strength Adjustment - Rate opponent quality then adjust */
function calcOpponentStrengthScore(oppDB) {
    if (!oppDB || !oppDB.loaded)
        return { score: 0, label: 'Opponent not loaded' };
    const oppAvgFP = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
    const oppStreak = oppDB.streak?.type === 'hot' ? 1 : oppDB.streak?.type === 'cold' ? -1 : 0;
    const oppConsistency = oppDB.fpConsistency || 50;
    const sampleSize = oppDB.history?.length || 0;
    const sampleFactor = Math.min(0.25, sampleSize / 30);
    const strengthScore = ((oppAvgFP - 58) / 16) + ((oppConsistency - 55) / 28) + (oppStreak * 0.18) + sampleFactor;
    const isElite = sampleSize >= 6 && oppAvgFP >= 82 && oppConsistency >= 62 && strengthScore >= 1.45;
    const isStrong = sampleSize >= 4 && oppAvgFP >= 68 && strengthScore >= 0.75;
    const label = isElite ? '🏆 Elite opponent' : isStrong ? '⭐ Strong opponent' : strengthScore > -0.2 ? '👤 Average opponent' : '↓ Below avg opponent';
    return { score: strengthScore, label };
}
/** #13: Fight Context Factors - Home/away, short notice, title fights */
function calcFightContextScore(history) {
    const reasons = [];
    let score = 0;
    if (history.length < 2)
        return { score, reasons };
    const recent = history?.[0];
    if (!recent)
        return { score, reasons };
    // Short notice detection (if date is available and < 2 weeks to prep)
    const recentFightDate = recent.date ? new Date(recent.date).getTime() : null;
    const prevFightDate = history[1]?.date ? new Date(history[1].date).getTime() : null;
    if (recentFightDate && prevFightDate) {
        const daysBetween = (recentFightDate - prevFightDate) / (1000 * 60 * 60 * 24);
        if (daysBetween < 14 && daysBetween > 0) {
            score -= 1.5;
            reasons.push({ icon: 'neg', text: `⚡ Short notice: Only ${Math.round(daysBetween)} days between fights — underperformance expected` });
        }
    }
    return { score, reasons };
}
/** #16: Burnout/Rest Cycle Detection - Days since last fight analysis */
function calcRestCycleFactor(history) {
    if (!history.length)
        return { score: 0, label: 'No fight history', daysSince: 0 };
    const lastFightDate = history[0]?.date ? new Date(history[0].date).getTime() : Date.now();
    const daysSince = Math.floor((Date.now() - lastFightDate) / (1000 * 60 * 60 * 24));
    let score = 0, label = '';
    if (daysSince < 21) {
        score = -1.5;
        label = `⚠️ Only ${daysSince} days rest — likely underperform`;
    }
    else if (daysSince < 45) {
        score = -0.5;
        label = `📅 Recent fight (${daysSince}d) — some rust expected`;
    }
    else if (daysSince > 180) {
        score = -0.5;
        label = `❄️ Long layoff (${daysSince}d) — ring rust possible`;
    }
    else {
        score = 0.3;
        label = `✓ Ideal rest (${daysSince}d) — full camp prep`;
    }
    return { score, label, daysSince };
}
/** #18: Peer Comparison Ranking - Compare fighter to weight-class peers */
function calcPeerPercentileRanking(fighter, fighter_name) {
    const me = fighter.find(f => f.name === fighter_name)?.db;
    if (!me)
        return { avgFPPercentile: 50, consistencyPercentile: 50, strikeVolumePercentile: 50 };
    const peers = fighter.map(f => f.db).filter(f => f.loaded && f !== me);
    if (peers.length < 3)
        return { avgFPPercentile: 50, consistencyPercentile: 50, strikeVolumePercentile: 50 };
    const avgFPs = peers.map(p => p.avgFP || 0).filter(v => v > 0);
    const consistencies = peers.map(p => p.fpConsistency || 50);
    const strikeVols = peers.map(p => p.slpm || 0);
    const avgFPPercentile = avgFPs.length ? Math.round(100 * avgFPs.filter(v => (me.avgFP || 0) > v).length / avgFPs.length) : 50;
    const consistencyPercentile = consistencies.length ? Math.round(100 * consistencies.filter(v => (me.fpConsistency || 50) > v).length / consistencies.length) : 50;
    const strikeVolumePercentile = strikeVols.length ? Math.round(100 * strikeVols.filter(v => (me.slpm || 0) > v).length / strikeVols.length) : 50;
    return { avgFPPercentile, consistencyPercentile, strikeVolumePercentile };
}
/** #19: Extreme Value Detection - Flag lines 3+ std devs away */
function detectExtremeValue(line, fpFloor, fpCeiling, fpStdDev, history) {
    if (!line || !fpStdDev || !history.length)
        return { isExtreme: false, label: '', severity: 0 };
    const fpValues = history.filter(f => f.fp != null && f.fp > 0).map(f => f.fp);
    if (fpValues.length < 5)
        return { isExtreme: false, label: 'Insufficient sample', severity: 0 };
    const mean = fpValues.reduce((s, v) => s + v, 0) / fpValues.length;
    const stdDevs = Math.abs(line - mean) / fpStdDev;
    const isExtreme = stdDevs >= 3;
    const label = stdDevs >= 4 ? '🚨 EXTREME VALUE' : stdDevs >= 3 ? '⚠️ Outlier line' : '';
    return { isExtreme, label, severity: stdDevs };
}
/** #20: Multivariate Confidence Scoring - Complex confidence based on multiple factors */
function calcMultivariateConfidence(db, history, score, lineStdDevs, sampleSize, restDaysSince) {
    let conf = 50; // baseline
    // Factor 1: Score magnitude (0-3 scale → confidence boost)
    conf += Math.min(25, Math.abs(score) * 8);
    // Factor 2: Sample size (need min 10 fights for full confidence)
    const sampleSizeFactor = Math.min(1, (sampleSize - 3) / 10);
    conf = conf * (0.7 + 0.3 * sampleSizeFactor);
    // Factor 3: Time decay (recent data more reliable)
    const timeDecayFactor = Math.min(1, Math.max(0.5, 1 - (365 - restDaysSince) / 730));
    conf = conf * (0.8 + 0.2 * timeDecayFactor);
    // Factor 4: Consistency level (high consistency = higher confidence)
    const consistency = db.fpConsistency || 50;
    const consistencyFactor = consistency / 100;
    conf = conf * (0.7 + 0.3 * consistencyFactor);
    // Factor 5: Recent vs career gap (big gaps = lower confidence in leans)
    const careerAvg = history.reduce((s, f) => s + (f.fp || 0), 0) / history.length;
    const recentAvg = history.slice(0, 3).reduce((s, f) => s + (f.fp || 0), 0) / Math.min(3, history.length);
    const formGap = Math.abs(recentAvg - careerAvg) / (careerAvg || 1);
    const formGapFactor = Math.min(1, Math.max(0.6, 1 - formGap)); // Large gaps reduce confidence
    conf = conf * formGapFactor;
    // Factor 6: Extreme value detection penalty
    if (lineStdDevs >= 3)
        conf = conf * 0.85;
    return Math.round(Math.min(95, Math.max(35, conf)));
}
let _bayesianPriors = {};
async function loadBayesianPriors() {
    const payload = await storageGet([STORAGE_BAYESIAN_PRIORS_KEY]);
    const raw = payload[STORAGE_BAYESIAN_PRIORS_KEY];
    if (!raw || typeof raw !== 'object')
        return;
    const out = {};
    for (const src of ['fp', 'ss', 'td', 'ft']) {
        const v = Number(raw[src]);
        if (Number.isFinite(v) && v >= 0.25 && v <= 0.85)
            out[src] = v;
    }
    _bayesianPriors = out;
}
function getHistoricalPriorForSource(source) {
    // ss_r1 has no measured Bayesian prior (R1 SS props aren't archived/settled) — fall back.
    if (!source || source === 'ctrl' || source === 'ss_r1')
        return 0.55;
    return _bayesianPriors[source] ?? 0.55;
}
function calcBayesianLean(db, line, opponentDB, historicalAccuracy, source) {
    // Prior: Base rate from historical over/under frequency (adjusted by our model's accuracy)
    const prior = Number.isFinite(historicalAccuracy)
        ? historicalAccuracy
        : getHistoricalPriorForSource(source);
    // Calculate likelihood ratio from evidence strength
    const likelihoodRatio = calculateEvidenceStrength(db, line, opponentDB);
    // Bayesian posterior: P(H|E) = P(E|H) * P(H) / P(E)
    // Simplified: posterior = (likelihood * prior) / ((likelihood * prior) + ((1-likelihood) * (1-prior)))
    const posterior = (likelihoodRatio * prior) / ((likelihoodRatio * prior) + ((1 - likelihoodRatio) * (1 - prior)));
    return {
        probability: posterior,
        confidence: Math.abs(posterior - 0.5) * 2, // Scale to 0-1 confidence
        lean: posterior > 0.6 ? 'over' : posterior < 0.4 ? 'under' : 'push'
    };
}
function calculateEvidenceStrength(db, line, opponentDB) {
    let evidenceStrength = 0.5; // Neutral starting point
    // Historical performance evidence
    const avgFP = db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP;
    if (avgFP != null) {
        const diff = avgFP - line;
        const stdDev = db.fpStdDev || 15; // Default std dev if not available
        const zScore = diff / stdDev;
        // Convert z-score to probability using sigmoid function
        evidenceStrength = 1 / (1 + Math.exp(-zScore * 0.5));
    }
    // Opponent strength adjustment
    if (opponentDB?.loaded) {
        const oppStrength = calcOpponentStrengthScore(opponentDB).score;
        // Stronger opponent reduces evidence strength for over
        evidenceStrength *= (1 - oppStrength * 0.2);
    }
    // Recent form adjustment
    const formTrend = calcWeightedFormTrend(db.history || []);
    evidenceStrength += formTrend.trend * 0.05; // Small adjustment for form
    // Consistency bonus
    const consistency = db.fpConsistency || 50;
    evidenceStrength *= (0.8 + (consistency / 100) * 0.4); // More consistent = stronger evidence
    return Math.max(0.1, Math.min(0.9, evidenceStrength)); // Bound between 0.1 and 0.9
}
// #22: Enhanced Time-Weighting Algorithm - Multi-phase decay with better recency
function advancedTimeWeightedAverage(history, baseLine) {
    if (!history.length)
        return baseLine;
    const now = Date.now();
    const weights = history.map((fight) => {
        const fightDate = fight.date ? new Date(fight.date).getTime() : now - (365 * 24 * 60 * 60 * 1000); // Default to 1 year ago
        const ageInMonths = (now - fightDate) / (1000 * 60 * 60 * 24 * 30);
        // Multi-phase decay: Recent fights heavily weighted, then exponential falloff
        if (ageInMonths < 3)
            return 1.0; // Last 3 months: full weight
        if (ageInMonths < 6)
            return 0.8; // 3-6 months: 80% weight  
        if (ageInMonths < 12)
            return 0.6; // 6-12 months: 60% weight
        return Math.pow(0.85, ageInMonths - 12); // Beyond 1 year: exponential decay
    });
    const weightedSum = history.reduce((sum, fight, i) => {
        const fp = fight.fp || 0;
        return sum + (fp * weights[i]);
    }, 0);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return totalWeight > 0 ? weightedSum / totalWeight : baseLine;
}
// #23: Regression-Based Line Optimization - Statistical modeling for optimal predictions
function optimizeLinePrediction(fighter, opponent) {
    // Features for regression model (simplified linear combination)
    const features = [
        fighter.avgFP || 50, // Base performance
        fighter.slpm || 0, // Strike volume
        fighter.strAcc || 45, // Strike accuracy
        fighter.avgTD || 0, // Takedown average
        fighter.finishRate || 0.4, // Finish rate
        fighter.fpConsistency || 50, // Consistency score
        opponent?.avgFP || 50, // Opponent strength
        opponent?.sapm || 3, // Opponent defense
        opponent?.tdDef || 50, // Opponent TD defense
    ];
    // Pre-trained coefficients (would be learned from historical data in production)
    // These coefficients represent the relationship between features and optimal line
    const coefficients = [
        0.35, // avgFP - strong positive correlation
        0.15, // slpm - moderate positive
        0.08, // strAcc - small positive
        0.12, // tdAvg - moderate positive for grapplers
        -0.18, // finishRate - negative (early finishes hurt volume)
        0.06, // consistency - small positive
        -0.25, // opponent avgFP - strong negative (stronger opponent = lower line)
        -0.10, // opponent sapm - moderate negative
        0.08, // opponent tdDef - small positive
    ];
    // Calculate predicted line using linear combination
    const predictedLine = features.reduce((sum, feature, i) => {
        return sum + (feature * coefficients[i]);
    }, 45); // Base line of 45
    // Apply bounds and adjustments
    let optimizedLine = Math.max(20, Math.min(120, predictedLine));
    // Style-based adjustments
    if (fighter.style === 'striker') {
        optimizedLine *= 1.1; // Strikers tend to have higher lines
    }
    else if (fighter.style === 'grappler') {
        optimizedLine *= 0.9; // Grapplers tend to have lower lines
    }
    // Recent form adjustment
    const formTrend = calcWeightedFormTrend(fighter.history || []);
    optimizedLine += formTrend.trend * 2; // Recent form can shift line by up to 6 points
    return Math.round(optimizedLine);
}
class ProbabilityCalibrator {
    fitPlattScaling(samples, iterations = 250, lr = 0.05) {
        if (samples.length < 12) {
            return { a: 1, b: 0 };
        }
        let a = 1;
        let b = 0;
        for (let i = 0; i < iterations; i++) {
            let gradA = 0;
            let gradB = 0;
            for (const s of samples) {
                const p = this.clampProb(s.rawProbability);
                const x = Math.log(p / (1 - p));
                const z = a * x + b;
                const pred = 1 / (1 + Math.exp(-z));
                const error = pred - s.outcome;
                gradA += error * x;
                gradB += error;
            }
            gradA /= samples.length;
            gradB /= samples.length;
            a -= lr * gradA;
            b -= lr * gradB;
        }
        return { a, b };
    }
    calibrate(rawProbability, params) {
        const p = this.clampProb(rawProbability);
        const x = Math.log(p / (1 - p));
        const z = params.a * x + params.b;
        return this.clampProb(1 / (1 + Math.exp(-z)));
    }
    brierScore(samples, params) {
        if (!samples.length)
            return 0;
        const sse = samples.reduce((sum, s) => {
            const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
            return sum + Math.pow(p - s.outcome, 2);
        }, 0);
        return sse / samples.length;
    }
    reliabilityCurve(samples, bins = 10, params) {
        if (!samples.length)
            return [];
        const bucketed = [];
        for (let i = 0; i < bins; i++) {
            const start = i / bins;
            const end = (i + 1) / bins;
            const inBin = samples.filter(s => {
                const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
                return p >= start && (i === bins - 1 ? p <= end : p < end);
            });
            if (!inBin.length)
                continue;
            const expected = inBin.reduce((sum, s) => {
                const p = params ? this.calibrate(s.rawProbability, params) : this.clampProb(s.rawProbability);
                return sum + p;
            }, 0) / inBin.length;
            const actual = inBin.reduce((sum, s) => sum + s.outcome, 0) / inBin.length;
            bucketed.push({
                bucketStart: start,
                bucketEnd: end,
                count: inBin.length,
                expected,
                actual
            });
        }
        return bucketed;
    }
    clampProb(v) {
        return Math.max(0.01, Math.min(0.99, v));
    }
}
function buildHistoryCalibrationSamples(history, line, scale = 15) {
    return history
        .filter(h => h.fp != null)
        .map(h => {
        const fp = h.fp || 0;
        const rawProbability = 1 / (1 + Math.exp(-((fp - line) / Math.max(1, scale))));
        return {
            rawProbability,
            outcome: (fp > line ? 1 : 0)
        };
    });
}
// #24: Risk Management with Kelly Criterion
class RiskManager {
    constructor(initialBankroll = 1000) {
        this.kellyFraction = 0.1; // Conservative Kelly (10% of calculated amount)
        this.bankroll = initialBankroll;
    }
    calculateBetSize(edge, odds) {
        if (edge <= 0 || odds <= 1)
            return 0;
        // Kelly Criterion: (edge * odds - 1) / (odds - 1) * bankroll * fraction
        const kelly = (edge * odds - 1) / (odds - 1);
        const betSize = kelly * this.bankroll * this.kellyFraction;
        // Conservative limits: max 5% of bankroll, min $5
        return Math.max(5, Math.min(betSize, this.bankroll * 0.05));
    }
    updateBankroll(result) {
        this.bankroll += result;
    }
    getBankroll() {
        return this.bankroll;
    }
    assessPortfolioRisk(predictions) {
        const adjustments = [];
        let totalRisk = 0;
        // Calculate portfolio concentration risk
        const highConfidenceCount = predictions.filter(p => p.confidence > 0.8).length;
        if (highConfidenceCount > predictions.length * 0.6) {
            totalRisk += 0.3;
            adjustments.push('Reduce concentration in high-confidence plays');
        }
        // Calculate edge distribution risk
        const avgEdge = predictions.reduce((sum, p) => sum + p.edge, 0) / predictions.length;
        const edgeVariance = predictions.reduce((sum, p) => sum + Math.pow(p.edge - avgEdge, 2), 0) / predictions.length;
        totalRisk += Math.sqrt(edgeVariance) * 0.5; // Standard deviation of edges
        if (totalRisk > 0.7) {
            adjustments.push('Diversify across more fighters to reduce risk');
        }
        return { totalRisk, recommendedAdjustments: adjustments };
    }
}
// #25: Ensemble Prediction Model - Combine multiple approaches
class EnsemblePredictor {
    constructor() {
        this.models = [
            { name: 'bayesian', weight: 0.35, predictor: this.bayesianModel },
            { name: 'historical', weight: 0.25, predictor: this.historicalModel },
            { name: 'regression', weight: 0.25, predictor: this.regressionModel },
            { name: 'style', weight: 0.15, predictor: this.styleMatchupModel }
        ];
        this.riskManager = new RiskManager();
    }
    predict(fighter, line, opponent) {
        const adaptiveWeights = this.getAdaptiveModelWeights(fighter, opponent);
        const predictions = this.models.map(model => ({
            name: model.name,
            prediction: model.predictor(fighter, line, opponent),
            weight: adaptiveWeights[model.name] ?? model.weight
        }));
        const finalPrediction = this.weightedAverage(predictions);
        const agreement = this.calculateAgreement(predictions);
        const rawConfidence = this.calculateEnsembleConfidence(predictions);
        const confidence = this.adjustConfidenceForDataQuality(fighter, opponent, rawConfidence, agreement);
        return {
            finalPrediction: finalPrediction,
            modelAgreement: agreement,
            confidence,
            betSize: this.riskManager.calculateBetSize(finalPrediction.edge, this.calculateImpliedOdds(line, finalPrediction.expectedValue))
        };
    }
    bayesianModel(fighter, line, opponent) {
        const bayesian = calcBayesianLean(fighter, line, opponent, undefined, 'fp');
        return {
            lean: bayesian.lean,
            confidence: bayesian.confidence,
            edge: Math.abs(bayesian.probability - 0.5) * 2,
            expectedValue: bayesian.probability
        };
    }
    historicalModel(fighter, line, opponent) {
        const avgFP = advancedTimeWeightedAverage(fighter.history || [], line);
        const edge = (avgFP - line) / line;
        return {
            lean: edge > 0.05 ? 'over' : edge < -0.05 ? 'under' : 'push',
            confidence: Math.min(0.9, Math.abs(edge) * 10),
            edge: Math.abs(edge),
            expectedValue: avgFP > line ? 0.6 : 0.4
        };
    }
    regressionModel(fighter, line, opponent) {
        const optimizedLine = optimizeLinePrediction(fighter, opponent);
        const edge = (optimizedLine - line) / line;
        return {
            lean: edge > 0.03 ? 'over' : edge < -0.03 ? 'under' : 'push',
            confidence: Math.min(0.85, Math.abs(edge) * 15),
            edge: Math.abs(edge),
            expectedValue: optimizedLine > line ? 0.55 : 0.45
        };
    }
    styleMatchupModel(fighter, line, opponent) {
        if (!opponent)
            return { lean: 'push', confidence: 0.5, edge: 0, expectedValue: 0.5 };
        const { delta } = styleMatchupEdge(fighter.style, opponent.style, fighter, opponent);
        const edge = delta * 0.1; // Convert score delta to edge
        return {
            lean: edge > 0.05 ? 'over' : edge < -0.05 ? 'under' : 'push',
            confidence: Math.min(0.8, Math.abs(edge) * 8),
            edge: Math.abs(edge),
            expectedValue: 0.5 + edge
        };
    }
    weightedAverage(predictions) {
        const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0);
        const weightedLean = predictions.reduce((result, p) => {
            const weight = p.weight / totalWeight;
            result.overWeight += p.prediction.lean === 'over' ? weight : 0;
            result.underWeight += p.prediction.lean === 'under' ? weight : 0;
            result.confidence += p.prediction.confidence * weight;
            result.edge += p.prediction.edge * weight;
            result.expectedValue += p.prediction.expectedValue * weight;
            return result;
        }, { overWeight: 0, underWeight: 0, confidence: 0, edge: 0, expectedValue: 0 });
        const lean = weightedLean.overWeight > weightedLean.underWeight ? 'over' :
            weightedLean.underWeight > weightedLean.overWeight ? 'under' : 'push';
        const directionalProb = Math.max(weightedLean.overWeight, weightedLean.underWeight);
        const directionalEdge = Math.abs(weightedLean.overWeight - weightedLean.underWeight);
        return {
            lean,
            confidence: weightedLean.confidence,
            edge: Math.max(directionalEdge, weightedLean.edge * 0.6),
            expectedValue: lean === 'push' ? 0.5 : directionalProb
        };
    }
    calculateAgreement(predictions) {
        const leans = predictions.map(p => p.prediction.lean);
        const mostCommon = leans.reduce((acc, lean) => {
            acc[lean] = (acc[lean] || 0) + 1;
            return acc;
        }, {});
        const maxAgreement = Math.max(...Object.values(mostCommon));
        return maxAgreement / predictions.length;
    }
    calculateEnsembleConfidence(predictions) {
        const avgConfidence = predictions.reduce((sum, p) => sum + p.prediction.confidence * p.weight, 0) /
            predictions.reduce((sum, p) => sum + p.weight, 0);
        const agreement = this.calculateAgreement(predictions);
        // Boost confidence when models agree
        return Math.min(0.95, avgConfidence * (0.8 + agreement * 0.4));
    }
    getAdaptiveModelWeights(fighter, opponent) {
        const sampleSize = Math.max(0, fighter.history?.length || 0);
        const consistency = (fighter.fpConsistency ?? 50) / 100;
        const stdDev = fighter.fpStdDev ?? 18;
        let wBayes = 0.35;
        let wHist = 0.25;
        let wReg = 0.25;
        let wStyle = 0.15;
        if (sampleSize < 8) {
            wBayes += 0.08;
            wStyle += 0.05;
            wHist -= 0.08;
            wReg -= 0.05;
        }
        if (consistency < 0.45) {
            wBayes += 0.06;
            wStyle += 0.03;
            wHist -= 0.05;
            wReg -= 0.04;
        }
        if (stdDev > 24) {
            wBayes += 0.05;
            wStyle += 0.03;
            wHist -= 0.04;
            wReg -= 0.04;
        }
        if (!opponent?.loaded) {
            wStyle -= 0.08;
            wBayes += 0.04;
            wHist += 0.02;
            wReg += 0.02;
        }
        const safe = [wBayes, wHist, wReg, wStyle].map(v => Math.max(0.05, v));
        const total = safe.reduce((s, v) => s + v, 0);
        return {
            bayesian: safe[0] / total,
            historical: safe[1] / total,
            regression: safe[2] / total,
            style: safe[3] / total
        };
    }
    adjustConfidenceForDataQuality(fighter, opponent, confidence, agreement) {
        const sampleSize = Math.max(0, fighter.history?.length || 0);
        const sampleFactor = Math.min(1, sampleSize / 12);
        const consistencyFactor = Math.max(0.45, (fighter.fpConsistency ?? 50) / 100);
        const volatilityPenalty = Math.max(0.65, 1 - Math.max(0, (fighter.fpStdDev ?? 18) - 18) / 40);
        const opponentFactor = opponent?.loaded ? 1 : 0.9;
        const agreementFactor = 0.75 + (agreement * 0.25);
        const quality = sampleFactor * consistencyFactor * volatilityPenalty * opponentFactor;
        const adjusted = confidence * (0.7 + 0.3 * quality) * agreementFactor;
        return Math.max(0.35, Math.min(0.95, adjusted));
    }
    calculateImpliedOdds(line, expectedValue) {
        // Simplified odds calculation - in reality would use actual sportsbook odds
        return expectedValue > 0.5 ? 1.9 : 1.9; // Assume -110 odds for simplicity
    }
}
const fpEnsemblePredictor = new EnsemblePredictor();
function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function getConfidenceGrade(confidence) {
    if (confidence >= 82)
        return 'A';
    if (confidence >= 72)
        return 'B';
    if (confidence >= 60)
        return 'C';
    if (confidence >= 50)
        return 'D';
    return 'F';
}
function getScheduledRoundsContext(fighterName) {
    const normalizedName = normalizeName(fighterName);
    if (!normalizedName)
        return { rounds: null, source: 'unknown' };
    const headliner = findHeadlinerPair();
    if (headliner && (headliner.f1 === normalizedName || headliner.f2 === normalizedName)) {
        return { rounds: 5, source: 'inferred_main_event' };
    }
    // Non-main-event fights default to 3R. Don't trust scraped 5R — UFCStats
    // pre-fight pages don't reliably expose round counts.
    return { rounds: 3, source: 'card' };
    return { rounds: null, source: 'unknown' };
}
function normalizeLeanSource(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'fp' || raw === 'ss' || raw === 'td' || raw === 'ft')
        return raw;
    return null;
}
function sourceToPropType(source) {
    if (source === 'ss')
        return 'SS';
    if (source === 'td')
        return 'TD';
    if (source === 'ft')
        return 'FightTime';
    return 'Fantasy';
}
function formatSourceLabel(source) {
    if (source === 'ss')
        return 'SS';
    if (source === 'td')
        return 'TD';
    if (source === 'ft')
        return 'FT';
    return 'FP';
}
function buildEventDedupeKey(name) {
    const match = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
    if (!match)
        return name.toLowerCase().trim();
    const a = match[1].trim().split(/\s+/).pop()?.toLowerCase() || '';
    const b = match[2].trim().split(/\s+/).pop()?.toLowerCase() || '';
    return [a, b].sort().join('|');
}
function getSourceLineEntries(f, source) {
    const pairs = source === 'fp'
        ? [
            ['pick6', f.line_p6],
            ['underdog', f.line_ud],
            ['prizepicks', f.line_pp],
            ['betr', f.line_betr],
        ]
        : source === 'ss'
            ? [
                ['pick6', f.line_p6_ss],
                ['underdog', f.line_ud_ss],
                ['prizepicks', f.line_pp_ss],
                ['betr', f.line_betr_ss],
                ['draftkings_sportsbook', f.line_dk_ss],
            ]
            : source === 'ss_r1'
                ? [
                    ['prizepicks', f.line_pp_ss_r1],
                    ['underdog', f.line_ud_ss_r1],
                ]
                : source === 'td'
                    ? [
                        ['pick6', f.line_p6_td],
                        ['underdog', f.line_ud_td],
                        ['prizepicks', f.line_pp_td],
                        ['betr', f.line_betr_td],
                        ['draftkings_sportsbook', f.line_dk_td],
                    ]
                    : [
                        ['pick6', f.line_p6_ft],
                        ['underdog', f.line_ud_ft],
                        ['prizepicks', f.line_pp_ft],
                        ['betr', f.line_betr_ft],
                        ['draftkings_sportsbook', f.line_dk_ft],
                    ];
    return pairs
        .map(([platform, value]) => {
        if (value == null)
            return null;
        const num = Number(value);
        return Number.isFinite(num) ? { platform, value: num } : null;
    })
        .filter((entry) => entry != null);
}
function getSourcePlatformPriority(source) {
    if (currentPlatform === 'pick6')
        return ['pick6', 'underdog', 'prizepicks', 'draftkings_sportsbook', 'betr'];
    if (currentPlatform === 'underdog')
        return ['underdog', 'pick6', 'prizepicks', 'draftkings_sportsbook', 'betr'];
    if (currentPlatform === 'prizepicks')
        return ['prizepicks', 'pick6', 'underdog', 'draftkings_sportsbook', 'betr'];
    if (currentPlatform === 'draftkings_sportsbook') {
        return source === 'fp'
            ? ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook']
            : ['draftkings_sportsbook', 'pick6', 'underdog', 'prizepicks', 'betr'];
    }
    return ['betr', 'prizepicks', 'pick6', 'underdog', 'draftkings_sportsbook'];
}
function getSourceActivePlatformKey(f, source) {
    const entries = getSourceLineEntries(f, source);
    if (!entries.length)
        return null;
    const byPlatform = new Map(entries.map((entry) => [entry.platform, entry]));
    for (const platform of getSourcePlatformPriority(source)) {
        if (byPlatform.has(platform))
            return platform;
    }
    return entries[0]?.platform ?? null;
}
function getSourceActiveLine(f, source) {
    const platform = getSourceActivePlatformKey(f, source);
    if (!platform)
        return null;
    return getSourceLineEntries(f, source).find((entry) => entry.platform === platform)?.value ?? null;
}
// Pick6 and Betr give underdogs an OVER/More-only Fantasy Points prop (no Less/UNDER
// side). Underdog Fantasy AND PrizePicks both DO offer the underdog's FP UNDER, so they
// are deliberately NOT in this set (confirmed 2026-06-12 — PP previously thought to block
// it). Betr's underdog OVER is additionally inflated to +money odds (not true pick-em
// value), so the user doesn't take those bets. DK Sportsbook has no FP props. (SS/TD side
// availability is handled separately by ssUnderBookOffered/tdUnderBookOffered.)
const PICKEM_UNDER_FORBIDDEN_PLATFORMS = new Set(['pick6', 'betr']);
function isMoneylineUnderdog(f) {
    // Prefer the already-merged moneyline on the fighter, fall back to the odds map.
    const own = f.moneyline ?? resolveMoneylineFromMap(f.name);
    if (own != null && Number.isFinite(own))
        return own > 0;
    // Fallback: if opponent's moneyline is a known favorite (negative), this fighter is the underdog.
    const opponentNorm = normalizeName(f.opponent || '')?.toLowerCase() || '';
    if (!opponentNorm)
        return false;
    const opp = _fighterByNorm?.get(opponentNorm)
        || allFighters.find((entry) => (normalizeName(entry.name) || entry.name).toLowerCase() === opponentNorm)
        || null;
    const oppMl = opp?.moneyline ?? (opp ? resolveMoneylineFromMap(opp.name) : null);
    if (oppMl != null && Number.isFinite(oppMl) && oppMl < 0)
        return true;
    return false;
}
// Pick6 (DraftKings Pick6) and Underdog Fantasy use the SAME FP scoring, so a fighter's
// FP line should be ~equal on both books. When Pick6's line sits well ABOVE Underdog's,
// Pick6 is posting the underdog's More/OVER-only line (inflated, no Less side) while
// Underdog carries the real, under-able number. This is an authoritative dog signal that
// does NOT depend on the moneyline map — it catches the recurring isMoneylineUnderdog
// fail-open (missing bout in fight_odds_moneyline) that leaked Alex Pereira's Pick6 FP
// UNDER at 93.5 when his real Underdog line was 64.99.
function pick6FpInflatedVsUnderdog(f) {
    const p6 = f.line_p6 ?? null;
    const ud = f.line_ud ?? null;
    if (p6 == null || ud == null || ud <= 0)
        return false;
    // Same-scoring books: a ≥6-point AND ≥15% gap (Pick6 higher) is well beyond normal
    // line variance and reliably marks Pick6's dog over-only inflation.
    return p6 - ud >= 6 && p6 >= ud * 1.15;
}
function shouldSkipFpSideForFighter(f, source, direction, platformOverride) {
    if (source !== 'fp')
        return false;
    // Prefer the candidate's own book when the caller knows it (Best Picks builds one FP
    // candidate per book). Falling back to the priority-resolved active platform would, for
    // a fighter with FP lines on several books, judge every candidate by the top-priority
    // book — wrongly dropping e.g. a dog's placeable Underdog FP UNDER just because Pick6
    // also has a line for them.
    const platform = platformOverride ?? getSourceActivePlatformKey(f, source);
    if (!platform)
        return false;
    // Pick6 FP UNDER is unplaceable for underdogs (More/OVER-only). The Pick6-vs-Underdog
    // line divergence detects the dog even when the moneyline map is missing the bout, so
    // check it BEFORE the moneyline early-out below.
    if (direction === 'under' && platform === 'pick6' && pick6FpInflatedVsUnderdog(f))
        return true;
    if (!isMoneylineUnderdog(f))
        return false;
    if (direction === 'under' && PICKEM_UNDER_FORBIDDEN_PLATFORMS.has(platform))
        return true;
    if (direction === 'over' && platform === 'betr')
        return true;
    return false;
}
function formatSourcePlatformLabel(f, source, platformOverride) {
    const platform = platformOverride ?? getSourceActivePlatformKey(f, source);
    if (!platform)
        return '—';
    // When an override is provided, look up the line for that specific book
    // rather than priority-walking. Used by Best Picks to show PP-specific picks.
    const line = platformOverride
        ? (getSourceLineEntries(f, source).find((entry) => entry.platform === platformOverride)?.value ?? null)
        : getSourceActiveLine(f, source);
    if (line == null)
        return '—';
    const label = platform === 'pick6'
        ? 'Pick6'
        : platform === 'underdog'
            ? 'Underdog'
            : platform === 'prizepicks'
                ? 'PrizePicks'
                : platform === 'draftkings_sportsbook'
                    ? 'DK'
                    : 'Betr';
    return `${label} ${line}`;
}
function computeStatStdDev(values) {
    if (values.length < 2)
        return values.length === 1 ? 0 : null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    return Number.isFinite(variance) ? Math.sqrt(variance) : null;
}
function getSourceSampleSize(source, db) {
    const history = db.history || [];
    if (source === 'ss')
        return history.filter((fight) => Number.isFinite(Number(fight.sigStr))).length;
    if (source === 'td')
        return history.filter((fight) => Number.isFinite(Number(fight.td))).length;
    if (source === 'ft')
        return history.filter((fight) => Number.isFinite(Number(fight.timeSecs)) && Number(fight.timeSecs) > 0).length;
    return history.length;
}
function getSourceVarianceBand(source, db) {
    if (source === 'fp') {
        const std = db.fpStdDev ?? null;
        if (std == null)
            return null;
        if (std <= 13)
            return 'low';
        if (std <= 22)
            return 'mid';
        return 'high';
    }
    if (source === 'ss') {
        const std = db.ssStdDev ?? null;
        if (std == null)
            return null;
        if (std <= 7)
            return 'low';
        if (std <= 14)
            return 'mid';
        return 'high';
    }
    if (source === 'td') {
        const tdVals = (db.history || [])
            .map((fight) => fight.td)
            .filter((value) => typeof value === 'number' && Number.isFinite(value));
        const std = computeStatStdDev(tdVals);
        if (std == null)
            return null;
        if (std <= 0.9)
            return 'low';
        if (std <= 1.8)
            return 'mid';
        return 'high';
    }
    const timeVals = (db.history || [])
        .map((fight) => Number(fight.timeSecs) / 60)
        .filter((value) => Number.isFinite(value) && value > 0);
    const std = computeStatStdDev(timeVals);
    if (std == null)
        return null;
    if (std <= 2.4)
        return 'low';
    if (std <= 4.3)
        return 'mid';
    return 'high';
}
function getSourceFormTag(source, db, avgValue) {
    if (!db.loaded)
        return null;
    const history = db.history || [];
    if (history.length < 3)
        return null;
    if (source === 'fp') {
        const weightedAvg = db.avgFP_weighted ?? null;
        const baseline = avgValue ?? db.avgFP ?? null;
        if (weightedAvg == null || baseline == null)
            return null;
        const delta = weightedAvg - baseline;
        if (delta > 5)
            return 'up';
        if (delta < -5)
            return 'down';
        return 'flat';
    }
    const series = source === 'ss'
        ? history.map((fight) => fight.sigStr)
        : source === 'td'
            ? history.map((fight) => fight.td)
            : history.map((fight) => Number(fight.timeSecs) / 60);
    const values = series.filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (values.length < 3 || avgValue == null)
        return null;
    const recent = values.slice(0, 3);
    const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const delta = recentAvg - avgValue;
    if (source === 'ss') {
        if (delta > 7)
            return 'up';
        if (delta < -7)
            return 'down';
        return 'flat';
    }
    if (source === 'td') {
        if (delta > 1.0)
            return 'up';
        if (delta < -1.0)
            return 'down';
        return 'flat';
    }
    if (delta > 1.2)
        return 'up';
    if (delta < -1.2)
        return 'down';
    return 'flat';
}
function formatMemoryTagLabel(tag) {
    const [family, rawValue] = tag.split(':');
    const value = rawValue || '';
    if (family === 'grade')
        return `grade ${value.toUpperCase()}`;
    if (family === 'books') {
        if (value === 'single')
            return 'single-book spots';
        if (value === 'dual')
            return '2-book spots';
        if (value === 'multi')
            return 'multi-book spots';
        return '4+ book spots';
    }
    if (family === 'market') {
        if (value === 'consensus')
            return 'tight market consensus';
        if (value === 'cluster')
            return 'clustered markets';
        if (value === 'split')
            return 'split markets';
        return 'off-market numbers';
    }
    if (family === 'sample')
        return value === 'deep' ? 'deep samples' : value === 'medium' ? 'mid samples' : 'thin samples';
    if (family === 'variance')
        return value === 'low' ? 'low-variance spots' : value === 'mid' ? 'mid-variance spots' : 'high-variance spots';
    if (family === 'form')
        return value === 'up' ? 'rising form spots' : value === 'down' ? 'fading form spots' : 'flat-form spots';
    if (family === 'moneyline') {
        if (value === 'heavy_favorite')
            return 'heavy favorites';
        if (value === 'favorite')
            return 'favorites';
        if (value === 'heavy_underdog')
            return 'heavy underdogs';
        if (value === 'underdog')
            return 'underdogs';
        return 'pick-em moneylines';
    }
    if (family === 'rounds')
        return value === '5' ? '5-round fights' : value === '3' ? '3-round fights' : 'unknown-round fights';
    if (family === 'style')
        return `${value} styles`;
    if (family === 'opponent') {
        if (value === 'tough')
            return 'tough-opponent spots';
        if (value === 'soft')
            return 'soft-opponent spots';
        if (value === 'neutral')
            return 'neutral-opponent spots';
        return 'unknown-opponent spots';
    }
    if (family === 'edge')
        return value === 'strong' ? 'strong-edge spots' : value === 'medium' ? 'medium-edge spots' : 'thin-edge spots';
    if (family === 'platform') {
        if (value === 'pick6')
            return 'Pick6 lines';
        if (value === 'underdog')
            return 'Underdog lines';
        if (value === 'prizepicks')
            return 'PrizePicks lines';
        if (value === 'draftkings_sportsbook')
            return 'DK lines';
        return 'Betr lines';
    }
    if (family === 'career')
        return formatCareerArchetypeLabel(value);
    if (family === 'alert')
        return formatMatchupAlertLabel(value);
    return tag.replace(/:/g, ' ');
}
function deriveConfidenceMemoryTagsLive(context) {
    if (context.lean !== 'over' && context.lean !== 'under')
        return [];
    const tags = new Set();
    const grade = getConfidenceGrade(context.baseConfidence).toLowerCase();
    tags.add(`grade:${grade}`);
    const fighterEntry = allFighters.find((fighter) => fighter.name === context.fighterName) || null;
    const platform = fighterEntry ? getSourceActivePlatformKey(fighterEntry, context.source) : null;
    if (platform)
        tags.add(`platform:${platform}`);
    const lineCount = context.availableLines.length;
    if (lineCount <= 1)
        tags.add('books:single');
    else if (lineCount === 2)
        tags.add('books:dual');
    else if (lineCount >= 4)
        tags.add('books:quad');
    else
        tags.add('books:multi');
    if (lineCount > 1) {
        const spread = Math.max(...context.availableLines) - Math.min(...context.availableLines);
        if (spread <= 1.0)
            tags.add('market:consensus');
        else if (spread <= 2.5)
            tags.add('market:cluster');
        else
            tags.add('market:split');
        const marketAvg = context.availableLines.reduce((sum, value) => sum + value, 0) / lineCount;
        if (context.selectedLine != null && Math.abs(context.selectedLine - marketAvg) >= 1.5) {
            tags.add('market:off_avg');
        }
    }
    const sampleSize = getSourceSampleSize(context.source, context.db);
    if (sampleSize >= 8)
        tags.add('sample:deep');
    else if (sampleSize >= 5)
        tags.add('sample:medium');
    else
        tags.add('sample:thin');
    const varianceBand = getSourceVarianceBand(context.source, context.db);
    if (varianceBand)
        tags.add(`variance:${varianceBand}`);
    const formTag = getSourceFormTag(context.source, context.db, context.avgValue);
    if (formTag)
        tags.add(`form:${formTag}`);
    const roundContext = getScheduledRoundsContext(context.fighterName);
    tags.add(roundContext.rounds === 5 ? 'rounds:5' : roundContext.rounds === 3 ? 'rounds:3' : 'rounds:unknown');
    if (context.moneyline != null && Number.isFinite(context.moneyline)) {
        if (context.moneyline <= -250)
            tags.add('moneyline:heavy_favorite');
        else if (context.moneyline <= -120)
            tags.add('moneyline:favorite');
        else if (context.moneyline >= 250)
            tags.add('moneyline:heavy_underdog');
        else if (context.moneyline >= 120)
            tags.add('moneyline:underdog');
        else
            tags.add('moneyline:pickem');
    }
    if (context.db.style)
        tags.add(`style:${context.db.style}`);
    if (context.oppDB?.loaded) {
        const oppStrength = calcOpponentStrengthScore(context.oppDB).score;
        if (oppStrength >= 0.8)
            tags.add('opponent:tough');
        else if (oppStrength <= -0.35)
            tags.add('opponent:soft');
        else
            tags.add('opponent:neutral');
    }
    else {
        tags.add('opponent:unknown');
    }
    const scoreAbs = Math.abs(context.score);
    if (scoreAbs >= 3)
        tags.add('edge:strong');
    else if (scoreAbs >= 1.5)
        tags.add('edge:medium');
    else
        tags.add('edge:thin');
    const archetypeProfile = learnArchetypeProfile(context.fighterName, context.db, context.oppDB, context.moneyline);
    tags.add(`career:${archetypeProfile.careerLabel}`);
    if (archetypeProfile.matchupAlert !== 'none')
        tags.add(`alert:${archetypeProfile.matchupAlert}`);
    return Array.from(tags);
}
function deriveConfidenceMemoryTagsFromSnapshotPick(pick) {
    if (Array.isArray(pick.memoryTags) && pick.memoryTags.length) {
        return Array.from(new Set(pick.memoryTags.map((tag) => String(tag)).filter(Boolean)));
    }
    const tags = new Set();
    const confidence = Number(pick.confidence);
    if (Number.isFinite(confidence))
        tags.add(`grade:${getConfidenceGrade(confidence).toLowerCase()}`);
    const platform = String(pick.activePlatform || '').trim().toLowerCase();
    if (platform)
        tags.add(`platform:${platform}`);
    const source = normalizeLeanSource(pick.source) || 'fp';
    const lineBuckets = pick.lines && typeof pick.lines === 'object' ? pick.lines : {};
    const entries = ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook']
        .map((book) => {
        const bucket = lineBuckets[book];
        if (!bucket || typeof bucket !== 'object')
            return null;
        const rawValue = source === 'fp' ? bucket.fp : source === 'ss' ? bucket.ss : source === 'td' ? bucket.td : bucket.ft;
        const value = Number(rawValue);
        return Number.isFinite(value) ? value : null;
    })
        .filter((value) => value != null);
    if (entries.length <= 1)
        tags.add('books:single');
    else if (entries.length === 2)
        tags.add('books:dual');
    else if (entries.length >= 4)
        tags.add('books:quad');
    else
        tags.add('books:multi');
    if (entries.length > 1) {
        const spread = Math.max(...entries) - Math.min(...entries);
        if (spread <= 1.0)
            tags.add('market:consensus');
        else if (spread <= 2.5)
            tags.add('market:cluster');
        else
            tags.add('market:split');
        const activeLine = Number(pick.activeLine);
        if (Number.isFinite(activeLine)) {
            const marketAvg = entries.reduce((sum, value) => sum + value, 0) / entries.length;
            if (Math.abs(activeLine - marketAvg) >= 1.5)
                tags.add('market:off_avg');
        }
    }
    return Array.from(tags);
}
function makeConfidenceMemoryBucket(hits, total, edgeSum) {
    return {
        hits,
        total,
        edgeSum,
        hitRate: total ? hits / total : 0,
        avgEdge: total ? edgeSum / total : 0,
    };
}
async function loadConfidenceMemoryEngine(force = false) {
    if (!force && _confidenceMemoryCache)
        return _confidenceMemoryCache;
    const payload = await storageGet([
        STORAGE_PROP_ARCHIVE_KEY,
        STORAGE_AI_LEAN_SNAPSHOT_KEY,
    ]);
    const archiveRows = Array.isArray(payload[STORAGE_PROP_ARCHIVE_KEY])
        ? payload[STORAGE_PROP_ARCHIVE_KEY]
        : [];
    const aiSnapshots = Array.isArray(payload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
        ? payload[STORAGE_AI_LEAN_SNAPSHOT_KEY]
        : [];
    const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
    const resolvedRows = archiveRows.filter((row) => {
        const rowTs = Date.parse(row.date);
        return Number.isFinite(rowTs)
            && rowTs >= londonTs
            && Number.isFinite(Number(row.line))
            && Number.isFinite(Number(row.result));
    });
    const rowsByEvent = new Map();
    for (const row of resolvedRows) {
        const key = buildEventDedupeKey(String(row.event || ''));
        if (!key)
            continue;
        const bucket = rowsByEvent.get(key) || [];
        bucket.push(row);
        rowsByEvent.set(key, bucket);
    }
    const baselineAcc = new Map();
    const tagAcc = new Map();
    let resolvedSamples = 0;
    let taggedSamples = 0;
    for (const snap of aiSnapshots) {
        const eventKey = buildEventDedupeKey(String(snap?.event || ''));
        if (!eventKey)
            continue;
        const eventRows = rowsByEvent.get(eventKey) || [];
        if (!eventRows.length)
            continue;
        for (const rawPick of (snap?.picks ?? [])) {
            const source = normalizeLeanSource(rawPick?.source);
            const lean = String(rawPick?.lean || '').toLowerCase();
            const activeLine = Number(rawPick?.activeLine);
            const fighter = normalizeName(String(rawPick?.fighter || ''))?.toLowerCase();
            if (!source || !fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine))
                continue;
            const platform = String(rawPick?.activePlatform || '').trim().toLowerCase();
            const propType = sourceToPropType(source);
            const match = eventRows
                .filter((row) => normalizeName(row.fighter)?.toLowerCase() === fighter &&
                String(row.propType) === propType &&
                Number.isFinite(Number(row.result)))
                .sort((a, b) => {
                const aPlatformPenalty = platform && String(a.platform || '').toLowerCase() === platform ? 0 : 1;
                const bPlatformPenalty = platform && String(b.platform || '').toLowerCase() === platform ? 0 : 1;
                if (aPlatformPenalty !== bPlatformPenalty)
                    return aPlatformPenalty - bPlatformPenalty;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            const result = Number(match.result);
            const directionalEdge = lean === 'over' ? (result - activeLine) : (activeLine - result);
            if (!Number.isFinite(directionalEdge) || directionalEdge === 0)
                continue;
            resolvedSamples++;
            const baselineKey = `${source}|${lean}`;
            const baselineBucket = baselineAcc.get(baselineKey) || { hits: 0, total: 0, edgeSum: 0 };
            baselineBucket.total += 1;
            baselineBucket.edgeSum += directionalEdge;
            if (directionalEdge > 0)
                baselineBucket.hits += 1;
            baselineAcc.set(baselineKey, baselineBucket);
            const tags = deriveConfidenceMemoryTagsFromSnapshotPick(rawPick);
            if (tags.length)
                taggedSamples++;
            for (const tag of tags) {
                const tagKey = `${baselineKey}|${tag}`;
                const bucket = tagAcc.get(tagKey) || { hits: 0, total: 0, edgeSum: 0 };
                bucket.total += 1;
                bucket.edgeSum += directionalEdge;
                if (directionalEdge > 0)
                    bucket.hits += 1;
                tagAcc.set(tagKey, bucket);
            }
        }
    }
    const baselines = new Map();
    for (const [key, bucket] of baselineAcc.entries()) {
        baselines.set(key, makeConfidenceMemoryBucket(bucket.hits, bucket.total, bucket.edgeSum));
    }
    const tags = new Map();
    for (const [key, bucket] of tagAcc.entries()) {
        tags.set(key, makeConfidenceMemoryBucket(bucket.hits, bucket.total, bucket.edgeSum));
    }
    const signals = [];
    for (const [key, bucket] of tags.entries()) {
        if (bucket.total < 3)
            continue;
        const [sourceRaw, leanRaw, tag] = key.split('|', 3);
        const source = normalizeLeanSource(sourceRaw);
        if (!source || (leanRaw !== 'over' && leanRaw !== 'under') || !tag)
            continue;
        const baseline = baselines.get(`${source}|${leanRaw}`);
        const baselineHitRate = baseline?.total ? baseline.hitRate : 0.5;
        const hitDelta = bucket.hitRate - baselineHitRate;
        const sampleWeight = clampNumber((bucket.total - 2) / 8, 0.15, 1);
        const deltaPoints = hitDelta * 16 * sampleWeight;
        signals.push({
            source,
            lean: leanRaw,
            tag,
            tagLabel: formatMemoryTagLabel(tag),
            hitRate: bucket.hitRate,
            avgEdge: bucket.avgEdge,
            total: bucket.total,
            baselineHitRate,
            deltaPoints,
        });
    }
    const topHit = [...signals]
        .filter((signal) => signal.deltaPoints > 0.75)
        .sort((a, b) => b.deltaPoints - a.deltaPoints || b.total - a.total)[0] || null;
    const topMiss = [...signals]
        .filter((signal) => signal.deltaPoints < -0.75)
        .sort((a, b) => a.deltaPoints - b.deltaPoints || b.total - a.total)[0] || null;
    _confidenceMemoryCache = {
        baselines,
        tags,
        topHit,
        topMiss,
        resolvedSamples,
        taggedSamples,
    };
    return _confidenceMemoryCache;
}
function applyConfidenceMemoryAdjustment(context) {
    if (context.lean !== 'over' && context.lean !== 'under') {
        return { confidence: Math.round(context.baseConfidence), delta: 0, note: null, signal: null };
    }
    const cache = _confidenceMemoryCache;
    if (!cache)
        return { confidence: Math.round(context.baseConfidence), delta: 0, note: null, signal: null };
    const baseline = cache.baselines.get(`${context.source}|${context.lean}`);
    const baselineHitRate = baseline && baseline.total >= 4 ? baseline.hitRate : 0.5;
    const tags = deriveConfidenceMemoryTagsLive(context);
    const strongestByFamily = new Map();
    for (const tag of tags) {
        const bucket = cache.tags.get(`${context.source}|${context.lean}|${tag}`);
        if (!bucket || bucket.total < 3)
            continue;
        const hitDelta = bucket.hitRate - baselineHitRate;
        if (Math.abs(hitDelta) < 0.08)
            continue;
        const sampleWeight = clampNumber((bucket.total - 2) / 8, 0.18, 1);
        const edgeWeight = clampNumber(0.85 + Math.min(0.2, Math.abs(bucket.avgEdge) / 6), 0.85, 1.05);
        const deltaPoints = hitDelta * 16 * sampleWeight * edgeWeight;
        const signal = {
            source: context.source,
            lean: context.lean,
            tag,
            tagLabel: formatMemoryTagLabel(tag),
            hitRate: bucket.hitRate,
            avgEdge: bucket.avgEdge,
            total: bucket.total,
            baselineHitRate,
            deltaPoints,
        };
        const family = tag.split(':')[0];
        const existing = strongestByFamily.get(family);
        if (!existing || Math.abs(signal.deltaPoints) > Math.abs(existing.deltaPoints)) {
            strongestByFamily.set(family, signal);
        }
    }
    const topSignals = Array.from(strongestByFamily.values())
        .sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints) || b.total - a.total)
        .slice(0, 2);
    if (!topSignals.length) {
        return { confidence: Math.round(context.baseConfidence), delta: 0, note: null, signal: null };
    }
    const rawDelta = topSignals.reduce((sum, signal) => sum + signal.deltaPoints, 0);
    const delta = Math.round(clampNumber(rawDelta, -6, 6));
    if (delta === 0) {
        return { confidence: Math.round(context.baseConfidence), delta: 0, note: null, signal: topSignals[0] };
    }
    const confidence = Math.round(clampNumber(context.baseConfidence + delta, 38, 95));
    const primarySignal = topSignals[0];
    const pct = Math.round(primarySignal.hitRate * 100);
    const baselinePct = Math.round(primarySignal.baselineHitRate * 100);
    const note = delta > 0
        ? `Memory engine: ${formatSourceLabel(context.source)} ${context.lean.toUpperCase()} ${primarySignal.tagLabel} are ${pct}% over ${primarySignal.total} settled samples (baseline ${baselinePct}%), so confidence was nudged up.`
        : `Memory engine: ${formatSourceLabel(context.source)} ${context.lean.toUpperCase()} ${primarySignal.tagLabel} are only ${pct}% over ${primarySignal.total} settled samples (baseline ${baselinePct}%), so confidence was trimmed.`;
    return { confidence, delta, note, signal: primarySignal };
}
function formatRivalryBrainLabel(model) {
    if (model === 'pace')
        return 'Pace Model';
    if (model === 'market')
        return 'Market Model';
    if (model === 'historical')
        return 'Historical Model';
    return 'Style Model';
}
function getCurrentFantasyBrainPlatform() {
    if (currentPlatform === 'underdog')
        return 'underdog';
    if (currentPlatform === 'prizepicks')
        return 'prizepicks';
    if (currentPlatform === 'betr')
        return 'betr';
    return 'draftkings';
}
function buildModelRivalry(fighterName, lean, db, history, line, selectedLine, availableLines, avgFP, effectiveFP, oppDB, moneyline) {
    const opponent = oppDB?.loaded ? oppDB : null;
    const historyPlatform = currentPlatform === 'pick6' ? 'pick6' :
        currentPlatform === 'underdog' ? 'underdog' :
            currentPlatform === 'prizepicks' ? 'prizepicks' :
                currentPlatform === 'draftkings_sportsbook' ? 'pick6' :
                    'betr';
    const historyFP = history
        .map((fight) => getFightFantasyValueForPlatform(fight, historyPlatform))
        .filter((value) => Number.isFinite(value));
    const marketAvg = availableLines.length
        ? availableLines.reduce((sum, value) => sum + value, 0) / availableLines.length
        : line;
    const lineSpread = availableLines.length > 1 ? Math.max(...availableLines) - Math.min(...availableLines) : 0;
    const features = fantasyBrain.buildFeatures(db, opponent, line);
    const striking = fantasyBrain.strikingModel(features, db, opponent);
    const grappling = fantasyBrain.grapplingModel(features, db, opponent);
    const finishing = fantasyBrain.finishingModel(features, db, opponent);
    const neutralMatchup = { value: 0, confidence: 0.5, reasons: [] };
    const paceProjection = fantasyBrain.fantasyScoringModel(getCurrentFantasyBrainPlatform(), line, features, striking, grappling, finishing, neutralMatchup).expectedScore;
    const paceEdge = paceProjection - line;
    const paceLean = paceEdge >= 4 ? 'over' : paceEdge <= -4 ? 'under' : 'push';
    const paceConfidence = Math.round(clampNumber(paceLean === 'push'
        ? 50 + Math.abs(paceEdge) * 0.45
        : 46 + Math.abs(paceEdge) * 1.15 + features.dataQuality * 14 + Math.abs(features.paceProjection - 7.2) * 2.6, 46, 90));
    const bayesian = calcBayesianLean(db, line, opponent, undefined, 'fp');
    const optimizedLine = optimizeLinePrediction(db, opponent);
    let marketSignal = (optimizedLine - line) * 0.50;
    marketSignal += (bayesian.probability - 0.5) * 26;
    marketSignal += selectedLine != null && availableLines.length > 1 ? (marketAvg - selectedLine) * 1.6 : 0;
    marketSignal += moneyline != null
        ? moneyline < 0
            ? Math.min(2.1, Math.abs(moneyline) / 260)
            : -Math.min(2.1, moneyline / 260)
        : 0;
    const marketProjection = line + (marketSignal * 2.4);
    const marketLean = marketSignal >= 2.2 ? 'over' : marketSignal <= -2.2 ? 'under' : 'push';
    const marketConfidence = Math.round(clampNumber(marketLean === 'push'
        ? 50 + bayesian.confidence * 10
        : 46 + Math.abs(marketSignal) * 2.5 + availableLines.length * 4 + clampNumber((2.8 - lineSpread) * 2.2, -4, 7), 46, 90));
    const timeWeightedAvg = parseFloat(advancedTimeWeightedAverage(history, avgFP ?? effectiveFP ?? line).toFixed(1));
    const weightedAvg = db.avgFP_weighted ?? avgFP ?? effectiveFP ?? timeWeightedAvg;
    const recentWindow = historyFP.slice(0, 4);
    const hitRate = historyFP.length ? historyFP.filter((value) => value > line).length / historyFP.length : 0.5;
    const recentHitRate = recentWindow.length ? recentWindow.filter((value) => value > line).length / recentWindow.length : hitRate;
    const historicalProjection = (weightedAvg * 0.55) + (timeWeightedAvg * 0.30) + ((effectiveFP ?? weightedAvg ?? line) * 0.15);
    const historicalSignal = (historicalProjection - line) + ((hitRate - 0.5) * 10) + ((recentHitRate - 0.5) * 5);
    const historicalLean = historicalSignal >= 4 ? 'over' : historicalSignal <= -4 ? 'under' : 'push';
    const historicalConfidence = Math.round(clampNumber(historicalLean === 'push'
        ? 50 + Math.abs(historicalSignal) * 0.35
        : 45 + Math.abs(historicalSignal) * 1.1 + clampNumber(historyFP.length / 10, 0, 1) * 16 + Math.abs(recentHitRate - 0.5) * 22, 45, 91));
    const historicalHits = historyFP.filter((value) => value > line).length;
    const historicalNote = historyFP.length
        ? `${weightedAvg.toFixed(1)} weighted FP with ${historicalHits}/${historyFP.length} historical hits over ${line}.`
        : `${weightedAvg.toFixed(1)} weighted FP, but the history sample is still thin.`;
    const styleMatch = opponent ? styleMatchupEdge(db.style, opponent.style, db, opponent) : { delta: 0, edges: [] };
    const defenseRead = opponent ? calcOpponentDefenseScore(opponent, line) : { delta: 0, edges: [] };
    const archetypeRead = calcArchetypeLearnerEdge(fighterName, db, opponent, moneyline, line, avgFP ?? effectiveFP ?? null);
    const styleSignal = styleMatch.delta + archetypeRead.delta + (defenseRead.delta * 0.80);
    const styleProjection = line + (styleSignal * 3.2);
    const styleLean = styleSignal >= 1.1 ? 'over' : styleSignal <= -1.1 ? 'under' : 'push';
    const styleConfidence = Math.round(clampNumber(styleLean === 'push'
        ? 50 + Math.abs(styleSignal) * 3
        : 44 + Math.abs(styleSignal) * 11 + (opponent ? 6 : 0) + Math.max(0, archetypeRead.profile.confidence - 60) * 0.30, 44, 89));
    const models = [
        {
            model: 'pace',
            label: formatRivalryBrainLabel('pace'),
            lean: paceLean,
            confidence: paceConfidence,
            edge: parseFloat(paceEdge.toFixed(1)),
            projected: parseFloat(paceProjection.toFixed(1)),
            note: `Tempo ${features.paceProjection.toFixed(1)}/min with ${features.expectedFightDurationMins.toFixed(1)} mins projects ${paceProjection.toFixed(1)} FP.`,
        },
        {
            model: 'market',
            label: formatRivalryBrainLabel('market'),
            lean: marketLean,
            confidence: marketConfidence,
            edge: parseFloat(marketSignal.toFixed(1)),
            projected: parseFloat(marketProjection.toFixed(1)),
            note: `Bayes ${Math.round(bayesian.probability * 100)}%, optimized line ${optimizedLine}, market avg ${marketAvg.toFixed(1)}${selectedLine != null ? `, live line ${selectedLine}` : ''}.`,
        },
        {
            model: 'historical',
            label: formatRivalryBrainLabel('historical'),
            lean: historicalLean,
            confidence: historicalConfidence,
            edge: parseFloat(historicalSignal.toFixed(1)),
            projected: parseFloat(historicalProjection.toFixed(1)),
            note: historicalNote,
        },
        {
            model: 'style',
            label: formatRivalryBrainLabel('style'),
            lean: styleLean,
            confidence: styleConfidence,
            edge: parseFloat(styleSignal.toFixed(1)),
            projected: parseFloat(styleProjection.toFixed(1)),
            note: `${archetypeRead.profile.summary}${opponent ? ` against ${opponent.style || 'balanced'} matchup pressure.` : '.'}`,
        },
    ];
    const directional = models.filter((model) => model.lean !== 'push');
    const weightedVote = directional.reduce((sum, model) => sum + (model.lean === 'over' ? model.confidence : -model.confidence), 0);
    const directionalWeight = directional.reduce((sum, model) => sum + model.confidence, 0);
    const normalizedVote = directionalWeight ? weightedVote / directionalWeight : 0;
    const consensusLean = normalizedVote >= 0.14 ? 'over' :
        normalizedVote <= -0.14 ? 'under' :
            'push';
    const consensusCount = consensusLean === 'push'
        ? 0
        : models.filter((model) => model.lean === consensusLean).length;
    const strongDissent = consensusLean === 'push'
        ? null
        : models
            .filter((model) => model.lean !== 'push' && model.lean !== consensusLean && model.confidence >= 62)
            .sort((a, b) => b.confidence - a.confidence || Math.abs(b.edge) - Math.abs(a.edge))[0] || null;
    let confidenceDelta = 0;
    let confidenceNote = null;
    if (lean !== 'push') {
        if (consensusLean !== 'push' && consensusLean !== lean) {
            confidenceDelta = -Math.round(clampNumber(2 + Math.abs(normalizedVote) * 4, 2, 5));
            confidenceNote = `Model rivalry: the brain pack leans ${consensusLean.toUpperCase()} against the main FP lean, so confidence was trimmed.`;
        }
        else if (consensusLean === lean && strongDissent) {
            confidenceDelta = -Math.round(clampNumber((strongDissent.confidence - 56) / 6, 1, 4));
            confidenceNote = `Model rivalry: ${strongDissent.label} strongly dissents ${strongDissent.lean.toUpperCase()} (${strongDissent.confidence}%), so confidence was trimmed.`;
        }
        else if (consensusLean === lean && consensusCount >= 3) {
            confidenceDelta = consensusCount === models.length ? 3 : 2;
            confidenceNote = `Model rivalry: ${consensusCount}/${models.length} brains align ${lean.toUpperCase()} with no strong dissenter, so confidence got a small bump.`;
        }
    }
    const summary = consensusLean === 'push'
        ? `Model rivalry: brains are split with no clear FP consensus.`
        : `Model rivalry: ${consensusCount}/${models.length} brains lean ${consensusLean.toUpperCase()}${strongDissent ? `, but ${strongDissent.label} dissents ${strongDissent.lean.toUpperCase()} ${strongDissent.confidence}%` : ''}.`;
    const dissentSummary = strongDissent
        ? `${strongDissent.label} dissents ${strongDissent.lean.toUpperCase()} ${strongDissent.confidence}% while the rivalry consensus stays ${consensusLean.toUpperCase()}.`
        : null;
    return {
        models,
        consensusLean,
        consensusCount,
        summary,
        dissentSummary,
        confidenceDelta,
        confidenceNote,
        strongDissent,
    };
}
// ── FAIR VALUE GENERATOR ────────────────────────────────────────────────────
// Confidence-weighted average of rivalry model projections → "fair line".
// Compare to each book's actual line to surface edge.
function computeFairValue(rivalry, activeLine, perBookLines) {
    const projected = rivalry.models.filter(m => m.projected != null && m.confidence > 0);
    if (projected.length < 2)
        return null;
    let totalWeight = 0;
    let weightedSum = 0;
    for (const m of projected) {
        totalWeight += m.confidence;
        weightedSum += m.projected * m.confidence;
    }
    const fairValue = parseFloat((weightedSum / totalWeight).toFixed(1));
    const fairValueEdge = activeLine != null
        ? parseFloat((fairValue - activeLine).toFixed(1))
        : 0;
    const fairValuePerBook = perBookLines
        .filter(b => b.line != null)
        .map(b => ({
        source: b.source,
        line: b.line,
        edge: parseFloat((fairValue - b.line).toFixed(1)),
    }))
        .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
    return { fairValue, fairValueEdge, fairValuePerBook };
}
function calcEnhancedFPConfidence(fighterName, lean, score, db, history, line, selectedLine, availableLines, avgFP, effectiveFP, oppDB, moneyline, restDaysSince, lineStdDevs, rivalry) {
    const opponent = oppDB?.loaded ? oppDB : null;
    const ensemble = fpEnsemblePredictor.predict(db, line, opponent);
    const bayesian = calcBayesianLean(db, line, opponent, undefined, 'fp');
    const optimizedLine = optimizeLinePrediction(db, opponent);
    const timeWeightedAvg = parseFloat(advancedTimeWeightedAverage(history, avgFP ?? effectiveFP ?? line).toFixed(1));
    const sampleSize = history.length;
    const lineCount = availableLines.length;
    const marketAvg = lineCount
        ? availableLines.reduce((sum, value) => sum + value, 0) / lineCount
        : line;
    const lineSpread = lineCount > 1 ? Math.max(...availableLines) - Math.min(...availableLines) : 0;
    const selectedGap = selectedLine != null && lineCount > 1 ? Math.abs(selectedLine - marketAvg) : 0;
    const bookCoverageFactor = lineCount <= 1 ? 0.56 : lineCount === 2 ? 0.74 : 0.92;
    const spreadFactor = lineCount <= 1 ? 0.62 : clampNumber(1 - (lineSpread / 5.5), 0.18, 1);
    const selectedAgreementFactor = lineCount <= 1 ? 0.62 : clampNumber(1 - (selectedGap / 2.75), 0.35, 1);
    const lineAgreementFactor = clampNumber(bookCoverageFactor * 0.25 + spreadFactor * 0.55 + selectedAgreementFactor * 0.20, 0.25, 1);
    const sampleFactor = clampNumber((sampleSize - 2) / 8, 0.22, 1);
    const stdDev = db.fpStdDev ?? 18;
    const consistency = db.fpConsistency ?? 50;
    const volatilityFactor = clampNumber(1 - Math.max(0, stdDev - 10) / 22, 0.18, 1);
    const consistencyFactor = clampNumber((consistency - 30) / 50, 0.18, 1);
    const varianceFactor = clampNumber(volatilityFactor * 0.55 + consistencyFactor * 0.45, 0.18, 1);
    const oppStrength = calcOpponentStrengthScore(opponent);
    const oppSampleFactor = opponent ? clampNumber((opponent.history?.length || 0) / 8, 0.35, 1) : 0.45;
    const opponentFactor = opponent
        ? clampNumber(0.45 + clampNumber(Math.abs(oppStrength.score) / 1.65, 0, 1) * 0.35 + oppSampleFactor * 0.20, 0.45, 0.95)
        : 0.55;
    const weightedAvg = db.avgFP_weighted ?? avgFP ?? timeWeightedAvg;
    const formDelta = weightedAvg != null && avgFP != null ? weightedAvg - avgFP : calcWeightedFormTrend(history).trend;
    const formDirection = formDelta > 4 ? 'over' : formDelta < -4 ? 'under' : 'push';
    const formAlignmentFactor = lean === 'push'
        ? 0.62
        : formDirection === 'push'
            ? 0.68
            : formDirection === lean
                ? clampNumber(0.76 + (Math.abs(formDelta) / 18), 0.76, 0.98)
                : clampNumber(0.34 + (Math.abs(formDelta) / 40), 0.34, 0.58);
    const formStabilityFactor = clampNumber(1 - Math.max(0, Math.abs(formDelta) - 12) / 18, 0.25, 1);
    const recentFormFactor = clampNumber(formAlignmentFactor * 0.65 + formStabilityFactor * 0.35, 0.25, 1);
    const roundContext = getScheduledRoundsContext(fighterName);
    let roundContextFactor = 0.62;
    if (roundContext.rounds === 5) {
        const experienceFactor = clampNumber((db.fiveRoundRate ?? 0) / 0.35, 0.25, 1);
        const durationFit = db.avgTimeMins != null
            ? clampNumber(1 - Math.abs(db.avgTimeMins - 15) / 8, 0.30, 1)
            : 0.72;
        const perRoundFactor = db.avgFP_perRound != null ? 0.90 : 0.65;
        roundContextFactor = clampNumber(experienceFactor * 0.40 + durationFit * 0.35 + perRoundFactor * 0.25, 0.40, 0.95);
    }
    else if (roundContext.rounds === 3) {
        const durationFit = db.avgTimeMins != null
            ? clampNumber(1 - Math.max(0, db.avgTimeMins - 12) / 7, 0.35, 1)
            : 0.75;
        const formatFit = clampNumber(1 - (db.fiveRoundRate ?? 0) * 0.60, 0.55, 1);
        roundContextFactor = clampNumber(durationFit * 0.65 + formatFit * 0.35, 0.45, 0.95);
    }
    if (roundContext.source === 'inferred_main_event' || roundContext.source === 'inferred_co_main') {
        roundContextFactor = Math.max(0.40, roundContextFactor - 0.05);
    }
    const edgePoints = effectiveFP != null ? Math.abs(effectiveFP - line) : Math.abs(score) * 4.5;
    const edgeFactor = clampNumber(edgePoints / 18, 0.15, 1);
    const scoreFactor = clampNumber(Math.abs(score) / 4.25, 0.15, 1);
    const signalFactor = clampNumber(edgeFactor * 0.60 + scoreFactor * 0.40, 0.15, 1);
    const multivariateFactor = sampleSize >= 3
        ? calcMultivariateConfidence(db, history, score, lineStdDevs, sampleSize, restDaysSince) / 100
        : 0.52;
    const ensembleSupportFactor = lean === 'push'
        ? 0.56
        : ensemble.finalPrediction.lean === lean
            ? clampNumber(0.58 + ensemble.confidence * 0.38, 0.58, 0.95)
            : ensemble.finalPrediction.lean === 'push'
                ? 0.52
                : clampNumber(0.26 + ensemble.confidence * 0.24, 0.26, 0.55);
    const rivalrySupportFactor = lean === 'push'
        ? 0.56
        : rivalry.consensusLean === 'push'
            ? 0.58
            : rivalry.consensusLean === lean
                ? rivalry.strongDissent
                    ? 0.66
                    : clampNumber(0.74 + (rivalry.consensusCount / Math.max(1, rivalry.models.length)) * 0.16, 0.74, 0.96)
                : 0.42;
    const composite = signalFactor * 0.16 +
        multivariateFactor * 0.16 +
        lineAgreementFactor * 0.15 +
        sampleFactor * 0.12 +
        varianceFactor * 0.12 +
        opponentFactor * 0.07 +
        recentFormFactor * 0.08 +
        roundContextFactor * 0.06 +
        ensembleSupportFactor * 0.05 +
        rivalrySupportFactor * 0.03;
    let confidence = Math.round(clampNumber(composite * 100, lean === 'push' ? 42 : 38, 95));
    if (lean === 'push') {
        confidence = Math.min(confidence, 58);
    }
    confidence = Math.round(clampNumber(confidence + rivalry.confidenceDelta, lean === 'push' ? 42 : 38, 95));
    const memoryAdjustment = applyConfidenceMemoryAdjustment({
        fighterName,
        source: 'fp',
        lean,
        baseConfidence: confidence,
        score,
        db,
        avgValue: avgFP ?? effectiveFP ?? null,
        line,
        selectedLine,
        availableLines,
        oppDB,
        moneyline,
    });
    confidence = memoryAdjustment.confidence;
    const grade = getConfidenceGrade(confidence);
    const agreementText = lineCount <= 1
        ? '1-book line'
        : lineSpread <= 1.0
            ? `${lineCount}-book consensus`
            : lineSpread <= 2.5
                ? `${lineCount}-book cluster`
                : `${lineCount}-book split`;
    const sampleText = sampleSize >= 8 ? `${sampleSize}-fight sample` : sampleSize >= 5 ? `${sampleSize}-fight sample` : `sample ${sampleSize}`;
    const varianceText = varianceFactor >= 0.78 ? 'low variance' : varianceFactor >= 0.58 ? 'moderate variance' : 'high variance';
    const opponentText = opponent == null
        ? 'opp pending'
        : opponentFactor >= 0.78
            ? 'clear opp read'
            : opponentFactor >= 0.62
                ? 'opp context usable'
                : 'opp context thin';
    const formText = recentFormFactor >= 0.78
        ? (formDirection === lean && lean !== 'push' ? 'form aligned' : 'stable form')
        : recentFormFactor >= 0.60
            ? 'form mixed'
            : 'form volatile';
    const roundText = roundContext.rounds == null
        ? 'rounds unknown'
        : `${roundContext.rounds}R ${roundContext.source === 'card' ? 'confirmed' : 'inferred'}`;
    const rivalryText = rivalry.consensusLean === 'push'
        ? 'rivalry split'
        : rivalry.strongDissent
            ? `rivalry split (${rivalry.consensusLean.toUpperCase()} consensus)`
            : `rivalry ${rivalry.consensusCount}/${rivalry.models.length} aligned`;
    return {
        confidence,
        grade,
        summary: `Confidence ${grade} (${confidence}): ${agreementText}, ${sampleText}, ${varianceText}, ${opponentText}, ${formText}, ${roundText}, ${rivalryText}${memoryAdjustment.delta ? `, memory ${memoryAdjustment.delta > 0 ? '+' : ''}${memoryAdjustment.delta}` : ''}`,
        memoryDelta: memoryAdjustment.delta,
        memoryNote: memoryAdjustment.note,
        rivalryDelta: rivalry.confidenceDelta,
        rivalryNote: rivalry.confidenceNote,
        ensembleAgreement: parseFloat(ensemble.modelAgreement.toFixed(3)),
        bayesianProbability: parseFloat(bayesian.probability.toFixed(3)),
        optimizedLine,
        timeWeightedAvg,
        kellyBetSize: ensemble.finalPrediction.edge >= 0.08 ? parseFloat(ensemble.betSize.toFixed(2)) : 0,
    };
}
// #26: Backtesting & Validation Framework
class BacktestingEngine {
    constructor() {
        this.historicalPredictions = [];
    }
    async backtestStrategy(predictions, actualResults, config = {}) {
        // Store predictions for future analysis
        const timestamp = Date.now();
        predictions.forEach(pred => {
            this.historicalPredictions.push({
                fighter: pred.fighter,
                prediction: pred.prediction,
                actualResult: 0, // Will be updated when results are known
                line: pred.line,
                timestamp
            });
        });
        // Simulate results (in production, this would use real historical data)
        const trades = this.generateTrades(predictions, config);
        const results = this.simulateTrades(trades, actualResults);
        return {
            totalReturn: results.totalReturn,
            winRate: results.wins / results.totalTrades,
            profitFactor: results.grossProfit / Math.abs(results.grossLoss),
            maxDrawdown: this.calculateMaxDrawdown(results),
            sharpeRatio: this.calculateSharpeRatio(results),
            monthlyReturns: this.groupByMonth(results),
            predictionAccuracy: this.calculatePredictionAccuracy(predictions, actualResults),
            confidenceCalibration: this.assessConfidenceCalibration(predictions, actualResults)
        };
    }
    generateTrades(predictions, config) {
        const riskManager = new RiskManager(config.initialBankroll || 1000);
        return predictions
            .filter(p => p.prediction.confidence > (config.minConfidence || 0.6) && p.prediction.lean !== 'push')
            .map(p => ({
            fighter: p.fighter,
            side: p.prediction.lean, // Now safe since we filtered out 'push'
            size: riskManager.calculateBetSize(p.prediction.edge, 1.9), // Assume -110 odds
            entryTime: Date.now(),
            expectedLine: p.line,
            confidence: p.prediction.confidence
        }));
    }
    simulateTrades(trades, actualResults) {
        let bankroll = 1000; // Starting bankroll
        let grossProfit = 0;
        let grossLoss = 0;
        let wins = 0;
        const tradeHistory = [];
        trades.forEach(trade => {
            const actual = actualResults.find(r => r.fighter === trade.fighter);
            if (!actual)
                return;
            const hit = (trade.side === 'over' && actual.actualFP > trade.expectedLine) ||
                (trade.side === 'under' && actual.actualFP < trade.expectedLine);
            const odds = 1.9; // -110 moneyline
            const pnl = hit ? trade.size * (odds - 1) : -trade.size;
            bankroll += pnl;
            if (pnl > 0) {
                grossProfit += pnl;
                wins++;
            }
            else {
                grossLoss += Math.abs(pnl);
            }
            tradeHistory.push({
                pnl,
                bankroll,
                timestamp: trade.entryTime
            });
        });
        return {
            totalReturn: (bankroll - 1000) / 1000,
            wins,
            totalTrades: trades.length,
            grossProfit,
            grossLoss,
            tradeHistory
        };
    }
    calculateMaxDrawdown(results) {
        let peak = 1000;
        let maxDrawdown = 0;
        results.tradeHistory.forEach(trade => {
            if (trade.bankroll > peak) {
                peak = trade.bankroll;
            }
            const drawdown = (peak - trade.bankroll) / peak;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        });
        return maxDrawdown;
    }
    calculateSharpeRatio(results) {
        if (results.tradeHistory.length < 2)
            return 0;
        const returns = results.tradeHistory.map((t, i) => i > 0 ? (t.bankroll - results.tradeHistory[i - 1].bankroll) / results.tradeHistory[i - 1].bankroll : 0).filter(r => r !== 0);
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        // Assume 2% risk-free rate (monthly)
        const riskFreeRate = 0.02;
        return stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev : 0;
    }
    groupByMonth(results) {
        const monthly = new Map();
        results.tradeHistory.forEach(trade => {
            const date = new Date(trade.timestamp);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthly.has(monthKey)) {
                monthly.set(monthKey, { startBankroll: 1000, endBankroll: 1000 });
            }
            const monthData = monthly.get(monthKey);
            monthData.endBankroll = trade.bankroll;
        });
        return Array.from(monthly.entries()).map(([month, data]) => ({
            month,
            return: (data.endBankroll - data.startBankroll) / data.startBankroll
        }));
    }
    calculatePredictionAccuracy(predictions, actualResults) {
        let correct = 0;
        let total = 0;
        predictions.forEach(pred => {
            const actual = actualResults.find(r => r.fighter === (pred.fighter || ''));
            if (actual && pred.prediction.lean !== 'push') {
                const hit = (pred.prediction.lean === 'over' && actual.actualFP > (pred.line || 0)) ||
                    (pred.prediction.lean === 'under' && actual.actualFP < (pred.line || 0));
                if (hit)
                    correct++;
                total++;
            }
        });
        return total > 0 ? correct / total : 0;
    }
    assessConfidenceCalibration(predictions, actualResults) {
        // Group predictions by confidence buckets and check actual accuracy
        const buckets = [0.5, 0.6, 0.7, 0.8, 0.9];
        const calibration = buckets.map(bucket => {
            const bucketPreds = predictions.filter(p => p.prediction.confidence >= bucket && p.prediction.confidence < bucket + 0.1);
            const actualAccuracy = this.calculatePredictionAccuracy(bucketPreds, actualResults);
            return { expected: bucket + 0.05, actual: actualAccuracy };
        });
        const avgCalibrationError = calibration.reduce((sum, c) => sum + Math.abs(c.expected - c.actual), 0) / calibration.length;
        return {
            calibrationScore: 1 - avgCalibrationError, // 1.0 = perfect calibration
            overconfidence: calibration.filter(c => c.actual < c.expected).length / calibration.length,
            underconfidence: calibration.filter(c => c.actual > c.expected).length / calibration.length
        };
    }
    getHistoricalPredictions() {
        return this.historicalPredictions;
    }
    updateActualResult(fighter, timestamp, actualFP) {
        const prediction = this.historicalPredictions.find(p => p.fighter === fighter && p.timestamp === timestamp);
        if (prediction) {
            prediction.actualResult = actualFP;
        }
    }
    runWalkForwardValidation(events, minTrainEvents = 6) {
        const calibrator = new ProbabilityCalibrator();
        const folds = [];
        const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
        if (ordered.length <= minTrainEvents) {
            return { folds: [], overallAccuracy: 0, overallBrierScore: 0, driftScore: 0 };
        }
        for (let i = minTrainEvents; i < ordered.length; i++) {
            const train = ordered.slice(0, i);
            const test = ordered[i];
            const trainSamples = this.buildCalibrationSamplesFromEvents(train);
            const params = calibrator.fitPlattScaling(trainSamples);
            const testSamples = this.buildCalibrationSamplesFromEvents([test]);
            if (!testSamples.length)
                continue;
            let correct = 0;
            testSamples.forEach(s => {
                const calibrated = calibrator.calibrate(s.rawProbability, params);
                const predicted = calibrated >= 0.5 ? 1 : 0;
                if (predicted === s.outcome)
                    correct++;
            });
            const reliability = calibrator.reliabilityCurve(testSamples, 5, params);
            const calibrationError = reliability.length
                ? reliability.reduce((sum, b) => sum + Math.abs(b.expected - b.actual), 0) / reliability.length
                : 0;
            folds.push({
                trainSize: train.length,
                testSize: test.predictions.length,
                accuracy: correct / testSamples.length,
                brierScore: calibrator.brierScore(testSamples, params),
                calibrationScore: 1 - calibrationError
            });
        }
        if (!folds.length) {
            return { folds: [], overallAccuracy: 0, overallBrierScore: 0, driftScore: 0 };
        }
        const overallAccuracy = folds.reduce((sum, f) => sum + f.accuracy, 0) / folds.length;
        const overallBrierScore = folds.reduce((sum, f) => sum + f.brierScore, 0) / folds.length;
        const avgAcc = overallAccuracy;
        const variance = folds.reduce((sum, f) => sum + Math.pow(f.accuracy - avgAcc, 2), 0) / folds.length;
        const driftScore = Math.sqrt(variance);
        return { folds, overallAccuracy, overallBrierScore, driftScore };
    }
    buildCalibrationSamplesFromEvents(events) {
        const samples = [];
        events.forEach(evt => {
            evt.predictions.forEach(pred => {
                if (pred.prediction.lean === 'push')
                    return;
                const actual = evt.actualResults.find(r => r.fighter === pred.fighter);
                if (!actual)
                    return;
                const outcome = actual.actualFP > pred.line ? 1 : 0;
                const rawProbability = pred.prediction.lean === 'over'
                    ? pred.prediction.confidence
                    : 1 - pred.prediction.confidence;
                samples.push({
                    rawProbability: Math.max(0.01, Math.min(0.99, rawProbability)),
                    outcome: outcome
                });
            });
        });
        return samples;
    }
}
const DFS_PLATFORM_SCORING = {
    betr: {
        sigStrikePoint: 0.42,
        takedownPoint: 5.2,
        controlSecPoint: 0.032,
        knockdownPoint: 10,
        finishBonusPoint: 28,
        decisionWinBonus: 28,
        paceMultiplier: 1.06,
        durabilityMultiplier: 0.94
    },
    underdog: {
        sigStrikePoint: 0.40,
        takedownPoint: 5.0,
        controlSecPoint: 0.030,
        knockdownPoint: 10,
        finishBonusPoint: 26,
        decisionWinBonus: 26,
        paceMultiplier: 1.03,
        durabilityMultiplier: 0.96
    },
    draftkings: {
        sigStrikePoint: 0.40,
        takedownPoint: 5.0,
        controlSecPoint: 0.030,
        knockdownPoint: 10,
        finishBonusPoint: 30,
        decisionWinBonus: 30,
        paceMultiplier: 1.0,
        durabilityMultiplier: 1.0
    },
    prizepicks: {
        sigStrikePoint: 0.38,
        takedownPoint: 5.0,
        controlSecPoint: 0.028,
        knockdownPoint: 10,
        finishBonusPoint: 25,
        decisionWinBonus: 26,
        paceMultiplier: 1.02,
        durabilityMultiplier: 0.98
    }
};
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function formatCareerArchetypeLabel(label) {
    if (label === 'volume_accumulator')
        return 'Volume Accumulator';
    if (label === 'front_loaded_finisher')
        return 'Front-Loaded Finisher';
    if (label === 'control_merchant')
        return 'Control Merchant';
    if (label === 'submission_chaser')
        return 'Submission Chaser';
    if (label === 'point_bank_striker')
        return 'Point-Bank Striker';
    if (label === 'chaos_brawler')
        return 'Chaos Brawler';
    return 'Durable Generalist';
}
function formatMatchupAlertLabel(label) {
    if (label === 'frail_favorite')
        return 'Frail Favorite';
    if (label === 'desperate_wrestler')
        return 'Desperate Wrestler';
    return 'None';
}
function shortCareerArchetypeLabel(label) {
    if (label === 'volume_accumulator')
        return 'VOL ACC';
    if (label === 'front_loaded_finisher')
        return 'FAST FIN';
    if (label === 'control_merchant')
        return 'CTRL';
    if (label === 'submission_chaser')
        return 'SUB';
    if (label === 'point_bank_striker')
        return 'POINT';
    if (label === 'chaos_brawler')
        return 'CHAOS';
    return 'DURABLE';
}
function describeCareerArchetype(label) {
    if (label === 'volume_accumulator')
        return 'High-output striker scoring via volume — favors OVERs on SS and FP';
    if (label === 'front_loaded_finisher')
        return 'Aggressive early-rounds finisher — fights tend to end before going long';
    if (label === 'control_merchant')
        return 'Takedown-heavy grappler who controls position — favors TD-OVERs and grinding wins';
    if (label === 'submission_chaser')
        return 'Ground specialist hunting submissions — high finish potential, SS variance';
    if (label === 'point_bank_striker')
        return 'Precision striker scoring via accuracy not volume — late-round kicker';
    if (label === 'chaos_brawler')
        return 'Unpredictable brawler — high variance both directions, boom-or-bust';
    return 'Balanced profile with no extreme tendencies';
}
function mapCareerLabelToBaseArchetype(label, db) {
    if (label === 'volume_accumulator')
        return 'volume_striker';
    if (label === 'control_merchant') {
        return (db.avgTDperFight ?? db.avgTD ?? 0) >= 2.8 && (db.tdAcc ?? 35) >= 38
            ? 'chain_wrestler'
            : 'control_grappler';
    }
    if (label === 'submission_chaser')
        return 'submission_hunter';
    if (label === 'point_bank_striker')
        return 'point_fighter';
    if (label === 'front_loaded_finisher') {
        return ((db.avgTDperFight ?? db.avgTD ?? 0) >= 1.8 && (db.subAvg ?? 0) >= 0.4)
            ? 'submission_hunter'
            : 'power_striker';
    }
    if (label === 'chaos_brawler')
        return (db.finishRate ?? 0.45) >= 0.58 ? 'power_striker' : 'balanced_generalist';
    return 'balanced_generalist';
}
function learnArchetypeProfile(fighterName, db, oppDB = null, moneyline = null) {
    const cacheKey = [
        fighterName || db.detailUrl || db.record || 'fighter',
        oppDB?.detailUrl || oppDB?.record || oppDB?.style || 'no-opp',
        moneyline ?? 'na',
        db.avgFP_weighted ?? db.avgFP ?? 'na',
        db.avgTDperFight ?? db.avgTD ?? 'na',
        db.slpm ?? 'na',
    ].join('|');
    const cached = _archetypeLearnerCache.get(cacheKey);
    if (cached)
        return cached;
    const history = db.history || [];
    const wins = history.filter((fight) => fight.result === 'win');
    const losses = history.filter((fight) => fight.result === 'loss');
    const recent = history.slice(0, 4);
    const slpm = db.slpm ?? 3.6;
    const tdAvg = db.avgTDperFight ?? db.avgTD ?? 0.8;
    const tdAcc = db.tdAcc ?? 35;
    const finishRate = db.finishRate ?? 0.45;
    const consistency = db.fpConsistency ?? 50;
    const avgTime = db.avgTimeMins ?? 11.5;
    const fpStdDev = db.fpStdDev ?? 18;
    const sapm = db.sapm ?? 3.7;
    const strDef = db.strDef ?? 52;
    const tdDef = db.tdDef ?? 58;
    const avgFPWeighted = db.avgFP_weighted ?? db.avgFP ?? db.avgFP_p6 ?? 0;
    const avgFPBase = db.avgFP ?? db.avgFP_p6 ?? db.avgFP_weighted ?? 0;
    const avgFPPerRound = db.avgFP_perRound ?? 9;
    const subAvg = db.subAvg ?? 0;
    const recentTdAvg = recent.length
        ? recent.reduce((sum, fight) => sum + (fight.td ?? 0), 0) / recent.length
        : tdAvg;
    const recentFpAvg = recent.length
        ? recent.reduce((sum, fight) => sum + (fight.fp ?? avgFPBase), 0) / recent.length
        : avgFPBase;
    const roundOneFinishWins = wins.length
        ? wins.filter((fight) => /KO|TKO|SUB/i.test(fight.method || '') && Number(fight.round ?? 3) <= 1).length / wins.length
        : 0;
    const decisionRate = history.length
        ? history.filter((fight) => /DEC/i.test(fight.method || '')).length / history.length
        : 0.35;
    const recentPressure = clamp01(((recentTdAvg - tdAvg) + Math.max(0, 3.6 - slpm)) / 2.6);
    const fragility = clamp01(((Math.max(0, 54 - strDef) / 20) * 0.3) +
        ((Math.max(0, 60 - tdDef) / 22) * 0.25) +
        (Math.max(0, sapm - 3.8) / 3.5 * 0.2) +
        (Math.max(0, 52 - consistency) / 36 * 0.25));
    const oppPressure = oppDB?.loaded
        ? clamp01((((oppDB.slpm ?? 3.8) - 3.8) / 2.8) + (((oppDB.avgTDperFight ?? oppDB.avgTD ?? 0.9) - 1.0) / 2.6))
        : 0.3;
    const careerScores = [
        {
            label: 'volume_accumulator',
            score: (slpm * 0.95) + (consistency / 24) + (avgTime / 6.5) + (avgFPPerRound / 5.5) - (finishRate * 1.4),
        },
        {
            label: 'front_loaded_finisher',
            score: (finishRate * 6.5) + (roundOneFinishWins * 4.0) + (avgTime < 9.5 ? 1.8 : 0) + (slpm >= 4.3 ? 0.7 : 0),
        },
        {
            label: 'control_merchant',
            score: (tdAvg * 1.9) + ((tdAcc / 100) * 2.2) + ((1 - finishRate) * 2.0) + (avgTime / 8) + (db.style === 'grappler' ? 1.2 : 0),
        },
        {
            label: 'submission_chaser',
            score: (subAvg * 4.4) + (tdAvg * 1.15) + (finishRate * 2.4) + (db.style === 'grappler' ? 0.8 : 0),
        },
        {
            label: 'point_bank_striker',
            score: (decisionRate * 5.2) + (consistency / 22) + (slpm * 0.42) + (strDef / 40) - (finishRate * 1.35),
        },
        {
            label: 'chaos_brawler',
            score: (finishRate * 4.0) + (sapm / 1.8) + ((100 - consistency) / 18) + (fpStdDev / 11) + (slpm / 3.2),
        },
        {
            label: 'durable_generalist',
            score: (avgTime / 6.3) + (consistency / 28) + ((db.style === 'balanced' ? 1.0 : 0.45)) + ((1 - finishRate) * 2.1),
        },
    ];
    careerScores.sort((a, b) => b.score - a.score);
    const primary = careerScores[0];
    const secondary = careerScores[1] && (primary.score - careerScores[1].score) <= 1.15 ? careerScores[1] : null;
    let matchupAlert = 'none';
    const favoriteLine = moneyline ?? 0;
    if (moneyline != null && favoriteLine <= -145 && fragility >= 0.54) {
        matchupAlert = 'frail_favorite';
    }
    else if (recentPressure >= 0.58 && tdAvg >= 1.5 && tdAcc <= 40 && slpm <= 3.6 && (recentFpAvg <= avgFPWeighted || oppPressure >= 0.52)) {
        matchupAlert = 'desperate_wrestler';
    }
    const reasons = [];
    if (primary.label === 'volume_accumulator') {
        reasons.push(`High minute-winning profile: ${slpm.toFixed(1)} SLpM with ${consistency}% consistency and ${avgTime.toFixed(1)} avg mins.`);
    }
    else if (primary.label === 'front_loaded_finisher') {
        reasons.push(`Fast-finisher shape: ${Math.round(finishRate * 100)}% finish rate with ${Math.round(roundOneFinishWins * 100)}% of wins ending in round 1.`);
    }
    else if (primary.label === 'control_merchant') {
        reasons.push(`Control-first path: ${tdAvg.toFixed(1)} TD avg at ${tdAcc}% accuracy with longer fight duration support.`);
    }
    else if (primary.label === 'submission_chaser') {
        reasons.push(`Grappling threat profile: sub-heavy finishing path backed by ${tdAvg.toFixed(1)} TD avg.`);
    }
    else if (primary.label === 'point_bank_striker') {
        reasons.push(`Bankable decision scoring: ${Math.round(decisionRate * 100)}% decisions with steady pace and defense.`);
    }
    else if (primary.label === 'chaos_brawler') {
        reasons.push(`Volatile violence profile: ${Math.round(finishRate * 100)}% finish rate with elevated variance and damage traded back.`);
    }
    else {
        reasons.push(`Balanced durability lane: stable ${avgTime.toFixed(1)} min average with all-phase scoring support.`);
    }
    if (secondary) {
        reasons.push(`Secondary shade: ${formatCareerArchetypeLabel(secondary.label)} also scores well from this sample.`);
    }
    if (matchupAlert === 'frail_favorite') {
        reasons.push(`Matchup alert: favored on the market, but defensive leak score is elevated (${Math.round(fragility * 100)} fragility).`);
    }
    else if (matchupAlert === 'desperate_wrestler') {
        reasons.push(`Matchup alert: recent shot-heavy survival path suggests forced wrestling if striking exchanges go sideways.`);
    }
    const confidence = Math.round(clampNumber(54 + ((primary.score - (secondary?.score ?? (primary.score - 1.2))) * 11), 58, 92));
    const profile = {
        careerLabel: primary.label,
        secondaryLabel: secondary?.label ?? null,
        matchupAlert,
        baseArchetype: mapCareerLabelToBaseArchetype(primary.label, db),
        confidence,
        tags: [
            `career:${primary.label}`,
            secondary ? `secondary:${secondary.label}` : '',
            matchupAlert !== 'none' ? `alert:${matchupAlert}` : '',
        ].filter(Boolean),
        reasons,
        summary: matchupAlert !== 'none'
            ? `${formatCareerArchetypeLabel(primary.label)} with ${formatMatchupAlertLabel(matchupAlert)} warning`
            : `${formatCareerArchetypeLabel(primary.label)} profile`,
    };
    _archetypeLearnerCache.set(cacheKey, profile);
    return profile;
}
function calcArchetypeLearnerEdge(fighterName, db, oppDB, moneyline, line, avgFP) {
    const profile = learnArchetypeProfile(fighterName, db, oppDB, moneyline);
    const reasons = [];
    let delta = 0;
    if (profile.careerLabel === 'volume_accumulator') {
        delta += 0.65;
        reasons.push({ icon: 'pos', text: `Archetype learner: ${profile.summary} supports repeatable minute-winning volume for fantasy scoring.` });
    }
    else if (profile.careerLabel === 'control_merchant') {
        delta += 0.55;
        reasons.push({ icon: 'pos', text: `Archetype learner: ${profile.summary} creates steady control + takedown scoring paths.` });
    }
    else if (profile.careerLabel === 'point_bank_striker') {
        delta += 0.35;
        reasons.push({ icon: 'pos', text: `Archetype learner: ${profile.summary} tends to bank clean decision volume instead of boom-bust swings.` });
    }
    else if (profile.careerLabel === 'chaos_brawler') {
        delta -= 0.45;
        reasons.push({ icon: 'neg', text: `Archetype learner: ${profile.summary} is volatile, so fantasy output is less trustworthy fight-to-fight.` });
    }
    else if (profile.careerLabel === 'front_loaded_finisher') {
        const baseline = avgFP ?? db.avgFP ?? db.avgFP_p6 ?? line;
        if (line > baseline + 4) {
            delta -= 0.35;
            reasons.push({ icon: 'neg', text: `Archetype learner: ${profile.summary} brings ceiling, but front-loaded fights can cap peripheral accumulation at elevated lines.` });
        }
        else {
            reasons.push({ icon: 'neu', text: `Archetype learner: ${profile.summary} brings real smash upside, but the path is more explosive than stable.` });
        }
    }
    else if (profile.careerLabel === 'submission_chaser') {
        reasons.push({ icon: 'neu', text: `Archetype learner: ${profile.summary} adds grappling finish upside, but the scoring path is opportunity-dependent.` });
    }
    else {
        delta += 0.15;
        reasons.push({ icon: 'neu', text: `Archetype learner: ${profile.summary} keeps the floor stable without screaming boom-or-bust risk.` });
    }
    if (profile.matchupAlert === 'frail_favorite') {
        delta -= 0.8;
        reasons.push({ icon: 'neg', text: 'Archetype learner alert: frail favorite profile means win equity is priced, but downside remains live if the fight turns messy.' });
    }
    else if (profile.matchupAlert === 'desperate_wrestler') {
        delta -= 0.35;
        reasons.push({ icon: 'neg', text: 'Archetype learner alert: desperate wrestler profile leans on forced takedowns, which can crater fantasy output if early shots fail.' });
    }
    return { delta, reasons, profile };
}
function inferArchetype(db) {
    return learnArchetypeProfile('', db, null, null).baseArchetype;
}
function archetypeMatchupDelta(a, b) {
    const key = `${a}->${b}`;
    const matrix = {
        'volume_striker->power_striker': 1.4,
        'power_striker->volume_striker': -0.8,
        'chain_wrestler->volume_striker': 1.8,
        'volume_striker->chain_wrestler': -1.0,
        'control_grappler->power_striker': 1.2,
        'power_striker->control_grappler': -0.7,
        'submission_hunter->chain_wrestler': 0.9,
        'point_fighter->power_striker': 0.7,
        'balanced_generalist->balanced_generalist': 0
    };
    return matrix[key] ?? 0;
}
function buildDFSFeatureVector(db, oppDB, line) {
    const archetype = inferArchetype(db);
    const oppArchetype = oppDB ? inferArchetype(oppDB) : 'balanced_generalist';
    const slpm = db.slpm ?? 3.8;
    const sapmOpp = oppDB?.sapm ?? 3.7;
    const tdAvg = db.avgTDperFight ?? db.avgTD ?? 1.0;
    const tdAcc = (db.tdAcc ?? 35) / 100;
    const oppTdDef = (oppDB?.tdDef ?? 58) / 100;
    const finishRate = db.finishRate ?? 0.45;
    const oppFinishRate = oppDB?.finishRate ?? 0.45;
    const paceProjection = ((slpm + sapmOpp + (oppDB?.slpm ?? 3.6) + (db.sapm ?? 3.7)) / 2);
    const expectedSigStrPerMin = (slpm * 0.62) + (sapmOpp * 0.38);
    const tdAttempts = tdAvg / Math.max(0.18, tdAcc);
    const tdSuccess = clamp01(tdAcc * (1 - (oppTdDef * 0.72)));
    const controlProjection = Math.max(0, tdAttempts * tdSuccess * 46);
    const chin = clamp01(1 - ((oppDB?.fpConsistency ?? 55) / 140));
    const durability = clamp01((oppDB?.strDef ?? 52) / 100) * 0.45 + clamp01((oppDB?.tdDef ?? 58) / 100) * 0.35 + clamp01(1 - (oppFinishRate * 0.35)) * 0.2;
    const finishProbability = clamp01((finishRate * 0.62) + ((1 - durability) * 0.28) + (archetypeMatchupDelta(archetype, oppArchetype) * 0.03));
    const fiveRoundRate = db.fiveRoundRate ?? 0;
    const expectedFightDurationMins = Math.max(4.5, Math.min(24.5, (15 * (1 - (finishProbability * 0.52))) + (fiveRoundRate * 5)));
    const ssVolumeDurationProduct = expectedSigStrPerMin * expectedFightDurationMins;
    const tdAttemptDefenseProduct = tdAttempts * (1 - oppTdDef);
    const oppGetUpRate = clamp01(1 - ((oppDB?.avgTDperFight ?? 1.2) / 4));
    const controlGetUpProduct = controlProjection * (1 - oppGetUpRate);
    const finishChinProduct = finishProbability * chin;
    const history = db.history || [];
    const recent = history.slice(0, 4);
    const round1Aggression = clamp01(recent.length ? recent.filter(h => (h.round ?? 3) <= 1).length / recent.length : 0.25);
    const cardioBuildFactor = clamp01((db.avgFP_perRound ?? 9) / 14);
    const lastFightDate = history[0]?.date ? new Date(history[0].date).getTime() : null;
    const daysSinceLastFight = lastFightDate ? (Date.now() - lastFightDate) / 86400000 : 160;
    const layoffRisk = clamp01((daysSinceLastFight - 210) / 300);
    const ageCurveRisk = clamp01(((db.fpStdDev ?? 18) - 14) / 22);
    const shortNoticeRisk = clamp01((history.length < 4 ? 0.18 : 0.05) + (Math.abs((db.avgFP_weighted ?? db.avgFP_p6 ?? 0) - (db.avgFP_p6 ?? 0)) > 12 ? 0.08 : 0));
    // Event-aware altitude risk: significant at high-altitude venues, minimal at sea level
    const altBase = currentVenueFactor.altitudeMeters >= 2000 ? 0.35
        : currentVenueFactor.altitudeMeters >= 1500 ? 0.22
            : currentVenueFactor.altitudeMeters >= 1200 ? 0.12 : 0;
    const altitudeRisk = clamp01(altBase + (paceProjection > 8.5 ? 0.10 : 0.04) + (db.style === 'grappler' ? 0.04 : 0));
    const pressureFragility = clamp01((db.fpConsistency != null ? (100 - db.fpConsistency) / 120 : 0.35));
    const grapplerVulnerability = clamp01(((db.tdDef ?? 58) < 55 ? 0.55 : 0.18) + (db.style === 'striker' ? 0.15 : 0));
    const southpawVulnerability = clamp01(((db.stance || '').toLowerCase().includes('south') ? 0.1 : 0.2) + (db.strAcc != null && db.strAcc < 40 ? 0.15 : 0));
    const improvementSignal = clamp01(((db.avgFP_weighted ?? db.avgFP_p6 ?? 0) - (db.avgFP_p6 ?? 0) + 10) / 25);
    const declineSignal = clamp01(((db.avgFP_p6 ?? 0) - (db.avgFP_weighted ?? db.avgFP_p6 ?? 0) + 10) / 25);
    const dataQuality = clamp01((history.length / 10) * 0.7 + ((oppDB?.loaded ? 1 : 0) * 0.3));
    const lineAdj = line != null ? Math.max(-0.15, Math.min(0.15, (line - (db.avgFP_p6 ?? line)) / 100)) : 0;
    return {
        archetype,
        expectedSigStrPerMin: Math.max(1.2, expectedSigStrPerMin + lineAdj),
        expectedTDAttempts: Math.max(0.2, tdAttempts),
        expectedTDSuccess: tdSuccess,
        controlTimeProjection: controlProjection,
        finishProbability,
        opponentDurabilityScore: durability,
        paceProjection,
        expectedFightDurationMins,
        ssVolumeDurationProduct,
        tdAttemptDefenseProduct,
        controlGetUpProduct,
        finishChinProduct,
        round1Aggression,
        cardioBuildFactor,
        layoffRisk,
        ageCurveRisk,
        shortNoticeRisk,
        altitudeRisk,
        pressureFragility,
        grapplerVulnerability,
        southpawVulnerability,
        improvementSignal,
        declineSignal,
        dataQuality
    };
}
const fantasyBrain = {
    buildFeatures: buildDFSFeatureVector,
    strikingModel: (f, db, oppDB) => {
        const sigStr = f.ssVolumeDurationProduct * (1 + (f.improvementSignal - f.declineSignal) * 0.12);
        const matchup = archetypeMatchupDelta(f.archetype, inferArchetype(oppDB || db));
        const adjusted = Math.max(8, sigStr + (matchup * 2));
        const confidence = clamp01((0.45 + f.dataQuality * 0.35 + clamp01((db.strAcc ?? 42) / 100) * 0.2) - (f.layoffRisk * 0.08));
        const reasons = [
            { icon: adjusted > sigStr ? 'pos' : 'neu', text: `Striking model: ${f.expectedSigStrPerMin.toFixed(2)} SS/min over ${f.expectedFightDurationMins.toFixed(1)} mins projects ~${adjusted.toFixed(1)} SS` }
        ];
        if (f.archetype === 'volume_striker')
            reasons.push({ icon: 'pos', text: 'Archetype edge: volume striker profile scales well with DFS strike scoring' });
        return { value: adjusted, confidence, reasons };
    },
    grapplingModel: (f, db, oppDB) => {
        const expectedTD = f.expectedTDAttempts * f.expectedTDSuccess;
        const controlSec = Math.max(0, f.controlTimeProjection * (1 - f.altitudeRisk * 0.25));
        const grapplingScore = (expectedTD * 8.4) + (controlSec / 18);
        const confidence = clamp01((0.42 + f.dataQuality * 0.3 + clamp01(((db.tdAcc ?? 35) / 100)) * 0.25) - (f.grapplerVulnerability * 0.05));
        const reasons = [
            { icon: expectedTD > 2 ? 'pos' : 'neu', text: `Grappling model: ${f.expectedTDAttempts.toFixed(1)} TD attempts at ${(f.expectedTDSuccess * 100).toFixed(0)}% success projects ${expectedTD.toFixed(1)} TDs` },
            { icon: controlSec > 120 ? 'pos' : 'neu', text: `Control projection: ~${Math.round(controlSec)}s expected control time after matchup adjustments` }
        ];
        if (oppDB && (oppDB.tdDef ?? 58) < 50)
            reasons.push({ icon: 'pos', text: 'Opponent TD defense profile is exploitable for fantasy grappling accumulation' });
        return { value: grapplingScore, confidence, reasons };
    },
    finishingModel: (f, db) => {
        const kdProjection = Math.max(0.1, (db.slpm ?? 3.8) * (db.strAcc ?? 42) / 430);
        const finishScore = (f.finishProbability * 30) + (kdProjection * 10) + (f.round1Aggression * 4);
        const confidence = clamp01(0.35 + f.dataQuality * 0.28 + f.finishProbability * 0.37);
        const reasons = [
            { icon: f.finishProbability > 0.52 ? 'pos' : 'neu', text: `Finishing model: finish probability ${(f.finishProbability * 100).toFixed(1)}% with KD projection ${kdProjection.toFixed(2)}` },
            { icon: f.round1Aggression > 0.4 ? 'pos' : 'neu', text: f.round1Aggression > 0.4 ? 'Fast-starter tendency detected from recent rounds' : 'Balanced start profile; finish odds more distributed across rounds' }
        ];
        return { value: finishScore, confidence, reasons };
    },
    matchupAdjustmentModel: (f, db, oppDB) => {
        const oppArch = inferArchetype(oppDB || db);
        const styleDelta = archetypeMatchupDelta(f.archetype, oppArch);
        const tempoAdj = (f.paceProjection - 7.3) * 0.8;
        const cardioAdj = (f.cardioBuildFactor - 0.5) * 3;
        const sosAdj = oppDB?.fpConsistency != null ? ((oppDB.fpConsistency - 55) / 20) : 0;
        const regressionRisk = (f.layoffRisk + f.ageCurveRisk + f.shortNoticeRisk + f.altitudeRisk) * -1.2;
        const value = styleDelta + tempoAdj + cardioAdj - sosAdj + regressionRisk;
        const confidence = clamp01(0.4 + f.dataQuality * 0.3 + clamp01(Math.abs(styleDelta) / 2.5) * 0.3);
        const reasons = [
            { icon: value >= 0 ? 'pos' : 'neg', text: `Matchup model: archetype clash ${f.archetype.replace('_', ' ')} vs ${oppArch.replace('_', ' ')} yields ${value >= 0 ? '+' : ''}${value.toFixed(2)} adjustment` },
            { icon: tempoAdj >= 0 ? 'pos' : 'neg', text: `Pace projection ${f.paceProjection.toFixed(1)} events/min with expected duration ${f.expectedFightDurationMins.toFixed(1)} mins` }
        ];
        if (f.grapplerVulnerability > 0.55)
            reasons.push({ icon: 'neg', text: 'Heuristic risk: vulnerability versus sustained grappling pressure remains elevated' });
        if (f.southpawVulnerability > 0.28)
            reasons.push({ icon: 'neg', text: 'Heuristic risk: profile historically volatile in stance-mismatch matchups' });
        return { value, confidence, reasons };
    },
    fantasyScoringModel: (platform, line, f, strike, grapple, finish, matchup) => {
        const scoring = DFS_PLATFORM_SCORING[platform];
        const expectedSigStr = strike.value;
        const expectedTD = Math.max(0.2, f.expectedTDAttempts * f.expectedTDSuccess);
        const expectedControl = Math.max(0, f.controlTimeProjection);
        const expectedKD = Math.max(0.08, finish.value / 45);
        const finishBonus = f.finishProbability * scoring.finishBonusPoint;
        const decisionBonus = (1 - f.finishProbability) * scoring.decisionWinBonus * 0.48;
        const baseFantasyScore = expectedSigStr * scoring.sigStrikePoint +
            expectedTD * scoring.takedownPoint +
            expectedControl * scoring.controlSecPoint +
            expectedKD * scoring.knockdownPoint +
            finishBonus +
            decisionBonus;
        const platformArchetypeMultiplier = f.archetype === 'volume_striker' ? 1 + (scoring.paceMultiplier - 1) * 0.9 :
            f.archetype === 'chain_wrestler' || f.archetype === 'control_grappler' ? 1 + ((scoring.controlSecPoint / 0.03) - 1) * 0.8 :
                f.archetype === 'power_striker' ? 1 + ((scoring.finishBonusPoint / 30) - 1) * 0.7 :
                    1.0;
        const riskDampener = 1 - ((f.layoffRisk + f.ageCurveRisk + f.shortNoticeRisk + f.altitudeRisk) * 0.12);
        const adjustedScore = (baseFantasyScore * platformArchetypeMultiplier * scoring.durabilityMultiplier * scoring.paceMultiplier * Math.max(0.75, riskDampener)) + matchup.value;
        const edgeVsLine = adjustedScore - line;
        const modelAgreement = (strike.confidence + grapple.confidence + finish.confidence + matchup.confidence) / 4;
        const confidence = clamp01(modelAgreement * 0.78 + clamp01(Math.abs(edgeVsLine) / 30) * 0.22);
        const reasons = [
            { icon: edgeVsLine >= 0 ? 'pos' : 'neg', text: `${platform.toUpperCase()} projection ${adjustedScore.toFixed(1)} vs line ${line.toFixed(1)} (edge ${edgeVsLine >= 0 ? '+' : ''}${edgeVsLine.toFixed(1)})` },
            { icon: 'neu', text: `Derived DFS features: SS×duration ${f.ssVolumeDurationProduct.toFixed(1)}, TD×defense ${f.tdAttemptDefenseProduct.toFixed(2)}, control×get-up ${f.controlGetUpProduct.toFixed(1)}` }
        ];
        return {
            platform,
            expectedScore: adjustedScore,
            edgeVsLine,
            confidence,
            reasons: [...strike.reasons.slice(0, 1), ...grapple.reasons.slice(0, 1), ...finish.reasons.slice(0, 1), ...matchup.reasons.slice(0, 1), ...reasons]
        };
    }
};
const UFC_ANALYZER_BRAIN_V2 = {
    agent_loop: {
        step_1_favorite_status: 'Identify favorite or underdog.',
        step_2_style_vs_scoring: {
            over_conditions: ['High pace', 'High output', 'Pressure', 'Damage', 'Multiple scoring paths', 'Opponent defensive leaks'],
            under_conditions: ['Low pace', 'Control-dependent grappling', 'Single-path scoring', 'Cannot win minutes']
        },
        step_3_matchup_dynamics: ['Pressure suppresses underdog output', 'Defensive leaks inflate favorite scoring'],
        step_4_finish_equity: { over: 'Multiple finishing paths', under: 'Moment-dependent or control-dependent' },
        step_5_extreme_favorite_rule: {
            threshold: '-600',
            logic: 'Extreme favorites are structural smash spots with inflated scoring ceilings.',
            treatment: 'Treat as top-tier OVER unless style contradicts.'
        },
        step_6_final_lean: 'Combine style + matchup + win equity + opponent defense to produce OVER/UNDER.'
    },
    brain_modules: {
        module_1_favorite_logic: {
            standard_favorites: {
                rule: 'Favorite status boosts OVER only if style supports it.',
                requirements: ['High pace', 'High output', 'Pressure', 'Damage', 'Multiple scoring paths', 'Opponent defensive leaks']
            },
            heavy_favorites: { range: '-300 to -600', rule: 'Win equity amplifies scoring; pressure suppresses underdog output.' },
            extreme_favorites: {
                range: '-600 and above',
                rule: 'Extreme favorites represent massive skill gaps and structural smash equity.',
                outcome: 'High-confidence OVER; top-tier fantasy pick.',
                example_pinto: {
                    favorite_line: '-1000',
                    advantages: ['Elite pace', 'High damage output', 'Multiple finishing paths', 'Opponent with weak defense'],
                    lean: 'Elite OVER'
                }
            }
        },
        module_2_underdog_logic: {
            control_dependent: { rule: 'Needs control to score; collapses under pressure.', lean: 'UNDER', example_roman: 'Low-volume grappler; cannot secure control vs CLD.' },
            low_pace: { rule: 'Low output and no minute-winning tools.', lean: 'UNDER', example_franco: 'Low pace, poor defense, collapses under pressure.' },
            mismatch_underdogs: { rule: 'Output collapses; scoring windows disappear.', lean: 'Strong UNDER' }
        },
        module_3_matchup_dynamics: {
            pressure_dynamics: 'Pressure from favorites reduces underdog attempts and increases favorite scoring.',
            defensive_leaks: 'Weak defense inflates favorite scoring.',
            finish_equity: { multi_path: 'OVER', moment_dependent: 'UNDER' }
        },
        module_4_scoring_path_architecture: {
            multi_path_scorers: { paths: ['Volume', 'Damage', 'Control', 'Finish'], lean: 'OVER' },
            single_path_scorers: { paths: ['Control-only', 'Moment-only'], lean: 'UNDER' }
        },
        module_5_extreme_favorite_mismatch: {
            structural_smash_equity: 'Extreme favorites create inflated scoring environments.',
            weak_opponent_inflation: 'Weak opponents artificially raise favorite ceilings.',
            redundant_scoring_paths: 'Extreme favorites can score by volume, damage, knockdowns, KO, control, or subs.',
            underdog_collapse: 'Underdogs in mismatches produce near-zero offense.',
            example_pinto_franco: {
                pinto: 'Elite pace, damage, finishing threat, -1000 favorite.',
                franco: 'Low pace, poor defense, collapses under pressure.',
                result: 'Pinto = elite OVER; Franco = strong UNDER.'
            }
        }
    },
    global_summary: {
        rules: [
            'Favorite + sustainable scoring = OVER',
            'Heavy favorite + elite pace = HIGH-CONFIDENCE OVER',
            'Extreme favorite (-600+) = SMASH OVER',
            'Underdog + control-dependent or low pace = UNDER',
            'Matchup dynamics override raw averages',
            'Pressure suppresses underdog scoring',
            'Defensive leaks inflate favorite scoring',
            'Multi-path scorers = OVER',
            'Single-path scorers = UNDER',
            'Weak opponents inflate favorite ceilings',
            'Underdogs in mismatches produce near-zero offense'
        ]
    }
};
function getScoringPaths(db) {
    const paths = [];
    if ((db.slpm ?? 0) >= 4.3)
        paths.push('Volume');
    if ((db.finishRate ?? 0) >= 0.5)
        paths.push('Damage');
    if ((db.avgTD ?? 0) >= 1.7 || (db.avgTDperFight ?? 0) >= 1.7)
        paths.push('Control');
    if ((db.finishRate ?? 0) >= 0.58)
        paths.push('Finish');
    return paths;
}
function applyBrainV2Overlay(db, oppDB, line, oppLine, moneyline, oppMoneyline, avgFP, reasons) {
    const selfBase = db.avgFP_weighted ?? avgFP ?? db.avgFP ?? 0;
    const oppBase = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
    const lineGap = oppLine != null ? line - oppLine : selfBase - oppBase;
    const isFavorite = moneyline != null ? moneyline < 0 : lineGap >= 4;
    const isUnderdog = moneyline != null ? moneyline > 0 : lineGap <= -4;
    const isHeavyFavorite = moneyline != null ? moneyline <= -300 : lineGap >= 10;
    const isExtremeFavorite = moneyline != null ? moneyline <= -600 : lineGap >= 18;
    const overSignals = [
        (db.slpm ?? 0) >= 4.8,
        (avgFP ?? 0) >= line + 4,
        (db.avgTD ?? 0) >= 1.7,
        (db.finishRate ?? 0) >= 0.5,
        (oppDB.strDef ?? 55) < 50 || (oppDB.tdDef ?? 58) < 55 || (oppDB.sapm ?? 3.8) > 4.6,
    ].filter(Boolean).length;
    const underSignals = [
        (db.slpm ?? 0) < 3.4,
        (db.avgTD ?? 0) < 1.2 && (db.tdAcc ?? 40) < 36,
        getScoringPaths(db).length <= 1,
        (db.fpConsistency ?? 55) < 48,
    ].filter(Boolean).length;
    let delta = 0;
    if (isFavorite && overSignals >= 3) {
        delta += 0.8;
        reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[0]} — favorite profile shows sustainable scoring conditions` });
    }
    if (isHeavyFavorite && overSignals >= 2) {
        delta += 0.75;
        reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[1]} — heavy favorite win equity amplifies scoring${moneyline != null ? ` (ML ${moneyline > 0 ? '+' : ''}${moneyline})` : ''}` });
    }
    if (isExtremeFavorite && overSignals >= 2 && getScoringPaths(db).length >= 2) {
        delta += 1.15;
        reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[2]} — extreme mismatch boosts smash OVER expectation${moneyline != null ? ` (ML ${moneyline})` : ' (line-gap proxy)'}` });
    }
    if (moneyline == null && oppMoneyline != null) {
        reasons.push({ icon: 'neu', text: `Moneyline fallback inferred from opponent odds (${oppMoneyline > 0 ? '+' : ''}${oppMoneyline})` });
    }
    if (isUnderdog && underSignals >= 2) {
        delta -= 0.95;
        reasons.push({ icon: 'neg', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[3]} — underdog lacks reliable pace/control paths` });
    }
    const selfPaths = getScoringPaths(db);
    if (selfPaths.length >= 3) {
        delta += 0.6;
        reasons.push({ icon: 'pos', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[7]} (${selfPaths.join(', ')})` });
    }
    else if (selfPaths.length <= 1) {
        delta -= 0.55;
        reasons.push({ icon: 'neg', text: `${UFC_ANALYZER_BRAIN_V2.global_summary.rules[8]} — single-path profile adds downside variance` });
    }
    return delta;
}
// ── MONEYLINE-ADJUSTED FP PROJECTION ─────────────────────────────────────
function moneylineToImpliedProb(ml) {
    return ml < 0
        ? Math.abs(ml) / (Math.abs(ml) + 100)
        : 100 / (ml + 100);
}
function calcMLAdjustedFP(history, moneyline) {
    if (!history.length || moneyline == null || !Number.isFinite(moneyline))
        return null;
    const wins = history.filter(h => h.result === 'win' && h.fp != null && h.fp > 0);
    const losses = history.filter(h => h.result === 'loss' && h.fp != null && h.fp > 0);
    if (!wins.length && !losses.length)
        return null;
    // Need both sides for the weighting to be meaningful
    if (!wins.length || !losses.length)
        return null;
    function weightedAvg(fights) {
        const w = fights.map((_, i) => Math.pow(0.85, i));
        const tot = w.reduce((s, v) => s + v, 0);
        return fights.reduce((s, f, i) => s + (f.fp ?? 0) * w[i], 0) / tot;
    }
    const winFP = weightedAvg(wins);
    const lossFP = weightedAvg(losses);
    const p = moneylineToImpliedProb(moneyline);
    return parseFloat((p * winFP + (1 - p) * lossFP).toFixed(1));
}
// ── LEAN ENGINE ────────────────────────────────────────────────────────────
function calcLean(name, db, line_p6, line_ud, line_pp, line_betr, moneyline, oppDB, oppLine_p6 = null, oppLine_ud = null, oppLine_pp = null, oppLine_betr = null, oppMoneyline = null, platformOverride) {
    // platformOverride lets Best Picks evaluate a fighter's FP lean against a
    // specific book (e.g., PrizePicks) rather than the user's active platform.
    // This matters for FP because PP uses a different scoring formula — its line
    // can't be compared to the P6/UD line directly, the lean must be recomputed
    // against PP's projection.
    const platform = platformOverride ?? currentPlatform;
    const availableLines = [line_p6, line_ud, line_pp, line_betr].filter(l => l != null);
    const avgLine = availableLines.length ? parseFloat((availableLines.reduce((s, l) => s + l, 0) / availableLines.length).toFixed(1)) : null;
    const selectedLine = platform === 'pick6' ? line_p6 :
        platform === 'underdog' ? line_ud :
            platform === 'prizepicks' ? line_pp :
                platform === 'draftkings_sportsbook' ? line_p6 :
                    line_betr;
    const oppAvailableLines = [oppLine_p6, oppLine_ud, oppLine_pp, oppLine_betr].filter(l => l != null);
    const oppAvgLine = oppAvailableLines.length
        ? parseFloat((oppAvailableLines.reduce((s, l) => s + l, 0) / oppAvailableLines.length).toFixed(1))
        : null;
    const oppSelectedLine = platform === 'pick6' ? oppLine_p6 :
        platform === 'underdog' ? oppLine_ud :
            platform === 'prizepicks' ? oppLine_pp :
                platform === 'draftkings_sportsbook' ? oppLine_p6 :
                    oppLine_betr;
    const oppLine = oppSelectedLine ?? oppAvgLine;
    const line = selectedLine ?? avgLine;
    if (!line || !db || !db.loaded)
        return { lean: 'none', conf: 0, reasons: [], verdict: 'Loading stats...' };
    // When called with an explicit platformOverride (Best Picks per-book pass),
    // use ONLY that platform's avgFP. PP scoring differs materially from P6/UD
    // (sub attempts +4pt, no quick-win bonus), so averaging across books would
    // pull the PP projection toward the P6/UD scale and mis-evaluate the lean.
    // Default behavior (no override) keeps the cross-platform average for
    // robustness when the user-facing display can't commit to one book.
    const platformSpecificAvg = platformOverride === 'pick6' ? db.avgFP_p6 ?? null :
        platformOverride === 'underdog' ? db.avgFP_ud ?? null :
            platformOverride === 'prizepicks' ? db.avgFP_pp ?? null :
                platformOverride === 'betr' ? db.avgFP_betr ?? null :
                    null;
    const platformAvgCandidates = [
        line_p6 != null ? db.avgFP_p6 ?? null : null,
        line_ud != null ? db.avgFP_ud ?? null : null,
        line_pp != null ? db.avgFP_pp ?? null : null,
        line_betr != null ? db.avgFP_betr ?? null : null,
    ].filter((v) => typeof v === 'number' && Number.isFinite(v));
    const avgFP = platformSpecificAvg != null
        ? platformSpecificAvg
        : platformAvgCandidates.length
            ? parseFloat((platformAvgCandidates.reduce((s, v) => s + v, 0) / platformAvgCandidates.length).toFixed(1))
            : (db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP);
    const history = db.history || [];
    const historyPlatform = platform === 'pick6' ? 'pick6' :
        platform === 'underdog' ? 'underdog' :
            platform === 'prizepicks' ? 'prizepicks' :
                platform === 'draftkings_sportsbook' ? 'pick6' :
                    'betr';
    const historyFP = history.map(h => getFightFantasyValueForPlatform(h, historyPlatform));
    const mlAdjFP = calcMLAdjustedFP(history, moneyline);
    // ── Opp-adjusted FP projection ────────────────────────────────────────────
    // Use opponent's historical FP-allowed to estimate matchup-specific output.
    const oppFPSamples = (oppDB?.oppHistory ?? []).slice(0, 5)
        .map(h => getFightFantasyValueForPlatform(h, historyPlatform))
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const oppAvgFPAllowed = oppFPSamples.length >= 3
        ? parseFloat((oppFPSamples.reduce((s, v) => s + v, 0) / oppFPSamples.length).toFixed(1))
        : null;
    const baseFP = mlAdjFP ?? avgFP ?? null;
    const projFP = (baseFP != null && oppAvgFPAllowed != null)
        ? parseFloat(((baseFP + oppAvgFPAllowed) / 2).toFixed(1))
        : null;
    // When projFP is available it subsumes ML adjustment — use it as the primary signal
    const effectiveFP = projFP ?? baseFP ?? avgFP ?? null;
    const reasons = [];
    let score = 0;
    // ── Venue / altitude / cage factors ──────────────────────────────────────
    if (currentVenueFactor.altitudeMeters >= 1200) {
        const altPenalty = currentVenueFactor.altitudeMeters >= 2000 ? -1.5
            : currentVenueFactor.altitudeMeters >= 1500 ? -1.0 : -0.5;
        score += altPenalty;
        reasons.push({ icon: 'neg', text: `High altitude venue (${currentVenueFactor.altitudeMeters}m) — cardio strain reduces FP output` });
    }
    if (currentVenueFactor.cageSizeFt === 25 && db) {
        const cageAdj = db.style === 'grappler' ? 0.3 : db.style === 'striker' ? -0.3 : 0;
        if (cageAdj !== 0) {
            score += cageAdj;
            reasons.push({ icon: cageAdj > 0 ? 'pos' : 'neg',
                text: `Small cage (25ft) — ${cageAdj > 0 ? 'favors grappling-based FP output' : 'limits striking distance for FP'}` });
        }
    }
    if (platformAvgCandidates.length > 1) {
        reasons.push({ icon: 'neu', text: `Platform-aware FP baseline from app-specific scoring profiles across ${platformAvgCandidates.length} books` });
    }
    // Flag line divergence across books — disagreement signals uncertainty or value
    if (availableLines.length > 1) {
        const minL = Math.min(...availableLines);
        const maxL = Math.max(...availableLines);
        if (maxL - minL >= 2.0) {
            const parts = [['P6', line_p6], ['UD', line_ud], ['PP', line_pp], ['BTR', line_betr]]
                .filter(([, v]) => v != null).map(([lbl, v]) => `${lbl} ${v}`).join(' / ');
            if (selectedLine != null) {
                const src = platform === 'pick6' ? 'P6' : platform === 'underdog' ? 'UD' : platform === 'prizepicks' ? 'PP' : platform === 'draftkings_sportsbook' ? 'DK' : 'BTR';
                reasons.push({ icon: 'neu', text: `Books diverge: ${parts} — using ${src} ${selectedLine} for analysis` });
            }
            else {
                reasons.push({ icon: 'neu', text: `Books diverge: ${parts} — using avg ${line} for analysis` });
            }
            score += (line_p6 ?? line_ud ?? line_pp ?? line_betr) < line ? 0.3 : -0.3; // favor the lower-line book slightly
        }
    }
    const platformProjections = [];
    if (effectiveFP != null) {
        const fpLabel = projFP != null
            ? `Proj FP (${effectiveFP.toFixed(1)} — avg ${(baseFP ?? avgFP ?? 0).toFixed(1)} + opp allows ${oppAvgFPAllowed})`
            : `Historical avg (${effectiveFP.toFixed(1)} FP)`;
        const diff = effectiveFP - line;
        if (diff > 12) {
            score += 2.5;
            reasons.push({ icon: 'pos', text: `${fpLabel} is ${diff.toFixed(1)} pts above the line — strong over value` });
        }
        else if (diff > 5) {
            score += 1.5;
            reasons.push({ icon: 'pos', text: `${fpLabel} is ${diff.toFixed(1)} pts above the line` });
        }
        else if (diff > 1) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `${fpLabel} slightly edges the line` });
        }
        else if (diff < -12) {
            score -= 2.5;
            reasons.push({ icon: 'neg', text: `${fpLabel} is ${Math.abs(diff).toFixed(1)} pts BELOW the line — line may be set too high` });
        }
        else if (diff < -5) {
            score -= 1.5;
            reasons.push({ icon: 'neg', text: `${fpLabel} trails the line by ${Math.abs(diff).toFixed(1)} pts` });
        }
        else if (diff < -1) {
            score -= 0.5;
            reasons.push({ icon: 'neg', text: `${fpLabel} slightly below the line` });
        }
        else {
            reasons.push({ icon: 'neu', text: `${fpLabel} is essentially at the line — genuine toss-up` });
        }
    }
    else {
        reasons.push({ icon: 'neu', text: `No historical FP data available — line analysis based on career stats only` });
    }
    // ── MONEYLINE-ADJUSTED PROJECTION ────────────────────────────────────────
    // Only surface the ML adj signal when projFP is NOT active (projFP already incorporates mlAdjFP)
    if (projFP == null && mlAdjFP != null && moneyline != null && avgFP != null) {
        const impliedPct = Math.round(moneylineToImpliedProb(moneyline) * 100);
        const adjDiff = mlAdjFP - line;
        const shift = mlAdjFP - avgFP;
        // Only surface this if the ML adjustment materially changes the picture (≥3 pt shift)
        if (Math.abs(shift) >= 3) {
            const mlLabel = moneyline < 0 ? `${moneyline} (${impliedPct}% win prob)` : `+${moneyline} (${impliedPct}% win prob)`;
            if (adjDiff > 8 && shift > 3) {
                score += 0.8;
                reasons.push({ icon: 'pos', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — win-scenario scoring lifts outlook ${shift > 0 ? '+' : ''}${shift.toFixed(1)} vs raw avg` });
            }
            else if (adjDiff < -8 && shift < -3) {
                score -= 0.8;
                reasons.push({ icon: 'neg', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — loss-scenario drag pulls outlook ${shift.toFixed(1)} vs raw avg` });
            }
            else if (shift > 3) {
                score += 0.4;
                reasons.push({ icon: 'pos', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — favorite premium adds +${shift.toFixed(1)} pts to raw avg` });
            }
            else if (shift < -3) {
                score -= 0.4;
                reasons.push({ icon: 'neg', text: `ML-adj projection ${mlAdjFP.toFixed(1)} FP (${mlLabel}) — underdog discount trims ${Math.abs(shift).toFixed(1)} pts from raw avg` });
            }
        }
    }
    if (history.length >= 3) {
        const hits = historyFP.filter(v => v != null && v > line).length;
        const rate = hits / history.length;
        if (rate >= 0.75) {
            score += 2;
            reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights (${Math.round(rate * 100)}%) went over this exact line` });
        }
        else if (rate >= 0.6) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights over — consistent over tendency` });
        }
        else if (rate <= 0.25) {
            score -= 2;
            reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} fights (${Math.round(rate * 100)}%) cleared this line — line is hard to hit` });
        }
        else if (rate <= 0.4) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} fights over — under tendency at this line` });
        }
        else {
            reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} fights over — nearly 50/50` });
        }
    }
    if (history.length >= 3 && avgFP != null) {
        const recent = history.slice(0, 3);
        const recentFP = recent.map(h => getFightFantasyValueForPlatform(h, historyPlatform)).filter((v) => v != null);
        const recentAvg = recentFP.length ? recentFP.reduce((s, v) => s + v, 0) / recentFP.length : avgFP;
        const trend = recentAvg - avgFP;
        if (trend > 8) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Recent form trending UP — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` });
        }
        else if (trend < -8) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `Recent form trending DOWN — last 3 fights avg ${recentAvg.toFixed(1)} FP vs career avg ${avgFP.toFixed(1)}` });
        }
        // Recent hit rate — more predictive than career hit rate
        const recentHits = recentFP.filter(v => v > line).length;
        if (recentHits === 3) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Recent hit rate: 3/3 last fights cleared this line — hot right now` });
        }
        else if (recentHits === 0) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `Recent hit rate: 0/3 last fights cleared this line — cold streak at this number` });
        }
    }
    if (db.style === 'striker') {
        if (db.slpm != null && db.slpm > 6) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Elite volume striker (${db.slpm.toFixed(1)} SLpM) — naturally high FP ceiling` });
        }
        else if (db.slpm != null && db.slpm > 4) {
            score += 0.3;
            reasons.push({ icon: 'pos', text: `Active striker (${db.slpm.toFixed(1)} SLpM)` });
        }
    }
    else if (db.style === 'grappler') {
        if (db.avgTD != null && db.avgTD > 3) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `High-volume grappler (${db.avgTD.toFixed(1)} TD/15min) — TD scoring keeps floor high` });
        }
        else {
            score -= 0.5;
            reasons.push({ icon: 'neg', text: `Grappler style — FP ceiling limited by finishing tendency and low strike volume` });
        }
    }
    if (db.finishRate != null) {
        if (db.finishRate > 0.80) {
            score -= 1.5;
            reasons.push({ icon: 'neg', text: `Very high finish rate (${Math.round(db.finishRate * 100)}%) — frequent early stoppages severely limit counting stats` });
        }
        else if (db.finishRate > 0.65) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `High finish rate (${Math.round(db.finishRate * 100)}%) as winner — early stoppages rob counting stats` });
        }
        else if (db.finishRate < 0.35 && history.length >= 4) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `Decision fighter (${Math.round((1 - db.finishRate) * 100)}% decisions) — fights go full rounds, maximizing volume` });
        }
    }
    if (oppDB && oppDB.loaded) {
        const { delta: defDelta, edges: defEdges } = calcOpponentDefenseScore(oppDB, line);
        score += defDelta;
        reasons.push(...defEdges);
        const oppAllowedSamples = (oppDB.oppHistory || []).slice(0, 5)
            .map((h) => getFightFantasyValueForPlatform(h, historyPlatform))
            .filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (oppAllowedSamples.length >= 3) {
            const allowed = oppAllowedSamples.filter((v) => v > line).length;
            const blocked = oppAllowedSamples.length - allowed;
            const allowedRate = allowed / oppAllowedSamples.length;
            if (allowedRate <= 0.30) {
                score -= 1.1;
                reasons.push({ icon: 'neg', text: `Opponent line defense: only ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP (${blocked} held under)` });
            }
            else if (allowedRate <= 0.45) {
                score -= 0.5;
                reasons.push({ icon: 'neg', text: `Opponent line defense: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
            }
            else if (allowedRate >= 0.70) {
                score += 1.1;
                reasons.push({ icon: 'pos', text: `Opponent allows coverage often: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
            }
            else if (allowedRate >= 0.55) {
                score += 0.5;
                reasons.push({ icon: 'pos', text: `Opponent has allowed this FP range: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
            }
            else {
                reasons.push({ icon: 'neu', text: `Opponent line-allow rate is mixed: ${allowed}/${oppAllowedSamples.length} opponents cleared ${line.toFixed(2)} FP` });
            }
        }
        const { delta: matchupDelta, edges: matchupEdges } = styleMatchupEdge(db.style, oppDB.style, db, oppDB);
        score += matchupDelta;
        reasons.push(...matchupEdges);
        const { score: patScore, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, null, line, statsCache);
        score += patScore;
        reasons.push(...patReasons);
        // ── Similar-opponent backtest signal ───────────────────────────────────
        if (oppDB.loaded) {
            const simMatches = findSimilarOpponentFights(db, oppDB, 0.45, 5);
            if (simMatches.length >= 2) {
                const simWithFP = simMatches.filter(m => m.betrFP != null);
                if (simWithFP.length >= 2) {
                    const simAvgFP = simWithFP.reduce((s, m) => s + m.betrFP, 0) / simWithFP.length;
                    const simDiff = simAvgFP - line;
                    const avgSim = simMatches.reduce((s, m) => s + m.similarity, 0) / simMatches.length;
                    // Weight the signal by similarity quality (higher similarity = stronger signal)
                    const simWeight = Math.min(1.0, avgSim * 1.3);
                    if (simDiff > 8) {
                        score += 1.2 * simWeight;
                        reasons.push({ icon: 'pos', text: `vs similar opponents (${simWithFP.length} fights, ${Math.round(avgSim * 100)}% sim): avg ${simAvgFP.toFixed(1)} FP — ${simDiff.toFixed(1)} above line` });
                    }
                    else if (simDiff > 3) {
                        score += 0.6 * simWeight;
                        reasons.push({ icon: 'pos', text: `vs similar opponents (${simWithFP.length} fights): avg ${simAvgFP.toFixed(1)} FP — edges line by ${simDiff.toFixed(1)}` });
                    }
                    else if (simDiff < -8) {
                        score -= 1.2 * simWeight;
                        reasons.push({ icon: 'neg', text: `vs similar opponents (${simWithFP.length} fights, ${Math.round(avgSim * 100)}% sim): avg ${simAvgFP.toFixed(1)} FP — ${Math.abs(simDiff).toFixed(1)} below line` });
                    }
                    else if (simDiff < -3) {
                        score -= 0.6 * simWeight;
                        reasons.push({ icon: 'neg', text: `vs similar opponents (${simWithFP.length} fights): avg ${simAvgFP.toFixed(1)} FP — trails line by ${Math.abs(simDiff).toFixed(1)}` });
                    }
                }
            }
        }
        // Contextual favorite/underdog behavior & scoring pressure (add-on module)
        const lineGap = oppLine != null ? (line - oppLine) : null;
        const selfBase = db.avgFP_weighted ?? avgFP ?? db.avgFP ?? 0;
        const oppBase = oppDB.avgFP_weighted ?? oppDB.avgFP ?? 0;
        const inferredGap = selfBase - oppBase;
        // Prefer sportsbook moneyline for fav/dog status — cleaner signal than FP line gap
        const isFavorite = moneyline != null ? moneyline <= -150
            : lineGap != null ? lineGap >= 3 : inferredGap >= 8;
        const isUnderdog = moneyline != null ? moneyline >= 150
            : lineGap != null ? lineGap <= -3 : inferredGap <= -8;
        const isHeavyFavorite = moneyline != null && moneyline <= -300;
        const isHeavyUnderdog = moneyline != null && moneyline >= 300;
        const selfPressureProfile = (db.style === 'striker' && (db.slpm ?? 0) >= 4.8)
            || ((db.avgTD ?? 0) >= 2.2)
            || ((db.slpm ?? 0) >= 4.2 && (db.avgTD ?? 0) >= 1.6);
        const oppPressureProfile = (oppDB.style === 'striker' && (oppDB.slpm ?? 0) >= 4.8)
            || ((oppDB.avgTD ?? 0) >= 2.2)
            || ((oppDB.slpm ?? 0) >= 4.2 && (oppDB.avgTD ?? 0) >= 1.6);
        const selfDefensiveLeaks = (db.strDef ?? 55) < 50
            || (db.tdDef ?? 58) < 55
            || (db.sapm ?? 3.8) > 4.4
            || (db.fpConsistency ?? 55) < 45;
        const oppDefensiveLeaks = (oppDB.strDef ?? 55) < 50
            || (oppDB.tdDef ?? 58) < 55
            || (oppDB.sapm ?? 3.8) > 4.4
            || (oppDB.fpConsistency ?? 55) < 45;
        const selfNoMinuteWinningTools = (db.slpm ?? 0) < 3.2
            && (db.avgTD ?? 0) < 1.2
            && (db.tdAcc ?? 40) < 36
            && (db.fpConsistency ?? 55) < 50;
        const oneWayTraffic = selfPressureProfile
            && oppDefensiveLeaks
            && (((db.slpm ?? 0) - (oppDB.slpm ?? 0) >= 0.8)
                || ((db.avgTD ?? 0) - (oppDB.avgTD ?? 0) >= 1.0)
                || ((oppDB.sapm ?? 3.8) >= 4.8)
                || ((oppDB.fpConsistency ?? 55) <= 42));
        if (isFavorite && selfPressureProfile && oppDefensiveLeaks) {
            score += 1.45;
            reasons.push({ icon: 'pos', text: `Favorite pressure path: projected pace/control can suppress opponent output and expand your scoring windows` });
        }
        if (isFavorite && oneWayTraffic) {
            score += 1.25;
            reasons.push({ icon: 'pos', text: `One-way traffic projection: pressure + opponent defensive fragility point to favorite pace dominance` });
        }
        if (isFavorite) {
            const styleExploitsLeak = ((db.slpm ?? 0) >= 4.2 && (oppDB.strDef ?? 55) < 52)
                || ((db.avgTD ?? 0) >= 1.8 && (oppDB.tdDef ?? 58) < 58);
            if (oppDefensiveLeaks && styleExploitsLeak) {
                score += 1.05;
                reasons.push({ icon: 'pos', text: `Opponent defensive leaks (str/td defense + absorption profile) inflate favorite scoring expectation` });
            }
        }
        if (isFavorite && (db.finishRate ?? 0) >= 0.45) {
            const hasDecisionVolume = (db.slpm ?? 0) >= 4.0;
            const hasControlPath = (db.avgTD ?? 0) >= 1.5;
            if (hasDecisionVolume || hasControlPath) {
                score += 1.1;
                reasons.push({ icon: 'pos', text: `Favorite finish equity with redundant scoring paths (volume/finish/control) raises OVER probability` });
            }
        }
        if (isFavorite && (db.finishRate ?? 0) >= 0.55 && avgFP != null && (line - avgFP) <= 5) {
            score += 0.6;
            reasons.push({ icon: 'pos', text: `Favorite can clear via multiple paths even near line (decision volume or early finish upside)` });
        }
        if (isUnderdog && oppPressureProfile && selfDefensiveLeaks) {
            score -= 1.35;
            reasons.push({ icon: 'neg', text: `Underdog suppression risk: opponent pressure profile can shrink your attempts, control time, and scoring windows` });
        }
        if (isUnderdog && selfNoMinuteWinningTools) {
            score -= 1.1;
            reasons.push({ icon: 'neg', text: `Underdog lacks reliable minute-winning tools (volume/control pace), increasing UNDER collapse risk` });
        }
        if (isHeavyFavorite && avgFP != null && line <= avgFP + 6) {
            score += 0.8;
            reasons.push({ icon: 'pos', text: `Heavy favorite (${moneyline}) — structural edge: high implied win probability amplifies scoring ceiling and pace dominance` });
        }
        if (isHeavyUnderdog) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `Heavy underdog (${moneyline}) — suppression risk elevated; opponent likely controls pace and shortens the fight` });
        }
        // Brain V2 modular overlay: favorite/underdog engine + scoring-path architecture
        score += applyBrainV2Overlay(db, oppDB, line, oppLine, moneyline, oppMoneyline, avgFP ?? null, reasons);
    }
    else if (oppDB && !oppDB.loaded) {
        reasons.push({ icon: 'neu', text: `Opponent stats loading — matchup analysis will update shortly` });
    }
    const archetypeEdge = calcArchetypeLearnerEdge(name, db, oppDB ?? null, moneyline, line, avgFP ?? effectiveFP ?? null);
    score += archetypeEdge.delta;
    reasons.push(...archetypeEdge.reasons);
    if (db.strAcc != null) {
        if (db.strAcc > 52)
            reasons.push({ icon: 'pos', text: `High striking accuracy (${db.strAcc}%) — efficient volume, good FP conversion` });
        else if (db.strAcc < 36) {
            score -= 0.3;
            reasons.push({ icon: 'neg', text: `Low striking accuracy (${db.strAcc}%) — volume doesn't always translate to landed strikes` });
        }
    }
    if (db.fpFloor != null && db.fpCeiling != null) {
        if (db.fpFloor > line) {
            score += 1.5;
            reasons.push({ icon: 'pos', text: `Elite floor: worst recorded game (${db.fpFloor.toFixed(1)} FP) still clears the line — low downside risk` });
        }
        else if (db.fpCeiling < line) {
            score -= 1.5;
            reasons.push({ icon: 'neg', text: `Hard ceiling: best recorded game (${db.fpCeiling.toFixed(1)} FP) misses the line — very hard to hit over` });
        }
        else if (db.fpFloor > line * 0.88 && history.length >= 4) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `Strong floor (${db.fpFloor.toFixed(1)} FP at ${Math.round((db.fpFloor / line) * 100)}% of line) — rarely undershoots badly` });
        }
    }
    if (db.fpConsistency != null && history.length >= 4) {
        if (db.fpConsistency >= 75) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `High consistency (${db.fpConsistency}%) — FP is predictable and reliable, boosts lean confidence` });
        }
        else if (db.fpConsistency <= 35) {
            score -= 0.5;
            reasons.push({ icon: 'neg', text: `Volatile fighter (${db.fpConsistency}% consistency) — high variance, line could go either way` });
        }
    }
    if (db.streak?.type === 'hot') {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `🔥 Hot streak: ${db.streak.text}` });
    }
    else if (db.streak?.type === 'cold') {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `❄️ Cold streak: ${db.streak.text}` });
    }
    if (db.avgFP_weighted != null && avgFP != null) {
        const drift = db.avgFP_weighted - avgFP;
        if (drift > 10) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `Rising form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) outpacing career avg (${avgFP.toFixed(1)}) by ${drift.toFixed(1)} pts` });
        }
        else if (drift < -10) {
            score -= 0.5;
            reasons.push({ icon: 'neg', text: `Fading form: recent weighted avg (${db.avgFP_weighted.toFixed(1)}) lagging career avg (${avgFP.toFixed(1)}) by ${Math.abs(drift).toFixed(1)} pts` });
        }
    }
    if (db.fiveRoundRate != null && db.fiveRoundRate > 0.3 && db.avgFP_perRound != null) {
        const projFiveRound = db.avgFP_perRound * 5;
        if (projFiveRound > line * 1.1) {
            score += 0.3;
            reasons.push({ icon: 'pos', text: `${Math.round(db.fiveRoundRate * 100)}% of fights go 4-5 rounds — FP ceiling expands significantly in long fights (proj ${projFiveRound.toFixed(1)} over 5R)` });
        }
    }
    // ── AI ENHANCEMENTS: Integrate multivariate scoring factors ───────────────
    // #11: Weighted Recent Form Curve
    const formTrend = calcWeightedFormTrend(history);
    if (formTrend.trend > 3) {
        score += 0.3;
        reasons.push({ icon: 'pos', text: `${formTrend.label} — recent fights outpacing average` });
    }
    else if (formTrend.trend < -3) {
        score -= 0.3;
        reasons.push({ icon: 'neg', text: `${formTrend.label} — recent fights underperforming career average` });
    }
    // #12: Opponent Strength Adjustment
    if (oppDB && oppDB.loaded) {
        const oppStrengthScore = calcOpponentStrengthScore(oppDB);
        if (oppStrengthScore.score >= 1.45) {
            score -= 0.8;
            reasons.push({ icon: 'neg', text: `${oppStrengthScore.label} — high-level opponent profile increases difficulty` });
        }
        else if (oppStrengthScore.score >= 0.75) {
            score -= 0.35;
            reasons.push({ icon: 'neg', text: `${oppStrengthScore.label} — above-average opponent quality adds resistance` });
        }
        else if (oppStrengthScore.score <= -0.4) {
            score += 0.5;
            reasons.push({ icon: 'pos', text: `${oppStrengthScore.label} — matchup presents opportunity` });
        }
    }
    // #13: Fight Context Factors
    const contextFactors = calcFightContextScore(history);
    score += contextFactors.score;
    reasons.push(...contextFactors.reasons);
    // #16: Burnout/Rest Cycle
    const restCycle = calcRestCycleFactor(history);
    score += restCycle.score;
    if (restCycle.label && restCycle.score !== 0) {
        reasons.push({ icon: restCycle.score > 0 ? 'pos' : 'neg', text: restCycle.label });
    }
    // #19: Extreme Value Detection
    const extremeValue = detectExtremeValue(line, db.fpFloor ?? null, db.fpCeiling ?? null, db.fpStdDev ?? null, history);
    if (extremeValue.isExtreme) {
        reasons.push({ icon: 'neu', text: `${extremeValue.label} — line is ${extremeValue.severity.toFixed(1)} std devs from historical norm` });
    }
    let lean = 'push';
    const threshold = 1.5;
    if (score >= threshold)
        lean = 'over';
    else if (score <= -threshold)
        lean = 'under';
    const rivalry = buildModelRivalry(name, lean, db, history, line, selectedLine ?? null, availableLines, avgFP ?? null, effectiveFP ?? null, oppDB ?? null, moneyline);
    const confidenceModel = calcEnhancedFPConfidence(name, lean, score, db, history, line, selectedLine ?? null, availableLines, avgFP ?? null, effectiveFP ?? null, oppDB ?? null, moneyline, restCycle.daysSince, extremeValue.severity || 0, rivalry);
    const conf = confidenceModel.confidence;
    reasons.push({
        icon: lean === 'push' ? 'neu' : conf >= 74 ? 'pos' : conf < 58 ? 'neg' : 'neu',
        text: confidenceModel.summary,
    });
    if (confidenceModel.rivalryNote) {
        reasons.push({
            icon: confidenceModel.rivalryDelta > 0 ? 'pos' : 'neg',
            text: confidenceModel.rivalryNote,
        });
    }
    if (confidenceModel.memoryNote) {
        reasons.push({
            icon: confidenceModel.memoryDelta > 0 ? 'pos' : 'neg',
            text: confidenceModel.memoryNote,
        });
    }
    const lineStr = selectedLine != null
        ? `${platform === 'pick6' ? 'P6' : platform === 'underdog' ? 'UD' : platform === 'prizepicks' ? 'PP' : platform === 'draftkings_sportsbook' ? 'DK' : 'BTR'} ${selectedLine}`
        : (availableLines.length > 1 ? `avg ${line}` : line_p6 ? `P6 ${line_p6}` : line_ud ? `UD ${line_ud}` : line_pp ? `PP ${line_pp}` : `BTR ${line_betr}`);
    const avgStr = avgFP != null ? ` (avg ${avgFP.toFixed(1)})` : '';
    const verdict = lean === 'over'
        ? `LEAN OVER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'over value identified'}`
        : lean === 'under'
            ? `LEAN UNDER ${lineStr}${avgStr} — ${reasons[0]?.text?.split('—')[0]?.trim() || 'under value identified'}`
            : `LEAN ${score >= 0 ? 'OVER' : 'UNDER'} ${lineStr}${avgStr} — edge not yet at strong threshold`;
    const ev = lean !== 'push' ? parseFloat(((conf / 100) * 0.1 - (1 - conf / 100) * 1).toFixed(2)) : 0;
    // ── Fair Value Generator ────────────────────────────────────────────────
    const perBookLines = [];
    if (line_p6 != null)
        perBookLines.push({ source: 'P6', line: line_p6 });
    if (line_ud != null)
        perBookLines.push({ source: 'UD', line: line_ud });
    if (line_pp != null)
        perBookLines.push({ source: 'PP', line: line_pp });
    if (line_betr != null)
        perBookLines.push({ source: 'BTR', line: line_betr });
    const fv = computeFairValue(rivalry, line, perBookLines);
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: confidenceModel.grade,
        memoryDelta: confidenceModel.memoryDelta,
        memoryNote: confidenceModel.memoryNote,
        rivalryModels: rivalry.models,
        rivalrySummary: rivalry.summary,
        rivalryDissent: rivalry.dissentSummary,
        rivalryConsensus: rivalry.consensusLean,
        rivalryStrongDissent: rivalry.strongDissent?.model ?? null,
        rivalryConfidenceDelta: rivalry.confidenceDelta,
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        ev,
        ensembleAgreement: confidenceModel.ensembleAgreement,
        bayesianProbability: confidenceModel.bayesianProbability,
        optimizedLine: confidenceModel.optimizedLine,
        timeWeightedAvg: confidenceModel.timeWeightedAvg,
        kellyBetSize: confidenceModel.kellyBetSize,
        fairValue: fv?.fairValue,
        fairValueEdge: fv?.fairValueEdge,
        fairValuePerBook: fv?.fairValuePerBook,
    };
}
function calcSSLean(name, db, line_ss, oppDB, dkLine, availableLines = [], moneyline = null) {
    if (!line_ss || !db || !db.loaded)
        return null;
    const history = (db.history || []).filter(h => h.sigStr != null);
    if (history.length < 3)
        return null;
    const avgSS = history.reduce((s, h) => s + (h.sigStr || 0), 0) / history.length;
    // ── Opp-adjusted SS projection ────────────────────────────────────────────
    const oppSSSamples = (oppDB?.oppHistory ?? []).slice(0, 5)
        .map(h => h.sigStr)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const oppAvgSSAllowedLean = oppSSSamples.length >= 3
        ? parseFloat((oppSSSamples.reduce((s, v) => s + v, 0) / oppSSSamples.length).toFixed(1))
        : null;
    const projSSLean = oppAvgSSAllowedLean != null
        ? parseFloat(((avgSS + oppAvgSSAllowedLean) / 2).toFixed(1))
        : null;
    const effectiveSS = projSSLean ?? avgSS;
    const reasons = [];
    let score = 0;
    // ── Venue / altitude / cage factors ──────────────────────────────────────
    if (currentVenueFactor.altitudeMeters >= 1200) {
        const altPenalty = currentVenueFactor.altitudeMeters >= 2000 ? -0.8
            : currentVenueFactor.altitudeMeters >= 1500 ? -0.5 : -0.3;
        score += altPenalty;
        reasons.push({ icon: 'neg', text: `Altitude (${currentVenueFactor.altitudeMeters}m) — reduced SS volume from cardio fatigue` });
    }
    if (currentVenueFactor.cageSizeFt === 25) {
        score -= 0.3;
        reasons.push({ icon: 'neg', text: 'Small cage (25ft) — less space to maintain distance, lower SS volume' });
    }
    const ssLabel = projSSLean != null
        ? `Proj SS (${effectiveSS.toFixed(1)} — avg ${avgSS.toFixed(1)} + opp allows ${oppAvgSSAllowedLean})`
        : `Avg SS (${effectiveSS.toFixed(1)})`;
    const diff = effectiveSS - line_ss;
    if (diff > 20) {
        score += 2.5;
        reasons.push({ icon: 'pos', text: `${ssLabel} is ${diff.toFixed(1)} above line — strong over value` });
    }
    else if (diff > 8) {
        score += 1.5;
        reasons.push({ icon: 'pos', text: `${ssLabel} edges the line by ${diff.toFixed(1)}` });
    }
    else if (diff > 3) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `${ssLabel} slightly above line` });
    }
    else if (diff < -20) {
        score -= 2.5;
        reasons.push({ icon: 'neg', text: `${ssLabel} is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` });
    }
    else if (diff < -8) {
        score -= 1.5;
        reasons.push({ icon: 'neg', text: `${ssLabel} trails line by ${Math.abs(diff).toFixed(1)}` });
    }
    else if (diff < -3) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `${ssLabel} slightly below line` });
    }
    else {
        reasons.push({ icon: 'neu', text: `${ssLabel} near line — toss-up` });
    }
    const hits = history.filter(h => (h.sigStr || 0) > line_ss).length;
    const rate = hits / history.length;
    if (rate >= 0.75) {
        score += 2;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights (${Math.round(rate * 100)}%) went over SS line` });
    }
    else if (rate >= 0.6) {
        score += 1;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights over SS line` });
    }
    else if (rate <= 0.25) {
        score -= 2;
        reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} fights (${Math.round(rate * 100)}%) cleared SS line` });
    }
    else if (rate <= 0.4) {
        score -= 1;
        reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} fights over SS line — under tendency` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} fights over SS line — near 50/50` });
    }
    if (history.length >= 3) {
        const recentAvg = history.slice(0, 3).reduce((s, h) => s + (h.sigStr || 0), 0) / 3;
        const trend = recentAvg - avgSS;
        if (trend > 15) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Recent form UP — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` });
        }
        else if (trend < -15) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(0)} SS vs career ${avgSS.toFixed(0)}` });
        }
    }
    if (db.style === 'striker') {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Striker style — naturally high SS volume` });
    }
    else if (db.style === 'grappler') {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Grappler style — may rely on TDs more than striking` });
    }
    if (db.strAcc != null && db.strAcc > 52) {
        score += 0.3;
        reasons.push({ icon: 'pos', text: `High accuracy (${db.strAcc}%) — lands efficiently, SS count reliable` });
    }
    if (oppDB?.loaded) {
        const { ssScore: patSS, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, line_ss, null, null, statsCache);
        score += patSS;
        reasons.push(...patReasons);
        // Similar-opponent backtest for SS
        const simMatchesSS = findSimilarOpponentFights(db, oppDB, 0.45, 5);
        const simWithSS = simMatchesSS.filter(m => m.fightResult.sigStr != null);
        if (simWithSS.length >= 2) {
            const simAvgSS = simWithSS.reduce((s, m) => s + (m.fightResult.sigStr || 0), 0) / simWithSS.length;
            const simDiff = simAvgSS - line_ss;
            const avgSim = simMatchesSS.reduce((s, m) => s + m.similarity, 0) / simMatchesSS.length;
            const simW = Math.min(1.0, avgSim * 1.3);
            if (simDiff > 12) {
                score += 1.0 * simW;
                reasons.push({ icon: 'pos', text: `vs similar opps (${simWithSS.length} fights): avg ${simAvgSS.toFixed(0)} SS — ${simDiff.toFixed(0)} above line` });
            }
            else if (simDiff > 5) {
                score += 0.5 * simW;
                reasons.push({ icon: 'pos', text: `vs similar opps (${simWithSS.length} fights): avg ${simAvgSS.toFixed(0)} SS edges line` });
            }
            else if (simDiff < -12) {
                score -= 1.0 * simW;
                reasons.push({ icon: 'neg', text: `vs similar opps (${simWithSS.length} fights): avg ${simAvgSS.toFixed(0)} SS — ${Math.abs(simDiff).toFixed(0)} below line` });
            }
            else if (simDiff < -5) {
                score -= 0.5 * simW;
                reasons.push({ icon: 'neg', text: `vs similar opps (${simWithSS.length} fights): avg ${simAvgSS.toFixed(0)} SS trails line` });
            }
        }
    }
    // DK Sportsbook is a sharp line — divergence from fantasy books is a signal
    if (dkLine != null && dkLine !== line_ss && Math.abs(dkLine - line_ss) >= 3) {
        if (dkLine < line_ss) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `DK Sportsbook sets SS at ${dkLine} vs fantasy book ${line_ss} — sharp line implies less striking volume` });
        }
        else {
            score += 0.7;
            reasons.push({ icon: 'pos', text: `DK Sportsbook sets SS at ${dkLine} vs fantasy book ${line_ss} — sharp line implies more striking volume` });
        }
    }
    let lean, conf;
    if (score >= 3) {
        lean = 'over';
        conf = Math.min(90, 68 + score * 4);
    }
    else if (score >= 1.5) {
        lean = 'over';
        conf = Math.min(74, 56 + score * 5);
    }
    else if (score >= 0.5) {
        lean = 'over';
        conf = 54;
    }
    else if (score <= -3) {
        lean = 'under';
        conf = Math.min(90, 68 + Math.abs(score) * 4);
    }
    else if (score <= -1.5) {
        lean = 'under';
        conf = Math.min(74, 56 + Math.abs(score) * 5);
    }
    else if (score <= -0.5) {
        lean = 'under';
        conf = 54;
    }
    else {
        lean = 'push';
        conf = 50;
    }
    // Variance haircut: high SS spread means the outcome is less predictable
    const ssStdDev = db.ssStdDev ?? null;
    if (ssStdDev != null && lean !== 'push') {
        if (ssStdDev > 14) {
            conf = Math.max(50, conf - 8);
            reasons.push({ icon: 'neg', text: `High SS variance (±${ssStdDev.toFixed(1)}) — volatile output, confidence reduced` });
        }
        else if (ssStdDev > 7) {
            conf = Math.max(50, conf - 4);
            reasons.push({ icon: 'neu', text: `Moderate SS variance (±${ssStdDev.toFixed(1)}) — some output unpredictability` });
        }
        else {
            conf = Math.min(90, conf + 3);
            reasons.push({ icon: 'pos', text: `Tight SS variance (±${ssStdDev.toFixed(1)}) — consistent output, confidence boosted` });
        }
    }
    const memoryAdjustment = applyConfidenceMemoryAdjustment({
        fighterName: name,
        source: 'ss',
        lean,
        baseConfidence: conf,
        score,
        db,
        avgValue: avgSS,
        line: line_ss,
        selectedLine: line_ss,
        availableLines: availableLines.length ? availableLines : [line_ss],
        oppDB,
        moneyline,
    });
    conf = memoryAdjustment.confidence;
    if (memoryAdjustment.note) {
        reasons.push({ icon: memoryAdjustment.delta > 0 ? 'pos' : 'neg', text: memoryAdjustment.note });
    }
    const ssVerdict = projSSLean != null ? `proj ${projSSLean.toFixed(1)}` : `avg ${avgSS.toFixed(1)}`;
    const verdict = lean === 'over'
        ? `SS OVER ${line_ss} (${ssVerdict}) — ${reasons[0]?.text}`
        : lean === 'under'
            ? `SS UNDER ${line_ss} (${ssVerdict}) — ${reasons[0]?.text}`
            : `SS NO LEAN at ${line_ss} (${ssVerdict})`;
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: getConfidenceGrade(Math.round(conf)),
        memoryDelta: memoryAdjustment.delta,
        memoryNote: memoryAdjustment.note,
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        avg: effectiveSS,
        line: line_ss,
        type: 'ss'
    };
}
// Round-1-only significant-strikes lean (PrizePicks + Underdog offer this prop).
// Deliberately conservative vs the full-fight SS lean: R1 is a single-round sample
// with built-in early-finish risk, so confidence is capped lower and the weak ±0.5
// tier collapses to a push — only corroborated signals (edge + hit-rate / form /
// style) surface a lean. When PP and UD post different lines, the easiest line for
// the projected direction is used (lowest for OVER, highest for UNDER).
function calcSSR1Lean(name, db, availableLines = [], oppDB, moneyline = null) {
    const lines = availableLines.filter((l) => l != null && Number.isFinite(l));
    if (!lines.length || !db || !db.loaded)
        return null;
    const history = (db.history || []).filter(h => h.sigStrR1 != null);
    if (history.length < 3)
        return null;
    const avgR1 = history.reduce((s, h) => s + (h.sigStrR1 || 0), 0) / history.length;
    // Opp-adjusted projection: R1 sig strikes the opponent has historically allowed.
    const oppSamples = (oppDB?.oppHistory ?? []).slice(0, 5)
        .map(h => h.sigStrR1)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const oppAllowed = oppSamples.length >= 3
        ? parseFloat((oppSamples.reduce((s, v) => s + v, 0) / oppSamples.length).toFixed(1))
        : null;
    const proj = oppAllowed != null ? parseFloat(((avgR1 + oppAllowed) / 2).toFixed(1)) : null;
    const effective = proj ?? avgR1;
    // Pick the best line for the projected direction across PP/UD.
    const minL = Math.min(...lines);
    const maxL = Math.max(...lines);
    const mid = (minL + maxL) / 2;
    const dirHint = effective >= mid ? 'over' : 'under';
    const line = dirHint === 'over' ? minL : maxL;
    const reasons = [];
    let score = 0;
    const label = proj != null
        ? `Proj R1 SS (${effective.toFixed(1)} — avg ${avgR1.toFixed(1)} + opp allows ${oppAllowed})`
        : `Avg R1 SS (${effective.toFixed(1)})`;
    const diff = effective - line;
    if (diff > 8) {
        score += 2.5;
        reasons.push({ icon: 'pos', text: `${label} is ${diff.toFixed(1)} above line — strong over value` });
    }
    else if (diff > 4) {
        score += 1.5;
        reasons.push({ icon: 'pos', text: `${label} edges the line by ${diff.toFixed(1)}` });
    }
    else if (diff > 1.5) {
        score += 0.6;
        reasons.push({ icon: 'pos', text: `${label} slightly above line` });
    }
    else if (diff < -8) {
        score -= 2.5;
        reasons.push({ icon: 'neg', text: `${label} is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` });
    }
    else if (diff < -4) {
        score -= 1.5;
        reasons.push({ icon: 'neg', text: `${label} trails line by ${Math.abs(diff).toFixed(1)}` });
    }
    else if (diff < -1.5) {
        score -= 0.6;
        reasons.push({ icon: 'neg', text: `${label} slightly below line` });
    }
    else {
        reasons.push({ icon: 'neu', text: `${label} near line — toss-up` });
    }
    // Hit rate is the dominant signal for a bounded single-round stat — it directly
    // measures how often the line is covered. An extreme record (never covered, or
    // always covered) over a solid sample is the strongest tell R1 SS offers and is
    // weighted accordingly; it also flags the lean as high-conviction below.
    const hits = history.filter(h => (h.sigStrR1 || 0) > line).length;
    const rate = hits / history.length;
    const extremeClean = (rate === 0 || rate === 1) && history.length >= 8;
    if (rate === 1 && history.length >= 8) {
        score += 3.0;
        reasons.push({ icon: 'pos', text: `Cleared R1 SS line in ALL ${history.length} UFC fights (${history.length}/${history.length}) — structurally clean over` });
    }
    else if (rate >= 0.8) {
        score += 1.8;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} (${Math.round(rate * 100)}%) cleared R1 SS line` });
    }
    else if (rate >= 0.6) {
        score += 0.8;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} over R1 SS line` });
    }
    else if (rate === 0 && history.length >= 8) {
        score -= 3.0;
        reasons.push({ icon: 'neg', text: `Never cleared R1 SS line in ${history.length} UFC fights (0/${history.length}) — structurally clean under` });
    }
    else if (rate <= 0.2) {
        score -= 1.8;
        reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} (${Math.round(rate * 100)}%) cleared R1 SS line` });
    }
    else if (rate <= 0.4) {
        score -= 0.8;
        reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} over R1 SS line — under tendency` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} over R1 SS line — near 50/50` });
    }
    if (history.length >= 3) {
        const recentAvg = history.slice(0, 3).reduce((s, h) => s + (h.sigStrR1 || 0), 0) / 3;
        const trend = recentAvg - avgR1;
        if (trend > 6) {
            score += 0.7;
            reasons.push({ icon: 'pos', text: `Recent R1 form UP — last 3 avg ${recentAvg.toFixed(0)} vs career ${avgR1.toFixed(0)}` });
        }
        else if (trend < -6) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `Recent R1 form DOWN — last 3 avg ${recentAvg.toFixed(0)} vs career ${avgR1.toFixed(0)}` });
        }
    }
    if (db.style === 'striker') {
        score += 0.4;
        reasons.push({ icon: 'pos', text: `Striker — typically high round-1 output` });
    }
    else if (db.style === 'grappler') {
        score -= 0.4;
        reasons.push({ icon: 'neg', text: `Grappler — may chase early takedowns over R1 striking volume` });
    }
    // Best-line note last so the diff reason stays as the verdict headline.
    if (lines.length > 1) {
        reasons.push({ icon: 'neu', text: `Best ${dirHint.toUpperCase()} line ${line} chosen across PP/UD range ${minL}–${maxL}` });
    }
    // An extreme/clean historical record proves low round-1 variance empirically, so
    // it earns a higher confidence ceiling and is exempt from the volatility haircut
    // (the record already accounts for early finishes and pace swings).
    const cap = extremeClean ? 86 : 80;
    let lean, conf;
    if (score >= 3) {
        lean = 'over';
        conf = Math.min(cap, 62 + score * 3.5);
    }
    else if (score >= 1.5) {
        lean = 'over';
        conf = Math.min(70, 54 + score * 5);
    }
    else if (score <= -3) {
        lean = 'under';
        conf = Math.min(cap, 62 + Math.abs(score) * 3.5);
    }
    else if (score <= -1.5) {
        lean = 'under';
        conf = Math.min(70, 54 + Math.abs(score) * 5);
    }
    else {
        lean = 'push';
        conf = 50;
    }
    // R1 SS volatility haircut — single round + early-finish risk, never boosted.
    // Skipped when the record is structurally clean (variance already proven low).
    const ssStdDev = db.ssStdDev ?? null;
    if (ssStdDev != null && lean !== 'push' && !extremeClean) {
        if (ssStdDev > 14) {
            conf = Math.max(50, conf - 10);
            reasons.push({ icon: 'neg', text: `High SS variance (±${ssStdDev.toFixed(1)}) + single-round sample — confidence reduced` });
        }
        else if (ssStdDev > 7) {
            conf = Math.max(50, conf - 5);
            reasons.push({ icon: 'neu', text: `Moderate SS variance (±${ssStdDev.toFixed(1)}) — some R1 unpredictability` });
        }
    }
    const vtxt = proj != null ? `proj ${proj.toFixed(1)}` : `avg ${avgR1.toFixed(1)}`;
    const headline = reasons.find(r => r.icon !== 'neu')?.text ?? reasons[0]?.text ?? '';
    const verdict = lean === 'over'
        ? `R1 SS OVER ${line} (${vtxt}) — ${headline}`
        : lean === 'under'
            ? `R1 SS UNDER ${line} (${vtxt}) — ${headline}`
            : `R1 SS NO LEAN at ${line} (${vtxt})`;
    void name;
    void moneyline;
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: getConfidenceGrade(Math.round(conf)),
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        avg: effective,
        line,
        type: 'ss_r1',
    };
}
function calcTDLean(name, db, line_td, oppDB, dkLine, availableLines = [], moneyline = null) {
    if (!line_td || !db || !db.loaded)
        return null;
    const history = (db.history || []).filter(h => h.td != null);
    if (history.length < 3)
        return null;
    const avgTD = history.reduce((s, h) => s + (h.td || 0), 0) / history.length;
    // ── Opp-adjusted TD projection ────────────────────────────────────────────
    const oppTDSamples = (oppDB?.oppHistory ?? []).slice(0, 5)
        .map(h => h.td)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const oppAvgTDAllowed = oppTDSamples.length >= 3
        ? parseFloat((oppTDSamples.reduce((s, v) => s + v, 0) / oppTDSamples.length).toFixed(1))
        : null;
    const projTD = (oppAvgTDAllowed != null)
        ? parseFloat(((avgTD + oppAvgTDAllowed) / 2).toFixed(1))
        : null;
    const effectiveTD = projTD ?? avgTD;
    const reasons = [];
    let score = 0;
    // ── Venue / altitude / cage factors ──────────────────────────────────────
    if (currentVenueFactor.altitudeMeters >= 1200) {
        const altBoost = currentVenueFactor.altitudeMeters >= 2000 ? 0.4
            : currentVenueFactor.altitudeMeters >= 1500 ? 0.3 : 0.2;
        score += altBoost;
        reasons.push({ icon: 'pos', text: `Altitude (${currentVenueFactor.altitudeMeters}m) — fatigued fighters clinch more, TD attempts rise` });
    }
    if (currentVenueFactor.cageSizeFt === 25) {
        score += 0.4;
        reasons.push({ icon: 'pos', text: 'Small cage (25ft) — less space to sprawl, more TD opportunities' });
    }
    const tdLabel = projTD != null
        ? `Proj TDs (${effectiveTD.toFixed(1)} — avg ${avgTD.toFixed(1)} + opp allows ${oppAvgTDAllowed})`
        : `Avg TDs (${effectiveTD.toFixed(1)})`;
    const diff = effectiveTD - line_td;
    if (diff > 3) {
        score += 2.5;
        reasons.push({ icon: 'pos', text: `${tdLabel} is ${diff.toFixed(1)} above line — strong over value` });
    }
    else if (diff > 1.5) {
        score += 1.5;
        reasons.push({ icon: 'pos', text: `${tdLabel} edges line by ${diff.toFixed(1)}` });
    }
    else if (diff > 0.5) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `${tdLabel} slightly above line` });
    }
    else if (diff < -3) {
        score -= 2.5;
        reasons.push({ icon: 'neg', text: `${tdLabel} is ${Math.abs(diff).toFixed(1)} BELOW line — strong under value` });
    }
    else if (diff < -1.5) {
        score -= 1.5;
        reasons.push({ icon: 'neg', text: `${tdLabel} trails line by ${Math.abs(diff).toFixed(1)}` });
    }
    else if (diff < -0.5) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `${tdLabel} slightly below line` });
    }
    else {
        reasons.push({ icon: 'neu', text: `${tdLabel} near line — toss-up` });
    }
    const hits = history.filter(h => (h.td || 0) > line_td).length;
    const rate = hits / history.length;
    if (rate >= 0.75) {
        score += 2;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights (${Math.round(rate * 100)}%) exceeded TD line` });
    }
    else if (rate >= 0.6) {
        score += 1;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${history.length} fights over TD line` });
    }
    else if (rate <= 0.25) {
        score -= 2;
        reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${history.length} fights (${Math.round(rate * 100)}%) cleared TD line` });
    }
    else if (rate <= 0.4) {
        score -= 1;
        reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${history.length} fights over TD line — under tendency` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${history.length} fights over TD line — near 50/50` });
    }
    if (history.length >= 3) {
        const recentAvg = history.slice(0, 3).reduce((s, h) => s + (h.td || 0), 0) / 3;
        const trend = recentAvg - avgTD;
        if (trend > 2) {
            score += 1;
            reasons.push({ icon: 'pos', text: `Recent form UP — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` });
        }
        else if (trend < -2) {
            score -= 1;
            reasons.push({ icon: 'neg', text: `Recent form DOWN — last 3 fights avg ${recentAvg.toFixed(1)} TDs vs career ${avgTD.toFixed(1)}` });
        }
    }
    if (db.style === 'grappler') {
        score += 1;
        reasons.push({ icon: 'pos', text: `Grappler style — TDs are primary weapon` });
    }
    else if (db.style === 'striker') {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Striker style — TDs not primary weapon` });
    }
    if (db.tdDef != null && db.tdDef > 75) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Opponent has strong TD defense — may limit attempts` });
    }
    else if (db.tdDef != null && db.tdDef < 50) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Opponent has weak TD defense — good target for takedowns` });
    }
    if (oppDB?.loaded) {
        const { tdScore: patTD, reasons: patReasons } = calcMatchupPatternEdge(db, oppDB, null, line_td, null, statsCache);
        score += patTD;
        reasons.push(...patReasons);
        // Similar-opponent backtest for TD
        const simMatchesTD = findSimilarOpponentFights(db, oppDB, 0.45, 5);
        const simWithTD = simMatchesTD.filter(m => m.fightResult.td != null);
        if (simWithTD.length >= 2) {
            const simAvgTD = simWithTD.reduce((s, m) => s + (m.fightResult.td || 0), 0) / simWithTD.length;
            const simDiff = simAvgTD - line_td;
            const avgSim = simMatchesTD.reduce((s, m) => s + m.similarity, 0) / simMatchesTD.length;
            const simW = Math.min(1.0, avgSim * 1.3);
            if (simDiff > 2) {
                score += 1.0 * simW;
                reasons.push({ icon: 'pos', text: `vs similar opps (${simWithTD.length} fights): avg ${simAvgTD.toFixed(1)} TDs — ${simDiff.toFixed(1)} above line` });
            }
            else if (simDiff > 0.8) {
                score += 0.5 * simW;
                reasons.push({ icon: 'pos', text: `vs similar opps (${simWithTD.length} fights): avg ${simAvgTD.toFixed(1)} TDs edges line` });
            }
            else if (simDiff < -2) {
                score -= 1.0 * simW;
                reasons.push({ icon: 'neg', text: `vs similar opps (${simWithTD.length} fights): avg ${simAvgTD.toFixed(1)} TDs — ${Math.abs(simDiff).toFixed(1)} below line` });
            }
            else if (simDiff < -0.8) {
                score -= 0.5 * simW;
                reasons.push({ icon: 'neg', text: `vs similar opps (${simWithTD.length} fights): avg ${simAvgTD.toFixed(1)} TDs trails line` });
            }
        }
    }
    if (dkLine != null && dkLine !== line_td && Math.abs(dkLine - line_td) >= 1) {
        if (dkLine < line_td) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `DK Sportsbook sets TD at ${dkLine} vs fantasy book ${line_td} — sharp line implies fewer takedowns` });
        }
        else {
            score += 0.7;
            reasons.push({ icon: 'pos', text: `DK Sportsbook sets TD at ${dkLine} vs fantasy book ${line_td} — sharp line implies more takedowns` });
        }
    }
    let lean, conf;
    if (score >= 3) {
        lean = 'over';
        conf = Math.min(90, 68 + score * 4);
    }
    else if (score >= 1.5) {
        lean = 'over';
        conf = Math.min(74, 56 + score * 5);
    }
    else if (score >= 0.5) {
        lean = 'over';
        conf = 54;
    }
    else if (score <= -3) {
        lean = 'under';
        conf = Math.min(90, 68 + Math.abs(score) * 4);
    }
    else if (score <= -1.5) {
        lean = 'under';
        conf = Math.min(74, 56 + Math.abs(score) * 5);
    }
    else if (score <= -0.5) {
        lean = 'under';
        conf = 54;
    }
    else {
        lean = 'push';
        conf = 50;
    }
    const memoryAdjustment = applyConfidenceMemoryAdjustment({
        fighterName: name,
        source: 'td',
        lean,
        baseConfidence: conf,
        score,
        db,
        avgValue: avgTD,
        line: line_td,
        selectedLine: line_td,
        availableLines: availableLines.length ? availableLines : [line_td],
        oppDB,
        moneyline,
    });
    conf = memoryAdjustment.confidence;
    if (memoryAdjustment.note) {
        reasons.push({ icon: memoryAdjustment.delta > 0 ? 'pos' : 'neg', text: memoryAdjustment.note });
    }
    const tdVerdict = projTD != null ? `proj ${projTD.toFixed(1)}` : `avg ${avgTD.toFixed(1)}`;
    const verdict = lean === 'over'
        ? `TD OVER ${line_td} (${tdVerdict}) — ${reasons[0]?.text}`
        : lean === 'under'
            ? `TD UNDER ${line_td} (${tdVerdict}) — ${reasons[0]?.text}`
            : `TD NO LEAN at ${line_td} (${tdVerdict})`;
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: getConfidenceGrade(Math.round(conf)),
        memoryDelta: memoryAdjustment.delta,
        memoryNote: memoryAdjustment.note,
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        avg: effectiveTD,
        line: line_td,
        type: 'td'
    };
}
function calcFTLean(name, db, line_ft, oppDB, dkLine, availableLines = [], moneyline = null) {
    if (!line_ft || !db || !db.loaded)
        return null;
    const history = (db.history || []).filter(h => Number.isFinite(Number(h.timeSecs)) && Number(h.timeSecs) > 0);
    if (history.length < 3)
        return null;
    const mins = history.map(h => (Number(h.timeSecs) / 60));
    const avgFT = mins.reduce((s, v) => s + v, 0) / mins.length;
    const reasons = [];
    let score = 0;
    const diff = avgFT - line_ft;
    if (diff > 2.0) {
        score += 2.4;
        reasons.push({ icon: 'pos', text: `Avg fight time (${avgFT.toFixed(1)}m) is ${diff.toFixed(1)}m above line` });
    }
    else if (diff > 1.0) {
        score += 1.4;
        reasons.push({ icon: 'pos', text: `Avg fight time (${avgFT.toFixed(1)}m) edges line by ${diff.toFixed(1)}m` });
    }
    else if (diff > 0.4) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Avg fight time (${avgFT.toFixed(1)}m) slightly above line` });
    }
    else if (diff < -2.0) {
        score -= 2.4;
        reasons.push({ icon: 'neg', text: `Avg fight time (${avgFT.toFixed(1)}m) is ${Math.abs(diff).toFixed(1)}m below line` });
    }
    else if (diff < -1.0) {
        score -= 1.4;
        reasons.push({ icon: 'neg', text: `Avg fight time (${avgFT.toFixed(1)}m) trails line by ${Math.abs(diff).toFixed(1)}m` });
    }
    else if (diff < -0.4) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Avg fight time (${avgFT.toFixed(1)}m) slightly below line` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Avg fight time (${avgFT.toFixed(1)}m) near line — toss-up` });
    }
    const hits = mins.filter(v => v > line_ft).length;
    const rate = hits / mins.length;
    if (rate >= 0.75) {
        score += 1.6;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${mins.length} fights (${Math.round(rate * 100)}%) over fight-time line` });
    }
    else if (rate >= 0.6) {
        score += 0.9;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${mins.length} fights over line` });
    }
    else if (rate <= 0.25) {
        score -= 1.6;
        reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${mins.length} fights (${Math.round(rate * 100)}%) over line` });
    }
    else if (rate <= 0.4) {
        score -= 0.9;
        reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${mins.length} fights over line — under tendency` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${mins.length} fights over line — near 50/50` });
    }
    if (db.finishRate != null) {
        if (db.finishRate > 0.65) {
            score -= 0.8;
            reasons.push({ icon: 'neg', text: `High finish profile (${Math.round(db.finishRate * 100)}%) can cap fight duration` });
        }
        else if (db.finishRate < 0.35) {
            score += 0.6;
            reasons.push({ icon: 'pos', text: `Decision-heavy profile supports longer fight time` });
        }
    }
    if (db.fiveRoundRate != null && db.fiveRoundRate > 0.3) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Frequent 4-5 round sample profile increases duration upside` });
    }
    if (oppDB?.loaded && oppDB.finishRate != null && oppDB.finishRate > 0.65) {
        score -= 0.4;
        reasons.push({ icon: 'neg', text: `Opponent finish profile increases early-stoppage risk` });
    }
    // KO/TKO loss vulnerability — chin exposure shortens fights
    const allHist = db.history || [];
    const lossesWithMethod = allHist.filter(h => h.result === 'loss' && h.method);
    if (lossesWithMethod.length >= 2) {
        const koLosses = lossesWithMethod.filter(h => /KO|TKO/i.test(h.method || '')).length;
        if (koLosses >= Math.ceil(lossesWithMethod.length * 0.5)) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `KO/TKO stoppage vulnerability (${koLosses}/${lossesWithMethod.length} losses by stoppage) — opponent may end it early` });
        }
    }
    // Opponent KO threat compounds the chin concern
    if (oppDB?.loaded && oppDB.finishRate != null && oppDB.finishRate > 0.5) {
        const oppAllHist = oppDB.history || [];
        const oppWinsWithMethod = oppAllHist.filter(h => h.result === 'win' && h.method);
        if (oppWinsWithMethod.length >= 3) {
            const oppKOWins = oppWinsWithMethod.filter(h => /KO|TKO/i.test(h.method || '')).length;
            if (oppKOWins / oppWinsWithMethod.length >= 0.4) {
                score -= 0.5;
                reasons.push({ icon: 'neg', text: `Opponent finishes ${oppKOWins}/${oppWinsWithMethod.length} wins by KO/TKO — high early-stoppage threat` });
            }
        }
    }
    if (dkLine != null && dkLine !== line_ft && Math.abs(dkLine - line_ft) >= 0.5) {
        if (dkLine < line_ft) {
            score -= 0.7;
            reasons.push({ icon: 'neg', text: `DK Sportsbook sets FT at ${dkLine}m vs fantasy book ${line_ft}m — sharp line implies shorter fight` });
        }
        else {
            score += 0.7;
            reasons.push({ icon: 'pos', text: `DK Sportsbook sets FT at ${dkLine}m vs fantasy book ${line_ft}m — sharp line implies longer fight` });
        }
    }
    let lean, conf;
    if (score >= 3) {
        lean = 'over';
        conf = Math.min(89, 68 + score * 4);
    }
    else if (score >= 1.5) {
        lean = 'over';
        conf = Math.min(74, 56 + score * 5);
    }
    else if (score >= 0.5) {
        lean = 'over';
        conf = 54;
    }
    else if (score <= -3) {
        lean = 'under';
        conf = Math.min(89, 68 + Math.abs(score) * 4);
    }
    else if (score <= -1.5) {
        lean = 'under';
        conf = Math.min(74, 56 + Math.abs(score) * 5);
    }
    else if (score <= -0.5) {
        lean = 'under';
        conf = 54;
    }
    else {
        lean = 'push';
        conf = 50;
    }
    const memoryAdjustment = applyConfidenceMemoryAdjustment({
        fighterName: name,
        source: 'ft',
        lean,
        baseConfidence: conf,
        score,
        db,
        avgValue: avgFT,
        line: line_ft,
        selectedLine: line_ft,
        availableLines: availableLines.length ? availableLines : [line_ft],
        oppDB,
        moneyline,
    });
    conf = memoryAdjustment.confidence;
    if (memoryAdjustment.note) {
        reasons.push({ icon: memoryAdjustment.delta > 0 ? 'pos' : 'neg', text: memoryAdjustment.note });
    }
    const verdict = lean === 'over'
        ? `FT OVER ${line_ft}m (avg ${avgFT.toFixed(1)}m) — ${reasons[0]?.text}`
        : lean === 'under'
            ? `FT UNDER ${line_ft}m (avg ${avgFT.toFixed(1)}m) — ${reasons[0]?.text}`
            : `FT NO LEAN at ${line_ft}m (avg ${avgFT.toFixed(1)}m)`;
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: getConfidenceGrade(Math.round(conf)),
        memoryDelta: memoryAdjustment.delta,
        memoryNote: memoryAdjustment.note,
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        avg: avgFT,
        line: line_ft,
        type: 'ft'
    };
}
function calcCTRLLean(name, db, line_ctrl, // minutes
oppDB, dkLine, availableLines = [], moneyline = null, underAvailable = null) {
    if (!line_ctrl || !db || !db.loaded)
        return null;
    const history = (db.history || []).filter(h => Number.isFinite(Number(h.ctrlSecs)));
    if (history.length < 3)
        return null;
    const ctrlMinsSamples = history.map(h => Number(h.ctrlSecs) / 60);
    const avgCTRL = ctrlMinsSamples.reduce((s, v) => s + v, 0) / ctrlMinsSamples.length;
    const reasons = [];
    let score = 0;
    const diff = avgCTRL - line_ctrl;
    if (diff > 1.5) {
        score += 2.4;
        reasons.push({ icon: 'pos', text: `Avg control (${avgCTRL.toFixed(1)}m) is ${diff.toFixed(1)}m above line` });
    }
    else if (diff > 0.8) {
        score += 1.4;
        reasons.push({ icon: 'pos', text: `Avg control (${avgCTRL.toFixed(1)}m) edges line by ${diff.toFixed(1)}m` });
    }
    else if (diff > 0.3) {
        score += 0.5;
        reasons.push({ icon: 'pos', text: `Avg control (${avgCTRL.toFixed(1)}m) slightly above line` });
    }
    else if (diff < -1.5) {
        score -= 2.4;
        reasons.push({ icon: 'neg', text: `Avg control (${avgCTRL.toFixed(1)}m) is ${Math.abs(diff).toFixed(1)}m below line` });
    }
    else if (diff < -0.8) {
        score -= 1.4;
        reasons.push({ icon: 'neg', text: `Avg control (${avgCTRL.toFixed(1)}m) trails line by ${Math.abs(diff).toFixed(1)}m` });
    }
    else if (diff < -0.3) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Avg control (${avgCTRL.toFixed(1)}m) slightly below line` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Avg control (${avgCTRL.toFixed(1)}m) near line — toss-up` });
    }
    const hits = ctrlMinsSamples.filter(v => v > line_ctrl).length;
    const rate = hits / ctrlMinsSamples.length;
    if (rate >= 0.75) {
        score += 1.6;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${ctrlMinsSamples.length} fights (${Math.round(rate * 100)}%) over control line` });
    }
    else if (rate >= 0.6) {
        score += 0.9;
        reasons.push({ icon: 'pos', text: `Hit rate: ${hits}/${ctrlMinsSamples.length} fights over line` });
    }
    else if (rate <= 0.25) {
        score -= 1.6;
        reasons.push({ icon: 'neg', text: `Hit rate: only ${hits}/${ctrlMinsSamples.length} fights (${Math.round(rate * 100)}%) over line` });
    }
    else if (rate <= 0.4) {
        score -= 0.9;
        reasons.push({ icon: 'neg', text: `Hit rate: ${hits}/${ctrlMinsSamples.length} fights over line — under tendency` });
    }
    else {
        reasons.push({ icon: 'neu', text: `Hit rate: ${hits}/${ctrlMinsSamples.length} fights over line — near 50/50` });
    }
    // Style profile: grappler pushes CTRL up, striker pushes it down.
    if (db.style === 'grappler') {
        score += 0.7;
        reasons.push({ icon: 'pos', text: `Grappler profile supports sustained top control` });
    }
    else if (db.style === 'striker') {
        score -= 0.7;
        reasons.push({ icon: 'neg', text: `Striker profile rarely posts large control windows` });
    }
    // Takedown volume correlates strongly with CTRL potential.
    const tdAvg = db.avgTDperFight ?? db.avgTD ?? null;
    if (tdAvg != null) {
        if (tdAvg >= 2.5) {
            score += 1.1;
            reasons.push({ icon: 'pos', text: `High TD volume (${tdAvg.toFixed(1)}/fight) fuels control upside` });
        }
        else if (tdAvg >= 1.2) {
            score += 0.4;
            reasons.push({ icon: 'pos', text: `Moderate TD volume (${tdAvg.toFixed(1)}/fight) supports control` });
        }
        else if (tdAvg < 0.4) {
            score -= 1.0;
            reasons.push({ icon: 'neg', text: `Low TD volume (${tdAvg.toFixed(1)}/fight) caps control ceiling` });
        }
    }
    // Opponent TD defense dampens control potential.
    if (oppDB?.loaded && oppDB.tdDef != null) {
        if (oppDB.tdDef >= 75) {
            score -= 1.1;
            reasons.push({ icon: 'neg', text: `Opponent TD defense ${oppDB.tdDef}% suppresses ground control` });
        }
        else if (oppDB.tdDef <= 45) {
            score += 0.8;
            reasons.push({ icon: 'pos', text: `Opponent TD defense only ${oppDB.tdDef}% — favorable for control accumulation` });
        }
    }
    // Opponent wrestling pressure (their own TD output) means fighter may be on bottom
    const oppTdAvg = oppDB?.avgTDperFight ?? oppDB?.avgTD ?? null;
    if (oppDB?.loaded && oppTdAvg != null && oppTdAvg >= 2.2) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `Opponent also wrestles (${oppTdAvg.toFixed(1)} TD/fight) — fighter may lose scramble battles` });
    }
    // Early finisher caps control time.
    if (db.finishRate != null && db.finishRate > 0.65) {
        score -= 0.5;
        reasons.push({ icon: 'neg', text: `High finish profile (${Math.round(db.finishRate * 100)}%) can end fight before control accumulates` });
    }
    if (dkLine != null && dkLine !== line_ctrl && Math.abs(dkLine - line_ctrl) >= 0.3) {
        if (dkLine < line_ctrl) {
            score -= 0.6;
            reasons.push({ icon: 'neg', text: `DK Sportsbook sets control at ${dkLine}m vs fantasy book ${line_ctrl}m — sharp line implies less control` });
        }
        else {
            score += 0.6;
            reasons.push({ icon: 'pos', text: `DK Sportsbook sets control at ${dkLine}m vs fantasy book ${line_ctrl}m — sharp line implies more control` });
        }
    }
    let lean, conf;
    if (score >= 3) {
        lean = 'over';
        conf = Math.min(89, 68 + score * 4);
    }
    else if (score >= 1.5) {
        lean = 'over';
        conf = Math.min(74, 56 + score * 5);
    }
    else if (score >= 0.5) {
        lean = 'over';
        conf = 54;
    }
    else if (score <= -3) {
        lean = 'under';
        conf = Math.min(89, 68 + Math.abs(score) * 4);
    }
    else if (score <= -1.5) {
        lean = 'under';
        conf = Math.min(74, 56 + Math.abs(score) * 5);
    }
    else if (score <= -0.5) {
        lean = 'under';
        conf = 54;
    }
    else {
        lean = 'push';
        conf = 50;
    }
    // Pick6 doesn't always offer the Less/UNDER side for CTRL. When the scraper
    // confirmed Less is missing for this fighter, suppress UNDER recommendations
    // entirely — they're unplaceable. See project_pickem_platform_rules memory.
    if (lean === 'under' && underAvailable === false) {
        reasons.push({ icon: 'neu', text: 'Pick6 does not offer UNDER on this CTRL line — suppressing lean (unplaceable).' });
        lean = 'push';
        conf = 50;
    }
    const memoryAdjustment = applyConfidenceMemoryAdjustment({
        fighterName: name,
        source: 'ctrl',
        lean,
        baseConfidence: conf,
        score,
        db,
        avgValue: avgCTRL,
        line: line_ctrl,
        selectedLine: line_ctrl,
        availableLines: availableLines.length ? availableLines : [line_ctrl],
        oppDB,
        moneyline,
    });
    conf = memoryAdjustment.confidence;
    if (memoryAdjustment.note) {
        reasons.push({ icon: memoryAdjustment.delta > 0 ? 'pos' : 'neg', text: memoryAdjustment.note });
    }
    const verdict = lean === 'over'
        ? `CTRL OVER ${line_ctrl}m (avg ${avgCTRL.toFixed(1)}m) — ${reasons[0]?.text}`
        : lean === 'under'
            ? `CTRL UNDER ${line_ctrl}m (avg ${avgCTRL.toFixed(1)}m) — ${reasons[0]?.text}`
            : `CTRL NO LEAN at ${line_ctrl}m (avg ${avgCTRL.toFixed(1)}m)`;
    return {
        lean,
        conf: Math.round(conf),
        confidenceGrade: getConfidenceGrade(Math.round(conf)),
        memoryDelta: memoryAdjustment.delta,
        memoryNote: memoryAdjustment.note,
        score: parseFloat(score.toFixed(2)),
        reasons,
        verdict,
        avg: avgCTRL,
        line: line_ctrl,
        type: 'ctrl'
    };
}
// ── RENDER UTILITIES ──────────────────────────────────────────────────────
function activePlatformLine(f) {
    return getSourceActiveLine(f, 'fp');
}
function activePlatformLabel(f) {
    return formatSourcePlatformLabel(f, 'fp');
    if (currentPlatform === 'pick6' && f.line_p6 != null)
        return `Pick6 ${f.line_p6}`;
    if (currentPlatform === 'underdog' && f.line_ud != null)
        return `Underdog ${f.line_ud}`;
    if (currentPlatform === 'prizepicks' && f.line_pp != null)
        return `PrizePicks ${f.line_pp}`;
    if (currentPlatform === 'draftkings_sportsbook' && (f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null)) {
        return `DK SS ${f.line_dk_ss ?? '—'} / TD ${f.line_dk_td ?? '—'} / FT ${f.line_dk_ft ?? '—'}`;
    }
    if (f.line_betr != null)
        return `Betr ${f.line_betr}`;
    if (f.line_pp != null)
        return `PrizePicks ${f.line_pp}`;
    if (f.line_p6 != null)
        return `Pick6 ${f.line_p6}`;
    if (f.line_ud != null)
        return `Underdog ${f.line_ud}`;
    if (f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null)
        return `DK SS ${f.line_dk_ss ?? '—'} / TD ${f.line_dk_td ?? '—'} / FT ${f.line_dk_ft ?? '—'}`;
    return '—';
}
function activePlatformAvgFP(db) {
    if (currentPlatform === 'pick6')
        return db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
    if (currentPlatform === 'underdog')
        return db.avgFP_ud ?? db.avgFP_p6 ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
    if (currentPlatform === 'prizepicks')
        return db.avgFP_pp ?? db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_betr ?? db.avgFP ?? null;
    if (currentPlatform === 'draftkings_sportsbook')
        return db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP_betr ?? db.avgFP ?? null;
    return db.avgFP_betr ?? db.avgFP_p6 ?? db.avgFP_ud ?? db.avgFP_pp ?? db.avgFP ?? null;
}
function ensureLineLeans() {
    // Assign percentile-based leans for fighters without stats
    const fightersWithLines = allFighters.filter(f => activePlatformLine(f) != null);
    if (fightersWithLines.length < 4)
        return; // Need minimum for percentiles
    const lines = fightersWithLines.map(f => activePlatformLine(f)).sort((a, b) => a - b);
    const overThreshold = lines[Math.floor(lines.length * 0.75)]; // Top 25%
    const underThreshold = lines[Math.floor(lines.length * 0.25)]; // Bottom 25%
    fightersWithLines.forEach(f => {
        if (f.lean?.lean && f.lean.lean !== 'none')
            return; // Already has a lean
        const line = activePlatformLine(f);
        if (!line)
            return;
        let lean = 'push';
        let conf = 50;
        const reasons = [];
        if (line >= overThreshold) {
            lean = 'over';
            conf = 60;
            reasons.push({ icon: 'pos', text: `Line in top 25% of all fighters — percentile-based over lean` });
        }
        else if (line <= underThreshold) {
            lean = 'under';
            conf = 60;
            reasons.push({ icon: 'neg', text: `Line in bottom 25% of all fighters — percentile-based under lean` });
        }
        else {
            reasons.push({ icon: 'neu', text: `Line in middle 50% — no strong percentile lean` });
        }
        const verdict = lean === 'over' ? `PERCENTILE OVER ${line} — top quartile line` :
            lean === 'under' ? `PERCENTILE UNDER ${line} — bottom quartile line` :
                `NO PERCENTILE LEAN at ${line}`;
        f.lean = { lean, conf, reasons, verdict };
    });
}
function _computeEffectiveLean(f) {
    // Sub-leans are pre-adjusted by applyWeightMissToFighter during primeCaches,
    // so this just picks priority and tags with _source/_label.
    if (f.lean?.lean && f.lean.lean !== 'none')
        return { ...f.lean, _source: 'fp', _label: '' };
    if (f.lean_ss?.lean && f.lean_ss.lean !== 'none' && f.lean_ss.lean !== 'push')
        return { ...f.lean_ss, _source: 'ss', _label: ' (SS)' };
    if (f.lean_td?.lean && f.lean_td.lean !== 'none' && f.lean_td.lean !== 'push')
        return { ...f.lean_td, _source: 'td', _label: ' (TD)' };
    if (f.lean_ft?.lean && f.lean_ft.lean !== 'none' && f.lean_ft.lean !== 'push')
        return { ...f.lean_ft, _source: 'ft', _label: ' (FT)' };
    if (f.lean_ss_r1?.lean && f.lean_ss_r1.lean !== 'none' && f.lean_ss_r1.lean !== 'push')
        return { ...f.lean_ss_r1, _source: 'ss_r1', _label: ' (R1 SS)' };
    return { ...(f.lean || { lean: 'none', conf: 0, reasons: [], verdict: '' }), _source: 'fp', _label: '' };
}
// Severity-tiered weight-miss treatment:
//   small (<1lb)     drained, no upside           → clear UNDER nudge
//   moderate (1-2lb) drained, mild cardio risk    → mild UNDER nudge
//   big (2-5lb)      MIXED: size advantage + cardio risk
//                      → grappler on TD/CTRL gets OVER (size wins exchanges)
//                      → striker/balanced gets UNDER (cardio dominates)
//   extreme (5+lb)   major cut failure           → strong UNDER (with grappler-on-TD nuance)
//   unknown amount   conservative moderate UNDER nudge
// Opponent-style amplification: when opp pace (slpm+sapm) ≥ 8.5, cardio drain
// hits harder — multiply negative deltas by 1.2 (positive size-advantage signals
// in the grappler-on-TD branches are not amplified).
function _computeWeightMissDeltas(sig, source, isGrappler, oppPaceHigh, oppPaceTotal, lbsLabel) {
    const reasonsToPrepend = [];
    let confDelta = 0;
    let avgDelta = 0;
    switch (sig.severity) {
        case 'small':
            reasonsToPrepend.push({ icon: 'neg', text: `Missed weight by ${lbsLabel} — completed cut, drained, no size upside` });
            confDelta = -10;
            avgDelta = source === 'fp' ? -8 : source === 'ss' ? -7 : source === 'ss_r1' ? -3.5 : source === 'ft' ? -1.5 : source === 'td' ? -0.3 : 0;
            break;
        case 'moderate':
            reasonsToPrepend.push({ icon: 'neg', text: `Missed weight by ${lbsLabel} — failed cut, mild cardio risk` });
            confDelta = -7;
            avgDelta = source === 'fp' ? -5 : source === 'ss' ? -4 : source === 'ss_r1' ? -2 : source === 'ft' ? -1.0 : source === 'td' ? -0.2 : 0;
            break;
        case 'big':
            if (isGrappler && (source === 'td' || source === 'ctrl')) {
                reasonsToPrepend.push({ icon: 'pos', text: `Missed weight by ${lbsLabel} — likely size/control advantage in grappling exchanges` });
                reasonsToPrepend.push({ icon: 'neg', text: `Big miss also signals possible cardio fade in later rounds` });
                confDelta = +5;
                avgDelta = source === 'td' ? +0.5 : +25;
            }
            else if (isGrappler) {
                reasonsToPrepend.push({ icon: 'pos', text: `Missed weight by ${lbsLabel} — possible size edge` });
                reasonsToPrepend.push({ icon: 'neg', text: `Big miss also signals cardio risk` });
                confDelta = -3;
                avgDelta = source === 'fp' ? -3 : source === 'ss' ? -3 : source === 'ss_r1' ? -1.5 : 0;
            }
            else {
                reasonsToPrepend.push({ icon: 'neg', text: `Missed weight by ${lbsLabel} — failed cut + cardio collapse risk` });
                confDelta = -8;
                avgDelta = source === 'fp' ? -7 : source === 'ss' ? -6 : source === 'ss_r1' ? -3 : source === 'ft' ? -1.2 : 0;
            }
            break;
        case 'extreme':
            if (isGrappler && (source === 'td' || source === 'ctrl')) {
                reasonsToPrepend.push({ icon: 'pos', text: `Massive miss (${lbsLabel}) — major size advantage but extreme cardio risk` });
                confDelta = -3;
                avgDelta = source === 'td' ? +0.3 : +15;
            }
            else {
                reasonsToPrepend.push({ icon: 'neg', text: `Massive miss (${lbsLabel}) — major cut failure, severe cardio + prep red flag` });
                confDelta = -15;
                avgDelta = source === 'fp' ? -12 : source === 'ss' ? -10 : source === 'ss_r1' ? -5 : source === 'ft' ? -2.0 : source === 'td' ? -0.5 : 0;
            }
            break;
        case 'unknown':
            reasonsToPrepend.push({ icon: 'neg', text: `Missed weight (amount unconfirmed) — likely failed cut, conservative UNDER nudge` });
            confDelta = -5;
            avgDelta = source === 'fp' ? -4 : source === 'ss' ? -3 : source === 'ss_r1' ? -1.5 : source === 'ft' ? -0.7 : 0;
            break;
    }
    let ampReason = null;
    if (oppPaceHigh && confDelta < 0) {
        confDelta = Math.round(confDelta * 1.2);
        if (avgDelta < 0)
            avgDelta = avgDelta * 1.2;
        ampReason = {
            icon: 'neg',
            text: `High-pace opponent (${oppPaceTotal.toFixed(1)} SLpM+SApM) amplifies cardio drain risk`,
        };
    }
    return { confDelta, avgDelta, reasonsToPrepend, ampReason };
}
function _formatLbsLabel(sig) {
    return sig.lbsOver != null
        ? `${sig.lbsOver % 1 === 0 ? sig.lbsOver : sig.lbsOver.toFixed(1)} lb`
        : 'unknown amount';
}
function _getOppPace(fighter) {
    const oppName = fighter.opponent;
    if (!oppName)
        return { oppPaceHigh: false, oppPaceTotal: 0 };
    const oppNorm = (normalizeName(oppName) || oppName).toLowerCase();
    const opp = _fighterByNorm?.get(oppNorm);
    const slpm = opp?.db?.slpm ?? null;
    const sapm = opp?.db?.sapm ?? null;
    if (slpm == null || sapm == null)
        return { oppPaceHigh: false, oppPaceTotal: 0 };
    const total = slpm + sapm;
    return { oppPaceHigh: total >= 8.5, oppPaceTotal: total };
}
function applyWeightMissToFighter(fighter) {
    const sig = _weightMissSignals.get(fighter.name.toLowerCase());
    const sigKey = sig ? `${sig.severity}:${sig.lbsOver ?? '?'}` : '';
    const isGrappler = fighter.db?.style === 'grappler';
    const { oppPaceHigh, oppPaceTotal } = _getOppPace(fighter);
    const lbsLabel = sig ? _formatLbsLabel(sig) : '';
    const targets = [
        ['lean', 'fp'],
        ['lean_ss', 'ss'],
        ['lean_ss_r1', 'ss_r1'],
        ['lean_td', 'td'],
        ['lean_ft', 'ft'],
        ['lean_ctrl', 'ctrl'],
    ];
    for (const [key, source] of targets) {
        const lean = fighter[key];
        if (!lean)
            continue;
        if (lean._wmKey === sigKey)
            continue;
        if (lean._wmOrig) {
            lean.conf = lean._wmOrig.conf;
            lean.avg = lean._wmOrig.avg;
            lean.lean = lean._wmOrig.lean;
            if (lean.reasons)
                lean.reasons.length = lean._wmOrig.reasonsLen;
            delete lean._wmOrig;
        }
        delete lean._wmKey;
        if (!sig)
            continue;
        if (lean.lean === 'none') {
            lean._wmKey = sigKey;
            continue;
        }
        lean._wmOrig = {
            conf: lean.conf,
            avg: lean.avg,
            lean: lean.lean,
            reasonsLen: lean.reasons?.length ?? 0,
        };
        lean._wmKey = sigKey;
        const { confDelta, avgDelta, reasonsToPrepend, ampReason } = _computeWeightMissDeltas(sig, source, isGrappler, oppPaceHigh, oppPaceTotal, lbsLabel);
        lean.conf = Math.max(0, Math.min(95, lean.conf + confDelta));
        if (lean.avg != null)
            lean.avg = lean.avg + avgDelta;
        if (!lean.reasons)
            lean.reasons = [];
        lean.reasons.unshift(...reasonsToPrepend);
        if (ampReason)
            lean.reasons.push(ampReason);
        if (lean.avg != null && lean.line != null) {
            if (lean.lean === 'over' && lean.avg < lean.line) {
                lean.lean = 'under';
                lean.reasons.push({ icon: 'neg', text: `Adjusted projection ${lean.avg.toFixed(1)} now below line ${lean.line} — lean flipped to UNDER` });
            }
            else if (lean.lean === 'under' && lean.avg > lean.line) {
                lean.lean = 'over';
                lean.reasons.push({ icon: 'pos', text: `Adjusted projection ${lean.avg.toFixed(1)} now above line ${lean.line} — lean flipped to OVER` });
            }
        }
    }
}
function getEffectiveLean(f) {
    return _leanCache?.get(f.name) ?? _computeEffectiveLean(f);
}
// ── PAYOUT-WEIGHTED EV ENGINE ────────────────────────────────────────────────
/** Convert any odds format to profit-per-unit.  Returns null for invalid input. */
function oddsToProfit(odds) {
    if (odds == null || !Number.isFinite(odds))
        return null;
    // American odds (|odds| >= 100)
    if (Math.abs(odds) >= 100)
        return odds < 0 ? 100 / Math.abs(odds) : odds / 100;
    // Payout multiplier (e.g. 0.66x, 1.34x — used by UD and some DK props)
    if (odds > 0)
        return odds;
    return null;
}
/** Compute implied probability from odds (any format). */
function oddsToImpliedProb(odds) {
    const profit = oddsToProfit(odds);
    if (profit == null)
        return null;
    return 1 / (1 + profit);
}
/** Compute vig/overround when both sides' odds are available.
 *  Returns the vig as percentage points above 100% (e.g. 4.5 means 4.5% juice). */
function computeVig(overOdds, underOdds) {
    const overProb = oddsToImpliedProb(overOdds);
    const underProb = oddsToImpliedProb(underOdds);
    if (overProb == null || underProb == null)
        return null;
    const overround = (overProb + underProb - 1) * 100;
    return parseFloat(overround.toFixed(1));
}
function computeFighterEV(f, el) {
    return computeDetailedEV(f, el)?.ev ?? null;
}
function computeDetailedEV(f, el) {
    if (el.lean !== 'over' && el.lean !== 'under')
        return null;
    const winProb = (el.conf || 0) / 100;
    if (winProb <= 0)
        return null;
    const isOver = el.lean === 'over';
    // Try to get actual side odds for the lean direction
    let leanOdds = null;
    let oppOdds = null;
    if (el._source === 'ss') {
        leanOdds = isOver ? (f.ss_over_odds ?? null) : (f.ss_under_odds ?? null);
        oppOdds = isOver ? (f.ss_under_odds ?? null) : (f.ss_over_odds ?? null);
    }
    else if (el._source === 'td') {
        leanOdds = isOver ? (f.td_over_odds ?? null) : (f.td_under_odds ?? null);
        oppOdds = isOver ? (f.td_under_odds ?? null) : (f.td_over_odds ?? null);
    }
    else if (el._source === 'ft') {
        leanOdds = isOver ? (f.ft_over_odds ?? null) : (f.ft_under_odds ?? null);
        oppOdds = isOver ? (f.ft_under_odds ?? null) : (f.ft_over_odds ?? null);
    }
    // else: FP lean — no odds available
    const profit = oddsToProfit(leanOdds);
    if (profit != null) {
        // Real odds available — compute vig from both sides if possible
        const vig = computeVig(isOver ? leanOdds : oppOdds, isOver ? oppOdds : leanOdds);
        const ev = Math.round((winProb * profit - (1 - winProb)) * 100);
        return { ev, isAssumedVig: false, vig, profit };
    }
    // No real odds — use assumed -110 standard vig (breakeven 52.38%)
    const ASSUMED_PROFIT = 100 / 110; // 0.909
    const ev = Math.round((winProb * ASSUMED_PROFIT - (1 - winProb)) * 100);
    return { ev, isAssumedVig: true, vig: null, profit: ASSUMED_PROFIT };
}
function computePerBookEV(f, el) {
    if (el.lean !== 'over' && el.lean !== 'under')
        return [];
    const winProb = (el.conf || 0) / 100;
    if (winProb <= 0)
        return [];
    const isOver = el.lean === 'over';
    const pairs = [];
    if (el._source === 'ss') {
        if (f.ss_over_odds != null || f.ss_under_odds != null) {
            pairs.push({
                source: 'DK',
                leanOdds: isOver ? f.ss_over_odds : f.ss_under_odds,
                oppOdds: isOver ? f.ss_under_odds : f.ss_over_odds,
            });
        }
    }
    else if (el._source === 'td') {
        if (f.td_over_odds != null || f.td_under_odds != null) {
            pairs.push({
                source: 'DK',
                leanOdds: isOver ? f.td_over_odds : f.td_under_odds,
                oppOdds: isOver ? f.td_under_odds : f.td_over_odds,
            });
        }
    }
    else if (el._source === 'ft') {
        if (f.ft_over_odds != null || f.ft_under_odds != null) {
            pairs.push({
                source: 'DK',
                leanOdds: isOver ? f.ft_over_odds : f.ft_under_odds,
                oppOdds: isOver ? f.ft_under_odds : f.ft_over_odds,
            });
        }
    }
    // Future: add UD/PP/BT odds pairs here when scraped
    const results = [];
    for (const p of pairs) {
        const profit = oddsToProfit(p.leanOdds);
        if (profit == null)
            continue;
        const vig = computeVig(isOver ? p.leanOdds : p.oppOdds, isOver ? p.oppOdds : p.leanOdds);
        const ev = Math.round((winProb * profit - (1 - winProb)) * 100);
        results.push({ source: p.source, odds: p.leanOdds, profit, ev, vig, isBest: false });
    }
    results.sort((a, b) => b.ev - a.ev);
    if (results.length > 0)
        results[0].isBest = true;
    return results;
}
/** Returns true when FP drives the lean but SS AND TD both lean the opposite direction — hidden risk. */
function hasCrossStatConflict(f) {
    const eff = getEffectiveLean(f);
    if (eff._source !== 'fp' || !eff.lean || eff.lean === 'none' || eff.lean === 'push')
        return false;
    const opposite = eff.lean === 'over' ? 'under' : 'over';
    const ssOpp = f.lean_ss?.lean === opposite;
    const tdOpp = f.lean_td?.lean === opposite;
    return ssOpp && tdOpp;
}
// Consensus lean: FP + SS + TD all point the same direction with actionable confidence
function hasConsensusLean(f) {
    const eff = getEffectiveLean(f);
    const dir = eff.lean;
    if (!dir || dir === 'none' || dir === 'push')
        return null;
    if ((f.lean_ss?.conf ?? 0) < 55 || (f.lean_td?.conf ?? 0) < 55)
        return null;
    const ssMatch = f.lean_ss?.lean === dir;
    const tdMatch = f.lean_td?.lean === dir;
    return (ssMatch && tdMatch) ? dir : null;
}
function primeCaches() {
    // Build fighter-by-name index FIRST so weight-miss adjustment can look up
    // opponent pace via _fighterByNorm before we compute leans.
    _fighterByNorm = new Map();
    for (const f of allFighters) {
        const norm = (normalizeName(f.name) || f.name).toLowerCase();
        _fighterByNorm.set(norm, f);
    }
    // Apply weight-miss adjustments to all sub-leans (mutates in place; idempotent).
    for (const f of allFighters)
        applyWeightMissToFighter(f);
    // Compute effective leans now that sub-leans are adjusted.
    _leanCache = new Map();
    for (const f of allFighters) {
        _leanCache.set(f.name, _computeEffectiveLean(f));
    }
}
// Reorder fighters so they appear in UFCStats card order with each fight's two
// fighters adjacent. This is what the fight-group badge logic in renderFighters
// (Math.floor(i / 2) → fightIndex) assumes; without it, fighters end up paired
// by whatever order allFighters happens to be in (typically Pick6/UD scrape
// order) and adjacent rows can be from different fights entirely.
function orderFightersByCard(fighters) {
    if (!upcomingCardPairs.length)
        return fighters;
    const normCache = new Map();
    for (const f of fighters) {
        const n = normalizeName(f.name);
        if (n)
            normCache.set(f, n);
    }
    const findFighter = (cardName) => {
        for (const [f, n] of normCache)
            if (n === cardName)
                return f;
        for (const [f, n] of normCache) {
            if (namesMatch(n, cardName) || strictCardNameMatch(n, cardName))
                return f;
        }
        return undefined;
    };
    const ordered = [];
    const used = new Set();
    for (const cp of upcomingCardPairs) {
        const f1 = findFighter(cp.f1);
        const f2 = findFighter(cp.f2);
        if (f1 && !used.has(f1)) {
            ordered.push(f1);
            used.add(f1);
        }
        if (f2 && !used.has(f2)) {
            ordered.push(f2);
            used.add(f2);
        }
    }
    for (const f of fighters)
        if (!used.has(f))
            ordered.push(f);
    return ordered;
}
function sortFighters(fighters, sortKey) {
    const copy = [...fighters];
    const primarySSLine = (f) => {
        if (currentPlatform === 'pick6')
            return f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? 0;
        if (currentPlatform === 'underdog')
            return f.line_ud_ss ?? f.line_p6_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? 0;
        if (currentPlatform === 'prizepicks')
            return f.line_pp_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_betr_ss ?? 0;
        return f.line_betr_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? 0;
    };
    const primaryFTLine = (f) => {
        if (currentPlatform === 'pick6')
            return f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
        if (currentPlatform === 'underdog')
            return f.line_ud_ft ?? f.line_p6_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
        if (currentPlatform === 'prizepicks')
            return f.line_pp_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? 0;
        if (currentPlatform === 'draftkings_sportsbook')
            return f.line_dk_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? 0;
        return f.line_betr_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_dk_ft ?? 0;
    };
    const ssDelta = (f) => {
        const avg = f.db?.avgSigStr ?? 0;
        const line = primarySSLine(f);
        return avg - line;
    };
    switch (sortKey) {
        case 'line': return copy.sort((a, b) => (activePlatformLine(b) || 0) - (activePlatformLine(a) || 0));
        case 'ssline': return copy.sort((a, b) => primarySSLine(b) - primarySSLine(a));
        case 'ftline': return copy.sort((a, b) => primaryFTLine(b) - primaryFTLine(a));
        case 'avgss': return copy.sort((a, b) => (b.db?.avgSigStr || 0) - (a.db?.avgSigStr || 0));
        case 'delta': return copy.sort((a, b) => ssDelta(b) - ssDelta(a));
        case 'conf': return copy.sort((a, b) => (getEffectiveLean(b).conf || 0) - (getEffectiveLean(a).conf || 0));
        case 'avgfp': return copy.sort((a, b) => (b.db?.avgFP_p6 || 0) - (a.db?.avgFP_p6 || 0));
        case 'floor': return copy.sort((a, b) => (b.db?.fpFloor || 0) - (a.db?.fpFloor || 0));
        case 'ceil': return copy.sort((a, b) => (b.db?.fpCeiling || 0) - (a.db?.fpCeiling || 0));
        case 'consistency': return copy.sort((a, b) => (b.db?.fpConsistency || 0) - (a.db?.fpConsistency || 0));
        default: return copy;
    }
}
async function renderQAPanel() {
    const panel = document.getElementById('qaPanel');
    if (!panel)
        return;
    // Only show on the main fighter-card views — archive/calibration/etc. have their own context.
    const hideForView = currentView === 'archive' || currentView === 'calibration';
    if (!allFighters.length || hideForView) {
        panel.style.display = 'none';
        return;
    }
    const totalFighters = allFighters.length;
    const [linesPayload, manualPayload] = await Promise.all([
        storageGet([...STORAGE_LINE_KEYS]),
        storageGet([STORAGE_BETR_MANUAL_KEY]),
    ]);
    const platformInfo = [
        { key: 'lines_pick6', label: 'P6', capturedAt: 0, ageMin: null, manual: false },
        { key: 'lines_underdog', label: 'UD', capturedAt: 0, ageMin: null, manual: false },
        { key: 'lines_betr', label: 'BT', capturedAt: 0, ageMin: null, manual: true },
        { key: 'lines_prizepicks', label: 'PP', capturedAt: 0, ageMin: null, manual: false },
        { key: 'lines_draftkings_sportsbook', label: 'DK', capturedAt: 0, ageMin: null, manual: false },
    ];
    // Apply the same manual-Betr overlay the main line loader uses — otherwise
    // a fresh manual entry renders as "5h stale" because lines_betr.capturedAt
    // is still the old seed timestamp.
    const manualBetrForOverlay = manualPayload[STORAGE_BETR_MANUAL_KEY];
    if (manualBetrForOverlay?.fighters?.length) {
        const effectiveBetrTs = Number(manualBetrForOverlay.capturedAt) || Date.now();
        const betrRaw = linesPayload['lines_betr'] || {};
        linesPayload['lines_betr'] = { ...betrRaw, capturedAt: effectiveBetrTs };
    }
    for (const p of platformInfo) {
        const val = linesPayload[p.key];
        const ts = Number(val?.capturedAt || 0);
        p.capturedAt = ts;
        p.ageMin = ts > 0 ? Math.floor((Date.now() - ts) / 60000) : null;
    }
    // Co-locate freshness with the top-of-page platform pills (Pick6/UD/Betr/DK/PP).
    const PILL_AGE_IDS = {
        'lines_pick6': 'ageP6',
        'lines_underdog': 'ageUD',
        'lines_betr': 'ageBetr',
        'lines_prizepicks': 'agePP',
        'lines_draftkings_sportsbook': 'ageDK',
    };
    for (const p of platformInfo) {
        const ageEl = document.getElementById(PILL_AGE_IDS[p.key]);
        if (!ageEl)
            continue;
        if (p.ageMin == null) {
            ageEl.textContent = '';
            ageEl.className = 'pill-age';
            ageEl.removeAttribute('title');
            continue;
        }
        const warnAt = p.manual ? 720 : 15;
        const errAt = p.manual ? 1440 : 60;
        const cls = p.ageMin >= errAt ? 'stale' : p.ageMin >= warnAt ? 'aging' : 'fresh';
        const ageLabel = p.ageMin < 1 ? 'now' : p.ageMin < 60 ? `${p.ageMin}m` : `${Math.floor(p.ageMin / 60)}h`;
        ageEl.textContent = ageLabel;
        ageEl.className = `pill-age ${cls}`;
        const staleIntensity = cls === 'stale'
            ? Math.min(1, Math.max(0, (p.ageMin - errAt) / 600))
            : 0;
        ageEl.style.setProperty('--stale-intensity', staleIntensity.toFixed(2));
        ageEl.title = `${p.label} captured ${ageLabel} ago${p.manual ? ' (manual entry — no auto-scrape)' : ''}`;
    }
    const hasPlatformLine = (f, plat) => {
        if (plat === 'lines_pick6')
            return f.line_p6 != null || f.line_p6_ss != null || f.line_p6_td != null || f.line_p6_ft != null;
        if (plat === 'lines_underdog')
            return f.line_ud != null || f.line_ud_ss != null || f.line_ud_td != null || f.line_ud_ft != null;
        if (plat === 'lines_betr')
            return f.line_betr != null || f.line_betr_ss != null || f.line_betr_td != null || f.line_betr_ft != null;
        if (plat === 'lines_prizepicks')
            return f.line_pp != null || f.line_pp_ss != null || f.line_pp_td != null || f.line_pp_ft != null;
        if (plat === 'lines_draftkings_sportsbook')
            return f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null;
        return false;
    };
    const missingByPlatform = new Map();
    for (const p of platformInfo) {
        // Skip platforms with no data at all — staleness will already flag them.
        if (p.ageMin == null)
            continue;
        // DK Sportsbook posts fighter props progressively across the week — partial
        // coverage is expected, not a data issue. Skip it from the missing-lines check.
        if (p.key === 'lines_draftkings_sportsbook')
            continue;
        const missing = allFighters.filter(f => !hasPlatformLine(f, p.key)).length;
        if (missing > 0 && missing < totalFighters)
            missingByPlatform.set(p.label, missing);
    }
    const manualBetr = manualPayload[STORAGE_BETR_MANUAL_KEY];
    const manualRowCount = manualBetr?.fighters?.length || 0;
    const betrPlatformLoaded = platformInfo.find(p => p.key === 'lines_betr')?.ageMin != null;
    const betrManualShort = betrPlatformLoaded && manualRowCount > 0 && manualRowCount < totalFighters;
    const issues = [];
    // Manual platforms (Betr) don't auto-scrape — excluded from the top stale/missing blocker.
    const autoPlatforms = platformInfo.filter(p => !p.manual);
    const staleErr = autoPlatforms.filter(p => p.ageMin == null || p.ageMin >= 60);
    const staleWarn = autoPlatforms.filter(p => p.ageMin != null && p.ageMin >= 15 && p.ageMin < 60);
    if (staleErr.length) {
        const names = staleErr.map(p => p.ageMin == null ? `${p.label} (no data)` : `${p.label} (${p.ageMin}m)`).join(', ');
        const chip = staleErr.length === 1
            ? `${staleErr[0].label} ${staleErr[0].ageMin == null ? 'no data' : 'stale'}`
            : `${staleErr.length} books stale`;
        issues.push({ level: 'err', text: `Platform lines stale/missing: ${names}`, chip });
    }
    if (staleWarn.length) {
        const names = staleWarn.map(p => `${p.label} (${p.ageMin}m)`).join(', ');
        const chip = staleWarn.length === 1
            ? `${staleWarn[0].label} ${staleWarn[0].ageMin}m`
            : `${staleWarn.length} books aging`;
        issues.push({ level: 'warn', text: `Lines aging: ${names} — consider refresh`, chip });
    }
    for (const [label, missing] of missingByPlatform) {
        issues.push({
            level: 'warn',
            text: `${label}: ${missing} of ${totalFighters} fighters without lines`,
            chip: `${label} missing ${missing}`,
        });
    }
    if (betrManualShort) {
        issues.push({
            level: 'err',
            text: `Betr manual entries: ${manualRowCount} of ${totalFighters} — missing ${totalFighters - manualRowCount} rows`,
            chip: `Betr ${manualRowCount}/${totalFighters}`,
        });
    }
    const hasErr = issues.some(i => i.level === 'err');
    const hasWarn = issues.some(i => i.level === 'warn');
    const level = hasErr ? 'err' : hasWarn ? 'warn' : 'ok';
    const chipMode = issues.length > 0 && issues.length <= 3;
    const fetchBtn = document.getElementById('autoScrapeBtn');
    if (fetchBtn) {
        const freshness = staleErr.length > 0 ? 'stale'
            : staleWarn.length > 0 ? 'aging'
                : autoPlatforms.every(p => p.ageMin != null) ? 'fresh'
                    : '';
        if (freshness)
            fetchBtn.setAttribute('data-freshness', freshness);
        else
            fetchBtn.removeAttribute('data-freshness');
    }
    const summary = level === 'ok'
        ? `✓ Ready to pick · all platforms fresh · ${totalFighters} fighters loaded`
        : `${level === 'err' ? '✕' : '⚠'} ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`;
    const chipsHtml = chipMode
        ? `<div class="qa-issue-chips">${issues.map(i => `<span class="qa-issue-chip qa-issue-${i.level}" title="${i.text.replace(/"/g, '&quot;')}">${i.chip}</span>`).join('')}</div>`
        : '';
    const issuesHtml = (!chipMode && issues.length)
        ? `<ul class="qa-issues">${issues.map(i => `<li class="qa-issue-${i.level}">${i.text}</li>`).join('')}</ul>`
        : '';
    panel.className = `qa-panel qa-${level}${(level === 'ok' || chipMode) ? ' qa-compact' : ''}`;
    panel.style.display = '';
    panel.innerHTML = `
    <div class="qa-panel-header">
      <span class="qa-panel-title">Slate Check</span>
    </div>
    <div class="qa-summary">${summary}</div>
    ${chipsHtml}
    ${issuesHtml}
  `;
}
function renderModelHealthWidget() {
    void renderQAPanel();
    const leanPairs = allFighters
        .map(f => ({ f, l: getEffectiveLean(f) }))
        .filter(({ l }) => l.lean !== 'none' && l.conf > 0);
    const leans = leanPairs.map(p => p.l);
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el)
            el.textContent = value;
    };
    const setNum = (id, value) => {
        const el = document.getElementById(id);
        if (el)
            animateNumberText(el, value);
    };
    if (!leans.length) {
        setText('mhHitRate', '--%');
        setText('mhHitTrend', 'Waiting for model data');
        setText('mhTopEdge', '--');
        setText('mhTopEdgeTrend', 'No actionable edges');
        setText('mhCoverage', '0');
        setText('mhCoverageTrend', 'fighters with actionable leans');
        void renderLearningDiagnosticsWidget();
        return;
    }
    const hitProbs = leans
        .map(l => {
        // calibratedProbability (P over) takes precedence; fall back to conf/100 which already
        // represents the model's confidence that the directional lean is correct.
        if (l.calibratedProbability != null) {
            return l.lean === 'under' ? (1 - l.calibratedProbability) : l.calibratedProbability;
        }
        return Number.isFinite(l.conf) ? l.conf / 100 : null;
    })
        .filter((v) => v != null);
    const avgHit = hitProbs.length ? Math.round((hitProbs.reduce((s, v) => s + v, 0) / hitProbs.length) * 100) : 0;
    let topEdge = null;
    for (const { f, l } of leanPairs) {
        const dir = l.lean;
        if (shouldSkipFpSideForFighter(f, l._source, dir, l._platform))
            continue;
        const ev = computeFighterEV(f, l);
        if (ev == null)
            continue;
        if (!topEdge || ev > topEdge.ev) {
            topEdge = { name: f.name, source: l._source, dir, ev };
        }
    }
    setNum('mhHitRate', `${avgHit}%`);
    setText('mhHitTrend', avgHit >= 58 ? 'Calibrated edge stable' : avgHit >= 52 ? 'Moderate model edge' : 'Conservative edge profile');
    if (topEdge) {
        const sign = topEdge.ev >= 0 ? '+' : '';
        setNum('mhTopEdge', `${sign}${topEdge.ev}%`);
        setText('mhTopEdgeTrend', `${topEdge.name} · ${topEdge.source.toUpperCase()}-${topEdge.dir.toUpperCase()}`);
    }
    else {
        setText('mhTopEdge', '--');
        setText('mhTopEdgeTrend', 'No actionable edges');
    }
    setNum('mhCoverage', `${leans.length}`);
    setText('mhCoverageTrend', 'fighters with actionable leans');
    void renderLearningDiagnosticsWidget();
}
async function renderLearningDiagnosticsWidget() {
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el)
            el.textContent = value;
    };
    const hasWidget = !!document.getElementById('learningDiagnosticsWidget');
    if (!hasWidget)
        return;
    // Load data FIRST, then update DOM — avoids "0 resolved" flash on tab switches
    try {
        const archivePayload = await storageGet([STORAGE_PROP_ARCHIVE_KEY]);
        const allRowsRaw = archivePayload[STORAGE_PROP_ARCHIVE_KEY];
        const allRows = Array.isArray(allRowsRaw) ? allRowsRaw : [];
        if (!allRows.length)
            return;
        const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
        const nowTs = Date.now();
        const resolvedRows = allRows.filter((row) => {
            const ts = Date.parse(row.date);
            const line = Number(row.line);
            const result = Number(row.result);
            return Number.isFinite(ts)
                && ts >= londonTs
                && ts <= nowTs
                && Number.isFinite(line)
                && Number.isFinite(result);
        });
        if (!resolvedRows.length) {
            setText('ldResolved', '0 resolved');
            setText('ldCoverage', 'No settled outcomes yet');
            setText('ldMarketAcc', 'SS --% · FP --%');
            setText('ldMarketAccMeta', 'Waiting for resolved results');
            setText('ldPatternWin', 'Top hit tag: --');
            setText('ldPatternMiss', 'Top miss tag: --');
            setText('ldDrilldownTitle', 'No drilldown yet');
            setText('ldDrilldownMeta', 'Need resolved outcomes');
            setText('ldDrilldownBody', 'No settled picks yet.');
            setText('ldFooterSummary', '0 resolved · waiting for settled outcomes');
            return;
        }
        const fighterCount = new Set(resolvedRows
            .map((row) => normalizeName(row.fighter)?.toLowerCase())
            .filter((name) => !!name)).size;
        const eventCount = new Set(resolvedRows
            .map((row) => String(row.event || '').trim())
            .filter((name) => !!name)).size;
        setText('ldResolved', `${resolvedRows.length} resolved`);
        const MIN_CALIBRATION_EVENTS = 6;
        const calibNote = eventCount >= MIN_CALIBRATION_EVENTS
            ? `(archive window)`
            : `(archive window · ${MIN_CALIBRATION_EVENTS - eventCount} more event${MIN_CALIBRATION_EVENTS - eventCount === 1 ? '' : 's'} to unlock calibration)`;
        setText('ldCoverage', `${fighterCount} fighters across ${eventCount} event${eventCount === 1 ? '' : 's'} ${calibNote}`);
        const computeOverRate = (rows) => {
            let hits = 0;
            let total = 0;
            for (const row of rows) {
                const line = Number(row.line);
                const result = Number(row.result);
                if (!Number.isFinite(line) || !Number.isFinite(result) || result === line)
                    continue;
                total += 1;
                if (result > line)
                    hits += 1;
            }
            return { hits, total, pct: total ? Math.round((hits / total) * 100) : null };
        };
        const ssStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'SS'));
        const fpStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'Fantasy' || String(row.propType) === 'Fantasy_PP'));
        const tdStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'TD'));
        const ftStats = computeOverRate(resolvedRows.filter((row) => String(row.propType) === 'FightTime'));
        const ssLabel = ssStats.pct == null ? '--%' : `${ssStats.pct}%`;
        const fpLabel = fpStats.pct == null ? '--%' : `${fpStats.pct}%`;
        const tdLabel = tdStats.pct == null ? '--%' : `${tdStats.pct}%`;
        const ftLabel = ftStats.pct == null ? '--%' : `${ftStats.pct}%`;
        setText('ldMarketAcc', `SS ${ssLabel} · FP ${fpLabel}`);
        const tdFtMeta = [
            tdStats.total ? `TD ${tdLabel} (${tdStats.total})` : null,
            ftStats.total ? `FT ${ftLabel} (${ftStats.total})` : null,
        ].filter(Boolean).join(' · ');
        setText('ldMarketAccMeta', `${ssStats.total} SS samples · ${fpStats.total} FP samples${tdFtMeta ? ' · ' + tdFtMeta : ''}`);
        const memoryProfile = await loadConfidenceMemoryEngine();
        if (memoryProfile.topHit || memoryProfile.topMiss) {
            const topHit = memoryProfile.topHit;
            const topMiss = memoryProfile.topMiss;
            const hitLabel = topHit
                ? `${formatSourceLabel(topHit.source)} ${topHit.lean.toUpperCase()} · ${topHit.tagLabel}`
                : 'Need >=3 settled tagged rows';
            const missLabel = topMiss
                ? `${formatSourceLabel(topMiss.source)} ${topMiss.lean.toUpperCase()} · ${topMiss.tagLabel}`
                : 'Need >=3 settled tagged rows';
            if (topHit) {
                setText('ldPatternWin', `Top hit tag: ${hitLabel} (${Math.round(topHit.hitRate * 100)}% · ${topHit.total} rows)`);
            }
            else {
                setText('ldPatternWin', 'Top hit tag: Need >=3 settled tagged rows');
            }
            if (topMiss) {
                setText('ldPatternMiss', `Top miss tag: ${missLabel} (${Math.round(topMiss.hitRate * 100)}% · ${topMiss.total} rows)`);
            }
            else {
                setText('ldPatternMiss', 'Top miss tag: Need >=3 settled tagged rows');
            }
            if (topHit && topMiss) {
                setText('ldDrilldownTitle', `Lean into ${hitLabel}`);
                setText('ldDrilldownMeta', `Fade ${missLabel}`);
            }
            else if (topHit) {
                setText('ldDrilldownTitle', `Lean into ${hitLabel}`);
                setText('ldDrilldownMeta', 'No clear fade yet');
            }
            else {
                setText('ldDrilldownTitle', 'No clear lean yet');
                setText('ldDrilldownMeta', `Fade ${missLabel}`);
            }
            setText('ldDrilldownBody', `Based on ${memoryProfile.taggedSamples} tagged samples tracked.`);
            const topShort = topHit ? hitLabel : (topMiss ? `fade ${missLabel}` : '--');
            setText('ldFooterSummary', `${resolvedRows.length} resolved · SS ${ssLabel} / FP ${fpLabel} · Top: ${topShort}`);
            return;
        }
        const patternMap = new Map();
        for (const row of resolvedRows) {
            const line = Number(row.line);
            const result = Number(row.result);
            if (!Number.isFinite(line) || !Number.isFinite(result) || result === line)
                continue;
            const platform = String(row.platform || 'unknown').toLowerCase();
            const propType = String(row.propType || 'Unknown');
            const key = `${platform}|${propType}`;
            const bucket = patternMap.get(key) || { platform, propType, overWins: 0, underWins: 0, total: 0 };
            bucket.total += 1;
            if (result > line)
                bucket.overWins += 1;
            if (result < line)
                bucket.underWins += 1;
            patternMap.set(key, bucket);
        }
        const toLabel = (platform, propType, side) => {
            const p = platform && platform !== 'unknown' ? platform.toUpperCase() : 'ALL BOOKS';
            return `${p} ${propType} ${side}`;
        };
        const candidates = [];
        for (const bucket of patternMap.values()) {
            if (bucket.total < 2)
                continue;
            candidates.push({
                label: toLabel(bucket.platform, bucket.propType, 'OVER'),
                wins: bucket.overWins,
                total: bucket.total,
                rate: bucket.overWins / bucket.total,
            });
            candidates.push({
                label: toLabel(bucket.platform, bucket.propType, 'UNDER'),
                wins: bucket.underWins,
                total: bucket.total,
                rate: bucket.underWins / bucket.total,
            });
        }
        if (!candidates.length) {
            setText('ldPatternWin', 'Top hit tag: Need >=2 settled rows per tag');
            setText('ldPatternMiss', 'Top miss tag: Need >=2 settled rows per tag');
            setText('ldDrilldownTitle', 'Not enough pattern samples yet');
            setText('ldDrilldownMeta', `${resolvedRows.length} resolved rows captured`);
            setText('ldDrilldownBody', 'Keep grading events to unlock stronger tag diagnostics.');
            setText('ldFooterSummary', `${resolvedRows.length} resolved · SS ${ssLabel} / FP ${fpLabel} · keep grading to unlock patterns`);
            return;
        }
        const topHit = [...candidates].sort((a, b) => b.rate - a.rate || b.total - a.total)[0];
        const topMiss = [...candidates].sort((a, b) => a.rate - b.rate || b.total - a.total)[0];
        const hitPct = Math.round(topHit.rate * 100);
        const missPct = Math.round(topMiss.rate * 100);
        setText('ldPatternWin', `Top hit tag: ${topHit.label} (${hitPct}% · ${topHit.wins}/${topHit.total})`);
        setText('ldPatternMiss', `Top miss tag: ${topMiss.label} (${missPct}% · ${topMiss.wins}/${topMiss.total})`);
        setText('ldDrilldownTitle', `Lean into ${topHit.label}`);
        setText('ldDrilldownMeta', `Fade ${topMiss.label}`);
        setText('ldDrilldownBody', missPct <= 45
            ? `${topMiss.label} hits only ${missPct}% on ${topMiss.total} rows — strong fade.`
            : `${topMiss.label} hits ${missPct}% on ${topMiss.total} rows — soft fade.`);
        setText('ldFooterSummary', `${resolvedRows.length} resolved · SS ${ssLabel} / FP ${fpLabel} · Top: ${topHit.label}`);
    }
    catch (e) {
        debugLog(`learning diagnostics render failed: ${e.message}`);
    }
}
function normalizeArchivePlatformLabel(label) {
    const lower = label.trim().toLowerCase();
    if (!lower || lower === '—')
        return null;
    if (lower.startsWith('pick6'))
        return 'pick6';
    if (lower.startsWith('underdog'))
        return 'underdog';
    if (lower.startsWith('prizepicks'))
        return 'prizepicks';
    if (lower.startsWith('betr'))
        return 'betr';
    if (lower.startsWith('dk'))
        return 'draftkings_sportsbook';
    return null;
}
function renderBestPicks(container, renderSeq = 0) {
    return (async () => {
        const mySeq = renderSeq;
        if (!allFighters.length) {
            container.innerHTML = '<div class="inline-empty-msg">No fighter data loaded yet</div>';
            renderModelHealthWidget();
            return;
        }
        const visibleFighters = applySourceVisibilityFilter(allFighters);
        if (!visibleFighters.length) {
            container.innerHTML = '<div class="inline-empty-msg">No fighters match selected source filters</div>';
            renderModelHealthWidget();
            return;
        }
        const archivePayload = await storageGet([STORAGE_PROP_ARCHIVE_KEY]);
        if (mySeq !== bestPicksRenderSeq)
            return; // a newer render started while we awaited storage — bail
        const archiveRowsRaw = archivePayload[STORAGE_PROP_ARCHIVE_KEY];
        const archiveRows = Array.isArray(archiveRowsRaw) ? archiveRowsRaw : [];
        const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
        const roster = new Set(visibleFighters
            .map((f) => normalizeName(f.name)?.toLowerCase())
            .filter((name) => !!name));
        const recentResolvedRows = archiveRows.filter((row) => {
            const fighter = normalizeName(row.fighter)?.toLowerCase();
            const ts = Date.parse(row.date);
            return !!fighter
                && roster.has(fighter)
                && Number.isFinite(Number(row.line))
                && Number.isFinite(Number(row.result))
                && Number.isFinite(ts)
                && ts >= londonTs;
        });
        const bestPickConfidenceCache = new Map();
        const bestPickReasonCache = new Map();
        const bestPickLeanCache = new Map();
        // Best Picks lookups can target a specific book via the optional `platform`
        // arg — used when a candidate carries `_platform` (e.g., a PrizePicks-specific
        // FP candidate). Without it, falls back to the user's active-platform priority.
        const lineForLeanSource = (f, source, platform) => {
            if (source === 'fp') {
                if (platform === 'pick6')
                    return f.line_p6 ?? null;
                if (platform === 'underdog')
                    return f.line_ud ?? null;
                if (platform === 'prizepicks')
                    return f.line_pp ?? null;
                if (platform === 'betr')
                    return f.line_betr ?? null;
                return activePlatformLine(f);
            }
            if (source === 'ss') {
                if (platform === 'pick6')
                    return f.line_p6_ss ?? null;
                if (platform === 'underdog')
                    return f.line_ud_ss ?? null;
                if (platform === 'prizepicks')
                    return f.line_pp_ss ?? null;
                if (platform === 'betr')
                    return f.line_betr_ss ?? null;
                if (platform === 'draftkings_sportsbook')
                    return f.line_dk_ss ?? null;
                if (currentPlatform === 'pick6')
                    return f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
                if (currentPlatform === 'underdog')
                    return f.line_ud_ss ?? f.line_p6_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
                if (currentPlatform === 'prizepicks')
                    return f.line_pp_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
                if (currentPlatform === 'draftkings_sportsbook')
                    return f.line_dk_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? null;
                return f.line_betr_ss ?? f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_dk_ss ?? null;
            }
            if (source === 'ss_r1') {
                // R1 SS is offered only by PrizePicks and Underdog. When a specific book is
                // requested (e.g. bestSideLineForPick walking all books), return null for any
                // platform that doesn't carry the prop so no phantom candidates are created.
                if (platform) {
                    if (platform === 'prizepicks')
                        return f.line_pp_ss_r1 ?? null;
                    if (platform === 'underdog')
                        return f.line_ud_ss_r1 ?? null;
                    return null;
                }
                if (currentPlatform === 'underdog')
                    return f.line_ud_ss_r1 ?? f.line_pp_ss_r1 ?? null;
                return f.line_pp_ss_r1 ?? f.line_ud_ss_r1 ?? null;
            }
            if (source === 'td') {
                if (platform === 'pick6')
                    return f.line_p6_td ?? null;
                if (platform === 'underdog')
                    return f.line_ud_td ?? null;
                if (platform === 'prizepicks')
                    return f.line_pp_td ?? null;
                if (platform === 'betr')
                    return f.line_betr_td ?? null;
                if (platform === 'draftkings_sportsbook')
                    return f.line_dk_td ?? null;
                if (currentPlatform === 'pick6')
                    return f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
                if (currentPlatform === 'underdog')
                    return f.line_ud_td ?? f.line_p6_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
                if (currentPlatform === 'prizepicks')
                    return f.line_pp_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
                if (currentPlatform === 'draftkings_sportsbook')
                    return f.line_dk_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? null;
                return f.line_betr_td ?? f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_dk_td ?? null;
            }
            if (source === 'ft') {
                if (platform === 'pick6')
                    return f.line_p6_ft ?? null;
                if (platform === 'underdog')
                    return f.line_ud_ft ?? null;
                if (platform === 'prizepicks')
                    return f.line_pp_ft ?? null;
                if (platform === 'betr')
                    return f.line_betr_ft ?? null;
                if (platform === 'draftkings_sportsbook')
                    return f.line_dk_ft ?? null;
                if (currentPlatform === 'pick6')
                    return f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
                if (currentPlatform === 'underdog')
                    return f.line_ud_ft ?? f.line_p6_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
                if (currentPlatform === 'prizepicks')
                    return f.line_pp_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
                if (currentPlatform === 'draftkings_sportsbook')
                    return f.line_dk_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? null;
                return f.line_betr_ft ?? f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_dk_ft ?? null;
            }
            return null;
        };
        // For SS/TD/FT/CTRL picks: pick the easiest line for the lean direction
        // across all books that have a value (lowest for OVER, highest for UNDER).
        // FP already runs per-book candidate generation and carries _platform on the
        // chosen candidate; FP and push/none directions short-circuit to null here.
        // SS UNDER side availability across books:
        //  • PrizePicks / Betr — both sides for EVERY fighter (favorite or underdog).
        //  • DraftKings — real sportsbook, both sides.
        //  • Pick6 — SS UNDER only for FAVORITES (underdogs are More/OVER-only).
        //  • Underdog — SS UNDER only for UNDERDOGS (favorites are Higher/OVER-only).
        const ssUnderBookOffered = (f, book) => {
            if (book === 'draftkings_sportsbook' || book === 'prizepicks' || book === 'betr')
                return true;
            const dog = isMoneylineUnderdog(f);
            if (book === 'underdog')
                return dog;
            return !dog; // pick6 → favorites only
        };
        // TD UNDER side availability per book — mirrors the authoritative gating already in
        // isCandidateUsable so bestSideLineForPick can't surface an unplaceable line:
        //  • Pick6 — TD unders are More/OVER-only by default (low takedown lines); only a
        //    positively-confirmed Less button (td_under_available === true) makes it placeable.
        //  • Underdog — records the actual offered side at ingest; a false flag means UD had the
        //    TD line but not the under side.
        //  • DraftKings — real sportsbook, posts both sides (line presence checked separately).
        //  • PrizePicks / Betr — pick-em books that carry both sides on the TD props they offer.
        const tdUnderBookOffered = (f, book) => {
            if (book === 'pick6')
                return (f.td_under_available ?? null) === true;
            if (book === 'underdog')
                return (f.ud_td_under_avail ?? null) !== false;
            return true; // draftkings_sportsbook / prizepicks / betr
        };
        const bestSideLineForPick = (f, source, dir) => {
            if (!source || source === 'fp' || dir !== 'over' && dir !== 'under') {
                return { line: null, book: null };
            }
            const books = ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook'];
            const candidates = [];
            for (const b of books) {
                // For SS/TD unders, only consider books that actually offer the under side for this
                // fighter — otherwise we'd surface an unplaceable line (e.g. a non-favorite's SS under
                // on Pick6, which is OVER-only there, or a Pick6 TD under that has no Less button).
                if (dir === 'under' && source === 'ss' && !ssUnderBookOffered(f, b))
                    continue;
                if (dir === 'under' && source === 'td' && !tdUnderBookOffered(f, b))
                    continue;
                const v = lineForLeanSource(f, source, b);
                if (v != null)
                    candidates.push({ line: v, book: b });
            }
            if (!candidates.length)
                return { line: null, book: null };
            candidates.sort((a, b) => dir === 'over' ? a.line - b.line : b.line - a.line);
            return { line: candidates[0].line, book: candidates[0].book };
        };
        const sourceBonus = (source) => {
            if (source === 'ft')
                return 1.8;
            // R1 SS sits between full-fight stat leans and FT: it's a bounded single-round
            // market whose clean historical records are highly predictive, so it earns a
            // bonus above SS/TD but below FT.
            if (source === 'ss_r1')
                return 1.5;
            if (source === 'ss' || source === 'td')
                return 1.2;
            return 0;
        };
        // Per-book FP lean: PrizePicks uses a different scoring formula, so its line
        // can't be evaluated against the P6/UD projection — calcLean must be re-run
        // with the explicit book so projection, history, and platform-tagged reasons
        // all line up. We generate one FP candidate per book that has a line; if a
        // book's lean is "none" or "push" it's filtered out and won't dilute the pool.
        const FP_BOOKS_FOR_BEST_PICKS = ['pick6', 'underdog', 'prizepicks', 'betr'];
        const computeFpLeanForBook = (f, platform) => {
            const book = lineForLeanSource(f, 'fp', platform);
            if (book == null)
                return null;
            if (!f.db?.loaded)
                return null;
            const opp = f.opponent ? allFighters.find(x => x.name === f.opponent) : null;
            return calcLean(f.name, f.db, f.line_p6 ?? null, f.line_ud ?? null, f.line_pp ?? null, f.line_betr ?? null, f.moneyline ?? null, opp?.db ?? null, opp?.line_p6 ?? null, opp?.line_ud ?? null, opp?.line_pp ?? null, opp?.line_betr ?? null, opp?.moneyline ?? null, platform);
        };
        // Chalk filter: reject sides priced > 0.667 implied probability (= worse than
        // -200 American or below 0.5x payout). User wants to avoid "to-end-inside-the-
        // distance" -300 lines and similar — they hit often but pay nothing, so even
        // a confident lean isn't actually +EV after juice. FT UNDERs are tightened
        // further (0.6 = -150) because finish-inside-distance is structurally chalk-
        // prone for power punchers and the looser threshold lets juiced FT unders slip.
        const CHALK_IMPLIED_PROB_LIMIT = 0.667;
        // FT UNDER threshold tightened to 0.55 (~-122 American). Finish-inside-distance
        // markets are structurally chalk-prone; -150 is still too juiced once the
        // model's edge gets eaten by the payout.
        const CHALK_IMPLIED_PROB_LIMIT_FT_UNDER = 0.55;
        const impliedProbInline = (odds) => {
            if (odds == null || !Number.isFinite(odds))
                return null;
            if (Math.abs(odds) >= 100)
                return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
            if (odds > 0)
                return 1 / (1 + odds);
            return null;
        };
        const sideOddsFor = (f, source, dir) => {
            if (source === 'ss')
                return dir === 'over' ? (f.ss_over_odds ?? null) : (f.ss_under_odds ?? null);
            if (source === 'td')
                return dir === 'over' ? (f.td_over_odds ?? null) : (f.td_under_odds ?? null);
            if (source === 'ft')
                return dir === 'over' ? (f.ft_over_odds ?? null) : (f.ft_under_odds ?? null);
            return null;
        };
        // UD pick-em is often one-sided. Returns true=UD offered this side, false=UD has
        // the line but didn't offer this side, null=no UD line / unknown. The merged
        // ft_under_odds field can't be used for this check because DK chalk odds will
        // overwrite it even when UD didn't offer the side.
        const udSideAvailable = (f, source, dir) => {
            if (source === 'ss')
                return dir === 'over' ? (f.ud_ss_over_avail ?? null) : (f.ud_ss_under_avail ?? null);
            if (source === 'td')
                return dir === 'over' ? (f.ud_td_over_avail ?? null) : (f.ud_td_under_avail ?? null);
            if (source === 'ft')
                return dir === 'over' ? (f.ud_ft_over_avail ?? null) : (f.ud_ft_under_avail ?? null);
            return null;
        };
        // Pick6 SS/TD props are frequently More/OVER-only (e.g. low takedown lines) — the
        // card shows no "Less" button, so an UNDER lean is unplaceable. Captured at scrape
        // via the Less-button check. true = Less offered, false = More-only, null = unknown
        // (pre-flag / stale lines captured before this was tracked — leave alone, don't drop).
        const p6UnderAvailable = (f, source) => {
            if (source === 'ss')
                return f.ss_under_available ?? null;
            if (source === 'td')
                return f.td_under_available ?? null;
            return null;
        };
        const isCandidateUsable = (f, c) => {
            // FP pick-em rules judged against THIS candidate's book (Pick6/PP/Betr underdog UNDER
            // not offered; Betr underdog OVER inflated). Underdog FP unders are allowed for dogs.
            if (shouldSkipFpSideForFighter(f, c._source, c.lean, c._platform))
                return false;
            if (c._source === 'fp') {
                // Authoritative Pick6 placeability: Pick6 gives underdogs a More/OVER-only FP prop
                // (no Less button). When the scrape positively recorded no Less side for THIS book's
                // FP card, the UNDER is unplaceable on Pick6 — even when the (often-incomplete)
                // moneyline map never flagged the fighter as a dog. Scoped to the Pick6 candidate so
                // a book that does offer the under (e.g. Underdog) can still surface. null = unknown
                // (stale/pre-flag or no Pick6 FP line) → keep, relying on the moneyline rule above.
                const platform = c._platform ?? getSourceActivePlatformKey(f, 'fp');
                if (c.lean === 'under' && platform === 'pick6' && (f.fp_under_available ?? null) === false)
                    return false;
                return true;
            }
            // R1 SS (PrizePicks + Underdog pick-em) has no scraped side-odds — it can't be
            // chalk-filtered or side-availability-gated the way SS/TD/FT are. Worthiness is
            // enforced upstream by calcSSR1Lean's conservative confidence gating, so accept
            // any non-push R1 SS candidate that survived candidate collection.
            if (c._source === 'ss_r1')
                return true;
            const dir = c.lean;
            const sideOdds = sideOddsFor(f, c._source, dir);
            const platform = c._platform ?? getSourceActivePlatformKey(f, c._source);
            // Per-platform side availability for Underdog: when UD shows "—" for a side,
            // we can't use the merged sideOdds field as a proxy because DK may have
            // overwritten it with chalk odds for the same prop. The ud_*_avail flags
            // are recorded at UD ingest from Underdog's actual response. Falls back to
            // the merged sideOdds null-check for stale data captured before the flags
            // were added (avail === null means the flag was never populated).
            if (platform === 'underdog') {
                const avail = udSideAvailable(f, c._source, dir);
                if (avail === false)
                    return false;
                if (avail == null && sideOdds == null)
                    return false;
            }
            else if (platform === 'draftkings_sportsbook' && sideOdds == null) {
                // DK posts both sides explicitly; null odds means the side wasn't scraped.
                return false;
            }
            else if (platform === 'pick6' && c._source === 'td' && dir === 'under' && p6UnderAvailable(f, 'td') !== true) {
                // Pick6 TD unders are almost always More/OVER-only (low takedown lines) and aren't
                // offered on other books either, so suppress unless a Less button was positively
                // confirmed at scrape (suppress-by-default, same rule as Pick6 CTRL).
                return false;
            }
            // SS UNDER placeability is favorite-dependent and book-specific: keep the candidate
            // only if SOME book offers the under side for this fighter (favorites → Pick6/PP/Betr,
            // underdogs → Underdog, DK → either). Drops e.g. a non-favorite whose SS line sits only
            // on Pick6 (OVER-only there); bestSideLineForPick then shows whichever book is valid.
            if (c._source === 'ss' && dir === 'under') {
                const ssBooks = ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook'];
                if (!ssBooks.some(b => ssUnderBookOffered(f, b) && lineForLeanSource(f, 'ss', b) != null))
                    return false;
            }
            // Chalk reject: implied prob > 0.667 means -200+ American — line hits often
            // but pays so little that even a strong lean isn't worth taking. FT UNDER
            // uses a tighter 0.55 threshold (~-122).
            const implied = impliedProbInline(sideOdds);
            const chalkLimit = c._source === 'ft' && dir === 'under' ? CHALK_IMPLIED_PROB_LIMIT_FT_UNDER : CHALK_IMPLIED_PROB_LIMIT;
            if (implied != null && implied > chalkLimit)
                return false;
            // UD pick-em FT UNDER +money disagreement: when UD prices UNDER as the
            // unlikely side (implied < 0.45 = +money), the market is contradicting our
            // strong UNDER lean by a wide margin. Historically that signals model error
            // rather than value — drop the pick rather than recommend against the book.
            if (platform === 'underdog' && c._source === 'ft' && dir === 'under' && implied != null && implied < 0.45) {
                return false;
            }
            return true;
        };
        const collectLeanCandidates = (f) => {
            const candidates = [];
            // FP: one candidate per book that has a line. Lets PP-specific leans
            // surface even when a P6/UD line also exists for the same fighter.
            for (const book of FP_BOOKS_FOR_BEST_PICKS) {
                if (lineForLeanSource(f, 'fp', book) == null)
                    continue;
                const lean = computeFpLeanForBook(f, book);
                if (!lean || !lean.lean || lean.lean === 'none' || lean.lean === 'push')
                    continue;
                candidates.push({ ...lean, _source: 'fp', _label: '', _platform: book });
            }
            // SS/TD/FT: scoring is identical across books (same underlying stat).
            // Stick with the existing single-lean approach; line variance is small.
            if (f.lean_ss?.lean && f.lean_ss.lean !== 'none' && f.lean_ss.lean !== 'push' && lineForLeanSource(f, 'ss') != null) {
                candidates.push({ ...f.lean_ss, _source: 'ss', _label: ' (SS line)' });
            }
            if (f.lean_ss_r1?.lean && f.lean_ss_r1.lean !== 'none' && f.lean_ss_r1.lean !== 'push' && lineForLeanSource(f, 'ss_r1') != null) {
                candidates.push({ ...f.lean_ss_r1, _source: 'ss_r1', _label: ' (R1 SS line)' });
            }
            if (f.lean_td?.lean && f.lean_td.lean !== 'none' && f.lean_td.lean !== 'push' && lineForLeanSource(f, 'td') != null) {
                candidates.push({ ...f.lean_td, _source: 'td', _label: ' (TD line)' });
            }
            if (f.lean_ft?.lean && f.lean_ft.lean !== 'none' && f.lean_ft.lean !== 'push' && lineForLeanSource(f, 'ft') != null) {
                candidates.push({ ...f.lean_ft, _source: 'ft', _label: ' (FT line)' });
            }
            return candidates.filter(c => isCandidateUsable(f, c));
        };
        const sortCandidates = (candidates) => {
            candidates.sort((a, b) => {
                const bScore = (b.conf || 0) + sourceBonus(b._source);
                const aScore = (a.conf || 0) + sourceBonus(a._source);
                if (bScore !== aScore)
                    return bScore - aScore;
                return (b.ev || 0) - (a.ev || 0);
            });
        };
        const getBestPickLean = (f) => {
            const cached = bestPickLeanCache.get(f.name);
            if (cached)
                return cached;
            const candidates = collectLeanCandidates(f);
            if (!candidates.length) {
                const fallback = getEffectiveLean(f);
                bestPickLeanCache.set(f.name, fallback);
                return fallback;
            }
            sortCandidates(candidates);
            const selected = candidates[0];
            bestPickLeanCache.set(f.name, selected);
            return selected;
        };
        // Direction-specific lean: best OVER or best UNDER lean for a fighter (independent columns)
        const bestPickLeanByDir = new Map();
        const getBestPickLeanForDir = (f, dir) => {
            const cacheKey = `${f.name}|${dir}`;
            const cached = bestPickLeanByDir.get(cacheKey);
            if (cached)
                return cached;
            const candidates = collectLeanCandidates(f).filter(c => c.lean === dir);
            if (!candidates.length)
                return null;
            sortCandidates(candidates);
            bestPickLeanByDir.set(cacheKey, candidates[0]);
            return candidates[0];
        };
        const formatSideOdds = (odds) => {
            if (Math.abs(odds) >= 100)
                return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
            return `${odds.toFixed(2)}x`;
        };
        const impliedProbabilityFromSideOdds = (odds) => {
            if (odds == null || !Number.isFinite(odds))
                return null;
            // American odds branch.
            if (Math.abs(odds) >= 100) {
                if (odds < 0)
                    return Math.abs(odds) / (Math.abs(odds) + 100);
                return 100 / (odds + 100);
            }
            // Payout multiplier branch (e.g., 0.66x means 1 stake returns 1.66 total).
            if (odds > 0)
                return 1 / (1 + odds);
            return null;
        };
        const getLeanSideOdds = (f, el) => {
            if (el.lean !== 'over' && el.lean !== 'under')
                return null;
            if (el._source === 'ss')
                return el.lean === 'over' ? (f.ss_over_odds ?? null) : (f.ss_under_odds ?? null);
            if (el._source === 'td')
                return el.lean === 'over' ? (f.td_over_odds ?? null) : (f.td_under_odds ?? null);
            if (el._source === 'ft')
                return el.lean === 'over' ? (f.ft_over_odds ?? null) : (f.ft_under_odds ?? null);
            return null;
        };
        const getOddsAdjustment = (f, el, baseConfidence) => {
            const sideOdds = getLeanSideOdds(f, el);
            const implied = impliedProbabilityFromSideOdds(sideOdds);
            if (sideOdds == null || implied == null)
                return { delta: 0, note: null };
            const overPricedPenalty = implied >= 0.6
                ? Math.min(10, ((implied - 0.6) * 40) + Math.max(0, (80 - baseConfidence) / 12))
                : 0;
            const plusMoneyBonus = implied <= 0.45
                ? Math.min(7, ((0.45 - implied) * 28) + Math.max(0, (baseConfidence - 58) / 18))
                : 0;
            const delta = Math.round(plusMoneyBonus - overPricedPenalty);
            if (Math.abs(delta) < 2)
                return { delta, note: null };
            const note = delta < 0
                ? `Side price ${formatSideOdds(sideOdds)} is juiced for ${el.lean}, so confidence was trimmed.`
                : `Side price ${formatSideOdds(sideOdds)} is favorable for ${el.lean}, so confidence was boosted.`;
            return { delta, note };
        };
        const getAdjustedBestPickConfidence = (f) => {
            const cacheKey = f.name;
            const cached = bestPickConfidenceCache.get(cacheKey);
            if (cached != null)
                return cached;
            const el = getBestPickLean(f);
            const baseConfidence = el.conf || 0;
            const propType = el._source === 'fp' ? 'Fantasy' : el._source.toUpperCase();
            // Archive lookup: validate against the book actually shown in the badge — its hit
            // rate, not the user's active platform's. FP candidates carry _platform directly;
            // SS/TD/FT show the placeable best-side book from bestSideLineForPick (e.g. a TD
            // under shown on DK must be checked against DK's archive rows, not Pick6's — Pick6
            // may not even offer that under). Falls back to the active platform label.
            const displayedBook = (el._source !== 'fp' && (el.lean === 'over' || el.lean === 'under'))
                ? bestSideLineForPick(f, el._source, el.lean).book
                : null;
            const platform = el._platform ?? displayedBook ?? normalizeArchivePlatformLabel(activePlatformLabel(f));
            const matchingRows = recentResolvedRows.filter((row) => {
                if (String(row.propType) !== propType)
                    return false;
                if (platform && String(row.platform || '').toLowerCase() !== platform)
                    return false;
                return true;
            });
            // FT and TD are low-sample stat types — require only 2 settled rows instead of 3
            const minSamples = (propType === 'FT' || propType === 'TD') ? 2 : 3;
            if (matchingRows.length < minSamples) {
                bestPickConfidenceCache.set(cacheKey, baseConfidence);
                bestPickReasonCache.set(cacheKey, null);
                return baseConfidence;
            }
            let hits = 0;
            let total = 0;
            let directionalEdgeSum = 0;
            for (const row of matchingRows) {
                const line = Number(row.line);
                const result = Number(row.result);
                if (!Number.isFinite(line) || !Number.isFinite(result) || result === line)
                    continue;
                const directionalEdge = el.lean === 'over' ? (result - line) : (line - result);
                total += 1;
                directionalEdgeSum += directionalEdge;
                if (directionalEdge > 0)
                    hits += 1;
            }
            if (total < minSamples) {
                bestPickConfidenceCache.set(cacheKey, baseConfidence);
                bestPickReasonCache.set(cacheKey, null);
                return baseConfidence;
            }
            const hitRate = hits / total;
            // Dead zone: 47–53% hit rate is statistical noise, not signal — skip adjustment entirely
            if (hitRate >= 0.47 && hitRate <= 0.53) {
                bestPickConfidenceCache.set(cacheKey, baseConfidence);
                bestPickReasonCache.set(cacheKey, null);
                return baseConfidence;
            }
            const avgDirectionalEdge = directionalEdgeSum / total;
            const penalty = hitRate < 0.47
                ? Math.min(18, ((0.52 - hitRate) * 42) + (avgDirectionalEdge < 0 ? Math.min(8, Math.abs(avgDirectionalEdge) / 4) : 0))
                : 0;
            const bonus = hitRate > 0.62 && avgDirectionalEdge > 0
                ? Math.min(6, ((hitRate - 0.62) * 20) + Math.min(3, avgDirectionalEdge / 8))
                : 0;
            const oddsAdjustment = getOddsAdjustment(f, el, baseConfidence);
            const adjustedConfidence = Math.round(Math.max(0, Math.min(99, baseConfidence - penalty + bonus + oddsAdjustment.delta)));
            const lowNTag = minSamples === 2 ? ' (low-n)' : '';
            let note = null;
            if (penalty >= 4) {
                note = `Archive check: ${propType} ${el.lean}s on ${platform || 'active book'} are ${Math.round(hitRate * 100)}% over ${total} settled samples${lowNTag}, so confidence was trimmed.`;
            }
            else if (bonus >= 3) {
                note = `Archive check: ${propType} ${el.lean}s on ${platform || 'active book'} are ${Math.round(hitRate * 100)}% over ${total} settled samples${lowNTag}, so confidence was boosted.`;
            }
            if (oddsAdjustment.note) {
                note = note ? `${note} ${oddsAdjustment.note}` : oddsAdjustment.note;
            }
            bestPickConfidenceCache.set(cacheKey, adjustedConfidence);
            bestPickReasonCache.set(cacheKey, note);
            return adjustedConfidence;
        };
        const getBestPickArchiveNote = (f) => {
            void getAdjustedBestPickConfidence(f);
            return bestPickReasonCache.get(f.name) ?? null;
        };
        const pickTier = (f) => {
            const el = getBestPickLean(f);
            const db = f.db;
            const line = lineForLeanSource(f, el._source, el._platform);
            const samples = db?.history?.length || 0;
            const conf = getAdjustedBestPickConfidence(f);
            const statLean = el._source === 'ss' || el._source === 'ss_r1' || el._source === 'td' || el._source === 'ft';
            const highConfReq = statLean ? 78 : 72;
            const highSampleReq = statLean ? 8 : 7;
            const medConfReq = statLean ? 64 : 58;
            const medSampleReq = statLean ? 5 : 4;
            if (conf >= highConfReq && samples >= highSampleReq && line != null)
                return { label: 'High', rank: 3 };
            if (conf >= medConfReq && samples >= medSampleReq)
                return { label: 'Med', rank: 2 };
            return { label: 'Low', rank: 1 };
        };
        // Correlation penalty map: same-fight pair in same section — lower-ranked fighter is demoted
        const corrPenaltyMap = new Map();
        const bestPickSort = (a, b) => {
            const ta = pickTier(a);
            const tb = pickTier(b);
            if (tb.rank !== ta.rank)
                return tb.rank - ta.rank;
            const ea = getBestPickLean(a);
            const eb = getBestPickLean(b);
            const adjA = getAdjustedBestPickConfidence(a) - (corrPenaltyMap.get(a.name) || 0);
            const adjB = getAdjustedBestPickConfidence(b) - (corrPenaltyMap.get(b.name) || 0);
            if (adjB !== adjA)
                return adjB - adjA;
            return ((eb.ev || 0) - (ea.ev || 0));
        };
        // Detect same-fight pairs and penalize the lower-ranked fighter
        const buildCorrPenalties = (sorted) => {
            const seenNames = new Map(); // lowercase name → original
            for (const f of sorted) {
                if (!f.opponent)
                    continue;
                const oppKey = f.opponent.toLowerCase();
                if (seenNames.has(oppKey)) {
                    // f appears after its opponent in the ranked list — it's the weaker side
                    corrPenaltyMap.set(f.name, 10);
                }
                else {
                    seenNames.set(f.name.toLowerCase(), f.name);
                }
            }
        };
        // Populate each column independently: a fighter's best OVER lean goes to the
        // OVER column, and their best UNDER lean to the UNDER column.  A fighter can
        // appear on both sides when they have actionable leans in both directions.
        const allOversRaw = visibleFighters.filter(f => {
            const el = getBestPickLeanForDir(f, 'over');
            if (!el)
                return false;
            // Skip Betr underdog FP OVERs — inflated +money odds, user doesn't take them.
            if (shouldSkipFpSideForFighter(f, el._source, 'over', el._platform))
                return false;
            return true;
        });
        const allUndersRaw = visibleFighters.filter(f => {
            const el = getBestPickLeanForDir(f, 'under');
            if (!el)
                return false;
            // Drop unplaceable unders: underdogs have no UNDER side on pick-em FP props.
            if (shouldSkipFpSideForFighter(f, el._source, 'under', el._platform))
                return false;
            return true;
        });
        // Temporarily override the bestPickLeanCache for sorting so confidence/tier
        // functions use the direction-specific lean when ranking each column.
        const overrideLeanForSort = (fighters, dir) => {
            for (const f of fighters) {
                const dirLean = getBestPickLeanForDir(f, dir);
                if (dirLean)
                    bestPickLeanCache.set(f.name, dirLean);
            }
        };
        overrideLeanForSort(allOversRaw, 'over');
        // Clear confidence cache so it recalculates with the overridden lean
        bestPickConfidenceCache.clear();
        bestPickReasonCache.clear();
        const allOvers = allOversRaw.sort(bestPickSort);
        buildCorrPenalties(allOvers);
        const allOversSorted = allOvers.sort(bestPickSort);
        overrideLeanForSort(allUndersRaw, 'under');
        bestPickConfidenceCache.clear();
        bestPickReasonCache.clear();
        const allUnders = allUndersRaw.sort(bestPickSort);
        buildCorrPenalties(allUnders);
        const allUndersSorted = allUnders.sort(bestPickSort);
        // Restore each fighter's true best lean in cache for card rendering
        bestPickLeanCache.clear();
        bestPickConfidenceCache.clear();
        bestPickReasonCache.clear();
        // Drop negatively-correlated same-fight pairs.  Two layers:
        // 1. Cross-stat: if a fight has an FP pick, non-FP picks from that fight are
        //    dropped (FP captures total fight outcome).  Different non-FP stats from
        //    the same fight are also blocked (first stat seen wins).
        // 2. FP zero-sum: at most one FP pick per fight per section — both fighters
        //    going FP-OVER or FP-UNDER is contradictory.
        // Non-FP same-stat pairs (e.g. both SS-OVER) are allowed: positive
        // correlation in high-volume fights.
        const dedupeNegCorrelatedSameFight = (sorted, dir, limit, minTarget = 0) => {
            const fightHasFpPick = new Set();
            for (const f of sorted) {
                const oppName = (f.opponent || '').toLowerCase();
                const fightKey = oppName ? [f.name.toLowerCase(), oppName].sort().join('|') : '';
                if (!fightKey)
                    continue;
                const lean = getBestPickLeanForDir(f, dir);
                if (lean?._source === 'fp')
                    fightHasFpPick.add(fightKey);
            }
            const result = [];
            const fightFirstStat = new Map();
            const fightFpSeen = new Set();
            for (const f of sorted) {
                if (result.length >= limit)
                    break;
                const oppName = (f.opponent || '').toLowerCase();
                const fightKey = oppName ? [f.name.toLowerCase(), oppName].sort().join('|') : '';
                const lean = getBestPickLeanForDir(f, dir);
                const source = lean?._source || 'fp';
                if (fightKey) {
                    if (fightHasFpPick.has(fightKey) && source !== 'fp')
                        continue;
                    const existing = fightFirstStat.get(fightKey);
                    if (existing && existing !== source)
                        continue;
                    if (!existing)
                        fightFirstStat.set(fightKey, source);
                    if (source === 'fp' && fightFpSeen.has(fightKey))
                        continue;
                    if (source === 'fp')
                        fightFpSeen.add(fightKey);
                }
                result.push(f);
            }
            if (result.length < minTarget) {
                const have = new Set(result.map((x) => x.name.toLowerCase()));
                for (const f of sorted) {
                    if (result.length >= limit)
                        break;
                    const key = f.name.toLowerCase();
                    if (have.has(key))
                        continue;
                    const oppName2 = (f.opponent || '').toLowerCase();
                    const fk = oppName2 ? [key, oppName2].sort().join('|') : '';
                    const lean2 = getBestPickLeanForDir(f, dir);
                    const src2 = lean2?._source || 'fp';
                    if (fk && src2 === 'fp' && fightFpSeen.has(fk))
                        continue;
                    if (fk && fightHasFpPick.has(fk) && src2 !== 'fp')
                        continue;
                    const ex = fk ? fightFirstStat.get(fk) : undefined;
                    if (ex && ex !== src2)
                        continue;
                    result.push(f);
                    have.add(key);
                    if (fk && src2 === 'fp')
                        fightFpSeen.add(fk);
                    if (fk && !fightFirstStat.has(fk))
                        fightFirstStat.set(fk, src2);
                }
            }
            return result;
        };
        const overs = dedupeNegCorrelatedSameFight(allOversSorted, 'over', 8, 7);
        const unders = dedupeNegCorrelatedSameFight(allUndersSorted, 'under', 8, 7);
        void persistBestPicksSnapshot(overs, unders);
        // Flag fighters whose opponent is still in the SAME section after demotion
        const overNames = new Set(overs.map(f => f.name.toLowerCase()));
        const underNames = new Set(unders.map(f => f.name.toLowerCase()));
        const conflictFighters = new Set();
        for (const f of overs) {
            if (f.opponent && overNames.has(f.opponent.toLowerCase()))
                conflictFighters.add(f.name);
        }
        for (const f of unders) {
            if (f.opponent && underNames.has(f.opponent.toLowerCase()))
                conflictFighters.add(f.name);
        }
        function buildSection(fighters, type) {
            if (!fighters.length)
                return '';
            const title = type === 'over' ? 'Best Overs' : 'Best Unders';
            const typeClass = type === 'over' ? 'over' : 'under';
            const icon = type === 'over' ? '▲' : '▼';
            // Override lean cache for this column so confidence/tier use the direction-specific lean
            for (const f of fighters) {
                const dirLean = getBestPickLeanForDir(f, type);
                if (dirLean)
                    bestPickLeanCache.set(f.name, dirLean);
            }
            bestPickConfidenceCache.clear();
            bestPickReasonCache.clear();
            const rows = fighters.map((f, i) => {
                const el = getBestPickLeanForDir(f, type) || getBestPickLean(f);
                // For SS/TD/FT/CTRL: override the displayed line with the easiest one
                // for the lean direction (lowest for OVER, highest for UNDER). FP keeps
                // its per-book _platform from candidate generation.
                const originalLine = lineForLeanSource(f, el._source, el._platform);
                let line = originalLine;
                let displayPlatform = el._platform;
                if (el._source !== 'fp' && (el.lean === 'over' || el.lean === 'under')) {
                    const best = bestSideLineForPick(f, el._source, el.lean);
                    if (best.line != null && best.book != null) {
                        line = best.line;
                        displayPlatform = best.book;
                    }
                }
                const tier = pickTier(f);
                const archiveNote = getBestPickArchiveNote(f);
                let reason = archiveNote || el.verdict || el.reasons?.[0]?.text || '—';
                // If we overrode the displayed line, sync the line value embedded in
                // the verdict prefix (e.g. "SS OVER 46.5 (proj 69.3) — ...") so the
                // reason stays consistent with the displayed line/book.
                if (line != null && originalLine != null && line !== originalLine && el._source && (el.lean === 'over' || el.lean === 'under')) {
                    const prefix = `${el._source === 'ss_r1' ? 'R1 SS' : el._source.toUpperCase()} ${el.lean.toUpperCase()} `;
                    if (reason.startsWith(prefix)) {
                        const tail = reason.slice(prefix.length);
                        const m = tail.match(/^(\d+(?:\.\d+)?)/);
                        if (m && Math.abs(parseFloat(m[1]) - originalLine) < 0.01) {
                            reason = prefix + line + tail.slice(m[1].length);
                        }
                    }
                }
                const srcTag = el._source !== 'fp' ? ` <span class="best-pick-source">(${el._source === 'ss_r1' ? 'R1 SS' : el._source?.toUpperCase()} line)</span>` : '';
                // Correlation tag: penalized fighters show ⬇ corr, remaining conflicts show ⚡ corr
                const corrPenalty = corrPenaltyMap.get(f.name) || 0;
                const conflictTag = corrPenalty > 0
                    ? ` <span class="best-pick-conflict" title="Opponent picked same direction — demoted ${corrPenalty}pts (correlated slate risk)">⬇ corr</span>`
                    : conflictFighters.has(f.name)
                        ? ` <span class="best-pick-conflict" title="Opponent also picked in same direction — correlated picks">⚡ corr</span>`
                        : '';
                // Lineshop badge: only meaningful for FP picks now — SS/TD/FT/CTRL
                // displayed line is already the best-side across all books.
                const src = el._source;
                let lineShopTag = '';
                if (src === 'fp' && line != null) {
                    const allFp = [
                        ['P6', f.line_p6 ?? null],
                        ['UD', f.line_ud ?? null],
                        ['PP', f.line_pp ?? null],
                        ['BTR', f.line_betr ?? null],
                    ];
                    const available = allFp.filter((x) => x[1] != null);
                    if (available.length > 1) {
                        const best = el.lean === 'over'
                            ? available.reduce((a, b) => b[1] < a[1] ? b : a)
                            : available.reduce((a, b) => b[1] > a[1] ? b : a);
                        if (Math.abs(best[1] - line) >= 1.5) {
                            lineShopTag = ` <span class="best-pick-lineshop" title="Better line on ${best[0]}">🏪 ${best[0]} ${best[1]}</span>`;
                        }
                    }
                }
                return `<div class="best-pick-row tier-${tier.label.toLowerCase()} ${typeClass}" data-jump="${f.name}" title="Open fighter card">
        <div class="best-pick-rank">#${i + 1}</div>
        <div class="bp-avatar"><span class="bp-avatar-flag">${f.db?.country || '🥊'}</span><img class="bp-avatar-img" data-name="${f.name}" alt="" /></div>
        <div><div class="best-pick-name">${prettyName(f.name)}${srcTag}${conflictTag}${lineShopTag}</div><div class="best-pick-reason">${reason}</div></div>
        <div class="best-pick-meta">
          <span class="best-pick-type ${typeClass}">${type.toUpperCase()}${el._label || ''}</span>
          <span class="best-pick-tier ${tier.label.toLowerCase()}">${tier.label}</span>
          <span class="best-pick-platform">${formatSourcePlatformLabel(f, el._source, displayPlatform)}</span>
        </div>
        <div class="best-pick-line">${line || '—'}</div>
      </div>`;
            }).join('');
            return `<div class="best-picks-section ${typeClass}"><div class="best-picks-header"><span class="best-picks-title">${icon} ${title}</span><span class="best-picks-count">${fighters.length} picks</span></div>${rows}</div>`;
        }
        const html = `<div class="best-picks-grid">${buildSection(overs, 'over')}${buildSection(unders, 'under')}</div>`;
        container.innerHTML = html || '<div class="inline-empty-msg">No leans calculated yet — wait for UFCStats to finish loading</div>';
        // Hydrate Best Picks avatars from the cached headshot pipeline
        container.querySelectorAll('.bp-avatar-img[data-name]').forEach(img => {
            const nm = img.dataset['name'] || '';
            if (!nm)
                return;
            void fetchFighterImageUrl(nm)
                .then(url => {
                if (!url)
                    return;
                img.onload = () => img.parentElement?.classList.add('has-img');
                img.src = url;
            })
                .catch(() => { });
        });
        // Click a pick to jump to that fighter's card
        container.querySelectorAll('.best-pick-row[data-jump]').forEach(el => {
            el.addEventListener('click', () => jumpToFighterCard(el.dataset['jump'] || ''));
        });
        renderModelHealthWidget();
    })();
}
async function persistBestPicksSnapshot(overs, unders) {
    try {
        const resolveOpponentDb = (f) => {
            const normalizedOpp = normalizeName(f.opponent || '')?.toLowerCase() || '';
            const opponent = normalizedOpp
                ? (_fighterByNorm?.get(normalizedOpp) || allFighters.find((entry) => (normalizeName(entry.name) || entry.name).toLowerCase() === normalizedOpp) || null)
                : null;
            return opponent?.db?.loaded ? opponent.db : null;
        };
        const getSourceAverageFromFighter = (f, source) => {
            const history = f.db?.history || [];
            if (source === 'fp')
                return activePlatformAvgFP(f.db) ?? f.db.avgFP_weighted ?? f.db.avgFP ?? null;
            if (source === 'ss') {
                const values = history.map((fight) => fight.sigStr).filter((value) => typeof value === 'number' && Number.isFinite(value));
                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
            }
            if (source === 'ss_r1') {
                const values = history.map((fight) => fight.sigStrR1).filter((value) => typeof value === 'number' && Number.isFinite(value));
                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
            }
            if (source === 'td') {
                const values = history.map((fight) => fight.td).filter((value) => typeof value === 'number' && Number.isFinite(value));
                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
            }
            const values = history
                .map((fight) => Number(fight.timeSecs) / 60)
                .filter((value) => Number.isFinite(value) && value > 0);
            return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        };
        const buildMemoryTagsForFighter = (f, source, el) => {
            const activeLine = getSourceActiveLine(f, source);
            if (activeLine == null || !f.db?.loaded)
                return [];
            const context = {
                fighterName: f.name,
                source,
                lean: el.lean,
                baseConfidence: el.conf || 0,
                score: el.score ?? 0,
                db: f.db,
                avgValue: getSourceAverageFromFighter(f, source),
                line: activeLine,
                selectedLine: activeLine,
                availableLines: getSourceLineEntries(f, source).map((entry) => entry.value),
                oppDB: resolveOpponentDb(f),
                moneyline: f.moneyline ?? null,
            };
            return deriveConfidenceMemoryTagsLive(context);
        };
        const normalizePick = (f, lean) => {
            const el = getEffectiveLean(f);
            const source = el._source || 'fp';
            return {
                fighter: f.name,
                opponent: f.opponent || null,
                lean,
                line: getSourceActiveLine(f, source),
                platform: formatSourcePlatformLabel(f, source),
                source,
                confidence: el.conf || 0,
                confidenceGrade: el.confidenceGrade || getConfidenceGrade(el.conf || 0),
                verdict: el.verdict || '',
                memoryTags: buildMemoryTagsForFighter(f, source, el),
            };
        };
        const picks = [
            ...overs.map((f) => normalizePick(f, 'over')),
            ...unders.map((f) => normalizePick(f, 'under')),
        ];
        if (!picks.length)
            return;
        const eventName = (upcomingEventName || '').trim() || 'Unknown Event';
        const date = new Date().toISOString();
        const key = `${eventName}|${date.slice(0, 10)}`;
        const payload = await storageGet([STORAGE_BEST_PICKS_SNAPSHOT_KEY]);
        const current = Array.isArray(payload[STORAGE_BEST_PICKS_SNAPSHOT_KEY])
            ? payload[STORAGE_BEST_PICKS_SNAPSHOT_KEY]
            : [];
        const snapshot = {
            key,
            event: eventName,
            date,
            total: picks.length,
            overs: overs.length,
            unders: unders.length,
            picks,
        };
        const merged = [snapshot, ...current.filter((x) => String(x?.key || '') !== key)].slice(0, 60);
        await storageSet({ [STORAGE_BEST_PICKS_SNAPSHOT_KEY]: merged });
    }
    catch (e) {
        debugLog(`snapshot save failed: ${e.message}`);
    }
}
async function persistAiLeanSnapshot(fighters) {
    try {
        if (!fighters.length)
            return;
        const eventName = (upcomingEventName || '').trim();
        const eventDate = (document.getElementById('eventDate')?.textContent || '').trim();
        if (!eventName)
            return;
        const picks = fighters
            .map((f) => {
            const el = getEffectiveLean(f);
            const source = el._source || 'fp';
            const activeLine = getSourceActiveLine(f, source);
            const activePlatform = getSourceActivePlatformKey(f, source);
            const opponentNorm = normalizeName(f.opponent || '')?.toLowerCase() || '';
            const opponent = opponentNorm
                ? (_fighterByNorm?.get(opponentNorm) || allFighters.find((entry) => (normalizeName(entry.name) || entry.name).toLowerCase() === opponentNorm) || null)
                : null;
            const avgValue = source === 'fp'
                ? (activePlatformAvgFP(f.db) ?? f.db.avgFP_weighted ?? f.db.avgFP ?? null)
                : source === 'ss'
                    ? (() => {
                        const values = (f.db?.history || []).map((fight) => fight.sigStr).filter((value) => typeof value === 'number' && Number.isFinite(value));
                        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                    })()
                    : source === 'ss_r1'
                        ? (() => {
                            const values = (f.db?.history || []).map((fight) => fight.sigStrR1).filter((value) => typeof value === 'number' && Number.isFinite(value));
                            return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                        })()
                        : source === 'td'
                            ? (() => {
                                const values = (f.db?.history || []).map((fight) => fight.td).filter((value) => typeof value === 'number' && Number.isFinite(value));
                                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                            })()
                            : (() => {
                                const values = (f.db?.history || [])
                                    .map((fight) => Number(fight.timeSecs) / 60)
                                    .filter((value) => Number.isFinite(value) && value > 0);
                                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
                            })();
            const memoryTags = activeLine != null && f.db?.loaded
                ? deriveConfidenceMemoryTagsLive({
                    fighterName: f.name,
                    source,
                    lean: el.lean,
                    baseConfidence: el.conf || 0,
                    score: el.score ?? 0,
                    db: f.db,
                    avgValue,
                    line: activeLine,
                    selectedLine: activeLine,
                    availableLines: getSourceLineEntries(f, source).map((entry) => entry.value),
                    oppDB: opponent?.db?.loaded ? opponent.db : null,
                    moneyline: f.moneyline ?? null,
                })
                : [];
            return {
                fighter: f.name,
                opponent: f.opponent || null,
                lean: el.lean,
                source,
                confidence: el.conf || 0,
                confidenceGrade: el.confidenceGrade || getConfidenceGrade(el.conf || 0),
                verdict: el.verdict || '',
                score: el.score ?? null,
                activePlatform,
                activeLine,
                memoryVersion: CONFIDENCE_MEMORY_VERSION,
                memoryTags,
                lines: {
                    pick6: { fp: f.line_p6 ?? null, ss: f.line_p6_ss ?? null, td: f.line_p6_td ?? null, ft: f.line_p6_ft ?? null },
                    underdog: { fp: f.line_ud ?? null, ss: f.line_ud_ss ?? null, td: f.line_ud_td ?? null, ft: f.line_ud_ft ?? null },
                    prizepicks: { fp: f.line_pp ?? null, ss: f.line_pp_ss ?? null, td: f.line_pp_td ?? null, ft: f.line_pp_ft ?? null },
                    betr: { fp: f.line_betr ?? null, ss: f.line_betr_ss ?? null, td: f.line_betr_td ?? null, ft: f.line_betr_ft ?? null },
                    draftkings_sportsbook: { ss: f.line_dk_ss ?? null, td: f.line_dk_td ?? null, ft: f.line_dk_ft ?? null },
                },
            };
        })
            .filter((pick) => pick.lean !== 'none' && pick.lean !== 'push' && Number.isFinite(Number(pick.activeLine)));
        if (!picks.length)
            return;
        const keyDate = eventDate || new Date().toISOString().slice(0, 10);
        const key = `${eventName}|${keyDate}`;
        const signature = JSON.stringify(picks
            .map((pick) => ({ fighter: pick.fighter, lean: pick.lean, source: pick.source, line: pick.activeLine, confidence: pick.confidence }))
            .sort((a, b) => a.fighter.localeCompare(b.fighter)));
        const payload = await storageGet([STORAGE_AI_LEAN_SNAPSHOT_KEY]);
        const current = Array.isArray(payload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
            ? payload[STORAGE_AI_LEAN_SNAPSHOT_KEY]
            : [];
        const existing = current.find((entry) => String(entry?.key || '') === key);
        if (existing && String(existing?.signature || '') === signature)
            return;
        const snapshot = {
            key,
            event: eventName,
            eventDate: keyDate,
            capturedAt: new Date().toISOString(),
            totalLeans: picks.length,
            overCount: picks.filter((pick) => pick.lean === 'over').length,
            underCount: picks.filter((pick) => pick.lean === 'under').length,
            signature,
            picks,
        };
        const merged = [snapshot, ...current.filter((entry) => String(entry?.key || '') !== key)].slice(0, 80);
        await storageSet({ [STORAGE_AI_LEAN_SNAPSHOT_KEY]: merged });
    }
    catch (e) {
        debugLog(`AI lean snapshot save failed: ${e.message}`);
    }
}
const parlaySelectedLegs = new Set(); // "fighter|stat|dir" keys
function parlayLegKey(fighter, stat, dir) {
    return `${fighter}|${stat}|${dir}`;
}
function areSameFight(f1, f2) {
    if (!f1.opponent || !f2.opponent)
        return false;
    const n1 = (normalizeName(f1.name) || f1.name).toLowerCase();
    const n2 = (normalizeName(f2.name) || f2.name).toLowerCase();
    const o1 = (normalizeName(f1.opponent) || f1.opponent).toLowerCase();
    const o2 = (normalizeName(f2.opponent) || f2.opponent).toLowerCase();
    return (n1 === o2 && n2 === o1) || (n1 === o2) || (n2 === o1);
}
function areSameFighter(f1Name, f2Name) {
    return (normalizeName(f1Name) || f1Name).toLowerCase() === (normalizeName(f2Name) || f2Name).toLowerCase();
}
/**
 * Correlation rules for parlay legs.
 *
 * Same-fight correlations (A fights B):
 *   A Over SS + B Over SS  → synergy (action fight = both land)
 *   A Over SS + B Under SS → conflict (contradictory: if fight is active, both land)
 *   A Over FP + B Over FP  → caution (counting stats can both go up, but win bonus goes to only one)
 *   A Over FP + B Under FP → synergy (one dominates)
 *   A Under FP + B Under FP→ caution (both low = short fight possible, but risky)
 *   A Over TD + B Over SS  → conflict (grappling eats striking time)
 *   A Over TD + B Over TD  → caution (one usually controls more)
 *
 * Same-fighter correlations:
 *   A Over SS + A Over FP  → synergy (strikes = biggest FP driver)
 *   A Over TD + A Over FP  → synergy (TDs contribute to FP)
 *   A Over SS + A Over TD  → caution (strikers don't usually wrestle)
 *   A Over SS + A Under TD → synergy (consistent striking style)
 *   A Over FP + A Under FP → impossible (filtered out)
 */
function calcPairCorrelation(leg1, f1, leg2, f2) {
    const sameFighter = areSameFighter(leg1.fighter, leg2.fighter);
    const sameFight = !sameFighter && areSameFight(f1, f2);
    if (sameFighter) {
        // Same fighter, different stat types
        const stats = [leg1.stat, leg2.stat].sort().join('+');
        const dirs = [leg1.direction, leg2.direction].sort().join('+');
        if (leg1.stat === leg2.stat) {
            // Same fighter, same stat, must be same direction (can't have both) — skip
            return null;
        }
        if (stats === 'fp+ss') {
            if (leg1.direction === leg2.direction) {
                // Both over or both under SS+FP = synergistic (strikes drive FP)
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: SS and FP move together — strikes are the #1 FP driver`, impact: 0.15 };
            }
            // SS Over + FP Under (or vice versa) = conflicting
            const ssLeg = leg1.stat === 'ss' ? leg1 : leg2;
            const fpLeg = leg1.stat === 'fp' ? leg1 : leg2;
            if (ssLeg.direction === 'over' && fpLeg.direction === 'under') {
                return { type: 'conflict', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over SS but Under FP is contradictory — more strikes = more FP`, impact: -0.25 };
            }
            if (ssLeg.direction === 'under' && fpLeg.direction === 'over') {
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over FP with Under SS needs big TDs/ctrl/finish bonus to hit`, impact: -0.08 };
            }
        }
        if (stats === 'fp+td') {
            if (leg1.direction === leg2.direction) {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: TDs and FP move together — each TD = 5 FP`, impact: 0.10 };
            }
            const tdLeg = leg1.stat === 'td' ? leg1 : leg2;
            const fpLeg = leg1.stat === 'fp' ? leg1 : leg2;
            if (tdLeg.direction === 'over' && fpLeg.direction === 'under') {
                return { type: 'conflict', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over TD but Under FP conflicts — TDs add FP directly`, impact: -0.20 };
            }
        }
        if (stats === 'ss+td') {
            if (leg1.direction === 'over' && leg2.direction === 'over') {
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over SS + Over TD is rare — grappling reduces striking time`, impact: -0.12 };
            }
            const ssLeg = leg1.stat === 'ss' ? leg1 : leg2;
            const tdLeg = leg1.stat === 'td' ? leg1 : leg2;
            if (ssLeg.direction === 'over' && tdLeg.direction === 'under') {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over SS + Under TD is consistent — striker profile`, impact: 0.10 };
            }
            if (ssLeg.direction === 'under' && tdLeg.direction === 'over') {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Under SS + Over TD is consistent — grappler profile`, impact: 0.10 };
            }
        }
        // FT combos
        if (leg1.stat === 'ft' || leg2.stat === 'ft') {
            const ftLeg = leg1.stat === 'ft' ? leg1 : leg2;
            const otherLeg = leg1.stat === 'ft' ? leg2 : leg1;
            if (ftLeg.direction === 'over' && otherLeg.stat !== 'ft') {
                // Longer fight = more counting stats
                if (otherLeg.direction === 'over') {
                    return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over FT + Over ${otherLeg.stat.toUpperCase()} — longer fight = more stats`, impact: 0.12 };
                }
                return { type: 'conflict', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Over FT but Under ${otherLeg.stat.toUpperCase()} — more time usually means more output`, impact: -0.15 };
            }
            if (ftLeg.direction === 'under') {
                if (otherLeg.direction === 'under' && otherLeg.stat !== 'fp') {
                    return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Under FT + Under ${otherLeg.stat.toUpperCase()} — short fight = fewer stats`, impact: 0.10 };
                }
                if (otherLeg.direction === 'over' && otherLeg.stat === 'fp') {
                    return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `${leg1.fighter}: Under FT + Over FP needs a dominant finish bonus to hit`, impact: -0.05 };
                }
            }
        }
        return null;
    }
    if (sameFight) {
        // Two fighters in the SAME fight (opponents)
        // SS correlations
        if (leg1.stat === 'ss' && leg2.stat === 'ss') {
            if (leg1.direction === leg2.direction) {
                // Both Over SS or both Under SS
                if (leg1.direction === 'over') {
                    return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Over SS — action fight benefits both strikers`, impact: 0.18 };
                }
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Under SS — grapple-heavy or quick finish scenario`, impact: 0.12 };
            }
            // One Over, one Under SS in same fight
            return { type: 'conflict', leg1: leg1.fighter, leg2: leg2.fighter, message: `Opposite SS directions in same fight — if pace is high, both land`, impact: -0.22 };
        }
        // FP correlations in same fight
        if (leg1.stat === 'fp' && leg2.stat === 'fp') {
            if (leg1.direction === 'over' && leg2.direction === 'over') {
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Over FP in same fight — counting stats can both go up, but only one gets win bonus (30-90 pts)`, impact: -0.10 };
            }
            if (leg1.direction === 'under' && leg2.direction === 'under') {
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Under FP in same fight — needs quick finish (less time for either)`, impact: -0.08 };
            }
            // One Over, one Under FP = synergy (one dominates)
            return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `Over/Under FP split in same fight — dominant win scenario benefits both legs`, impact: 0.15 };
        }
        // TD correlations in same fight
        if (leg1.stat === 'td' && leg2.stat === 'td') {
            if (leg1.direction === 'over' && leg2.direction === 'over') {
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Over TD in same fight — one wrestler usually dominates position`, impact: -0.10 };
            }
            if (leg1.direction === leg2.direction) {
                return { type: 'neutral', leg1: leg1.fighter, leg2: leg2.fighter, message: `Both Under TD in same fight — stand-up war scenario`, impact: 0.05 };
            }
        }
        // Cross-stat in same fight
        if ((leg1.stat === 'td' && leg2.stat === 'ss') || (leg1.stat === 'ss' && leg2.stat === 'td')) {
            const tdLeg = leg1.stat === 'td' ? leg1 : leg2;
            const ssLeg = leg1.stat === 'ss' ? leg1 : leg2;
            if (tdLeg.direction === 'over' && ssLeg.direction === 'over') {
                // One guy wrestling, other landing strikes — possible but TDs eat clock
                return { type: 'caution', leg1: leg1.fighter, leg2: leg2.fighter, message: `${tdLeg.fighter} Over TD + ${ssLeg.fighter} Over SS — grappling reduces striking time for both`, impact: -0.08 };
            }
            if (tdLeg.direction === 'over' && ssLeg.direction === 'under') {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${tdLeg.fighter} Over TD + ${ssLeg.fighter} Under SS — wrestling controls the fight`, impact: 0.15 };
            }
            if (tdLeg.direction === 'under' && ssLeg.direction === 'over') {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${tdLeg.fighter} Under TD + ${ssLeg.fighter} Over SS — stand-up fight benefits striker`, impact: 0.12 };
            }
        }
        // FP + SS cross-stat in same fight
        if ((leg1.stat === 'fp' && leg2.stat === 'ss') || (leg1.stat === 'ss' && leg2.stat === 'fp')) {
            const fpLeg = leg1.stat === 'fp' ? leg1 : leg2;
            const ssLeg = leg1.stat === 'ss' ? leg1 : leg2;
            if (areSameFighter(fpLeg.fighter, ssLeg.fighter))
                return null; // handled by same-fighter
            // Opponent's FP vs our SS
            if (ssLeg.direction === 'over' && fpLeg.direction === 'under') {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `${ssLeg.fighter} Over SS + ${fpLeg.fighter} Under FP — one dominates on the feet`, impact: 0.12 };
            }
        }
        // FT in same fight
        if (leg1.stat === 'ft' || leg2.stat === 'ft') {
            const ftLeg = leg1.stat === 'ft' ? leg1 : leg2;
            const otherLeg = leg1.stat === 'ft' ? leg2 : leg1;
            if (ftLeg.direction === 'over' && otherLeg.direction === 'over' && (otherLeg.stat === 'ss' || otherLeg.stat === 'fp')) {
                return { type: 'synergy', leg1: leg1.fighter, leg2: leg2.fighter, message: `Over FT + ${otherLeg.fighter} Over ${otherLeg.stat.toUpperCase()} — longer fight = more counting stats`, impact: 0.12 };
            }
            if (ftLeg.direction === 'under' && otherLeg.direction === 'over' && (otherLeg.stat === 'ss' || otherLeg.stat === 'fp')) {
                return { type: 'conflict', leg1: leg1.fighter, leg2: leg2.fighter, message: `Under FT + ${otherLeg.fighter} Over ${otherLeg.stat.toUpperCase()} — quick finish cuts counting time`, impact: -0.18 };
            }
        }
        return null;
    }
    // Different fights — generally independent
    return null;
}
function analyzeParlayHealth(legs, fighters) {
    const alerts = [];
    const fighterMap = new Map();
    for (const f of fighters) {
        fighterMap.set((normalizeName(f.name) || f.name).toLowerCase(), f);
    }
    // Check all pairs
    for (let i = 0; i < legs.length; i++) {
        for (let j = i + 1; j < legs.length; j++) {
            const f1 = fighterMap.get((normalizeName(legs[i].fighter) || legs[i].fighter).toLowerCase());
            const f2 = fighterMap.get((normalizeName(legs[j].fighter) || legs[j].fighter).toLowerCase());
            if (!f1 || !f2)
                continue;
            const alert = calcPairCorrelation(legs[i], f1, legs[j], f2);
            if (alert)
                alerts.push(alert);
        }
    }
    const avgConfidence = legs.length > 0 ? legs.reduce((s, l) => s + l.confidence, 0) / legs.length : 0;
    // Score: start at base from average confidence, adjust by correlation alerts
    let score = avgConfidence;
    for (const a of alerts) {
        score += a.impact * 30; // each ±0.1 impact = ±3 points on health score
    }
    // Leg count bonus/penalty
    if (legs.length >= 2 && legs.length <= 4)
        score += 3; // sweet spot
    if (legs.length >= 6)
        score -= (legs.length - 5) * 4; // diminishing odds
    // Diversity bonus: legs from different fights
    const fightKeys = new Set(legs.map(l => [l.fighter, l.opponent].sort().join('vs')));
    if (fightKeys.size >= 2 && fightKeys.size === legs.length)
        score += 5; // all independent fights
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 78 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';
    return { score, grade, alerts, avgConfidence, legCount: legs.length };
}
/** Scan all available legs and surface pairs with positive correlation (synergy). */
function findCorrelatedPairs(availableLegs) {
    const pairs = [];
    const seen = new Set();
    for (let i = 0; i < availableLegs.length; i++) {
        for (let j = i + 1; j < availableLegs.length; j++) {
            const a = availableLegs[i];
            const b = availableLegs[j];
            // Skip duplicate fighter+stat combos
            const n1 = (normalizeName(a.leg.fighter) || a.leg.fighter).toLowerCase();
            const n2 = (normalizeName(b.leg.fighter) || b.leg.fighter).toLowerCase();
            if (n1 === n2 && a.leg.stat === b.leg.stat)
                continue;
            const alert = calcPairCorrelation(a.leg, a.fighter, b.leg, b.fighter);
            if (!alert || alert.type !== 'synergy')
                continue;
            // Dedup by sorted fighter+stat key
            const pairKey = [`${n1}|${a.leg.stat}|${a.leg.direction}`, `${n2}|${b.leg.stat}|${b.leg.direction}`].sort().join('~');
            if (seen.has(pairKey))
                continue;
            seen.add(pairKey);
            pairs.push({ leg1: a.leg, leg2: b.leg, alert });
        }
    }
    // Sort by combined confidence descending, then impact
    pairs.sort((a, b) => {
        const confA = a.leg1.confidence + a.leg2.confidence;
        const confB = b.leg1.confidence + b.leg2.confidence;
        if (confB !== confA)
            return confB - confA;
        return b.alert.impact - a.alert.impact;
    });
    return pairs.slice(0, 8); // cap at 8 most confident pairs
}
/** Suggest top parlay combinations from available leans */
function suggestParlays(fighters, maxLegs = 3, count = 3) {
    // Collect all available legs from fighters with leans
    const available = [];
    for (const f of fighters) {
        if (!f.db?.loaded)
            continue;
        const addLeg = (lean, stat) => {
            if (!lean || lean.lean === 'none' || lean.lean === 'push')
                return;
            const line = getSourceActiveLine(f, stat);
            if (line == null)
                return;
            if ((lean.conf || 0) < 55)
                return; // skip low confidence
            if (shouldSkipFpSideForFighter(f, stat, lean.lean))
                return;
            available.push({
                leg: {
                    fighter: f.name,
                    opponent: f.opponent || '?',
                    stat,
                    direction: lean.lean,
                    line,
                    confidence: lean.conf || 0,
                    tier: (lean.conf || 0) >= 72 ? 'High' : (lean.conf || 0) >= 58 ? 'Med' : 'Low',
                    platform: activePlatformLabel(f),
                },
                fighter: f,
            });
        };
        addLeg(f.lean, 'fp');
        addLeg(f.lean_ss, 'ss');
        addLeg(f.lean_td, 'td');
        addLeg(f.lean_ft, 'ft');
    }
    // Sort by confidence descending
    available.sort((a, b) => b.leg.confidence - a.leg.confidence);
    // Generate combinations: take top N legs, try all combos of size maxLegs
    const top = available.slice(0, 12); // cap to avoid combinatorial explosion
    const combos = [];
    // Helper: generate combinations of size k
    function* combinations(arr, k) {
        if (k === 0) {
            yield [];
            return;
        }
        for (let i = 0; i <= arr.length - k; i++) {
            for (const rest of combinations(arr.slice(i + 1), k - 1)) {
                yield [arr[i], ...rest];
            }
        }
    }
    for (let size = maxLegs; size >= 2; size--) {
        for (const combo of combinations(top, size)) {
            // Skip if same fighter+stat appears twice
            const seen = new Set();
            let skip = false;
            for (const c of combo) {
                const key = `${(normalizeName(c.leg.fighter) || c.leg.fighter).toLowerCase()}|${c.leg.stat}`;
                if (seen.has(key)) {
                    skip = true;
                    break;
                }
                seen.add(key);
            }
            if (skip)
                continue;
            const legs = combo.map(c => c.leg);
            const health = analyzeParlayHealth(legs, fighters);
            combos.push({ legs, health });
        }
    }
    // Sort by health score, then by avg confidence
    combos.sort((a, b) => {
        if (b.health.score !== a.health.score)
            return b.health.score - a.health.score;
        return b.health.avgConfidence - a.health.avgConfidence;
    });
    return combos.slice(0, count);
}
function renderParlayLab(container) {
    if (!allFighters.length) {
        container.innerHTML = '<div class="inline-empty-msg">No fighter data loaded yet</div>';
        return;
    }
    const visibleFighters = applySourceVisibilityFilter(allFighters);
    if (!visibleFighters.length) {
        container.innerHTML = '<div class="inline-empty-msg">No fighters match selected source filters</div>';
        return;
    }
    // Build available legs
    const availableLegs = [];
    for (const f of visibleFighters) {
        if (!f.db?.loaded)
            continue;
        const addLeg = (lean, stat) => {
            if (!lean || lean.lean === 'none' || lean.lean === 'push')
                return;
            const line = getSourceActiveLine(f, stat);
            if (line == null)
                return;
            if (shouldSkipFpSideForFighter(f, stat, lean.lean))
                return;
            availableLegs.push({
                leg: {
                    fighter: f.name,
                    opponent: f.opponent || '?',
                    stat,
                    direction: lean.lean,
                    line,
                    confidence: lean.conf || 0,
                    tier: (lean.conf || 0) >= 72 ? 'High' : (lean.conf || 0) >= 58 ? 'Med' : 'Low',
                    platform: activePlatformLabel(f),
                },
                fighter: f,
            });
        };
        addLeg(f.lean, 'fp');
        addLeg(f.lean_ss, 'ss');
        addLeg(f.lean_td, 'td');
        addLeg(f.lean_ft, 'ft');
    }
    availableLegs.sort((a, b) => b.leg.confidence - a.leg.confidence);
    // Determine which are selected
    const selectedLegs = [];
    for (const a of availableLegs) {
        const key = parlayLegKey(a.leg.fighter, a.leg.stat, a.leg.direction);
        if (parlaySelectedLegs.has(key))
            selectedLegs.push(a.leg);
    }
    // Compute health for current parlay
    const health = selectedLegs.length >= 2
        ? analyzeParlayHealth(selectedLegs, visibleFighters)
        : null;
    // Suggest parlays
    const suggestions = suggestParlays(visibleFighters, 3, 3);
    // ── Render ──
    const poolRows = availableLegs.map(a => {
        const key = parlayLegKey(a.leg.fighter, a.leg.stat, a.leg.direction);
        const sel = parlaySelectedLegs.has(key);
        return `<div class="parlay-leg-row${sel ? ' selected' : ''}" data-parlay-key="${key}" data-fighter="${a.leg.fighter}" data-stat="${a.leg.stat}" data-dir="${a.leg.direction}">
      <span class="parlay-leg-check">${sel ? '☑' : '☐'}</span>
      <span class="bp-avatar bp-avatar-sm"><span class="bp-avatar-flag">🥊</span><img class="bp-avatar-img" data-name="${a.leg.fighter}" alt="" /></span><span class="parlay-leg-name">${prettyName(a.leg.fighter)}</span>
      <span class="parlay-leg-dir ${a.leg.direction}">${a.leg.direction.toUpperCase()}</span>
      <span class="parlay-leg-stat">${a.leg.stat.toUpperCase()}</span>
      <span class="parlay-leg-line">${a.leg.line}</span>
      <span class="parlay-leg-conf">${a.leg.confidence}%</span>
    </div>`;
    }).join('');
    const slipRows = selectedLegs.length > 0
        ? selectedLegs.map(l => {
            const key = parlayLegKey(l.fighter, l.stat, l.direction);
            return `<div class="parlay-slip-leg">
          <span class="parlay-slip-remove" data-parlay-remove="${key}" title="Remove leg">✕</span>
          <span class="bp-avatar bp-avatar-sm"><span class="bp-avatar-flag">🥊</span><img class="bp-avatar-img" data-name="${l.fighter}" alt="" /></span><span class="parlay-leg-name" style="flex:1">${prettyName(l.fighter)}</span>
          <span class="parlay-leg-dir ${l.direction}">${l.direction.toUpperCase()}</span>
          <span class="parlay-leg-stat">${l.stat.toUpperCase()}</span>
          <span class="parlay-leg-line">${l.line}</span>
        </div>`;
        }).join('')
        : '<div class="parlay-slip-empty">Click legs on the left to build your parlay</div>';
    // Health display
    let healthHtml = '';
    if (health) {
        const alertsHtml = health.alerts.map(a => {
            const icon = a.type === 'synergy' ? '✓' : a.type === 'conflict' ? '✗' : a.type === 'caution' ? '⚠' : '○';
            return `<div class="parlay-corr-alert ${a.type}">${icon} ${a.message}</div>`;
        }).join('');
        healthHtml = `<div class="parlay-health">
      <div class="parlay-health-title">PARLAY HEALTH</div>
      <span class="parlay-health-score ${health.grade}">${health.score}</span>
      <span class="parlay-health-label">${health.grade.toUpperCase()} — ${health.legCount} legs, avg conf ${Math.round(health.avgConfidence)}%</span>
      ${alertsHtml ? `<div class="parlay-corr-list">${alertsHtml}</div>` : ''}
    </div>`;
    }
    // Suggested parlays
    let suggestHtml = '';
    if (suggestions.length > 0) {
        const cards = suggestions.map((s, i) => {
            const legsText = s.legs.map(l => `${l.fighter} <span class="parlay-leg-dir ${l.direction}" style="display:inline">${l.direction.toUpperCase()}</span> ${l.stat.toUpperCase()} ${l.line}`).join('<br>');
            const alertCount = s.health.alerts.filter(a => a.type === 'synergy').length;
            const conflictCount = s.health.alerts.filter(a => a.type === 'conflict').length;
            const tag = alertCount > 0 ? `${alertCount} synerg${alertCount > 1 ? 'ies' : 'y'}` : '';
            const cTag = conflictCount > 0 ? `${conflictCount} conflict${conflictCount > 1 ? 's' : ''}` : '';
            const tags = [tag, cTag].filter(Boolean).join(', ');
            const legsDataAttr = s.legs.map(l => parlayLegKey(l.fighter, l.stat, l.direction)).join(',');
            return `<div class="parlay-suggest-card" data-suggest-legs="${legsDataAttr}">
        <div class="parlay-suggest-label">#${i + 1} — Score: ${s.health.score} (${s.health.grade})</div>
        <div class="parlay-suggest-legs">${legsText}</div>
        <div class="parlay-suggest-score">Avg confidence: ${Math.round(s.health.avgConfidence)}%${tags ? ` · ${tags}` : ''}</div>
      </div>`;
        }).join('');
        suggestHtml = `<div class="parlay-suggest-section">
      <div class="parlay-suggest-title">AI SUGGESTED PARLAYS</div>
      ${cards}
    </div>`;
    }
    // Synergy pairs discovery
    const synergyPairs = findCorrelatedPairs(availableLegs);
    let synergyHtml = '';
    if (synergyPairs.length > 0) {
        const pairCards = synergyPairs.map(p => {
            const key1 = parlayLegKey(p.leg1.fighter, p.leg1.stat, p.leg1.direction);
            const key2 = parlayLegKey(p.leg2.fighter, p.leg2.stat, p.leg2.direction);
            const sel1 = parlaySelectedLegs.has(key1);
            const sel2 = parlaySelectedLegs.has(key2);
            const bothSelected = sel1 && sel2;
            const avgConf = Math.round((p.leg1.confidence + p.leg2.confidence) / 2);
            const impactPct = `+${(p.alert.impact * 100).toFixed(0)}%`;
            return `<div class="synergy-pair-card${bothSelected ? ' synergy-active' : ''}" data-synergy-key1="${key1}" data-synergy-key2="${key2}">
        <div class="synergy-pair-legs">
          <span class="synergy-pair-leg"><span class="parlay-leg-name">${prettyName(p.leg1.fighter)}</span> <span class="parlay-leg-dir ${p.leg1.direction}">${p.leg1.direction.toUpperCase()}</span> <span class="parlay-leg-stat">${p.leg1.stat.toUpperCase()}</span> <span class="parlay-leg-line">${p.leg1.line}</span></span>
          <span class="synergy-pair-plus">+</span>
          <span class="synergy-pair-leg"><span class="parlay-leg-name">${prettyName(p.leg2.fighter)}</span> <span class="parlay-leg-dir ${p.leg2.direction}">${p.leg2.direction.toUpperCase()}</span> <span class="parlay-leg-stat">${p.leg2.stat.toUpperCase()}</span> <span class="parlay-leg-line">${p.leg2.line}</span></span>
        </div>
        <div class="synergy-pair-reason">${p.alert.message}</div>
        <div class="synergy-pair-meta"><span class="synergy-pair-impact">${impactPct} health</span><span class="synergy-pair-conf">avg ${avgConf}%</span>${bothSelected ? '<span class="synergy-pair-added">IN SLIP</span>' : ''}</div>
      </div>`;
        }).join('');
        synergyHtml = `<div class="synergy-pairs-section">
      <div class="synergy-pairs-title">SYNERGY PAIRS</div>
      <div class="synergy-pairs-subtitle">Correlated legs — if one hits, the other likely does too</div>
      ${pairCards}
    </div>`;
    }
    container.innerHTML = `<div class="parlay-lab">
    <div class="parlay-lab-header">
      <div>
        <div class="parlay-lab-title">PARLAY LAB</div>
        <div class="parlay-lab-subtitle">Build multi-leg parlays with correlation analysis · ${availableLegs.length} available legs</div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">
        ${selectedLegs.length} leg${selectedLegs.length !== 1 ? 's' : ''} selected
      </div>
    </div>
    <div class="parlay-lab-cols">
      <div class="parlay-pool">
        <div class="parlay-pool-title">AVAILABLE LEGS (${availableLegs.length})</div>
        ${poolRows || '<div class="parlay-slip-empty">No leans calculated yet</div>'}
      </div>
      <div>
        <div class="parlay-builder">
          <div class="parlay-builder-title">YOUR PARLAY</div>
          <div class="parlay-slip">${slipRows}</div>
          ${healthHtml}
        </div>
        ${suggestHtml}
        ${synergyHtml}
      </div>
    </div>
  </div>`;
    // ── Bind click handlers ──
    hydrateAvatarImgs(container);
    container.querySelectorAll('.parlay-leg-row').forEach(row => {
        row.addEventListener('click', () => {
            const key = row.dataset['parlayKey'];
            if (!key)
                return;
            if (parlaySelectedLegs.has(key)) {
                parlaySelectedLegs.delete(key);
            }
            else {
                parlaySelectedLegs.add(key);
            }
            renderParlayLab(container);
        });
    });
    container.querySelectorAll('.parlay-slip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset['parlayRemove'];
            if (!key)
                return;
            parlaySelectedLegs.delete(key);
            renderParlayLab(container);
        });
    });
    container.querySelectorAll('.parlay-suggest-card').forEach(card => {
        card.addEventListener('click', () => {
            const legsStr = card.dataset['suggestLegs'] || '';
            parlaySelectedLegs.clear();
            for (const key of legsStr.split(',')) {
                if (key.trim())
                    parlaySelectedLegs.add(key.trim());
            }
            renderParlayLab(container);
        });
    });
    // Synergy pair click: add both legs to parlay (or remove if both already selected)
    container.querySelectorAll('.synergy-pair-card').forEach(card => {
        card.addEventListener('click', () => {
            const key1 = card.dataset['synergyKey1'] || '';
            const key2 = card.dataset['synergyKey2'] || '';
            if (!key1 || !key2)
                return;
            const bothSelected = parlaySelectedLegs.has(key1) && parlaySelectedLegs.has(key2);
            if (bothSelected) {
                parlaySelectedLegs.delete(key1);
                parlaySelectedLegs.delete(key2);
            }
            else {
                parlaySelectedLegs.add(key1);
                parlaySelectedLegs.add(key2);
            }
            renderParlayLab(container);
        });
    });
}
let _archiveAutoSettleFired = false;
let _archiveBiasSortKey = 'avgEdge';
const _archiveCollapsedSections = new Set();
// ── Cached backtest results (computed once per renderArchivePanel call) ────
let _cachedBacktestResults = null;
function computeBacktestFromHistory() {
    const engine = new BacktestingEngine();
    const eventsByDate = new Map();
    let totalPreds = 0;
    allFighters.forEach(f => {
        const line = activePlatformLine(f) ?? f.db?.avgFP ?? null;
        const history = (f.db?.history || []).filter(h => h.fp != null);
        if (!line || history.length < 7)
            return;
        for (let i = 6; i < history.length; i++) {
            const train = history.slice(Math.max(0, i - 6), i);
            const trainFP = train.map(h => h.fp || 0);
            if (!trainFP.length)
                continue;
            const mean = trainFP.reduce((s, v) => s + v, 0) / trainFP.length;
            const variance = trainFP.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / trainFP.length;
            const std = Math.max(8, Math.sqrt(variance));
            const overProb = 1 / (1 + Math.exp(-((mean - line) / std)));
            const lean = overProb > 0.52 ? 'over' : overProb < 0.48 ? 'under' : 'push';
            if (lean === 'push')
                continue;
            const confidence = Math.min(0.95, Math.abs(overProb - 0.5) * 2 + 0.45);
            const expectedValue = lean === 'over' ? overProb : 1 - overProb;
            const ts = history[i].date ? new Date(history[i].date).getTime() : (Date.now() - (history.length - i) * 86400000);
            const eventTs = Number.isFinite(ts) ? ts : Date.now();
            if (!eventsByDate.has(eventTs)) {
                eventsByDate.set(eventTs, { timestamp: eventTs, predictions: [], actualResults: [] });
            }
            const evt = eventsByDate.get(eventTs);
            evt.predictions.push({
                fighter: f.name, line,
                prediction: { lean, confidence, edge: Math.abs(overProb - 0.5) * 2, expectedValue }
            });
            evt.actualResults.push({ fighter: f.name, actualFP: history[i].fp || 0 });
            totalPreds++;
        }
    });
    const events = Array.from(eventsByDate.values())
        .filter(e => e.predictions.length > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
    if (events.length < 7)
        return null;
    const wf = engine.runWalkForwardValidation(events, 6);
    if (!wf.folds.length)
        return null;
    // Simulate bankroll curve from fold results (starting at $1000)
    let bankroll = 1000;
    const bankrollCurve = [{ fold: 0, bankroll: 1000 }];
    wf.folds.forEach((fold, idx) => {
        // Simple model: each fold, if accuracy > 50%, gain proportional to accuracy - 50%, else lose
        const edge = fold.accuracy - 0.5;
        const pnl = bankroll * 0.05 * (edge / 0.1) * (fold.testSize / Math.max(1, fold.testSize));
        bankroll += pnl;
        bankrollCurve.push({ fold: idx + 1, bankroll: Math.max(0, bankroll) });
    });
    return { wf, bankrollCurve, totalPreds, totalEvents: events.length };
}
const _h2hFighterMap = new Map();
// ── OPENING LINE TRACKER ───────────────────────────────────────────────────
const _openingLines = new Map();
let _openingLinesEventKey = '';
let _betrSeedHash = ''; // tracks which betr seed the baselines belong to
// Durable event tag written to every lines_open_v1 write. Mirrors the Betr reset
// rule (feedback_betr_reset_rule.md): the Betr seed's own event date is the only
// signal that can't drift across auto-advances. On load, a mismatch between the
// saved tag and the current betr_event_date means the baselines belong to a prior
// event and must be wiped along with line_history_v1.
let _currentBetrEventDate = '';
let _baselineCapturedAt = 0; // epoch ms when baselines were first created
const MAX_BASELINE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — auto-expire only across event cycles
// Inter-refresh delta: stores line values from the PREVIOUS refresh cycle.
// When a new refresh brings different values, the delta shows as a movement badge.
// This catches movements even when the opening baseline equals current values.
const _prevRefreshLines = new Map();
// ── LINE HISTORY TRACKER ─────────────────────────────────────────────────
const STORAGE_LINE_HISTORY_KEY = 'line_history_v1';
const LINE_HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h
let _lineHistory = { eventKey: '', updatedAt: 0, series: {} };
function openingLineKey(platform, stat, name) {
    return `${platform}|${stat}|${name.toLowerCase().trim()}`;
}
// Maximum plausible line movement per stat type. Anything beyond this is a
// stale/corrupt baseline and should be discarded rather than displayed.
const MAX_PLAUSIBLE_DELTA = { fp: 12, ss: 15, td: 3, ft: 5, ctrl: 4 };
/** Returns true when a stored opening value is plausible for its stat type. */
function isPlausibleBaseline(stat, value) {
    if (!Number.isFinite(value) || value < 0)
        return false;
    if (stat === 'ft' && value > 25)
        return false; // FT lines are 0–25 min
    if (stat === 'td' && value > 15)
        return false; // TD lines are 0–15
    if (stat === 'ss' && value > 250)
        return false; // SS lines are 0–~200
    if (stat === 'fp' && value > 250)
        return false; // FP lines are 0–~200
    if (stat === 'ctrl' && value > 25)
        return false; // CTRL lines are 0–25 min (theoretical max in a 5R fight)
    return true;
}
/** Returns null if delta exceeds plausible range for the stat type. */
function sanitizeDelta(stat, delta) {
    if (delta == null)
        return null;
    const cap = MAX_PLAUSIBLE_DELTA[stat] ?? 30;
    return Math.abs(delta) <= cap ? delta : null;
}
// Builds the persistence payload for lines_open_v1, stamped with the current
// Betr event-date tag so loadOpeningLines can detect cross-event staleness.
function buildOpeningLinesRecord(overrideLines) {
    let lines;
    if (overrideLines) {
        lines = overrideLines;
    }
    else {
        lines = {};
        _openingLines.forEach((v, k) => { lines[k] = v; });
    }
    return {
        eventKey: _openingLinesEventKey,
        betrSeedHash: _betrSeedHash,
        forBetrEventDate: _currentBetrEventDate,
        capturedAt: _baselineCapturedAt || Date.now(),
        lines,
    };
}
async function loadOpeningLines() {
    const stored = await storageGet(['lines_open_v1', 'betr_seed_hash', 'betr_event_date', STORAGE_LINE_HISTORY_KEY]);
    _currentBetrEventDate = typeof stored.betr_event_date === 'string' ? stored.betr_event_date : '';
    const data = stored.lines_open_v1;
    const historyRaw = stored[STORAGE_LINE_HISTORY_KEY];
    // Cross-event staleness wipe. The Betr seed's event date (written by
    // initializeBetrLines in background.ts via BETR_EVENT_DATE) is the durable
    // "which event does this belong to" tag — it can't drift when the analyzer
    // auto-advances. Wipe conditions (ANY of):
    //   1. Migration: baseline has no forBetrEventDate tag (saved before this fix).
    //   2. Event change: baseline's tag doesn't match the current seed's date.
    //   3. Same checks applied to line_history_v1 — otherwise the reconstruction
    //      path below resurrects stale history into fresh baselines.
    const isStale = (tag) => {
        if (tag === undefined || tag === null)
            return true; // migration — no tag
        if (typeof tag !== 'string')
            return true; // corrupt
        return tag !== _currentBetrEventDate; // tag mismatch
    };
    const baselineStale = !!data?.lines && isStale(data.forBetrEventDate);
    const historyStale = !!historyRaw?.series && Object.keys(historyRaw.series).length > 0
        && isStale(historyRaw.forBetrEventDate);
    if (baselineStale || historyStale) {
        console.log(`[LineMovement] Stale (baseline=${baselineStale}, history=${historyStale}, currentBetrDate="${_currentBetrEventDate}") — wiping lines_open_v1 + line_history_v1`);
        await storageSet({ lines_open_v1: null, [STORAGE_LINE_HISTORY_KEY]: null });
        _lineHistory = { eventKey: '', updatedAt: 0, forBetrEventDate: _currentBetrEventDate, series: {} };
        _openingLines.clear();
        _prevRefreshLines.clear();
        _baselineCapturedAt = 0;
        _openingLinesEventKey = '';
        return;
    }
    // If no baselines exist, try to reconstruct from line history (earliest data points)
    if (!data?.lines) {
        const history = stored[STORAGE_LINE_HISTORY_KEY];
        if (history?.series && Object.keys(history.series).length > 0) {
            console.log('[LineMovement] No baselines found — reconstructing from line history');
            const reconstructed = {};
            let minT = Infinity;
            for (const [seriesKey, entries] of Object.entries(history.series)) {
                if (!entries?.length)
                    continue;
                const earliest = entries[0];
                if (earliest.t < minT)
                    minT = earliest.t;
                const parts = seriesKey.split('|');
                const name = parts[0];
                const stat = parts[1];
                if (!name || !stat)
                    continue;
                for (const [platform, value] of Object.entries(earliest.v)) {
                    if (typeof value !== 'number' || !Number.isFinite(value))
                        continue;
                    if (!isPlausibleBaseline(stat, value))
                        continue;
                    reconstructed[`${platform}|${stat}|${name}`] = value;
                }
            }
            if (Object.keys(reconstructed).length > 0) {
                _baselineCapturedAt = minT === Infinity ? Date.now() : minT;
                _openingLinesEventKey = history.eventKey || '';
                _betrSeedHash = stored.betr_seed_hash || '';
                for (const [k, v] of Object.entries(reconstructed)) {
                    _openingLines.set(k, v);
                }
                void storageSet({ lines_open_v1: buildOpeningLinesRecord(reconstructed) });
                console.log(`[LineMovement] Reconstructed ${Object.keys(reconstructed).length} baselines from line history`);
            }
        }
        return;
    }
    // Auto-expire baselines that are older than MAX_BASELINE_AGE_MS
    const storedCapturedAt = data.capturedAt || 0;
    if (storedCapturedAt > 0 && (Date.now() - storedCapturedAt) > MAX_BASELINE_AGE_MS) {
        console.log(`[LineMovement] Baselines expired (age ${((Date.now() - storedCapturedAt) / 3600000).toFixed(1)}h > ${MAX_BASELINE_AGE_MS / 3600000}h) — clearing`);
        void storageSet({ lines_open_v1: null });
        // Try to reconstruct from history instead of losing everything
        const history = stored[STORAGE_LINE_HISTORY_KEY];
        if (history?.series && Object.keys(history.series).length > 0) {
            console.log('[LineMovement] Reconstructing expired baselines from line history');
            const reconstructed = {};
            let minT = Infinity;
            for (const [seriesKey, entries] of Object.entries(history.series)) {
                if (!entries?.length)
                    continue;
                const earliest = entries[0];
                if (earliest.t < minT)
                    minT = earliest.t;
                const parts = seriesKey.split('|');
                const name = parts[0];
                const stat = parts[1];
                if (!name || !stat)
                    continue;
                for (const [platform, value] of Object.entries(earliest.v)) {
                    if (typeof value !== 'number' || !Number.isFinite(value))
                        continue;
                    if (!isPlausibleBaseline(stat, value))
                        continue;
                    reconstructed[`${platform}|${stat}|${name}`] = value;
                }
            }
            if (Object.keys(reconstructed).length > 0) {
                _baselineCapturedAt = Date.now(); // reset age since we're reconstructing
                _openingLinesEventKey = history.eventKey || '';
                _betrSeedHash = stored.betr_seed_hash || '';
                for (const [k, v] of Object.entries(reconstructed)) {
                    _openingLines.set(k, v);
                }
                void storageSet({ lines_open_v1: buildOpeningLinesRecord(reconstructed) });
                console.log(`[LineMovement] Reconstructed ${Object.keys(reconstructed).length} baselines from history`);
            }
        }
        return;
    }
    _baselineCapturedAt = storedCapturedAt;
    _openingLinesEventKey = data.eventKey || '';
    // Compare the betr seed hash (set by initializeBetrLines in background.ts)
    // with the hash stored alongside the baselines. If they differ, the hardcoded
    // seed changed (new event) and betr baselines are stale → skip them.
    // If they match, the baselines were created for the current seed → load normally.
    const currentSeedHash = stored.betr_seed_hash || '';
    _betrSeedHash = currentSeedHash;
    const baselineSeedHash = data.betrSeedHash || '';
    const betrBaselinesStale = currentSeedHash !== baselineSeedHash;
    let hadStaleBetrKeys = false;
    for (const [k, v] of Object.entries(data.lines)) {
        if (k.startsWith('betr|') && betrBaselinesStale) {
            hadStaleBetrKeys = true;
            continue;
        }
        if (!Number.isFinite(v))
            continue;
        const stat = k.split('|')[1] || '';
        if (!isPlausibleBaseline(stat, v))
            continue;
        if (!_openingLines.has(k)) {
            _openingLines.set(k, v);
        }
    }
    // Clean stale betr keys out of persisted storage and update the seed hash
    if (hadStaleBetrKeys) {
        const cleaned = {};
        for (const [k, v] of Object.entries(data.lines)) {
            if (!k.startsWith('betr|'))
                cleaned[k] = v;
        }
        void storageSet({ lines_open_v1: buildOpeningLinesRecord(cleaned) });
    }
}
function normalizeEventKey(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function snapshotOpeningLines() {
    // The gate is narrowly about Betr's abbreviated names ("C. Duncan") — they
    // create orphaned keys when a later full-name load arrives. So skip only when
    // Betr is the ONLY platform with data; any non-Betr platform alone (UD, P6,
    // PP, DK) is safe to snapshot because those use full names.
    const _snapshotPlats = new Set();
    for (const f of allFighters) {
        if (f.line_p6 != null || f.line_p6_ss != null || f.line_p6_td != null || f.line_p6_ft != null)
            _snapshotPlats.add('p6');
        if (f.line_ud != null || f.line_ud_ss != null || f.line_ud_td != null || f.line_ud_ft != null)
            _snapshotPlats.add('ud');
        if (f.line_betr != null || f.line_betr_ss != null || f.line_betr_td != null || f.line_betr_ft != null)
            _snapshotPlats.add('betr');
        if (f.line_pp != null || f.line_pp_ss != null || f.line_pp_td != null || f.line_pp_ft != null)
            _snapshotPlats.add('pp');
        if (f.line_dk_ss != null || f.line_dk_td != null || f.line_dk_ft != null)
            _snapshotPlats.add('dk');
    }
    if (_snapshotPlats.size === 0)
        return;
    if (_snapshotPlats.size === 1 && _snapshotPlats.has('betr'))
        return;
    const eventKey = inferredEventNameFromLines || 'unknown';
    // Only reset opening lines when the event genuinely changes (normalized match).
    // Never clear if stored key is empty (first session) or current key is unknown.
    const storedNorm = normalizeEventKey(_openingLinesEventKey);
    const currentNorm = normalizeEventKey(eventKey);
    if (currentNorm !== 'unknown' && storedNorm !== '' && currentNorm !== storedNorm) {
        // Before clearing, check if current fighters overlap with existing baseline.
        // During clear+re-fetch, platforms arrive one-by-one and inferEventNameFromPayloads
        // can flicker to a different "best pair" from partial data. Only truly clear if
        // the fighters themselves changed (<20% overlap = genuinely new event).
        let overlapHits = 0;
        let overlapTotal = 0;
        for (const fighter of allFighters) {
            const fpKey = openingLineKey('p6', 'fp', fighter.name);
            const ssKey = openingLineKey('p6', 'ss', fighter.name);
            const btKey = openingLineKey('betr', 'fp', fighter.name);
            overlapTotal++;
            if (_openingLines.has(fpKey) || _openingLines.has(ssKey) || _openingLines.has(btKey))
                overlapHits++;
        }
        const overlapRate = overlapTotal > 0 ? overlapHits / overlapTotal : 0;
        if (overlapRate < 0.2) {
            // Truly different event — clear baseline
            _openingLines.clear();
            _prevRefreshLines.clear();
            _openingLinesEventKey = eventKey;
            _baselineCapturedAt = 0;
            clearLineHistory();
        }
        // Otherwise: same fighters, event name flickered from partial data — keep baseline
    }
    else if (currentNorm !== 'unknown' && storedNorm === '') {
        _openingLinesEventKey = eventKey;
    }
    const platformStats = [
        ['p6', 'fp', f => f.line_p6],
        ['p6', 'ss', f => f.line_p6_ss],
        ['p6', 'td', f => f.line_p6_td],
        ['p6', 'ft', f => f.line_p6_ft],
        ['ud', 'fp', f => f.line_ud],
        ['ud', 'ss', f => f.line_ud_ss],
        ['ud', 'td', f => f.line_ud_td],
        ['ud', 'ft', f => f.line_ud_ft],
        ['pp', 'fp', f => f.line_pp],
        ['pp', 'ss', f => f.line_pp_ss],
        ['pp', 'td', f => f.line_pp_td],
        ['pp', 'ft', f => f.line_pp_ft],
        ['betr', 'fp', f => f.line_betr],
        ['betr', 'ss', f => f.line_betr_ss],
        ['betr', 'td', f => f.line_betr_td],
        ['betr', 'ft', f => f.line_betr_ft],
        ['dk', 'ss', f => f.line_dk_ss],
        ['dk', 'td', f => f.line_dk_td],
        ['dk', 'ft', f => f.line_dk_ft],
    ];
    // Collect current fighter names (full-form) to detect orphaned abbreviated-name keys
    const currentNames = new Set(allFighters.map(f => f.name.toLowerCase().trim()));
    let changed = false;
    for (const fighter of allFighters) {
        for (const [plat, stat, getVal] of platformStats) {
            const val = getVal(fighter);
            if (val == null || !isPlausibleBaseline(stat, val))
                continue;
            const key = openingLineKey(plat, stat, fighter.name);
            if (_openingLines.get(key) == null) {
                _openingLines.set(key, val);
                changed = true;
            }
        }
    }
    // Clean up orphaned keys from prior partial-load snapshots (abbreviated names
    // like "c. duncan" that no longer match any current fighter "chris duncan").
    for (const key of [..._openingLines.keys()]) {
        const namePart = key.split('|')[2];
        if (namePart && !currentNames.has(namePart)) {
            _openingLines.delete(key);
            changed = true;
        }
    }
    if (changed || _openingLines.size > 0) {
        if (_baselineCapturedAt === 0)
            _baselineCapturedAt = Date.now();
        void storageSet({ lines_open_v1: buildOpeningLinesRecord() });
    }
}
// Post-merge movement detection: called AFTER mergeAndEnrich() with the NEW allFighters.
// Compares new values against _prevRefreshLines (the previous cycle's values).
// For any key where the value changed, records the OLD value into _openingLines
// (if not already tracked) so the movement persists in the storage-backed baseline.
// Then updates _prevRefreshLines to the new values for the next cycle.
function detectAndRecordMovements() {
    if (allFighters.length === 0)
        return;
    const platformStats = [
        ['p6', 'fp', f => f.line_p6], ['p6', 'ss', f => f.line_p6_ss],
        ['p6', 'td', f => f.line_p6_td], ['p6', 'ft', f => f.line_p6_ft],
        ['ud', 'fp', f => f.line_ud], ['ud', 'ss', f => f.line_ud_ss],
        ['ud', 'td', f => f.line_ud_td], ['ud', 'ft', f => f.line_ud_ft],
        ['pp', 'fp', f => f.line_pp], ['pp', 'ss', f => f.line_pp_ss],
        ['pp', 'td', f => f.line_pp_td], ['pp', 'ft', f => f.line_pp_ft],
        ['betr', 'fp', f => f.line_betr], ['betr', 'ss', f => f.line_betr_ss],
        ['betr', 'td', f => f.line_betr_td], ['betr', 'ft', f => f.line_betr_ft],
        ['dk', 'ss', f => f.line_dk_ss], ['dk', 'td', f => f.line_dk_td],
        ['dk', 'ft', f => f.line_dk_ft],
    ];
    let baselineRepaired = false;
    for (const fighter of allFighters) {
        for (const [plat, stat, getVal] of platformStats) {
            const newVal = getVal(fighter);
            if (newVal == null)
                continue;
            const key = openingLineKey(plat, stat, fighter.name);
            const prevVal = _prevRefreshLines.get(key);
            if (prevVal != null && isPlausibleBaseline(stat, prevVal) && sanitizeDelta(stat, newVal - prevVal) != null && Math.abs(newVal - prevVal) >= 0.5) {
                // Delta-0 baseline repair only. The baseline must already exist AND be
                // captured at the post-move value — in that case we rewrite it to the
                // pre-move prev-refresh value so the badge shows correctly on the next
                // render. If no baseline exists yet, do NOT create one from prev-refresh:
                // prev-refresh is a within-session snapshot, not an authoritative opening.
                const openVal = _openingLines.get(key);
                if (openVal != null && Math.abs(openVal - newVal) < 0.5) {
                    _openingLines.set(key, prevVal);
                    baselineRepaired = true;
                }
            }
            // Always update _prevRefreshLines to current values for next cycle
            _prevRefreshLines.set(key, newVal);
        }
    }
    if (baselineRepaired) {
        // Persist repaired baselines to storage
        if (_baselineCapturedAt === 0)
            _baselineCapturedAt = Date.now();
        void storageSet({ lines_open_v1: buildOpeningLinesRecord() });
    }
}
// Legacy name kept for call sites — now a no-op since detection moved to post-merge.
function snapshotPrevRefreshLines() {
    // Intentionally empty — movement detection now happens in detectAndRecordMovements()
    // called AFTER mergeAndEnrich. This function exists only to avoid breaking call sites.
}
// ── LINE HISTORY PERSISTENCE ─────────────────────────────────────────────
function lineHistoryKey(name, stat) {
    return `${name.toLowerCase().trim()}|${stat}`;
}
async function loadLineHistory() {
    const stored = await storageGet([STORAGE_LINE_HISTORY_KEY]);
    const data = stored[STORAGE_LINE_HISTORY_KEY];
    if (!data?.series)
        return;
    // Same forBetrEventDate staleness check as loadOpeningLines — if loadOpeningLines
    // didn't already wipe it (because its own check path was skipped), catch it here.
    const histTag = data.forBetrEventDate;
    if (histTag === undefined || histTag === null || typeof histTag !== 'string' || histTag !== _currentBetrEventDate) {
        console.log(`[LineMovement] loadLineHistory: stale (tag="${histTag}" ≠ current="${_currentBetrEventDate}") — clearing`);
        _lineHistory = { eventKey: '', updatedAt: 0, forBetrEventDate: _currentBetrEventDate, series: {} };
        await storageSet({ [STORAGE_LINE_HISTORY_KEY]: null });
        return;
    }
    const currentNorm = normalizeEventKey(_openingLinesEventKey || '');
    const storedNorm = normalizeEventKey(data.eventKey || '');
    if (currentNorm !== 'unknown' && storedNorm !== '' && currentNorm !== storedNorm) {
        // Different event — start fresh
        return;
    }
    _lineHistory = data;
    // Prune old points
    const cutoff = Date.now() - LINE_HISTORY_MAX_AGE_MS;
    for (const key of Object.keys(_lineHistory.series)) {
        _lineHistory.series[key] = _lineHistory.series[key].filter(p => p.t >= cutoff);
        if (_lineHistory.series[key].length === 0)
            delete _lineHistory.series[key];
    }
}
function getLineHistoryForFighter(name, stat) {
    return _lineHistory.series[lineHistoryKey(name, stat)] || [];
}
function snapshotLineHistory() {
    if (allFighters.length === 0)
        return;
    // Same gate as snapshotOpeningLines — only skip when Betr is the sole platform.
    const plats = new Set();
    for (const f of allFighters) {
        if (f.line_p6 != null || f.line_p6_ss != null)
            plats.add('p6');
        if (f.line_ud != null || f.line_ud_ss != null)
            plats.add('ud');
        if (f.line_betr != null || f.line_betr_ss != null)
            plats.add('betr');
        if (f.line_pp != null || f.line_pp_ss != null)
            plats.add('pp');
        if (f.line_dk_ss != null)
            plats.add('dk');
    }
    if (plats.size === 0)
        return;
    if (plats.size === 1 && plats.has('betr'))
        return;
    const now = Date.now();
    const cutoff = now - LINE_HISTORY_MAX_AGE_MS;
    const eventKey = _openingLinesEventKey || inferredEventNameFromLines || 'unknown';
    // If event changed, clear history
    const curNorm = normalizeEventKey(eventKey);
    const storedNorm = normalizeEventKey(_lineHistory.eventKey || '');
    if (curNorm !== 'unknown' && storedNorm !== '' && curNorm !== storedNorm) {
        _lineHistory = { eventKey, updatedAt: now, forBetrEventDate: _currentBetrEventDate, series: {} };
    }
    _lineHistory.eventKey = eventKey;
    _lineHistory.forBetrEventDate = _currentBetrEventDate;
    const statGetters = [
        ['fp', f => [['p6', f.line_p6], ['ud', f.line_ud], ['pp', f.line_pp], ['betr', f.line_betr]]],
        ['ss', f => [['p6', f.line_p6_ss], ['ud', f.line_ud_ss], ['pp', f.line_pp_ss], ['betr', f.line_betr_ss], ['dk', f.line_dk_ss]]],
        ['td', f => [['p6', f.line_p6_td], ['ud', f.line_ud_td], ['pp', f.line_pp_td], ['betr', f.line_betr_td], ['dk', f.line_dk_td]]],
        ['ft', f => [['p6', f.line_p6_ft], ['ud', f.line_ud_ft], ['pp', f.line_pp_ft], ['betr', f.line_betr_ft], ['dk', f.line_dk_ft]]],
    ];
    let changed = false;
    for (const fighter of allFighters) {
        for (const [stat, getVals] of statGetters) {
            const vals = getVals(fighter);
            const platVals = {};
            for (const [plat, val] of vals) {
                if (val != null)
                    platVals[plat] = val;
            }
            if (Object.keys(platVals).length === 0)
                continue;
            const key = lineHistoryKey(fighter.name, stat);
            if (!_lineHistory.series[key])
                _lineHistory.series[key] = [];
            const series = _lineHistory.series[key];
            // Dedup: skip if identical to last point
            const last = series[series.length - 1];
            if (last) {
                const lastKeys = Object.keys(last.v).sort();
                const newKeys = Object.keys(platVals).sort();
                if (lastKeys.join(',') === newKeys.join(',') && lastKeys.every(k => last.v[k] === platVals[k])) {
                    continue;
                }
            }
            series.push({ t: now, v: platVals });
            changed = true;
            // Prune old points
            while (series.length > 0 && series[0].t < cutoff)
                series.shift();
        }
    }
    if (changed) {
        _lineHistory.updatedAt = now;
        void storageSet({ [STORAGE_LINE_HISTORY_KEY]: _lineHistory });
    }
}
function clearLineHistory() {
    _lineHistory = { eventKey: '', updatedAt: 0, forBetrEventDate: _currentBetrEventDate, series: {} };
    void storageSet({ [STORAGE_LINE_HISTORY_KEY]: _lineHistory });
}
// ── PROP LINE PREDICTOR ──────────────────────────────────────────────────
let _cachedPredictions = null;
let _cachedLearningLog = null;
async function generatePredictions(container) {
    // Always force-refresh to get the nearest upcoming event (not a stale cached card)
    showToast('Fetching upcoming card...');
    await syncUpcomingCardContext(true);
    if (!upcomingCardPairs.length) {
        showToast('No upcoming card detected — no events found on UFCStats');
        return;
    }
    showToast(`Generating predictions for ${upcomingCardPairs.length} fights...`);
    const weights = await PropLinePredictorService.getWeights();
    const trends = await PropLinePredictorService.getTrends();
    // Load prop archive once — used for per-fighter bookmaker FP priors.
    const archiveRaw = await new Promise(res => chrome.storage.local.get(['prop_archive_v1'], res));
    const propArchive = Array.isArray(archiveRaw.prop_archive_v1) ? archiveRaw.prop_archive_v1 : [];
    const predictions = [];
    const headliner = findHeadlinerPair();
    for (const pair of upcomingCardPairs) {
        const isMainEvent = headliner != null && headliner.f1 === pair.f1 && headliner.f2 === pair.f2;
        const rounds = isMainEvent ? 5 : 3;
        // Fetch UFCStats data for both fighters (uses 24h cache)
        const [f1Stats, f2Stats] = await Promise.all([
            fetchFromUFCStats(pair.f1),
            fetchFromUFCStats(pair.f2),
        ]);
        const f1DB = buildFighterDB(pair.f1, f1Stats);
        const f2DB = buildFighterDB(pair.f2, f2Stats);
        const f1Trend = PropLinePredictorService.findTrend(trends, pair.f1);
        const f2Trend = PropLinePredictorService.findTrend(trends, pair.f2);
        const f1Book = PropLinePredictorService.computeBookPriorFP(propArchive, pair.f1);
        const f2Book = PropLinePredictorService.computeBookPriorFP(propArchive, pair.f2);
        predictions.push(PropLinePredictorService.predictFighter(pair.f1, pair.f2, f1DB, f2DB, rounds, weights, f1Trend, pair.weightClass, f1Book));
        predictions.push(PropLinePredictorService.predictFighter(pair.f2, pair.f1, f2DB, f1DB, rounds, weights, f2Trend, pair.weightClass, f2Book));
    }
    const eventName = upcomingEventName || 'Unknown Event';
    const predEvent = {
        event: eventName,
        date: new Date().toISOString(),
        generatedAt: Date.now(),
        predictions,
        settled: false,
    };
    // Save (append, cap at 10)
    const existing = await PropLinePredictorService.getPredictions();
    // Replace if same event already exists
    const idx = existing.findIndex(e => e.event === eventName);
    if (idx >= 0)
        existing[idx] = predEvent;
    else
        existing.push(predEvent);
    await PropLinePredictorService.savePredictions(existing);
    _cachedPredictions = null;
    showToast(`✓ ${predictions.length} predictions generated for ${eventName}`);
    void renderArchivePanel(container);
}
function renderPredictionsHtml(cSec) {
    const preds = _cachedPredictions ?? [];
    const log = _cachedLearningLog ?? [];
    // Find latest prediction event
    const latest = preds.length > 0 ? preds[preds.length - 1] : null;
    // Prediction table
    let predBody = '';
    if (latest && latest.predictions.length > 0) {
        const age = Date.now() - latest.generatedAt;
        const agoLabel = age < 3600000 ? `${Math.round(age / 60000)}m ago` : `${Math.round(age / 3600000)}h ago`;
        const rows = latest.predictions.map(p => {
            const ssArrow = p.ss.lean === 'over' ? '▲' : '▼';
            const tdArrow = p.td.lean === 'over' ? '▲' : '▼';
            const fpArrow = p.fantasy.lean === 'over' ? '▲' : '▼';
            const ssColor = p.ss.lean === 'over' ? 'var(--green)' : 'var(--red)';
            const tdColor = p.td.lean === 'over' ? 'var(--green)' : 'var(--red)';
            const fpColor = p.fantasy.lean === 'over' ? 'var(--green)' : 'var(--red)';
            const confWidth = Math.round(p.fantasy.confidence);
            const confColor = confWidth >= 65 ? 'var(--green)' : confWidth >= 45 ? 'var(--amber)' : 'var(--red)';
            const reasons = [...p.ss.reasons.slice(0, 2), ...p.td.reasons.slice(0, 1), ...p.fantasy.reasons.slice(0, 2)]
                .map(r => `<span style="display:inline-block;font-size:9px;color:var(--text-muted);background:rgba(255,255,255,0.04);padding:1px 5px;border-radius:3px;margin:1px 2px">${r}</span>`).join('');
            return `<div class="pred-row" data-jump="${p.fighter}" title="Open fighter card">
        <div class="pred-fighter"><span class="bp-avatar bp-avatar-sm"><span class="bp-avatar-flag">🥊</span><img class="bp-avatar-img" data-name="${p.fighter}" alt="" /></span><div style="min-width:0"><div style="font-size:11px;font-weight:600;color:var(--text)">${prettyName(p.fighter)}</div><div style="font-size:9px;color:var(--text-muted)">vs ${prettyName(p.opponent)} · ${p.scheduledRounds}R</div></div></div>
        <div style="min-width:55px;text-align:center"><div style="font-size:10px;color:var(--text-muted)">SS</div><div style="font-size:12px;font-weight:700;color:${ssColor}">${p.ss.line} ${ssArrow}</div></div>
        <div style="min-width:45px;text-align:center"><div style="font-size:10px;color:var(--text-muted)">TD</div><div style="font-size:12px;font-weight:700;color:${tdColor}">${p.td.line} ${tdArrow}</div></div>
        <div style="min-width:55px;text-align:center"><div style="font-size:10px;color:var(--text-muted)">FP</div><div style="font-size:12px;font-weight:700;color:${fpColor}">${p.fantasy.line} ${fpArrow}</div></div>
        <div style="min-width:70px"><div style="font-size:10px;color:var(--text-muted)">Conf</div><div style="background:rgba(255,255,255,0.06);border-radius:3px;height:10px;margin-top:2px;overflow:hidden"><div style="width:${confWidth}%;height:100%;background:${confColor};border-radius:3px"></div></div><div style="font-size:9px;color:${confColor};margin-top:1px">${confWidth}%</div></div>
        <div style="flex:1;min-width:0"><div style="display:flex;flex-wrap:wrap;margin-top:2px">${reasons}</div></div>
      </div>`;
        }).join('');
        predBody = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <button id="predictorGenerateBtn" class="btn btn-sm" style="background:var(--accent);color:#fff;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600">⚡ Generate Predictions</button>
      <span style="font-size:10px;color:var(--text-muted)">Generated ${agoLabel}${latest.settled ? ' · settled' : ''}</span>
    </div>
    <div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px">
      <div style="min-width:110px;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Fighter</div>
      <div style="min-width:55px;text-align:center;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">SS</div>
      <div style="min-width:45px;text-align:center;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">TD</div>
      <div style="min-width:55px;text-align:center;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">FP</div>
      <div style="min-width:70px;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Conf</div>
      <div style="flex:1;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Factors</div>
    </div>
    ${rows}`;
    }
    else {
        predBody = `<div style="text-align:center;padding:16px 0">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${upcomingCardPairs.length > 0 ? `${upcomingCardPairs.length} fights detected on upcoming card` : 'No upcoming card detected yet'}</div>
      <button id="predictorGenerateBtn" class="btn btn-sm" style="background:var(--accent);color:#fff;padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600">⚡ Generate Predictions</button>
    </div>`;
    }
    const predCount = latest ? `${latest.predictions.length} fighters · ${latest.event}` : 'no predictions yet';
    // Learning summary
    let learnBody = '';
    const latestLearn = log.length > 0 ? log[log.length - 1] : null;
    if (latestLearn) {
        const s = latestLearn.summary;
        const wAdj = Object.entries(s.weightAdjustments)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v > 0 ? '+' : ''}${v.toFixed(2)}`)
            .join(', ') || 'none';
        const deltaRows = latestLearn.predictions
            .filter(p => Number.isFinite(p.delta.ss) || Number.isFinite(p.delta.fp))
            .map(p => {
            const ssDelta = Number.isFinite(p.delta.ss) ? `${p.delta.ss > 0 ? '+' : ''}${p.delta.ss.toFixed(1)}` : '—';
            const tdDelta = Number.isFinite(p.delta.td) ? `${p.delta.td > 0 ? '+' : ''}${p.delta.td.toFixed(1)}` : '—';
            const fpDelta = Number.isFinite(p.delta.fp) ? `${p.delta.fp > 0 ? '+' : ''}${p.delta.fp.toFixed(1)}` : '—';
            const totalErr = Math.abs(p.delta.ss || 0) + Math.abs(p.delta.td || 0) + Math.abs(p.delta.fp || 0);
            const errColor = totalErr < 15 ? 'var(--green)' : totalErr < 30 ? 'var(--amber)' : 'var(--red)';
            const barPct = Math.min(100, (totalErr / 45) * 100);
            return `<div class="learn-delta-row" style="display:flex;gap:8px;align-items:center;padding:5px 4px;font-size:10px;border-bottom:1px solid rgba(255,255,255,0.04);border-radius:4px;transition:background 120ms" onmouseover="this.style.background='rgba(255,255,255,0.025)'" onmouseout="this.style.background='transparent'">
          <span class="learn-delta-name" style="min-width:100px;color:var(--text);font-weight:500">${p.fighter}</span>
          <span style="min-width:50px;color:var(--text-muted);font-variant-numeric:tabular-nums">SS ${ssDelta}</span>
          <span style="min-width:50px;color:var(--text-muted);font-variant-numeric:tabular-nums">TD ${tdDelta}</span>
          <span style="min-width:50px;color:var(--text-muted);font-variant-numeric:tabular-nums">FP ${fpDelta}</span>
          <div class="learn-delta-bar" style="flex:1;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;min-width:36px" title="|Δ| magnitude">
            <div style="height:100%;width:${barPct.toFixed(0)}%;background:${errColor};border-radius:2px"></div>
          </div>
          <span class="learn-delta-total" style="color:${errColor};font-variant-numeric:tabular-nums;min-width:42px;text-align:right;font-weight:600">±${totalErr.toFixed(1)}</span>
        </div>`;
        }).join('');
        // A past-event prediction that hasn't been learned from yet — surface the
        // button even when prior learning history exists, so each settled event can
        // be absorbed without re-checking whether the log is empty.
        const pendingLearn = preds.find(p => !p.settled &&
            p.event !== (upcomingEventName || '').trim() &&
            p.event !== upcomingEventName);
        const pendingBanner = pendingLearn ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:10px;background:rgba(56,176,0,0.08);border:1px solid rgba(56,176,0,0.3);border-radius:6px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--text);flex:1;min-width:160px">Predictions for "${pendingLearn.event}" ready for learning</span>
      <button id="predictorLearnBtn" class="btn btn-sm" style="background:var(--green);color:#000;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600">▶ Run Learning Cycle</button>
      <button id="predictorDeleteBtn" class="btn btn-sm" style="background:none;border:1px solid var(--text-muted);color:var(--text-muted);padding:3px 10px;border-radius:6px;cursor:pointer;font-size:10px" title="Delete these predictions">✕ Delete</button>
    </div>` : '';
        const chipColor = (v) => v < 8 ? 'var(--green)' : v < 16 ? 'var(--amber)' : 'var(--red)';
        const chipGrade = (v) => v < 8 ? 'good' : v < 16 ? 'mid' : 'bad';
        const statChip = (label, val) => {
            const c = chipColor(val);
            const g = chipGrade(val);
            const pct = Math.min(100, Math.round((val / 40) * 100));
            return `<div class="learn-stat-chip" data-grade="${g}">
        <div class="learn-chip-header"><span class="learn-chip-dot" style="background:${c}"></span><span class="learn-chip-label">Avg |Δ| ${label}</span></div>
        <span class="learn-chip-value" style="color:${c}">±${val.toFixed(1)}</span>
        <div class="learn-chip-bar-track"><div class="learn-chip-bar-fill" style="width:${pct}%;background:${c}"></div></div>
      </div>`;
        };
        const overallAvg = (s.avgAbsDeltaSS + s.avgAbsDeltaTD + s.avgAbsDeltaFP) / 3;
        const overallGrade = overallAvg < 10 ? 'A' : overallAvg < 18 ? 'B' : overallAvg < 28 ? 'C' : 'D';
        const overallColor = overallAvg < 10 ? 'var(--green)' : overallAvg < 18 ? 'var(--amber)' : 'var(--red)';
        const sortedDeltas = latestLearn.predictions
            .filter(p => Number.isFinite(p.delta.ss) || Number.isFinite(p.delta.fp))
            .map(p => {
            const totalErr = Math.abs(p.delta.ss || 0) + Math.abs(p.delta.td || 0) + Math.abs(p.delta.fp || 0);
            return { ...p, totalErr };
        })
            .sort((a, b) => a.totalErr - b.totalErr);
        const rankedRows = sortedDeltas.map((p, idx) => {
            const ssDelta = Number.isFinite(p.delta.ss) ? `${p.delta.ss > 0 ? '+' : ''}${p.delta.ss.toFixed(1)}` : '—';
            const tdDelta = Number.isFinite(p.delta.td) ? `${p.delta.td > 0 ? '+' : ''}${p.delta.td.toFixed(1)}` : '—';
            const fpDelta = Number.isFinite(p.delta.fp) ? `${p.delta.fp > 0 ? '+' : ''}${p.delta.fp.toFixed(1)}` : '—';
            const errColor = p.totalErr < 15 ? 'var(--green)' : p.totalErr < 30 ? 'var(--amber)' : 'var(--red)';
            const barPct = Math.min(100, (p.totalErr / 45) * 100);
            const g = p.totalErr < 15 ? 'good' : p.totalErr < 30 ? 'mid' : 'bad';
            return `<div class="learn-delta-row" data-grade="${g}">
        <span class="learn-delta-rank">${idx + 1}</span>
        <span class="learn-delta-name">${p.fighter}</span>
        <span class="learn-delta-stat">SS ${ssDelta}</span>
        <span class="learn-delta-stat">TD ${tdDelta}</span>
        <span class="learn-delta-stat">FP ${fpDelta}</span>
        <div class="learn-delta-bar"><div class="learn-delta-bar-fill" style="width:${barPct.toFixed(0)}%;background:${errColor}"></div></div>
        <span class="learn-delta-total" style="color:${errColor}">±${p.totalErr.toFixed(1)}</span>
      </div>`;
        }).join('');
        learnBody = `${pendingBanner}
    <div class="learn-hero">
      <div class="learn-grade-ring" style="--grade-color:${overallColor}"><span class="learn-grade-letter">${overallGrade}</span></div>
      <div class="learn-hero-meta">
        <div class="learn-hero-title">Prediction Accuracy</div>
        <div class="learn-hero-subtitle">Avg |Δ| ${overallAvg.toFixed(1)} across ${sortedDeltas.length} fighters</div>
        <div class="learn-hero-badges">
          <span class="learn-badge-best">▲ Best · ${s.bestPrediction}</span>
          <span class="learn-badge-worst">▼ Worst · ${s.worstPrediction}</span>
        </div>
      </div>
    </div>
    <div class="learn-chips-row">
      ${statChip('SS', s.avgAbsDeltaSS)}
      ${statChip('TD', s.avgAbsDeltaTD)}
      ${statChip('FP', s.avgAbsDeltaFP)}
    </div>
    <div class="learn-meta-row">
      <details class="weights-details"><summary>Weights — click to expand</summary><div class="weights-body">${wAdj}</div></details>
      <span class="learn-trend-label"><span class="learn-trend-tag">Trends</span> ${s.trendUpdates}</span>
    </div>
    <div class="learn-delta-header">
      <span class="learn-dh-rank">#</span>
      <span class="learn-dh-name">Fighter</span>
      <span class="learn-dh-stat">SS</span>
      <span class="learn-dh-stat">TD</span>
      <span class="learn-dh-stat">FP</span>
      <span class="learn-dh-bar">Error</span>
      <span class="learn-dh-total">|Δ|</span>
    </div>
    ${rankedRows}`;
    }
    else {
        // Show learn button if we have unsettled predictions and settled archive data
        const unsettled = (preds).find(p => !p.settled);
        if (unsettled) {
            const isCurrentEvent = unsettled.event === (upcomingEventName || '').trim() || unsettled.event === upcomingEventName;
            const deleteBtn = `<button id="predictorDeleteBtn" class="btn btn-sm" style="background:none;border:1px solid var(--text-muted);color:var(--text-muted);padding:3px 10px;border-radius:6px;cursor:pointer;font-size:10px;margin-left:8px" title="Delete these predictions">✕ Delete</button>`;
            if (isCurrentEvent) {
                // Predictions match the upcoming event — not ready for learning yet
                learnBody = `<div style="text-align:center;padding:12px 0">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Predictions for "${unsettled.event}" — awaiting event results</div>
          ${deleteBtn}
        </div>`;
            }
            else {
                learnBody = `<div style="text-align:center;padding:12px 0">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Predictions for "${unsettled.event}" ready for learning</div>
          <button id="predictorLearnBtn" class="btn btn-sm" style="background:var(--green);color:#000;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600">▶ Run Learning Cycle</button>
          ${deleteBtn}
        </div>`;
            }
        }
        else {
            learnBody = `<div class="inline-empty-msg" style="font-size:10px">No learning data yet — generate predictions, then settle an event</div>`;
        }
    }
    const learnCount = latestLearn ? `${latestLearn.event}` : '';
    return `${cSec('predictions', '', '', 'Prop Line Predictions', predCount, predBody, 'margin-bottom:12px')}
    ${cSec('learning', '', '', 'Learning Summary', learnCount, learnBody, 'margin-bottom:12px')}`;
}
async function renderArchivePanel(container) {
    container.innerHTML = loadingSkeleton('Loading prop archive…');
    // Auto-settle once per session if there are past unresolved events
    if (!_archiveAutoSettleFired) {
        _archiveAutoSettleFired = true;
        runtimeSendMessage({ type: 'GRADE_ARCHIVE' })
            .then(res => {
            if (res?.ok && res.settled > 0) {
                showToast(`✓ Auto-settled ${res.settled} result(s) from UFCStats`);
                void renderArchivePanel(container);
            }
        })
            .catch(() => { });
    }
    const [result, linesPayload] = await Promise.all([
        storageGet([STORAGE_PROP_ARCHIVE_KEY]),
        storageGet(STORAGE_LINE_KEYS),
    ]);
    const allRowsRaw = result[STORAGE_PROP_ARCHIVE_KEY];
    const allRows = Array.isArray(allRowsRaw) ? allRowsRaw : [];
    // Lines staleness — find most recent capturedAt across all platform payloads
    const linesCapturedAt = Math.max(0, ...STORAGE_LINE_KEYS.map(k => {
        const val = linesPayload[k];
        return Number(val?.capturedAt || 0);
    }));
    const stalenessMins = linesCapturedAt > 0 ? Math.floor((Date.now() - linesCapturedAt) / 60000) : null;
    const stalenessLabel = stalenessMins == null ? '' :
        stalenessMins < 5 ? '· Lines: just now' :
            stalenessMins < 60 ? `· Lines: ${stalenessMins}m ago` :
                `· Lines: ${Math.floor(stalenessMins / 60)}h ago`;
    const currentRoster = new Set(allFighters.map((f) => normalizeName(f.name)?.toLowerCase()).filter((n) => !!n));
    // When no lines are loaded, treat all archive fighters as "on roster" so archive always shows
    const rosterFilter = (fighter) => currentRoster.size === 0 || currentRoster.has(fighter.toLowerCase());
    const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
    const nowTs = Date.now();
    // Normalize event name to a dedup key — extract sorted fighter surnames from "UFC Fight Night: A vs B"
    function eventDedupeKey(name) {
        const m = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
        if (!m)
            return name.toLowerCase().trim();
        const a = m[1].trim().split(/\s+/).pop().toLowerCase();
        const b = m[2].trim().split(/\s+/).pop().toLowerCase();
        return [a, b].sort().join('|');
    }
    // ── Per-event breakdown ────────────────────────────────────────────────
    // key = dedup key, value includes display name, date, and counts
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const eventMap = new Map();
    for (const r of allRows.filter(r => Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) >= londonTs)) {
        const ev = r.event || 'Unknown';
        const key = eventDedupeKey(ev);
        const rDate = Date.parse(r.date);
        const bucket = eventMap.get(key) || { display: ev, date: rDate, hits: 0, total: 0, unresolved: 0, recordCount: 0, clvMoved: 0, clvTracked: 0, clvAbsSum: 0, biggestMover: null };
        // Prefer the longer, more descriptive event name as display name
        if (ev.length > bucket.display.length)
            bucket.display = ev;
        // Track earliest record date for this event
        if (rDate < bucket.date)
            bucket.date = rDate;
        bucket.recordCount++;
        if (Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result))) {
            bucket.total++;
            if (normalizeArchiveResult(String(r.propType), Number(r.result)) > Number(r.line))
                bucket.hits++;
        }
        else if (Number.isFinite(Number(r.line))) {
            bucket.unresolved++;
        }
        // Market CLV: capture line drift when openLine and line both present.
        const openLine = Number(r.openLine);
        const closeLine = Number(r.line);
        if (Number.isFinite(openLine) && Number.isFinite(closeLine)) {
            bucket.clvTracked++;
            const delta = closeLine - openLine;
            if (delta !== 0) {
                bucket.clvMoved++;
                bucket.clvAbsSum += Math.abs(delta);
                if (!bucket.biggestMover || Math.abs(delta) > Math.abs(bucket.biggestMover.delta)) {
                    bucket.biggestMover = {
                        fighter: r.fighter,
                        propType: String(r.propType),
                        platform: String(r.platform || ''),
                        openLine,
                        line: closeLine,
                        delta,
                    };
                }
            }
        }
        eventMap.set(key, bucket);
    }
    // Note: eventDedupeKey already handles reversed-name duplicates (e.g. "Grasso vs Barber" ↔
    // "Barber vs Grasso") by sorting surnames — no extra date-proximity merge needed.
    // ── AI lean snapshot accuracy per event ───────────────────────────────
    const aiSnapshotPayload = await storageGet([STORAGE_AI_LEAN_SNAPSHOT_KEY]);
    const aiSnapshots = Array.isArray(aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
        ? aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY]
        : [];
    // Returns { hits, total } for AI picks in a snapshot cross-referenced against archive rows for the same event.
    function computeAiAccuracy(snap, eventArchiveRows) {
        let hits = 0;
        let total = 0;
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '');
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine))
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.result)))
                .sort((a, b) => {
                const aPlatformPenalty = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPlatformPenalty = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPlatformPenalty !== bPlatformPenalty)
                    return aPlatformPenalty - bPlatformPenalty;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            total++;
            const res = Number(match.result);
            if (lean === 'over' && res > activeLine)
                hits++;
            if (lean === 'under' && res < activeLine)
                hits++;
        }
        return { hits, total };
    }
    // Map dedup key → best AI accuracy for that event
    const aiAccuracyMap = new Map();
    for (const snap of aiSnapshots) {
        const key = eventDedupeKey(String(snap?.event || ''));
        if (!key || aiAccuracyMap.has(key))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === key);
        const acc = computeAiAccuracy(snap, eventArchiveRows);
        if (acc.total > 0)
            aiAccuracyMap.set(key, acc);
    }
    // Returns { aligned, total } for AI picks whose lean direction matches market drift.
    // aligned: lean='over' && delta>0, or lean='under' && delta<0. Zero-drift excluded.
    function computeAiClvAgreement(snap, eventArchiveRows) {
        let aligned = 0;
        let total = 0;
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '');
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under'))
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.openLine)) &&
                Number.isFinite(Number(r.line)))
                .sort((a, b) => {
                const aPlatformPenalty = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPlatformPenalty = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPlatformPenalty !== bPlatformPenalty)
                    return aPlatformPenalty - bPlatformPenalty;
                if (!Number.isFinite(activeLine))
                    return 0;
                return Math.abs(Number(a.line) - activeLine) - Math.abs(Number(b.line) - activeLine);
            })[0];
            if (!match)
                continue;
            const delta = Number(match.line) - Number(match.openLine);
            if (delta === 0)
                continue;
            total++;
            if (lean === 'over' && delta > 0)
                aligned++;
            if (lean === 'under' && delta < 0)
                aligned++;
        }
        return { aligned, total };
    }
    // Map dedup key → AI × CLV agreement for that event
    const aiClvAgreementMap = new Map();
    for (const snap of aiSnapshots) {
        const key = eventDedupeKey(String(snap?.event || ''));
        if (!key || aiClvAgreementMap.has(key))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === key);
        const agg = computeAiClvAgreement(snap, eventArchiveRows);
        if (agg.total > 0)
            aiClvAgreementMap.set(key, agg);
    }
    // Split into past events (show results) and upcoming (show as pending only)
    const pastEventRows = Array.from(eventMap.values())
        .filter(d => d.date <= nowTs || d.total > 0) // treat settled events as past regardless of date
        .sort((a, b) => b.date - a.date)
        .slice(0, 6);
    const upcomingEvents = Array.from(eventMap.values())
        .filter(d => d.date > nowTs && d.total === 0);
    // Only count resolved rows from past events for stats
    const pastEventKeys = new Set(Array.from(eventMap.entries())
        .filter(([, d]) => d.date <= nowTs)
        .map(([k]) => k));
    const resolvedRows = allRows.filter(r => Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result)) &&
        Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) >= londonTs &&
        pastEventKeys.has(eventDedupeKey(r.event || '')));
    const unresolvedCount = allRows.filter(r => Number.isFinite(Number(r.line)) && !Number.isFinite(Number(r.result))).length;
    const pendingEventMap = new Map();
    for (const r of allRows) {
        if (!Number.isFinite(Number(r.line)) || Number.isFinite(Number(r.result)))
            continue;
        const key = eventDedupeKey(r.event || '');
        const evData = eventMap.get(key);
        // Only show banner for PAST events (not upcoming futures)
        if (!evData || (evData.date > nowTs && evData.total === 0))
            continue;
        const p = pendingEventMap.get(key) || { display: evData.display, total: 0, byType: {} };
        p.total++;
        const pt = String(r.propType || 'Unknown');
        p.byType[pt] = (p.byType[pt] || 0) + 1;
        pendingEventMap.set(key, p);
    }
    const pendingEvents = Array.from(pendingEventMap.values()).sort((a, b) => b.total - a.total);
    // ── AI pick accuracy by stat type (lean-direction correct, over + under) ──
    const aiAccuracyByType = {};
    for (const snap of aiSnapshots) {
        const key = eventDedupeKey(String(snap?.event || ''));
        if (!key || !pastEventKeys.has(key))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === key);
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '');
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine))
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.result)))
                .sort((a, b) => {
                const aPlatformPenalty = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPlatformPenalty = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPlatformPenalty !== bPlatformPenalty)
                    return aPlatformPenalty - bPlatformPenalty;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            if (!aiAccuracyByType[propType])
                aiAccuracyByType[propType] = { hits: 0, total: 0 };
            aiAccuracyByType[propType].total++;
            const res = Number(match.result);
            if (lean === 'over' && res > activeLine)
                aiAccuracyByType[propType].hits++;
            if (lean === 'under' && res < activeLine)
                aiAccuracyByType[propType].hits++;
        }
    }
    const entryClvByType = {};
    for (const snap of aiSnapshots) {
        const key = eventDedupeKey(String(snap?.event || ''));
        if (!key || !pastEventKeys.has(key))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === key);
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '');
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine))
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.line)))
                .sort((a, b) => {
                const aP = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bP = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aP !== bP)
                    return aP - bP;
                return Math.abs(Number(a.line) - activeLine) - Math.abs(Number(b.line) - activeLine);
            })[0];
            if (!match)
                continue;
            const closeLine = Number(match.line);
            if (!Number.isFinite(closeLine))
                continue;
            // Sanity-bound: a gap > 20 units is almost certainly a name/platform mismatch, not real CLV.
            const raw = (lean === 'over' ? 1 : -1) * (closeLine - activeLine);
            if (Math.abs(raw) > 20)
                continue;
            if (!entryClvByType[propType])
                entryClvByType[propType] = { picks: 0, clvSum: 0, clvPosCount: 0, hitCount: 0, resolvedCount: 0 };
            const b = entryClvByType[propType];
            b.picks++;
            b.clvSum += raw;
            if (raw > 0)
                b.clvPosCount++;
            const res = Number(match.result);
            if (Number.isFinite(res)) {
                b.resolvedCount++;
                if (lean === 'over' && res > activeLine)
                    b.hitCount++;
                if (lean === 'under' && res < activeLine)
                    b.hitCount++;
            }
        }
    }
    // ── Fantasy hit rate ───────────────────────────────────────────────────
    const fantasyRows = resolvedRows.filter(r => r.propType === 'Fantasy' || r.propType === 'Fantasy_PP');
    const fantasyHits = fantasyRows.filter(r => Number(r.result) > Number(r.line)).length;
    const fantasyTotal = fantasyRows.length;
    const fantasyHitRate = fantasyTotal ? Math.round((fantasyHits / fantasyTotal) * 100) : 0;
    const fighterFantasy = new Map();
    for (const r of fantasyRows) {
        const key = normalizeName(r.fighter) || r.fighter;
        const entry = fighterFantasy.get(key) || { hits: 0, total: 0 };
        entry.total++;
        if (Number(r.result) > Number(r.line))
            entry.hits++;
        fighterFantasy.set(key, entry);
    }
    const topFantasy = Array.from(fighterFantasy.entries())
        .filter(([fighter, v]) => v.total >= 2 && rosterFilter(fighter))
        .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
        .sort((a, b) => b.rate - a.rate || b.total - a.total)
        .slice(0, 8);
    // ── SS per-fighter hit rates ───────────────────────────────────────────
    const ssRows = resolvedRows.filter(r => String(r.propType) === 'SS');
    const fighterSS = new Map();
    for (const r of ssRows) {
        const key = normalizeName(r.fighter) || r.fighter;
        const entry = fighterSS.get(key) || { hits: 0, total: 0 };
        entry.total++;
        if (Number(r.result) > Number(r.line))
            entry.hits++;
        fighterSS.set(key, entry);
    }
    const topSS = Array.from(fighterSS.entries())
        .filter(([fighter, v]) => v.total >= 2 && rosterFilter(fighter))
        .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
        .sort((a, b) => b.rate - a.rate || b.total - a.total)
        .slice(0, 8);
    const ssHits = ssRows.filter(r => Number(r.result) > Number(r.line)).length;
    // ── TD per-fighter hit rates ───────────────────────────────────────────
    const tdRows = resolvedRows.filter(r => String(r.propType) === 'TD');
    const fighterTD = new Map();
    for (const r of tdRows) {
        const key = normalizeName(r.fighter) || r.fighter;
        const entry = fighterTD.get(key) || { hits: 0, total: 0 };
        entry.total++;
        if (Number(r.result) > Number(r.line))
            entry.hits++;
        fighterTD.set(key, entry);
    }
    const topTD = Array.from(fighterTD.entries())
        .filter(([fighter, v]) => v.total >= 2 && rosterFilter(fighter))
        .map(([fighter, v]) => ({ fighter, rate: Math.round((v.hits / v.total) * 100), total: v.total }))
        .sort((a, b) => b.rate - a.rate || b.total - a.total)
        .slice(0, 8);
    const tdHits = tdRows.filter(r => Number(r.result) > Number(r.line)).length;
    // ── FightTime hit rate ────────────────────────────────────────────────
    const ftRows = resolvedRows.filter(r => String(r.propType) === 'FightTime');
    const ftHits = ftRows.filter(r => normalizeArchiveResult('FightTime', Number(r.result)) > Number(r.line)).length;
    // ── Per-platform summary (all prop types combined) ────────────────────
    const platSummary = new Map();
    for (const r of resolvedRows.filter(r => !!r.platform)) {
        const key = String(r.platform).toLowerCase();
        const b = platSummary.get(key) || { hits: 0, total: 0, edgeSum: 0 };
        const normResult = normalizeArchiveResult(String(r.propType), Number(r.result));
        b.total++;
        b.edgeSum += normResult - Number(r.line);
        if (normResult > Number(r.line))
            b.hits++;
        platSummary.set(key, b);
    }
    // ── Platform bias ──────────────────────────────────────────────────────
    const biasMap = new Map();
    for (const r of resolvedRows.filter(r => !!r.platform)) {
        const key = `${String(r.platform).toLowerCase()}|${r.propType}`;
        const b = biasMap.get(key) || { platform: String(r.platform).toLowerCase(), propType: String(r.propType), hits: 0, total: 0, edgeSum: 0 };
        const normResult = normalizeArchiveResult(String(r.propType), Number(r.result));
        b.total++;
        b.edgeSum += normResult - Number(r.line);
        if (normResult > Number(r.line))
            b.hits++;
        biasMap.set(key, b);
    }
    const biasRows = Array.from(biasMap.values())
        .filter(b => b.total >= 2)
        .map(b => ({ ...b, hitRate: Math.round((b.hits / b.total) * 100), avgEdge: Number((b.edgeSum / b.total).toFixed(1)) }))
        .sort((a, b) => Math.abs(b.avgEdge) - Math.abs(a.avgEdge) || b.total - a.total)
        .slice(0, 14);
    // ── HTML ───────────────────────────────────────────────────────────────
    const deleteBtn = (eventName) => `<button class="archive-delete-event-btn" data-event="${eventName.replace(/"/g, '&quot;')}" title="Delete all records for this event" style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:0 4px;line-height:1">✕</button>`;
    const upcomingHtml = upcomingEvents
        .filter(d => d.unresolved > 0 || d.total > 0) // hide empty shell events
        .map(d => `<div class="event-row" style="opacity:0.6">
        <div class="event-pct" style="font-size:9px;color:var(--text-muted)">SOON</div>
        <div style="flex:1"><div class="best-pick-name" style="font-size:12px">${d.display}</div><div class="best-pick-reason">${d.unresolved} lines archived · awaiting results</div></div>
        ${deleteBtn(d.display)}
      </div>`).join('');
    const eventHtml = (pastEventRows.length || upcomingHtml)
        ? upcomingHtml + pastEventRows.map((d) => {
            const key = eventDedupeKey(d.display);
            const rate = d.total ? Math.round((d.hits / d.total) * 100) : null;
            const rateStr = rate !== null ? `overs: ${d.hits}/${d.total} (${rate}%)` : '—';
            const unresStr = d.unresolved > 0 ? `<span style="color:var(--text-muted);font-size:10px"> · ${d.unresolved} pending</span>` : '';
            const ai = aiAccuracyMap.get(key);
            const aiRate = ai ? Math.round((ai.hits / ai.total) * 100) : null;
            const aiStr = ai
                ? `<span style="color:${aiRate >= 60 ? 'var(--green)' : aiRate >= 45 ? 'var(--amber)' : 'var(--red)'};font-size:10px;margin-left:8px">AI picks: ${ai.hits}/${ai.total} (${aiRate}%)</span>`
                : '';
            let clvStr = '';
            if (d.clvTracked > 0) {
                const avgAbs = d.clvMoved > 0 ? (d.clvAbsSum / d.clvMoved).toFixed(2) : '0.00';
                const bm = d.biggestMover;
                const biggestStr = bm
                    ? ` · biggest: ${bm.fighter} ${bm.propType} ${bm.openLine}→${bm.line} (${bm.delta > 0 ? '+' : ''}${bm.delta.toFixed(1)})`
                    : '';
                const agreement = aiClvAgreementMap.get(key);
                let agreementStr = '';
                if (agreement) {
                    const pct = Math.round((agreement.aligned / agreement.total) * 100);
                    const color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
                    agreementStr = ` · <span style="color:${color}">AI×CLV: ${agreement.aligned}/${agreement.total} aligned (${pct}%)</span>`;
                }
                clvStr = `<div class="best-pick-reason" style="font-size:10px;color:var(--text-muted)">CLV: ${d.clvMoved}/${d.clvTracked} moved · avg |Δ| ${avgAbs}${biggestStr}${agreementStr}</div>`;
            }
            return `<div class="event-row">
          <div class="event-pct" style="color:${rate === null ? 'var(--text3)' : rate >= 60 ? 'var(--green)' : rate >= 40 ? 'var(--gold)' : 'var(--red)'}">${rate !== null ? rate + '%' : '—'}</div>
          <div style="flex:1"><div class="best-pick-name" style="font-size:12px">${d.display}</div><div class="best-pick-reason">${rateStr}${unresStr}${aiStr}</div>${clvStr}</div>
          ${deleteBtn(d.display)}
        </div>`;
        }).join('')
        : '<div class="inline-empty-msg">No event data yet</div>';
    const topFantasyHtml = topFantasy.length
        ? topFantasy.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${prettyName(x.fighter)}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">Fantasy</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
        : `<div class="rate-hero"><div class="rate-hero-num" style="color:${fantasyHitRate >= 50 ? 'var(--green)' : fantasyHitRate >= 35 ? 'var(--gold)' : 'var(--red)'}">${fantasyHitRate}%</div><div class="rate-hero-bar"><span style="width:${Math.max(2, Math.min(100, fantasyHitRate))}%;background:${fantasyHitRate >= 50 ? 'var(--green)' : fantasyHitRate >= 35 ? 'var(--gold)' : 'var(--red)'}"></span></div><div class="rate-hero-sub">${fantasyHits}/${fantasyTotal} hit on current roster · per-fighter breakdown needs 2+ events each</div></div>`;
    const topSSHtml = topSS.length
        ? topSS.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${prettyName(x.fighter)}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">SS</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
        : `<div class="rate-hero"><div class="rate-hero-num" style="color:${Math.round(ssHits / Math.max(1, ssRows.length) * 100) >= 50 ? 'var(--green)' : Math.round(ssHits / Math.max(1, ssRows.length) * 100) >= 35 ? 'var(--gold)' : 'var(--red)'}">${Math.round(ssHits / Math.max(1, ssRows.length) * 100)}%</div><div class="rate-hero-bar"><span style="width:${Math.max(2, Math.min(100, Math.round(ssHits / Math.max(1, ssRows.length) * 100)))}%;background:${Math.round(ssHits / Math.max(1, ssRows.length) * 100) >= 50 ? 'var(--green)' : Math.round(ssHits / Math.max(1, ssRows.length) * 100) >= 35 ? 'var(--gold)' : 'var(--red)'}"></span></div><div class="rate-hero-sub">${ssHits}/${ssRows.length} hit on current roster · per-fighter breakdown needs 2+ events each</div></div>`;
    const topTDHtml = topTD.length
        ? topTD.map(x => `<div class="best-pick-row">
          <div class="best-pick-rank">${x.rate}%</div>
          <div><div class="best-pick-name">${prettyName(x.fighter)}</div><div class="best-pick-reason">${x.total} events · ${Math.round(x.rate / 100 * x.total)}/${x.total} over</div></div>
          <div class="best-pick-meta"><span class="best-pick-platform">TD</span></div>
          <div class="best-pick-line">${x.total} events</div>
        </div>`).join('')
        : `<div class="rate-hero"><div class="rate-hero-num" style="color:${Math.round(tdHits / Math.max(1, tdRows.length) * 100) >= 50 ? 'var(--green)' : Math.round(tdHits / Math.max(1, tdRows.length) * 100) >= 35 ? 'var(--gold)' : 'var(--red)'}">${Math.round(tdHits / Math.max(1, tdRows.length) * 100)}%</div><div class="rate-hero-bar"><span style="width:${Math.max(2, Math.min(100, Math.round(tdHits / Math.max(1, tdRows.length) * 100)))}%;background:${Math.round(tdHits / Math.max(1, tdRows.length) * 100) >= 50 ? 'var(--green)' : Math.round(tdHits / Math.max(1, tdRows.length) * 100) >= 35 ? 'var(--gold)' : 'var(--red)'}"></span></div><div class="rate-hero-sub">${tdHits}/${tdRows.length} hit on current roster · per-fighter breakdown needs 2+ events each</div></div>`;
    // ── AI pick accuracy by stat type (lean-direction correct, not raw over rate) ──
    const aiStatBadge = (label, propType) => {
        const d = aiAccuracyByType[propType];
        if (!d?.total)
            return `<span class="archive-stat-badge archive-stat-empty"><span class="asb-label">${label}</span><span class="asb-val">—</span></span>`;
        const pct = Math.round((d.hits / d.total) * 100);
        const lowN = d.total < 5;
        // Don't color-grade until 5+ samples — small samples produce misleading red/green signals
        const color = lowN ? 'var(--text-muted)' : pct >= 65 ? 'var(--green)' : pct >= 45 ? 'var(--amber)' : 'var(--red)';
        const nTag = lowN ? ` <span style="opacity:0.5;font-size:9px">(n=${d.total})</span>` : '';
        return `<span class="archive-stat-badge"${lowN ? '' : ` style="--asb-color:${color}"`}><span class="asb-label">${label}</span><span class="asb-val" style="color:${color}">${d.hits}/${d.total} <span style="opacity:0.7">(${pct}%)${nTag}</span></span><span class="asb-bar"><span style="width:${Math.max(2, Math.min(100, pct))}%;background:${color}"></span></span></span>`;
    };
    const statSummaryHtml = `
    <div class="archive-stat-summary">
      ${aiStatBadge('FP', 'Fantasy')}
      ${aiStatBadge('SS', 'SS')}
      ${aiStatBadge('TD', 'TD')}
      ${aiStatBadge('FT', 'FightTime')}
    </div>`;
    // ── Entry-vs-close CLV badges ─────────────────────────────────────────
    const entryClvBadge = (label, propType) => {
        const d = entryClvByType[propType];
        if (!d?.picks) {
            return `<span class="archive-stat-badge archive-stat-empty"><span class="asb-label">${label}</span><span class="asb-val">—</span></span>`;
        }
        const avgClv = d.clvSum / d.picks;
        const beatPct = Math.round((d.clvPosCount / d.picks) * 100);
        const lowN = d.picks < 5;
        const clvColor = lowN ? 'var(--text-muted)' : avgClv > 0.1 ? 'var(--green)' : avgClv < -0.1 ? 'var(--red)' : 'var(--amber)';
        const beatColor = lowN ? 'var(--text-muted)' : beatPct >= 55 ? 'var(--green)' : beatPct >= 45 ? 'var(--amber)' : 'var(--red)';
        const hitStr = d.resolvedCount > 0 ? ` · <span style="opacity:0.8">${Math.round((d.hitCount / d.resolvedCount) * 100)}% hit</span>` : '';
        const nTag = lowN ? ` <span style="opacity:0.5;font-size:9px">(n=${d.picks})</span>` : ` <span style="opacity:0.5;font-size:9px">(n=${d.picks})</span>`;
        return `<span class="archive-stat-badge"><span class="asb-label">${label}</span><span class="asb-val"><span style="color:${clvColor};font-weight:700">${avgClv > 0 ? '+' : ''}${avgClv.toFixed(2)}</span> <span style="opacity:0.7;font-size:9px">· <span style="color:${beatColor}">${beatPct}% beat</span>${hitStr}${nTag}</span></span></span>`;
    };
    const entryClvHtml = `
    <div class="archive-stat-summary">
      ${entryClvBadge('FP', 'Fantasy')}
      ${entryClvBadge('SS', 'SS')}
      ${entryClvBadge('TD', 'TD')}
      ${entryClvBadge('FT', 'FightTime')}
    </div>`;
    // ── Per-platform summary ────────────────────────────────────────────────
    const PLAT_LABELS = { pick6: 'Pick6', underdog: 'UD', prizepicks: 'PP', betr: 'Betr', draftkings_sportsbook: 'DK' };
    const platSummaryHtml = platSummary.size > 0
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">` +
            [...platSummary.entries()]
                .filter(([, v]) => v.total >= 1)
                .sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total))
                .map(([plat, v]) => {
                const pct = Math.round((v.hits / v.total) * 100);
                const avgEdge = (v.edgeSum / v.total).toFixed(1);
                const col = pct >= 65 ? 'var(--green)' : pct >= 45 ? 'var(--amber)' : 'var(--red)';
                return `<span style="font-size:11px;padding:3px 8px;border-radius:5px;background:var(--surface2)">
            <span style="color:var(--text-muted)">${PLAT_LABELS[plat] || plat.toUpperCase()}</span>
            <span style="color:${col};font-weight:700;margin-left:4px">${pct}%</span>
            <span style="color:var(--text-muted);font-size:10px;margin-left:3px">${v.hits}/${v.total} · edge ${Number(avgEdge) > 0 ? '+' : ''}${avgEdge}</span>
          </span>`;
            }).join('') + `</div>`
        : '';
    // Platform bias — sortable; sort key stored at module level so it persists across re-renders
    const sk = _archiveBiasSortKey;
    const sortFn = (a, b) => {
        if (sk === 'hitRate')
            return b.hitRate - a.hitRate;
        if (sk === 'total')
            return b.total - a.total;
        return Math.abs(b.avgEdge) - Math.abs(a.avgEdge);
    };
    const biasSorted = [...biasRows].sort(sortFn);
    const biasHdr = (label, key) => `<span data-bias-sort="${key}" style="cursor:pointer;text-decoration:underline dotted;color:${sk === key ? 'var(--text)' : 'var(--text-muted)'}">${label}${sk === key ? ' ▼' : ''}</span>`;
    const biasHtml = biasSorted.length
        ? `<div style="display:flex;gap:12px;font-size:10px;margin-bottom:6px;padding:0 4px">
        <span style="flex:1;color:var(--text-muted)">Platform / Prop</span>
        ${biasHdr('Avg Edge', 'avgEdge')} &nbsp; ${biasHdr('Hit%', 'hitRate')} &nbsp; ${biasHdr('N', 'total')}
       </div>` +
            biasSorted.map(x => {
                const rc = x.hitRate >= 55 ? 'var(--green)' : x.hitRate >= 45 ? 'var(--gold)' : 'var(--red)';
                return `<div class="bias-row">
        <span class="bias-platform">${x.platform.toUpperCase()}</span>
        <div class="bias-main"><div class="bias-prop">${x.propType}</div><div class="bias-sub">${x.total} records · avg edge ${x.avgEdge > 0 ? '+' : ''}${x.avgEdge}</div></div>
        <span class="bias-bar"><span style="width:${Math.max(2, Math.min(100, x.hitRate))}%;background:${rc}"></span></span>
        <span class="bias-rate" style="color:${rc}">${x.hitRate}%</span>
      </div>`;
            }).join('')
        : '<div class="inline-empty-msg">No resolved outcomes yet</div>';
    // ── Platform bias bar chart (avg edge per stat, grouped by platform) ─────
    // Shows whether each platform sets lines too high (+) or too low (-) per stat.
    const STAT_ORDER_CHART = ['Fantasy', 'SS', 'TD', 'FightTime'];
    const STAT_LABELS_CHART = { Fantasy: 'FP', SS: 'SS', TD: 'TD', FightTime: 'FT' };
    const biasChartData = {};
    for (const b of Array.from(biasMap.values()).filter(bv => bv.total >= 2)) {
        if (!biasChartData[b.propType])
            biasChartData[b.propType] = {};
        biasChartData[b.propType][b.platform] = {
            avgEdge: Number((b.edgeSum / b.total).toFixed(1)),
            total: b.total,
        };
    }
    const allEdgeAbsVals = Object.values(biasChartData)
        .flatMap(plats => Object.values(plats).map(v => Math.abs(v.avgEdge)));
    const maxEdgeScale = allEdgeAbsVals.length ? Math.max(...allEdgeAbsVals, 1) : 1;
    const biasByStatHtml = STAT_ORDER_CHART.filter(pt => biasChartData[pt] && Object.keys(biasChartData[pt]).length > 0).map(pt => {
        const label = STAT_LABELS_CHART[pt] || pt;
        const entries = Object.entries(biasChartData[pt]).sort((a, b) => b[1].avgEdge - a[1].avgEdge);
        const bars = entries.map(([plat, { avgEdge, total }]) => {
            const pctBar = Math.round(Math.abs(avgEdge) / maxEdgeScale * 80); // cap at 80% width
            const isPos = avgEdge >= 0;
            const col = isPos ? 'var(--green)' : 'var(--red)';
            const platLabel = PLAT_LABELS[plat] || plat.toUpperCase();
            return `<div title="${platLabel} · avg edge ${avgEdge > 0 ? '+' : ''}${avgEdge} · n=${total}" style="display:flex;align-items:center;gap:4px">
        <span style="font-size:9px;color:var(--text-muted);min-width:26px;text-align:right">${platLabel}</span>
        <div style="width:100px;background:var(--surface2);border-radius:2px;height:8px;overflow:hidden">
          <div style="height:100%;width:${pctBar}%;background:${col};border-radius:2px;opacity:0.85"></div>
        </div>
        <span style="font-size:9px;color:${col};min-width:30px">${avgEdge > 0 ? '+' : ''}${avgEdge}</span>
      </div>`;
        }).join('');
        return `<div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px">
      <span style="font-size:10px;font-weight:700;color:var(--text);min-width:16px;padding-top:1px">${label}</span>
      <div style="display:flex;flex-direction:column;gap:2px">${bars}</div>
    </div>`;
    }).join('');
    const biasChartHtml = biasByStatHtml
        ? `<div style="margin:8px 0 10px 0;padding:8px 10px;background:var(--surface2);border-radius:6px">
        <div style="font-size:9px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em">Avg Edge by Stat (+ = result beats line)</div>
        ${biasByStatHtml}
       </div>`
        : '';
    const calibBuckets = [
        { rangeLabel: '50–54%', midpoint: 52, hits: 0, total: 0 },
        { rangeLabel: '55–59%', midpoint: 57, hits: 0, total: 0 },
        { rangeLabel: '60–64%', midpoint: 62, hits: 0, total: 0 },
        { rangeLabel: '65–69%', midpoint: 67, hits: 0, total: 0 },
        { rangeLabel: '70–74%', midpoint: 72, hits: 0, total: 0 },
        { rangeLabel: '75–79%', midpoint: 77, hits: 0, total: 0 },
        { rangeLabel: '80–84%', midpoint: 82, hits: 0, total: 0 },
        { rangeLabel: '85–89%', midpoint: 87, hits: 0, total: 0 },
        { rangeLabel: '90%+', midpoint: 92, hits: 0, total: 0 },
    ];
    // Also track per-stat-type calibration
    const calibByType = {};
    const CALIB_STAT_TYPES = ['Fantasy', 'SS', 'TD', 'FightTime'];
    for (const pt of CALIB_STAT_TYPES) {
        calibByType[pt] = calibBuckets.map(b => ({ ...b, hits: 0, total: 0 }));
    }
    let calibTotalSamples = 0;
    for (const snap of aiSnapshots) {
        const snapEventKey = eventDedupeKey(String(snap?.event || ''));
        if (!snapEventKey || !pastEventKeys.has(snapEventKey))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === snapEventKey);
        if (!eventArchiveRows.length)
            continue;
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '').toLowerCase();
            const conf = Number(pick?.confidence);
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine) || !Number.isFinite(conf) || conf < 50)
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.result)))
                .sort((a, b) => {
                const aPP = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPP = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPP !== bPP)
                    return aPP - bPP;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            const result = Number(match.result);
            const isHit = (lean === 'over' && result > activeLine) || (lean === 'under' && result < activeLine);
            // Find the right bucket
            const bucketIdx = conf >= 90 ? 8 : conf >= 85 ? 7 : conf >= 80 ? 6 : conf >= 75 ? 5
                : conf >= 70 ? 4 : conf >= 65 ? 3 : conf >= 60 ? 2 : conf >= 55 ? 1 : 0;
            calibBuckets[bucketIdx].total++;
            if (isHit)
                calibBuckets[bucketIdx].hits++;
            calibTotalSamples++;
            // Per-type calibration
            if (calibByType[propType]) {
                calibByType[propType][bucketIdx].total++;
                if (isHit)
                    calibByType[propType][bucketIdx].hits++;
            }
        }
    }
    // Compute overall calibration score (Brier-style: lower = better calibrated)
    // Mean squared error of predicted probability vs actual hit rate across buckets
    let calibBrierSum = 0;
    let calibBrierN = 0;
    for (const b of calibBuckets) {
        if (b.total < 2)
            continue;
        const predicted = b.midpoint / 100;
        const actual = b.hits / b.total;
        calibBrierSum += (predicted - actual) ** 2;
        calibBrierN++;
    }
    const calibScore = calibBrierN > 0 ? Math.round((1 - Math.sqrt(calibBrierSum / calibBrierN)) * 100) : null;
    // Build calibration curve HTML
    const calibActiveBuckets = calibBuckets.filter(b => b.total > 0);
    const calibCurveHtml = calibActiveBuckets.length >= 2 ? (() => {
        const maxBarH = 80;
        const barRows = calibBuckets.map(b => {
            if (b.total === 0)
                return '';
            const actualRate = Math.round((b.hits / b.total) * 100);
            const predicted = b.midpoint;
            const diff = actualRate - predicted;
            const diffSign = diff > 0 ? '+' : '';
            const diffColor = Math.abs(diff) <= 5 ? 'var(--green)' : Math.abs(diff) <= 12 ? 'var(--amber)' : 'var(--red)';
            // Bar heights: predicted (ghost) and actual (filled)
            const predictedH = Math.round((predicted / 100) * maxBarH);
            const actualH = Math.round((actualRate / 100) * maxBarH);
            const actualColor = actualRate >= predicted - 3 ? 'var(--green)' : actualRate >= predicted - 12 ? 'var(--amber)' : 'var(--red)';
            const lowN = b.total < 5;
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:36px">
        <div style="font-size:8px;color:${diffColor};font-weight:700${lowN ? ';opacity:0.5' : ''}">${diffSign}${diff}%</div>
        <div style="position:relative;width:100%;height:${maxBarH}px;display:flex;align-items:flex-end;justify-content:center">
          <div style="position:absolute;bottom:0;width:60%;height:${predictedH}px;background:rgba(125,145,190,0.12);border:1px dashed rgba(125,145,190,0.3);border-radius:3px" title="Predicted: ${predicted}%"></div>
          <div style="position:relative;width:50%;height:${actualH}px;background:${actualColor};opacity:${lowN ? 0.45 : 0.85};border-radius:4px 4px 2px 2px;box-shadow:0 0 10px ${actualColor};z-index:1" title="Actual: ${actualRate}% (${b.hits}/${b.total})"></div>
        </div>
        <div style="font-size:9px;font-weight:700;color:var(--text)">${actualRate}%</div>
        <div style="font-size:8px;color:var(--text-muted)">${b.rangeLabel}</div>
        <div style="font-size:8px;color:var(--text-muted);opacity:0.6">n=${b.total}</div>
      </div>`;
        }).filter(Boolean).join('');
        // Per-stat-type mini calibration rows
        const typeCalibHtml = CALIB_STAT_TYPES.map(pt => {
            const buckets = calibByType[pt];
            const active = buckets.filter(b => b.total > 0);
            if (active.length < 1)
                return '';
            const label = pt === 'FightTime' ? 'FT' : pt;
            const totalHits = active.reduce((s, b) => s + b.hits, 0);
            const totalN = active.reduce((s, b) => s + b.total, 0);
            const overallRate = totalN > 0 ? Math.round((totalHits / totalN) * 100) : 0;
            const dots = buckets.map(b => {
                if (b.total === 0)
                    return `<div style="width:8px;height:8px;border-radius:50%;background:var(--surface2);border:1px solid rgba(125,145,190,0.15)" title="${b.rangeLabel}: no data"></div>`;
                const actual = Math.round((b.hits / b.total) * 100);
                const diff = Math.abs(actual - b.midpoint);
                const col = diff <= 5 ? 'var(--green)' : diff <= 12 ? 'var(--amber)' : 'var(--red)';
                return `<div style="width:8px;height:8px;border-radius:50%;background:${col};opacity:${b.total < 3 ? 0.4 : 0.85}" title="${b.rangeLabel}: ${actual}% actual (${b.hits}/${b.total})"></div>`;
            }).join('');
            const rateColor = overallRate >= 55 ? 'var(--green)' : overallRate >= 45 ? 'var(--amber)' : 'var(--red)';
            return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        <span style="font-size:10px;font-weight:700;min-width:18px;color:var(--text)">${label}</span>
        <div style="display:flex;gap:3px;align-items:center">${dots}</div>
        <span style="font-size:10px;color:${rateColor};margin-left:auto">${totalHits}/${totalN} (${overallRate}%)</span>
      </div>`;
        }).filter(Boolean).join('');
        const scoreHtml = calibScore != null
            ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="padding:3px 10px;border-radius:999px;background:${calibScore >= 85 ? 'rgba(72,199,142,0.10)' : calibScore >= 70 ? 'rgba(240,192,64,0.10)' : 'rgba(255,100,100,0.10)'};border:1px solid ${calibScore >= 85 ? 'rgba(72,199,142,0.35)' : calibScore >= 70 ? 'rgba(240,192,64,0.35)' : 'rgba(255,100,100,0.35)'}">
            <span style="font-size:14px;font-weight:800;color:${calibScore >= 85 ? 'var(--green)' : calibScore >= 70 ? 'var(--amber)' : 'var(--red)'}">${calibScore}</span>
            <span style="font-size:10px;color:var(--text-muted);margin-left:3px">/ 100</span>
          </div>
          <span style="font-size:10px;color:var(--text-muted)">Calibration Score — ${calibScore >= 85 ? 'Excellent: confidence closely matches reality' : calibScore >= 70 ? 'Good: minor gaps between predicted and actual' : 'Needs work: confidence scores are off from reality'}</span>
        </div>`
            : '';
        return `${scoreHtml}
      <div style="font-size:9px;color:var(--text-muted);margin-bottom:6px">Dashed = predicted confidence · Solid = actual hit rate · Green = well-calibrated</div>
      <div style="display:flex;gap:2px;align-items:flex-end;padding:6px 0 0 0">${barRows}</div>
      ${typeCalibHtml ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(125,145,190,0.1)">
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Per-Stat Calibration</div>
        ${typeCalibHtml}
      </div>` : ''}`;
    })() : null;
    const statusLine = unresolvedCount > 0
        ? `<span style="color:var(--amber)">${unresolvedCount} unresolved records</span>`
        : `<span style="color:var(--green)">All records settled ✓</span>`;
    // ── Awaiting Settlement banner ─────────────────────────────────────────
    const TYPE_ABBR = { Fantasy: 'FP', SS: 'SS', TD: 'TD', FightTime: 'FT' };
    const pendingBannerHtml = pendingEvents.length > 0 ? `
    <div class="pending-settle-banner" style="margin-bottom:12px;border:1px solid rgba(240,180,40,0.35);border-left:3px solid var(--amber);border-radius:6px;background:rgba(240,180,40,0.06);padding:10px 14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-family:'Space Grotesk',sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);font-weight:700">⏳ Awaiting Settlement</span>
        <span style="font-size:10px;color:var(--text-muted)">${unresolvedCount} props across ${pendingEvents.length} event${pendingEvents.length === 1 ? '' : 's'} need results</span>
        <button id="pendingDismissBtn" style="margin-left:auto;background:none;border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:3px 10px;font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:600;cursor:pointer;color:var(--text-muted);letter-spacing:0.04em" title="Mark remaining unresolved records as push (result = line)">✕ DISMISS</button>
        <button id="pendingSettleBtn" style="background:var(--amber);color:#000;border:none;border-radius:4px;padding:3px 10px;font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;letter-spacing:0.04em">⚡ SETTLE NOW</button>
      </div>
      ${pendingEvents.map(p => {
        const breakdown = Object.entries(p.byType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, n]) => `${TYPE_ABBR[type] ?? type} ×${n}`)
            .join(' · ');
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid rgba(255,255,255,0.04)">
          <span style="font-size:11px;color:var(--amber);font-weight:700;min-width:28px">${p.total}</span>
          <div>
            <div style="font-size:11px;color:var(--text);font-weight:600">${p.display}</div>
            <div style="font-size:10px;color:var(--text-muted)">${breakdown}</div>
          </div>
        </div>`;
    }).join('')}
    </div>` : '';
    // ── Backtesting Dashboard ────────────────────────────────────────────
    _cachedBacktestResults = computeBacktestFromHistory();
    const bt = _cachedBacktestResults;
    const backtestHtml = bt ? (() => {
        const wf = bt.wf;
        const accPct = (wf.overallAccuracy * 100).toFixed(1);
        const brierStr = wf.overallBrierScore.toFixed(3);
        const driftStr = (wf.driftScore * 100).toFixed(1);
        const avgCal = wf.folds.reduce((s, f) => s + f.calibrationScore, 0) / wf.folds.length;
        const calPct = (avgCal * 100).toFixed(1);
        // Grade the model
        const grade = wf.overallAccuracy >= 0.60 ? 'A' : wf.overallAccuracy >= 0.55 ? 'B' : wf.overallAccuracy >= 0.50 ? 'C' : 'D';
        const gradeCol = grade === 'A' ? 'var(--green)' : grade === 'B' ? 'var(--amber)' : 'var(--red)';
        // Summary stat cards — using bt-stat-card CSS class with animated counters
        // data-target = numeric value to count to, data-suffix = text after number, data-decimals = decimal places
        const statCard = (label, numericValue, suffix, decimals, sub, color) => `<div class="bt-stat-card" style="--card-accent:${color}">
        <div class="bt-stat-val bt-counter" style="color:${color}" data-target="${numericValue}" data-suffix="${suffix}" data-decimals="${decimals}">0${suffix}</div>
        <div class="bt-stat-label">${label}</div>
        <div class="bt-stat-sub">${sub}</div>
      </div>`;
        const accColor = wf.overallAccuracy >= 0.55 ? 'var(--green)' : wf.overallAccuracy >= 0.50 ? 'var(--amber)' : 'var(--red)';
        const brierColor = wf.overallBrierScore <= 0.20 ? 'var(--green)' : wf.overallBrierScore <= 0.25 ? 'var(--amber)' : 'var(--red)';
        const driftColor = wf.driftScore <= 0.08 ? 'var(--green)' : wf.driftScore <= 0.15 ? 'var(--amber)' : 'var(--red)';
        const statsRow = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      ${statCard('Accuracy', parseFloat(accPct), '%', 1, `${bt.totalPreds} predictions`, accColor)}
      ${statCard('Brier Score', wf.overallBrierScore, '', 3, Number(brierStr) <= 0.200 ? 'well-calibrated' : 'needs tuning', brierColor)}
      ${statCard('Drift', parseFloat(driftStr), '%', 1, wf.driftScore <= 0.08 ? 'stable' : 'unstable', driftColor)}
      ${statCard('Calibration', parseFloat(calPct), '%', 1, `${wf.folds.length} folds`, avgCal >= 0.85 ? 'var(--green)' : avgCal >= 0.70 ? 'var(--amber)' : 'var(--red)')}
    </div>`;
        // Grade badge — using bt-grade-badge CSS class
        const gradeBadge = `<div class="bt-grade-badge" style="background:${gradeCol}11;border:1px solid ${gradeCol}44;margin-bottom:12px">
      <span class="bt-grade-letter" style="color:${gradeCol}">${grade}</span>
      <span class="bt-grade-desc">Model Grade — ${grade === 'A' ? 'Strong edge, model is profitable' :
            grade === 'B' ? 'Marginal edge, use with confidence filters' :
                grade === 'C' ? 'Breakeven, needs improvement' : 'Below breakeven'}</span>
    </div>`;
        // Fold accuracy sparkline (mini bar chart)
        const maxFolds = Math.min(wf.folds.length, 20);
        const recentFolds = wf.folds.slice(-maxFolds);
        const sparkBarH = 44;
        const sparkBars = recentFolds.map((f, i) => {
            const h = Math.round(f.accuracy * sparkBarH);
            const col = f.accuracy >= 0.55 ? 'var(--green)' : f.accuracy >= 0.50 ? 'var(--amber)' : 'var(--red)';
            return `<div title="Fold ${wf.folds.length - maxFolds + i + 1}: ${(f.accuracy * 100).toFixed(1)}% (n=${f.testSize})" style="flex:1;min-width:4px;display:flex;align-items:flex-end;justify-content:center">
        <div style="width:100%;height:${h}px;background:${col};border-radius:2px 2px 0 0;opacity:0.8;transition:opacity 0.15s"></div>
      </div>`;
        }).join('');
        const sparkline = `<div class="bt-spark-panel">
      <div class="bt-spark-title">Per-Fold Accuracy (last ${maxFolds} folds) — 50% line dashed</div>
      <div style="position:relative;height:${sparkBarH}px">
        <div style="position:absolute;top:${Math.round(sparkBarH * 0.5)}px;left:0;right:0;border-top:1px dashed rgba(125,145,190,0.25);z-index:0"></div>
        <div style="display:flex;gap:2px;height:100%;position:relative;z-index:1">${sparkBars}</div>
      </div>
    </div>`;
        // Bankroll curve (simple SVG sparkline)
        const bc = bt.bankrollCurve;
        const minB = Math.min(...bc.map(p => p.bankroll));
        const maxB = Math.max(...bc.map(p => p.bankroll));
        const rangeB = maxB - minB || 1;
        const svgW = 280;
        const svgH = 54;
        const points = bc.map((p, i) => {
            const x = (i / Math.max(1, bc.length - 1)) * svgW;
            const y = svgH - ((p.bankroll - minB) / rangeB) * (svgH - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        // Area fill under the curve
        const areaPoints = `0,${svgH} ${points} ${svgW},${svgH}`;
        const finalB = bc[bc.length - 1]?.bankroll ?? 1000;
        const roi = ((finalB - 1000) / 1000 * 100).toFixed(1);
        const roiCol = finalB >= 1000 ? 'var(--green)' : 'var(--red)';
        const bankrollChart = `<div class="bt-bankroll-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span class="bt-spark-title" style="margin-bottom:0">Simulated Bankroll ($1000 start)</span>
        <span style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:${roiCol}">$${finalB.toFixed(0)} <span style="font-size:10px;opacity:0.7">(${Number(roi) >= 0 ? '+' : ''}${roi}%)</span></span>
      </div>
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:${svgH}px" preserveAspectRatio="none">
        <defs><linearGradient id="bankrollFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${roiCol}" stop-opacity="0.15"/><stop offset="100%" stop-color="${roiCol}" stop-opacity="0.02"/></linearGradient></defs>
        <polygon points="${areaPoints}" fill="url(#bankrollFill)" />
        <line x1="0" y1="${svgH - ((1000 - minB) / rangeB) * (svgH - 4) - 2}" x2="${svgW}" y2="${svgH - ((1000 - minB) / rangeB) * (svgH - 4) - 2}" stroke="rgba(125,145,190,0.15)" stroke-dasharray="4,3" />
        <polyline points="${points}" fill="none" stroke="${roiCol}" stroke-width="2" stroke-linejoin="round" />
      </svg>
    </div>`;
        return `${gradeBadge}${statsRow}${sparkline}${bankrollChart}`;
    })() : null;
    const gradingByPlatStat = new Map();
    const gradingByGrade = new Map();
    const gradingByPlatGrade = new Map();
    for (const snap of aiSnapshots) {
        const snapKey = eventDedupeKey(String(snap?.event || ''));
        if (!snapKey || !pastEventKeys.has(snapKey))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === snapKey);
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '').toLowerCase();
            const conf = Number(pick?.confidence);
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine))
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FT' : 'FP';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                (String(r.propType) === propType || (propType === 'FP' && (String(r.propType) === 'Fantasy' || String(r.propType) === 'Fantasy_PP')) || (propType === 'FT' && String(r.propType) === 'FightTime')) &&
                Number.isFinite(Number(r.result)))
                .sort((a, b) => {
                const aPP = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPP = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPP !== bPP)
                    return aPP - bPP;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            const result = Number(match.result);
            const isHit = (lean === 'over' && result > activeLine) || (lean === 'under' && result < activeLine);
            const edge = result - activeLine;
            // Confidence grade
            const grade = Number.isFinite(conf) ? (conf >= 80 ? 'A' : conf >= 65 ? 'B' : conf >= 55 ? 'C' : 'D') : 'D';
            const plat = activePlatform || 'unknown';
            // By platform+stat
            const psKey = `${plat}|${propType}`;
            const ps = gradingByPlatStat.get(psKey) || { hits: 0, total: 0, avgEdge: 0, edgeSum: 0 };
            ps.total++;
            if (isHit)
                ps.hits++;
            ps.edgeSum += edge;
            gradingByPlatStat.set(psKey, ps);
            // By grade
            const gr = gradingByGrade.get(grade) || { hits: 0, total: 0, avgEdge: 0, edgeSum: 0 };
            gr.total++;
            if (isHit)
                gr.hits++;
            gr.edgeSum += edge;
            gradingByGrade.set(grade, gr);
            // By platform+grade
            const pgKey = `${plat}|${grade}`;
            const pg = gradingByPlatGrade.get(pgKey) || { hits: 0, total: 0, avgEdge: 0, edgeSum: 0 };
            pg.total++;
            if (isHit)
                pg.hits++;
            pg.edgeSum += edge;
            gradingByPlatGrade.set(pgKey, pg);
        }
    }
    // Grade breakdown HTML
    const GRADE_ORDER = ['A', 'B', 'C', 'D'];
    const gradeBreakdownHtml = GRADE_ORDER.map(g => {
        const d = gradingByGrade.get(g);
        if (!d?.total)
            return '';
        const pct = Math.round((d.hits / d.total) * 100);
        const avgE = (d.edgeSum / d.total).toFixed(1);
        const col = pct >= 60 ? 'var(--green)' : pct >= 48 ? 'var(--amber)' : 'var(--red)';
        const barW = Math.round(Math.min(100, pct));
        return `<div class="grade-row">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:900;color:${col};min-width:22px">${g}</span>
      <div class="grade-bar-bg">
        <div class="grade-bar-fill" data-fill-width="${barW}%" style="width:0%;background:${col};opacity:0.65"></div>
        <span class="grade-bar-pct">${pct}%</span>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);min-width:52px;text-align:right">${d.hits}/${d.total}</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${Number(avgE) >= 0 ? 'var(--green)' : 'var(--red)'};min-width:44px;text-align:right">${Number(avgE) > 0 ? '+' : ''}${avgE}</span>
    </div>`;
    }).filter(Boolean).join('');
    // Platform x Stat heatmap
    const platStatEntries = Array.from(gradingByPlatStat.entries())
        .map(([k, v]) => {
        const [plat, stat] = k.split('|');
        return { plat, stat, ...v, pct: Math.round((v.hits / v.total) * 100), avgEdge: Number((v.edgeSum / v.total).toFixed(1)) };
    })
        .filter(x => x.total >= 2)
        .sort((a, b) => b.pct - a.pct);
    const platStatHtml = platStatEntries.length > 0
        ? `<div style="display:flex;gap:12px;font-size:10px;margin-bottom:6px;padding:0 6px">
        <span style="flex:1;color:var(--text3);font-family:'JetBrains Mono',monospace">Platform / Stat</span>
        <span style="color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:48px;text-align:right">Hit Rate</span>
        <span style="color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:44px;text-align:right">Avg Edge</span>
        <span style="color:var(--text3);font-family:'JetBrains Mono',monospace;min-width:36px;text-align:right">N</span>
       </div>` +
            platStatEntries.map(x => {
                const col = x.pct >= 60 ? 'var(--green)' : x.pct >= 48 ? 'var(--amber)' : 'var(--red)';
                const platLabel = PLAT_LABELS[x.plat] || x.plat.toUpperCase();
                return `<div class="plat-stat-row">
          <div style="flex:0 0 150px;display:flex;align-items:center;gap:6px">
            <span style="font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:700;color:var(--text)">${platLabel}</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">${x.stat}</span>
          </div>
          <span class="ps-bar"><span style="width:${Math.max(2, Math.min(100, x.pct))}%;background:${col}"></span></span>
          <span style="font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;color:${col};min-width:48px;text-align:right">${x.pct}%</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${x.avgEdge >= 0 ? 'var(--green)' : 'var(--red)'};min-width:44px;text-align:right">${x.avgEdge > 0 ? '+' : ''}${x.avgEdge}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);min-width:36px;text-align:right">${x.total}</span>
        </div>`;
            }).join('')
        : '';
    // Best & worst platform+grade combos
    const platGradeEntries = Array.from(gradingByPlatGrade.entries())
        .map(([k, v]) => {
        const [plat, grade] = k.split('|');
        return { plat, grade, ...v, pct: Math.round((v.hits / v.total) * 100), avgEdge: Number((v.edgeSum / v.total).toFixed(1)) };
    })
        .filter(x => x.total >= 3);
    const bestCombos = [...platGradeEntries].sort((a, b) => b.pct - a.pct).slice(0, 5);
    const worstCombos = [...platGradeEntries].sort((a, b) => a.pct - b.pct).slice(0, 5);
    const comboRow = (x, rank) => {
        const col = x.pct >= 60 ? 'var(--green)' : x.pct >= 48 ? 'var(--amber)' : 'var(--red)';
        const platLabel = PLAT_LABELS[x.plat] || x.plat.toUpperCase();
        return `<div class="combo-row">
      <span style="font-family:'JetBrains Mono',monospace;color:var(--text3);min-width:14px;font-size:10px">${rank}.</span>
      <span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--text)">${platLabel}</span>
      <span style="font-family:'Space Grotesk',sans-serif;color:${col};font-weight:800;font-size:11px">${x.grade}</span>
      <span style="font-family:'Space Grotesk',sans-serif;color:${col};font-weight:700;margin-left:auto">${x.pct}%</span>
      <span style="font-family:'JetBrains Mono',monospace;color:var(--text3);font-size:10px">${x.hits}/${x.total}</span>
    </div>`;
    };
    const gradingTotalPicks = Array.from(gradingByGrade.values()).reduce((s, d) => s + d.total, 0);
    const gradingDashboardHtml = gradingTotalPicks > 0 ? `
    <div style="margin-bottom:10px">
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em">Track record by confidence grade — ${gradingTotalPicks} graded picks</span>
    </div>
    ${gradeBreakdownHtml ? `<div style="margin-bottom:14px">${gradeBreakdownHtml}</div>` : ''}
    ${platStatHtml ? `<div style="margin-bottom:14px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:6px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Platform x Stat Hit Rates</div>
      ${platStatHtml}
    </div>` : ''}
    ${bestCombos.length > 0 ? `<div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="combo-card combo-card-best">
        <div class="combo-card-title" style="color:var(--green)">Best Combos</div>
        ${bestCombos.map((x, i) => comboRow(x, i + 1)).join('')}
      </div>
      <div class="combo-card combo-card-worst">
        <div class="combo-card-title" style="color:var(--red)">Worst Combos</div>
        ${worstCombos.map((x, i) => comboRow(x, i + 1)).join('')}
      </div>
    </div>` : ''}` : null;
    // Collapsible section helper — wraps header with chevron + body with slide wrapper
    const cSec = (id, extraClass, headerClass, title, count, body, style = '') => {
        const isCollapsed = _archiveCollapsedSections.has(id);
        return `<div class="best-picks-section ${extraClass}${isCollapsed ? ' collapsed' : ''}" data-section-id="${id}" style="${style}">
      <div class="best-picks-header ${headerClass}"><span class="best-picks-title">${title}</span><span class="best-picks-count">${count}</span><span class="section-chevron">▼</span></div>
      <div class="section-body">${body}</div>
    </div>`;
    };
    // ── Load prediction data for the Predictions section ──
    _cachedPredictions = await PropLinePredictorService.getPredictions();
    // Auto-correct event name if prediction fighters match the current upcoming card
    const curEventName = (upcomingEventName || '').trim();
    debugLog(`Prediction auto-correct check: curEvent="${curEventName}" cardPairs=${upcomingCardPairs.length} preds=${_cachedPredictions.length}`);
    if (curEventName && upcomingCardPairs.length > 0) {
        const cardNames = new Set(upcomingCardPairs.flatMap(p => [p.f1.toLowerCase(), p.f2.toLowerCase()]));
        for (const pred of _cachedPredictions) {
            if (pred.settled || pred.event === curEventName)
                continue;
            const matchCount = pred.predictions.filter(p => cardNames.has(p.fighter.toLowerCase()) || cardNames.has((normalizeName(p.fighter) || '').toLowerCase())).length;
            debugLog(`Prediction auto-correct: "${pred.event}" matchCount=${matchCount}/${pred.predictions.length} threshold=${Math.min(pred.predictions.length, 4)}`);
            if (matchCount >= Math.min(pred.predictions.length, 4)) {
                debugLog(`Auto-correcting prediction event: "${pred.event}" → "${curEventName}"`);
                pred.event = curEventName;
                await PropLinePredictorService.savePredictions(_cachedPredictions);
            }
        }
    }
    _cachedLearningLog = await PropLinePredictorService.getLearningLog();
    const predictionsHtml = renderPredictionsHtml(cSec);
    const calibBody = calibCurveHtml
        ? calibCurveHtml
        : `<div class="archive-empty-state">
        <div class="archive-empty-icon">📈</div>
        <div class="archive-empty-text">${calibTotalSamples === 0
            ? `No AI lean snapshots matched to settled archive records yet.<br>The calibration curve needs picks with <b style="color:var(--text2)">confidence scores</b> matched to actual outcomes.`
            : calibActiveBuckets.length < 2
                ? `Only ${calibActiveBuckets.length} confidence bucket has data — need picks across at least <b style="color:var(--text2)">2 confidence ranges</b> for a meaningful curve.`
                : `${calibTotalSamples} picks resolved — collecting more data...`}</div>
      </div>`;
    const backtestBody = backtestHtml
        ? backtestHtml
        : `<div class="archive-empty-state">
        <div class="archive-empty-icon">📊</div>
        <div class="archive-empty-text">Walk-forward backtesting needs fighters with <b style="color:var(--text2)">7+ historical fight results</b> loaded.<br>Load an event with fighter databases to populate this panel.</div>
      </div>`;
    const gradingBody = gradingDashboardHtml
        ? gradingDashboardHtml
        : `<div class="archive-empty-state">
        <div class="archive-empty-icon">🎯</div>
        <div class="archive-empty-text">Grading dashboard needs <b style="color:var(--text2)">AI lean snapshots</b> matched to settled archive results.<br>Snap your picks before an event and settle results after to populate this panel.</div>
      </div>`;
    container.innerHTML = `
    ${pendingBannerHtml}
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <button id="archiveSettleBtn" class="btn btn-sm" style="background:var(--accent);color:#fff;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px">
        ⚡ Settle from UFCStats
      </button>
      <button id="archiveBackfillBtn" class="btn btn-sm" style="background:var(--surface2);color:var(--text);padding:4px 12px;border-radius:6px;border:none;cursor:pointer;font-size:12px">
        ↻ Force Backfill
      </button>
      <span style="font-size:11px;color:var(--text-muted)">${allRows.length} total records · ${statusLine} <span style="color:var(--text-muted)">${stalenessLabel}</span></span>
    </div>
    ${predictionsHtml}
    ${cSec('events', '', '', 'Per-Event Results', `${resolvedRows.length} resolved`, eventHtml, 'margin-bottom:12px')}
    ${cSec('ai-accuracy', '', '', 'AI Pick Accuracy by Stat Type', `<span style="font-size:10px;color:var(--text-muted)">lean direction correct (over + under)</span>`, statSummaryHtml, 'margin-bottom:12px')}
    ${cSec('entry-clv', '', '', 'Your CLV (entry → close)', `<span style="font-size:10px;color:var(--text-muted)">avg Δ from entry line · positive = you beat the close</span>`, entryClvHtml, 'margin-bottom:12px')}
    <div class="best-picks-grid">
      ${cSec('fp-hitrate', 'over', 'takes', 'Fantasy Line Hit Rate (Current Roster)', `${fantasyHits}/${fantasyTotal} · ${fantasyHitRate}%`, topFantasyHtml)}
    </div>
    <div class="best-picks-grid" style="margin-top:12px">
      ${cSec('ss-hitrate', 'over', 'takes', 'SS Hit Rate (Current Roster)', `${ssHits}/${ssRows.length}`, topSSHtml)}
      ${cSec('td-hitrate', 'under', 'takes', 'TD Hit Rate (Current Roster)', `${tdHits}/${tdRows.length}`, topTDHtml)}
    </div>
    ${cSec('bias', '', '', 'Platform Bias', `<span style="font-size:10px;color:var(--text-muted)">${resolvedRows.filter(r => !!r.platform).length} records with platform</span>`, `${platSummaryHtml}${biasChartHtml}${biasHtml}`, 'margin-top:12px')}
    ${cSec('calibration', '', '', 'Calibration Curve', `<span style="font-size:10px;color:var(--text-muted)">${calibTotalSamples} picks resolved across ${new Set(resolvedRows.map(r => r.event)).size} event(s)</span>`, calibBody, 'margin-top:12px')}
    ${cSec('backtest', '', '', 'Backtesting Dashboard', `<span style="font-size:10px;color:var(--text3)">${bt ? `${bt.totalEvents} events · ${bt.totalPreds} predictions · ${bt.wf.folds.length} folds` : 'needs fighter history'}</span>`, backtestBody, 'margin-top:12px')}
    ${cSec('grading', '', '', 'Prop Archive Grading', `<span style="font-size:10px;color:var(--text3)">${gradingTotalPicks > 0 ? `${gradingTotalPicks} graded AI picks` : 'needs settled AI picks'}</span>`, gradingBody, 'margin-top:12px')}
  `;
    // Shared settle handler — used by both the main button and the pending banner CTA
    const runSettle = async (btn, resetLabel) => {
        btn.disabled = true;
        btn.textContent = '⏳ Fetching results...';
        try {
            const res = await runtimeSendMessage({ type: 'GRADE_ARCHIVE' });
            if (res?.ok) {
                _confidenceMemoryCache = null;
                showToast(`✓ Settled ${res.settled} records from UFCStats${res.errors.length ? ` (${res.errors.length} events not found yet)` : ''}`);
                _fighterArchiveStats = null; // force reload so fighter cards reflect new results
                _fighterClvDrift = null;
                void renderArchivePanel(container);
            }
            else {
                showToast('Settle failed — check console');
            }
        }
        catch {
            showToast('Settle error — extension may need reload');
        }
        finally {
            btn.disabled = false;
            btn.textContent = resetLabel;
        }
    };
    // Wire up action buttons
    document.getElementById('archiveSettleBtn')?.addEventListener('click', (e) => {
        void runSettle(e.currentTarget, '⚡ Settle from UFCStats');
    });
    document.getElementById('pendingSettleBtn')?.addEventListener('click', (e) => {
        void runSettle(e.currentTarget, '⚡ SETTLE NOW');
    });
    document.getElementById('pendingDismissBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳...';
        try {
            const raw = await new Promise(res => chrome.storage.local.get(['prop_archive_v1'], res));
            const archive = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
            let dismissed = 0;
            for (const r of archive) {
                if (Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result))) {
                    r.result = Number(r.line); // mark as push
                    dismissed++;
                }
            }
            if (dismissed > 0) {
                await new Promise((res, rej) => chrome.storage.local.set({ prop_archive_v1: archive }, () => {
                    const err = chrome.runtime?.lastError;
                    if (err)
                        rej(new Error(err.message));
                    else
                        res();
                }));
            }
            // All resolved — clear Betr lines since event is over
            await new Promise((res) => chrome.storage.local.remove(['lines_betr', 'lines_betr_manual_v1'], () => res()));
            showToast(`✓ Dismissed ${dismissed} record${dismissed === 1 ? '' : 's'} — Betr lines cleared`);
            void renderArchivePanel(container);
        }
        catch {
            showToast('Dismiss error');
        }
        finally {
            btn.disabled = false;
            btn.textContent = '✕ DISMISS';
        }
    });
    document.getElementById('archiveBackfillBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳ Running...';
        try {
            const res = await runtimeSendMessage({ type: 'FORCE_BACKFILL' });
            if (res?.ok) {
                showToast(`✓ Backfill: ${res.changed} records resolved (${res.unresolvedAfter} still pending)`);
                void renderArchivePanel(container);
            }
        }
        catch {
            showToast('Backfill error');
        }
        finally {
            btn.disabled = false;
            btn.textContent = '↻ Force Backfill';
        }
    });
    // Pred rows: avatar hydration + jump-to-card
    hydrateAvatarImgs(container);
    container.querySelectorAll('.pred-row[data-jump]').forEach(el => {
        el.addEventListener('click', () => jumpToFighterCard(el.dataset['jump'] || ''));
    });
    // Predictor: Generate Predictions button
    container.querySelectorAll('#predictorGenerateBtn').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '⏳ Fetching fighter data...';
            try {
                await generatePredictions(container);
            }
            catch (err) {
                showToast('Prediction error — ' + (err instanceof Error ? err.message : String(err)));
            }
            finally {
                btn.disabled = false;
                btn.textContent = '⚡ Generate Predictions';
            }
        });
    });
    // Predictor: Run Learning Cycle button
    container.querySelector('#predictorLearnBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳ Learning...';
        try {
            const raw = await new Promise(res => chrome.storage.local.get(['prop_archive_v1'], res));
            const archive = Array.isArray(raw.prop_archive_v1) ? raw.prop_archive_v1 : [];
            const preds = await PropLinePredictorService.getPredictions();
            const unsettled = preds.find(p => !p.settled &&
                p.event !== (upcomingEventName || '').trim() &&
                p.event !== upcomingEventName);
            if (!unsettled) {
                showToast('No unsettled predictions to learn from');
                return;
            }
            const result = await PropLinePredictorService.runLearningCycle(unsettled.event, archive);
            if (result) {
                showToast(`✓ Learned from ${result.predictions.length} fighters — weights v${(await PropLinePredictorService.getWeights()).version}`);
                _cachedPredictions = null;
                _cachedLearningLog = null;
                void renderArchivePanel(container);
            }
            else {
                showToast('No matching predictions found for learning');
            }
        }
        catch (err) {
            showToast('Learning error — ' + (err instanceof Error ? err.message : String(err)));
        }
        finally {
            btn.disabled = false;
            btn.textContent = '▶ Run Learning Cycle';
        }
    });
    container.querySelector('#predictorDeleteBtn')?.addEventListener('click', async () => {
        const preds = await PropLinePredictorService.getPredictions();
        const curEvent = (upcomingEventName || '').trim();
        // Prefer past-event unsettled (the banner case); fall back to any unsettled.
        const unsettled = preds.find(p => !p.settled && p.event !== curEvent && p.event !== upcomingEventName) ?? preds.find(p => !p.settled);
        if (!unsettled)
            return;
        // Delete all UNSETTLED entries for this event — preserves the settled audit
        // record (if any) but cleans up duplicates from re-generation.
        const matches = preds.filter(p => p.event === unsettled.event && !p.settled);
        const dupNote = matches.length > 1 ? ` (${matches.length} duplicates)` : '';
        if (!confirm(`Delete predictions for "${unsettled.event}"${dupNote}?`))
            return;
        const filtered = preds.filter(p => !(p.event === unsettled.event && !p.settled));
        await PropLinePredictorService.savePredictions(filtered);
        _cachedPredictions = null;
        showToast(`Deleted predictions for "${unsettled.event}"${dupNote}`);
        void renderArchivePanel(container);
    });
    // Platform bias sort headers
    container.querySelectorAll('[data-bias-sort]').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.biasSort;
            if (key) {
                _archiveBiasSortKey = key;
                void renderArchivePanel(container);
            }
        });
    });
    // Delete-event buttons
    container.querySelectorAll('.archive-delete-event-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const eventName = btn.dataset.event || '';
            if (!eventName)
                return;
            if (!confirm(`Delete all archive records for "${eventName}"?`))
                return;
            const res = await runtimeSendMessage({ type: 'DELETE_ARCHIVE_EVENT', eventName });
            if (res?.ok) {
                showToast(`Deleted ${res.deleted} records for ${eventName}`);
                void renderArchivePanel(container);
            }
        });
    });
    // ── Collapsible section toggle ───────────────────────────────────────
    container.querySelectorAll('.best-picks-section[data-section-id]').forEach(section => {
        const header = section.querySelector('.best-picks-header');
        if (!header)
            return;
        header.addEventListener('click', (e) => {
            // Don't collapse when clicking buttons/links inside the header
            if (e.target.closest('button, a, [data-bias-sort]'))
                return;
            const id = section.dataset.sectionId;
            const body = section.querySelector('.section-body');
            if (!body)
                return;
            if (_archiveCollapsedSections.has(id)) {
                // Expand: set max-height to scrollHeight for smooth open, then remove after transition
                _archiveCollapsedSections.delete(id);
                section.classList.remove('collapsed');
                body.style.maxHeight = body.scrollHeight + 'px';
                body.addEventListener('transitionend', function handler() {
                    body.style.maxHeight = '';
                    body.removeEventListener('transitionend', handler);
                }, { once: true });
            }
            else {
                // Collapse: set explicit max-height first so transition has a start value
                _archiveCollapsedSections.add(id);
                body.style.maxHeight = body.scrollHeight + 'px';
                // Force reflow so the browser registers the starting value
                void body.offsetHeight;
                section.classList.add('collapsed');
                body.style.maxHeight = '0';
            }
        });
    });
    // ── Animate archive bars (grade bars, etc.) on scroll into view ──────
    if (typeof IntersectionObserver !== 'undefined') {
        const archiveBarObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting)
                    return;
                entry.target.querySelectorAll('[data-fill-width]').forEach((bar, idx) => {
                    setTimeout(() => { bar.style.width = bar.dataset.fillWidth; }, Math.min(idx * 6, 350));
                });
                archiveBarObserver.unobserve(entry.target);
            });
        }, { threshold: 0.1 });
        container.querySelectorAll('.best-picks-section[data-section-id]').forEach(sec => {
            archiveBarObserver.observe(sec);
        });
    }
    else {
        container.querySelectorAll('[data-fill-width]').forEach(bar => {
            bar.style.width = bar.dataset.fillWidth;
        });
    }
    // ── Animated number counters for backtest stat cards ─────────────────
    const counterEls = container.querySelectorAll('.bt-counter');
    if (counterEls.length > 0) {
        const DURATION = 900; // ms
        const startTime = performance.now();
        const counters = Array.from(counterEls).map(el => ({
            el,
            target: parseFloat(el.dataset.target || '0'),
            suffix: el.dataset.suffix || '',
            decimals: parseInt(el.dataset.decimals || '0', 10),
        }));
        const easeOutExpo = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        const tick = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / DURATION, 1);
            const eased = easeOutExpo(progress);
            for (const c of counters) {
                const current = c.target * eased;
                c.el.textContent = current.toFixed(c.decimals) + c.suffix;
            }
            if (progress < 1) {
                requestAnimationFrame(tick);
            }
        };
        // Small delay so the card fade-in animation starts first
        setTimeout(() => requestAnimationFrame(tick), 80);
    }
}
// ── Platform Line Bias Cache ─────────────────────────────────────────────────
// Populated by initPlatformBiasCache (called at data load) and renderCalibrationPanel.
// Key = "platform|propType" e.g. "pick6|SS". Value includes avg edge, hit rate, sample size.
const PLAT_LABEL_MAP = { pick6: 'Pick6', underdog: 'UD', prizepicks: 'PP', betr: 'Betr', draftkings_sportsbook: 'DK' };
const SOURCE_TO_PLAT = { p6: 'pick6', ud: 'underdog', pp: 'prizepicks', betr: 'betr', dk: 'draftkings_sportsbook' };
let _platformBiasCache = null;
/** For a given stat + lean direction, rank platforms by historical edge. Returns best platform source key. */
function getBiasAdjustedBest(stat, leanDir, available) {
    if (!_platformBiasCache || available.length < 2)
        return null;
    const propType = stat === 'ss' ? 'SS' : stat === 'td' ? 'TD' : 'FightTime';
    const scored = available.map(src => {
        const plat = SOURCE_TO_PLAT[src] || src;
        const bias = _platformBiasCache.find(b => b.platform === plat && b.propType === propType);
        if (!bias || bias.total < 3)
            return { src, score: 0, n: 0 };
        // For OVER: want positive edge (result > line = line set too low = soft)
        // For UNDER: want negative edge (result < line = line set too high = soft)
        const score = leanDir === 'over' ? bias.avgEdge : -bias.avgEdge;
        return { src, score, n: bias.total };
    }).filter(s => s.n >= 3);
    if (scored.length < 1)
        return null;
    scored.sort((a, b) => b.score - a.score);
    // Only badge if top edge is meaningfully better than average
    if (scored[0].score <= 0.3)
        return null;
    return scored[0].src;
}
async function initPlatformBiasCache() {
    try {
        const payload = await storageGet([STORAGE_PROP_ARCHIVE_KEY]);
        const allRows = Array.isArray(payload[STORAGE_PROP_ARCHIVE_KEY])
            ? payload[STORAGE_PROP_ARCHIVE_KEY] : [];
        if (!allRows.length)
            return;
        const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
        const resolved = allRows.filter(r => Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result)) &&
            Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) >= londonTs && !!r.platform);
        const map = new Map();
        for (const r of resolved) {
            const key = `${String(r.platform).toLowerCase()}|${r.propType}`;
            const b = map.get(key) || { platform: String(r.platform).toLowerCase(), propType: String(r.propType), hits: 0, total: 0, edgeSum: 0 };
            let result = Number(r.result);
            const line = Number(r.line);
            // Normalize FT results stored in seconds to minutes (line is always in minutes)
            if (String(r.propType) === 'FightTime' && result > 25)
                result = result / 60;
            b.total++;
            b.edgeSum += result - line;
            if (result > line)
                b.hits++;
            map.set(key, b);
        }
        _platformBiasCache = Array.from(map.values())
            .filter(b => b.total >= 2)
            .map(b => ({ ...b, avgEdge: Number((b.edgeSum / b.total).toFixed(1)), hitRate: Math.round((b.hits / b.total) * 100) }));
        if (_platformBiasCache.length)
            debugLog(`Platform bias cache: ${_platformBiasCache.length} entries`);
    }
    catch (e) {
        debugLog(`Platform bias init error: ${e.message}`);
    }
}
// ── Confidence Recalibration Engine ──────────────────────────────────────────
// Maps raw confidence bucket midpoint → recalibrated confidence (actual hit rate).
// Populated by renderCalibrationPanel, consumed by getRecalibratedConfidence.
let _recalibrationMap = null;
let _recalibrationByType = {};
function getRecalibratedConfidence(rawConf, source) {
    if (!_recalibrationMap || _recalibrationMap.size < 2)
        return null;
    const typeKey = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
    const typeMap = _recalibrationByType[typeKey];
    const map = (typeMap && typeMap.size >= 2) ? typeMap : _recalibrationMap;
    // Find the two nearest bucket midpoints and interpolate
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    if (rawConf <= entries[0][0])
        return entries[0][1];
    if (rawConf >= entries[entries.length - 1][0])
        return entries[entries.length - 1][1];
    for (let i = 0; i < entries.length - 1; i++) {
        const [lo, loVal] = entries[i];
        const [hi, hiVal] = entries[i + 1];
        if (rawConf >= lo && rawConf <= hi) {
            const t = (rawConf - lo) / (hi - lo);
            return Math.round(loVal + t * (hiVal - loVal));
        }
    }
    return null;
}
// ── Calibration Panel (dedicated tab) ────────────────────────────────────────
async function renderCalibrationPanel(container) {
    container.innerHTML = loadingSkeleton('Loading calibration data…');
    const [archivePayload, aiSnapshotPayload] = await Promise.all([
        storageGet([STORAGE_PROP_ARCHIVE_KEY]),
        storageGet([STORAGE_AI_LEAN_SNAPSHOT_KEY]),
    ]);
    const allRows = Array.isArray(archivePayload[STORAGE_PROP_ARCHIVE_KEY])
        ? archivePayload[STORAGE_PROP_ARCHIVE_KEY] : [];
    const aiSnapshots = Array.isArray(aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
        ? aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY] : [];
    const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
    const nowTs = Date.now();
    // Build event dedup key inline (same logic as archive panel)
    function eventDedupeKey(name) {
        const m = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
        if (!m)
            return name.toLowerCase().trim();
        const a = m[1].trim().split(/\s+/).pop().toLowerCase();
        const b = m[2].trim().split(/\s+/).pop().toLowerCase();
        return [a, b].sort().join('|');
    }
    // Determine past event keys
    const eventDateMap = new Map();
    for (const r of allRows) {
        const ts = Date.parse(r.date);
        if (!Number.isFinite(ts) || ts < londonTs)
            continue;
        const key = eventDedupeKey(r.event || '');
        const existing = eventDateMap.get(key) || Infinity;
        if (ts < existing)
            eventDateMap.set(key, ts);
    }
    const pastEventKeys = new Set(Array.from(eventDateMap.entries())
        .filter(([, ts]) => ts <= nowTs || allRows.some(r => eventDedupeKey(r.event || '') === eventDedupeKey(r.event || '') && Number.isFinite(Number(r.result))))
        .map(([k]) => k));
    const makeBuckets = () => [
        { rangeLabel: '50–54%', midpoint: 52, hits: 0, total: 0 },
        { rangeLabel: '55–59%', midpoint: 57, hits: 0, total: 0 },
        { rangeLabel: '60–64%', midpoint: 62, hits: 0, total: 0 },
        { rangeLabel: '65–69%', midpoint: 67, hits: 0, total: 0 },
        { rangeLabel: '70–74%', midpoint: 72, hits: 0, total: 0 },
        { rangeLabel: '75–79%', midpoint: 77, hits: 0, total: 0 },
        { rangeLabel: '80–84%', midpoint: 82, hits: 0, total: 0 },
        { rangeLabel: '85–89%', midpoint: 87, hits: 0, total: 0 },
        { rangeLabel: '90%+', midpoint: 92, hits: 0, total: 0 },
    ];
    const calibBuckets = makeBuckets();
    const CALIB_STAT_TYPES = ['Fantasy', 'SS', 'TD', 'FightTime'];
    const calibByType = {};
    for (const pt of CALIB_STAT_TYPES)
        calibByType[pt] = makeBuckets();
    const eventCalibMap = new Map();
    // Over/under breakdown
    let overHits = 0, overTotal = 0, underHits = 0, underTotal = 0;
    let calibTotalSamples = 0;
    const bucketIdx = (conf) => conf >= 90 ? 8 : conf >= 85 ? 7 : conf >= 80 ? 6 : conf >= 75 ? 5
        : conf >= 70 ? 4 : conf >= 65 ? 3 : conf >= 60 ? 2 : conf >= 55 ? 1 : 0;
    for (const snap of aiSnapshots) {
        const snapEventKey = eventDedupeKey(String(snap?.event || ''));
        if (!snapEventKey || !pastEventKeys.has(snapEventKey))
            continue;
        const eventArchiveRows = allRows.filter(r => eventDedupeKey(r.event || '') === snapEventKey);
        if (!eventArchiveRows.length)
            continue;
        for (const pick of (snap?.picks ?? [])) {
            const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
            const lean = String(pick?.lean || '').toLowerCase();
            const conf = Number(pick?.confidence);
            const source = String(pick?.source || 'fp');
            const activeLine = Number(pick?.activeLine);
            const activePlatform = String(pick?.activePlatform || '').trim().toLowerCase();
            if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine) || !Number.isFinite(conf) || conf < 50)
                continue;
            const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
            const match = eventArchiveRows
                .filter(r => normalizeName(r.fighter)?.toLowerCase() === fighter &&
                String(r.propType) === propType &&
                Number.isFinite(Number(r.result)))
                .sort((a, b) => {
                const aPP = activePlatform && String(a.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                const bPP = activePlatform && String(b.platform || '').toLowerCase() === activePlatform ? 0 : 1;
                if (aPP !== bPP)
                    return aPP - bPP;
                return Math.abs(Number(a.line ?? activeLine) - activeLine) - Math.abs(Number(b.line ?? activeLine) - activeLine);
            })[0];
            if (!match)
                continue;
            const result = Number(match.result);
            const isHit = (lean === 'over' && result > activeLine) || (lean === 'under' && result < activeLine);
            // Global buckets
            const bi = bucketIdx(conf);
            calibBuckets[bi].total++;
            if (isHit)
                calibBuckets[bi].hits++;
            calibTotalSamples++;
            // Per-type
            if (calibByType[propType]) {
                calibByType[propType][bi].total++;
                if (isHit)
                    calibByType[propType][bi].hits++;
            }
            // Over/Under
            if (lean === 'over') {
                overTotal++;
                if (isHit)
                    overHits++;
            }
            else {
                underTotal++;
                if (isHit)
                    underHits++;
            }
            // Per-event temporal tracking
            const eventName = String(snap?.event || 'Unknown');
            const eventDate = Date.parse(String(snap?.eventDate || snap?.capturedAt || ''));
            const ec = eventCalibMap.get(snapEventKey) || { event: eventName, date: Number.isFinite(eventDate) ? eventDate : 0, hits: 0, total: 0, brierSum: 0 };
            ec.total++;
            if (isHit)
                ec.hits++;
            const predicted = conf / 100;
            ec.brierSum += (predicted - (isHit ? 1 : 0)) ** 2;
            eventCalibMap.set(snapEventKey, ec);
        }
    }
    // ── Build recalibration map ────────────────────────────────────────────────
    const newRecalMap = new Map();
    const newRecalByType = {};
    for (const b of calibBuckets) {
        if (b.total >= 3)
            newRecalMap.set(b.midpoint, Math.round((b.hits / b.total) * 100));
    }
    for (const pt of CALIB_STAT_TYPES) {
        newRecalByType[pt] = new Map();
        for (const b of calibByType[pt]) {
            if (b.total >= 3)
                newRecalByType[pt].set(b.midpoint, Math.round((b.hits / b.total) * 100));
        }
    }
    _recalibrationMap = newRecalMap;
    _recalibrationByType = newRecalByType;
    // ── Compute overall calibration score ──────────────────────────────────────
    let brierSum = 0, brierN = 0;
    for (const b of calibBuckets) {
        if (b.total < 2)
            continue;
        brierSum += ((b.midpoint / 100) - (b.hits / b.total)) ** 2;
        brierN++;
    }
    const calibScore = brierN > 0 ? Math.round((1 - Math.sqrt(brierSum / brierN)) * 100) : null;
    // ── Collapsible section helper ─────────────────────────────────────────────
    const cSec = (id, title, count, body, style = '') => {
        const isCollapsed = _archiveCollapsedSections.has(id);
        return `<div class="best-picks-section${isCollapsed ? ' collapsed' : ''}" data-section-id="${id}" style="${style}">
      <div class="best-picks-header"><span class="best-picks-title">${title}</span><span class="best-picks-count">${count}</span><span class="section-chevron">▼</span></div>
      <div class="section-body">${body}</div>
    </div>`;
    };
    // ── Empty state ────────────────────────────────────────────────────────────
    if (calibTotalSamples === 0) {
        container.innerHTML = `
      <div class="archive-empty-state" style="padding:40px 20px;text-align:center">
        <div class="archive-empty-icon">📈</div>
        <div class="archive-empty-text">
          No calibration data yet.<br><br>
          The calibration panel needs <b style="color:var(--text2)">AI lean snapshots</b> matched to
          <b style="color:var(--text2)">settled archive results</b>.<br>
          Load an event, let the analyzer generate picks, then settle results after the fights.
        </div>
      </div>`;
        return;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: Hero Score Ring + Summary
    // ═══════════════════════════════════════════════════════════════════════════
    const scoreColor = calibScore != null
        ? (calibScore >= 85 ? 'var(--green)' : calibScore >= 70 ? 'var(--amber)' : 'var(--red)')
        : 'var(--text-muted)';
    const scorePct = calibScore ?? 0;
    const scoreVerdict = calibScore == null ? 'Insufficient data'
        : calibScore >= 85 ? 'Excellent — confidence closely matches reality'
            : calibScore >= 70 ? 'Good — minor gaps between predicted and actual'
                : calibScore >= 55 ? 'Fair — noticeable overconfidence or underconfidence'
                    : 'Needs work — confidence scores diverge from reality';
    const overallHitRate = calibTotalSamples > 0
        ? Math.round(calibBuckets.reduce((s, b) => s + b.hits, 0) / calibTotalSamples * 100) : 0;
    const eventCount = eventCalibMap.size;
    const heroHtml = `<div class="calib-hero">
    <div class="calib-score-ring" style="--calib-pct:${scorePct};--calib-color:${scoreColor}">
      <div class="calib-score-inner">
        <div class="calib-score-num" style="color:${scoreColor}">${calibScore ?? '—'}</div>
        <div class="calib-score-label">Calibration</div>
      </div>
    </div>
    <div class="calib-summary">
      <div class="calib-summary-title">Confidence Calibration</div>
      <div class="calib-summary-text">
        ${scoreVerdict}<br>
        <span style="color:var(--text-muted)">${calibTotalSamples} picks resolved across ${eventCount} event${eventCount === 1 ? '' : 's'} · Overall hit rate: <span style="color:${overallHitRate >= 55 ? 'var(--green)' : overallHitRate >= 45 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${overallHitRate}%</span></span>
      </div>
    </div>
  </div>`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: Calibration Curve (bar chart — same visual as archive)
    // ═══════════════════════════════════════════════════════════════════════════
    const maxBarH = 90;
    const activeBuckets = calibBuckets.filter(b => b.total > 0);
    const curveBarHtml = calibBuckets.map(b => {
        if (b.total === 0)
            return '';
        const actualRate = Math.round((b.hits / b.total) * 100);
        const predicted = b.midpoint;
        const diff = actualRate - predicted;
        const diffSign = diff > 0 ? '+' : '';
        const diffColor = Math.abs(diff) <= 5 ? 'var(--green)' : Math.abs(diff) <= 12 ? 'var(--amber)' : 'var(--red)';
        const predictedH = Math.round((predicted / 100) * maxBarH);
        const actualH = Math.round((actualRate / 100) * maxBarH);
        const actualColor = actualRate >= predicted - 3 ? 'var(--green)' : actualRate >= predicted - 12 ? 'var(--amber)' : 'var(--red)';
        const lowN = b.total < 5;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:42px">
      <div style="font-size:9px;color:${diffColor};font-weight:700${lowN ? ';opacity:0.5' : ''}">${diffSign}${diff}%</div>
      <div style="position:relative;width:100%;height:${maxBarH}px;display:flex;align-items:flex-end;justify-content:center">
        <div style="position:absolute;bottom:0;width:60%;height:${predictedH}px;background:rgba(125,145,190,0.12);border:1px dashed rgba(125,145,190,0.3);border-radius:3px" title="Predicted: ${predicted}%"></div>
        <div style="position:relative;width:50%;height:${actualH}px;background:${actualColor};opacity:${lowN ? 0.45 : 0.85};border-radius:4px 4px 2px 2px;box-shadow:0 0 10px ${actualColor};z-index:1" title="Actual: ${actualRate}% (${b.hits}/${b.total})"></div>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--text)">${actualRate}%</div>
      <div style="font-size:9px;color:var(--text-muted)">${b.rangeLabel}</div>
      <div style="font-size:8px;color:var(--text-muted);opacity:0.6">n=${b.total}</div>
    </div>`;
    }).filter(Boolean).join('');
    const curveHtml = activeBuckets.length >= 2
        ? `<div style="font-size:9px;color:var(--text-muted);margin-bottom:8px">Dashed = predicted confidence · Solid = actual hit rate · Green = well-calibrated</div>
       <div style="display:flex;gap:3px;align-items:flex-end;padding:6px 0 0 0">${curveBarHtml}</div>`
        : `<div class="archive-empty-state"><div class="archive-empty-icon">📊</div><div class="archive-empty-text">Need picks across at least 2 confidence ranges for a meaningful curve.</div></div>`;
    // Per-stat mini row
    const statMiniHtml = CALIB_STAT_TYPES.map(pt => {
        const buckets = calibByType[pt];
        const active = buckets.filter(b => b.total > 0);
        if (active.length < 1)
            return '';
        const label = pt === 'FightTime' ? 'FT' : pt === 'Fantasy' ? 'FP' : pt;
        const totalHits = active.reduce((s, b) => s + b.hits, 0);
        const totalN = active.reduce((s, b) => s + b.total, 0);
        const overallRate = totalN > 0 ? Math.round((totalHits / totalN) * 100) : 0;
        const dots = buckets.map(b => {
            if (b.total === 0)
                return `<div style="width:8px;height:8px;border-radius:50%;background:var(--surface2);border:1px solid rgba(125,145,190,0.15)" title="${b.rangeLabel}: no data"></div>`;
            const actual = Math.round((b.hits / b.total) * 100);
            const ddiff = Math.abs(actual - b.midpoint);
            const col = ddiff <= 5 ? 'var(--green)' : ddiff <= 12 ? 'var(--amber)' : 'var(--red)';
            return `<div style="width:8px;height:8px;border-radius:50%;background:${col};opacity:${b.total < 3 ? 0.4 : 0.85}" title="${b.rangeLabel}: ${actual}% actual (${b.hits}/${b.total})"></div>`;
        }).join('');
        const rateColor = overallRate >= 55 ? 'var(--green)' : overallRate >= 45 ? 'var(--amber)' : 'var(--red)';
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
      <span style="font-size:10px;font-weight:700;min-width:18px;color:var(--text)">${label}</span>
      <div style="display:flex;gap:3px;align-items:center">${dots}</div>
      <span style="font-size:10px;color:${rateColor};margin-left:auto">${totalHits}/${totalN} (${overallRate}%)</span>
    </div>`;
    }).filter(Boolean).join('');
    const curveBody = curveHtml + (statMiniHtml ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(125,145,190,0.1)">
    <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Per-Stat Calibration</div>
    ${statMiniHtml}
  </div>` : '');
    const diagCards = [];
    // Over/Under imbalance
    const overRate = overTotal > 0 ? Math.round((overHits / overTotal) * 100) : null;
    const underRate = underTotal > 0 ? Math.round((underHits / underTotal) * 100) : null;
    if (overRate !== null && underRate !== null && overTotal >= 5 && underTotal >= 5) {
        const gap = Math.abs(overRate - underRate);
        if (gap >= 15) {
            const weaker = overRate < underRate ? 'OVER' : 'UNDER';
            const weakerRate = overRate < underRate ? overRate : underRate;
            const strongerRate = overRate < underRate ? underRate : overRate;
            diagCards.push({
                title: `${weaker} Leans Underperforming`,
                body: `${weaker} picks hit at ${weakerRate}% vs ${strongerRate}% for the other side. The model may be systematically misjudging one direction.`,
                action: `Consider raising the confidence threshold for ${weaker} leans by ~${Math.round(gap / 2)} points before acting on them.`,
                severity: gap >= 25 ? 'red' : 'amber',
                badge: `${weakerRate}% hit`,
            });
        }
    }
    // Per-bucket overconfidence detection
    for (const b of calibBuckets) {
        if (b.total < 5)
            continue;
        const actual = Math.round((b.hits / b.total) * 100);
        const diff = actual - b.midpoint;
        if (diff <= -15) {
            diagCards.push({
                title: `${b.rangeLabel} Confidence is Overconfident`,
                body: `Picks rated ${b.rangeLabel} confidence actually hit at only ${actual}% (${b.hits}/${b.total}). The model overestimates its certainty in this range by ${Math.abs(diff)} points.`,
                action: `Treat "${getConfidenceGrade(b.midpoint)}-grade" picks in this range as ${getConfidenceGrade(actual)}-grade. The recalibration engine below auto-corrects this.`,
                severity: diff <= -25 ? 'red' : 'amber',
                badge: `${diff > 0 ? '+' : ''}${diff}%`,
            });
        }
        else if (diff >= 10 && actual >= 60) {
            diagCards.push({
                title: `${b.rangeLabel} Confidence is Underconfident`,
                body: `Picks rated ${b.rangeLabel} actually hit at ${actual}% — the model is more accurate than it thinks here (+${diff}pts). These are hidden value picks.`,
                action: `This is good! Picks in this range are better than their confidence label suggests.`,
                severity: 'green',
                badge: `+${diff}%`,
            });
        }
    }
    // Per-stat-type diagnosis
    for (const pt of CALIB_STAT_TYPES) {
        const buckets = calibByType[pt];
        const active = buckets.filter(b => b.total >= 3);
        if (active.length < 2)
            continue;
        const totalHits = active.reduce((s, b) => s + b.hits, 0);
        const totalN = active.reduce((s, b) => s + b.total, 0);
        const overallRate = Math.round((totalHits / totalN) * 100);
        const avgPredicted = Math.round(active.reduce((s, b) => s + b.midpoint * b.total, 0) / totalN);
        const gap = overallRate - avgPredicted;
        const label = pt === 'FightTime' ? 'FT' : pt === 'Fantasy' ? 'FP' : pt;
        if (Math.abs(gap) >= 12) {
            diagCards.push({
                title: `${label} Confidence ${gap < 0 ? 'Inflated' : 'Deflated'} by ${Math.abs(gap)}pts`,
                body: `${label} picks: avg predicted ${avgPredicted}%, actual ${overallRate}% (${totalHits}/${totalN}). ${gap < 0 ? 'The model is overconfident on this stat type.' : 'The model is underconfident — hidden edge here.'}`,
                action: gap < 0
                    ? `Subtract ~${Math.abs(gap)} from displayed ${label} confidence, or use the recalibrated values below.`
                    : `${label} picks are stronger than labeled — these are high-value targets.`,
                severity: gap < 0 ? (gap <= -20 ? 'red' : 'amber') : 'green',
                badge: `${gap > 0 ? '+' : ''}${gap}%`,
            });
        }
    }
    // Overall calibration summary card
    if (calibScore != null && calibTotalSamples >= 10) {
        const avgPredicted = Math.round(calibBuckets.filter(b => b.total > 0).reduce((s, b) => s + b.midpoint * b.total, 0) / calibTotalSamples);
        if (overallHitRate < avgPredicted - 8) {
            diagCards.push({
                title: 'Systematic Overconfidence Detected',
                body: `Average predicted confidence is ${avgPredicted}% but actual hit rate is ${overallHitRate}%. The model is over-rating its edge by ${avgPredicted - overallHitRate} points overall.`,
                action: `Enable the recalibration engine (below) to auto-correct displayed confidence scores.`,
                severity: (avgPredicted - overallHitRate) >= 20 ? 'red' : 'amber',
                badge: `−${avgPredicted - overallHitRate}pts`,
            });
        }
        else if (overallHitRate > avgPredicted + 5) {
            diagCards.push({
                title: 'Model is Conservative',
                body: `Actual hit rate (${overallHitRate}%) exceeds average predicted confidence (${avgPredicted}%) by ${overallHitRate - avgPredicted} points. The model is underrating its edge.`,
                action: `Good sign — you can trust the confidence scores. Higher actual grades mean real edge.`,
                severity: 'green',
                badge: `+${overallHitRate - avgPredicted}pts`,
            });
        }
    }
    const sevColor = (s) => s === 'green' ? 'var(--green)' : s === 'amber' ? 'var(--amber)' : 'var(--red)';
    const diagHtml = diagCards.length > 0
        ? `<div class="calib-diag-grid">${diagCards.map(d => `
        <div class="calib-diag-card" style="--diag-color:${sevColor(d.severity)}">
          <div class="calib-diag-badge" style="background:${sevColor(d.severity)}22;color:${sevColor(d.severity)}">${d.badge}</div>
          <div class="calib-diag-title">${d.title}</div>
          <div class="calib-diag-body">${d.body}</div>
          <div class="calib-diag-action">→ ${d.action}</div>
        </div>`).join('')}
      </div>`
        : `<div style="font-size:11px;color:var(--text-muted);padding:12px 0">No significant calibration issues detected — confidence scores are reasonably accurate.</div>`;
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: Temporal Calibration Trend
    // ═══════════════════════════════════════════════════════════════════════════
    const eventCalibArr = Array.from(eventCalibMap.values())
        .filter(e => e.total >= 2 && e.date > 0)
        .sort((a, b) => a.date - b.date);
    let trendHtml = '';
    if (eventCalibArr.length >= 2) {
        const svgW = 400;
        const svgH = 80;
        const padL = 4;
        const padR = 4;
        const plotW = svgW - padL - padR;
        // Compute running calibration score per event (cumulative Brier)
        let cumBrierSum = 0;
        let cumBrierN = 0;
        const trendPoints = [];
        for (let i = 0; i < eventCalibArr.length; i++) {
            const e = eventCalibArr[i];
            const hitRate = Math.round((e.hits / e.total) * 100);
            cumBrierSum += e.brierSum;
            cumBrierN += e.total;
            const avgBrier = cumBrierSum / cumBrierN;
            const calScore = Math.round((1 - Math.sqrt(avgBrier)) * 100);
            const x = padL + (i / Math.max(1, eventCalibArr.length - 1)) * plotW;
            const y = svgH - 6 - (calScore / 100) * (svgH - 16);
            trendPoints.push({ x, y, label: e.event.replace(/UFC\s*(Fight Night|on ESPN):?\s*/i, '').trim(), rate: hitRate, n: e.total, brierScore: calScore });
        }
        // SVG path
        const pathD = trendPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const areaD = `${pathD} L${trendPoints[trendPoints.length - 1].x.toFixed(1)},${svgH} L${trendPoints[0].x.toFixed(1)},${svgH} Z`;
        // Trend direction
        const first3 = trendPoints.slice(0, Math.min(3, trendPoints.length));
        const last3 = trendPoints.slice(-Math.min(3, trendPoints.length));
        const avgFirst = first3.reduce((s, p) => s + p.brierScore, 0) / first3.length;
        const avgLast = last3.reduce((s, p) => s + p.brierScore, 0) / last3.length;
        const trendDelta = Math.round(avgLast - avgFirst);
        const trendIcon = trendDelta > 3 ? '📈' : trendDelta < -3 ? '📉' : '➡️';
        const trendLabel = trendDelta > 3 ? 'Improving' : trendDelta < -3 ? 'Degrading' : 'Stable';
        const trendColor = trendDelta > 3 ? 'var(--green)' : trendDelta < -3 ? 'var(--red)' : 'var(--text-muted)';
        // Dots
        const dotsHtml = trendPoints.map(p => {
            const col = p.brierScore >= 85 ? 'var(--green)' : p.brierScore >= 70 ? 'var(--amber)' : 'var(--red)';
            return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${col}" stroke="var(--surface)" stroke-width="1.5">
        <title>${p.label} — Score: ${p.brierScore} · Hit: ${p.rate}% · n=${p.n}</title>
      </circle>`;
        }).join('');
        // 50% line
        const halfY = svgH - 6 - (50 / 100) * (svgH - 16);
        trendHtml = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:14px">${trendIcon}</span>
        <span style="font-size:12px;font-weight:700;color:${trendColor}">${trendLabel}</span>
        <span style="font-size:10px;color:var(--text-muted)">${trendDelta > 0 ? '+' : ''}${trendDelta} pts over ${eventCalibArr.length} events</span>
      </div>
      <div class="calib-trend-chart">
        <svg class="calib-trend-svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="calibTrendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${trendColor}" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="${trendColor}" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <line x1="${padL}" y1="${halfY.toFixed(1)}" x2="${svgW - padR}" y2="${halfY.toFixed(1)}" stroke="rgba(125,145,190,0.2)" stroke-dasharray="4,3"/>
          <text x="${svgW - padR - 2}" y="${halfY - 3}" fill="rgba(125,145,190,0.35)" font-size="7" text-anchor="end">50</text>
          <path d="${areaD}" fill="url(#calibTrendGrad)"/>
          <path d="${pathD}" fill="none" stroke="${trendColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          ${dotsHtml}
        </svg>
      </div>
      <div class="calib-event-grid">
        ${eventCalibArr.slice(-8).map(e => {
            const rate = Math.round((e.hits / e.total) * 100);
            const col = rate >= 55 ? 'var(--green)' : rate >= 45 ? 'var(--amber)' : 'var(--red)';
            const shortName = e.event.replace(/UFC\s*(Fight Night|on ESPN):?\s*/i, '').replace(/\s+/g, ' ').trim();
            return `<div class="calib-event-chip">
            <div class="calib-event-name" title="${e.event}">${shortName}</div>
            <div class="calib-event-stat"><span style="color:${col};font-weight:700">${rate}%</span> hit · ${e.hits}/${e.total}</div>
          </div>`;
        }).join('')}
      </div>`;
    }
    else {
        trendHtml = `<div style="font-size:11px;color:var(--text-muted);padding:12px 0">Need picks resolved across at least 2 events to show a trend.</div>`;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: Confidence Recalibration Engine Table
    // ═══════════════════════════════════════════════════════════════════════════
    const recalRows = calibBuckets.filter(b => b.total >= 3).map(b => {
        const actual = Math.round((b.hits / b.total) * 100);
        const delta = actual - b.midpoint;
        const origGrade = getConfidenceGrade(b.midpoint);
        const newGrade = getConfidenceGrade(actual);
        const deltaColor = delta > 0 ? 'var(--green)' : delta < -5 ? 'var(--red)' : 'var(--amber)';
        const gradeChanged = origGrade !== newGrade;
        return `<tr>
      <td>${b.rangeLabel}</td>
      <td style="text-align:center">${b.midpoint}%</td>
      <td style="text-align:center"><span class="calib-recal-arrow">→</span><span class="calib-recal-adjusted" style="color:${deltaColor}">${actual}%</span></td>
      <td style="text-align:center"><span class="calib-recal-delta" style="color:${deltaColor}">${delta > 0 ? '+' : ''}${delta}</span></td>
      <td style="text-align:center">${origGrade}${gradeChanged ? ` <span class="calib-recal-arrow">→</span> <span style="color:${deltaColor};font-weight:700">${newGrade}</span>` : ''}</td>
      <td style="text-align:center;color:var(--text-muted)">${b.total}</td>
    </tr>`;
    });
    // Per-stat recalibration summary
    const perStatRecalHtml = CALIB_STAT_TYPES.map(pt => {
        const buckets = calibByType[pt];
        const eligible = buckets.filter(b => b.total >= 3);
        if (eligible.length < 2)
            return '';
        const label = pt === 'FightTime' ? 'FT' : pt === 'Fantasy' ? 'FP' : pt;
        const rows = eligible.map(b => {
            const actual = Math.round((b.hits / b.total) * 100);
            const delta = actual - b.midpoint;
            const col = delta > 0 ? 'var(--green)' : delta < -5 ? 'var(--red)' : 'var(--amber)';
            return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--surface2)">${b.rangeLabel}: <span style="color:${col};font-weight:600">${actual}%</span> <span style="color:${col};font-size:9px">(${delta > 0 ? '+' : ''}${delta})</span></span>`;
        }).join(' ');
        return `<div style="margin-top:8px"><span style="font-size:10px;font-weight:700;color:var(--text);margin-right:6px">${label}:</span>${rows}</div>`;
    }).filter(Boolean).join('');
    const recalHtml = recalRows.length >= 2
        ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">
        The recalibration engine adjusts displayed confidence based on historical accuracy.<br>
        When active, a pick labeled "80% confidence" that historically hits at 65% will display as "65% (recalibrated)".
      </div>
      <table class="calib-recal-table">
        <thead><tr>
          <th>Range</th><th style="text-align:center">Predicted</th><th style="text-align:center">Recalibrated</th>
          <th style="text-align:center">Delta</th><th style="text-align:center">Grade</th><th style="text-align:center">N</th>
        </tr></thead>
        <tbody>${recalRows.join('')}</tbody>
      </table>
      ${perStatRecalHtml}
      <div style="margin-top:12px;padding:10px 14px;border-radius:6px;background:rgba(0,232,122,0.06);border:1px solid rgba(0,232,122,0.2);font-size:10px;color:var(--text3)">
        <span style="color:var(--green);font-weight:700">Recalibration Active</span> — Fighter cards now show recalibrated confidence when data is available. The original confidence is preserved in tooltips.
      </div>`
        : `<div style="font-size:11px;color:var(--text-muted);padding:12px 0">Need at least 3 resolved picks in 2+ confidence buckets to build a recalibration table.</div>`;
    // ═══════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: Platform Line Bias Tracker
    // ═══════════════════════════════════════════════════════════════════════════
    // Recompute bias from the same archive data we already loaded (no extra fetch)
    const biasMap = new Map();
    for (const r of allRows.filter(r => !!r.platform && Number.isFinite(Number(r.line)) && Number.isFinite(Number(r.result)) && Date.parse(r.date) >= londonTs)) {
        const key = `${String(r.platform).toLowerCase()}|${r.propType}`;
        const b = biasMap.get(key) || { platform: String(r.platform).toLowerCase(), propType: String(r.propType), hits: 0, total: 0, edgeSum: 0 };
        const normResult = normalizeArchiveResult(String(r.propType), Number(r.result));
        b.total++;
        b.edgeSum += normResult - Number(r.line);
        if (normResult > Number(r.line))
            b.hits++;
        biasMap.set(key, b);
    }
    const biasEntries = Array.from(biasMap.values())
        .filter(b => b.total >= 2)
        .map(b => ({ ...b, avgEdge: Number((b.edgeSum / b.total).toFixed(1)), hitRate: Math.round((b.hits / b.total) * 100) }));
    // Also update the module-level cache
    _platformBiasCache = biasEntries;
    // Group by platform for report cards
    const PLAT_ORDER = ['pick6', 'underdog', 'prizepicks', 'betr', 'draftkings_sportsbook'];
    const STAT_ORDER = ['Fantasy', 'SS', 'TD', 'FightTime'];
    const STAT_SHORT = { Fantasy: 'FP', SS: 'SS', TD: 'TD', FightTime: 'FT' };
    const PLAT_COLORS = { pick6: '#00e8c6', underdog: '#48c78e', prizepicks: '#c084fc', betr: '#ff8c42', draftkings_sportsbook: '#64b5f6' };
    // Per-platform overall stats
    const platOverall = new Map();
    for (const b of biasEntries) {
        const o = platOverall.get(b.platform) || { hits: 0, total: 0, edgeSum: 0 };
        o.hits += b.hits;
        o.total += b.total;
        o.edgeSum += b.edgeSum;
        platOverall.set(b.platform, o);
    }
    const bestPicks = [];
    for (const stat of STAT_ORDER) {
        const statEntries = biasEntries.filter(b => b.propType === stat && b.total >= 3);
        if (statEntries.length < 2)
            continue;
        // Best for OVER = highest positive avg edge (result beats line most)
        const sortedOver = [...statEntries].sort((a, b) => b.avgEdge - a.avgEdge);
        if (sortedOver[0].avgEdge > 0) {
            bestPicks.push({ stat, direction: 'OVER', platform: sortedOver[0].platform, avgEdge: sortedOver[0].avgEdge, total: sortedOver[0].total });
        }
        // Best for UNDER = most negative avg edge (result below line most)
        const sortedUnder = [...statEntries].sort((a, b) => a.avgEdge - b.avgEdge);
        if (sortedUnder[0].avgEdge < 0) {
            bestPicks.push({ stat, direction: 'UNDER', platform: sortedUnder[0].platform, avgEdge: sortedUnder[0].avgEdge, total: sortedUnder[0].total });
        }
    }
    // Build platform report cards
    const platCardHtml = PLAT_ORDER.filter(p => platOverall.has(p)).map(plat => {
        const o = platOverall.get(plat);
        const label = PLAT_LABEL_MAP[plat] || plat.toUpperCase();
        const color = PLAT_COLORS[plat] || 'var(--text)';
        const overallEdge = Number((o.edgeSum / o.total).toFixed(1));
        const overallRate = Math.round((o.hits / o.total) * 100);
        const edgeColor = overallEdge > 0.5 ? 'var(--green)' : overallEdge < -0.5 ? 'var(--red)' : 'var(--text-muted)';
        const softness = overallEdge > 1.5 ? 'Soft' : overallEdge > 0.3 ? 'Slightly Soft' : overallEdge < -1.5 ? 'Tight' : overallEdge < -0.3 ? 'Slightly Tight' : 'Neutral';
        // Per-stat bars
        const maxAbsEdge = Math.max(1, ...biasEntries.filter(b => b.platform === plat).map(b => Math.abs(b.avgEdge)));
        const statBars = STAT_ORDER.map(st => {
            const entry = biasEntries.find(b => b.platform === plat && b.propType === st);
            if (!entry || entry.total < 2)
                return `<div class="bias-stat-row"><span class="bias-stat-label">${STAT_SHORT[st]}</span><div class="bias-bar-track"><div class="bias-bar-empty">—</div></div></div>`;
            const pct = Math.round(Math.abs(entry.avgEdge) / maxAbsEdge * 70);
            const isPos = entry.avgEdge >= 0;
            const barColor = isPos ? 'var(--green)' : 'var(--red)';
            const hint = isPos
                ? `Lines avg ${entry.avgEdge} pts below actual — soft for OVER`
                : `Lines avg ${Math.abs(entry.avgEdge)} pts above actual — soft for UNDER`;
            return `<div class="bias-stat-row" title="${hint}">
        <span class="bias-stat-label">${STAT_SHORT[st]}</span>
        <div class="bias-bar-track">
          <div class="bias-bar-fill ${isPos ? 'positive' : 'negative'}" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <span class="bias-stat-edge" style="color:${barColor}">${isPos ? '+' : ''}${entry.avgEdge}</span>
        <span class="bias-stat-n">${entry.total}</span>
      </div>`;
        }).join('');
        return `<div class="bias-plat-card" style="--plat-color:${color}">
      <div class="bias-plat-header">
        <span class="bias-plat-name" style="color:${color}">${label}</span>
        <span class="bias-plat-softness" style="color:${edgeColor}">${softness}</span>
      </div>
      <div class="bias-plat-overview">
        <span class="bias-plat-stat">Avg Edge: <b style="color:${edgeColor}">${overallEdge > 0 ? '+' : ''}${overallEdge}</b></span>
        <span class="bias-plat-stat">Over Rate: <b style="color:${overallRate >= 55 ? 'var(--green)' : overallRate >= 45 ? 'var(--amber)' : 'var(--red)'}">${overallRate}%</b></span>
        <span class="bias-plat-stat" style="color:var(--text-muted)">${o.total} props</span>
      </div>
      ${statBars}
    </div>`;
    }).join('');
    // Edge Finder — best platform recommendations
    const edgeFinderHtml = bestPicks.length > 0
        ? `<div class="bias-edge-finder">
        <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Edge Finder — Best Platform by Stat + Direction</div>
        <div class="bias-edge-grid">${bestPicks.map(bp => {
            const label = PLAT_LABEL_MAP[bp.platform] || bp.platform.toUpperCase();
            const color = PLAT_COLORS[bp.platform] || 'var(--text)';
            const dirColor = bp.direction === 'OVER' ? 'var(--green)' : 'var(--red)';
            const arrow = bp.direction === 'OVER' ? '▲' : '▼';
            return `<div class="bias-edge-chip">
            <span class="bias-edge-dir" style="color:${dirColor}">${arrow} ${bp.direction}</span>
            <span class="bias-edge-stat">${STAT_SHORT[bp.stat]}</span>
            <span class="bias-edge-arrow">→</span>
            <span class="bias-edge-plat" style="color:${color};font-weight:700">${label}</span>
            <span class="bias-edge-val" style="color:${bp.avgEdge > 0 ? 'var(--green)' : 'var(--red)'}">${bp.avgEdge > 0 ? '+' : ''}${bp.avgEdge} avg edge</span>
            <span class="bias-edge-n">${bp.total}</span>
          </div>`;
        }).join('')}</div>
      </div>`
        : '';
    // Heatmap — all platforms × all stats
    const heatmapHtml = (() => {
        const activePlats = PLAT_ORDER.filter(p => biasEntries.some(b => b.platform === p));
        const activeStats = STAT_ORDER.filter(s => biasEntries.some(b => b.propType === s));
        if (activePlats.length < 2 || activeStats.length < 2)
            return '';
        const headerCells = activePlats.map(p => `<th style="color:${PLAT_COLORS[p] || 'var(--text)'}">${PLAT_LABEL_MAP[p] || p.toUpperCase()}</th>`).join('');
        const rows = activeStats.map(st => {
            const cells = activePlats.map(p => {
                const entry = biasEntries.find(b => b.platform === p && b.propType === st);
                if (!entry || entry.total < 2)
                    return `<td class="bias-heat-cell empty">—</td>`;
                const e = entry.avgEdge;
                const intensity = Math.min(1, Math.abs(e) / 4);
                const bg = e >= 0
                    ? `rgba(0,232,122,${(intensity * 0.35).toFixed(2)})`
                    : `rgba(255,58,96,${(intensity * 0.35).toFixed(2)})`;
                const textColor = Math.abs(e) > 1.5 ? (e > 0 ? 'var(--green)' : 'var(--red)') : 'var(--text)';
                const hint = e >= 0
                    ? `${PLAT_LABEL_MAP[p]} ${STAT_SHORT[st]} lines avg ${e} below actual (soft for OVER)`
                    : `${PLAT_LABEL_MAP[p]} ${STAT_SHORT[st]} lines avg ${Math.abs(e)} above actual (soft for UNDER)`;
                return `<td class="bias-heat-cell" style="background:${bg};color:${textColor}" title="${hint} · n=${entry.total}">${e > 0 ? '+' : ''}${e}<span class="bias-heat-n">${entry.total}</span></td>`;
            }).join('');
            return `<tr><td class="bias-heat-label">${STAT_SHORT[st]}</td>${cells}</tr>`;
        }).join('');
        return `<div style="margin-top:12px">
      <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Avg Edge Heatmap (green = soft for over · red = soft for under)</div>
      <table class="bias-heatmap"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
    })();
    const biasTrackerBody = biasEntries.length >= 2
        ? `${edgeFinderHtml}
       <div class="bias-plat-grid">${platCardHtml}</div>
       ${heatmapHtml}`
        : `<div style="font-size:11px;color:var(--text-muted);padding:12px 0">Need settled archive records with platform data across at least 2 platforms to show bias analysis.</div>`;
    const biasTrackerCount = `<span style="font-size:10px;color:var(--text-muted)">${platOverall.size} platform${platOverall.size === 1 ? '' : 's'} · ${biasEntries.reduce((s, b) => s + b.total, 0)} settled props</span>`;
    // ASSEMBLE FULL PANEL
    // ═══════════════════════════════════════════════════════════════════════════
    container.innerHTML = `
    ${heroHtml}
    ${cSec('cal-curve', 'Calibration Curve', `<span style="font-size:10px;color:var(--text-muted)">${calibTotalSamples} picks · ${activeBuckets.length} buckets</span>`, curveBody, 'margin-bottom:12px')}
    ${cSec('cal-diagnosis', 'Overconfidence Diagnosis', `<span style="font-size:10px;color:var(--text-muted)">${diagCards.length} finding${diagCards.length === 1 ? '' : 's'}</span>`, diagHtml, 'margin-bottom:12px')}
    ${cSec('cal-trend', 'Calibration Trend', `<span style="font-size:10px;color:var(--text-muted)">${eventCalibArr.length} events</span>`, trendHtml, 'margin-bottom:12px')}
    ${cSec('cal-recal', 'Recalibration Engine', `<span style="font-size:10px;color:var(--text-muted)">${recalRows.length} bucket${recalRows.length === 1 ? '' : 's'} mapped</span>`, recalHtml, 'margin-bottom:12px')}
    ${cSec('cal-bias', 'Platform Line Bias Tracker', biasTrackerCount, biasTrackerBody, 'margin-bottom:12px')}
  `;
    // Bind collapsible section toggles
    container.querySelectorAll('.best-picks-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.best-picks-section');
            const id = section?.dataset['sectionId'];
            if (!section || !id)
                return;
            const body = section.querySelector('.section-body');
            if (!body)
                return;
            if (_archiveCollapsedSections.has(id)) {
                _archiveCollapsedSections.delete(id);
                section.classList.remove('collapsed');
                body.style.maxHeight = body.scrollHeight + 'px';
                body.addEventListener('transitionend', function handler() { body.style.maxHeight = ''; body.removeEventListener('transitionend', handler); }, { once: true });
            }
            else {
                _archiveCollapsedSections.add(id);
                body.style.maxHeight = body.scrollHeight + 'px';
                void body.offsetHeight;
                section.classList.add('collapsed');
                body.style.maxHeight = '0';
            }
        });
    });
}
// Coalesce multiple renderFighters() calls in the same frame into a single
// render. Many code paths (mergeAndEnrich, line-move handlers, sort/filter,
// news arrivals) fire renderFighters() back-to-back; without coalescing each
// one rebuilds 26 rows from scratch.
let _renderScheduled = false;
function renderFighters() {
    if (_renderScheduled)
        return;
    _renderScheduled = true;
    requestAnimationFrame(() => {
        _renderScheduled = false;
        _renderFightersImpl();
    });
}
function updateViewTabCounts() {
    let over = 0, under = 0, bestOver = 0, bestUnder = 0;
    for (const f of allFighters) {
        const el = getEffectiveLean(f);
        if (el.lean === 'over') {
            over++;
            if (!shouldSkipFpSideForFighter(f, el._source, 'over', el._platform))
                bestOver++;
        }
        else if (el.lean === 'under') {
            under++;
            if (!shouldSkipFpSideForFighter(f, el._source, 'under', el._platform))
                bestUnder++;
        }
    }
    const setText = (id, n) => {
        const el = document.getElementById(id);
        if (el)
            el.textContent = String(n);
    };
    // Best Picks panel caps each section at 8; this approximates the visible pick count.
    setText('tabCountAll', allFighters.length);
    setText('tabCountOver', over);
    setText('tabCountUnder', under);
    setText('tabCountBestPicks', Math.min(8, bestOver) + Math.min(8, bestUnder));
}
function isPlaceholderFighter(f) {
    return !!f && f.db?.loaded === false;
}
function fighterHasCtrlProp(f) {
    if (!f)
        return false;
    return f.line_p6_ctrl != null || f.line_ud_ctrl != null
        || f.line_pp_ctrl != null || f.line_betr_ctrl != null
        || f.line_dk_ctrl != null;
}
function pickFightTimeLine(f) {
    if (!f)
        return null;
    const candidates = [
        { value: f.line_p6_ft, plat: 'p6' },
        { value: f.line_ud_ft, plat: 'ud' },
        { value: f.line_pp_ft, plat: 'pp' },
        { value: f.line_betr_ft, plat: 'betr' },
        { value: f.line_dk_ft, plat: 'dk' },
    ];
    for (const c of candidates) {
        if (c.value != null && Number.isFinite(c.value))
            return { value: c.value, plat: c.plat };
    }
    return null;
}
function computeFightCorrelation(a, b) {
    if (isPlaceholderFighter(a) || isPlaceholderFighter(b))
        return null;
    const aSs = a.lean_ss?.lean, bSs = b.lean_ss?.lean;
    if (aSs && aSs === bSs && (aSs === 'over' || aSs === 'under')) {
        return {
            type: 'neg-correlated-same-direction',
            stat: 'SS',
            direction: aSs,
            note: `Both ${aSs.toUpperCase()} SS — same-fight same-direction. Lean ONE side.`,
        };
    }
    const aFp = a.lean?.lean, bFp = b.lean?.lean;
    if (aFp && aFp === bFp && (aFp === 'over' || aFp === 'under')) {
        return {
            type: 'neg-correlated-same-direction',
            stat: 'FP',
            direction: aFp,
            note: aFp === 'over'
                ? `Both OVER FP — only one fighter gets the win bonus. Lean ONE side.`
                : `Both UNDER FP — needs a fast finish. Lean ONE side.`,
        };
    }
    const aFt = a.lean_ft?.lean, bFt = b.lean_ft?.lean;
    if (aFt && aFt === bFt && (aFt === 'over' || aFt === 'under')) {
        return {
            type: 'neg-correlated-same-direction',
            stat: 'FT',
            direction: aFt,
            note: `Both ${aFt.toUpperCase()} FT — same fight, same direction. Lean ONE side.`,
        };
    }
    return null;
}
function cardPositionForFightIndex(fightIndex, totalFights) {
    if (fightIndex === 0)
        return 'main';
    if (fightIndex === 1)
        return 'co-main';
    if (fightIndex < Math.ceil(totalFights * 0.55))
        return 'main-card';
    return 'prelim';
}
function buildFights(activeFighters) {
    const out = [];
    const totalFights = Math.ceil(activeFighters.length / 2);
    // Identify the main event by the (now title-authoritative) headliner pair rather
    // than array position — UFCStats upcoming-card order is NOT reliably main-first,
    // so `fightIndex === 0` would award the 5R badge to whatever prelim happens to be
    // first. Compute once; compare each pair's fighters by name (tolerant) below.
    const headlinerPair = findHeadlinerPair();
    const fightIsMainEvent = (a, b) => {
        if (!headlinerPair || !b)
            return false;
        const na = normalizeName(a?.name);
        const nb = normalizeName(b?.name);
        if (!na || !nb)
            return false;
        const inPair = (n) => n === headlinerPair.f1 || n === headlinerPair.f2 ||
            strictCardNameMatch(n, headlinerPair.f1) || strictCardNameMatch(n, headlinerPair.f2);
        return inPair(na) && inPair(nb);
    };
    // Slate-wide top-edge scan — confidence on whichever leaned stat scores highest.
    let topEdgeName = '';
    let topEdgeConf = 0;
    for (const f of activeFighters) {
        if (isPlaceholderFighter(f))
            continue;
        const el = getEffectiveLean(f);
        if (el.lean !== 'over' && el.lean !== 'under')
            continue;
        const c = el.conf || 0;
        if (c > topEdgeConf) {
            topEdgeConf = c;
            topEdgeName = f.name;
        }
    }
    for (let i = 0; i < activeFighters.length; i += 2) {
        const a = activeFighters[i];
        const b = activeFighters[i + 1] || null;
        const fightIndex = Math.floor(i / 2);
        const cardPair = upcomingCardPairs[fightIndex];
        // Trust upcomingCardPairs ordering — orderFightersByCard() aligns activeFighters
        // to the same sequence. weightClass falls back to undefined when missing.
        const weightClass = cardPair?.weightClass;
        const ft = pickFightTimeLine(a) || pickFightTimeLine(b);
        const correlation = b ? computeFightCorrelation(a, b) : null;
        const rounds = fightIsMainEvent(a, b) ? 5 : 3;
        const topEdge = !!topEdgeName && (a.name === topEdgeName || b?.name === topEdgeName);
        out.push({
            fighterA: a,
            fighterB: b,
            fightIndex,
            weightClass,
            rounds,
            cardPosition: cardPositionForFightIndex(fightIndex, totalFights),
            ftLine: ft?.value ?? null,
            ftPlatKey: ft?.plat ?? null,
            bothHaveCtrl: fighterHasCtrlProp(a) && fighterHasCtrlProp(b),
            correlation,
            isTopEdgeFight: topEdge,
            topEdgeConf: topEdge ? topEdgeConf : 0,
        });
    }
    return out;
}
function spineHasContent(fight) {
    return !!fight.ftLine || fight.bothHaveCtrl || !!fight.correlation || fight.isTopEdgeFight;
}
function weightClassChip(weight) {
    if (!weight)
        return '';
    const label = String(weight).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<span class="fight-spine-weight" title="Weight class">${label}</span>`;
}
// ── FILLED-SPINE HELPERS ──────────────────────────────────────────────────
// Per-fighter colors used across the filled-spine sections (matchup values,
// L5 trend strokes, common-opp stat lines, legend chips). Cyan = side A,
// yellow = side B. Yellow intentionally matches the existing top-edge callout.
const SPINE_COLOR_A = '#5ee5e0';
const SPINE_COLOR_B = '#ffd24a';
function spineFightTime(f) {
    if (!f.date)
        return 0;
    const t = new Date(f.date).getTime();
    return Number.isFinite(t) ? t : 0;
}
function spineHistorySorted(db) {
    if (!db?.history?.length)
        return [];
    return [...db.history].sort((x, y) => spineFightTime(y) - spineFightTime(x));
}
function spineOppAbsorbsSS(db) {
    if (!db?.history?.length)
        return null;
    const samples = db.history
        .map(h => h.oppStats?.sigStr)
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (samples.length < 2)
        return null;
    return parseFloat((samples.reduce((s, v) => s + v, 0) / samples.length).toFixed(1));
}
function spineEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function spineMethodShort(method) {
    const m = String(method || '').toUpperCase();
    if (/SUB/.test(m))
        return 'SUB';
    if (/KO|TKO/.test(m))
        return 'KO';
    return 'DEC';
}
function spineResultLetter(result) {
    const r = String(result || '').toLowerCase();
    if (r === 'win')
        return 'W';
    if (r === 'loss' || r === 'lose')
        return 'L';
    if (r === 'draw')
        return 'D';
    return '–';
}
function spineFighterStatLine(f, color) {
    const ss = f.sigStr != null ? String(Math.round(f.sigStr)) : '—';
    const fp = f.fp != null ? String(Math.round(f.fp)) : '—';
    const res = spineResultLetter(f.result);
    const meth = spineMethodShort(f.method);
    return `<span class="spine-cmn-stat" style="color:${color}">${ss}·${fp}·${res}/${meth}</span>`;
}
function spineMatchupHTML(a, b) {
    const da = a.db, db2 = b.db;
    const ssA = da?.avgSigStr, ssB = db2?.avgSigStr;
    const absA = spineOppAbsorbsSS(da), absB = spineOppAbsorbsSS(db2);
    const fnA = da?.finishRate, fnB = db2?.finishRate;
    const fmt = (v) => v == null || !Number.isFinite(v) ? '<span class="spine-missing">—</span>' : v.toFixed(1);
    const fmtPct = (v) => v == null || !Number.isFinite(v) ? '<span class="spine-missing">—</span>' : `${Math.round(v * 100)}%`;
    // GLOW-UP 20: each row gets a teal/gold share-of-total bar + winner glow
    const row = (rawA, rawB, dispA, dispB, label) => {
        const okA = rawA != null && Number.isFinite(rawA);
        const okB = rawB != null && Number.isFinite(rawB);
        const winA = okA && okB && rawA > rawB;
        const winB = okA && okB && rawB > rawA;
        let bar = '';
        if (okA && okB && (rawA + rawB) > 0) {
            const shareA = Math.round((rawA / (rawA + rawB)) * 100);
            bar = `<div class="spine-adv-bar"><i class="adv-a" style="width:${shareA}%"></i><i class="adv-b" style="width:${100 - shareA}%"></i></div>`;
        }
        return `<div class="spine-matchup-row">
        <span class="spine-val-a${winA ? ' adv-win' : ''}">${dispA}</span>
        <span class="spine-row-label">${label}</span>
        <span class="spine-val-b${winB ? ' adv-win' : ''}">${dispB}</span>
      </div>${bar}`;
    };
    return `
    <div class="spine-section">
      <div class="spine-section-head">MATCHUP</div>
      ${row(ssA, ssB, fmt(ssA), fmt(ssB), 'SS/fight')}
      ${row(absA, absB, fmt(absA), fmt(absB), 'opp abs')}
      ${row(fnA, fnB, fmtPct(fnA), fmtPct(fnB), 'P(fin)')}
    </div>
  `;
}
function spineCommonOppsHTML(a, b) {
    const histA = spineHistorySorted(a.db).slice(0, 8);
    const histB = spineHistorySorted(b.db).slice(0, 8);
    // Build normalized opp → fight map for side A so we can intersect in O(N).
    const mapA = new Map();
    for (const fight of histA) {
        const norm = normalizeName(fight.opp);
        if (norm && !mapA.has(norm.toLowerCase()))
            mapA.set(norm.toLowerCase(), fight);
    }
    const shared = [];
    for (const fight of histB) {
        const norm = normalizeName(fight.opp);
        if (!norm)
            continue;
        const key = norm.toLowerCase();
        const fA = mapA.get(key);
        if (!fA)
            continue;
        shared.push({
            nameDisp: norm,
            fA,
            fB: fight,
            recency: Math.max(spineFightTime(fA), spineFightTime(fight)),
        });
    }
    shared.sort((x, y) => y.recency - x.recency);
    const top3 = shared.slice(0, 3);
    let body;
    if (top3.length === 0) {
        body = `<div class="spine-cmn-empty">none in past 8 fights</div>`;
    }
    else {
        body = top3.map(s => `
      <div class="spine-cmn-row">
        <div class="spine-cmn-name">${spineEscape(s.nameDisp)}</div>
        <div class="spine-cmn-stats">
          ${spineFighterStatLine(s.fA, SPINE_COLOR_A)}
          <span class="spine-cmn-sep">·</span>
          ${spineFighterStatLine(s.fB, SPINE_COLOR_B)}
        </div>
      </div>
    `).join('');
    }
    return `
    <div class="spine-section">
      <div class="spine-section-head">COMMON OPPS</div>
      ${body}
    </div>
  `;
}
function spineL5TrendsHTML(a, b) {
    const histAAll = spineHistorySorted(a.db);
    const histBAll = spineHistorySorted(b.db);
    // Need ≥2 fights on both sides to plot a polyline; otherwise suppress whole section.
    if (histAAll.length < 2 || histBAll.length < 2)
        return '';
    const n = Math.min(5, histAAll.length, histBAll.length);
    // Slice newest-N then reverse to chronological asc so the polyline reads
    // oldest → newest left-to-right (with the end-dot landing on the latest fight).
    const histA = histAAll.slice(0, n).reverse();
    const histB = histBAll.slice(0, n).reverse();
    const stats = [
        { label: 'SS', key: 'sigStr' },
        { label: 'FP', key: 'fp' },
        { label: 'TD', key: 'td' },
    ];
    const pickStat = (h, k) => {
        const v = k === 'sigStr' ? h.sigStr : k === 'fp' ? h.fp : h.td;
        return v == null ? NaN : v;
    };
    const rows = stats.map(({ label, key }) => {
        const valsA = histA.map(h => pickStat(h, key)).filter(v => Number.isFinite(v));
        const valsB = histB.map(h => pickStat(h, key)).filter(v => Number.isFinite(v));
        const sparkA = valsA.length >= 2
            ? renderSparkline(valsA.map((v, i) => ({ t: i, v })), 'auto', { color: SPINE_COLOR_A, w: 70, h: 14, area: true, glow: true })
            : '<span class="spine-missing">—</span>';
        const sparkB = valsB.length >= 2
            ? renderSparkline(valsB.map((v, i) => ({ t: i, v })), 'auto', { color: SPINE_COLOR_B, w: 70, h: 14, area: true, glow: true })
            : '<span class="spine-missing">—</span>';
        const fmtLast = (vals) => {
            if (!vals.length)
                return '';
            const v = vals[vals.length - 1];
            return Number.isInteger(v) ? String(v) : v.toFixed(1);
        };
        return `
      <div class="spine-trend-row">
        <span class="spine-trend-cell">${sparkA}<span class="spine-trend-val tv-a">${fmtLast(valsA)}</span></span>
        <span class="spine-trend-label">${label}</span>
        <span class="spine-trend-cell"><span class="spine-trend-val tv-b">${fmtLast(valsB)}</span>${sparkB}</span>
      </div>
    `;
    }).join('');
    const lastNameA = a.name.split(' ').pop() || a.name;
    const lastNameB = b.name.split(' ').pop() || b.name;
    return `
    <div class="spine-section">
      <div class="spine-section-head">L${n} TRENDS</div>
      ${rows}
      <div class="spine-trend-legend">
        <span class="spine-legend-a">${spineEscape(lastNameA)}</span>
        <span class="spine-legend-b">${spineEscape(lastNameB)}</span>
      </div>
    </div>
  `;
}
// Built once per fight-pair render. Returns '' for placeholder fighters so
// the spine stays narrow and only the shared-header chips show. CSS hides
// the wrapper in default state — `.fight-pair:has(.fighter-row.expanded)`
// reveals it.
function buildFilledSpineWrapper(a, b) {
    if (!b || isPlaceholderFighter(a) || isPlaceholderFighter(b))
        return '';
    return `
    <div class="fight-spine-filled">
      ${spineMatchupHTML(a, b)}
      ${spineCommonOppsHTML(a, b)}
      ${spineL5TrendsHTML(a, b)}
      <div class="fight-spine-spacer"></div>
    </div>
  `;
}
// Open head-to-head for a fighter by name, with hardened opponent lookup and
// toast feedback instead of silent failure.
function openH2HByName(fighterName) {
    if (!fighterName)
        return;
    const fEntry = _h2hFighterMap.get(fighterName.toLowerCase());
    if (!fEntry) {
        showToast(`No data loaded for ${prettyName(fighterName)} yet`);
        return;
    }
    const oppRaw = (fEntry.opponent || '').toLowerCase().trim();
    let oppEntry = oppRaw ? _h2hFighterMap.get(oppRaw) : undefined;
    if (!oppEntry && oppRaw) {
        for (const [key, val] of _h2hFighterMap) {
            if (key.includes(oppRaw) || oppRaw.includes(key)) {
                oppEntry = val;
                break;
            }
        }
    }
    if (!oppEntry && oppRaw) {
        const oppNorm = (normalizeName(oppRaw) || oppRaw).toLowerCase();
        for (const [, val] of _h2hFighterMap) {
            if ((normalizeName(val.name) || val.name).toLowerCase() === oppNorm) {
                oppEntry = val;
                break;
            }
        }
    }
    if (oppEntry)
        renderH2HModal(fEntry, oppEntry);
    else
        showToast(`No opponent data for ${prettyName(fighterName)} yet — try a refetch`);
}
function buildFightSpine(fight) {
    const spine = document.createElement('div');
    spine.className = 'fight-spine';
    // Seamless H2H entry: the whole center spine is a big, reliable trigger
    // (the tiny ⚔ button was a 20px target that took multiple tries).
    if (fight.fighterB && !isPlaceholderFighter(fight.fighterA) && !isPlaceholderFighter(fight.fighterB)) {
        const fb = fight.fighterB;
        spine.classList.add('h2h-clickable');
        spine.title = `Head-to-head: ${fight.fighterA.name} vs ${fb.name}`;
        spine.addEventListener('click', () => renderH2HModal(fight.fighterA, fb));
    }
    const roundsChip = `<span class="fight-spine-rounds" title="Scheduled rounds">${fight.rounds}R</span>`;
    const weightChip = weightClassChip(fight.weightClass);
    let ftBlock = '';
    if (fight.ftLine != null) {
        const platLabels = { p6: 'P6', ud: 'UD', pp: 'PP', betr: 'BT', dk: 'DK' };
        const platLabel = fight.ftPlatKey ? platLabels[fight.ftPlatKey] : '';
        const aName = fight.fighterA.name;
        const sparkPoints = fight.ftPlatKey ? getSparklinePointsForPlat(aName, 'ft', fight.ftPlatKey) : [];
        const sparkHtml = sparkPoints.length >= 2 ? renderSparkline(sparkPoints, 'auto') : '';
        ftBlock = `<div class="fight-spine-ft" title="Fight time line">
      <span class="fight-spine-ft-label">FT</span>
      <span class="fight-spine-ft-value">${fight.ftLine}</span>
      ${platLabel ? `<span class="fight-spine-ft-plat">${platLabel}</span>` : ''}
      ${sparkHtml}
    </div>`;
    }
    let ctrlBlock = '';
    if (fight.bothHaveCtrl) {
        ctrlBlock = `<div class="fight-spine-ctrl" title="Both fighters have a CTRL prop">CTRL ×2</div>`;
    }
    let corrBlock = '';
    if (fight.correlation) {
        const c = fight.correlation;
        corrBlock = `<div class="fight-spine-corr" title="${c.note}">⚠ ${c.direction.toUpperCase()} ${c.stat} ×2</div>`;
    }
    let topEdgeBlock = '';
    if (fight.isTopEdgeFight && fight.topEdgeConf > 0) {
        topEdgeBlock = `<div class="fight-spine-top-edge" title="Slate's top-edge lean lives in this fight">TOP EDGE • ${Math.round(fight.topEdgeConf)}%</div>`;
    }
    const filledBlock = buildFilledSpineWrapper(fight.fighterA, fight.fighterB);
    spine.innerHTML = `
    <div class="fight-spine-chips">${roundsChip}${weightChip}</div>
    ${ftBlock}
    ${ctrlBlock}
    ${corrBlock}
    ${topEdgeBlock}
    ${filledBlock}
  `;
    return spine;
}
function _renderFightersImpl() {
    const container = document.getElementById('cardContainer');
    if (!container)
        return;
    updateViewTabCounts();
    container.innerHTML = '';
    if (currentView === 'bestpicks') {
        bestPicksRenderSeq++;
        void renderBestPicks(container, bestPicksRenderSeq);
        return;
    }
    if (currentView === 'parlaylab') {
        renderParlayLab(container);
        return;
    }
    if (currentView === 'calibration') {
        void renderCalibrationPanel(container);
        return;
    }
    if (currentView === 'archive') {
        void renderArchivePanel(container);
        return;
    }
    // Load archive stats once per session for per-fighter accuracy badges
    if (_fighterArchiveStats === null) {
        void loadFighterArchiveStats();
    }
    // Load open→current drift map (unresolved rows) for the AI×CLV confidence boost
    if (_fighterClvDrift === null) {
        void loadFighterClvDrift();
    }
    primeCaches();
    const _q = currentSearch.toLowerCase().trim();
    // Parse advanced filter tags: conf:70+, lean:over, fp:under, ss:over, td:under, split:yes, ev:+
    const _tagRe = /\b(conf|lean|fp|ss|td|ft|split|ev):([^\s]+)/gi;
    const _tags = {};
    const _nameQ = _q.replace(_tagRe, (_, k, v) => { _tags[k.toLowerCase()] = v.toLowerCase(); return ''; }).trim();
    let fighters = allFighters.filter(f => {
        if (_nameQ && !f.name.toLowerCase().includes(_nameQ))
            return false;
        if (currentView === 'over' && getEffectiveLean(f).lean !== 'over')
            return false;
        if (currentView === 'under' && getEffectiveLean(f).lean !== 'under')
            return false;
        // Advanced tag filters
        if (_tags['lean']) {
            if (getEffectiveLean(f).lean !== _tags['lean'])
                return false;
        }
        if (_tags['fp']) {
            if (f.lean?.lean !== _tags['fp'])
                return false;
        }
        if (_tags['ss']) {
            if (f.lean_ss?.lean !== _tags['ss'])
                return false;
        }
        if (_tags['td']) {
            if (f.lean_td?.lean !== _tags['td'])
                return false;
        }
        if (_tags['ft']) {
            if (f.lean_ft?.lean !== _tags['ft'])
                return false;
        }
        if (_tags['split']) {
            if (_tags['split'] === 'yes' && !hasCrossStatConflict(f))
                return false;
        }
        if (_tags['ev']) {
            const ev = computeFighterEV(f, getEffectiveLean(f));
            if (_tags['ev'] === '+' && (ev == null || ev <= 0))
                return false;
            if (_tags['ev'] === '-' && (ev == null || ev >= 0))
                return false;
        }
        if (_tags['conf']) {
            const op = _tags['conf'].endsWith('+') ? '>=' : _tags['conf'].endsWith('-') ? '<=' : '>=';
            const n = parseInt(_tags['conf']);
            if (!isNaN(n)) {
                const c = getEffectiveLean(f).conf || 0;
                if (op === '>=' && c < n)
                    return false;
                if (op === '<=' && c > n)
                    return false;
            }
        }
        return true;
    });
    fighters = applySourceVisibilityFilter(fighters);
    fighters = sortFighters(fighters, currentSort);
    // Default sort = card-order display with fight badges. Reorder so each fight's
    // two fighters land at adjacent indices (i, i+1) in UFCStats card sequence;
    // the badge logic downstream is positional (Math.floor(i / 2) = fightIndex).
    if (currentSort === 'default') {
        fighters = orderFightersByCard(fighters);
    }
    if (fighters.length === 0) {
        container.innerHTML = '<div class="inline-empty-msg">No fighters match this filter</div>';
        renderModelHealthWidget();
        return;
    }
    function sanitizeOpponentName(raw, selfName) {
        if (typeof raw !== 'string')
            return null;
        let val = raw.replace(/^\s*vs\.?\s*/i, '').replace(/\s+/g, ' ').trim();
        val = val.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*$/i, '').trim();
        val = val.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '').trim();
        val = val.replace(/\b(?:edt|est|cdt|cst|mdt|mst|pdt|pst|utc)\b.*$/i, '').trim();
        val = val.replace(/[^A-Za-z'\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!val || val.split(' ').length < 2)
            return null;
        if (selfName && val.toLowerCase() === selfName.toLowerCase())
            return null;
        return val;
    }
    function sanitizeLooseOpponentToken(raw, selfName) {
        if (typeof raw !== 'string')
            return null;
        let val = raw.replace(/^\s*vs\.?\s*/i, '').replace(/\s+/g, ' ').trim();
        val = val.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*$/i, '').trim();
        val = val.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b.*$/i, '').trim();
        val = val.replace(/\b(?:edt|est|cdt|cst|mdt|mst|pdt|pst|utc)\b.*$/i, '').trim();
        val = val.replace(/[^A-Za-z'\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!val)
            return null;
        if (selfName && val.toLowerCase() === selfName.toLowerCase())
            return null;
        return val;
    }
    function findOpponentBySingleToken(token, selfName) {
        const t = token.toLowerCase();
        const matches = allFighters.filter((x) => {
            if (x.name === selfName)
                return false;
            const parts = x.name.toLowerCase().split(' ');
            const last = parts[parts.length - 1] || '';
            return last === t;
        });
        return matches.length === 1 ? matches[0] : null;
    }
    function resolveOpponentEntry(fighter, explicitOpp, looseOpp) {
        const rawOpp = explicitOpp || looseOpp;
        const fighterNorm = normalizeName(fighter.name) || fighter.name;
        const cardOpp = findOpponentFromUpcomingCard(fighter.name);
        const oppNorm = rawOpp ? (normalizeName(rawOpp) || rawOpp) : (cardOpp ? (normalizeName(cardOpp) || cardOpp) : null);
        const singleToken = looseOpp && looseOpp.split(' ').length === 1 ? looseOpp.toLowerCase() : null;
        // Fast-path: exact normalized name lookup via pre-built map (O(1) vs O(N) loop)
        if (oppNorm && _fighterByNorm) {
            const direct = _fighterByNorm.get(oppNorm.toLowerCase());
            if (direct && direct.name !== fighter.name)
                return direct;
        }
        let best = null;
        let bestScore = 0;
        let tieAtBest = false;
        for (const candidate of allFighters) {
            if (candidate.name === fighter.name)
                continue;
            const candidateNorm = normalizeName(candidate.name) || candidate.name;
            const candidateOppNorm = normalizeName(candidate.opponent || '') || null;
            let score = 0;
            if (oppNorm) {
                if (candidateNorm === oppNorm)
                    score = Math.max(score, 100);
                else if (namesMatch(candidateNorm, oppNorm))
                    score = Math.max(score, 90);
                else if (rawOpp && namesMatch(candidate.name, rawOpp))
                    score = Math.max(score, 88);
            }
            if (singleToken) {
                const parts = candidateNorm.toLowerCase().split(' ');
                const first = parts[0] || '';
                const last = parts[parts.length - 1] || '';
                if (last === singleToken)
                    score = Math.max(score, 82);
                else if (first === singleToken)
                    score = Math.max(score, 78);
            }
            if (candidateOppNorm && (candidateOppNorm === fighterNorm || namesMatch(candidateOppNorm, fighterNorm))) {
                score = Math.max(score, 72);
            }
            if (score === 0)
                continue;
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
                tieAtBest = false;
            }
            else if (score === bestScore) {
                tieAtBest = true;
            }
        }
        if (best && !tieAtBest)
            return best;
        const fallbackBySingleToken = singleToken ? findOpponentBySingleToken(singleToken, fighter.name) : null;
        if (fallbackBySingleToken)
            return fallbackBySingleToken;
        const fallbackByReverse = allFighters.find((x) => {
            if (x.name === fighter.name)
                return false;
            if (!x.opponent)
                return false;
            const xOppNorm = normalizeName(x.opponent) || x.opponent;
            return xOppNorm === fighterNorm || namesMatch(xOppNorm, fighterNorm);
        });
        return fallbackByReverse || null;
    }
    // Filter out cancelled fighters from the display list
    const activeFighters = fighters.filter(f => !isCancelledFighter(f.name));
    // Compute which (platform, stat) slots have data for at least one fighter on
    // this slate. lineCell skips emitting cells (placeholder or real) for slots
    // outside this set, so dead columns don't take horizontal space across cards.
    _slatePresentSlots = (() => {
        const present = new Set();
        const platforms = ['p6', 'ud', 'pp', 'betr', 'dk'];
        const stats = ['fp', 'ss', 'td', 'ft', 'ctrl'];
        for (const f of activeFighters) {
            for (const p of platforms) {
                for (const s of stats) {
                    if (p === 'dk' && s === 'fp')
                        continue;
                    const key = (s === 'fp' ? `line_${p}` : `line_${p}_${s}`);
                    if (f[key] != null) {
                        present.add(`${p}:${s}`);
                    }
                }
            }
        }
        return present;
    })();
    // Build into a DocumentFragment so the browser only does layout/paint once
    // when the fragment is committed at the end. Direct container.appendChild
    // per row triggers a layout pass per row (~80 passes for a 26-fighter card).
    const frag = document.createDocumentFragment();
    const showFightGroups = currentSort === 'default' && currentView === 'all' && !currentSearch.trim();
    const buildRowForFighter = (f, rowIdx, fightIndex) => {
        const explicitOpp = sanitizeOpponentName(f.opponent, f.name);
        const looseOpp = sanitizeLooseOpponentToken(f.opponent, f.name);
        const opp = explicitOpp || looseOpp;
        const oppEntry = resolveOpponentEntry(f, explicitOpp, looseOpp);
        debugLog(`TD/SS lookup: ${f.name} → rawOpp="${String(f.opponent ?? '')}" explicitOpp="${explicitOpp}" looseOpp="${looseOpp}" resolvedOpp="${opp}" oppEntry="${oppEntry?.name}" oppTdLine=${oppEntry?.line_p6_td ?? oppEntry?.line_ud_td ?? oppEntry?.line_pp_td ?? oppEntry?.line_betr_td ?? null} oppSsLine=${oppEntry?.line_p6_ss ?? oppEntry?.line_ud_ss ?? oppEntry?.line_pp_ss ?? oppEntry?.line_betr_ss ?? null} selfTdLine=${f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? null}`);
        const row = buildFighterRow(f, oppEntry ?? null, fightIndex);
        row.style.setProperty('--row-index', String(rowIdx % 18));
        if (isPlaceholderFighter(f))
            row.classList.add('fighter-row-placeholder');
        return row;
    };
    if (showFightGroups) {
        const fights = buildFights(activeFighters);
        fights.forEach((fight, idx) => {
            const a = fight.fighterA;
            const b = fight.fighterB;
            // Skip only truly empty pairs (no UFCStats AND no platform lines). When
            // UFCStats whiffs the whole card (e.g. early fight-week before detail
            // pages exist), db.loaded is false everywhere but UD/Pick6 still have
            // real lines — those must render.
            const hasAnyLine = (x) => hasSourceLine(x, 'p6') || hasSourceLine(x, 'ud') || hasSourceLine(x, 'pp')
                || hasSourceLine(x, 'betr') || hasSourceLine(x, 'dk');
            if (b && isPlaceholderFighter(a) && isPlaceholderFighter(b) && !hasAnyLine(a) && !hasAnyLine(b))
                return;
            const badgeText = fight.cardPosition === 'main' ? 'MAIN EVENT'
                : fight.cardPosition === 'co-main' ? 'CO-MAIN'
                    : fight.cardPosition === 'main-card' ? 'MAIN CARD'
                        : 'PRELIM';
            const badgeCls = fight.cardPosition === 'main' ? 'main'
                : fight.cardPosition === 'co-main' ? 'co'
                    : fight.cardPosition === 'main-card' ? 'card'
                        : 'prelim';
            const header = document.createElement('div');
            header.className = `fight-group-header fgh-${badgeCls}`;
            const f2Name = b?.name || '';
            header.innerHTML = `<div class="fight-group-line"></div><span class="fight-badge ${badgeCls}">${badgeText}</span><button class="fight-cancel-btn" title="Mark fight as cancelled — hides both fighters from the slate (use for withdrawals)">× Cancel fight</button><div class="fight-group-line"></div>`;
            const cancelBtn = header.querySelector('.fight-cancel-btn');
            cancelBtn?.addEventListener('click', () => { void cancelFight(a.name, f2Name); });
            frag.appendChild(header);
            const rowA = buildRowForFighter(a, idx * 2, idx);
            if (!b) {
                frag.appendChild(rowA);
                return;
            }
            const rowB = buildRowForFighter(b, idx * 2 + 1, idx);
            const hasSpine = spineHasContent(fight);
            const pair = document.createElement('div');
            pair.className = 'fight-pair';
            if (!hasSpine)
                pair.classList.add('fight-pair-no-spine');
            rowA.classList.add('fight-pair-fighter-a');
            rowB.classList.add('fight-pair-fighter-b');
            pair.appendChild(rowA);
            if (hasSpine) {
                pair.appendChild(buildFightSpine(fight));
            }
            else {
                const emptySpine = document.createElement('div');
                emptySpine.className = 'fight-spine fight-spine-empty';
                // Filled-mode content needs to exist in DOM even when no header chips
                // exist, so the `.fight-pair:has(.expanded)` CSS rule can reveal it.
                emptySpine.innerHTML = buildFilledSpineWrapper(fight.fighterA, fight.fighterB);
                pair.appendChild(emptySpine);
            }
            pair.appendChild(rowB);
            frag.appendChild(pair);
        });
    }
    else {
        activeFighters.forEach((f, i) => {
            const row = buildRowForFighter(f, i, Math.floor(i / 2));
            frag.appendChild(row);
            if (i % 2 === 1 && i < activeFighters.length - 1) {
                const sp = document.createElement('div');
                sp.style.cssText = 'height:8px';
                frag.appendChild(sp);
            }
        });
    }
    // Show cancelled fights at bottom with restore option
    if (cancelledFightPairs.length > 0 && showFightGroups) {
        const cancelHeader = document.createElement('div');
        cancelHeader.className = 'fight-group-header';
        cancelHeader.innerHTML = `<div class="fight-group-line"></div><span class="fight-badge cancelled">CANCELLED</span><div class="fight-group-line"></div>`;
        frag.appendChild(cancelHeader);
        for (const pair of cancelledFightPairs) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;opacity:0.5;font-size:12px;color:var(--text3);';
            row.innerHTML = `<span style="text-decoration:line-through">${pair.f1} vs ${pair.f2}</span>`;
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'fight-restore-btn';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', () => { void restoreCancelledFight(pair.f1, pair.f2); });
            row.appendChild(restoreBtn);
            frag.appendChild(row);
        }
    }
    // Commit the entire fragment in one DOM operation.
    container.appendChild(frag);
    // ── Animate bars on scroll into view (IntersectionObserver) ─────────
    // Skip bars inside .fighter-detail — those are hidden by default and get
    // animated on toggleRow expand. Animating them here scheduled 100+ setTimeouts
    // per row for invisible work, then toggleRow re-fired them on expand.
    // Also cap stagger total at ~350ms so the wave doesn't drag for huge rows.
    const fillBarsInElement = (el) => {
        const bars = el.querySelectorAll('[data-fill-width]');
        let visibleIdx = 0;
        bars.forEach((bar) => {
            if (bar.closest('.fighter-detail'))
                return;
            const target = bar.dataset.fillWidth;
            const delay = Math.min(visibleIdx * 6, 350);
            visibleIdx++;
            setTimeout(() => { bar.style.width = target; }, delay);
        });
    };
    if (typeof IntersectionObserver !== 'undefined') {
        const barObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting)
                    return;
                fillBarsInElement(entry.target);
                barObserver.unobserve(entry.target);
            });
        }, { threshold: 0.1 });
        container.querySelectorAll('.fighter-row').forEach(row => barObserver.observe(row));
    }
    else {
        // Fallback: fill all bars immediately
        fillBarsInElement(container);
    }
    renderModelHealthWidget();
}
// ── NEWS FETCHING ──────────────────────────────────────────────────────────
// ── MANUAL WEIGHT-MISS OVERRIDE ────────────────────────────────────────────
// Used when Google News auto-detection can't disambiguate (e.g., headline
// uses "MMA legend" instead of fighter name). User flags via console:
//   window.markMissedWeight('Jeremy Stephens', 4)
//   window.clearMissedWeight('Jeremy Stephens')
// Manual entries persist in chrome.storage.local and are re-applied after
// every fetchAllFighterNews (which clears auto-signals first).
async function loadManualWeightMisses() {
    try {
        const data = await storageGet([MANUAL_WEIGHT_MISS_KEY]);
        const raw = data[MANUAL_WEIGHT_MISS_KEY];
        return (raw && typeof raw === 'object') ? raw : {};
    }
    catch {
        return {};
    }
}
async function saveManualWeightMisses(map) {
    await new Promise((res) => chrome.storage.local.set({ [MANUAL_WEIGHT_MISS_KEY]: map }, res));
}
async function applyManualWeightMisses() {
    const map = await loadManualWeightMisses();
    for (const [nameLower, entry] of Object.entries(map)) {
        const lbs = Number(entry.lbsOver);
        if (!Number.isFinite(lbs) || lbs <= 0)
            continue;
        _weightMissSignals.set(nameLower, {
            lbsOver: lbs,
            severity: severityFromLbs(lbs),
            source: `Manual override: ${lbs} lbs over`,
        });
    }
}
async function setManualWeightMiss(name, lbsOver) {
    const map = await loadManualWeightMisses();
    map[name.toLowerCase()] = { lbsOver, addedAt: Date.now() };
    await saveManualWeightMisses(map);
    await applyManualWeightMisses();
    renderFighters();
    console.log(`[UFC Analyzer] Manual weight-miss flag set: ${name} = ${lbsOver} lbs over. Badge should now appear.`);
}
async function clearManualWeightMiss(name) {
    const map = await loadManualWeightMisses();
    const key = name.toLowerCase();
    if (!(key in map)) {
        console.log(`[UFC Analyzer] No manual flag found for ${name}.`);
        return;
    }
    delete map[key];
    await saveManualWeightMisses(map);
    _weightMissSignals.delete(key);
    renderFighters();
    console.log(`[UFC Analyzer] Manual weight-miss flag cleared for ${name}.`);
}
async function listManualWeightMisses() {
    const map = await loadManualWeightMisses();
    const entries = Object.entries(map);
    if (!entries.length) {
        console.log('[UFC Analyzer] No manual weight-miss flags set.');
        return;
    }
    console.table(entries.map(([name, e]) => ({
        fighter: name,
        lbsOver: e.lbsOver,
        addedAt: new Date(e.addedAt).toLocaleString(),
    })));
}
// Expose to console
window.markMissedWeight = setManualWeightMiss;
window.clearMissedWeight = clearManualWeightMiss;
window.listMissedWeights = listManualWeightMisses;
// ── MANUAL FIGHTER-STYLE OVERRIDE ──────────────────────────────────────────
// deriveStyle is a crude threshold classifier (tdAvg > 2.0 → grappler, etc.)
// that misfires when a fighter has stat-padded numbers vs lower competition
// or when their matchup-specific role differs from career averages. User
// flags via console:
//   window.setFighterStyle('Melquizael Costa', 'striker')
//   window.clearFighterStyle('Melquizael Costa')
//   window.listFighterStyles()
// After overriding, re-run Generate Predictions to recompute SS/TD with the
// new style. Persists in chrome.storage.local under FIGHTER_STYLE_OVERRIDE_KEY.
async function loadFighterStyleOverrides() {
    try {
        const data = await storageGet([FIGHTER_STYLE_OVERRIDE_KEY]);
        const raw = data[FIGHTER_STYLE_OVERRIDE_KEY];
        return (raw && typeof raw === 'object') ? raw : {};
    }
    catch {
        return {};
    }
}
async function saveFighterStyleOverrides(map) {
    await new Promise((res) => chrome.storage.local.set({ [FIGHTER_STYLE_OVERRIDE_KEY]: map }, res));
}
async function applyFighterStyleOverrides() {
    const map = await loadFighterStyleOverrides();
    _fighterStyleOverrides.clear();
    for (const [nameLower, style] of Object.entries(map)) {
        if (style === 'striker' || style === 'grappler' || style === 'balanced') {
            _fighterStyleOverrides.set(nameLower, style);
        }
    }
    // Mutate any already-cached fighter DBs so panels reflect the change without
    // a refetch. Generate Predictions still needs to re-run to recompute SS/TD.
    for (const [cacheKey, db] of Object.entries(statsCache)) {
        const override = _fighterStyleOverrides.get(cacheKey.trim().toLowerCase());
        if (override && db.style !== override)
            db.style = override;
    }
}
async function setFighterStyle(name, style) {
    if (style !== 'striker' && style !== 'grappler' && style !== 'balanced') {
        console.error(`[UFC Analyzer] Invalid style "${style}" — must be 'striker' | 'grappler' | 'balanced'`);
        return;
    }
    const map = await loadFighterStyleOverrides();
    map[name.trim().toLowerCase()] = style;
    await saveFighterStyleOverrides(map);
    await applyFighterStyleOverrides();
    console.log(`[UFC Analyzer] Style override set: ${name} → ${style}. Re-run Generate Predictions to recompute SS/TD/FP with the new style.`);
}
async function clearFighterStyle(name) {
    const map = await loadFighterStyleOverrides();
    const key = name.trim().toLowerCase();
    if (!(key in map)) {
        console.log(`[UFC Analyzer] No style override found for ${name}.`);
        return;
    }
    delete map[key];
    await saveFighterStyleOverrides(map);
    _fighterStyleOverrides.delete(key);
    console.log(`[UFC Analyzer] Style override cleared for ${name}. Re-run Generate Predictions to revert to classifier output.`);
}
async function listFighterStyles() {
    const map = await loadFighterStyleOverrides();
    const entries = Object.entries(map);
    if (!entries.length) {
        console.log('[UFC Analyzer] No fighter-style overrides set.');
        return;
    }
    console.table(entries.map(([name, style]) => ({ fighter: name, style })));
}
window.setFighterStyle = setFighterStyle;
window.clearFighterStyle = clearFighterStyle;
// ── MANUAL LINE-BASELINE RESET ─────────────────────────────────────────────
// When a fighter's opponent changes mid-event (e.g., Bellato pulls out and
// Edwards replaces him), the prior fighter's baselines become stale — the new
// opener vs the replacement gets diffed against the old line vs the dropped
// opponent, producing a false drift + RLM badge. Baselines are keyed by
// fighter name alone (no opponent in the key) and the existing wipe triggers
// only fire on event changes, so opponent-swaps within the same event need a
// manual nudge. User runs:
//   window.resetFighterBaseline('Modestas Bukauskas')
// to clear all opening-line + prev-refresh + history entries for that fighter
// across every platform/stat. Next refresh re-snapshots current lines as the
// new opener.
async function resetFighterBaseline(name) {
    const target = name.trim().toLowerCase();
    if (!target) {
        console.error('[UFC Analyzer] resetFighterBaseline: name required');
        return;
    }
    let openingCleared = 0;
    for (const key of [..._openingLines.keys()]) {
        const parts = key.split('|');
        if (parts[2] === target) {
            _openingLines.delete(key);
            openingCleared++;
        }
    }
    let prevCleared = 0;
    for (const key of [..._prevRefreshLines.keys()]) {
        const parts = key.split('|');
        if (parts[2] === target) {
            _prevRefreshLines.delete(key);
            prevCleared++;
        }
    }
    let historyCleared = 0;
    for (const key of Object.keys(_lineHistory.series)) {
        if (key.startsWith(`${target}|`)) {
            delete _lineHistory.series[key];
            historyCleared++;
        }
    }
    if (openingCleared === 0 && prevCleared === 0 && historyCleared === 0) {
        console.log(`[UFC Analyzer] resetFighterBaseline: no entries found for "${name}" — check spelling. Nothing cleared.`);
        return;
    }
    _lineHistory.updatedAt = Date.now();
    await Promise.all([
        storageSet({ lines_open_v1: buildOpeningLinesRecord() }),
        storageSet({ [STORAGE_LINE_HISTORY_KEY]: _lineHistory }),
    ]);
    renderFighters();
    console.log(`[UFC Analyzer] Baseline reset for ${name}: cleared ${openingCleared} opening / ${prevCleared} prev-refresh / ${historyCleared} history entries. Next refresh re-anchors.`);
}
window.resetFighterBaseline = resetFighterBaseline;
window.listFighterStyles = listFighterStyles;
// fetchFighterNews moved to ./analyzer/news.ts. fetchAllFighterNews stays here
// because it orchestrates module-scoped state (allFighters, renderFighters).
async function fetchAllFighterNews() {
    _newsAlertFighters.clear();
    _weightMissSignals.clear();
    const candidatesByFighter = new Map();
    await Promise.all(allFighters.map(async (f) => {
        const items = await fetchFighterNews(f.name);
        const hasAlert = items.some(item => NEWS_INJURY_KEYWORDS.some(kw => item.title.toLowerCase().includes(kw)));
        if (hasAlert)
            _newsAlertFighters.add(f.name.toLowerCase());
        const fLower = f.name.toLowerCase();
        const fLast = fLower.split(' ').pop() || fLower;
        // Cross-fighter guard: outlets sometimes name a different fighter on the
        // same card ("JDM and Prates make weight"); reject those for f.
        const otherLastNames = allFighters
            .filter(o => o.name.toLowerCase() !== fLower)
            .map(o => (o.name.toLowerCase().split(' ').pop() || ''))
            .filter(ln => ln.length >= 4 && ln !== fLast);
        const fCands = [];
        items.forEach((item, idx) => {
            const sig = parseWeightMissFromTitle(item.title, f.name);
            if (!sig)
                return;
            const haystack = (item.title + ' ' + (item.description || '')).toLowerCase();
            const namesSelf = haystack.includes(fLower) || new RegExp(`\\b${fLast}\\b`).test(haystack);
            const namesOther = otherLastNames.some(ln => new RegExp(`\\b${ln}\\b`).test(haystack));
            // Reject only if another fighter is explicitly named — those are about
            // someone else, not us. Articles that name no one are kept as candidates;
            // Pass 2 disambiguates them via per-pair count comparison.
            if (namesOther)
                return;
            fCands.push({ sig, index: idx, namesSelf });
        });
        if (fCands.length > 0)
            candidatesByFighter.set(fLower, fCands);
    }));
    // Pass 2 — within each fight pair, compare candidate counts. The actual
    // misser has 2+ matching articles (their name is in the article body so
    // Google News surfaces multiple weight-miss articles in their search); the
    // opponent has 0–1 tangential card-recap mentions. A clear margin attributes
    // the signal; ambiguity (both sides similar) skips. As a tiebreaker for
    // close cases, prefer a fighter explicitly named in title/description.
    const applyBestSignal = (key, cands) => {
        let best = null;
        for (const c of cands) {
            if (!best) {
                best = c;
                continue;
            }
            // Prefer higher severity; then higher lbsOver; then namesSelf; then lower index.
            if (best.sig.severity === 'unknown' && c.sig.severity !== 'unknown') {
                best = c;
                continue;
            }
            if (c.sig.severity === 'unknown' && best.sig.severity !== 'unknown')
                continue;
            if (c.sig.lbsOver != null && best.sig.lbsOver != null && c.sig.lbsOver > best.sig.lbsOver) {
                best = c;
                continue;
            }
            if (c.sig.lbsOver != null && best.sig.lbsOver == null) {
                best = c;
                continue;
            }
            if (c.namesSelf && !best.namesSelf) {
                best = c;
                continue;
            }
            if (c.index < best.index && c.namesSelf === best.namesSelf)
                best = c;
        }
        if (best)
            _weightMissSignals.set(key, best.sig);
    };
    const processed = new Set();
    for (const f of allFighters) {
        const fLower = f.name.toLowerCase();
        if (processed.has(fLower))
            continue;
        const oppLower = (f.opponent || '').toLowerCase();
        const fCands = candidatesByFighter.get(fLower) || [];
        const oCands = oppLower ? (candidatesByFighter.get(oppLower) || []) : [];
        processed.add(fLower);
        if (oppLower)
            processed.add(oppLower);
        if (fCands.length === 0 && oCands.length === 0)
            continue;
        const fCount = fCands.length;
        const oCount = oCands.length;
        // Clear margin: 2+ articles AND at least 2 more than the opponent.
        if (fCount >= 2 && fCount - oCount >= 2) {
            applyBestSignal(fLower, fCands);
            continue;
        }
        if (oCount >= 2 && oCount - fCount >= 2) {
            applyBestSignal(oppLower, oCands);
            continue;
        }
        // Close counts: fall back to the explicit-name gate. If exactly one side
        // has a candidate that names them in title/description, fire for them.
        const fNamed = fCands.filter(c => c.namesSelf);
        const oNamed = oCands.filter(c => c.namesSelf);
        if (fNamed.length > 0 && oNamed.length === 0)
            applyBestSignal(fLower, fNamed);
        else if (oNamed.length > 0 && fNamed.length === 0)
            applyBestSignal(oppLower, oNamed);
        // else: ambiguous — both sides named or neither, similar counts → skip.
    }
    // Apply manual overrides AFTER auto-detection so user flags always win.
    await applyManualWeightMisses();
    renderFighters();
}
// ── STYLE MATCHUP PANEL ────────────────────────────────────────────────────
function buildModelRivalryPanel(lean) {
    const models = lean.rivalryModels || [];
    if (!models.length)
        return '';
    const consensusTone = lean.rivalryConsensus === 'over'
        ? 'var(--green)'
        : lean.rivalryConsensus === 'under'
            ? 'var(--red)'
            : 'var(--text2)';
    const consensusText = lean.rivalryConsensus === 'over'
        ? 'OVER consensus'
        : lean.rivalryConsensus === 'under'
            ? 'UNDER consensus'
            : 'Split board';
    const impactText = lean.rivalryConfidenceDelta
        ? `Confidence ${lean.rivalryConfidenceDelta > 0 ? '+' : ''}${lean.rivalryConfidenceDelta}`
        : 'No confidence change';
    const rows = models.map((model) => {
        const tone = model.lean === 'over'
            ? 'var(--green)'
            : model.lean === 'under'
                ? 'var(--red)'
                : 'var(--text2)';
        const bg = model.lean === 'over'
            ? 'rgba(72,199,142,0.10)'
            : model.lean === 'under'
                ? 'rgba(255,100,100,0.10)'
                : 'rgba(125,145,190,0.08)';
        const border = model.model === lean.rivalryStrongDissent
            ? 'rgba(255,184,77,0.55)'
            : model.lean === 'over'
                ? 'rgba(72,199,142,0.25)'
                : model.lean === 'under'
                    ? 'rgba(255,100,100,0.25)'
                    : 'rgba(125,145,190,0.18)';
        const label = model.lean === 'over' ? '▲ OVER' : model.lean === 'under' ? '▼ UNDER' : '~ PUSH';
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid ${border};background:${bg}">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tone}">${model.label}</span>
          ${model.model === lean.rivalryStrongDissent ? `<span style="font-size:9px;padding:2px 6px;border-radius:999px;background:rgba(255,184,77,0.12);border:1px solid rgba(255,184,77,0.35);color:#ffbe6b;letter-spacing:0.08em;text-transform:uppercase">Dissent</span>` : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:4px">${model.note}</div>
      </div>
      <div style="text-align:right;min-width:78px">
        <div style="font-size:11px;font-weight:700;color:${tone}">${label}</div>
        <div style="font-size:10px;color:${tone};margin-top:3px">${model.confidence}%${model.projected != null ? ` · ${model.projected.toFixed(1)}` : ''}</div>
      </div>
    </div>`;
    }).join('');
    return `<div class="detail-panel mr-panel">
    <div class="detail-panel-title">Model Rivalry</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span class="style-matchup-chip style-chip-default" style="color:${consensusTone}">${consensusText}</span>
      <span style="font-size:10px;color:var(--text2);letter-spacing:0.06em;text-transform:uppercase">${impactText}</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:8px">${lean.rivalrySummary || 'Four FP brains are cross-checking the lean.'}</div>
    ${lean.rivalryDissent ? `<div style="font-size:10px;color:#ffbe6b;background:rgba(255,184,77,0.08);border:1px solid rgba(255,184,77,0.28);border-radius:8px;padding:7px 9px;margin-bottom:8px">${lean.rivalryDissent}</div>` : ''}
    <div style="display:grid;gap:8px">${rows}</div>
  </div>`;
}
// ── FAIR VALUE PANEL ──────────────────────────────────────────────────────
function buildFairValuePanel(lean) {
    if (lean.fairValue == null || lean.fairValueEdge == null)
        return '';
    const fv = lean.fairValue;
    const edge = lean.fairValueEdge;
    const perBook = lean.fairValuePerBook || [];
    const absEdge = Math.abs(edge);
    // Edge tier for the header badge
    const edgeTier = absEdge >= 4 ? 'strong' : absEdge >= 2 ? 'moderate' : 'slim';
    const edgeColor = absEdge >= 4
        ? (edge > 0 ? 'var(--green)' : 'var(--red)')
        : absEdge >= 2
            ? 'var(--amber)'
            : 'var(--text2)';
    const edgeBg = absEdge >= 4
        ? (edge > 0 ? 'rgba(72,199,142,0.10)' : 'rgba(255,100,100,0.10)')
        : absEdge >= 2
            ? 'rgba(240,192,64,0.10)'
            : 'rgba(125,145,190,0.08)';
    const edgeDir = edge > 0 ? 'OVER value' : edge < 0 ? 'UNDER value' : 'No edge';
    const tierLabel = edgeTier === 'strong' ? 'Strong edge' : edgeTier === 'moderate' ? 'Moderate edge' : 'Slim edge';
    // Per-model projections row
    const models = lean.rivalryModels || [];
    const modelCells = models
        .filter(m => m.projected != null)
        .map(m => {
        const tone = m.lean === 'over' ? 'var(--green)' : m.lean === 'under' ? 'var(--red)' : 'var(--text2)';
        return `<div style="text-align:center;min-width:58px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text2);margin-bottom:3px">${m.label}</div>
        <div style="font-size:13px;font-weight:700;color:${tone}">${m.projected.toFixed(1)}</div>
      </div>`;
    }).join('');
    // Per-book edge rows
    const bookRows = perBook.map(b => {
        const bEdge = b.edge;
        const bAbs = Math.abs(bEdge);
        const bColor = bAbs >= 4
            ? (bEdge > 0 ? 'var(--green)' : 'var(--red)')
            : bAbs >= 2
                ? 'var(--amber)'
                : 'var(--text2)';
        const bBg = bAbs >= 4
            ? (bEdge > 0 ? 'rgba(72,199,142,0.08)' : 'rgba(255,100,100,0.08)')
            : bAbs >= 2
                ? 'rgba(240,192,64,0.08)'
                : 'rgba(125,145,190,0.06)';
        const bBorder = bAbs >= 4
            ? (bEdge > 0 ? 'rgba(72,199,142,0.30)' : 'rgba(255,100,100,0.30)')
            : bAbs >= 2
                ? 'rgba(240,192,64,0.30)'
                : 'rgba(125,145,190,0.18)';
        const bestTag = perBook.length > 1 && b === perBook[0] && bAbs >= 2
            ? `<span style="font-size:8px;padding:1px 5px;border-radius:999px;background:rgba(72,199,142,0.12);border:1px solid rgba(72,199,142,0.35);color:var(--green);letter-spacing:0.08em;text-transform:uppercase;margin-left:6px">Best</span>`
            : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:8px;border:1px solid ${bBorder};background:${bBg}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--text1)">${b.source}</span>
        <span style="font-size:10px;color:var(--text2)">line ${b.line}</span>
        ${bestTag}
      </div>
      <div style="text-align:right">
        <span style="font-size:12px;font-weight:700;color:${bColor}">${bEdge > 0 ? '+' : ''}${bEdge.toFixed(1)}</span>
        <span style="font-size:9px;color:var(--text2);margin-left:4px">pts</span>
      </div>
    </div>`;
    }).join('');
    return `<div class="detail-panel fv-panel">
    <div class="detail-panel-title">Fair Value Generator</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div style="display:flex;align-items:baseline;gap:6px">
        <span style="font-size:20px;font-weight:800;color:var(--text1)">${fv.toFixed(1)}</span>
        <span style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em">fair line</span>
      </div>
      <div style="padding:3px 10px;border-radius:999px;background:${edgeBg};border:1px solid ${edgeColor}40">
        <span style="font-size:11px;font-weight:700;color:${edgeColor}">${edge > 0 ? '+' : ''}${edge.toFixed(1)} ${edgeDir}</span>
      </div>
      <span style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em">${tierLabel}</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:10px">Confidence-weighted projection from 4 rivalry models vs the book${perBook.length > 1 ? 's' : ''} line.</div>
    ${modelCells ? `<div style="display:flex;justify-content:space-around;padding:8px 6px;border-radius:10px;background:rgba(125,145,190,0.06);border:1px solid rgba(125,145,190,0.15);margin-bottom:10px">${modelCells}</div>` : ''}
    ${bookRows ? `<div style="display:grid;gap:6px">${bookRows}</div>` : ''}
  </div>`;
}
function buildPayoutEVPanel(f, lean, evDetail, perBookEv) {
    if (evDetail == null)
        return '';
    const ev = evDetail.ev;
    const evColor = ev >= 10 ? 'var(--green)' : ev >= 3 ? 'var(--amber)' : ev > 0 ? 'var(--text2)' : 'var(--red)';
    const evBg = ev >= 10 ? 'rgba(72,199,142,0.10)' : ev >= 3 ? 'rgba(240,192,64,0.10)' : ev > 0 ? 'rgba(125,145,190,0.08)' : 'rgba(255,100,100,0.10)';
    const vigLabel = evDetail.vig != null
        ? `<span style="font-size:9px;color:${evDetail.vig > 5 ? 'var(--red)' : evDetail.vig > 3 ? 'var(--amber)' : 'var(--green)'};margin-left:6px">${evDetail.vig}% vig</span>`
        : '';
    const sourceLabel = evDetail.isAssumedVig
        ? '<span style="font-size:8px;padding:1px 5px;border-radius:999px;background:rgba(125,145,190,0.10);border:1px solid rgba(125,145,190,0.25);color:var(--text2);letter-spacing:0.06em;text-transform:uppercase;margin-left:6px">Est</span>'
        : '<span style="font-size:8px;padding:1px 5px;border-radius:999px;background:rgba(72,199,142,0.10);border:1px solid rgba(72,199,142,0.25);color:var(--green);letter-spacing:0.06em;text-transform:uppercase;margin-left:6px">Live</span>';
    const profitLabel = `${evDetail.profit.toFixed(2)}x payout`;
    // Per-book EV breakdown rows (only when there are actual odds)
    const bookRows = perBookEv.map(b => {
        const bColor = b.ev >= 10 ? 'var(--green)' : b.ev >= 3 ? 'var(--amber)' : b.ev > 0 ? 'var(--text2)' : 'var(--red)';
        const bBg = b.ev >= 10 ? 'rgba(72,199,142,0.08)' : b.ev >= 3 ? 'rgba(240,192,64,0.08)' : b.ev > 0 ? 'rgba(125,145,190,0.06)' : 'rgba(255,100,100,0.08)';
        const bBorder = b.ev >= 10 ? 'rgba(72,199,142,0.30)' : b.ev >= 3 ? 'rgba(240,192,64,0.30)' : 'rgba(125,145,190,0.18)';
        const oddsStr = Math.abs(b.odds) >= 100 ? (b.odds > 0 ? `+${b.odds}` : `${b.odds}`) : `${b.odds.toFixed(2)}x`;
        const vigStr = b.vig != null ? `<span style="font-size:9px;color:${b.vig > 5 ? 'var(--red)' : b.vig > 3 ? 'var(--amber)' : 'var(--green)'};margin-left:4px">${b.vig}%</span>` : '';
        const bestTag = b.isBest && perBookEv.length > 1
            ? `<span style="font-size:8px;padding:1px 5px;border-radius:999px;background:rgba(72,199,142,0.12);border:1px solid rgba(72,199,142,0.35);color:var(--green);letter-spacing:0.08em;text-transform:uppercase;margin-left:6px">Best</span>`
            : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:8px;border:1px solid ${bBorder};background:${bBg}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--text1)">${b.source}</span>
        <span style="font-size:10px;color:var(--text2)">${lean.lean?.toUpperCase()} @ ${oddsStr}</span>
        ${vigStr}${bestTag}
      </div>
      <div style="text-align:right">
        <span style="font-size:12px;font-weight:700;color:${bColor}">${b.ev > 0 ? '+' : ''}${b.ev}%</span>
        <span style="font-size:9px;color:var(--text2);margin-left:4px">EV</span>
      </div>
    </div>`;
    }).join('');
    return `<div class="detail-panel ev-panel">
    <div class="detail-panel-title">Payout EV</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div style="padding:3px 10px;border-radius:999px;background:${evBg};border:1px solid ${evColor}40">
        <span style="font-size:14px;font-weight:800;color:${evColor}">${ev > 0 ? '+' : ''}${ev}%</span>
      </div>
      ${sourceLabel}${vigLabel}
      <span style="font-size:9px;color:var(--text2)">${profitLabel}</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:8px">${evDetail.isAssumedVig
        ? 'Estimated EV using assumed -110 standard vig (no book odds available for this prop type). Win prob from confidence score.'
        : `Actual payout-weighted EV using scraped ${lean.lean?.toUpperCase()} odds. Win prob ${((lean.conf || 0)).toFixed(0)}% × ${evDetail.profit.toFixed(3)}x return − ${(100 - (lean.conf || 0)).toFixed(0)}% loss.`}</div>
    ${bookRows ? `<div style="display:grid;gap:6px;margin-top:6px">${bookRows}</div>` : ''}
  </div>`;
}
function buildArchetypeLearnerPanel(fighterName, db, oppDB, moneyline) {
    if (!db?.loaded)
        return '';
    const profile = learnArchetypeProfile(fighterName, db, oppDB, moneyline);
    const confidenceTone = profile.confidence >= 80 ? 'var(--green)' : profile.confidence >= 68 ? 'var(--amber)' : 'var(--text2)';
    const secondary = profile.secondaryLabel ? ` · Secondary: ${formatCareerArchetypeLabel(profile.secondaryLabel)}` : '';
    const alert = profile.matchupAlert !== 'none'
        ? `<div class="lean-point"><span class="lean-point-icon neg">↓</span><span>${formatMatchupAlertLabel(profile.matchupAlert)} alert: ${profile.reasons[profile.reasons.length - 1] || 'Matchup-specific fragility detected.'}</span></div>`
        : '';
    const reasonRows = profile.reasons
        .slice(0, profile.matchupAlert !== 'none' ? 3 : 2)
        .map((reason, index) => `<div class="lean-point"><span class="lean-point-icon ${index === 0 ? 'pos' : ''}">${index === 0 ? '↑' : '→'}</span><span>${reason}</span></div>`)
        .join('');
    return `<div class="detail-panel arch-panel">
    <div class="detail-panel-title">Archetype Learner</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span class="style-matchup-chip style-chip-default">${formatCareerArchetypeLabel(profile.careerLabel)}</span>
      ${profile.matchupAlert !== 'none' ? `<span class="style-matchup-chip" style="background:rgba(255,100,100,0.12);border-color:rgba(255,100,100,0.35);color:#ff8f8f">${formatMatchupAlertLabel(profile.matchupAlert)}</span>` : ''}
      <span style="font-size:10px;color:${confidenceTone};letter-spacing:0.06em;text-transform:uppercase">Learner ${profile.confidence}%</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:8px">${profile.summary}${secondary}</div>
    <div class="lean-reason">${reasonRows}${alert}</div>
  </div>`;
}
function buildStyleMatchupPanel(db, oppDB, ssLine, tdLine) {
    if (!db?.loaded)
        return '';
    const myStyle = db.style || 'balanced';
    const oppStyle = oppDB?.style || null;
    // Chip styling
    const chipKey = oppStyle ? `${myStyle[0]}${oppStyle[0]}` : '';
    const chipClassMap = { ss: 'style-chip-ss', gg: 'style-chip-gg', sg: 'style-chip-sg', gs: 'style-chip-gs', bs: 'style-chip-bs', sb: 'style-chip-sb', bg: 'style-chip-default', gb: 'style-chip-default', bb: 'style-chip-default' };
    const chipClass = chipClassMap[chipKey] || 'style-chip-default';
    const matchupLabel = oppStyle ? `${myStyle.toUpperCase()} vs ${oppStyle.toUpperCase()}` : myStyle.toUpperCase();
    // Style matchup edge reasons
    const edgeHtml = oppStyle && oppDB
        ? styleMatchupEdge(myStyle, oppStyle, db, oppDB).edges.map(e => `<div class="lean-point"><span class="lean-point-icon ${e.icon === 'pos' ? 'pos' : e.icon === 'neg' ? 'neg' : ''}">${e.icon === 'pos' ? '↑' : e.icon === 'neg' ? '↓' : '→'}</span><span>${e.text}</span></div>`).join('')
        : '';
    const buckets = { striker: { ssOver: 0, ssUnder: 0, tdOver: 0, tdUnder: 0 }, grappler: { ssOver: 0, ssUnder: 0, tdOver: 0, tdUnder: 0 }, balanced: { ssOver: 0, ssUnder: 0, tdOver: 0, tdUnder: 0 } };
    for (const h of (db.history || [])) {
        const hOppDb = statsCache[h.opp];
        if (!hOppDb?.loaded)
            continue;
        const s = hOppDb.style || 'balanced';
        const b = buckets[s];
        if (!b)
            continue;
        if (ssLine != null && h.sigStr != null) {
            if (h.sigStr > ssLine)
                b.ssOver++;
            else
                b.ssUnder++;
        }
        if (tdLine != null && h.td != null) {
            if (h.td > tdLine)
                b.tdOver++;
            else
                b.tdUnder++;
        }
    }
    const buildHitRow = (label, over, under, isCurrent) => {
        const total = over + under;
        if (total === 0)
            return '';
        const pct = Math.round(over / total * 100);
        const barClass = pct >= 55 ? 'over-bar' : 'under-bar';
        const color = pct >= 60 ? '#48c78e' : pct <= 40 ? '#ff6464' : 'var(--text2)';
        return `<div class="style-hit-row${isCurrent ? ' style-hit-current' : ''}">
      <span class="style-hit-label">vs ${label}s</span>
      <div class="style-hit-bar-wrap"><div class="style-hit-bar ${barClass}" data-fill-width="${pct}%" style="width:0%"></div></div>
      <span class="style-hit-pct" style="color:${color}">${pct}%</span>
      <span class="style-hit-count">${over}/${total}</span>
    </div>`;
    };
    const hitRows = [
        buildHitRow('striker', buckets.striker.ssOver, buckets.striker.ssUnder, oppStyle === 'striker'),
        buildHitRow('grappler', buckets.grappler.ssOver, buckets.grappler.ssUnder, oppStyle === 'grappler'),
        buildHitRow('balanced', buckets.balanced.ssOver, buckets.balanced.ssUnder, oppStyle === 'balanced'),
    ].filter(Boolean).join('');
    // Only render if there is something meaningful to show
    if (!oppStyle && !edgeHtml && !hitRows)
        return '';
    return `<div class="detail-panel style-matchup-panel">
    <div class="detail-panel-title">Style Matchup${oppStyle ? `<span class="style-matchup-chip ${chipClass}">${matchupLabel}</span>` : ''}</div>
    ${edgeHtml ? `<div class="lean-reason" style="margin-bottom:8px">${edgeHtml}</div>` : ''}
    ${hitRows ? `<div class="style-hit-section-label">SS OVER RATE BY OPP STYLE${ssLine != null ? ` · line ${ssLine}` : ''}</div>${hitRows}` : ''}
  </div>`;
}
// ── FIGHT TIME SUMMARY PANEL ──────────────────────────────────────────────
function buildFightTimeSummaryPanel(db, oppDB, ftLine) {
    if (!db?.loaded || !db.history?.length)
        return '';
    const allHist = db.history;
    const timedFights = allHist.filter(h => Number.isFinite(Number(h.timeSecs)) && Number(h.timeSecs) > 0);
    if (timedFights.length < 2)
        return '';
    const wins = allHist.filter(h => h.result === 'win' && h.method);
    const losses = allHist.filter(h => h.result === 'loss' && h.method);
    const cmatch = (arr, re) => arr.filter(h => re.test(h.method || '')).length;
    const wKO = cmatch(wins, /KO|TKO/i), wSUB = cmatch(wins, /SUB/i), wDEC = wins.length - wKO - wSUB;
    const lKO = cmatch(losses, /KO|TKO/i), lSUB = cmatch(losses, /SUB/i), lDEC = losses.length - lKO - lSUB;
    const bar = (n, total, cls, label) => {
        if (!total || !n)
            return '';
        const pct = Math.round(n / total * 100);
        return `<div class="finish-bar-row">
      <span class="finish-bar-label">${label}</span>
      <div class="finish-bar-wrap"><div class="finish-bar ${cls}" data-fill-width="${pct}%" style="width:0%"></div></div>
      <span class="finish-bar-pct">${n}/${total}</span>
    </div>`;
    };
    const myFinishRate = db.finishRate ?? 0;
    const oppFinishRate = oppDB?.finishRate ?? 0;
    const combined = oppDB?.loaded ? 1 - (1 - myFinishRate) * (1 - oppFinishRate) : myFinishRate;
    const riskColor = combined > 0.80 ? '#ff6464' : combined > 0.55 ? '#efb84d' : '#48c78e';
    const riskLabel = combined > 0.80 ? 'HIGH' : combined > 0.55 ? 'MODERATE' : 'LOW';
    const ftSignal = combined > 0.75 ? { icon: 'neg', text: '↓ LEAN UNDER FT — high early-finish probability' }
        : combined < 0.30 ? { icon: 'pos', text: '↑ LEAN OVER FT — both fighters tend to go the distance' }
            : null;
    const avgFT = timedFights.reduce((s, h) => s + Number(h.timeSecs) / 60, 0) / timedFights.length;
    const winsHtml = wins.length ? `<div class="finish-split-section">
    <div class="finish-split-header">Win methods (${wins.length})</div>
    ${bar(wKO, wins.length, 'ko-bar', 'KO/TKO')}${bar(wSUB, wins.length, 'sub-bar', 'SUB')}${bar(wDEC, wins.length, 'dec-bar', 'DEC')}
  </div>` : '';
    const lossHtml = losses.length ? `<div class="finish-split-section">
    <div class="finish-split-header">Loss methods (${losses.length})${lKO > 0 ? ` <span style="color:#ff6060">⚠ ${lKO} KO/TKO</span>` : ''}</div>
    ${bar(lKO, losses.length, 'ko-bar-loss', 'KO/TKO')}${bar(lSUB, losses.length, 'sub-bar', 'SUB')}${bar(lDEC, losses.length, 'dec-bar', 'DEC')}
  </div>` : '';
    const oppLine = oppDB?.loaded ? `<div style="font-size:10px;color:var(--text3);margin-bottom:4px">Opponent finish rate: <strong style="color:${oppFinishRate > 0.6 ? '#ff6464' : oppFinishRate > 0.35 ? '#efb84d' : '#48c78e'}">${Math.round(oppFinishRate * 100)}%</strong></div>` : '';
    return `<div class="detail-panel ftb-panel">
    <div class="detail-panel-title">Fight Time Breakdown</div>
    <div class="finish-split-wrap">${winsHtml}${lossHtml}</div>
    <div style="margin-top:10px">
      ${oppLine}
      <div class="ft-combined-risk" style="background:rgba(${combined > 0.8 ? '255,100,100' : combined > 0.55 ? '239,184,84' : '72,199,142'},0.07);border-left:2px solid ${riskColor}">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:${riskColor}">COMBINED EARLY-FINISH RISK: ${riskLabel} (${Math.round(combined * 100)}%)</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Avg fight time: ${avgFT.toFixed(1)}m${ftLine != null ? ` · FT line: ${ftLine}m` : ''}${oppDB?.loaded ? ' · both fighters factored' : ''}</div>
        ${ftSignal ? `<div style="font-size:10px;font-weight:600;margin-top:3px;color:${ftSignal.icon === 'pos' ? '#48c78e' : '#ff6464'}">${ftSignal.text}</div>` : ''}
      </div>
    </div>
  </div>`;
}
function buildOpponentProfile(oppDB) {
    const profile = learnArchetypeProfile('', oppDB, null, null);
    return {
        style: oppDB.style,
        stance: oppDB.stance || null,
        slpm: oppDB.slpm ?? 3.5,
        sapm: oppDB.sapm ?? 3.5,
        tdAvgPerFight: oppDB.avgTDperFight ?? oppDB.avgTD ?? 0.8,
        tdDef: oppDB.tdDef ?? 55,
        strDef: oppDB.strDef ?? 55,
        finishRate: oppDB.finishRate ?? 0.45,
        archetype: profile.careerLabel,
    };
}
/** Infer a rough opponent profile from in-fight stats when no DB is available */
function inferOpponentProfileFromFight(fight) {
    const opp = fight.oppStats;
    if (!opp)
        return null;
    const oppSS = opp.sigStr ?? 0;
    const oppTD = opp.td ?? 0;
    const oppCtrl = opp.ctrlSecs ?? 0;
    // Rough style inference from what the opponent did IN the fight
    let style = 'balanced';
    if (oppTD >= 2 || oppCtrl >= 120)
        style = 'grappler';
    else if (oppSS >= 25 && oppTD <= 1)
        style = 'striker';
    // Rough archetype from in-fight behavior
    let archetype = null;
    if (oppSS >= 40 && oppTD <= 1)
        archetype = 'volume_accumulator';
    else if (oppTD >= 3)
        archetype = 'control_merchant';
    else if (oppSS >= 20 && oppSS <= 35 && oppTD <= 1)
        archetype = 'point_bank_striker';
    else if (oppTD >= 2 && oppSS >= 15)
        archetype = 'durable_generalist';
    return {
        style,
        stance: null, // can't infer stance from stats
        slpm: oppSS / Math.max(1, (fight.timeSecs ?? 900) / 300), // rough SLpM
        sapm: (fight.sigStr ?? 0) / Math.max(1, (fight.timeSecs ?? 900) / 300),
        tdAvgPerFight: oppTD,
        tdDef: 55, // unknown, use average
        strDef: 55,
        finishRate: 0.45,
        archetype,
    };
}
function scoreOpponentSimilarity(currentOpp, pastOpp) {
    let score = 0;
    const reasons = [];
    // Style match (weight: 25%)
    if (currentOpp.style === pastOpp.style) {
        score += 0.25;
        reasons.push(`Same style (${currentOpp.style})`);
    }
    else {
        // Partial: balanced is closer to either than striker↔grappler
        if (currentOpp.style === 'balanced' || pastOpp.style === 'balanced') {
            score += 0.10;
        }
    }
    // Archetype match (weight: 20%)
    if (currentOpp.archetype && pastOpp.archetype) {
        if (currentOpp.archetype === pastOpp.archetype) {
            score += 0.20;
            reasons.push(`Same archetype`);
        }
        else {
            // Group similar archetypes
            const strikerTypes = ['volume_accumulator', 'point_bank_striker', 'chaos_brawler'];
            const grapplerTypes = ['control_merchant', 'submission_chaser'];
            if ((strikerTypes.includes(currentOpp.archetype) && strikerTypes.includes(pastOpp.archetype)) ||
                (grapplerTypes.includes(currentOpp.archetype) && grapplerTypes.includes(pastOpp.archetype))) {
                score += 0.10;
                reasons.push(`Similar archetype group`);
            }
        }
    }
    // Stance match (weight: 10%)
    if (currentOpp.stance && pastOpp.stance) {
        if (currentOpp.stance.toLowerCase() === pastOpp.stance.toLowerCase()) {
            score += 0.10;
            if (currentOpp.stance.toLowerCase() === 'southpaw')
                reasons.push(`Both southpaw`);
        }
    }
    // SLPM similarity (weight: 12%) — striking pace
    const slpmDiff = Math.abs(currentOpp.slpm - pastOpp.slpm);
    const slpmScore = Math.max(0, 1 - slpmDiff / 3); // 0 diff = full, 3+ diff = 0
    score += slpmScore * 0.12;
    if (slpmScore >= 0.7)
        reasons.push(`Similar striking pace`);
    // TD rate similarity (weight: 12%)
    const tdDiff = Math.abs(currentOpp.tdAvgPerFight - pastOpp.tdAvgPerFight);
    const tdScore = Math.max(0, 1 - tdDiff / 3);
    score += tdScore * 0.12;
    if (tdScore >= 0.7 && (currentOpp.tdAvgPerFight >= 1.5 || pastOpp.tdAvgPerFight >= 1.5)) {
        reasons.push(`Similar TD pressure`);
    }
    // TD defense similarity (weight: 8%)
    const tdDefDiff = Math.abs(currentOpp.tdDef - pastOpp.tdDef);
    const tdDefScore = Math.max(0, 1 - tdDefDiff / 30);
    score += tdDefScore * 0.08;
    // Striking defense similarity (weight: 8%)
    const strDefDiff = Math.abs(currentOpp.strDef - pastOpp.strDef);
    const strDefScore = Math.max(0, 1 - strDefDiff / 30);
    score += strDefScore * 0.08;
    // Finish rate similarity (weight: 5%)
    const frDiff = Math.abs(currentOpp.finishRate - pastOpp.finishRate);
    const frScore = Math.max(0, 1 - frDiff / 0.4);
    score += frScore * 0.05;
    return { score: Math.min(1, score), reasons };
}
function findSimilarOpponentFights(db, currentOppDB, minSimilarity = 0.35, maxResults = 5) {
    const currentOppProfile = buildOpponentProfile(currentOppDB);
    const history = db.history || [];
    const matches = [];
    for (const fight of history) {
        if (fight.sigStr == null && fight.totStr == null)
            continue; // no stat data
        // Try to find this past opponent in allFighters (loaded data)
        const pastOppNorm = (normalizeName(fight.opp) || fight.opp).toLowerCase();
        const pastOppEntry = _fighterByNorm?.get(pastOppNorm) ?? null;
        let pastOppProfile = null;
        if (pastOppEntry?.db?.loaded) {
            pastOppProfile = buildOpponentProfile(pastOppEntry.db);
        }
        else {
            // Infer from in-fight stats
            pastOppProfile = inferOpponentProfileFromFight(fight);
        }
        if (!pastOppProfile)
            continue;
        const { score, reasons } = scoreOpponentSimilarity(currentOppProfile, pastOppProfile);
        if (score < minSimilarity)
            continue;
        // Calculate Betr FP for this fight
        const won = fight.result === 'win';
        const betrFP = calcFPForPlatform('betr', fight.sigStr, fight.totStr, fight.ctrlSecs, fight.timeSecs, fight.kd, fight.td, fight.rev, fight.sub, won, fight.method, fight.round);
        matches.push({
            oppName: fight.opp,
            similarity: score,
            matchReasons: reasons,
            fightResult: fight,
            betrFP,
        });
    }
    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxResults);
}
function buildSimilarOpponentPanel(fighterName, db, oppDB, fpLine, ssLine, tdLine, ctrlLine) {
    if (!db?.loaded || !oppDB?.loaded || !db.history?.length)
        return '';
    const matches = findSimilarOpponentFights(db, oppDB, 0.35, 5);
    if (matches.length < 1)
        return '';
    const currentOppProfile = buildOpponentProfile(oppDB);
    const archLabel = currentOppProfile.archetype
        ? formatCareerArchetypeLabel(currentOppProfile.archetype)
        : currentOppProfile.style;
    // Compute average performance vs similar opponents
    const withFP = matches.filter(m => m.betrFP != null);
    const withSS = matches.filter(m => m.fightResult.sigStr != null);
    const withTD = matches.filter(m => m.fightResult.td != null);
    const avgFP = withFP.length > 0 ? withFP.reduce((s, m) => s + m.betrFP, 0) / withFP.length : null;
    const avgSS = withSS.length > 0 ? withSS.reduce((s, m) => s + (m.fightResult.sigStr || 0), 0) / withSS.length : null;
    const avgTD = withTD.length > 0 ? withTD.reduce((s, m) => s + (m.fightResult.td || 0), 0) / withTD.length : null;
    const winRate = matches.length > 0 ? matches.filter(m => m.fightResult.result === 'win').length / matches.length : null;
    // Career averages for comparison
    const careerFP = db.avgFP_betr ?? db.avgFP ?? null;
    const careerSS = db.avgSigStr ?? null;
    const careerTD = db.avgTDperFight ?? null;
    // Delta arrows
    const deltaIcon = (similar, career) => {
        if (similar == null || career == null)
            return '';
        const diff = similar - career;
        const pct = career > 0 ? (diff / career * 100) : 0;
        if (Math.abs(pct) < 5)
            return '<span style="color:var(--text4)"> ≈</span>';
        return diff > 0
            ? `<span style="color:#1bdc88"> ↑${Math.abs(pct).toFixed(0)}%</span>`
            : `<span style="color:#ff6c88"> ↓${Math.abs(pct).toFixed(0)}%</span>`;
    };
    // Over-rate vs lines
    let fpOverHtml = '';
    if (fpLine != null && withFP.length >= 2) {
        const overCount = withFP.filter(m => m.betrFP > fpLine).length;
        const pct = Math.round(overCount / withFP.length * 100);
        const color = pct >= 60 ? '#1bdc88' : pct <= 40 ? '#ff6c88' : 'var(--text2)';
        fpOverHtml = `<div style="font-size:9.5px;color:${color};margin-top:2px">vs similar: ${overCount}/${withFP.length} (${pct}%) went OVER ${fpLine} FP</div>`;
    }
    let ssOverHtml = '';
    if (ssLine != null && withSS.length >= 2) {
        const overCount = withSS.filter(m => (m.fightResult.sigStr || 0) > ssLine).length;
        const pct = Math.round(overCount / withSS.length * 100);
        const color = pct >= 60 ? '#1bdc88' : pct <= 40 ? '#ff6c88' : 'var(--text2)';
        ssOverHtml = `<div style="font-size:9.5px;color:${color};margin-top:2px">vs similar: ${overCount}/${withSS.length} (${pct}%) went OVER ${ssLine} SS</div>`;
    }
    let tdOverHtml = '';
    if (tdLine != null && withTD.length >= 2) {
        const overCount = withTD.filter(m => (m.fightResult.td || 0) > tdLine).length;
        const pct = Math.round(overCount / withTD.length * 100);
        const color = pct >= 60 ? '#1bdc88' : pct <= 40 ? '#ff6c88' : 'var(--text2)';
        tdOverHtml = `<div style="font-size:9.5px;color:${color};margin-top:2px">vs similar: ${overCount}/${withTD.length} (${pct}%) went OVER ${tdLine} TD</div>`;
    }
    let ctrlOverHtml = '';
    // ctrlLine is in minutes (decimal, e.g. 5.5 = 5:30); fightResult.ctrlSecs is in seconds.
    const withCtrl = matches.filter(m => m.fightResult.ctrlSecs != null);
    if (ctrlLine != null && withCtrl.length >= 2) {
        const lineSecs = ctrlLine * 60;
        const overCount = withCtrl.filter(m => (m.fightResult.ctrlSecs || 0) > lineSecs).length;
        const pct = Math.round(overCount / withCtrl.length * 100);
        const color = pct >= 60 ? '#1bdc88' : pct <= 40 ? '#ff6c88' : 'var(--text2)';
        const mm = Math.floor(lineSecs / 60);
        const ss = Math.round(lineSecs % 60);
        const ctrlLabel = `${mm}:${String(ss).padStart(2, '0')}`;
        ctrlOverHtml = `<div style="font-size:9.5px;color:${color};margin-top:2px">vs similar: ${overCount}/${withCtrl.length} (${pct}%) went OVER ${ctrlLabel} Ctrl</div>`;
    }
    // Build fight rows
    const fightRows = matches.map(m => {
        const sim = Math.round(m.similarity * 100);
        const simColor = sim >= 70 ? '#1bdc88' : sim >= 50 ? 'var(--gold)' : 'var(--text3)';
        const resultBadge = m.fightResult.result === 'win'
            ? '<span style="color:#1bdc88;font-weight:700">W</span>'
            : '<span style="color:#ff6c88;font-weight:700">L</span>';
        const method = m.fightResult.method || '—';
        const round = m.fightResult.round ? `R${m.fightResult.round}` : '';
        const fp = m.betrFP != null ? m.betrFP.toFixed(1) : '—';
        const ss = m.fightResult.sigStr != null ? String(m.fightResult.sigStr) : '—';
        const td = m.fightResult.td != null ? String(m.fightResult.td) : '—';
        const kd = m.fightResult.kd != null && m.fightResult.kd > 0 ? String(m.fightResult.kd) : '';
        const ctrl = m.fightResult.ctrlSecs != null && m.fightResult.ctrlSecs > 0
            ? `${Math.floor(m.fightResult.ctrlSecs / 60)}:${String(m.fightResult.ctrlSecs % 60).padStart(2, '0')}`
            : '';
        const reasonTags = m.matchReasons.slice(0, 3).map(r => `<span class="sim-opp-reason-tag">${r}</span>`).join('');
        // FP line comparison badge
        let fpBadge = '';
        if (fpLine != null && m.betrFP != null) {
            fpBadge = m.betrFP > fpLine
                ? `<span style="color:#1bdc88;font-size:8px;margin-left:3px">▲</span>`
                : `<span style="color:#ff6c88;font-size:8px;margin-left:3px">▼</span>`;
        }
        return `<div class="sim-opp-fight-row">
      <div class="sim-opp-fight-header">
        <span class="sim-opp-score" style="color:${simColor}">${sim}%</span>
        <span class="sim-opp-name">${resultBadge} vs ${m.oppName}</span>
        <span class="sim-opp-method">${method} ${round}</span>
      </div>
      <div class="sim-opp-stats">
        <span class="sim-opp-stat">FP: <b>${fp}</b>${fpBadge}</span>
        <span class="sim-opp-stat">SS: <b>${ss}</b></span>
        <span class="sim-opp-stat">TD: <b>${td}</b></span>
        ${kd ? `<span class="sim-opp-stat">KD: <b>${kd}</b></span>` : ''}
        ${ctrl ? `<span class="sim-opp-stat">Ctrl: <b>${ctrl}</b></span>` : ''}
      </div>
      <div class="sim-opp-reasons">${reasonTags}</div>
    </div>`;
    }).join('');
    // Summary averages row
    const avgRow = `<div class="sim-opp-averages">
    <div class="sim-opp-avg-title">AVG vs SIMILAR (${matches.length} fights)${winRate != null ? ` · Win rate: ${Math.round(winRate * 100)}%` : ''}</div>
    <div class="sim-opp-avg-stats">
      ${avgFP != null ? `<span class="sim-opp-stat">FP: <b>${avgFP.toFixed(1)}</b>${deltaIcon(avgFP, careerFP)}</span>` : ''}
      ${avgSS != null ? `<span class="sim-opp-stat">SS: <b>${avgSS.toFixed(1)}</b>${deltaIcon(avgSS, careerSS)}</span>` : ''}
      ${avgTD != null ? `<span class="sim-opp-stat">TD: <b>${avgTD.toFixed(1)}</b>${deltaIcon(avgTD, careerTD)}</span>` : ''}
    </div>
  </div>`;
    return `<div class="detail-panel soh-panel">
    <div class="detail-panel-title">Similar Opponent History</div>
    <div style="font-size:9.5px;color:var(--text3);margin-bottom:6px">
      Current opponent profile: <span style="color:var(--text2)">${archLabel} · ${currentOppProfile.style} · ${currentOppProfile.slpm.toFixed(1)} SLpM · ${currentOppProfile.tdAvgPerFight.toFixed(1)} TD/fight · ${currentOppProfile.tdDef}% TD def</span>
    </div>
    ${avgRow}
    ${fpOverHtml}${ssOverHtml}${tdOverHtml}${ctrlOverHtml}
    <div class="sim-opp-fights">${fightRows}</div>
  </div>`;
}
function buildOpponentQualityPanel(db, fpLine, ssLine) {
    if (!db?.loaded || !db.history?.length)
        return '';
    const withOppData = db.history.filter(h => h.oppStats?.sigStr != null);
    if (withOppData.length < 3)
        return '';
    const ACTIVE_THRESH = 25; // opponent landed >25 SS = active/dangerous fight
    const PASSIVE_THRESH = 12; // opponent landed <12 SS = passive/easy match
    const active = withOppData.filter(h => (h.oppStats.sigStr || 0) > ACTIVE_THRESH);
    const passive = withOppData.filter(h => (h.oppStats.sigStr || 0) < PASSIVE_THRESH);
    if (active.length < 2 && passive.length < 2)
        return '';
    const fpOverRate = (arr) => {
        if (!fpLine || !arr.length)
            return null;
        const v = arr.filter(h => h.fp != null);
        if (!v.length)
            return null;
        const over = v.filter(h => (h.fp || 0) > fpLine).length;
        return { over, total: v.length, pct: Math.round(over / v.length * 100) };
    };
    const ssOverRate = (arr) => {
        if (!ssLine || !arr.length)
            return null;
        const v = arr.filter(h => h.sigStr != null);
        if (!v.length)
            return null;
        const over = v.filter(h => (h.sigStr || 0) > ssLine).length;
        return { over, total: v.length, pct: Math.round(over / v.length * 100) };
    };
    const aFP = fpOverRate(active), pFP = fpOverRate(passive);
    const aSS = ssOverRate(active), pSS = ssOverRate(passive);
    // Quality flag: big drop in active vs passive signals softer schedule inflation
    let flagHtml = '';
    if (aFP && pFP) {
        const drop = pFP.pct - aFP.pct;
        if (drop >= 25 && pFP.pct >= 60) {
            flagHtml = `<div class="lean-point"><span class="lean-point-icon neg">↓</span><span>FP over rate drops ${drop}% vs active opponents (${aFP.pct}% active vs ${pFP.pct}% passive) — schedule quality concern</span></div>`;
        }
        else if (aFP.pct >= 65) {
            flagHtml = `<div class="lean-point"><span class="lean-point-icon pos">↑</span><span>Maintains ${aFP.pct}% FP over rate even vs active opponents — quality-adjusted edge</span></div>`;
        }
    }
    const buildRow = (label, r) => {
        if (!r)
            return '';
        const color = r.pct >= 60 ? '#48c78e' : r.pct <= 40 ? '#ff6464' : 'var(--text2)';
        return `<div class="style-hit-row">
      <span class="style-hit-label" style="width:80px;font-size:9px">${label}</span>
      <div class="style-hit-bar-wrap"><div class="style-hit-bar ${r.pct >= 55 ? 'over-bar' : 'under-bar'}" data-fill-width="${r.pct}%" style="width:0%"></div></div>
      <span class="style-hit-pct" style="color:${color}">${r.pct}%</span>
      <span class="style-hit-count">${r.over}/${r.total}</span>
    </div>`;
    };
    const activeRows = active.length >= 2 ? `<div class="oq-section-label">vs active opp (opp >${ACTIVE_THRESH} SS · ${active.length} fights)</div>${buildRow('FP over', aFP)}${buildRow('SS over', aSS)}` : '';
    const passiveRows = passive.length >= 2 ? `<div class="oq-section-label">vs passive opp (opp <${PASSIVE_THRESH} SS · ${passive.length} fights)</div>${buildRow('FP over', pFP)}${buildRow('SS over', pSS)}` : '';
    if (!activeRows && !passiveRows)
        return '';
    return `<div class="detail-panel oac-panel">
    <div class="detail-panel-title">Opponent Activity Context</div>
    ${flagHtml ? `<div class="lean-reason" style="margin-bottom:8px">${flagHtml}</div>` : ''}
    <div style="font-size:9px;color:var(--text4);margin-bottom:4px">${withOppData.length} fights with opponent stat data</div>
    ${activeRows}${passiveRows}
  </div>`;
}
// ── LINE MOVEMENT TIMELINE PANEL ──────────────────────────────────────────
function buildLineTimelinePanel(f) {
    const stats = [
        { label: 'FP', stat: 'fp', platLines: [['p6', f.line_p6], ['ud', f.line_ud], ['pp', f.line_pp], ['betr', f.line_betr]] },
        { label: 'SS', stat: 'ss', platLines: [['p6', f.line_p6_ss], ['ud', f.line_ud_ss], ['pp', f.line_pp_ss], ['betr', f.line_betr_ss], ['dk', f.line_dk_ss]] },
        { label: 'TD', stat: 'td', platLines: [['p6', f.line_p6_td], ['ud', f.line_ud_td], ['pp', f.line_pp_td], ['betr', f.line_betr_td], ['dk', f.line_dk_td]] },
    ];
    const platColors = { p6: '#00d4ff', ud: '#00e87a', pp: '#a855f7', betr: '#f8c64a', dk: '#4a9eff' };
    const platLabels = { p6: 'P6', ud: 'UD', pp: 'PP', betr: 'BT', dk: 'DK' };
    let chartsHtml = '';
    let hasAny = false;
    for (const { label, stat, platLines } of stats) {
        const history = getLineHistoryForFighter(f.name, stat);
        if (history.length < 2)
            continue;
        hasAny = true;
        // Collect all values to compute range
        let allVals = [];
        for (const pt of history) {
            for (const v of Object.values(pt.v))
                allVals.push(v);
        }
        const openKey = openingLineKey('p6', stat, f.name);
        const openVal = _openingLines.get(openKey);
        if (openVal != null)
            allVals.push(openVal);
        const minVal = Math.min(...allVals);
        const maxVal = Math.max(...allVals);
        const range = maxVal - minVal || 1;
        const padding = range * 0.15;
        const chartMin = minVal - padding;
        const chartMax = maxVal + padding;
        const chartRange = chartMax - chartMin || 1;
        // Time range
        const tMin = history[0].t;
        const tMax = history[history.length - 1].t;
        const tRange = tMax - tMin || 1;
        // Build dots and connecting lines per platform
        const activePlats = new Set();
        for (const pt of history) {
            for (const plat of Object.keys(pt.v))
                activePlats.add(plat);
        }
        let dotsHtml = '';
        for (const plat of activePlats) {
            const color = platColors[plat] || '#888';
            let prevX = null;
            let prevY = null;
            for (let i = 0; i < history.length; i++) {
                const pt = history[i];
                const val = pt.v[plat];
                if (val == null)
                    continue;
                const x = ((pt.t - tMin) / tRange) * 100;
                const y = ((val - chartMin) / chartRange) * 100;
                // Connecting line from previous point
                if (prevX != null && prevY != null) {
                    const lineWidth = x - prevX;
                    dotsHtml += `<div class="line-timeline-step" style="left:${prevX}%;bottom:${prevY}%;width:${lineWidth}%;background:${color};opacity:0.4"></div>`;
                    // Vertical connector if value changed
                    if (Math.abs(y - prevY) > 0.5) {
                        const stepBottom = Math.min(y, prevY);
                        const stepHeight = Math.abs(y - prevY);
                        dotsHtml += `<div class="line-timeline-vstep" style="left:${x}%;bottom:${stepBottom}%;height:${stepHeight}%;background:${color};opacity:0.4"></div>`;
                    }
                }
                dotsHtml += `<div class="line-timeline-dot" style="left:${x}%;bottom:${y}%;background:${color}" title="${platLabels[plat] || plat}: ${val} @ ${new Date(pt.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}"></div>`;
                prevX = x;
                prevY = y;
            }
        }
        // Opening line marker
        let openMarkerHtml = '';
        if (openVal != null) {
            const openY = ((openVal - chartMin) / chartRange) * 100;
            openMarkerHtml = `<div class="line-timeline-open-marker" style="bottom:${openY}%"><span class="line-timeline-open-label">${openVal}</span></div>`;
        }
        // Current values and delta
        const lastPt = history[history.length - 1];
        const currentVals = Object.entries(lastPt.v).map(([p, v]) => `${platLabels[p] || p}: ${v}`).join(' · ');
        const firstPt = history[0];
        // Compute max delta across platforms that exist in both first and last
        let maxDelta = 0;
        let deltaDisplay = '—';
        for (const plat of Object.keys(lastPt.v)) {
            const firstVal = firstPt.v[plat];
            const lastVal = lastPt.v[plat];
            if (firstVal != null && lastVal != null) {
                const d = lastVal - firstVal;
                if (Math.abs(d) > Math.abs(maxDelta))
                    maxDelta = d;
            }
        }
        if (maxDelta !== 0) {
            deltaDisplay = `<span class="${maxDelta > 0 ? 'delta-rise' : 'delta-drop'}">${maxDelta > 0 ? '+' : ''}${maxDelta.toFixed(1)}</span>`;
        }
        const changeCount = history.length - 1;
        const timeFirst = new Date(tMin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const timeLast = new Date(tMax).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateFirst = new Date(tMin).toLocaleDateString([], { month: 'short', day: 'numeric' });
        // Y-axis labels
        const yLabels = `<span class="line-timeline-y-label" style="bottom:0">${chartMin.toFixed(1)}</span><span class="line-timeline-y-label" style="bottom:100%">${chartMax.toFixed(1)}</span>`;
        // Platform legend
        const legendHtml = [...activePlats].map(p => `<span style="color:${platColors[p] || '#888'}">${platLabels[p] || p}</span>`).join(' · ');
        chartsHtml += `
      <div class="line-timeline-stat">
        <div class="line-timeline-stat-header">${label} <span style="font-weight:400;opacity:0.5;margin-left:6px">${legendHtml}</span></div>
        <div class="line-timeline-chart">
          ${yLabels}
          ${openMarkerHtml}
          ${dotsHtml}
        </div>
        <div class="line-timeline-summary">
          <span>${openVal != null ? `Open: ${openVal}` : ''}</span>
          <span>Now: ${currentVals}</span>
          <span>Delta: ${deltaDisplay}</span>
          <span>${changeCount} change${changeCount !== 1 ? 's' : ''}</span>
          <span style="opacity:0.5">${dateFirst} ${timeFirst}–${timeLast}</span>
        </div>
      </div>`;
    }
    if (!hasAny)
        return '';
    return `<div class="detail-panel line-timeline-panel">
    <div class="detail-panel-title">Line Movement Timeline</div>
    ${chartsHtml}
  </div>`;
}
// ── LINE SHOP MODAL ────────────────────────────────────────────────────────
function generateLineShopModal() {
    if (!allFighters.length) {
        showToast('No fighters loaded');
        return;
    }
    const fmtCell = (val, vals, plat, leanDir, compatVals) => {
        if (val == null)
            return `<span class="ls-empty">—</span>`;
        // If a compatible-vals set was supplied and this value isn't in it, it's a
        // different scale (e.g. Underdog per-round vs. total-fight).  Show it muted.
        if (compatVals && !compatVals.includes(val)) {
            const mismatchTitle = plat === 'PP' ? 'PrizePicks uses different FP scoring — excluded from spread' : 'Different scale — excluded from spread';
            return `<span class="ls-cell-val ls-scale-mismatch" title="${mismatchTitle}"><span class="ls-plat-tag">${plat}</span>~${val}</span>`;
        }
        let cls = 'ls-neutral';
        if (vals.length >= 2) {
            const mx = Math.max(...vals);
            const mn = Math.min(...vals);
            if (mx > mn) {
                if (leanDir === 'over')
                    cls = val === mn ? 'ls-best' : val === mx ? 'ls-worst' : 'ls-neutral';
                else if (leanDir === 'under')
                    cls = val === mx ? 'ls-best' : val === mn ? 'ls-worst' : 'ls-neutral';
                // No lean: treat lowest line as best value (easiest over) — green/red like leaned props
                else
                    cls = val === mn ? 'ls-best' : val === mx ? 'ls-worst' : 'ls-neutral';
            }
        }
        return `<span class="ls-cell-val ${cls}"><span class="ls-plat-tag">${plat}</span>${val}</span>`;
    };
    const spreadChip = (spread) => {
        if (spread === 0)
            return `<span class="ls-spread-low">—</span>`;
        if (spread >= 2.5)
            return `<span class="ls-spread-chip ls-spread-high">${spread}</span>`;
        return `<span class="ls-spread-chip ls-spread-med">${spread}</span>`;
    };
    // Filter values that are on a compatible scale (within 3x of median).
    // Prevents a platform using per-round or differently-scoped props from
    // inflating the spread vs. platforms using total-fight stats.
    // Filter values that are on a compatible scale (within 45%–220% of median).
    // Prevents a platform using per-round or differently-scoped props from
    // inflating the spread vs. platforms using total-fight stats.
    const compatibleFilter = (vals) => {
        if (vals.length < 2)
            return vals;
        const sorted = [...vals].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return vals.filter(v => median > 0 && v >= median * 0.45 && v <= median * 2.2);
    };
    const rows = allFighters.map(f => {
        const fps = [f.line_p6, f.line_ud, f.line_betr].filter(v => v != null); // PP excluded: different scoring system
        const sss = [f.line_p6_ss, f.line_ud_ss, f.line_betr_ss, f.line_pp_ss, f.line_dk_ss].filter(v => v != null);
        const tds = [f.line_p6_td, f.line_ud_td, f.line_betr_td, f.line_pp_td, f.line_dk_td].filter(v => v != null);
        const fps_compat = compatibleFilter(fps);
        const sss_compat = compatibleFilter(sss);
        const tds_compat = compatibleFilter(tds);
        const spread = (vals) => vals.length >= 2 ? parseFloat((Math.max(...vals) - Math.min(...vals)).toFixed(1)) : 0;
        const fp_sp = spread(fps_compat), ss_sp = spread(sss_compat), td_sp = spread(tds_compat);
        const leanDir = (f.lean?.lean === 'over' || f.lean?.lean === 'under') ? f.lean.lean : 'none';
        const ssLeanDir = (f.lean_ss?.lean === 'over' || f.lean_ss?.lean === 'under') ? f.lean_ss.lean : leanDir;
        const tdLeanDir = (f.lean_td?.lean === 'over' || f.lean_td?.lean === 'under') ? f.lean_td.lean : leanDir;
        return { f, fps, fps_compat, sss, sss_compat, tds, tds_compat, fp_sp, ss_sp, td_sp, max_sp: Math.max(fp_sp, ss_sp, td_sp), leanDir, ssLeanDir, tdLeanDir };
    }).sort((a, b) => b.max_sp - a.max_sp);
    const rowsHtml = rows.map(({ f, fps, fps_compat, sss, sss_compat, tds, tds_compat, fp_sp, ss_sp, td_sp, leanDir, ssLeanDir, tdLeanDir }) => {
        const conf = f.lean?.conf || 0;
        const leanChip = leanDir !== 'none'
            ? `<span class="ls-lean-chip ls-lean-${leanDir}">${leanDir === 'over' ? '▲' : '▼'} ${leanDir.toUpperCase()}${conf > 0 ? ` ${conf}%` : ''}</span>`
            : '';
        return `<tr>
      <td class="lineshop-fighter-name">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">${f.name}${leanChip}</div>
        ${f.opponent ? `<div style="font-size:9px;color:var(--text4)">vs ${f.opponent}</div>` : ''}
      </td>
      <td><div class="lineshop-stat-group">
        ${fmtCell(f.line_p6, fps_compat, 'P6', leanDir, fps_compat)}
        ${fmtCell(f.line_ud, fps_compat, 'UD', leanDir, fps_compat)}
        ${fmtCell(f.line_betr, fps_compat, 'BT', leanDir, fps_compat)}
        ${fmtCell(f.line_pp, fps_compat, 'PP', leanDir, [])}
      </div></td>
      <td>${spreadChip(fp_sp)}</td>
      <td><div class="lineshop-stat-group">
        ${fmtCell(f.line_p6_ss, sss_compat, 'P6', ssLeanDir, sss_compat)}
        ${fmtCell(f.line_ud_ss, sss_compat, 'UD', ssLeanDir, sss_compat)}
        ${fmtCell(f.line_betr_ss, sss_compat, 'BT', ssLeanDir, sss_compat)}
        ${fmtCell(f.line_pp_ss, sss_compat, 'PP', ssLeanDir, sss_compat)}
        ${fmtCell(f.line_dk_ss, sss_compat, 'DK', ssLeanDir, sss_compat)}
      </div></td>
      <td>${spreadChip(ss_sp)}</td>
      <td><div class="lineshop-stat-group">
        ${fmtCell(f.line_p6_td, tds_compat, 'P6', tdLeanDir, tds_compat)}
        ${fmtCell(f.line_ud_td, tds_compat, 'UD', tdLeanDir, tds_compat)}
        ${fmtCell(f.line_betr_td, tds_compat, 'BT', tdLeanDir, tds_compat)}
        ${fmtCell(f.line_pp_td, tds_compat, 'PP', tdLeanDir, tds_compat)}
        ${fmtCell(f.line_dk_td, tds_compat, 'DK', tdLeanDir, tds_compat)}
      </div></td>
      <td>${spreadChip(td_sp)}</td>
    </tr>`;
    }).join('');
    const content = document.getElementById('lineShopContent');
    const modal = document.getElementById('lineShopModal');
    if (!content || !modal)
        return;
    const biggestSpreads = rows.filter(r => r.max_sp >= 2.5).length;
    const sub = document.getElementById('lineShopSub');
    if (sub)
        sub.textContent = `${rows.length} fighters · ${biggestSpreads} with spread ≥ 2.5 · sorted by biggest discrepancy`;
    content.innerHTML = `
    <div class="lineshop-legend">
      <span class="lineshop-legend-item"><span class="ls-cell-val ls-best" style="display:inline-flex;flex-direction:column;align-items:center;padding:3px 7px 2px;border-radius:3px"><span class="ls-plat-tag">P6</span>87.5</span> best book for lean</span>
      <span class="lineshop-legend-item"><span class="ls-cell-val ls-worst" style="display:inline-flex;flex-direction:column;align-items:center;padding:3px 7px 2px;border-radius:3px"><span class="ls-plat-tag">UD</span>103.0</span> worst book</span>
      <span class="lineshop-legend-item"><span class="ls-lean-chip ls-lean-over">▲ OVER 72%</span></span>
      <span class="lineshop-legend-item"><span class="ls-lean-chip ls-lean-under">▼ UNDER 68%</span></span>
      <span style="color:var(--text4);font-size:10px">OVER = lowest line is best · UNDER = highest line is best · no lean = green/red by value</span>
    </div>
    ${_platformBiasCache && _platformBiasCache.length >= 2 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;padding:8px 10px;background:var(--surface2);border-radius:6px;border-left:3px solid var(--cyan)">
      <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-right:4px;align-self:center">Platform Bias</span>
      ${_platformBiasCache.filter(b => b.total >= 3 && Math.abs(b.avgEdge) >= 0.5).sort((a, b) => Math.abs(b.avgEdge) - Math.abs(a.avgEdge)).slice(0, 8).map(b => {
        const plat = PLAT_LABEL_MAP[b.platform] || b.platform.toUpperCase();
        const st = b.propType === 'FightTime' ? 'FT' : b.propType === 'Fantasy' ? 'FP' : b.propType === 'Fantasy_PP' ? 'FP·PP' : b.propType;
        const col = b.avgEdge > 0 ? 'var(--green)' : 'var(--red)';
        const dir = b.avgEdge > 0 ? 'soft OVER' : 'soft UNDER';
        return `<span style="font-size:10px;padding:3px 7px;border-radius:4px;background:var(--surface)" title="${plat} ${st}: avg edge ${b.avgEdge > 0 ? '+' : ''}${b.avgEdge} (${dir}) · n=${b.total}"><span style="color:var(--text-muted)">${plat}</span> <span style="font-weight:700">${st}</span> <span style="color:${col};font-weight:700">${b.avgEdge > 0 ? '+' : ''}${b.avgEdge}</span></span>`;
    }).join('')}
    </div>` : ''}
    <table class="lineshop-table">
      <thead><tr>
        <th style="text-align:left">FIGHTER + LEAN</th>
        <th>FP LINES</th><th>SPREAD</th>
        <th>SS LINES</th><th>SPREAD</th>
        <th>TD LINES</th><th>SPREAD</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
    modal.classList.remove('is-hidden');
}
// AI × CLV Phase 2 — market-validation boost.
// Reads the live open→current drift for this fighter/propType/platform (unresolved rows only).
// If the market has moved in the AI lean's direction → +5 confidence (market validates the pick).
// If the market has moved against the lean → −5 (market disagrees). Zero drift = no adjustment.
// Returns null when no drift data is available or the lean has no direction.
function getClvBoost(f, el) {
    if (!_fighterClvDrift)
        return null;
    if (el.lean !== 'over' && el.lean !== 'under')
        return null;
    const key = (normalizeName(f.name) || f.name).toLowerCase();
    const byProp = _fighterClvDrift.get(key);
    if (!byProp)
        return null;
    const propType = el._source === 'fp' ? 'Fantasy' : el._source === 'ft' ? 'FightTime' : el._source.toUpperCase();
    const byPlatform = byProp[propType];
    if (!byPlatform)
        return null;
    const platform = normalizeArchivePlatformLabel(activePlatformLabel(f)) || '';
    // Prefer the active platform; fall back to any available platform entry for this prop.
    let entry = platform ? byPlatform[platform] : undefined;
    let usedPlatform = platform;
    if (!entry) {
        const first = Object.entries(byPlatform)[0];
        if (!first)
            return null;
        usedPlatform = first[0];
        entry = first[1];
    }
    const marketDelta = entry.line - entry.openLine;
    if (marketDelta === 0)
        return null;
    const aligned = (el.lean === 'over' && marketDelta > 0) || (el.lean === 'under' && marketDelta < 0);
    return {
        delta: aligned ? 5 : -5,
        marketDelta,
        openLine: entry.openLine,
        line: entry.line,
        platform: usedPlatform,
    };
}
// Lazy-render: the .fighter-detail HTML for each row is built on first expand
// instead of at row creation. Builder closures captured here, keyed by row el.
// Cuts initial render from ~1000ms to ~250ms by deferring detail innerHTML.
const _pendingDetailBuilders = new WeakMap();
// Set of "platform:stat" keys present somewhere on the active slate. Populated
// by the render loop before iterating fighters; lineCell skips slots not in
// this set so dead columns don't take horizontal space.
let _slatePresentSlots = null;
function buildFighterRow(f, oppEntry, fightIndex = 0) {
    _h2hFighterMap.set(f.name.toLowerCase(), f);
    const db = f.db || {};
    const lean = getEffectiveLean(f);
    const leanEv = computeFighterEV(f, lean);
    const leanEvDetail = computeDetailedEV(f, lean);
    const perBookEv = computePerBookEV(f, lean);
    const leanClass = lean.lean === 'over' ? 'lean-over' : lean.lean === 'under' ? 'lean-under' : lean.lean === 'push' ? 'lean-push' : 'lean-none';
    const leanSuffix = lean._label || '';
    const leanText = lean.lean === 'over' ? `▲ OVER${leanSuffix}` : lean.lean === 'under' ? `▼ UNDER${leanSuffix}` : lean.lean === 'push' ? '~ PUSH' : db.loaded ? '—' : '⟳';
    const leanRGB = lean.lean === 'over' ? '0,232,122' : lean.lean === 'under' ? '255,58,96' : lean.lean === 'push' ? '240,192,64' : '50,58,88';
    const rawConfPct = lean.conf || 0;
    const clvBoost = rawConfPct > 0 ? getClvBoost(f, lean) : null;
    const confPct = clvBoost
        ? Math.max(25, Math.min(90, rawConfPct + clvBoost.delta))
        : rawConfPct;
    const recalConf = confPct > 0 ? getRecalibratedConfidence(confPct, lean._source) : null;
    const displayConf = recalConf != null ? recalConf : confPct;
    const leanGradStyle = lean.lean !== 'none' && displayConf > 0
        ? `background:linear-gradient(90deg,rgba(${leanRGB},0.22) ${displayConf}%,rgba(${leanRGB},0.05) ${displayConf}%);`
        : '';
    const gradeLetter = displayConf > 0 ? getConfidenceGrade(displayConf) : '';
    const displayGrade = gradeLetter ? ` ${gradeLetter}` : '';
    const gradeChipHtml = gradeLetter ? ` <span class="lean-grade-chip lean-grade-${gradeLetter.toLowerCase()}" title="Confidence grade ${gradeLetter}">${gradeLetter}</span>` : '';
    const clvTag = clvBoost
        ? (() => {
            const arrow = clvBoost.delta > 0 ? '↑' : '↓';
            const signed = `${clvBoost.delta > 0 ? '+' : ''}${clvBoost.delta}`;
            const color = clvBoost.delta > 0 ? 'var(--green)' : 'var(--red)';
            const driftStr = `${clvBoost.marketDelta > 0 ? '+' : ''}${clvBoost.marketDelta.toFixed(1)}`;
            const note = clvBoost.delta > 0
                ? `Market validates ${lean.lean?.toUpperCase()}: line drifted ${driftStr} from open (${clvBoost.openLine}→${clvBoost.line}) on ${clvBoost.platform}.`
                : `Market disagrees with ${lean.lean?.toUpperCase()}: line drifted ${driftStr} from open (${clvBoost.openLine}→${clvBoost.line}) on ${clvBoost.platform}.`;
            return ` <span style="color:${color};font-size:9px;font-weight:700" title="${note}">${arrow}${signed}</span>`;
        })()
        : '';
    const confInlineLabel = confPct > 0
        ? recalConf != null && recalConf !== confPct
            ? `<span class="lean-conf-inline" title="Original: ${rawConfPct}% ${lean.confidenceGrade || ''} · Recalibrated from historical accuracy${clvBoost ? ` · AI×CLV ${clvBoost.delta > 0 ? '+' : ''}${clvBoost.delta}` : ''}">${displayConf}%${gradeChipHtml} <span style="font-size:9px;opacity:0.6">↻</span>${clvTag}</span>`
            : `<span class="lean-conf-inline" title="Confidence${lean.confidenceGrade ? ' ' + lean.confidenceGrade : ''}: ${rawConfPct}%${clvBoost ? ` · AI×CLV ${clvBoost.delta > 0 ? '+' : ''}${clvBoost.delta}` : ''}">${confPct}%${gradeChipHtml}${clvTag}</span>`
        : '';
    const activeLine = activePlatformLine(f);
    const platformLabel = activePlatformLabel(f);
    const showSource = (s) => !!sourceVisibility[s];
    function calcBestShop(candidates, leanDir) {
        const visible = candidates.filter(c => c.value != null && showSource(c.source));
        if (visible.length < 2 || !leanDir || leanDir === 'push' || leanDir === 'none')
            return null;
        const vals = visible.map(c => c.value);
        if (Math.max(...vals) - Math.min(...vals) < 0.5)
            return null;
        const best = leanDir === 'over'
            ? visible.reduce((b, c) => c.value < b.value ? c : b)
            : visible.reduce((b, c) => c.value > b.value ? c : b);
        return best.source;
    }
    const ssCandidates = [
        { source: 'p6', value: f.line_p6_ss },
        { source: 'ud', value: f.line_ud_ss },
        { source: 'pp', value: f.line_pp_ss },
        { source: 'betr', value: f.line_betr_ss },
        { source: 'dk', value: f.line_dk_ss },
    ].filter(c => c.value != null);
    const tdCandidates = [
        { source: 'p6', value: f.line_p6_td },
        { source: 'ud', value: f.line_ud_td },
        { source: 'pp', value: f.line_pp_td },
        { source: 'betr', value: f.line_betr_td },
        { source: 'dk', value: f.line_dk_td },
    ].filter(c => c.value != null);
    const ftCandidates = [
        { source: 'p6', value: f.line_p6_ft },
        { source: 'ud', value: f.line_ud_ft },
        { source: 'pp', value: f.line_pp_ft },
        { source: 'betr', value: f.line_betr_ft },
        { source: 'dk', value: f.line_dk_ft },
    ].filter(c => c.value != null);
    const ctrlCandidates = [
        { source: 'p6', value: f.line_p6_ctrl },
        { source: 'ud', value: f.line_ud_ctrl },
        { source: 'pp', value: f.line_pp_ctrl },
        { source: 'betr', value: f.line_betr_ctrl },
        { source: 'dk', value: f.line_dk_ctrl },
    ].filter(c => c.value != null);
    const bestSS = calcBestShop(ssCandidates, f.lean_ss?.lean ?? null);
    const bestTD = calcBestShop(tdCandidates, f.lean_td?.lean ?? null);
    const bestFT = calcBestShop(ftCandidates, f.lean_ft?.lean ?? null);
    const bestCTRL = calcBestShop(ctrlCandidates, f.lean_ctrl?.lean ?? null);
    const lineCell = (source, stat, value) => {
        if (!showSource(source))
            return '';
        if (value == null)
            return '';
        if (_slatePresentSlots && !_slatePresentSlots.has(`${source}:${stat}`))
            return '';
        const sourceLabel = source === 'p6' ? 'P6' : source === 'ud' ? 'UD' : source === 'pp' ? 'PP' : source === 'dk' ? 'DK' : 'BT';
        const _key = openingLineKey(source, stat, f.name);
        const openVal = _openingLines.get(_key);
        const openDeltaRaw = (openVal != null) ? parseFloat((value - openVal).toFixed(1)) : null;
        const openDelta = sanitizeDelta(stat, openDeltaRaw);
        const movementHtml = (openDelta != null && Math.abs(openDelta) >= 0.5)
            ? `<div class="line-movement ${openDelta > 0 ? 'mv-up' : 'mv-down'}" title="${openVal != null ? `Was: ${openVal}` : ''}">${openDelta > 0 ? '▲' : '▼'}${Math.abs(openDelta)}</div>`
            : '';
        const isBest = (stat === 'ss' && bestSS === source) ||
            (stat === 'td' && bestTD === source) ||
            (stat === 'ft' && bestFT === source) ||
            (stat === 'ctrl' && bestCTRL === source);
        const leanDir = stat === 'ss' ? f.lean_ss?.lean
            : stat === 'td' ? f.lean_td?.lean
                : stat === 'ft' ? f.lean_ft?.lean
                    : stat === 'ctrl' ? f.lean_ctrl?.lean
                        : null;
        const bestBadge = isBest
            ? `<div class="best-shop-badge" title="Best line for ${leanDir?.toUpperCase()} on ${sourceLabel}: ${value} vs other books">best</div>`
            : '';
        return `<div class="line-cell ${stat} src-${source}${isBest ? ' best-line' : ''}"><div class="line-platform"><span class="line-source-tag src-${source}">${sourceLabel}</span><span>${stat.toUpperCase()}</span></div><div class="line-value ${source}">${value}${movementHtml}</div>${bestBadge}</div>`;
    };
    function platformStatLine(entry, stat) {
        if (!entry)
            return null;
        const p6 = stat === 'ss' ? entry.line_p6_ss : stat === 'td' ? entry.line_p6_td : stat === 'ft' ? entry.line_p6_ft : entry.line_p6_ctrl;
        const ud = stat === 'ss' ? entry.line_ud_ss : stat === 'td' ? entry.line_ud_td : stat === 'ft' ? entry.line_ud_ft : entry.line_ud_ctrl;
        const pp = stat === 'ss' ? entry.line_pp_ss : stat === 'td' ? entry.line_pp_td : stat === 'ft' ? entry.line_pp_ft : entry.line_pp_ctrl;
        const dk = stat === 'ss' ? entry.line_dk_ss : stat === 'td' ? entry.line_dk_td : stat === 'ft' ? entry.line_dk_ft : entry.line_dk_ctrl;
        const bt = stat === 'ss' ? entry.line_betr_ss : stat === 'td' ? entry.line_betr_td : stat === 'ft' ? entry.line_betr_ft : entry.line_betr_ctrl;
        if (currentPlatform === 'pick6')
            return p6 ?? ud ?? pp ?? dk ?? bt ?? null;
        if (currentPlatform === 'underdog')
            return ud ?? p6 ?? pp ?? dk ?? bt ?? null;
        if (currentPlatform === 'prizepicks')
            return pp ?? p6 ?? ud ?? dk ?? bt ?? null;
        if (currentPlatform === 'draftkings_sportsbook')
            return dk ?? p6 ?? ud ?? pp ?? bt ?? null;
        return bt ?? p6 ?? ud ?? pp ?? dk ?? null;
    }
    const oppSsLine = platformStatLine(oppEntry, 'ss');
    const oppTdLine = platformStatLine(oppEntry, 'td');
    const oppFpLine = oppEntry ? activePlatformLine(oppEntry) : null;
    const oppName = oppEntry ? oppEntry.name : (f.opponent || null);
    debugLog(`SS/TD chart: ${f.name} → oppEntry="${oppEntry?.name ?? 'NOT FOUND'}" oppSsLine=${oppSsLine} oppTdLine=${oppTdLine} (opp ss p6=${oppEntry?.line_p6_ss ?? '—'} ud=${oppEntry?.line_ud_ss ?? '—'} pp=${oppEntry?.line_pp_ss ?? '—'} bt=${oppEntry?.line_betr_ss ?? '—'} | opp td p6=${oppEntry?.line_p6_td ?? '—'} ud=${oppEntry?.line_ud_td ?? '—'} pp=${oppEntry?.line_pp_td ?? '—'} bt=${oppEntry?.line_betr_td ?? '—'})`);
    function formatMinutesAsClock(minutes) {
        if (minutes == null || !Number.isFinite(minutes))
            return '—';
        const totalSeconds = Math.max(0, Math.round(minutes * 60));
        const mm = Math.floor(totalSeconds / 60);
        const ss = totalSeconds % 60;
        return `${mm}:${String(ss).padStart(2, '0')}`;
    }
    function buildHistoryBars(fights, valFn, lineFP, lineSS, lineTD, lineFT, labelFn, lineCTRL = null) {
        if (!fights?.length)
            return db.loaded
                ? '<div class="history-empty">No fight history found on UFCStats</div>'
                : '<div class="history-empty">⟳ Fetching from UFCStats...</div>';
        const recentRows = fights;
        const values = recentRows
            .map(valFn)
            .filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (!values.length) {
            return '<div class="history-empty">No stat samples available</div>';
        }
        const line = labelFn === 'fp' ? lineFP
            : labelFn === 'ss' ? lineSS
                : labelFn === 'td' ? lineTD
                    : labelFn === 'ft' ? lineFT
                        : lineCTRL;
        const maxVal = Math.max(...values, (line || 0) * 1.3, 1);
        // ── GLOW-UP 19: drilldown chart evolution ─────────────────────────────
        const fmtVal = (v) => (labelFn === 'ft' || labelFn === 'ctrl')
            ? formatMinutesAsClock(v)
            : (Number.isInteger(v) ? String(v) : v.toFixed(1));
        const escAttr = (x) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        // Panel meta header: hit rate vs line + sample average (with avg marker in bars)
        const avg = values.reduce((s2, v) => s2 + v, 0) / values.length;
        let metaHTML = '';
        if (line != null && line > 0) {
            const overs = values.filter(v => v > line).length;
            const rate = overs / values.length;
            const chipCls = rate >= 0.6 ? 'over' : rate <= 0.4 ? 'under' : 'mixed';
            const ratePct = Math.round(rate * 100);
            metaHTML = `<div class="hist-meta"><span class="hm-rate ${chipCls}">${overs}/${values.length} over line</span><span class="hm-track" title="${ratePct}% of fights cleared the line"><i style="width:${ratePct}%"></i></span><span class="hm-avg">avg ${fmtVal(avg)}</span></div>`;
        }
        const rowsHTML = recentRows.map((h) => {
            const val = valFn(h);
            if (val == null)
                return '';
            const pct = Math.min(100, (val / maxVal) * 100);
            const linePct = line ? Math.min(100, (line / maxVal) * 100) : null;
            const isOver = line ? val > line : true;
            const displayVal = fmtVal(val);
            // Result dot + tooltip payload (opp rows lack result/method — degrade gracefully)
            const res = (h.result || '').toLowerCase();
            const resCls = res === 'win' ? 'w' : res === 'loss' ? 'l' : '';
            const m = (h.method || '').toUpperCase();
            const methodAbbr = m.includes('KO') ? 'KO' : m.includes('SUB') ? 'SUB' : m.includes('DEC') ? 'DEC' : '';
            const resText = resCls
                ? `${resCls === 'w' ? 'W' : 'L'}${methodAbbr ? ' · ' + methodAbbr : ''}${h.round ? ' R' + h.round : ''}`
                : '';
            const delta = line != null && line > 0 ? val - line : null;
            const deltaText = delta == null ? '' : (labelFn === 'ft' || labelFn === 'ctrl')
                ? `${delta < 0 ? '-' : '+'}${formatMinutesAsClock(Math.abs(delta))}`
                : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
            return `<div class="history-bar-row has-tip" data-ht-opp="${escAttr(h.opp || '?')}" data-ht-res="${resCls}" data-ht-restext="${escAttr(resText)}" data-ht-date="${escAttr(h.date || '')}" data-ht-val="${escAttr(displayVal)}" data-ht-line="${line != null && line > 0 ? escAttr(fmtVal(line)) : ''}" data-ht-delta="${escAttr(deltaText)}" data-ht-over="${isOver ? '1' : '0'}">
        <div class="history-opp">${resCls ? `<span class="hist-res ${resCls}"></span>` : ''}${h.opp || '?'}</div>
        <div class="history-bar-wrap">
          <div class="history-bar-fill ${isOver ? 'over-line' : 'under-line'}" data-fill-width="${pct}%" style="width:0%"></div>
          ${linePct != null ? `<div class="line-marker" style="left:${linePct}%"></div>` : ''}
        </div>
        <div class="history-bar-val">${displayVal}</div>
      </div>`;
        }).join('');
        return metaHTML + rowsHTML;
    }
    const fights = db.history || [];
    const oppFights = db.oppHistory || [];
    const ssLine = platformStatLine(f, 'ss');
    const tdLine = platformStatLine(f, 'td');
    const ftLine = platformStatLine(f, 'ft');
    const ctrlLine = platformStatLine(f, 'ctrl');
    const primarySSLine = ssLine;
    const avgSS = db.avgSigStr ?? null;
    // ── Opponent-adjusted SS projection ───────────────────────────────────────
    // oppHistory[n].sigStr = SS landed ON the opponent in fight n = "SS allowed"
    const oppSSAllowedSamples = (oppEntry?.db?.oppHistory ?? [])
        .map(h => h.sigStr)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const oppAvgSSAllowed = oppSSAllowedSamples.length >= 3
        ? parseFloat((oppSSAllowedSamples.reduce((s, v) => s + v, 0) / oppSSAllowedSamples.length).toFixed(1))
        : null;
    // Classic attack/defense split: average fighter output with opponent's concession rate
    const projSS = (avgSS != null && oppAvgSSAllowed != null)
        ? parseFloat(((avgSS + oppAvgSSAllowed) / 2).toFixed(1))
        : null;
    const displaySS = projSS ?? avgSS;
    // ── 5R vs 3R normalization ─────────────────────────────────────────────────
    // Primary: scheduledRoundsMap populated from UFCStats upcoming card scrape.
    // Fallback: FT line > 12.5 min. Default: 3 rounds.
    const _ftLine = platformStatLine(f, 'ft');
    const _normFighterName = normalizeName(f.name);
    // Title-based main-event lookup (UFCStats event-page fight order is not reliable
    // for upcoming cards, so we identify the headliner by parsing the event title).
    const _headliner = findHeadlinerPair();
    const _isMainEventFighter = _normFighterName != null && _headliner != null &&
        (_headliner.f1 === _normFighterName || _headliner.f2 === _normFighterName);
    const isFiveRound = _isMainEventFighter;
    // Expected average actual fight durations (accounting for all finish rates in that format)
    const FIVE_ROUND_MINS = 15.0;
    const THREE_ROUND_MINS = 9.0;
    const histAvgMins = db.avgTimeMins ?? null;
    let roundNormFactor = 1.0;
    let roundNormTag = ''; // '5R↑' | '3R↓' | ''
    if (histAvgMins != null && histAvgMins >= 3) {
        if (isFiveRound) {
            // 5R fight: boost stats if fighter's history is shorter (typical 3R background)
            const raw = FIVE_ROUND_MINS / histAvgMins;
            if (raw > 1.08) {
                roundNormFactor = parseFloat(Math.min(1.8, raw).toFixed(3));
                roundNormTag = '5R↑';
            }
            else if (raw < 0.92) {
                roundNormFactor = parseFloat(Math.max(0.6, raw).toFixed(3));
                roundNormTag = '5R↓';
            }
        }
        else {
            // 3R fight: only reduce if fighter's history is notably longer (e.g. title fight veterans)
            const raw = THREE_ROUND_MINS / histAvgMins;
            if (raw < 0.92) {
                roundNormFactor = parseFloat(Math.max(0.6, raw).toFixed(3));
                roundNormTag = '3R↓';
            }
            // Never boost for 3R fights — the line already accounts for the fighter's finish rate
        }
    }
    // Round-normalize SS: apply factor after opp-adjustment, before delta calc
    const normDisplaySS = (displaySS != null && roundNormFactor !== 1.0)
        ? parseFloat((displaySS * roundNormFactor).toFixed(1))
        : null;
    const finalDisplaySS = normDisplaySS ?? displaySS;
    // ── Opponent-adjusted TD projection ──────────────────────────────────────────
    const avgTDraw = db.avgTDperFight ?? null;
    const oppTDAllowedSamples = (oppEntry?.db?.oppHistory ?? [])
        .map(h => h.td)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const oppAvgTDAllowed = oppTDAllowedSamples.length >= 3
        ? parseFloat((oppTDAllowedSamples.reduce((s, v) => s + v, 0) / oppTDAllowedSamples.length).toFixed(1))
        : null;
    const projTD = (avgTDraw != null && oppAvgTDAllowed != null)
        ? parseFloat(((avgTDraw + oppAvgTDAllowed) / 2).toFixed(1))
        : null;
    const displayTD = projTD ?? avgTDraw;
    const normDisplayTD = (displayTD != null && roundNormFactor !== 1.0)
        ? parseFloat((displayTD * roundNormFactor).toFixed(1))
        : null;
    const finalDisplayTD = normDisplayTD ?? displayTD;
    const ssDelta = (finalDisplaySS != null && primarySSLine != null) ? finalDisplaySS - primarySSLine : null;
    const ssDeltaText = ssDelta == null ? '—' : `${ssDelta > 0 ? '+' : ''}${ssDelta.toFixed(1)}`;
    const ssDeltaClass = ssDelta == null ? '' : ssDelta >= 0 ? 'delta-plus' : 'delta-minus';
    // ── SS variance band ───────────────────────────────────────────────────────
    const ssStdDev = db.ssStdDev ?? null;
    // Thresholds: ≤7 tight (predictable), 7–14 moderate, >14 volatile
    const ssSpreadColor = ssStdDev == null ? '' : ssStdDev <= 7 ? 'var(--green)' : ssStdDev <= 14 ? 'var(--amber)' : 'var(--red)';
    const ssSpreadLabel = ssStdDev != null ? `±${ssStdDev.toFixed(1)}` : '';
    const ssSpreadTip = ssStdDev == null ? '' :
        ssStdDev <= 7 ? `SS spread ±${ssStdDev.toFixed(1)} — tight (predictable output, high line confidence)` :
            ssStdDev <= 14 ? `SS spread ±${ssStdDev.toFixed(1)} — moderate variance (treat lean with some caution)` :
                `SS spread ±${ssStdDev.toFixed(1)} — volatile output (wide range, lean confidence is lower)`;
    const historyPlatform = currentPlatform === 'pick6' ? 'pick6' :
        currentPlatform === 'underdog' ? 'underdog' :
            currentPlatform === 'prizepicks' ? 'prizepicks' :
                'betr';
    const historyHTML = buildHistoryBars(fights, h => getFightFantasyValueForPlatform(h, historyPlatform), activeLine, ssLine, tdLine, ftLine, 'fp');
    const ssHistoryHTML = buildHistoryBars(fights, h => h.sigStr, activeLine, ssLine, tdLine, ftLine, 'ss');
    const ssR1Line = f.line_pp_ss_r1 ?? f.line_ud_ss_r1 ?? null;
    // R1 SS is offered by both PrizePicks and Underdog — label the panel by whichever
    // platform(s) actually supplied a line (PP is shown first when both exist).
    const ssR1Sources = [f.line_pp_ss_r1 != null ? 'PP' : null, f.line_ud_ss_r1 != null ? 'UD' : null].filter(Boolean);
    const ssR1Badge = ssR1Sources.length === 1 ? `${ssR1Sources[0]}-only` : ssR1Sources.join('+');
    const ssR1Meta = [
        f.line_pp_ss_r1 != null ? `PP R1 SS: ${f.line_pp_ss_r1}` : null,
        f.line_ud_ss_r1 != null ? `UD R1 SS: ${f.line_ud_ss_r1}` : null,
    ].filter(Boolean).join(' · ');
    const ssR1HistoryHTML = buildHistoryBars(fights, h => h.sigStrR1, ssR1Line, ssR1Line, null, null, 'ss');
    // Body/Leg sig strikes (Underdog + PrizePicks only). History bars use per-fight body/leg
    // landed from UFCStats (populated after the v50 cache re-fetch). The displayed line
    // follows the active platform — PrizePicks shows the PP line, every other selection
    // (Underdog and platforms without body/leg) defaults to UD-first — so clicking the UD
    // vs PP pill switches the number like the other props do. The meta footer still lists
    // both books so the alternate line stays visible.
    const platformBodyLegLine = (ud, pp) => {
        const udv = ud ?? null;
        const ppv = pp ?? null;
        return currentPlatform === 'prizepicks' ? (ppv ?? udv) : (udv ?? ppv);
    };
    const bodyLine = platformBodyLegLine(f.line_ud_ss_body, f.line_pp_ss_body);
    const bodySources = [f.line_ud_ss_body != null ? 'UD' : null, f.line_pp_ss_body != null ? 'PP' : null].filter(Boolean);
    const bodyBadge = bodySources.length === 1 ? `${bodySources[0]}-only` : bodySources.join('+');
    const bodyMeta = [f.line_ud_ss_body != null ? `UD Body: ${f.line_ud_ss_body}` : null, f.line_pp_ss_body != null ? `PP Body: ${f.line_pp_ss_body}` : null].filter(Boolean).join(' · ');
    const bodyHistoryHTML = buildHistoryBars(fights, h => h.sigStrBody, bodyLine, bodyLine, null, null, 'ss');
    const legLine = platformBodyLegLine(f.line_ud_ss_leg, f.line_pp_ss_leg);
    const legSources = [f.line_ud_ss_leg != null ? 'UD' : null, f.line_pp_ss_leg != null ? 'PP' : null].filter(Boolean);
    const legBadge = legSources.length === 1 ? `${legSources[0]}-only` : legSources.join('+');
    const legMeta = [f.line_ud_ss_leg != null ? `UD Leg: ${f.line_ud_ss_leg}` : null, f.line_pp_ss_leg != null ? `PP Leg: ${f.line_pp_ss_leg}` : null].filter(Boolean).join(' · ');
    const legHistoryHTML = buildHistoryBars(fights, h => h.sigStrLeg, legLine, legLine, null, null, 'ss');
    const tdHistoryHTML = buildHistoryBars(fights, h => h.td, activeLine, ssLine, tdLine, ftLine, 'td');
    const ftHistoryHTML = buildHistoryBars(fights, h => Number.isFinite(Number(h.timeSecs)) ? Number(h.timeSecs) / 60 : null, activeLine, ssLine, tdLine, ftLine, 'ft');
    const ctrlHistoryHTML = buildHistoryBars(fights, h => Number.isFinite(Number(h.ctrlSecs)) ? Number(h.ctrlSecs) / 60 : null, activeLine, ssLine, tdLine, ftLine, 'ctrl', ctrlLine);
    const oppCompareFpLine = oppFpLine;
    const oppCompareSsLine = oppSsLine;
    const oppCompareTdLine = oppTdLine;
    const oppCompareCtrlLine = platformStatLine(oppEntry, 'ctrl');
    const oppCompareSsR1Line = oppEntry?.line_pp_ss_r1 ?? oppEntry?.line_ud_ss_r1 ?? null;
    const oppSsR1Sources = [oppEntry?.line_pp_ss_r1 != null ? 'PP' : null, oppEntry?.line_ud_ss_r1 != null ? 'UD' : null].filter(Boolean);
    const oppSsR1Badge = oppSsR1Sources.length === 1 ? `${oppSsR1Sources[0]}-only` : oppSsR1Sources.join('+');
    const oppFPHistory = buildHistoryBars(oppFights, h => getFightFantasyValueForPlatform(h, historyPlatform), oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'fp');
    const oppSSHistory = buildHistoryBars(oppFights, h => h.sigStr, oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'ss');
    const oppSSR1History = buildHistoryBars(oppFights, h => h.sigStrR1, oppCompareSsR1Line, oppCompareSsR1Line, null, null, 'ss');
    // Opp body/leg "scored vs" charts — what this fighter's past opponents landed to
    // body/leg, vs the upcoming opponent's body/leg line (active-platform aware, same as
    // the self panels above). Mirrors opp R1 SS.
    const oppCompareBodyLine = platformBodyLegLine(oppEntry?.line_ud_ss_body, oppEntry?.line_pp_ss_body);
    const oppCompareLegLine = platformBodyLegLine(oppEntry?.line_ud_ss_leg, oppEntry?.line_pp_ss_leg);
    const oppBodySources = [oppEntry?.line_ud_ss_body != null ? 'UD' : null, oppEntry?.line_pp_ss_body != null ? 'PP' : null].filter(Boolean);
    const oppLegSources = [oppEntry?.line_ud_ss_leg != null ? 'UD' : null, oppEntry?.line_pp_ss_leg != null ? 'PP' : null].filter(Boolean);
    const oppBodyBadge = oppBodySources.length === 1 ? `${oppBodySources[0]}-only` : oppBodySources.join('+');
    const oppLegBadge = oppLegSources.length === 1 ? `${oppLegSources[0]}-only` : oppLegSources.join('+');
    const oppBodyHistory = buildHistoryBars(oppFights, h => h.sigStrBody, oppCompareBodyLine, oppCompareBodyLine, null, null, 'ss');
    const oppLegHistory = buildHistoryBars(oppFights, h => h.sigStrLeg, oppCompareLegLine, oppCompareLegLine, null, null, 'ss');
    const oppTDHistory = buildHistoryBars(oppFights, h => h.td, oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'td');
    const oppCTRLHistory = buildHistoryBars(oppFights, h => Number.isFinite(Number(h.ctrlSecs)) ? Number(h.ctrlSecs) / 60 : null, oppCompareFpLine, oppCompareSsLine, oppCompareTdLine, null, 'ctrl', oppCompareCtrlLine);
    const leanReasons = lean.reasons || [];
    const proReasons = leanReasons.filter((r) => r.icon === 'pos');
    const riskReasons = leanReasons.filter((r) => r.icon === 'neg');
    const neutralReasons = leanReasons.filter((r) => r.icon !== 'pos' && r.icon !== 'neg');
    // "Why this lean" — top 3 drivers in the direction of the lean. Pulls from
    // proReasons for OVER and riskReasons for UNDER (risks against OVER are pros
    // for UNDER). Position-in-array is the implicit ranking — each producer pushes
    // its strongest reason first.
    const driverReasons = lean.lean === 'over' ? proReasons
        : lean.lean === 'under' ? riskReasons
            : [];
    const topDrivers = driverReasons.slice(0, 3);
    const topDriversHTML = topDrivers.length > 0 ? `
    <div class="top-drivers ${lean.lean}">
      <div class="top-drivers-head">Why ${lean.lean === 'over' ? 'OVER' : 'UNDER'} · Top ${topDrivers.length} driver${topDrivers.length > 1 ? 's' : ''}</div>
      ${topDrivers.map((r, i) => `<div class="top-driver"><span class="top-driver-rank">${i + 1}</span><span class="top-driver-text">${r.text}</span></div>`).join('')}
    </div>` : '';
    const reasonRow = (r) => `<div class="lean-point">
    <span class="lean-point-icon ${r.icon === 'pos' ? 'pos' : r.icon === 'neg' ? 'neg' : ''}">${r.icon === 'pos' ? '↑' : r.icon === 'neg' ? '↓' : '→'}</span>
    <span>${r.text}</span>
  </div>`;
    const groupedReasonsHTML = `
    <div class="lean-reason-groups">
      <div class="lean-reason-col pro">
        <div class="lean-reason-head">Pro</div>
        ${proReasons.length ? proReasons.map(reasonRow).join('') : '<div class="lean-point muted"><span class="lean-point-icon">·</span><span>No strong pro edge</span></div>'}
      </div>
      <div class="lean-reason-col risk">
        <div class="lean-reason-head">Risk</div>
        ${riskReasons.length ? riskReasons.map(reasonRow).join('') : '<div class="lean-point muted"><span class="lean-point-icon">·</span><span>No major risk flag</span></div>'}
      </div>
      ${neutralReasons.length ? `<div class="lean-reason-col neutral"><div class="lean-reason-head">Context</div>${neutralReasons.slice(0, 2).map(reasonRow).join('')}</div>` : ''}
    </div>`;
    function panelConfidence(samples, line) {
        if (samples >= 7 && line != null)
            return { label: 'High', cls: 'high' };
        if (samples >= 4)
            return { label: 'Med', cls: 'med' };
        return { label: 'Low', cls: 'low' };
    }
    function panelBadge(conf) {
        return ` <span class="panel-confidence ${conf.cls}">${conf.label}</span>`;
    }
    const fpConf = panelConfidence(fights.length, activeLine);
    const ssConf = panelConfidence(fights.length, ssLine);
    const tdConf = panelConfidence(fights.length, tdLine);
    const ftConf = panelConfidence(fights.length, ftLine);
    const ctrlConf = panelConfidence(fights.length, ctrlLine);
    const oppFpConf = panelConfidence(oppFights.length, oppCompareFpLine);
    const oppSsConf = panelConfidence(oppFights.length, oppCompareSsLine);
    const oppTdConf = panelConfidence(oppFights.length, oppCompareTdLine);
    const oppCtrlConf = panelConfidence(oppFights.length, oppCompareCtrlLine);
    const leanConfBadge = panelBadge(lean.conf >= 72 && leanReasons.length >= 5 ? { label: 'High', cls: 'high' } : lean.conf >= 58 ? { label: 'Med', cls: 'med' } : { label: 'Low', cls: 'low' });
    const fpFloor = db.fpFloor != null ? db.fpFloor.toFixed(1) : '...';
    const fpCeiling = db.fpCeiling != null ? db.fpCeiling.toFixed(1) : '...';
    const fpConsistency = db.fpConsistency ?? null;
    const consistencyClass = fpConsistency != null ? (fpConsistency >= 70 ? 'consistency-high' : fpConsistency >= 45 ? 'consistency-mid' : 'consistency-low') : '';
    // #18: Peer Comparison Percentiles
    const peerPercentiles = calcPeerPercentileRanking(allFighters, f.name);
    const archetypeProfile = learnArchetypeProfile(f.name, db, oppEntry?.db || null, f.moneyline ?? null);
    const archetypeFullName = formatCareerArchetypeLabel(archetypeProfile.careerLabel);
    const archetypeDesc = describeCareerArchetype(archetypeProfile.careerLabel);
    const archetypeTitle = `${archetypeFullName} — ${archetypeDesc}${archetypeProfile.matchupAlert !== 'none' ? ` · Matchup alert: ${formatMatchupAlertLabel(archetypeProfile.matchupAlert)}` : ''}`;
    const archetypeBadgeHtml = `<span class="style-matchup-chip style-chip-default" title="${archetypeTitle.replace(/"/g, '&quot;')}" style="margin-left:6px;font-size:9px;padding:1px 6px">${shortCareerArchetypeLabel(archetypeProfile.careerLabel)}</span>`;
    const archetypeAlertHtml = archetypeProfile.matchupAlert !== 'none'
        ? `<span class="style-matchup-chip" title="${formatMatchupAlertLabel(archetypeProfile.matchupAlert)}" style="margin-left:4px;font-size:9px;padding:1px 6px;background:rgba(255,100,100,0.12);border-color:rgba(255,100,100,0.32);color:#ff8f8f">${formatMatchupAlertLabel(archetypeProfile.matchupAlert)}</span>`
        : '';
    const avgFPPercentileLabel = peerPercentiles.avgFPPercentile >= 75 ? '🔴' : peerPercentiles.avgFPPercentile >= 50 ? '🟡' : '🟢';
    const streakEmoji = db.streak?.type === 'hot' ? ' 🔥' : db.streak?.type === 'cold' ? ' ❄️' : '';
    // ── Sharp line movement detection ─────────────────────────────────────────
    // Flag any stat/platform where current line has moved ≥2 pts from opening
    const SHARP_THRESHOLD = 1.0;
    const sharpMoves = [];
    const _allStatLines = [
        ['p6', 'fp', f.line_p6], ['p6', 'ss', f.line_p6_ss], ['p6', 'td', f.line_p6_td], ['p6', 'ft', f.line_p6_ft],
        ['ud', 'fp', f.line_ud], ['ud', 'ss', f.line_ud_ss], ['ud', 'td', f.line_ud_td], ['ud', 'ft', f.line_ud_ft],
        ['pp', 'fp', f.line_pp], ['pp', 'ss', f.line_pp_ss], ['pp', 'td', f.line_pp_td], ['pp', 'ft', f.line_pp_ft],
        ['betr', 'fp', f.line_betr], ['betr', 'ss', f.line_betr_ss], ['betr', 'td', f.line_betr_td], ['betr', 'ft', f.line_betr_ft],
        ['dk', 'ss', f.line_dk_ss], ['dk', 'td', f.line_dk_td], ['dk', 'ft', f.line_dk_ft],
    ];
    for (const [plat, stat, current] of _allStatLines) {
        if (current == null)
            continue;
        const _smKey = openingLineKey(plat, stat, f.name);
        const opening = _openingLines.get(_smKey);
        if (opening == null)
            continue;
        const openDeltaRaw = parseFloat((current - opening).toFixed(1));
        const openDelta = sanitizeDelta(stat, openDeltaRaw) ?? 0;
        if (Math.abs(openDelta) >= SHARP_THRESHOLD) {
            const platLabel = plat === 'p6' ? 'P6' : plat === 'ud' ? 'UD' : plat === 'pp' ? 'PP' : plat === 'dk' ? 'DK' : 'BT';
            const statLabel = stat.toUpperCase();
            sharpMoves.push({ platLabel, statLabel, delta: openDelta, opening, current });
        }
    }
    sharpMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    // Deduplicate: if same stat moved on multiple books, keep largest move only
    const seenStat = new Set();
    const dedupedMoves = sharpMoves.filter(m => { if (seenStat.has(m.statLabel))
        return false; seenStat.add(m.statLabel); return true; });
    // Steam detection: same stat moved >=2pts across 2+ platforms
    const STEAM_THRESHOLD = 2.0;
    const statMoveCounts = new Map();
    for (const m of sharpMoves) {
        const arr = statMoveCounts.get(m.statLabel) || [];
        arr.push(m);
        statMoveCounts.set(m.statLabel, arr);
    }
    const steamStats = [];
    for (const [stat, moves] of statMoveCounts) {
        if (moves.length >= 2 && moves.some(m => Math.abs(m.delta) >= STEAM_THRESHOLD)) {
            steamStats.push(stat);
        }
    }
    const isSteam = steamStats.length > 0;
    // Reverse steam: line dropped then recovered (V-shape in history)
    const reverseSteamStats = [];
    for (const stat of ['fp', 'ss', 'td']) {
        const history = getLineHistoryForFighter(f.name, stat);
        if (history.length < 3)
            continue;
        for (const plat of ['p6', 'ud', 'pp', 'betr', 'dk']) {
            const vals = history.map(h => h.v[plat]).filter((v) => v != null);
            if (vals.length < 3)
                continue;
            const first = vals[0], min = Math.min(...vals), last = vals[vals.length - 1];
            if (first - min >= 1.0 && last - min >= 1.0 && Math.abs(last - first) < 0.5) {
                reverseSteamStats.push(stat.toUpperCase());
                break;
            }
        }
    }
    const isReverseSteam = reverseSteamStats.length > 0;
    const sharpBadgeHtml = (() => {
        if (!dedupedMoves.length && !isReverseSteam)
            return '';
        const parts = [];
        if (isSteam) {
            const dir = dedupedMoves[0]?.delta > 0 ? '📈' : '📉';
            parts.push(`<div class="sharp-move-badge steam-badge" title="Steam move (sharp money signal): ${steamStats.join(', ')} ${dedupedMoves[0]?.delta > 0 ? 'rising' : 'dropping'} ≥${STEAM_THRESHOLD}pts across multiple books — strong market move worth respecting">${dir} STEAM ${steamStats.join('/')}</div>`);
        }
        if (isReverseSteam) {
            parts.push(`<div class="sharp-move-badge reverse-steam-badge" title="Reverse steam: ${reverseSteamStats.join(', ')} dropped then recovered">↩ REVERSE ${reverseSteamStats.join('/')}</div>`);
        }
        if (dedupedMoves.length && !isSteam) {
            const top = dedupedMoves[0];
            const arrow = top.delta > 0 ? '📈' : '📉';
            const sign = top.delta > 0 ? '+' : '';
            const extra = dedupedMoves.length > 1 ? ` <span style="opacity:0.6">+${dedupedMoves.length - 1} more</span>` : '';
            const tipLines = dedupedMoves.map(m => `${m.platLabel} ${m.statLabel}: ${m.opening} → ${m.current} (${m.delta > 0 ? '+' : ''}${m.delta})`).join(' · ');
            parts.push(`<div class="sharp-move-badge" title="Line movement since opening: ${tipLines}">${arrow} ${top.statLabel} ${sign}${top.delta} <span class="sharp-move-book">${top.platLabel}</span>${extra}</div>`);
        }
        return parts.join('');
    })();
    const weightedAvg = db.avgFP_weighted ?? null;
    const platformAvgFP = activePlatformAvgFP(db);
    const weightedDiff = (weightedAvg != null && platformAvgFP != null) ? (weightedAvg - platformAvgFP) : null;
    const weightedArrow = weightedDiff == null ? '' : weightedDiff > 3 ? ' ↑' : weightedDiff < -3 ? ' ↓' : '';
    const mlAdjFP = calcMLAdjustedFP(db.history || [], f.moneyline ?? null);
    const mlAdjShift = (mlAdjFP != null && platformAvgFP != null) ? mlAdjFP - platformAvgFP : null;
    // ── Opponent-adjusted FP projection ──────────────────────────────────────────
    const oppFPAllowedSamples = (oppEntry?.db?.oppHistory ?? [])
        .map(h => h.fp)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const oppAvgFPAllowed = oppFPAllowedSamples.length >= 3
        ? parseFloat((oppFPAllowedSamples.reduce((s, v) => s + v, 0) / oppFPAllowedSamples.length).toFixed(1))
        : null;
    const baseAvgFP = mlAdjFP ?? platformAvgFP ?? null;
    const projFP = (baseAvgFP != null && oppAvgFPAllowed != null)
        ? parseFloat(((baseAvgFP + oppAvgFPAllowed) / 2).toFixed(1))
        : null;
    // Round-normalized display values (applied after mlAdj / proj calculations)
    const normDisplayFP = roundNormFactor !== 1.0
        ? parseFloat(((projFP ?? mlAdjFP ?? platformAvgFP ?? 0) * roundNormFactor).toFixed(1))
        : null;
    // normDisplaySS and normDisplayTD computed after projSS/avgTD are available (below)
    const _tw = trendWindow === 0 ? 9999 : trendWindow; // 9999 → all vals "recent" → delta=0 → flat → no chip
    const fpTrend = calcStatTrend(fights, h => getFightFantasyValueForPlatform(h, historyPlatform), 5, _tw);
    const ssTrend = calcStatTrend(fights, h => h.sigStr ?? null, 4, _tw);
    const tdTrend = calcStatTrend(fights, h => h.td ?? null, 0.5, _tw);
    const _twLabel = trendWindow === 0 ? 'Career' : `L${trendWindow}`;
    function trendChip(t, tooltip) {
        if (t.direction === null || t.direction === 'flat' || t.delta == null)
            return '';
        const sign = t.delta > 0 ? '+' : '';
        return `<span class="stat-trend-chip ${t.direction}" title="${tooltip}">${t.direction === 'up' ? '↑' : '↓'} ${_twLabel} ${sign}${t.delta}</span>`;
    }
    // Removed hitProb, badgeText, badgeCls, spikeEvent UI, and all oddsBadge/fantasy_over_odds/fantasy_under_odds logic
    const hitProb = null;
    const spikeEvent = null;
    function pickStatLine(entry, platform, stat) {
        if (platform === 'p6')
            return stat === 'ss' ? entry.line_p6_ss : stat === 'td' ? entry.line_p6_td : entry.line_p6_ctrl;
        if (platform === 'ud')
            return stat === 'ss' ? entry.line_ud_ss : stat === 'td' ? entry.line_ud_td : entry.line_ud_ctrl;
        if (platform === 'pp')
            return stat === 'ss' ? entry.line_pp_ss : stat === 'td' ? entry.line_pp_td : entry.line_pp_ctrl;
        if (platform === 'dk')
            return stat === 'ss' ? entry.line_dk_ss : stat === 'td' ? entry.line_dk_td : entry.line_dk_ctrl;
        return stat === 'ss' ? entry.line_betr_ss : stat === 'td' ? entry.line_betr_td : entry.line_betr_ctrl;
    }
    function selectedBookLine(entry, stat) {
        if (!entry)
            return null;
        if (currentPlatform === 'pick6')
            return pickStatLine(entry, 'p6', stat) ?? null;
        if (currentPlatform === 'underdog')
            return pickStatLine(entry, 'ud', stat) ?? null;
        if (currentPlatform === 'prizepicks')
            return pickStatLine(entry, 'pp', stat) ?? null;
        if (currentPlatform === 'draftkings_sportsbook')
            return pickStatLine(entry, 'dk', stat) ?? null;
        return pickStatLine(entry, 'betr', stat) ?? null;
    }
    function anyBookLine(entry, stat) {
        if (!entry)
            return null;
        return pickStatLine(entry, 'p6', stat)
            ?? pickStatLine(entry, 'ud', stat)
            ?? pickStatLine(entry, 'pp', stat)
            ?? pickStatLine(entry, 'dk', stat)
            ?? pickStatLine(entry, 'betr', stat)
            ?? null;
    }
    function formatLineSource(entry, stat, line) {
        if (!entry || line == null)
            return 'none';
        if (pickStatLine(entry, 'p6', stat) === line)
            return 'P6';
        if (pickStatLine(entry, 'ud', stat) === line)
            return 'UD';
        if (pickStatLine(entry, 'pp', stat) === line)
            return 'PP';
        if (pickStatLine(entry, 'dk', stat) === line)
            return 'DK';
        if (pickStatLine(entry, 'betr', stat) === line)
            return 'BT';
        return 'unknown';
    }
    function resolveAnalysisLine(entry, stat) {
        const selected = selectedBookLine(entry, stat);
        if (selected != null)
            return { line: selected, source: currentPlatform.toUpperCase() };
        const fallback = anyBookLine(entry, stat);
        if (fallback != null)
            return { line: fallback, source: `fallback ${formatLineSource(entry, stat, fallback)}` };
        return { line: null, source: 'missing' };
    }
    const fighterSsLineResolved = resolveAnalysisLine(f, 'ss');
    const opponentSsLineResolved = resolveAnalysisLine(oppEntry, 'ss');
    function buildSSAnalysis(fighterName, fighterDb, currentSsLine, lineSource, opponentDb) {
        if (!fighterDb?.loaded || currentSsLine == null || !Number.isFinite(currentSsLine)) {
            return {
                name: fighterName,
                currentLine: currentSsLine,
                currentLineSource: lineSource,
                currentLineText: currentSsLine != null ? `${currentSsLine.toFixed(1)} (${lineSource})` : 'Unavailable',
                avgText: 'Unavailable',
                vsLineText: 'Insufficient line/history data',
                matchupNotes: 'Needs both current SS line and fighter history.',
                verdictText: 'No bet (insufficient data)',
                confidenceText: '0',
                edge: 0,
                confidence: 0,
                available: false,
            };
        }
        const ssSamples = (fighterDb.history || [])
            .map((h) => h.sigStr)
            .filter((v) => typeof v === 'number' && Number.isFinite(v));
        if (!ssSamples.length) {
            return {
                name: fighterName,
                currentLine: currentSsLine,
                currentLineSource: lineSource,
                currentLineText: `${currentSsLine.toFixed(1)} (${lineSource})`,
                avgText: 'Unavailable',
                vsLineText: 'No historical SS samples',
                matchupNotes: 'Unable to compute historical over/under hit profile.',
                verdictText: 'No bet (insufficient data)',
                confidenceText: '0',
                edge: 0,
                confidence: 0,
                available: false,
            };
        }
        const avg = ssSamples.reduce((s, v) => s + v, 0) / ssSamples.length;
        const overCount = ssSamples.filter((v) => v > currentSsLine).length;
        const underCount = ssSamples.length - overCount;
        const overRate = overCount / ssSamples.length;
        let matchupAdj = 0;
        const notes = [];
        if (lineSource.startsWith('fallback')) {
            notes.push(`Selected-book SS line missing; using ${lineSource}.`);
        }
        if (opponentDb?.loaded) {
            const oppStrDef = opponentDb.strDef;
            const oppSapm = opponentDb.sapm;
            const oppTdDef = opponentDb.tdDef;
            const oppAvgTd = opponentDb.avgTD;
            if (oppStrDef != null) {
                if (oppStrDef >= 60) {
                    matchupAdj -= 4;
                    notes.push(`Opponent striking defense ${oppStrDef}% suppresses clean SS volume.`);
                }
                else if (oppStrDef <= 45) {
                    matchupAdj += 4;
                    notes.push(`Opponent striking defense ${oppStrDef}% is exploitable for SS accumulation.`);
                }
            }
            if (oppSapm != null) {
                if (oppSapm >= 4.7) {
                    matchupAdj += 2.5;
                    notes.push(`Opponent absorbs ${oppSapm.toFixed(1)} sig strikes/min, pace supports overs.`);
                }
                else if (oppSapm <= 3.0) {
                    matchupAdj -= 2.5;
                    notes.push(`Opponent absorbs only ${oppSapm.toFixed(1)} sig strikes/min, downside for SS output.`);
                }
            }
            if (oppAvgTd != null && oppAvgTd >= 2.2) {
                matchupAdj -= 1.5;
                notes.push(`Opponent wrestling pressure (${oppAvgTd.toFixed(1)} TD avg) can suppress striking exchanges.`);
            }
            if (oppTdDef != null && oppTdDef < 50 && (fighterDb.avgTD ?? 0) > 1.3) {
                matchupAdj -= 1;
                notes.push('Fighter may choose grappling routes vs weak TD defense, reducing SS ceiling.');
            }
        }
        else {
            notes.push('Opponent profile not loaded; matchup adjustment limited to fighter history baseline.');
        }
        const projection = avg + matchupAdj;
        const verdict = projection >= currentSsLine ? 'OVER' : 'UNDER';
        const confidence = Math.max(45, Math.min(93, Math.round(52
            + Math.min(18, Math.abs(projection - currentSsLine) * 1.4)
            + Math.min(12, Math.abs(overRate - 0.5) * 100 * 0.24)
            + Math.min(8, ssSamples.length * 0.9))));
        const vsLineText = `${overCount}/${ssSamples.length} over (${(overRate * 100).toFixed(0)}%) · ${underCount}/${ssSamples.length} under`;
        const matchupNotes = notes.length ? notes.join(' ') : 'Neutral style/pace indicators.';
        return {
            name: fighterName,
            currentLine: currentSsLine,
            currentLineSource: lineSource,
            currentLineText: `${currentSsLine.toFixed(1)} (${lineSource})`,
            avgText: avg.toFixed(1),
            vsLineText,
            matchupNotes,
            verdictText: `${verdict} ${currentSsLine.toFixed(1)} (proj ${projection.toFixed(1)})`,
            confidenceText: String(confidence),
            edge: projection - currentSsLine,
            confidence,
            available: true,
        };
    }
    function buildKeyReasons(a, b) {
        const reasons = [];
        if (a.available)
            reasons.push(`${a.name}: edge ${a.edge >= 0 ? '+' : ''}${a.edge.toFixed(1)} vs line`);
        if (b.available)
            reasons.push(`${b.name}: edge ${b.edge >= 0 ? '+' : ''}${b.edge.toFixed(1)} vs line`);
        if (!reasons.length)
            reasons.push('Insufficient SS line/history data for one or both sides');
        return reasons.join(' | ');
    }
    function validateSSOutput(a, b, keyReasons) {
        const check1 = a.currentLine != null && b.currentLine != null;
        const check2 = a.avgText !== 'Unavailable' && b.avgText !== 'Unavailable' && a.vsLineText.length > 0 && b.vsLineText.length > 0;
        const check3 = (a.verdictText.includes('OVER') || a.verdictText.includes('UNDER') || a.verdictText.includes('No bet'))
            && (b.verdictText.includes('OVER') || b.verdictText.includes('UNDER') || b.verdictText.includes('No bet'));
        const check4 = keyReasons.length > 0;
        return check1 && check2 && check3 && check4;
    }
    let fighterSsAnalysis = buildSSAnalysis(f.name, db, fighterSsLineResolved.line, fighterSsLineResolved.source, oppEntry?.db || null);
    let opponentSsAnalysis = buildSSAnalysis(oppEntry?.name || (f.opponent || 'Opponent'), oppEntry?.db || null, opponentSsLineResolved.line, opponentSsLineResolved.source, db);
    // Self-correct once if selected-book line is missing by forcing best available line on both sides.
    let keyReasons = buildKeyReasons(fighterSsAnalysis, opponentSsAnalysis);
    if (!validateSSOutput(fighterSsAnalysis, opponentSsAnalysis, keyReasons)) {
        const fighterFallbackLine = anyBookLine(f, 'ss');
        const opponentFallbackLine = anyBookLine(oppEntry, 'ss');
        fighterSsAnalysis = buildSSAnalysis(f.name, db, fighterFallbackLine, formatLineSource(f, 'ss', fighterFallbackLine), oppEntry?.db || null);
        opponentSsAnalysis = buildSSAnalysis(oppEntry?.name || (f.opponent || 'Opponent'), oppEntry?.db || null, opponentFallbackLine, formatLineSource(oppEntry, 'ss', opponentFallbackLine), db);
        keyReasons = buildKeyReasons(fighterSsAnalysis, opponentSsAnalysis);
    }
    const strongest = Math.abs(fighterSsAnalysis.edge) >= Math.abs(opponentSsAnalysis.edge)
        ? fighterSsAnalysis
        : opponentSsAnalysis;
    const volatilityFlags = [];
    if ((db.fpStdDev ?? 0) > 22)
        volatilityFlags.push(`${f.name} high variance profile`);
    if ((oppEntry?.db?.fpStdDev ?? 0) > 22)
        volatilityFlags.push(`${oppEntry?.name || 'Opponent'} high variance profile`);
    if (!fighterSsAnalysis.available || !opponentSsAnalysis.available)
        volatilityFlags.push('incomplete opponent/line data');
    const recommendedLeans = [fighterSsAnalysis, opponentSsAnalysis]
        .filter((x) => x.available && x.confidence >= 62)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 2)
        .map((x) => `${x.name}: ${x.verdictText} (${x.confidence}% conf)`);
    function buildCTRLAnalysis(fighterName, fighterDb, currentCtrlLine, lineSource, opponentDb) {
        const lineText = currentCtrlLine != null ? `${formatMinutesAsClock(currentCtrlLine)} (${lineSource})` : 'Unavailable';
        if (!fighterDb?.loaded || currentCtrlLine == null || !Number.isFinite(currentCtrlLine)) {
            return {
                name: fighterName, currentLine: currentCtrlLine, currentLineText: lineText,
                avgText: 'Unavailable', vsLineText: 'Insufficient line/history data',
                matchupNotes: 'Needs both current CTRL line and fighter history.',
                verdictText: 'No bet (insufficient data)', confidenceText: '0',
                edge: 0, confidence: 0, available: false,
            };
        }
        const samples = (fighterDb.history || [])
            .map(h => h.ctrlSecs)
            .filter((v) => typeof v === 'number' && Number.isFinite(v))
            .map(s => s / 60);
        if (samples.length < 2) {
            return {
                name: fighterName, currentLine: currentCtrlLine, currentLineText: lineText,
                avgText: 'Unavailable', vsLineText: 'No historical control samples',
                matchupNotes: 'Unable to compute historical over/under hit profile.',
                verdictText: 'No bet (insufficient data)', confidenceText: '0',
                edge: 0, confidence: 0, available: false,
            };
        }
        const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
        const overCount = samples.filter(v => v > currentCtrlLine).length;
        const underCount = samples.length - overCount;
        const overRate = overCount / samples.length;
        let matchupAdj = 0;
        const notes = [];
        if (lineSource.startsWith('fallback'))
            notes.push(`Selected-book CTRL line missing; using ${lineSource}.`);
        if (fighterDb.style === 'grappler') {
            matchupAdj += 0.5;
            notes.push('Grappler profile supports sustained control.');
        }
        else if (fighterDb.style === 'striker') {
            matchupAdj -= 0.5;
            notes.push('Striker profile rarely posts large control windows.');
        }
        const tdAvg = fighterDb.avgTDperFight ?? fighterDb.avgTD ?? null;
        if (tdAvg != null) {
            if (tdAvg >= 2.5) {
                matchupAdj += 0.8;
                notes.push(`High TD volume (${tdAvg.toFixed(1)}/fight) fuels control upside.`);
            }
            else if (tdAvg >= 1.2) {
                matchupAdj += 0.3;
                notes.push(`Moderate TD volume (${tdAvg.toFixed(1)}/fight).`);
            }
            else if (tdAvg < 0.4) {
                matchupAdj -= 0.6;
                notes.push(`Low TD volume (${tdAvg.toFixed(1)}/fight) caps control ceiling.`);
            }
        }
        if (opponentDb?.loaded && opponentDb.tdDef != null) {
            if (opponentDb.tdDef >= 75) {
                matchupAdj -= 0.9;
                notes.push(`Opponent TD defense ${opponentDb.tdDef}% suppresses ground control.`);
            }
            else if (opponentDb.tdDef <= 45) {
                matchupAdj += 0.6;
                notes.push(`Opponent TD defense only ${opponentDb.tdDef}% — favorable for control accumulation.`);
            }
        }
        const oppTD = opponentDb?.avgTDperFight ?? opponentDb?.avgTD ?? null;
        if (opponentDb?.loaded && oppTD != null && oppTD >= 2.2) {
            matchupAdj -= 0.4;
            notes.push(`Opponent also wrestles (${oppTD.toFixed(1)} TD/fight) — fighter may lose scramble battles.`);
        }
        if (!opponentDb?.loaded)
            notes.push('Opponent profile not loaded; matchup adjustment limited to fighter history baseline.');
        const projection = avg + matchupAdj;
        const verdict = projection >= currentCtrlLine ? 'OVER' : 'UNDER';
        const confidence = Math.max(45, Math.min(92, Math.round(52
            + Math.min(18, Math.abs(projection - currentCtrlLine) * 6)
            + Math.min(12, Math.abs(overRate - 0.5) * 100 * 0.24)
            + Math.min(8, samples.length * 0.9))));
        return {
            name: fighterName,
            currentLine: currentCtrlLine,
            currentLineText: lineText,
            avgText: formatMinutesAsClock(avg),
            vsLineText: `${overCount}/${samples.length} over (${(overRate * 100).toFixed(0)}%) · ${underCount}/${samples.length} under`,
            matchupNotes: notes.length ? notes.join(' ') : 'Neutral style/pace indicators.',
            verdictText: `${verdict} ${formatMinutesAsClock(currentCtrlLine)} (proj ${formatMinutesAsClock(projection)})`,
            confidenceText: String(confidence),
            edge: projection - currentCtrlLine,
            confidence,
            available: true,
        };
    }
    const fighterCtrlLineResolved = resolveAnalysisLine(f, 'ctrl');
    const opponentCtrlLineResolved = resolveAnalysisLine(oppEntry, 'ctrl');
    const fighterCtrlAnalysis = buildCTRLAnalysis(f.name, db, fighterCtrlLineResolved.line, fighterCtrlLineResolved.source, oppEntry?.db || null);
    const opponentCtrlAnalysis = buildCTRLAnalysis(oppEntry?.name || (f.opponent || 'Opponent'), oppEntry?.db || null, opponentCtrlLineResolved.line, opponentCtrlLineResolved.source, db);
    const ctrlStrongest = Math.abs(fighterCtrlAnalysis.edge) >= Math.abs(opponentCtrlAnalysis.edge) ? fighterCtrlAnalysis : opponentCtrlAnalysis;
    const ctrlKeyReasons = [
        fighterCtrlAnalysis.available ? `${fighterCtrlAnalysis.name}: edge ${fighterCtrlAnalysis.edge >= 0 ? '+' : ''}${fighterCtrlAnalysis.edge.toFixed(1)}m vs line` : null,
        opponentCtrlAnalysis.available ? `${opponentCtrlAnalysis.name}: edge ${opponentCtrlAnalysis.edge >= 0 ? '+' : ''}${opponentCtrlAnalysis.edge.toFixed(1)}m vs line` : null,
    ].filter(Boolean).join(' | ') || 'Insufficient CTRL line/history data for one or both sides';
    const ctrlRecommendedLeans = [fighterCtrlAnalysis, opponentCtrlAnalysis]
        .filter(x => x.available && x.confidence >= 62)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 2)
        .map(x => `${x.name}: ${x.verdictText} (${x.confidence}% conf)`);
    const maVal = (t) => /^(unavailable|insufficient|needs both|no |none)/i.test(t) ? `<span class="ma-value-dim">${t}</span>` : t;
    const maVerdictChip = (text) => {
        const cls = /\bOVER\b/i.test(text) ? 'over' : /\bUNDER\b/i.test(text) ? 'under' : 'none';
        return `<span class="ma-verdict-chip ${cls}">${text}</span>`;
    };
    const maConfBar = (conf) => {
        const n = Math.max(0, Math.min(100, Math.round(conf)));
        const hue = n >= 70 ? 'high' : n >= 50 ? 'med' : 'low';
        return `<span class="ma-conf"><span class="ma-conf-bar"><span class="ma-conf-fill ${hue}" style="width:${Math.max(4, n)}%"></span></span><span class="ma-conf-num">${n}</span></span>`;
    };
    const maSection = (label, a) => `
        <div class="ma-subhead">${prettyName(a.name)} <span class="ma-subhead-tag">${label}</span></div>
        <div class="ma-row"><span class="ma-label">Current line</span><span class="ma-value">${maVal(a.currentLineText)}</span></div>
        <div class="ma-row"><span class="ma-label">Historical avg</span><span class="ma-value">${maVal(a.avgText)}</span></div>
        <div class="ma-row"><span class="ma-label">Vs similar lines</span><span class="ma-value">${maVal(a.vsLineText)}</span></div>
        <div class="ma-row"><span class="ma-label">Matchup notes</span><span class="ma-value">${maVal(a.matchupNotes)}</span></div>
        <div class="ma-row"><span class="ma-label">Verdict</span><span class="ma-value">${maVerdictChip(a.verdictText)}</span></div>
        <div class="ma-row"><span class="ma-label">Confidence</span><span class="ma-value">${maConfBar(a.confidence)}</span></div>`;
    const ctrlAnalysisHtml = `
    <div class="detail-panel ma-panel ma-ctrl">
      <div class="detail-panel-title">CTRL Matchup Analyzer</div>
      <div class="lean-reason ma-analysis">
        ${maSection('CTRL', fighterCtrlAnalysis)}
        ${maSection('CTRL · OPP', opponentCtrlAnalysis)}
        <div class="ma-subhead">Final Summary</div>
        <div class="ma-row"><span class="ma-label">Clearest value</span><span class="ma-value ma-verdict">${ctrlStrongest.available ? `${ctrlStrongest.name} (${ctrlStrongest.verdictText})` : 'No clear edge (insufficient data)'}</span></div>
        <div class="ma-row"><span class="ma-label">Key reasons</span><span class="ma-value">${ctrlKeyReasons}</span></div>
        <div class="ma-row"><span class="ma-label">Recommended</span><span class="ma-value">${ctrlRecommendedLeans.length ? ctrlRecommendedLeans.join(' | ') : 'No CTRL lean above confidence threshold'}</span></div>
      </div>
    </div>`;
    const ssAnalysisHtml = `
    <div class="detail-panel ma-panel ma-ss">
      <div class="detail-panel-title">SS Matchup Analyzer</div>
      <div class="lean-reason ma-analysis">
        ${maSection('SS', fighterSsAnalysis)}
        ${maSection('SS · OPP', opponentSsAnalysis)}
        <div class="ma-subhead">Final Summary</div>
        <div class="ma-row"><span class="ma-label">Clearest value</span><span class="ma-value ma-verdict">${strongest.available ? `${strongest.name} (${strongest.verdictText})` : 'No clear edge (insufficient data)'}</span></div>
        <div class="ma-row"><span class="ma-label">Key reasons</span><span class="ma-value">${keyReasons}</span></div>
        <div class="ma-row"><span class="ma-label">Volatility flags</span><span class="ma-value">${volatilityFlags.length ? volatilityFlags.join(' · ') : 'None flagged from fetched variance/style metrics'}</span></div>
        <div class="ma-row"><span class="ma-label">Recommended</span><span class="ma-value">${recommendedLeans.length ? recommendedLeans.join(' | ') : 'No SS lean above confidence threshold'}</span></div>
      </div>
    </div>`;
    const row = document.createElement('div');
    const rowLeanClass = lean.lean === 'over' ? ' lean-over-row' : lean.lean === 'under' ? ' lean-under-row' : '';
    row.className = 'fighter-row' + rowLeanClass;
    row.dataset['name'] = f.name;
    row.innerHTML = `
    <div class="fighter-main">
      <div class="fighter-info">
        <div class="fighter-avatar-wrap" title="Head-to-head vs ${prettyName(f.opponent || 'opponent')}"><div class="fighter-avatar"><span class="fighter-avatar-flag">${db.country || '🏴'}</span><img class="fighter-avatar-img" alt="" /></div><span class="fighter-avatar-country">${db.country || ''}</span></div>
        <div>
          <div class="fighter-name" title="${prettyName(f.name)}">${prettyName(f.name)}${streakEmoji}</div>
          <div class="fighter-record">${db.record || '—'} · ${db.style || '...'}${(() => { const oppStrength = calcOpponentStrengthScore(oppEntry?.db ?? null); const emoji = oppStrength.score >= 1.45 ? '🔴' : oppStrength.score >= 0.75 ? '🟡' : oppStrength.score > -0.2 ? '⚪' : '🟢'; return oppEntry?.db?.loaded ? ` <span title="${oppStrength.label}" style="font-size:11px;opacity:0.85">${emoji}</span>` : ''; })()}</div>
          ${(() => { const recent = (db.history || []).slice(0, 5).filter(h => h.result === 'win' || h.result === 'loss'); return recent.length >= 2 ? `<div class="form-dots" title="Last ${recent.length} fights — newest first">${recent.map(h => `<span class="form-dot ${h.result}"></span>`).join('')}</div>` : ''; })()}
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px">${archetypeBadgeHtml}${archetypeAlertHtml}</div>
          ${sharpBadgeHtml}
        </div>
      </div>
      <div class="platform-lines">
        ${lineCell('p6', 'fp', f.line_p6)}
        ${lineCell('p6', 'ss', f.line_p6_ss)}
        ${lineCell('p6', 'td', f.line_p6_td)}
        ${lineCell('p6', 'ft', f.line_p6_ft)}
        ${lineCell('p6', 'ctrl', f.line_p6_ctrl)}
        ${lineCell('ud', 'fp', f.line_ud)}
        ${lineCell('ud', 'ss', f.line_ud_ss)}
        ${(f.line_ud_ss_r1 != null && showSource('ud')) ? `<div class="line-cell ss src-ud"><div class="line-platform"><span class="line-source-tag src-ud">UD</span><span>R1 SS</span></div><div class="line-value ud">${f.line_ud_ss_r1}</div></div>` : ''}
        ${(f.line_ud_ss_body != null && showSource('ud')) ? `<div class="line-cell ss src-ud"><div class="line-platform"><span class="line-source-tag src-ud">UD</span><span>Body</span></div><div class="line-value ud">${f.line_ud_ss_body}</div></div>` : ''}
        ${(f.line_ud_ss_leg != null && showSource('ud')) ? `<div class="line-cell ss src-ud"><div class="line-platform"><span class="line-source-tag src-ud">UD</span><span>Leg</span></div><div class="line-value ud">${f.line_ud_ss_leg}</div></div>` : ''}
        ${lineCell('ud', 'td', f.line_ud_td)}
        ${lineCell('ud', 'ft', f.line_ud_ft)}
        ${lineCell('ud', 'ctrl', f.line_ud_ctrl)}
        ${lineCell('betr', 'fp', f.line_betr)}
        ${lineCell('betr', 'ss', f.line_betr_ss)}
        ${lineCell('betr', 'td', f.line_betr_td)}
        ${lineCell('betr', 'ft', f.line_betr_ft)}
        ${lineCell('betr', 'ctrl', f.line_betr_ctrl)}
        ${lineCell('pp', 'fp', f.line_pp)}
        ${lineCell('pp', 'ss', f.line_pp_ss)}
        ${(f.line_pp_ss_r1 != null && showSource('pp')) ? `<div class="line-cell ss src-pp"><div class="line-platform"><span class="line-source-tag src-pp">PP</span><span>R1 SS</span></div><div class="line-value pp">${f.line_pp_ss_r1}</div></div>` : ''}
        ${(f.line_pp_ss_body != null && showSource('pp')) ? `<div class="line-cell ss src-pp"><div class="line-platform"><span class="line-source-tag src-pp">PP</span><span>Body</span></div><div class="line-value pp">${f.line_pp_ss_body}</div></div>` : ''}
        ${(f.line_pp_ss_leg != null && showSource('pp')) ? `<div class="line-cell ss src-pp"><div class="line-platform"><span class="line-source-tag src-pp">PP</span><span>Leg</span></div><div class="line-value pp">${f.line_pp_ss_leg}</div></div>` : ''}
        ${lineCell('pp', 'td', f.line_pp_td)}
        ${lineCell('pp', 'ft', f.line_pp_ft)}
        ${lineCell('pp', 'ctrl', f.line_pp_ctrl)}
        ${lineCell('dk', 'ss', f.line_dk_ss)}
        ${lineCell('dk', 'td', f.line_dk_td)}
        ${lineCell('dk', 'ft', f.line_dk_ft)}
        ${lineCell('dk', 'ctrl', f.line_dk_ctrl)}
        ${hasAnyVisibleSourceLine(f) ? '' : '<div class="line-value-empty">No visible source lines</div>'}
        <!-- Removed spikeEvent and odds badge UI -->
      </div>
      <div class="stats-mini">
        <div class="stat-card stat-card-fp" title="${normDisplayFP != null ? `Round-normalized (${roundNormTag}): ${(projFP ?? mlAdjFP ?? platformAvgFP ?? 0).toFixed(1)} × ${roundNormFactor.toFixed(2)} = ${normDisplayFP}. Hist avg fight: ${histAvgMins}m, expected: ${isFiveRound ? FIVE_ROUND_MINS : THREE_ROUND_MINS}m.` : projFP != null ? `Opp-adjusted projection: (your avg ${baseAvgFP.toFixed(1)} + opp allows ${oppAvgFPAllowed.toFixed(1)}) ÷ 2 = ${projFP.toFixed(1)}. Based on ${oppFPAllowedSamples.length} opp fights.` : mlAdjFP != null ? `ML-adjusted: ${mlAdjFP.toFixed(1)} FP (win/loss FP weighted by ${f.moneyline != null ? (f.moneyline < 0 ? f.moneyline : '+' + f.moneyline) : '-'} implied win prob). Raw avg: ${platformAvgFP != null ? platformAvgFP.toFixed(1) : '—'}` : 'Recent fantasy points average from UFCStats history'}">
          <div class="stat-card-head">
            <span class="stat-card-label">${projFP != null ? 'Proj FP' : 'Avg FP'}</span>
            ${roundNormTag ? `<span class="round-norm-tag">${roundNormTag}</span>` : ''}
          </div>
          <div class="stat-card-big">
            <span class="stat-card-num">${normDisplayFP != null ? normDisplayFP.toFixed(1) : projFP != null ? projFP.toFixed(1) : mlAdjFP != null ? mlAdjFP.toFixed(1) : (platformAvgFP != null ? platformAvgFP.toFixed(1) : '...')}</span>
            <span class="stat-card-meta">${avgFPPercentileLabel}${projFP != null && !normDisplayFP ? `<span class="opp-allows-badge" title="Opponent allows ${oppAvgFPAllowed} FP avg">(${oppAvgFPAllowed})</span>` : ''}${mlAdjShift != null && Math.abs(mlAdjShift) >= 3 && !normDisplayFP && !projFP ? `<span class="ml-adj-badge ${mlAdjShift > 0 ? 'pos' : 'neg'}">${mlAdjShift > 0 ? '+' : ''}${mlAdjShift.toFixed(1)}</span>` : ''}${trendChip(fpTrend, `${_twLabel} avg: ${fpTrend.recentAvg} · Career: ${fpTrend.careerAvg}`)}</span>
          </div>
          ${db.fpFloor != null ? `<div class="stat-card-foot">${fpFloor}–${fpCeiling}</div>` : ''}
        </div>
        <div class="stat-card stat-card-ss">
          <div class="stat-card-head">
            <span class="stat-card-label">SS</span>
            ${roundNormTag ? `<span class="round-norm-tag">${roundNormTag}</span>` : ''}
          </div>
          <div class="stat-row" title="${normDisplaySS != null ? `Round-normalized (${roundNormTag}): ${displaySS.toFixed(1)} × ${roundNormFactor.toFixed(2)} = ${normDisplaySS}.` : projSS != null ? `Opp-adjusted projection: (your avg ${avgSS.toFixed(1)} + opp allows ${oppAvgSSAllowed.toFixed(1)}) ÷ 2 = ${projSS.toFixed(1)}.${ssSpreadTip ? ' | ' + ssSpreadTip : ''}` : ssSpreadTip || 'Average significant strikes landed per fight'}">
            <span class="stat-row-label">${projSS != null ? 'proj' : 'avg'}</span>
            <span class="stat-row-val">${finalDisplaySS != null ? finalDisplaySS.toFixed(1) : '...'}${ssSpreadLabel ? `<span class="ss-spread-inline" style="color:${ssSpreadColor}" title="${ssSpreadTip}">${roundNormFactor !== 1.0 ? `±${(parseFloat(ssSpreadLabel.slice(1)) * roundNormFactor).toFixed(1)}` : ssSpreadLabel}</span>` : ''}${projSS != null && !normDisplaySS ? `<span class="opp-allows-badge" title="Opponent allows ${oppAvgSSAllowed} SS avg">(${oppAvgSSAllowed})</span>` : ''}${trendChip(ssTrend, `SS ${_twLabel} avg: ${ssTrend.recentAvg} · Career: ${ssTrend.careerAvg}`)}</span>
          </div>
          <div class="stat-row" title="Current active platform SS betting line">
            <span class="stat-row-label">line</span>
            <span class="stat-row-val">${primarySSLine != null ? primarySSLine.toFixed(1) : '...'}</span>
          </div>
          <div class="stat-delta-block ${ssDeltaClass}" title="${normDisplaySS != null ? `Delta = Norm SS (${finalDisplaySS.toFixed(1)}) minus SS line.` : projSS != null ? `Delta = Proj SS (${projSS.toFixed(1)}) minus SS line.` : 'Delta = Avg SS minus SS line. Positive favors over, negative favors under.'}">
            <span class="stat-delta-val">${ssDeltaText}</span>
            ${normDisplayTD != null ? `<span class="stat-delta-td" title="${projTD != null ? `Proj TD opp-adj: (avg ${avgTDraw} + opp allows ${oppAvgTDAllowed}) ÷ 2 = ${projTD}, normalized: ${normDisplayTD}` : `TD normalized: ${avgTDraw} × ${roundNormFactor.toFixed(2)} = ${normDisplayTD}`}">${projTD != null ? 'P' : 'A'}TD ${normDisplayTD}</span>` : projTD != null && !normDisplayTD ? `<span class="stat-delta-td" title="Proj TD: (avg ${avgTDraw} + opp allows ${oppAvgTDAllowed}) ÷ 2 = ${projTD}">PTD ${projTD}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="lean-cell">
        <div class="lean-badge ${leanClass}" style="${leanGradStyle}" title="${lean.verdict}">${leanText}${confInlineLabel}</div>
        ${confPct > 0 ? `<div class="confidence-meter" title="Confidence${displayGrade}: ${confPct}%${recalConf != null && recalConf !== confPct ? ' (recal: ' + recalConf + '%)' : ''}"><div class="confidence-fill" data-fill-width="${displayConf}%" style="width:0%; background: rgb(${leanRGB}); color: rgb(${leanRGB});"></div></div>` : ''}
        ${hasCrossStatConflict(f) ? `<div class="conflict-warn" title="FP leans ${lean.lean?.toUpperCase()} but SS and TD both lean the opposite — grappling/striking split. Lower confidence.">⚠ Stat split</div>` : ''}
        ${hasConsensusLean(f) ? `<div class="consensus-lean" title="FP, SS, and TD all lean ${hasConsensusLean(f)?.toUpperCase()} — strong multi-stat alignment">⚡ consensus</div>` : ''}
        ${lean.rivalryDissent ? `<div class="conflict-warn" style="background:rgba(255,184,77,0.10);border-color:rgba(255,184,77,0.35);color:#ffbe6b" title="Rival models disagree with the main lean — ${String(lean.rivalryDissent).replace(/"/g, '&quot;')}">⚔ Rival models dissent</div>` : ''}
        ${(() => {
        if (!_fighterArchiveStats)
            return '';
        const key = (normalizeName(f.name) || f.name).toLowerCase();
        const stats = _fighterArchiveStats.get(key);
        if (!stats)
            return '';
        const parts = [];
        for (const [pt, d] of Object.entries(stats)) {
            if (d.total < 2)
                continue;
            const pct = Math.round(d.hits / d.total * 100);
            const col = pct >= 65 ? 'var(--green)' : pct >= 45 ? 'var(--amber)' : 'var(--red)';
            const label = pt === 'FightTime' ? 'FT' : pt;
            parts.push(`<span style="color:${col}">${label} ${pct}%</span>`);
        }
        if (!parts.length)
            return '';
        const totalEvents = Math.max(...Object.values(stats).map(d => d.total));
        return `<div class="archive-accuracy-badge" title="Archive hit rate for ${f.name} across ${totalEvents} settled event(s)">📊 ${parts.join(' · ')}</div>`;
    })()}
        ${leanEvDetail != null ? `<div class="ev-label" title="${leanEvDetail.isAssumedVig ? 'Assumed -110 vig (no book odds for FP)' : `Actual odds · profit ${leanEvDetail.profit.toFixed(2)}x${leanEvDetail.vig != null ? ` · vig ${leanEvDetail.vig}%` : ''}`}">${leanEvDetail.isAssumedVig ? '~' : ''}EV: ${leanEvDetail.ev > 0 ? '+' : ''}${leanEvDetail.ev}%${!leanEvDetail.isAssumedVig && leanEvDetail.vig != null ? ` <span style="color:${leanEvDetail.vig > 5 ? 'var(--red)' : leanEvDetail.vig > 3 ? 'var(--amber)' : 'var(--green)'};font-size:8px">(${leanEvDetail.vig}%)</span>` : ''}</div>` : ''}
        ${weightedAvg != null ? `<div class="weighted-avg-label">W.Avg: ${weightedAvg.toFixed(1)}</div>` : ''}
        ${(() => {
        const fvEdge = lean.fairValueEdge;
        const fvVal = lean.fairValue;
        if (fvEdge == null || fvVal == null || Math.abs(fvEdge) < 1.5)
            return '';
        const absE = Math.abs(fvEdge);
        const col = absE >= 4 ? (fvEdge > 0 ? '#48c78e' : '#ff6464') : '#f0c040';
        const bg = absE >= 4 ? (fvEdge > 0 ? 'rgba(72,199,142,0.12)' : 'rgba(255,100,100,0.12)') : 'rgba(240,192,64,0.12)';
        return `<div class="fair-value-chip" style="font-size:9px;padding:2px 7px;border-radius:6px;background:${bg};border:1px solid ${col}40;color:${col};letter-spacing:0.04em" title="Fair value ${fvVal.toFixed(1)} — edge ${fvEdge > 0 ? '+' : ''}${fvEdge.toFixed(1)} pts vs active line">FV ${fvEdge > 0 ? '+' : ''}${fvEdge.toFixed(1)}</div>`;
    })()}
      </div>
      <div class="row-expand-slot">${(() => {
        const wm = _weightMissSignals.get(f.name.toLowerCase());
        if (!wm)
            return '';
        const lbsLabel = wm.lbsOver != null ? `${wm.lbsOver % 1 === 0 ? wm.lbsOver : wm.lbsOver.toFixed(1)} LB` : '';
        const tip = wm.source.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<button class="weight-miss-badge weight-miss-${wm.severity}" data-news-fighter="${f.name}" title="${tip}">⚖ MISS${lbsLabel ? ' ' + lbsLabel : ''}</button>`;
    })()}${_newsAlertFighters.has(f.name.toLowerCase()) ? `<button class="news-warn-badge" data-news-fighter="${f.name}" title="Recent injury/withdrawal news detected — click for headlines">⚠ NEWS</button>` : ''}<span class="expand-arrow">▼</span></div>
    </div>
    <div class="fighter-detail"></div>`;
    // Lazy: defer building the detail panel HTML until the row is expanded.
    // The closure captures all per-row state (db, oppEntry, history strings, etc).
    _pendingDetailBuilders.set(row, () => `<div class="detail-grid">
        <div class="detail-section-head">📊 Stat Head-to-Head — ${prettyName(f.name)} vs ${prettyName(oppName || 'Opponent')}</div>
        <div class="stat-pair">
        <div class="detail-panel"><div class="detail-panel-title">FP History vs Line (${platformLabel})</div>${historyHTML}${activeLine ? `<div class="panel-meta"><div class="panel-meta-line"></div> Line: ${activeLine}</div>` : ''}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp FP Scored vs ${f.name}${oppCompareFpLine != null ? ` · ${oppName} line ${oppCompareFpLine}` : ''}</div>${oppFights.length ? oppFPHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        </div>
        <div class="stat-pair">
        <div class="detail-panel"><div class="detail-panel-title">Sig Strikes History${ssLine != null ? ` vs Line ${ssLine}` : ''}</div>${ssHistoryHTML}${ssLine != null ? `<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_ss || '—'} · UD: ${f.line_ud_ss || '—'} · PP: ${f.line_pp_ss || '—'} · BT: ${f.line_betr_ss || '—'}</div>` : ''}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp SS Scored vs ${f.name}${oppCompareSsLine != null ? ` · ${oppName} SS line ${oppCompareSsLine}` : ''}</div>${oppFights.length ? oppSSHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        </div>
        ${(ssR1Line != null || oppCompareSsR1Line != null) ? `<div class="stat-pair">` : ''}
        ${ssR1Line != null ? `<div class="detail-panel"><div class="detail-panel-title">R1 Sig Strikes History vs Line ${ssR1Line} <span class="panel-confidence low">${ssR1Badge}</span></div>${ssR1HistoryHTML}<div class="panel-meta"><div class="panel-meta-line"></div> ${ssR1Meta}</div></div>` : ''}
        ${oppCompareSsR1Line != null ? `<div class="detail-panel"><div class="detail-panel-title">⚔️ Opp R1 SS Scored vs ${f.name} · ${oppName} R1 SS line ${oppCompareSsR1Line} <span class="panel-confidence low">${oppSsR1Badge}</span></div>${oppFights.length ? oppSSR1History : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>` : ''}
        ${(ssR1Line != null || oppCompareSsR1Line != null) ? `</div>` : ''}
        ${(bodyLine != null || oppCompareBodyLine != null) ? `<div class="stat-pair">` : ''}
        ${bodyLine != null ? `<div class="detail-panel"><div class="detail-panel-title">Body Sig Strikes History vs Line ${bodyLine} <span class="panel-confidence low">${bodyBadge}</span></div>${bodyHistoryHTML}<div class="panel-meta"><div class="panel-meta-line"></div> ${bodyMeta}</div></div>` : ''}
        ${oppCompareBodyLine != null ? `<div class="detail-panel"><div class="detail-panel-title">⚔️ Opp Body SS Scored vs ${f.name} · ${oppName} Body line ${oppCompareBodyLine} <span class="panel-confidence low">${oppBodyBadge}</span></div>${oppFights.length ? oppBodyHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>` : ''}
        ${(bodyLine != null || oppCompareBodyLine != null) ? `</div>` : ''}
        ${(legLine != null || oppCompareLegLine != null) ? `<div class="stat-pair">` : ''}
        ${legLine != null ? `<div class="detail-panel"><div class="detail-panel-title">Leg Sig Strikes History vs Line ${legLine} <span class="panel-confidence low">${legBadge}</span></div>${legHistoryHTML}<div class="panel-meta"><div class="panel-meta-line"></div> ${legMeta}</div></div>` : ''}
        ${oppCompareLegLine != null ? `<div class="detail-panel"><div class="detail-panel-title">⚔️ Opp Leg SS Scored vs ${f.name} · ${oppName} Leg line ${oppCompareLegLine} <span class="panel-confidence low">${oppLegBadge}</span></div>${oppFights.length ? oppLegHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>` : ''}
        ${(legLine != null || oppCompareLegLine != null) ? `</div>` : ''}
        <div class="stat-pair">
        <div class="detail-panel"><div class="detail-panel-title">Takedowns History${tdLine != null ? ` vs Line ${tdLine}` : ''}${trendChip(tdTrend, `TD ${_twLabel} avg: ${tdTrend.recentAvg} · Career: ${tdTrend.careerAvg}`)}</div>${tdHistoryHTML}${tdLine != null ? `<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_td || '—'} · UD: ${f.line_ud_td || '—'} · PP: ${f.line_pp_td || '—'} · BT: ${f.line_betr_td || '—'}</div>` : ''}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp TDs Scored vs ${f.name}${oppCompareTdLine != null ? ` · ${oppName} TD line ${oppCompareTdLine}` : ''}</div>${oppFights.length ? oppTDHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        </div>
        <div class="stat-pair">
        <div class="detail-panel"><div class="detail-panel-title">Control Time History${ctrlLine != null ? ` vs Line ${formatMinutesAsClock(ctrlLine)}` : ''}${panelBadge(ctrlConf)}${f.line_p6_ctrl != null && f.ctrl_under_available === false ? ' <span class="panel-confidence low" title="Pick6 only offers OVER on this CTRL line — UNDER is unplaceable">OVER-only</span>' : ''}</div>${ctrlHistoryHTML}${ctrlLine != null ? `<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_ctrl != null ? formatMinutesAsClock(f.line_p6_ctrl) : '—'} · UD: ${f.line_ud_ctrl != null ? formatMinutesAsClock(f.line_ud_ctrl) : '—'} · PP: ${f.line_pp_ctrl != null ? formatMinutesAsClock(f.line_pp_ctrl) : '—'} · BT: ${f.line_betr_ctrl != null ? formatMinutesAsClock(f.line_betr_ctrl) : '—'}</div>` : ''}</div>
        <div class="detail-panel"><div class="detail-panel-title">⚔️ Opp CTRL Scored vs ${f.name}${oppCompareCtrlLine != null ? ` · ${oppName} CTRL line ${formatMinutesAsClock(oppCompareCtrlLine)}` : ''}${panelBadge(oppCtrlConf)}</div>${oppFights.length ? oppCTRLHistory : '<div class="history-empty">Clear cache &amp; reload to fetch</div>'}</div>
        </div>
        <div class="stat-pair">
        <div class="detail-panel"><div class="detail-panel-title">Fight Time History${ftLine != null ? ` vs Line ${formatMinutesAsClock(ftLine)}` : ''}</div>${ftHistoryHTML}${ftLine != null ? `<div class="panel-meta"><div class="panel-meta-line"></div> P6: ${f.line_p6_ft != null ? formatMinutesAsClock(f.line_p6_ft) : '—'} · UD: ${f.line_ud_ft != null ? formatMinutesAsClock(f.line_ud_ft) : '—'} · PP: ${f.line_pp_ft != null ? formatMinutesAsClock(f.line_pp_ft) : '—'} · BT: ${f.line_betr_ft != null ? formatMinutesAsClock(f.line_betr_ft) : '—'}</div>` : ''}</div>
        ${buildFightTimeSummaryPanel(db, oppEntry?.db || null, platformStatLine(f, 'ft'))}
        </div>
        <div class="detail-section-head">🧠 Matchup Models &amp; Career</div>
        <div class="panel-pair">
        ${ssAnalysisHtml}
        ${ctrlAnalysisHtml}
        </div>
        <div class="panel-pair">
        <div class="detail-panel">
          <div class="detail-panel-title">UFCStats Career Data</div>
          <span class="stat-val mid">${db.record || '...'}</span>
          <div class="stat-row"><span class="stat-label">SIG STRIKES / MIN</span><span class="stat-val ${db.slpm != null && db.slpm > 5 ? 'good' : db.slpm != null && db.slpm > 3 ? 'mid' : 'low'}">${db.slpm != null ? db.slpm.toFixed(2) : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">STRIKING ACC %</span><span class="stat-val ${db.strAcc != null && db.strAcc > 48 ? 'good' : db.strAcc != null && db.strAcc > 38 ? 'mid' : 'low'}">${db.strAcc != null ? db.strAcc + '%' : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD AVG / 15 MIN</span><span class="stat-val ${db.avgTD != null && db.avgTD > 2 ? 'good' : db.avgTD != null && db.avgTD > 1 ? 'mid' : 'low'}">${db.avgTD != null ? db.avgTD.toFixed(2) : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">TD DEFENSE %</span><span class="stat-val ${db.tdDef != null && db.tdDef > 70 ? 'good' : db.tdDef != null && db.tdDef > 50 ? 'mid' : 'low'}">${db.tdDef != null ? db.tdDef + '%' : '...'}</span></div>
          ${(() => {
        const h = db.history || [];
        const wins = h.filter(x => x.result === 'win' && x.method);
        const losses = h.filter(x => x.result === 'loss' && x.method);
        const cm = (arr, re) => arr.filter(x => re.test(x.method || '')).length;
        const wKO = cm(wins, /KO|TKO/i), wSUB = cm(wins, /SUB/i), wDEC = wins.length - wKO - wSUB;
        const lKO = cm(losses, /KO|TKO/i), lSUB = cm(losses, /SUB/i);
        const miniBar = (n, tot, cls, lbl) => {
            if (!tot || !n)
                return '';
            const pct = Math.round(n / tot * 100);
            return `<div class="finish-bar-row"><span class="finish-bar-label">${lbl}</span><div class="finish-bar-wrap"><div class="finish-bar ${cls}" data-fill-width="${pct}%" style="width:0%"></div></div><span class="finish-bar-pct">${n}/${tot}</span></div>`;
        };
        return wins.length + losses.length > 0 ? `
              <div class="stat-row" style="flex-direction:column;align-items:flex-start;gap:2px;margin-top:4px">
                <span class="stat-label">FINISH RATE ${db.finishRate != null ? `<span class="stat-val ${db.finishRate > 0.6 ? 'good' : 'mid'}" style="margin-left:4px">${Math.round(db.finishRate * 100)}%</span>` : ''}</span>
                <div class="finish-split-wrap" style="margin-top:4px">
                  ${wins.length ? `<div class="finish-split-section"><div class="finish-split-header">Wins (${wins.length})</div>${miniBar(wKO, wins.length, 'ko-bar', 'KO/TKO')}${miniBar(wSUB, wins.length, 'sub-bar', 'SUB')}${miniBar(wDEC, wins.length, 'dec-bar', 'DEC')}</div>` : ''}
                  ${losses.length ? `<div class="finish-split-section"><div class="finish-split-header">Losses (${losses.length})</div>${miniBar(lKO, losses.length, 'ko-bar-loss', 'KO/TKO')}${miniBar(lSUB, losses.length, 'sub-bar', 'SUB')}${miniBar(losses.length - lKO - lSUB, losses.length, 'dec-bar', 'DEC')}</div>` : ''}
                </div>
              </div>` : `<div class="stat-row"><span class="stat-label">FINISH RATE</span><span class="stat-val mid">${db.finishRate != null ? Math.round(db.finishRate * 100) + '%' : '...'}</span></div>`;
    })()}
          <div class="stat-row"><span class="stat-label">AVG FP (CALC)</span><span class="stat-val ${(db.avgFP ?? db.avgFP_p6) != null && activeLine != null && (db.avgFP ?? db.avgFP_p6) > activeLine ? 'good' : 'low'}">${db.avgFP != null ? db.avgFP.toFixed(1) : (db.avgFP_p6 != null ? db.avgFP_p6.toFixed(1) : '...')}</span></div>
          <div class="stat-row"><span class="stat-label">W.AVG FP (RECENT)</span><span class="stat-val ${weightedAvg != null && activeLine != null && weightedAvg > activeLine ? 'good' : 'low'}">${weightedAvg != null ? weightedAvg.toFixed(1) : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP FLOOR / CEILING</span><span class="stat-val mid">${db.fpFloor != null ? `${fpFloor} / ${fpCeiling}` : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">FP STD DEV</span><span class="stat-val ${db.fpStdDev != null && db.fpStdDev < 15 ? 'good' : db.fpStdDev != null && db.fpStdDev < 25 ? 'mid' : 'low'}">${db.fpStdDev != null ? db.fpStdDev : '...'}</span></div>
          <div class="stat-row"><span class="stat-label">CONSISTENCY %</span><span class="stat-val ${consistencyClass}">${fpConsistency != null ? fpConsistency + '%' : '...'}</span></div>
          ${db.fiveRoundRate != null && db.fiveRoundRate > 0 ? `<div class="stat-row"><span class="stat-label">5-ROUND FIGHT RATE</span><span class="stat-val mid">${Math.round(db.fiveRoundRate * 100)}%</span></div>` : ''}
          ${db.detailUrl ? `<div class="panel-link-wrap"><a href="${db.detailUrl}" target="_blank" class="panel-link">↗ View on UFCStats</a></div>` : ''}
        </div>
        ${buildArchetypeLearnerPanel(f.name, db, oppEntry?.db || null, f.moneyline ?? null)}
        </div>
        <div class="panel-pair">
        <div class="detail-panel">
          <div class="detail-panel-title">Lean Analysis (FP)</div>
          <div class="lean-reason">${topDriversHTML}${groupedReasonsHTML}</div>
          ${lean.verdict ? `<div class="lean-verdict ${lean.lean}">${lean.verdict}</div>` : ''}
        </div>
        ${buildModelRivalryPanel(lean)}
        </div>
        <div class="panel-pair">
        ${buildFairValuePanel(lean)}
        ${buildPayoutEVPanel(f, lean, leanEvDetail, perBookEv)}
        </div>
        <div class="panel-pair">
        ${buildSimilarOpponentPanel(f.name, db, oppEntry?.db || null, activeLine, platformStatLine(f, 'ss'), platformStatLine(f, 'td'), platformStatLine(f, 'ctrl'))}
        ${buildOpponentQualityPanel(db, activeLine, platformStatLine(f, 'ss'))}
        </div>
        ${buildLineTimelinePanel(f)}
        ${f.lean_ss ? `<div class="detail-panel">
          <div class="detail-panel-title">SS Lean (P6: ${f.line_p6_ss || '—'} · UD: ${f.line_ud_ss || '—'} · PP: ${f.line_pp_ss || '—'})</div>
          <div class="lean-reason">${f.lean_ss.reasons.map(r => `<div class="lean-point"><span class="lean-point-icon ${r.icon === 'pos' ? 'pos' : r.icon === 'neg' ? 'neg' : ''}">${r.icon === 'pos' ? '↑' : r.icon === 'neg' ? '↓' : '→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ss.lean}">${f.lean_ss.verdict}</div>
        </div>` : ''}
        ${(f.lean_ss_r1 && f.lean_ss_r1.lean !== 'push') ? `<div class="detail-panel">
          <div class="detail-panel-title">R1 SS Lean (PP: ${f.line_pp_ss_r1 || '—'} · UD: ${f.line_ud_ss_r1 || '—'})</div>
          <div class="lean-reason">${f.lean_ss_r1.reasons.map(r => `<div class="lean-point"><span class="lean-point-icon ${r.icon === 'pos' ? 'pos' : r.icon === 'neg' ? 'neg' : ''}">${r.icon === 'pos' ? '↑' : r.icon === 'neg' ? '↓' : '→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ss_r1.lean}">${f.lean_ss_r1.verdict}</div>
        </div>` : ''}
        ${f.lean_td ? `<div class="detail-panel">
          <div class="detail-panel-title">TD Lean (P6: ${f.line_p6_td || '—'} · UD: ${f.line_ud_td || '—'} · PP: ${f.line_pp_td || '—'})</div>
          <div class="lean-reason">${f.lean_td.reasons.map(r => `<div class="lean-point"><span class="lean-point-icon ${r.icon === 'pos' ? 'pos' : r.icon === 'neg' ? 'neg' : ''}">${r.icon === 'pos' ? '↑' : r.icon === 'neg' ? '↓' : '→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_td.lean}">${f.lean_td.verdict}</div>
        </div>` : ''}
        ${f.lean_ft ? `<div class="detail-panel">
          <div class="detail-panel-title">FT Lean${f.lean_ft.lean !== 'push' ? ` <span class="lean-verdict ${f.lean_ft.lean}" style="display:inline-block;padding:1px 8px;border-radius:8px;font-size:10px;margin-left:6px">${f.lean_ft.lean === 'over' ? '▲ OVER' : '▼ UNDER'} ${f.lean_ft.conf}%</span>` : ''} · P6: ${f.line_p6_ft || '—'} · UD: ${f.line_ud_ft || '—'} · PP: ${f.line_pp_ft || '—'}</div>
          <div class="lean-reason">${f.lean_ft.reasons.map(r => `<div class="lean-point"><span class="lean-point-icon ${r.icon === 'pos' ? 'pos' : r.icon === 'neg' ? 'neg' : ''}">${r.icon === 'pos' ? '↑' : r.icon === 'neg' ? '↓' : '→'}</span><span>${r.text}</span></div>`).join('')}</div>
          <div class="lean-verdict ${f.lean_ft.lean}">${f.lean_ft.verdict}</div>
        </div>` : ''}
        ${buildStyleMatchupPanel(db, oppEntry?.db || null, platformStatLine(f, 'ss'), platformStatLine(f, 'td'))}
      </div>`);
    // Async fighter headshot — same cached pipeline as the H2H modal.
    // Falls back silently to the flag emoji when no image resolves.
    void fetchFighterImageUrl(f.name)
        .then(url => {
        if (!url)
            return;
        const av = row.querySelector('.fighter-avatar');
        const img = row.querySelector('.fighter-avatar-img');
        if (av && img) {
            img.onload = () => av.classList.add('has-img');
            img.src = url;
        }
    })
        .catch(() => { });
    // Country badge: DK's representing-country code wins (it's what fans expect —
    // Pereira BRA, Topuria GEO), ufc.com birthplace is the fallback.
    const dkCc = resolveFromDkMap(dkCountryByName, f.name);
    if (dkCc) {
        const badge = row.querySelector('.fighter-avatar-country');
        if (badge) {
            badge.textContent = dkCc;
            badge.title = `Representing: ${dkCc} (DK)`;
        }
    }
    else {
        void fetchFighterCountry(f.name)
            .then(c => {
            if (!c)
                return;
            const badge = row.querySelector('.fighter-avatar-country');
            if (badge) {
                badge.textContent = countryShort(c);
                badge.title = c;
            }
        })
            .catch(() => { });
    }
    return row;
}
function expandRowDetailPanel(row) {
    const detail = row.querySelector('.fighter-detail');
    if (!detail)
        return;
    // First expand: build the detail-panel HTML now (deferred from row creation).
    const builder = _pendingDetailBuilders.get(row);
    if (builder) {
        detail.innerHTML = builder();
        _pendingDetailBuilders.delete(row);
    }
    // Animate bars inside the detail panel when expanding.
    // Reset bars to 0 first (in case of re-expand), then fill with stagger.
    detail.querySelectorAll('[data-fill-width]').forEach(bar => {
        bar.style.width = '0%';
    });
    requestAnimationFrame(() => {
        detail.querySelectorAll('[data-fill-width]').forEach((bar, idx) => {
            // Cap stagger total at ~350ms — past that the wave is invisible and the
            // last bar firing 3s late just feels like jank.
            const delay = Math.min(idx * 4, 350);
            setTimeout(() => { bar.style.width = bar.dataset.fillWidth; }, delay);
        });
    });
}
// Cross-view navigation: jump from Best Picks / Line Movers to a fighter's
// card — switches to All Fighters, expands the row, scrolls, and flashes it.
function jumpToFighterCard(name) {
    if (!name)
        return;
    const go = (attempt = 0) => {
        const row = document.querySelector(`.fighter-row[data-name="${CSS.escape(name)}"]`);
        if (!row) {
            if (attempt < 10)
                setTimeout(() => go(attempt + 1), 100);
            return;
        }
        if (!row.classList.contains('expanded'))
            toggleRow(row);
        const y = row.getBoundingClientRect().top + window.scrollY - 150;
        window.scrollTo({ top: y, behavior: 'smooth' });
        row.classList.remove('jump-flash');
        void row.offsetWidth; // restart animation if re-triggered
        row.classList.add('jump-flash');
        setTimeout(() => row.classList.remove('jump-flash'), 1800);
    };
    if (currentView !== 'all') {
        document.querySelector('.tab-btn[data-view="all"]')?.click();
        setTimeout(() => go(), 150);
    }
    else {
        go();
    }
}
function toggleRow(row) {
    const wasExpanded = row.classList.contains('expanded');
    const desiredExpanded = !wasExpanded;
    row.classList.toggle('expanded', desiredExpanded);
    if (desiredExpanded)
        expandRowDetailPanel(row);
    // Paired-row sync: inside a .fight-pair, mirror the expansion on the partner
    // row so both fighters' bar grids show simultaneously for side-by-side
    // comparison. Skips work if the partner is already in the desired state.
    const pair = row.closest('.fight-pair');
    if (pair) {
        const partner = Array.from(pair.querySelectorAll('.fighter-row')).find(r => r !== row);
        if (partner && partner.classList.contains('expanded') !== desiredExpanded) {
            partner.classList.toggle('expanded', desiredExpanded);
            if (desiredExpanded)
                expandRowDetailPanel(partner);
        }
    }
}
// fetchFighterImageUrl extracted to ./analyzer/fighter-image.ts —
// re-imported via the import block above.
// ── HEAD-TO-HEAD MODAL ─────────────────────────────────────────────────────
function renderH2HModal(a, b) {
    const modal = document.getElementById('h2hModal');
    const content = document.getElementById('h2hContent');
    if (!modal || !content)
        return;
    const da = a.db || {};
    const db2 = b.db || {};
    const leanA = getEffectiveLean(a);
    const leanB = getEffectiveLean(b);
    const lineA = activePlatformLine(a);
    const lineB = activePlatformLine(b);
    function leanBadge(lean) {
        if (lean.lean === 'over')
            return `<span class="h2h-lean over">▲ OVER ${lean.conf}%</span>`;
        if (lean.lean === 'under')
            return `<span class="h2h-lean under">▼ UNDER ${lean.conf}%</span>`;
        return `<span class="h2h-lean none">—</span>`;
    }
    function ssLeanBadge(f) {
        const l = f.lean_ss;
        if (!l || l.lean === 'none')
            return '<span class="h2h-lean none">—</span>';
        if (l.lean === 'over')
            return `<span class="h2h-lean over">▲ OVER ${l.conf}%</span>`;
        return `<span class="h2h-lean under">▼ UNDER ${l.conf}%</span>`;
    }
    function tdLeanBadge(f) {
        const l = f.lean_td;
        if (!l || l.lean === 'none')
            return '<span class="h2h-lean none">—</span>';
        if (l.lean === 'over')
            return `<span class="h2h-lean over">▲ OVER ${l.conf}%</span>`;
        return `<span class="h2h-lean under">▼ UNDER ${l.conf}%</span>`;
    }
    // prettier-ignore
    function statRow(label, valA, valB, higherBetter = true) {
        // parseFloat (vs Number) so '48%'-style values still compare + render bars
        const na = valA == null ? null : parseFloat(String(valA));
        const nb = valB == null ? null : parseFloat(String(valB));
        let clsA = '', clsB = '';
        let barHtml = '';
        if (na != null && nb != null && Number.isFinite(na) && Number.isFinite(nb)) {
            if (na !== nb) {
                const aBetter = higherBetter ? na > nb : na < nb;
                clsA = aBetter ? 'h2h-win' : 'h2h-lose';
                clsB = aBetter ? 'h2h-lose' : 'h2h-win';
            }
            // GLOW-UP 33: center-out advantage bar (dominant side fills to 100%)
            const absA = Math.abs(na), absB = Math.abs(nb);
            const maxV = Math.max(absA, absB);
            if (maxV > 0) {
                const wA = Math.round((absA / maxV) * 100);
                const wB = Math.round((absB / maxV) * 100);
                barHtml = `<tr class="h2h-bar-row"><td colspan="3"><div class="h2h-adv-track"><div class="h2h-adv-half a"><i style="width:${wA}%"></i></div><div class="h2h-adv-half b"><i style="width:${wB}%"></i></div></div></td></tr>`;
            }
        }
        const dispA = valA == null ? '—' : String(valA);
        const dispB = valB == null ? '—' : String(valB);
        return `<tr><td class="${clsA}">${dispA}</td><td class="h2h-label">${label}</td><td class="${clsB}">${dispB}</td></tr>${barHtml}`;
    }
    const ssLineA = a.line_p6_ss ?? a.line_ud_ss ?? a.line_pp_ss ?? a.line_betr_ss ?? null;
    const ssLineB = b.line_p6_ss ?? b.line_ud_ss ?? b.line_pp_ss ?? b.line_betr_ss ?? null;
    const tdLineA = a.line_p6_td ?? a.line_ud_td ?? a.line_pp_td ?? a.line_betr_td ?? null;
    const tdLineB = b.line_p6_td ?? b.line_ud_td ?? b.line_pp_td ?? b.line_betr_td ?? null;
    const avgFPA = da.avgFP_weighted ?? da.avgFP ?? null;
    const avgFPB = db2.avgFP_weighted ?? db2.avgFP ?? null;
    const avgSSA = da.avgSigStr != null ? da.avgSigStr : da.avgSS ?? null;
    const avgSSB = db2.avgSigStr != null ? db2.avgSigStr : db2.avgSS ?? null;
    const moneyA = a.moneyline;
    const moneyB = b.moneyline;
    function formatML(ml) {
        if (ml == null || !Number.isFinite(ml))
            return '—';
        return ml > 0 ? `+${ml}` : String(ml);
    }
    content.innerHTML = `
    <div class="h2h-fighters">
      <div class="h2h-fighter-col h2h-side-a">
        <div class="h2h-img-wrap"><img id="h2hImgA" class="h2h-img" src="" alt="${a.name}" /></div>
        <div class="h2h-fighter-name">${a.name}</div>
        <div class="h2h-fighter-record">${da.record || '—'}</div>
      </div>
      <div class="h2h-vs">VS</div>
      <div class="h2h-fighter-col h2h-side-b">
        <div class="h2h-img-wrap"><img id="h2hImgB" class="h2h-img" src="" alt="${b.name}" /></div>
        <div class="h2h-fighter-name">${b.name}</div>
        <div class="h2h-fighter-record">${db2.record || '—'}</div>
      </div>
    </div>
    ${(() => {
        // GLOW-UP 36: DK-implied win probability, vig removed. Only renders when
        // both moneylines are present (they should be, post-DK-API pipeline).
        // Prefer DK's own vig-free trueOdds probabilities; fall back to
        // normalizing the displayed moneylines ourselves.
        const tpA = resolveFromDkMap(dkTrueProbByName, a.name);
        const tpB = resolveFromDkMap(dkTrueProbByName, b.name);
        let rawA, rawB;
        if (tpA != null && tpB != null && tpA > 0 && tpB > 0) {
            rawA = tpA;
            rawB = tpB;
        }
        else {
            const mlA = moneyA, mlB = moneyB;
            if (mlA == null || mlB == null || !Number.isFinite(mlA) || !Number.isFinite(mlB))
                return '';
            const imp = (ml) => ml < 0 ? (-ml) / ((-ml) + 100) : 100 / (ml + 100);
            rawA = imp(mlA);
            rawB = imp(mlB);
        }
        const total = rawA + rawB;
        if (!(total > 0))
            return '';
        const pA = Math.round((rawA / total) * 100);
        const pB = 100 - pA;
        return `<div class="h2h-prob-strip">
        <span class="h2h-prob-val a">${pA}%</span>
        <div class="h2h-prob-track"><i class="a" style="width:${pA}%"></i><i class="b" style="width:${pB}%"></i></div>
        <span class="h2h-prob-val b">${pB}%</span>
      </div>
      <div class="h2h-prob-label">WIN PROBABILITY · DK implied, vig removed</div>`;
    })()}
    ${(() => {
        const hA = resolveFromDkMap(dkBetHandleByName, a.name);
        const hB = resolveFromDkMap(dkBetHandleByName, b.name);
        if (hA == null || hB == null)
            return '';
        return `<div class="h2h-prob-strip h2h-handle-strip">
        <span class="h2h-prob-val a">${hA}%</span>
        <div class="h2h-prob-track h2h-handle-track"><i class="a" style="width:${hA}%"></i><i class="b" style="width:${hB}%"></i></div>
        <span class="h2h-prob-val b">${hB}%</span>
      </div>
      <div class="h2h-prob-label">% OF BETS PLACED · DK public money</div>`;
    })()}
    <div class="h2h-common">${spineCommonOppsHTML(a, b)}</div>
    <table class="h2h-table">
      <thead><tr><th class="h2h-side-a">${a.name.split(' ').pop()}</th><th></th><th class="h2h-side-b">${b.name.split(' ').pop()}</th></tr></thead>
      <tbody>
        <tr><td>${da.style || '—'}</td><td class="h2h-label">STYLE</td><td>${db2.style || '—'}</td></tr>
        <tr><td id="h2hCountryA">—</td><td class="h2h-label">COUNTRY</td><td id="h2hCountryB">—</td></tr>
        <tr><td colspan="3" class="h2h-section-head">LINES</td></tr>
        <tr><td>${lineA != null ? lineA : '—'}</td><td class="h2h-label">FP LINE</td><td>${lineB != null ? lineB : '—'}</td></tr>
        <tr><td>${ssLineA != null ? ssLineA : '—'}</td><td class="h2h-label">SS LINE</td><td>${ssLineB != null ? ssLineB : '—'}</td></tr>
        <tr><td>${tdLineA != null ? tdLineA : '—'}</td><td class="h2h-label">TD LINE</td><td>${tdLineB != null ? tdLineB : '—'}</td></tr>
        <tr><td>${formatML(moneyA)}</td><td class="h2h-label">MONEYLINE</td><td>${formatML(moneyB)}</td></tr>
        <tr><td colspan="3" class="h2h-section-head">PROJECTIONS</td></tr>
        ${statRow('AVG FP (W)', avgFPA != null ? avgFPA.toFixed(1) : null, avgFPB != null ? avgFPB.toFixed(1) : null)}
        ${statRow('FP FLOOR', da.fpFloor != null ? da.fpFloor.toFixed(1) : null, db2.fpFloor != null ? db2.fpFloor.toFixed(1) : null)}
        ${statRow('FP CEILING', da.fpCeiling != null ? da.fpCeiling.toFixed(1) : null, db2.fpCeiling != null ? db2.fpCeiling.toFixed(1) : null)}
        ${statRow('FP STD DEV', da.fpStdDev ?? null, db2.fpStdDev ?? null, false)}
        ${statRow('CONSISTENCY', da.fpConsistency != null ? da.fpConsistency + '%' : null, db2.fpConsistency != null ? db2.fpConsistency + '%' : null)}
        <tr><td colspan="3" class="h2h-section-head">STRIKING</td></tr>
        ${statRow('AVG SIG STR', avgSSA != null ? avgSSA.toFixed(1) : null, avgSSB != null ? avgSSB.toFixed(1) : null)}
        ${statRow('SLpM', da.slpm != null ? da.slpm.toFixed(2) : null, db2.slpm != null ? db2.slpm.toFixed(2) : null)}
        ${statRow('STR ACC %', da.strAcc != null ? da.strAcc + '%' : null, db2.strAcc != null ? db2.strAcc + '%' : null)}
        ${statRow('STR DEF %', da.strDef != null ? da.strDef + '%' : null, db2.strDef != null ? db2.strDef + '%' : null)}
        <tr><td colspan="3" class="h2h-section-head">GRAPPLING</td></tr>
        ${statRow('TD AVG/15', da.avgTD != null ? da.avgTD.toFixed(2) : null, db2.avgTD != null ? db2.avgTD.toFixed(2) : null)}
        ${statRow('TD ACC %', da.tdAcc != null ? da.tdAcc + '%' : null, db2.tdAcc != null ? db2.tdAcc + '%' : null)}
        ${statRow('TD DEF %', da.tdDef != null ? da.tdDef + '%' : null, db2.tdDef != null ? db2.tdDef + '%' : null)}
        <tr><td colspan="3" class="h2h-section-head">LEANS</td></tr>
        <tr><td>${leanBadge(leanA)}</td><td class="h2h-label">FP LEAN</td><td>${leanBadge(leanB)}</td></tr>
        <tr><td>${ssLeanBadge(a)}</td><td class="h2h-label">SS LEAN</td><td>${ssLeanBadge(b)}</td></tr>
        <tr><td>${tdLeanBadge(a)}</td><td class="h2h-label">TD LEAN</td><td>${tdLeanBadge(b)}</td></tr>
        ${da.finishRate != null || db2.finishRate != null ? statRow('FINISH RATE', da.finishRate != null ? Math.round(da.finishRate * 100) + '%' : null, db2.finishRate != null ? Math.round(db2.finishRate * 100) + '%' : null) : ''}
      </tbody>
    </table>`;
    modal.classList.remove('is-hidden');
    // Async load fighter images
    void Promise.all([fetchFighterImageUrl(a.name), fetchFighterImageUrl(b.name)]).then(([urlA, urlB]) => {
        const imgA = document.getElementById('h2hImgA');
        const imgB = document.getElementById('h2hImgB');
        if (imgA && urlA) {
            imgA.src = urlA;
            imgA.style.display = 'block';
        }
        if (imgB && urlB) {
            imgB.src = urlB;
            imgB.style.display = 'block';
        }
        // Country names from the same athlete pages
        void fetchFighterCountry(a.name).then(c => { const el = document.getElementById('h2hCountryA'); if (el && c)
            el.textContent = c; });
        void fetchFighterCountry(b.name).then(c => { const el = document.getElementById('h2hCountryB'); if (el && c)
            el.textContent = c; });
    });
}
// ── DATA LOADING ──────────────────────────────────────────────────────────
// NAME_ALIASES now lives in config/index.ts (shared with background.ts's settle
// path). Add new aliases there, not here.
function normalizeName(name) {
    if (!name || name === 'null' || name === 'undefined')
        return null;
    let n = name.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim();
    // Strip diacritics so "Vin\u00EDcius" matches "Vinicius" (UFCStats/card uses plain ASCII).
    n = n.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
    // Drop platform country tags like "Andre (Bra) Lima" \u2192 "Andre Lima".
    n = n.replace(/\([^)]*\)/g, ' ');
    n = n.replace(/\./g, '').replace(/-/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
    n = n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return NAME_ALIASES[n] || n;
}
function dedup(str) { return str.replace(/(.)\1+/g, '$1'); }
function namesMatch(a, b) {
    if (a === b)
        return true;
    const aParts = a.split(' '), bParts = b.split(' ');
    const aFirst = aParts[0], aLast = aParts[aParts.length - 1];
    const bFirst = bParts[0], bLast = bParts[bParts.length - 1];
    if (aLast === bLast && aFirst[0] === bFirst[0])
        return true;
    if (dedup(a.toLowerCase()) === dedup(b.toLowerCase()))
        return true;
    if (aLast === bLast && (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst)))
        return true;
    if (a.startsWith(b + ' ') || b.startsWith(a + ' '))
        return true;
    // Shared surname alone is NOT identity when both sides have full, differing
    // first names: "Michael Chandler" ≠ "Chelsea Chandler". Only treat a surname
    // match as the same fighter when one first name is an abbreviation/initial
    // (e.g. "C Chandler" → "Chelsea Chandler") or the initials agree.
    if (aLast === bLast && aLast.length > 4) {
        const aAbbrev = aFirst.length <= 2 || aFirst.endsWith('.');
        const bAbbrev = bFirst.length <= 2 || bFirst.endsWith('.');
        if (aAbbrev || bAbbrev || aFirst[0] === bFirst[0])
            return true;
    }
    return false;
}
function resolveFromDkMap(map, name) {
    const normalized = normalizeName(name);
    if (!normalized)
        return null;
    if (map[normalized] !== undefined)
        return map[normalized];
    for (const [k, v] of Object.entries(map)) {
        if (namesMatch(k, normalized))
            return v;
    }
    return null;
}
function resolveMoneylineFromMap(name) {
    const normalized = normalizeName(name);
    if (!normalized)
        return null;
    const direct = fightOddsMoneylineByName[normalized];
    if (Number.isFinite(direct))
        return direct;
    for (const [oddsName, odds] of Object.entries(fightOddsMoneylineByName)) {
        if (namesMatch(oddsName, normalized))
            return odds;
    }
    return null;
}
function createMergedLineEntry(name) {
    return {
        name,
        line_p6: null,
        line_p6_ss: null,
        line_p6_td: null,
        line_p6_ft: null,
        line_p6_ctrl: null,
        line_ud: null,
        line_ud_ss: null,
        line_ud_ss_r1: null,
        line_ud_ss_body: null,
        line_ud_ss_leg: null,
        line_ud_td: null,
        line_ud_ft: null,
        line_ud_ctrl: null,
        line_pp: null,
        line_pp_ss: null,
        line_pp_ss_r1: null,
        line_pp_ss_body: null,
        line_pp_ss_leg: null,
        line_pp_td: null,
        line_pp_ft: null,
        line_pp_ctrl: null,
        line_dk_ss: null,
        line_dk_td: null,
        line_dk_ft: null,
        line_dk_ctrl: null,
        ss_over_odds: null,
        ss_under_odds: null,
        td_over_odds: null,
        td_under_odds: null,
        ft_over_odds: null,
        ft_under_odds: null,
        ctrl_over_odds: null,
        ctrl_under_odds: null,
        ctrl_under_available: null,
        ss_under_available: null,
        td_under_available: null,
        fp_under_available: null,
        ud_ss_over_avail: null,
        ud_ss_under_avail: null,
        ud_td_over_avail: null,
        ud_td_under_avail: null,
        ud_ft_over_avail: null,
        ud_ft_under_avail: null,
        line_betr: null,
        line_betr_ss: null,
        line_betr_td: null,
        line_betr_ft: null,
        line_betr_ctrl: null,
        moneyline: null,
        opponent: null,
    };
}
async function mergeAndEnrich(p6Fighters, udFighters, betrFighters, ppFighters = [], dkFighters = []) {
    debugLog(`P6 fighters (${(p6Fighters || []).length}): ${(p6Fighters || []).map((f) => f.name).join(', ')}`);
    debugLog(`UD fighters (${(udFighters || []).length}): ${(udFighters || []).map((f) => f.name).join(', ')}`);
    const map = {};
    function isValidFighterName(name) {
        if (!name || typeof name !== 'string')
            return false;
        if (name.includes(':'))
            return false; // event / prop labels
        // Validate the NORMALIZED name: normalizeName strips country tags ("Andre (Bra) Lima")
        // and collapses verbose/aliased forms ("Vinicius De Oliveira Prestes De Matos" →
        // "Vinicius Oliveira"). Validating the raw name dropped both before they could attach.
        const norm = normalizeName(name);
        if (!norm)
            return false;
        if (norm.length < 4 || norm.length > 50)
            return false;
        const words = norm.trim().split(/\s+/);
        if (words.length < 2 || words.length > 5)
            return false;
        if (!/^[A-Z]/.test(norm))
            return false;
        return true;
    }
    // Takedown lines are physically bounded (UFC single-fight record ~21; real prop
    // lines sit at 0.5–6.5). Some scraper paths (UD/secondary) lack the range guard
    // Pick6 has, letting an SS-magnitude value (e.g. 59.5) land in a *_td field and
    // surface as a bogus "TD UNDER 59.5". Sanitize every TD assignment at merge so it
    // also cleans already-stored stale lines without needing a fresh re-fetch.
    const plausibleTd = (v) => (v != null && Number.isFinite(v) && v >= 0 && v < 20) ? v : null;
    (p6Fighters || []).forEach((f) => {
        if (!isValidFighterName(f.name))
            return;
        const n = normalizeName(f.name);
        if (!n)
            return;
        if (!map[n])
            map[n] = createMergedLineEntry(n);
        map[n].line_p6 = f.line_fp ?? f.line ?? null;
        map[n].line_p6_ss = f.line_ss ?? null;
        map[n].line_p6_td = plausibleTd(f.line_td);
        map[n].line_p6_ft = f.line_ft ?? null;
        map[n].line_p6_ctrl = f.line_ctrl ?? null;
        if (f.ss_over_odds != null)
            map[n].ss_over_odds = f.ss_over_odds;
        if (f.ss_under_odds != null)
            map[n].ss_under_odds = f.ss_under_odds;
        if (f.td_over_odds != null)
            map[n].td_over_odds = f.td_over_odds;
        if (f.td_under_odds != null)
            map[n].td_under_odds = f.td_under_odds;
        if (f.ft_over_odds != null)
            map[n].ft_over_odds = f.ft_over_odds;
        if (f.ft_under_odds != null)
            map[n].ft_under_odds = f.ft_under_odds;
        if (f.ctrl_over_odds != null)
            map[n].ctrl_over_odds = f.ctrl_over_odds;
        if (f.ctrl_under_odds != null)
            map[n].ctrl_under_odds = f.ctrl_under_odds;
        if (f.ctrl_under_available != null)
            map[n].ctrl_under_available = f.ctrl_under_available;
        if (f.ss_under_available != null)
            map[n].ss_under_available = f.ss_under_available;
        if (f.td_under_available != null)
            map[n].td_under_available = f.td_under_available;
        if (f.fp_under_available != null)
            map[n].fp_under_available = f.fp_under_available;
        if (f.opponent)
            map[n].opponent = normalizeName(f.opponent);
    });
    function findOrCreateEntry(n) {
        if (map[n])
            return map[n];
        const existing = Object.keys(map).find(k => namesMatch(k, n));
        if (existing) {
            if (existing !== n)
                debugLog(`Fuzzy merge: "${n}" → "${existing}"`);
            return map[existing];
        }
        debugLog(`UD-only (no P6 match): "${n}"`);
        map[n] = createMergedLineEntry(n);
        return map[n];
    }
    // Card pairs store fighters in UFCStats' full form ("Norma Dumont Viana"),
    // but platforms scrape short form ("Norma Dumont"). If we assign the full
    // form to entry.opponent, the reciprocal prune compares it against the map
    // key and drops the fighter. Canonicalize to whichever form is already in
    // the map.
    function canonicalizeCardOpponent(cardOpp) {
        if (map[cardOpp])
            return cardOpp;
        for (const k of Object.keys(map)) {
            if (strictCardNameMatch(k, cardOpp))
                return k;
        }
        return cardOpp;
    }
    (udFighters || []).forEach((f) => {
        if (!isValidFighterName(f.name))
            return;
        const n = normalizeName(f.name);
        if (!n)
            return;
        const entry = findOrCreateEntry(n);
        entry.line_ud = f.line_fp ?? f.line ?? null;
        entry.line_ud_ss = f.line_ss ?? null;
        entry.line_ud_ss_r1 = f.line_ss_r1 ?? null;
        entry.line_ud_ss_body = f.line_ss_body ?? null;
        entry.line_ud_ss_leg = f.line_ss_leg ?? null;
        entry.line_ud_td = plausibleTd(f.line_td);
        entry.line_ud_ft = f.line_ft ?? null;
        entry.line_ud_ctrl = f.line_ctrl ?? null;
        if (f.ss_over_odds != null)
            entry.ss_over_odds = f.ss_over_odds;
        if (f.ss_under_odds != null)
            entry.ss_under_odds = f.ss_under_odds;
        if (f.td_over_odds != null)
            entry.td_over_odds = f.td_over_odds;
        if (f.td_under_odds != null)
            entry.td_under_odds = f.td_under_odds;
        if (f.ft_over_odds != null)
            entry.ft_over_odds = f.ft_over_odds;
        if (f.ft_under_odds != null)
            entry.ft_under_odds = f.ft_under_odds;
        if (f.ctrl_over_odds != null)
            entry.ctrl_over_odds = f.ctrl_over_odds;
        if (f.ctrl_under_odds != null)
            entry.ctrl_under_odds = f.ctrl_under_odds;
        if (f.ud_ss_over_avail != null)
            entry.ud_ss_over_avail = f.ud_ss_over_avail;
        if (f.ud_ss_under_avail != null)
            entry.ud_ss_under_avail = f.ud_ss_under_avail;
        if (f.ud_td_over_avail != null)
            entry.ud_td_over_avail = f.ud_td_over_avail;
        if (f.ud_td_under_avail != null)
            entry.ud_td_under_avail = f.ud_td_under_avail;
        if (f.ud_ft_over_avail != null)
            entry.ud_ft_over_avail = f.ud_ft_over_avail;
        if (f.ud_ft_under_avail != null)
            entry.ud_ft_under_avail = f.ud_ft_under_avail;
        if (f.opponent)
            entry.opponent = normalizeName(f.opponent);
    });
    (betrFighters || []).forEach((f) => {
        if (!isValidFighterName(f.name))
            return;
        const n = normalizeName(f.name);
        if (!n)
            return;
        const entry = findOrCreateEntry(n);
        entry.line_betr = f.line_fp ?? f.line ?? null;
        entry.line_betr_ss = f.line_ss ?? null;
        entry.line_betr_td = plausibleTd(f.line_td);
        entry.line_betr_ft = f.line_ft ?? null;
        entry.line_betr_ctrl = f.line_ctrl ?? null;
        if (f.opponent) {
            const normalizedOpp = normalizeName(f.opponent);
            // Resolve abbreviated Betr opponent (e.g. "B. Ribeiro") to the canonical map key
            // (e.g. "brendson ribeiro") so the reciprocal-opponent prune doesn't discard them.
            const resolvedOpp = (normalizedOpp && (Object.keys(map).find(k => namesMatch(k, normalizedOpp)) || normalizedOpp)) || null;
            // Only overwrite if we don't already have a longer (more complete) opponent name.
            if (resolvedOpp && (!entry.opponent || resolvedOpp.length > entry.opponent.length)) {
                entry.opponent = resolvedOpp;
            }
        }
        // Betr lines are entered manually without opponents — look them up from the
        // upcoming card so the fighter survives the missing-opponent prune below.
        if (!entry.opponent) {
            const cardOpp = findOpponentFromUpcomingCard(n);
            if (cardOpp)
                entry.opponent = canonicalizeCardOpponent(cardOpp);
        }
    });
    (ppFighters || []).forEach((f) => {
        if (!isValidFighterName(f.name))
            return;
        const n = normalizeName(f.name);
        if (!n)
            return;
        const entry = findOrCreateEntry(n);
        entry.line_pp = f.line_fp ?? f.line ?? null;
        entry.line_pp_ss = f.line_ss ?? null;
        entry.line_pp_ss_r1 = f.line_ss_r1 ?? null;
        entry.line_pp_ss_body = f.line_ss_body ?? null;
        entry.line_pp_ss_leg = f.line_ss_leg ?? null;
        entry.line_pp_td = plausibleTd(f.line_td);
        entry.line_pp_ft = f.line_ft ?? null;
        entry.line_pp_ctrl = f.line_ctrl ?? null;
        if (f.opponent)
            entry.opponent = normalizeName(f.opponent);
    });
    (dkFighters || []).forEach((f) => {
        if (!isValidFighterName(f.name))
            return;
        const n = normalizeName(f.name);
        if (!n)
            return;
        const entry = findOrCreateEntry(n);
        entry.line_dk_ss = f.line_ss ?? null;
        entry.line_dk_td = plausibleTd(f.line_td);
        entry.line_dk_ft = f.line_ft ?? null;
        entry.line_dk_ctrl = f.line_ctrl ?? null;
        if (f.ss_over_odds != null)
            entry.ss_over_odds = f.ss_over_odds;
        if (f.ss_under_odds != null)
            entry.ss_under_odds = f.ss_under_odds;
        if (f.td_over_odds != null)
            entry.td_over_odds = f.td_over_odds;
        if (f.td_under_odds != null)
            entry.td_under_odds = f.td_under_odds;
        if (f.ft_over_odds != null)
            entry.ft_over_odds = f.ft_over_odds;
        if (f.ft_under_odds != null)
            entry.ft_under_odds = f.ft_under_odds;
        if (f.ctrl_over_odds != null)
            entry.ctrl_over_odds = f.ctrl_over_odds;
        if (f.ctrl_under_odds != null)
            entry.ctrl_under_odds = f.ctrl_under_odds;
        if (f.opponent)
            entry.opponent = normalizeName(f.opponent);
    });
    // Inject empty placeholder entries for upcoming-card fighters not yet present
    // in any platform-line scrape (late additions, debutees before books post props).
    // Without these, half-resolved pairs collapse a slot in orderFightersByCard and
    // its positional i%2 fight-badge grouping cascades wrong pairings downstream.
    for (const cp of upcomingCardPairs) {
        for (const [self, opp] of [[cp.f1, cp.f2], [cp.f2, cp.f1]]) {
            if (map[self])
                continue;
            if (Object.keys(map).some(k => namesMatch(k, self)))
                continue;
            const placeholder = createMergedLineEntry(self);
            placeholder.opponent = opp;
            map[self] = placeholder;
        }
    }
    Object.values(map).forEach((entry) => {
        entry.moneyline = resolveMoneylineFromMap(entry.name);
        // Fallback: if no platform provided an opponent, try the upcoming card
        if (!entry.opponent) {
            const cardOpp = findOpponentFromUpcomingCard(entry.name);
            debugLog(`Card opp fallback: "${entry.name}" → opp="${cardOpp}" (cardPairs=${upcomingCardPairs.length})`);
            if (cardOpp)
                entry.opponent = canonicalizeCardOpponent(cardOpp);
        }
    });
    // Final canonicalization sweep: platforms sometimes scrape an opponent in a
    // different form than that opponent's own entry key (e.g. Joselyne's opp
    // comes through as "Norma Dumont Viana" while Norma's own entry key is
    // "Norma Dumont"). Left unresolved, the reciprocal-opponent prune below
    // compares the two strings literally and drops Norma. Rewrite every
    // entry.opponent to the matching map key whenever a strictCardNameMatch
    // candidate exists.
    Object.values(map).forEach((entry) => {
        if (!entry.opponent || map[entry.opponent])
            return;
        const canonical = Object.keys(map).find(k => strictCardNameMatch(k, entry.opponent));
        if (canonical) {
            debugLog(`Canonicalized opp: "${entry.name}" opp "${entry.opponent}" → "${canonical}"`);
            entry.opponent = canonical;
        }
    });
    const initialEntries = Object.values(map);
    let mergedEntries = initialEntries;
    if (initialEntries.length >= 6) {
        const beforeMissingOppPrune = mergedEntries.length;
        mergedEntries = mergedEntries.filter((entry) => {
            const opp = normalizeName(entry.opponent || '');
            return !!opp && opp !== entry.name;
        });
        if (mergedEntries.length >= 4) {
            debugLog(`Pruned missing-opponent fighters: ${beforeMissingOppPrune} -> ${mergedEntries.length}`);
        }
        else {
            // If source is too sparse, avoid wiping nearly everything.
            mergedEntries = initialEntries;
        }
    }
    if (mergedEntries.length >= 6) {
        const byName = new Map(mergedEntries.map((e) => [e.name, e]));
        const beforeReciprocalPrune = mergedEntries.length;
        mergedEntries = mergedEntries.filter((entry) => {
            const opp = normalizeName(entry.opponent || '');
            if (!opp)
                return false;
            const oppEntry = byName.get(opp);
            if (!oppEntry) {
                // Opponent has no lines but is on the upcoming card — keep this fighter
                return isUpcomingCardFighter(entry.name);
            }
            const oppOpp = normalizeName(oppEntry.opponent || '');
            return oppOpp === entry.name;
        });
        if (mergedEntries.length >= 4) {
            debugLog(`Pruned orphan fighters: ${beforeReciprocalPrune} -> ${mergedEntries.length}`);
        }
        else {
            // Avoid over-pruning if source data is too sparse/noisy.
            mergedEntries = initialEntries;
        }
    }
    if (mergedEntries.length >= 12) {
        const byName = new Map(mergedEntries.map((e) => [e.name, e]));
        const neighbors = new Map();
        mergedEntries.forEach((e) => neighbors.set(e.name, new Set()));
        for (const e of mergedEntries) {
            const opp = normalizeName(e.opponent || '');
            if (!opp)
                continue;
            if (!byName.has(opp))
                continue;
            neighbors.get(e.name)?.add(opp);
            neighbors.get(opp)?.add(e.name);
        }
        const visited = new Set();
        const components = [];
        for (const name of byName.keys()) {
            if (visited.has(name))
                continue;
            const queue = [name];
            const comp = [];
            visited.add(name);
            while (queue.length) {
                const cur = queue.shift();
                comp.push(cur);
                for (const nxt of neighbors.get(cur) || []) {
                    if (!visited.has(nxt)) {
                        visited.add(nxt);
                        queue.push(nxt);
                    }
                }
            }
            components.push(comp);
        }
        components.sort((a, b) => b.length - a.length);
        const largest = components[0] || [];
        const second = components[1] || [];
        if (largest.length >= 8 && (second.length === 0 || largest.length >= second.length + 4)) {
            // Keep largest cluster, but rescue any smaller-cluster fighters that are on the
            // upcoming card. Without this, real fighters get pruned when their opponent-name
            // normalization differs across platforms (e.g. "Norma Dumont" vs "Norma Dumont Viana"),
            // because byName.get(opp) fails and they end up in a small disconnected island.
            const keep = new Set(largest);
            for (let i = 1; i < components.length; i++) {
                for (const name of components[i]) {
                    if (isUpcomingCardFighter(name))
                        keep.add(name);
                }
            }
            const before = mergedEntries.length;
            mergedEntries = mergedEntries.filter((e) => keep.has(e.name));
            debugLog(`Pruned side clusters: ${before} -> ${mergedEntries.length} (largest=${largest.length}, next=${second.length}, rescued=${keep.size - largest.length})`);
        }
    }
    allFighters = mergedEntries.map((f) => ({ ...f, db: { loaded: false }, lean: createEmptyLean() }));
    renderFighters();
    let entries = mergedEntries;
    const dbResults = await Promise.all(entries.map((f) => fetchFighterStats(f.name)));
    const dbMap = {};
    entries.forEach((f, i) => { dbMap[f.name] = dbResults[i]; });
    const loadedCount = entries.filter((f) => !!dbMap[f.name]?.loaded).length;
    if (entries.length >= 12 && loadedCount >= 8) {
        const before = entries.length;
        // Keep fighters that have real lines from any platform even if UFCStats lookup failed
        const hasRealLines = (f) => f.line_p6 != null || f.line_ud != null || f.line_betr != null ||
            f.line_pp != null || f.line_p6_ss != null || f.line_ud_ss != null ||
            f.line_betr_ss != null || f.line_pp_ss != null || f.line_dk_ss != null;
        // When the upcoming card is known, it's the authority: drop fighters who aren't on it even
        // if they have lines. Platforms post far-future marquee bouts (next month's UFC 329 Max
        // Holloway vs Conor McGregor) and stale finished-event lines; without this gate those leak
        // onto the slate. strictCardNameMatch tolerates platform name variants, so real card
        // fighters survive. Falls back to the line/lookup heuristic only when the card is unknown.
        const cardKnown = upcomingCardPairs.length > 0;
        const pruned = cardKnown
            ? entries.filter((f) => isUpcomingCardFighter(f.name))
            : entries.filter((f) => !!dbMap[f.name]?.loaded || hasRealLines(f));
        if (pruned.length >= 8) {
            entries = pruned;
            const keep = new Set(entries.map((e) => e.name));
            allFighters = allFighters.filter((f) => keep.has(f.name));
            debugLog(`Pruned unresolved UFCStats fighters (kept those with lines): ${before} -> ${entries.length}`);
            renderFighters();
        }
    }
    const paired = new Set();
    entries.forEach((f) => {
        if (paired.has(f.name))
            return;
        const oppName = f.opponent;
        let opp = null;
        if (oppName) {
            opp = entries.find((x) => x.name !== f.name && x.name === oppName)
                || entries.find((x) => x.name !== f.name && x.name.toLowerCase() === oppName.toLowerCase())
                || entries.find((x) => {
                    if (x.name === f.name)
                        return false;
                    const xLast = x.name.split(' ').pop()?.toLowerCase() || '';
                    const oppLast = oppName.split(' ').pop()?.toLowerCase() || '';
                    return xLast === oppLast && xLast.length > 3;
                })
                || null;
        }
        const dbA = dbMap[f.name];
        const dbB = opp ? dbMap[opp.name] : null;
        if (opp) {
            const idxA = allFighters.findIndex((x) => x.name === f.name);
            const idxB = allFighters.findIndex((x) => x.name === opp.name);
            if (idxA >= 0)
                allFighters[idxA].opponent = opp.name;
            if (idxB >= 0)
                allFighters[idxB].opponent = f.name;
        }
        const lineA_p6 = f.line_p6 ?? null;
        const lineA_ud = f.line_ud ?? null;
        const lineA_pp = f.line_pp ?? null;
        const lineA_betr = f.line_betr ?? null;
        const moneylineA = f.moneyline ?? null;
        const lineB_p6 = opp ? (opp.line_p6 ?? null) : null;
        const lineB_ud = opp ? (opp.line_ud ?? null) : null;
        const lineB_pp = opp ? (opp.line_pp ?? null) : null;
        const lineB_betr = opp ? (opp.line_betr ?? null) : null;
        const moneylineB = opp ? (opp.moneyline ?? null) : null;
        const leanA = calcLean(f.name, dbA, lineA_p6, lineA_ud, lineA_pp, lineA_betr, moneylineA, dbB, lineB_p6, lineB_ud, lineB_pp, lineB_betr, moneylineB);
        const leanB = opp ? calcLean(opp.name, dbB, lineB_p6, lineB_ud, lineB_pp, lineB_betr, moneylineB, dbA, lineA_p6, lineA_ud, lineA_pp, lineA_betr, moneylineA) : null;
        applyLean(f, dbA, leanA);
        if (opp && leanB)
            applyLean(opp, dbB, leanB);
        const ssLineA = f.line_p6_ss ?? f.line_ud_ss ?? f.line_pp_ss ?? f.line_betr_ss ?? f.line_dk_ss ?? null;
        const tdLineA = f.line_p6_td ?? f.line_ud_td ?? f.line_pp_td ?? f.line_betr_td ?? f.line_dk_td ?? null;
        const ftLineA = f.line_p6_ft ?? f.line_ud_ft ?? f.line_pp_ft ?? f.line_betr_ft ?? f.line_dk_ft ?? null;
        const ctrlLineA = f.line_p6_ctrl ?? f.line_ud_ctrl ?? f.line_pp_ctrl ?? f.line_betr_ctrl ?? f.line_dk_ctrl ?? null;
        const ssLinesA = [f.line_p6_ss, f.line_ud_ss, f.line_pp_ss, f.line_betr_ss, f.line_dk_ss].filter((value) => value != null);
        const tdLinesA = [f.line_p6_td, f.line_ud_td, f.line_pp_td, f.line_betr_td, f.line_dk_td].filter((value) => value != null);
        const ftLinesA = [f.line_p6_ft, f.line_ud_ft, f.line_pp_ft, f.line_betr_ft, f.line_dk_ft].filter((value) => value != null);
        const ctrlLinesA = [f.line_p6_ctrl, f.line_ud_ctrl, f.line_pp_ctrl, f.line_betr_ctrl, f.line_dk_ctrl].filter((value) => value != null);
        const ssR1LinesA = [f.line_pp_ss_r1, f.line_ud_ss_r1].filter((value) => value != null);
        const leanSSA = calcSSLean(f.name, dbA, ssLineA, dbB, f.line_dk_ss ?? null, ssLinesA, moneylineA);
        const leanSSR1A = calcSSR1Lean(f.name, dbA, ssR1LinesA, dbB, moneylineA);
        const leanTDA = calcTDLean(f.name, dbA, tdLineA, dbB, f.line_dk_td ?? null, tdLinesA, moneylineA);
        const leanFTA = calcFTLean(f.name, dbA, ftLineA, dbB, f.line_dk_ft ?? null, ftLinesA, moneylineA);
        const leanCTRLA = calcCTRLLean(f.name, dbA, ctrlLineA, dbB, f.line_dk_ctrl ?? null, ctrlLinesA, moneylineA, f.ctrl_under_available ?? null);
        updateFighterLeans(f.name, leanSSA, leanTDA, leanFTA, leanCTRLA, leanSSR1A);
        if (opp) {
            const ssLineB = opp.line_p6_ss ?? opp.line_ud_ss ?? opp.line_pp_ss ?? opp.line_betr_ss ?? opp.line_dk_ss ?? null;
            const tdLineB = opp.line_p6_td ?? opp.line_ud_td ?? opp.line_pp_td ?? opp.line_betr_td ?? opp.line_dk_td ?? null;
            const ftLineB = opp.line_p6_ft ?? opp.line_ud_ft ?? opp.line_pp_ft ?? opp.line_betr_ft ?? opp.line_dk_ft ?? null;
            const ctrlLineB = opp.line_p6_ctrl ?? opp.line_ud_ctrl ?? opp.line_pp_ctrl ?? opp.line_betr_ctrl ?? opp.line_dk_ctrl ?? null;
            const ssLinesB = [opp.line_p6_ss, opp.line_ud_ss, opp.line_pp_ss, opp.line_betr_ss, opp.line_dk_ss].filter((value) => value != null);
            const tdLinesB = [opp.line_p6_td, opp.line_ud_td, opp.line_pp_td, opp.line_betr_td, opp.line_dk_td].filter((value) => value != null);
            const ftLinesB = [opp.line_p6_ft, opp.line_ud_ft, opp.line_pp_ft, opp.line_betr_ft, opp.line_dk_ft].filter((value) => value != null);
            const ctrlLinesB = [opp.line_p6_ctrl, opp.line_ud_ctrl, opp.line_pp_ctrl, opp.line_betr_ctrl, opp.line_dk_ctrl].filter((value) => value != null);
            const ssR1LinesB = [opp.line_pp_ss_r1, opp.line_ud_ss_r1].filter((value) => value != null);
            const leanSSB = calcSSLean(opp.name, dbB, ssLineB, dbA, opp.line_dk_ss ?? null, ssLinesB, moneylineB);
            const leanSSR1B = calcSSR1Lean(opp.name, dbB, ssR1LinesB, dbA, moneylineB);
            const leanTDB = calcTDLean(opp.name, dbB, tdLineB, dbA, opp.line_dk_td ?? null, tdLinesB, moneylineB);
            const leanFTB = calcFTLean(opp.name, dbB, ftLineB, dbA, opp.line_dk_ft ?? null, ftLinesB, moneylineB);
            const leanCTRLB = calcCTRLLean(opp.name, dbB, ctrlLineB, dbA, opp.line_dk_ctrl ?? null, ctrlLinesB, moneylineB, opp.ctrl_under_available ?? null);
            updateFighterLeans(opp.name, leanSSB, leanTDB, leanFTB, leanCTRLB, leanSSR1B);
        }
        paired.add(f.name);
        if (opp)
            paired.add(opp.name);
    });
    // Fill in missing opponent display names from the upcoming card
    const noOppBefore = allFighters.filter(f => !f.opponent).map(f => f.name);
    allFighters.forEach((f) => {
        if (!f.opponent) {
            const cardOpp = findOpponentFromUpcomingCard(f.name);
            if (cardOpp)
                f.opponent = cardOpp;
        }
    });
    const noOppAfter = allFighters.filter(f => !f.opponent).map(f => f.name);
    if (noOppBefore.length)
        debugLog(`Post-pair opp fix: before=${JSON.stringify(noOppBefore)} after=${JSON.stringify(noOppAfter)} cardPairs=${upcomingCardPairs.length}`);
    debugLog('DEBUG fighters: ' + JSON.stringify(allFighters.map((f) => ({ name: f.name, opponent: f.opponent || null })), null, 2));
    void initRecalibrationMap();
    void initPlatformBiasCache();
    void loadBayesianPriors();
    renderFighters();
    renderLineMovementSummary();
    void persistAiLeanSnapshot(allFighters);
    void fetchAllFighterNews();
}
/** Lightweight init to populate the recalibration map without rendering the full calibration panel. */
async function initRecalibrationMap() {
    if (_recalibrationMap && _recalibrationMap.size >= 2)
        return; // already populated
    try {
        const [archivePayload, aiSnapshotPayload] = await Promise.all([
            storageGet([STORAGE_PROP_ARCHIVE_KEY]),
            storageGet([STORAGE_AI_LEAN_SNAPSHOT_KEY]),
        ]);
        const allRows = Array.isArray(archivePayload[STORAGE_PROP_ARCHIVE_KEY])
            ? archivePayload[STORAGE_PROP_ARCHIVE_KEY] : [];
        const aiSnapshots = Array.isArray(aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY])
            ? aiSnapshotPayload[STORAGE_AI_LEAN_SNAPSHOT_KEY] : [];
        if (!allRows.length || !aiSnapshots.length)
            return;
        const londonTs = Date.parse(UFC_LONDON_CUTOFF_ISO);
        const nowTs = Date.now();
        function eventDedupeKey(name) {
            const m = name.match(/:\s*(.+?)\s+vs\.?\s+(.+)/i);
            if (!m)
                return name.toLowerCase().trim();
            const a = m[1].trim().split(/\s+/).pop().toLowerCase();
            const b = m[2].trim().split(/\s+/).pop().toLowerCase();
            return [a, b].sort().join('|');
        }
        const pastEventKeys = new Set(allRows.filter(r => Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) <= nowTs && Date.parse(r.date) >= londonTs)
            .map(r => eventDedupeKey(r.event || '')));
        const makeBuckets = () => [52, 57, 62, 67, 72, 77, 82, 87, 92].map(m => ({ midpoint: m, hits: 0, total: 0 }));
        const globalB = makeBuckets();
        const STAT_TYPES = ['Fantasy', 'SS', 'TD', 'FightTime'];
        const typeB = {};
        for (const pt of STAT_TYPES)
            typeB[pt] = makeBuckets();
        const bIdx = (c) => c >= 90 ? 8 : c >= 85 ? 7 : c >= 80 ? 6 : c >= 75 ? 5 : c >= 70 ? 4 : c >= 65 ? 3 : c >= 60 ? 2 : c >= 55 ? 1 : 0;
        for (const snap of aiSnapshots) {
            const snapKey = eventDedupeKey(String(snap?.event || ''));
            if (!snapKey || !pastEventKeys.has(snapKey))
                continue;
            const eventRows = allRows.filter(r => eventDedupeKey(r.event || '') === snapKey);
            for (const pick of (snap?.picks ?? [])) {
                const fighter = normalizeName(String(pick?.fighter || ''))?.toLowerCase();
                const lean = String(pick?.lean || '').toLowerCase();
                const conf = Number(pick?.confidence);
                const source = String(pick?.source || 'fp');
                const activeLine = Number(pick?.activeLine);
                if (!fighter || (lean !== 'over' && lean !== 'under') || !Number.isFinite(activeLine) || !Number.isFinite(conf) || conf < 50)
                    continue;
                const propType = source === 'ss' ? 'SS' : source === 'td' ? 'TD' : source === 'ft' ? 'FightTime' : 'Fantasy';
                const match = eventRows.find(r => normalizeName(r.fighter)?.toLowerCase() === fighter && String(r.propType) === propType && Number.isFinite(Number(r.result)));
                if (!match)
                    continue;
                const isHit = (lean === 'over' && Number(match.result) > activeLine) || (lean === 'under' && Number(match.result) < activeLine);
                const bi = bIdx(conf);
                globalB[bi].total++;
                if (isHit)
                    globalB[bi].hits++;
                if (typeB[propType]) {
                    typeB[propType][bi].total++;
                    if (isHit)
                        typeB[propType][bi].hits++;
                }
            }
        }
        const newMap = new Map();
        for (const b of globalB) {
            if (b.total >= 3)
                newMap.set(b.midpoint, Math.round((b.hits / b.total) * 100));
        }
        const newTypeMap = {};
        for (const pt of STAT_TYPES) {
            newTypeMap[pt] = new Map();
            for (const b of typeB[pt]) {
                if (b.total >= 3)
                    newTypeMap[pt].set(b.midpoint, Math.round((b.hits / b.total) * 100));
            }
        }
        _recalibrationMap = newMap;
        _recalibrationByType = newTypeMap;
        if (newMap.size >= 2)
            debugLog(`Recalibration map initialized: ${newMap.size} buckets`);
        // Also derive Bayesian priors from typeB bucket totals. Summed across
        // confidence buckets, typeB[pt] is the lean-direction hit rate for that
        // source. Use a beta prior (alpha=5.5, beta=4.5 → mean 0.55, pseudo-count 10)
        // so measured accuracy smoothly dominates 0.55 as N grows.
        const PROP_TO_SOURCE = {
            Fantasy: 'fp', SS: 'ss', TD: 'td', FightTime: 'ft',
        };
        const nextPriors = {};
        for (const [propType, buckets] of Object.entries(typeB)) {
            const src = PROP_TO_SOURCE[propType];
            if (!src)
                continue;
            let hits = 0, total = 0;
            for (const b of buckets) {
                hits += b.hits;
                total += b.total;
            }
            // Beta(5.5, 4.5) prior — keeps N<~5 near 0.55 and tracks measured as N grows.
            const smoothed = (hits + 5.5) / (total + 10);
            const clamped = Math.max(0.30, Math.min(0.80, smoothed));
            nextPriors[src] = Number(clamped.toFixed(4));
        }
        _bayesianPriors = nextPriors;
        void storageSet({ [STORAGE_BAYESIAN_PRIORS_KEY]: nextPriors });
    }
    catch (e) {
        debugLog(`Recalibration init error: ${e.message}`);
    }
}
function applyLean(f, db, lean) {
    const idx = allFighters.findIndex((x) => x.name === f.name);
    if (idx >= 0) {
        allFighters[idx].db = db || { loaded: false };
        allFighters[idx].lean = lean || createEmptyLean();
    }
}
function updateFighterLeans(name, lean_ss, lean_td, lean_ft, lean_ctrl = null, lean_ss_r1 = null) {
    const idx = allFighters.findIndex((x) => x.name === name);
    if (idx >= 0) {
        if (lean_ss)
            allFighters[idx].lean_ss = lean_ss;
        if (lean_ss_r1)
            allFighters[idx].lean_ss_r1 = lean_ss_r1;
        if (lean_td)
            allFighters[idx].lean_td = lean_td;
        if (lean_ft)
            allFighters[idx].lean_ft = lean_ft;
        if (lean_ctrl)
            allFighters[idx].lean_ctrl = lean_ctrl;
    }
}
function updatePlatformBar(data) {
    const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [];
    const pp = data.prizepicks?.fighters || [], dk = data.draftkings_sportsbook?.fighters || [];
    const el = (id) => document.getElementById(id);
    const total = p6.length + ud.length + betr.length + pp.length + dk.length;
    // ── When no lines loaded, hide pills and show "ready for next event" state ──
    const pillsRow = document.querySelector('.platform-pills-row');
    if (total === 0) {
        if (pillsRow)
            pillsRow.style.display = 'none';
    }
    else {
        if (pillsRow)
            pillsRow.style.display = '';
    }
    updateSourceRowVisibility(total > 0);
    const countP6 = el('countP6'), countUD = el('countUD'), countBetr = el('countBetr'), countPP = el('countPP'), countDK = el('countDK');
    if (countP6)
        countP6.textContent = p6.length ? `${p6.length}` : '—';
    if (countUD)
        countUD.textContent = ud.length ? `${ud.length}` : '—';
    if (countBetr)
        countBetr.textContent = betr.length ? `${betr.length}` : '—';
    if (countPP)
        countPP.textContent = pp.length ? `${pp.length}` : '—';
    if (countDK)
        countDK.textContent = dk.length ? `${dk.length}` : '—';
    el('pillP6')?.classList.toggle('active', p6.length > 0);
    el('pillUD')?.classList.toggle('active', ud.length > 0);
    el('pillBetr')?.classList.toggle('active', betr.length > 0);
    el('pillPP')?.classList.toggle('active', pp.length > 0);
    el('pillDK')?.classList.toggle('active', dk.length > 0);
    if (currentPlatform === 'pick6' && p6.length === 0) {
        if (ud.length > 0)
            setActivePlatform('underdog');
        else if (pp.length > 0)
            setActivePlatform('prizepicks');
        else if (dk.length > 0)
            setActivePlatform('draftkings_sportsbook');
        else if (betr.length > 0)
            setActivePlatform('betr');
    }
    else if (currentPlatform === 'draftkings_sportsbook' && dk.length === 0) {
        if (p6.length > 0)
            setActivePlatform('pick6');
        else if (ud.length > 0)
            setActivePlatform('underdog');
        else if (pp.length > 0)
            setActivePlatform('prizepicks');
        else if (betr.length > 0)
            setActivePlatform('betr');
    }
    document.querySelector(`[data-platform="${currentPlatform}"]`)?.classList.add('platform-selected');
    const dot = el('extDot'), label = el('extLabel');
    if (!dot || !label)
        return;
    if (total === 0) {
        dot.className = 'ext-dot';
        label.textContent = 'No extension data';
        label.style.color = 'var(--text3)';
    }
    else if (p6.length > 0) {
        dot.className = 'ext-dot live';
        label.textContent = `Live · ${total} lines`;
        label.style.color = 'var(--green)';
    }
    else {
        dot.className = 'ext-dot partial';
        label.textContent = `Partial · ${total} lines`;
        label.style.color = 'var(--orange)';
    }
    // openingLinesCount is managed by processData() diagnostic — do not overwrite here
}
async function loadData() {
    if (isDataLoadInFlight) {
        queuedDataReload = true;
        return;
    }
    isDataLoadInFlight = true;
    const icon = document.getElementById('refreshIcon');
    if (icon)
        icon.classList.add('spinning');
    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            await syncUpcomingCardContext();
            // If scheduledRoundsMap is empty but we have card pairs, cache predates the
            // scheduledRounds scrape change — force a fresh fetch to get round data
            if (scheduledRoundsMap.size === 0 && upcomingCardPairs.length > 0) {
                await syncUpcomingCardContext(true);
            }
            await loadCancelledFighters();
            await loadOpeningLines();
            await loadLineHistory();
            await loadConfidenceMemoryEngine();
            const result = await storageGet([...STORAGE_LINE_KEYS, STORAGE_ODDS_KEY, STORAGE_BETR_MANUAL_KEY, 'fighter_countries_dk_v1', 'fight_trueprob_dk_v1', 'fight_bethandle_dk_v1']);
            const rawOdds = result[STORAGE_ODDS_KEY];
            dkCountryByName = result['fighter_countries_dk_v1'] || {};
            dkTrueProbByName = result['fight_trueprob_dk_v1'] || {};
            dkBetHandleByName = result['fight_bethandle_dk_v1'] || {};
            fightOddsMoneylineByName = {};
            if (rawOdds && typeof rawOdds === 'object') {
                for (const [name, val] of Object.entries(rawOdds)) {
                    const normalizedName = normalizeName(name);
                    const odds = typeof val === 'number' ? val : Number(val);
                    if (!normalizedName || !Number.isFinite(odds))
                        continue;
                    fightOddsMoneylineByName[normalizedName] = odds;
                }
            }
            // Apply persisted manual Betr overrides on top of scraped lines_betr
            const manualBetr = result[STORAGE_BETR_MANUAL_KEY];
            if (manualBetr?.fighters?.length) {
                const base = result['lines_betr']?.fighters || [];
                const merged = applyBetrManualOverrides(base, manualBetr.fighters);
                result['lines_betr'] = { fighters: merged, capturedAt: manualBetr.capturedAt ?? Date.now() };
            }
            const filteredPick6 = filterPayloadToUpcomingCard(result['lines_pick6'] || null);
            const filteredUnderdog = filterPayloadToUpcomingCard(result['lines_underdog'] || null);
            const filteredBetr = filterPayloadToUpcomingCard(result['lines_betr'] || null);
            const filteredPrizePicks = filterPayloadToUpcomingCard(result['lines_prizepicks'] || null);
            const filteredDraftKings = filterPayloadToUpcomingCard(result['lines_draftkings_sportsbook'] || null);
            inferredEventNameFromLines = inferEventNameFromPayloads([
                filteredPick6,
                filteredUnderdog,
                filteredBetr,
                filteredPrizePicks,
                filteredDraftKings,
            ]);
            if (inferredEventNameFromLines) {
                // Only adopt the line-inferred name when we have NO real UFCStats card
                // title. inferEventNameFromPayloads returns the highest-line-count pair
                // (frequently a fully-covered PRELIM, not the headliner), so clobbering a
                // real "...: Kape vs. Horiguchi" title would make findHeadlinerPair parse
                // the wrong surnames and hand 5R projections to a prelim. Keep the inferred
                // name only as the documented fallback (findHeadlinerPair already reads
                // `upcomingEventName || inferredEventNameFromLines`).
                if (!upcomingEventName)
                    upcomingEventName = inferredEventNameFromLines;
                const nameEl = document.getElementById('eventName');
                if (nameEl)
                    nameEl.textContent = upcomingEventName || inferredEventNameFromLines;
            }
            await processData({
                pick6: pruneOrphanFighters(filteredPick6),
                underdog: pruneOrphanFighters(filteredUnderdog),
                betr: pruneOrphanFighters(filteredBetr),
                prizepicks: pruneOrphanFighters(filteredPrizePicks),
                draftkings_sportsbook: pruneOrphanFighters(filteredDraftKings),
            });
        }
        else {
            fightOddsMoneylineByName = {};
            await new Promise((resolve) => setTimeout(resolve, 400));
            await processData(DEMO_DATA);
        }
    }
    catch (e) {
        console.error('LoadData error:', e);
    }
    finally {
        if (icon)
            icon.classList.remove('spinning');
        isDataLoadInFlight = false;
        if (queuedDataReload) {
            queuedDataReload = false;
            // Fire one trailing refresh to collapse bursty update events.
            void loadData();
        }
    }
}
function requestDataReload(delayMs = 0) {
    if (delayMs > 0) {
        setTimeout(() => { void loadData(); }, delayMs);
        return;
    }
    void loadData();
}
function startPeriodicDataReload(intervalMs = 60000) {
    if (periodicRefreshTimer)
        clearInterval(periodicRefreshTimer);
    periodicRefreshTimer = setInterval(() => { requestDataReload(); }, intervalMs);
}
async function processData(data) {
    // Snapshot current fighter line values BEFORE mergeAndEnrich overwrites allFighters.
    // This enables inter-refresh delta detection for line movement badges.
    snapshotPrevRefreshLines();
    updatePlatformBar(data);
    const p6 = data.pick6?.fighters || [], ud = data.underdog?.fighters || [], betr = data.betr?.fighters || [], pp = data.prizepicks?.fighters || [], dk = data.draftkings_sportsbook?.fighters || [];
    const empty = document.getElementById('emptyState'), container = document.getElementById('cardContainer');
    const fhr = document.getElementById('fighterHeaderRow');
    // Elements to hide/show when no lines are loaded.
    // IMPORTANT: don't hide the whole .filter-bar-bottom — it contains .view-tabs, which
    // must stay clickable so users can reach Archive / Best Picks / Parlay Lab / Calibration
    // (and the Line Predictor inside Archive) between events.
    const sortTrendCtrl = document.querySelector('.filter-bar.filter-bar-bottom .sort-trend-control');
    const densityCtrl = document.querySelector('.filter-bar.filter-bar-bottom .density-control');
    const modelHealth = document.getElementById('modelHealthWidget');
    const learningDash = document.getElementById('learningDiagnosticsWidget');
    if (p6.length === 0 && ud.length === 0 && betr.length === 0 && pp.length === 0 && dk.length === 0) {
        if (empty) {
            empty.style.display = 'block';
            // Check archive for settled records to show "ready for next event" instead of default
            try {
                const archiveRaw = await new Promise(res => chrome.storage.local.get(['prop_archive_v1'], res));
                const archive = Array.isArray(archiveRaw.prop_archive_v1) ? archiveRaw.prop_archive_v1 : [];
                const resolved = archive.filter((r) => Number.isFinite(Number(r.result))).length;
                const unresolved = archive.filter((r) => Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result))).length;
                if (resolved > 0 && unresolved === 0) {
                    const icon = empty.querySelector('.empty-icon');
                    const title = empty.querySelector('.empty-title');
                    const steps = empty.querySelector('.empty-steps');
                    const btn = empty.querySelector('#emptyStateAutoFetchBtn');
                    if (icon)
                        icon.textContent = '✓';
                    if (title)
                        title.textContent = 'Ready for Next Event';
                    if (steps)
                        steps.innerHTML = `<span style="color:var(--green);font-weight:600">${resolved} records settled</span> across your archive.<br><br>
            When the next UFC card's lines go live on Pick6, Underdog, or Betr — click <strong>⚡ AUTO-FETCH LINES</strong> or drop Betr screenshots to get started.<br><br>
            <button id="emptyStatePredictBtn" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:'JetBrains Mono',monospace">⚡ Generate Line Predictions</button>`;
                    if (btn)
                        btn.textContent = '⚡ AUTO-FETCH LINES';
                    // Wire up predict button right after creating it
                    document.getElementById('emptyStatePredictBtn')?.addEventListener('click', async () => {
                        currentView = 'archive';
                        document.querySelectorAll('.tab-btn[data-view]').forEach(b => b.classList.remove('active'));
                        document.querySelector('.tab-btn[data-view="archive"]')?.classList.add('active');
                        const emptyEl = document.getElementById('emptyState');
                        const containerEl = document.getElementById('cardContainer');
                        if (emptyEl)
                            emptyEl.style.display = 'none';
                        if (containerEl) {
                            containerEl.style.display = 'block';
                            renderFighters();
                            // Wait for archive panel to render, then auto-click generate
                            await new Promise(r => setTimeout(r, 800));
                            const genBtn = document.getElementById('predictorGenerateBtn');
                            if (genBtn && !genBtn.disabled)
                                genBtn.click();
                        }
                    });
                }
            }
            catch { /* archive check failed, show default empty state */ }
        }
        if (container)
            container.style.display = 'none';
        if (fhr)
            fhr.classList.add('is-hidden');
        if (sortTrendCtrl)
            sortTrendCtrl.style.display = 'none';
        if (densityCtrl)
            densityCtrl.style.display = 'none';
        if (modelHealth)
            modelHealth.style.display = 'none';
        if (learningDash)
            learningDash.style.display = 'none';
        return;
    }
    // Reset empty state text in case it was changed to "Ready for Next Event"
    if (empty) {
        const icon = empty.querySelector('.empty-icon');
        const title = empty.querySelector('.empty-title');
        if (icon)
            icon.textContent = '⚡';
        if (title)
            title.textContent = 'Ready to Auto-Fetch Lines';
    }
    // Restore hidden elements when lines arrive
    if (sortTrendCtrl)
        sortTrendCtrl.style.display = '';
    if (densityCtrl)
        densityCtrl.style.display = '';
    if (modelHealth)
        modelHealth.style.display = '';
    if (learningDash)
        learningDash.style.display = '';
    if (empty)
        empty.style.display = 'none';
    if (container)
        container.style.display = 'block';
    if (fhr)
        fhr.classList.remove('is-hidden');
    showToast(`Loading ${p6.length || ud.length || betr.length || pp.length || dk.length} fighters + fetching UFCStats...`);
    await mergeAndEnrich(p6, ud, betr, pp, dk);
    detectAndRecordMovements();
    snapshotOpeningLines();
    snapshotLineHistory();
    // Re-render AFTER snapshots so the first render the user sees reflects the
    // up-to-date baselines (including any grace-period re-anchors). Without this
    // the prior renderFighters() call from inside mergeAndEnrich runs against
    // stale baselines, producing spurious movement badges until the next
    // interaction triggers another render.
    renderFighters();
    renderLineMovementSummary();
    const _oc = document.getElementById('openingLinesCount');
    if (_oc && _openingLines.size > 0) {
        // Compute max delta across all fighters/stats for diagnostic display
        let _maxDelta = 0;
        let _maxPrevDelta = 0;
        let _matchCount = 0;
        let _prevMatchCount = 0;
        for (const fighter of allFighters) {
            const _checks = [
                ['p6', 'fp', fighter.line_p6], ['p6', 'ss', fighter.line_p6_ss], ['p6', 'td', fighter.line_p6_td], ['p6', 'ft', fighter.line_p6_ft],
                ['ud', 'fp', fighter.line_ud], ['ud', 'ss', fighter.line_ud_ss], ['ud', 'td', fighter.line_ud_td], ['ud', 'ft', fighter.line_ud_ft],
                ['pp', 'fp', fighter.line_pp], ['pp', 'ss', fighter.line_pp_ss], ['pp', 'td', fighter.line_pp_td], ['pp', 'ft', fighter.line_pp_ft],
                ['betr', 'fp', fighter.line_betr], ['betr', 'ss', fighter.line_betr_ss], ['betr', 'td', fighter.line_betr_td], ['betr', 'ft', fighter.line_betr_ft],
                ['dk', 'ss', fighter.line_dk_ss], ['dk', 'td', fighter.line_dk_td], ['dk', 'ft', fighter.line_dk_ft],
            ];
            for (const [pl, st, cur] of _checks) {
                if (cur == null)
                    continue;
                const _dk = openingLineKey(pl, st, fighter.name);
                const op = _openingLines.get(_dk);
                if (op != null) {
                    _matchCount++;
                    _maxDelta = Math.max(_maxDelta, Math.abs(cur - op));
                }
                const pv = _prevRefreshLines.get(_dk);
                if (pv != null) {
                    _prevMatchCount++;
                    _maxPrevDelta = Math.max(_maxPrevDelta, Math.abs(cur - pv));
                }
            }
        }
        const ageH = _baselineCapturedAt > 0 ? ((Date.now() - _baselineCapturedAt) / 3600000).toFixed(1) : '?';
        const stored = _openingLines.size;
        const archiveText = stored === _matchCount
            ? `📍 ${stored} archived`
            : `📍 ${stored} stored · ${_matchCount} matched`;
        const archiveTitle = stored === _matchCount
            ? `${stored} fighters with stored opening lines, all matched against current slate`
            : `${stored} stored opening lines · ${_matchCount} matched against current slate · ${stored - _matchCount} not present this slate`;
        const recentMoveTrail = _prevRefreshLines.size > 0 && _maxPrevDelta > 0
            ? ` · ↻Δ${_maxPrevDelta.toFixed(1)}`
            : '';
        const movementTitle = _prevRefreshLines.size > 0
            ? `Max line delta from opening: ${_maxDelta.toFixed(1)} — Since last refresh: ${_prevMatchCount} fighters tracked, max prev-delta ${_maxPrevDelta.toFixed(1)}`
            : `Max line delta from opening: ${_maxDelta.toFixed(1)}`;
        _oc.innerHTML =
            `<span class="status-chunk" title="${archiveTitle}">${archiveText}</span>` +
                `<span class="status-chunk age-${Number(ageH) < 6 ? 'fresh' : Number(ageH) < 48 ? 'aging' : 'stale'}" title="Opening lines captured ${ageH}h ago">🕒 ${ageH}h old</span>` +
                `<span class="status-chunk" title="${movementTitle}">max Δ${_maxDelta.toFixed(1)}${recentMoveTrail}</span>`;
        // Show reset button when baselines exist
        const _rb = document.getElementById('resetBaselinesBtn');
        if (_rb)
            _rb.style.display = '';
    }
    else if (_oc) {
        _oc.textContent = _openingLines.size === 0 ? ' · 📍awaiting baseline' : '';
    }
    renderVisitBriefing();
    showToast(`Loaded ${allFighters.filter(f => f.db?.loaded).length} fighters with stats!`);
}
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t)
        return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
function setButtonBusyState(button, isBusy, options = {}) {
    if (!button)
        return;
    button.disabled = isBusy;
    button.style.opacity = isBusy ? (options.busyOpacity ?? '0.6') : (options.idleOpacity ?? '1');
    if (isBusy && options.busyText)
        button.textContent = options.busyText;
    if (!isBusy && options.idleText)
        button.textContent = options.idleText;
}
function setIconSpinnerState(icon, isSpinning, idleText = '⚡') {
    if (!icon)
        return;
    if (isSpinning) {
        icon.textContent = '⟳';
        icon.style.display = 'inline-block';
        icon.style.animation = 'spin 1s linear infinite';
        return;
    }
    icon.style.animation = '';
    icon.textContent = idleText;
}
// ── DEMO DATA ──────────────────────────────────────────────────────────────
const DEMO_DATA = {
    pick6: { fighters: [
            { name: "Josh Emmett", line_fp: 82.5, line_ss: 44.5, line_td: 0.5, opponent: "Kevin Vallejos" },
            { name: "Kevin Vallejos", line_fp: 62.5, line_ss: 49.5, line_td: 0.5, opponent: "Josh Emmett" },
            { name: "Amanda Lemos", line_fp: 71.5, line_ss: 55.5, line_td: 0.5, opponent: "Gillian Robertson" },
            { name: "Gillian Robertson", line_fp: 55.5, line_ss: 22.5, line_td: 2.5, opponent: "Amanda Lemos" },
            { name: "Oumar Sy", line_fp: 74.5, line_ss: 42.5, line_td: 1.5, opponent: "Ion Cutelaba" },
            { name: "Ion Cutelaba", line_fp: 68.5, line_ss: 48.5, line_td: 0.5, opponent: "Oumar Sy" },
            { name: "Vitor Petrino", line_fp: 79.5, line_ss: 39.5, line_td: 0.5, opponent: "Steven Asplund" },
            { name: "Steven Asplund", line_fp: 52.5, line_ss: 34.5, line_td: null, opponent: "Vitor Petrino" },
            { name: "Andre Fili", line_fp: 73.5, line_ss: 55.5, line_td: 0.5, opponent: "Jose Delgado" },
            { name: "Jose Delgado", line_fp: 58.5, line_ss: 44.5, line_td: 0.5, opponent: "Andre Fili" },
            { name: "Brad Tavares", line_fp: 68.5, line_ss: 49.5, line_td: 0.5, opponent: "Eryk Anders" },
            { name: "Eryk Anders", line_fp: 64.5, line_ss: 46.5, line_td: 0.5, opponent: "Brad Tavares" },
            { name: "Bruno Silva", line_fp: 72.5, line_ss: 54.5, line_td: 0.5, opponent: "Charles Johnson" },
            { name: "Charles Johnson", line_fp: 66.5, line_ss: 48.5, line_td: 0.5, opponent: "Bruno Silva" },
            { name: "Piera Rodriguez", line_fp: 68.5, line_ss: 44.5, line_td: 1.5, opponent: "Sam Hughes" },
            { name: "Sam Hughes", line_fp: 55.5, line_ss: 38.5, line_td: 0.5, opponent: "Piera Rodriguez" },
        ], capturedAt: Date.now() },
    underdog: { fighters: [
            { name: "Josh Emmett", line_fp: 80.5, line_ss: 42.5, line_td: 0.5, opponent: "Kevin Vallejos" },
            { name: "Kevin Vallejos", line_fp: 60.5, line_ss: 47.5, line_td: 0.5, opponent: "Josh Emmett" },
            { name: "Amanda Lemos", line_fp: 69.5, line_ss: 53.5, line_td: 0.5, opponent: "Gillian Robertson" },
            { name: "Gillian Robertson", line_fp: 53.5, line_ss: 21.5, line_td: 2.5, opponent: "Amanda Lemos" },
            { name: "Oumar Sy", line_fp: 72.5, line_ss: 40.5, line_td: 1.5, opponent: "Ion Cutelaba" },
            { name: "Ion Cutelaba", line_fp: 66.5, line_ss: 46.5, line_td: 0.5, opponent: "Oumar Sy" },
            { name: "Vitor Petrino", line_fp: 77.5, line_ss: 37.5, line_td: 0.5, opponent: "Steven Asplund" },
        ], capturedAt: Date.now() },
    betr: null,
    prizepicks: null,
};
function toWatchPlatform(value) {
    const normalized = String(value || 'underdog').toLowerCase();
    if (normalized.includes('pick6'))
        return 'pick6';
    if (normalized.includes('betr'))
        return 'betr';
    if (normalized.includes('prize'))
        return 'prizepicks';
    return 'underdog';
}
function toWatchedStat(value) {
    const normalized = String(value || 'fp').toLowerCase();
    if (normalized.includes('ss'))
        return 'ss';
    if (normalized.includes('td'))
        return 'td';
    return 'fp';
}
// ── CHROME MESSAGE LISTENER ───────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'LINES_DROPPED') {
            showLineDropAlert(msg);
            setWatcherVisualState('detected', 'Line Alert');
            const ts = Date.now();
            const converted = (msg.drops || []).map((d, i) => ({
                id: `bg-${ts}-${i}`,
                timestamp: ts,
                fighter: d.fighter || 'Multiple fighters',
                platform: toWatchPlatform(d.platform),
                stat: toWatchedStat(d.type),
                from: Number(d.from ?? 0),
                to: Number(d.to ?? 0),
                delta: Number(d.delta ?? -1),
                direction: Number(d.delta ?? -1) < 0 ? 'drop' : 'rise',
            }));
            if (converted.length) {
                recentLineMoves = [...converted, ...recentLineMoves].slice(0, 120);
                renderLineMoveFeed();
            }
            requestDataReload(1500);
        }
        if (msg.type === 'LINES_UPDATED') {
            console.log('[UFC Analyzer] Lines updated:', msg.platform, msg.count);
            requestDataReload();
        }
        if (msg.type === 'ODDS_UPDATED') {
            console.log('[UFC Analyzer] Odds updated:', msg.count);
            requestDataReload();
        }
        if (msg.type === 'BET_HANDLE_UPDATED') {
            console.log('[UFC Analyzer] Bet-handle updated:', msg.count);
            requestDataReload();
        }
        if (msg.type === 'ARCHIVE_SETTLED') {
            _confidenceMemoryCache = null;
            const settled = msg.settled ?? 0;
            showToast(`✓ Archive settled: ${settled} result${settled !== 1 ? 's' : ''} updated`);
            // If archive or calibration panel is open, re-render it
            if (currentView === 'archive' || currentView === 'calibration') {
                const container = document.getElementById('cardContainer');
                if (container) {
                    if (currentView === 'archive')
                        void renderArchivePanel(container);
                    else
                        void renderCalibrationPanel(container);
                }
            }
        }
    });
}
function showLineDropAlert(msg) {
    const banner = document.getElementById('lineDropBanner');
    const txt = document.getElementById('lineDropText');
    if (!banner)
        return;
    const event = msg.event || 'Upcoming UFC Event';
    const dropSummary = (msg.drops || [])
        .map((d) => `${d.platform} ${d.type} (${d.count} fighters)`)
        .join(' · ') || `${msg.udCount || 0} fighters on Underdog`;
    if (txt)
        txt.innerHTML = `🔔 <strong>LINES DROPPED!</strong> &nbsp;${event} — ${dropSummary}. Auto-loading now...`;
    banner.style.display = 'flex';
    banner.style.animation = 'pulseAlert 0.5s ease-in-out 3';
    setTimeout(() => { banner.style.display = 'none'; }, 25000);
}
function parseEventDateMs(raw) {
    if (!raw)
        return NaN;
    // UFCStats uses "Apr. 4, 2026" — strip the period so V8 can parse it.
    const normalized = raw.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./gi, '$1');
    const direct = new Date(normalized).getTime();
    if (Number.isFinite(direct))
        return direct;
    const fallback = new Date(`${normalized} UTC`).getTime();
    return Number.isFinite(fallback) ? fallback : NaN;
}
function toIsoDateOrNull(raw) {
    if (!raw)
        return null;
    const ts = Date.parse(raw);
    if (Number.isFinite(ts))
        return new Date(ts).toISOString();
    return null;
}
function rosterNameSet() {
    const set = new Set();
    for (const f of allFighters) {
        const n = normalizeName(f.name);
        if (n)
            set.add(n.toLowerCase());
    }
    return set;
}
async function archivePerformanceForRosterFighter(name, ufcData) {
    if (!ufcData?.fightHistory?.length)
        return;
    const fighterNorm = normalizeName(name);
    if (!fighterNorm)
        return;
    const roster = rosterNameSet();
    if (!roster.has(fighterNorm.toLowerCase()))
        return;
    const records = [];
    for (const fight of ufcData.fightHistory) {
        const dateIso = toIsoDateOrNull(fight.date);
        if (!dateIso)
            continue;
        const eventName = String(fight.event || '').trim();
        if (!eventName)
            continue;
        const opponent = normalizeName(fight.opponent) || fight.opponent || 'Unknown Opponent';
        const won = fight.result === 'win';
        if (fight.sigStr != null || fight.totStr != null || fight.kd != null || fight.td != null || fight.ctrlSecs != null) {
            const fantasy = calcFPForPlatform('pick6', fight.sigStr, fight.totStr, fight.ctrlSecs, fight.timeSecs, fight.kd, fight.td, fight.rev, fight.sub, won, fight.method, fight.round);
            const fantasyPP = calcFPForPlatform('prizepicks', fight.sigStr, fight.totStr, fight.ctrlSecs, fight.timeSecs, fight.kd, fight.td, fight.rev, fight.sub, won, fight.method, fight.round);
            records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'Fantasy', result: fantasy });
            records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'Fantasy_PP', result: fantasyPP });
            if (fight.sigStr != null)
                records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'SS', result: Number(fight.sigStr) });
            if (fight.td != null)
                records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'TD', result: Number(fight.td) });
            if (fight.ctrlSecs != null)
                records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'Control', result: Number(fight.ctrlSecs) });
            if (fight.timeSecs != null)
                records.push({ fighter: fighterNorm, opponent, event: eventName, date: dateIso, propType: 'FightTime', result: parseFloat((Number(fight.timeSecs) / 60).toFixed(2)) });
            await PropArchiveService.updateResult(fighterNorm, eventName, 'Fantasy', fantasy, { date: dateIso, opponent });
            await PropArchiveService.updateResult(fighterNorm, eventName, 'Fantasy_PP', fantasyPP, { date: dateIso, opponent });
            if (fight.sigStr != null)
                await PropArchiveService.updateResult(fighterNorm, eventName, 'SS', Number(fight.sigStr), { date: dateIso, opponent });
            if (fight.td != null)
                await PropArchiveService.updateResult(fighterNorm, eventName, 'TD', Number(fight.td), { date: dateIso, opponent });
            if (fight.ctrlSecs != null)
                await PropArchiveService.updateResult(fighterNorm, eventName, 'Control', Number(fight.ctrlSecs), { date: dateIso, opponent });
            if (fight.timeSecs != null)
                await PropArchiveService.updateResult(fighterNorm, eventName, 'FightTime', parseFloat((Number(fight.timeSecs) / 60).toFixed(2)), { date: dateIso, opponent });
        }
        const oppStats = fight.oppStats;
        const oppName = normalizeName(oppStats?.oppName || opponent) || String(oppStats?.oppName || opponent || 'Unknown Opponent');
        if (oppStats && (oppStats.sigStr != null || oppStats.td != null || oppStats.kd != null || oppStats.ctrlSecs != null)) {
            const oppWon = fight.result === 'loss';
            const oppFantasy = calcFPForPlatform('pick6', oppStats.sigStr, oppStats.totStr, oppStats.ctrlSecs, fight.timeSecs, oppStats.kd, oppStats.td, null, oppStats.sub, oppWon, fight.method, fight.round);
            const oppFantasyPP = calcFPForPlatform('prizepicks', oppStats.sigStr, oppStats.totStr, oppStats.ctrlSecs, fight.timeSecs, oppStats.kd, oppStats.td, null, oppStats.sub, oppWon, fight.method, fight.round);
            records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'Fantasy', result: oppFantasy });
            records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'Fantasy_PP', result: oppFantasyPP });
            if (oppStats.sigStr != null)
                records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'SS', result: Number(oppStats.sigStr) });
            if (oppStats.td != null)
                records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'TD', result: Number(oppStats.td) });
            if (oppStats.ctrlSecs != null)
                records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'Control', result: Number(oppStats.ctrlSecs) });
            if (fight.timeSecs != null)
                records.push({ fighter: oppName, opponent: fighterNorm, event: eventName, date: dateIso, propType: 'FightTime', result: parseFloat((Number(fight.timeSecs) / 60).toFixed(2)) });
            await PropArchiveService.updateResult(oppName, eventName, 'Fantasy', oppFantasy, { date: dateIso, opponent: fighterNorm });
            await PropArchiveService.updateResult(oppName, eventName, 'Fantasy_PP', oppFantasyPP, { date: dateIso, opponent: fighterNorm });
            if (oppStats.sigStr != null)
                await PropArchiveService.updateResult(oppName, eventName, 'SS', Number(oppStats.sigStr), { date: dateIso, opponent: fighterNorm });
            if (oppStats.td != null)
                await PropArchiveService.updateResult(oppName, eventName, 'TD', Number(oppStats.td), { date: dateIso, opponent: fighterNorm });
            if (oppStats.ctrlSecs != null)
                await PropArchiveService.updateResult(oppName, eventName, 'Control', Number(oppStats.ctrlSecs), { date: dateIso, opponent: fighterNorm });
            if (fight.timeSecs != null)
                await PropArchiveService.updateResult(oppName, eventName, 'FightTime', parseFloat((Number(fight.timeSecs) / 60).toFixed(2)), { date: dateIso, opponent: fighterNorm });
        }
    }
    if (!records.length)
        return;
    await PropArchiveService.addProps(records);
}
async function runArchiveBackfillPass() {
    try {
        const summary = await PropArchiveService.backfillUnresolvedFromKnownOutcomes({
            eventIncludes: 'ufc',
            maxScore: 12,
            minHoursBetweenRuns: 6,
        });
        if (summary.changed > 0) {
            debugLog(`[Archive Backfill] settled ${summary.changed} rows (${summary.unresolvedBefore} -> ${summary.unresolvedAfter})`);
        }
    }
    catch (e) {
        debugLog(`[Archive Backfill] failed: ${e.message}`);
    }
}
function getWatcherStatusElements() {
    return {
        statusEl: document.getElementById('watcherStatus'),
        // Removed pollBadge and lastBadge UI
        pollBadge: null,
        lastBadge: null,
    };
}
function setWatcherVisualState(state, text) {
    const btn = document.getElementById('watcherToggleBtn');
    const txt = document.getElementById('watcherToggleText');
    if (!btn)
        return;
    btn.classList.remove('state-idle', 'state-watching', 'state-detected', 'state-error');
    btn.classList.add(`state-${state}`);
    if (txt) {
        txt.textContent = text || (state === 'watching' ? 'Watching' : state === 'detected' ? 'Line Alert' : state === 'error' ? 'Watch Error' : 'Watch Lines');
    }
}
// Inline SVG sparkline for LINE MOVERS rows and the fight spine. Returns a
// string of SVG markup (so it can be inlined into innerHTML) or '' when there
// are fewer than 2 points worth plotting. Pure render — no storage access.
// opts.color overrides the direction-derived stroke (used by spine L5 trends
// for per-fighter cyan/yellow). opts.w/h override the default 90×18 box.
function renderSparkline(points, direction = 'auto', opts) {
    if (!points || points.length < 2)
        return '';
    const w = opts?.w ?? 90, h = opts?.h ?? 18, pad = 2;
    const values = points.map(p => p.v);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const xs = [];
    const ys = [];
    for (let i = 0; i < values.length; i++) {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2);
        const y = pad + (1 - (values[i] - min) / range) * (h - pad * 2);
        xs.push(x);
        ys.push(y);
    }
    const coords = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const dir = direction === 'auto'
        ? (values[values.length - 1] >= values[0] ? 'up' : 'down')
        : direction;
    const stroke = opts?.color ?? (dir === 'up' ? '#5ee589' : '#ff5a73');
    const x0 = xs[0].toFixed(1), y0 = ys[0].toFixed(1);
    const x1 = xs[xs.length - 1].toFixed(1), y1 = ys[ys.length - 1].toFixed(1);
    const areaHTML = opts?.area
        ? `<polygon points="${x0},${(h - 1).toFixed(1)} ${coords} ${x1},${(h - 1).toFixed(1)}" fill="${stroke}" opacity="0.1"/>`
        : '';
    const glowHTML = opts?.glow ? `<circle cx="${x1}" cy="${y1}" r="4" fill="${stroke}" opacity="0.22"/>` : '';
    return `<svg class="line-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
        + areaHTML
        + `<polyline points="${coords}" stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
        + `<circle cx="${x0}" cy="${y0}" r="1.8" fill="#6c7080"/>`
        + glowHTML
        + `<circle cx="${x1}" cy="${y1}" r="1.8" fill="${stroke}"/>`
        + `</svg>`;
}
// Extract a per-platform timeline from _lineHistory for (name, stat, platKey).
// _lineHistory.series stores [{t, v: Record<plat, number>}] — we project out
// the requested platform and drop points where that platform was missing.
function getSparklinePointsForPlat(name, stat, platKey) {
    const series = _lineHistory.series[lineHistoryKey(name, stat)];
    if (!series || series.length === 0)
        return [];
    const out = [];
    for (const pt of series) {
        const v = pt.v?.[platKey];
        if (typeof v === 'number' && Number.isFinite(v))
            out.push({ t: pt.t, v });
    }
    return out;
}
function renderLineMovementSummary() {
    const container = document.getElementById('lineMovementSummary');
    const body = document.getElementById('movementSummaryBody');
    const timeEl = document.getElementById('movementSummaryTime');
    if (!container || !body)
        return;
    const entries = [];
    const platLabels = { p6: 'P6', ud: 'UD', pp: 'PP', betr: 'BT', dk: 'DK' };
    // Pick-em platforms where "public hammers OVER" heuristic applies. DK is a
    // sportsbook with juice, so its moves don't fit the same public-default model.
    const PICKEM_PLATS = new Set(['p6', 'ud', 'pp', 'betr']);
    for (const f of allFighters) {
        const statChecks = [
            { stat: 'FP', lines: [['p6', f.line_p6], ['ud', f.line_ud], ['pp', f.line_pp], ['betr', f.line_betr]] },
            { stat: 'SS', lines: [['p6', f.line_p6_ss], ['ud', f.line_ud_ss], ['pp', f.line_pp_ss], ['betr', f.line_betr_ss], ['dk', f.line_dk_ss]] },
            { stat: 'TD', lines: [['p6', f.line_p6_td], ['ud', f.line_ud_td], ['pp', f.line_pp_td], ['betr', f.line_betr_td], ['dk', f.line_dk_td]] },
            { stat: 'FT', lines: [['p6', f.line_p6_ft], ['ud', f.line_ud_ft], ['pp', f.line_pp_ft], ['betr', f.line_betr_ft], ['dk', f.line_dk_ft]] },
        ];
        for (const { stat, lines } of statChecks) {
            let maxDelta = 0;
            let maxOpen = null;
            let maxClose = null;
            let maxPlatLabel = '';
            let maxPlatKey = '';
            const movedPlats = [];
            // RLM roll-up: count pick-em platforms moving against the public OVER flow.
            let pickemRise = 0, pickemDrop = 0, maxPickemRise = 0, maxPickemDrop = 0;
            for (const [plat, current] of lines) {
                if (current == null)
                    continue;
                const key = openingLineKey(plat, stat.toLowerCase(), f.name);
                const opening = _openingLines.get(key);
                if (opening == null)
                    continue;
                const deltaRaw = parseFloat((current - opening).toFixed(1));
                const delta = sanitizeDelta(stat.toLowerCase(), deltaRaw);
                if (delta != null && Math.abs(delta) >= 1.0) {
                    const platLabel = platLabels[plat] || plat;
                    movedPlats.push(platLabel);
                    if (Math.abs(delta) > Math.abs(maxDelta)) {
                        maxDelta = delta;
                        maxOpen = opening;
                        maxClose = current;
                        maxPlatLabel = platLabel;
                        maxPlatKey = plat;
                    }
                }
                if (delta != null && PICKEM_PLATS.has(plat)) {
                    if (delta >= 1.0) {
                        pickemRise++;
                        if (delta > maxPickemRise)
                            maxPickemRise = delta;
                    }
                    if (delta <= -2.0) {
                        pickemDrop++;
                        if (delta < maxPickemDrop)
                            maxPickemDrop = delta;
                    }
                }
            }
            let rlm = null;
            // UNDER: line rose on any pick-em platform (against public OVER default).
            // Stronger when multiple pick-em platforms agree on the rise.
            if (pickemRise >= 1 && maxPickemRise >= 1.0)
                rlm = 'under';
            // OVER: deep drop across ≥1 pick-em platform, plus magnitude meaningful.
            else if (pickemDrop >= 1 && Math.abs(maxPickemDrop) >= 2.0)
                rlm = 'over';
            if (movedPlats.length > 0 && maxOpen != null && maxClose != null) {
                entries.push({
                    name: f.name,
                    stat,
                    delta: maxDelta,
                    open: maxOpen,
                    close: maxClose,
                    sourcePlat: maxPlatLabel,
                    sourcePlatKey: maxPlatKey,
                    platforms: movedPlats,
                    isSteam: movedPlats.length >= 2 && Math.abs(maxDelta) >= 2.0,
                    rlm,
                });
            }
        }
    }
    if (entries.length === 0) {
        container.style.display = 'none';
        return;
    }
    entries.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    container.style.display = '';
    const top = entries.slice(0, 20);
    const steamers = top.filter(e => e.delta > 0);
    const drifters = top.filter(e => e.delta < 0);
    const rowHtml = (e) => {
        const arrow = e.delta > 0 ? '▲' : '▼';
        const cls = e.delta > 0 ? 'rise' : 'drop';
        const steamTag = e.isSteam ? '<span class="movement-summary-steam">STEAM</span>' : '';
        const rlmTag = e.rlm
            ? `<span class="rlm-tag rlm-${e.rlm}" title="Reverse line movement — ${e.rlm === 'under' ? 'rising against public OVER default → sharp UNDER flow' : 'deep drop below open → heavy OVER action'}">RLM ${e.rlm.toUpperCase()}</span>`
            : '';
        const sparkPoints = e.sourcePlatKey ? getSparklinePointsForPlat(e.name, e.stat.toLowerCase(), e.sourcePlatKey) : [];
        const sparkHtml = sparkPoints.length >= 2
            ? `<span class="movement-summary-spark" title="${e.sourcePlat} ${e.stat} — ${sparkPoints.length} points over ${Math.round((sparkPoints[sparkPoints.length - 1].t - sparkPoints[0].t) / 60000)}m">${renderSparkline(sparkPoints, e.delta > 0 ? 'up' : 'down')}</span>`
            : '';
        return `<div class="movement-summary-row" data-jump="${e.name}" title="Open fighter card">
      <span class="movement-summary-fighter">${prettyName(e.name)}</span>
      <span class="movement-summary-stat">${e.stat}</span>
      <span class="movement-summary-line">${e.sourcePlat} ${e.open}→${e.close}</span>
      <span class="movement-summary-delta ${cls}">${arrow}${Math.abs(e.delta)}</span>
      ${sparkHtml}
      <span class="movement-summary-platforms">${e.platforms.join(', ')}</span>
      ${steamTag}${rlmTag}
    </div>`;
    };
    const sectionHtml = (label, dirClass, list) => {
        if (list.length === 0)
            return '';
        return `<div class="movement-summary-section-header ${dirClass}">${label} <span class="movement-summary-section-count">${list.length}</span></div>` +
            list.map(rowHtml).join('');
    };
    body.innerHTML = sectionHtml('▲ Steamers', 'rise', steamers) + sectionHtml('▼ Drifters', 'drop', drifters);
    body.querySelectorAll('.movement-summary-row[data-jump]').forEach(el => {
        el.addEventListener('click', () => jumpToFighterCard(el.dataset['jump'] || ''));
    });
    if (timeEl)
        timeEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function renderLineMoveFeed() {
    const list = document.getElementById('lineMoveList');
    if (!list)
        return;
    if (!recentLineMoves.length) {
        list.innerHTML = '<div class="line-move-item"><div class="meta">No movement events yet</div><div class="delta">--</div><div></div></div>';
        return;
    }
    list.innerHTML = recentLineMoves.slice(0, 12).map((e) => {
        const tm = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const deltaAbs = Math.abs(e.delta).toFixed(1);
        const deltaClass = e.direction === 'drop' ? 'drop' : 'rise';
        const spike = e.valueSpike ? '<span class="value-spike">VALUE SPIKE</span>' : '';
        const rlmTag = e.rlm
            ? `<span class="rlm-tag rlm-${e.rlm}" title="${(e.rlmReason || '').replace(/"/g, '&quot;')}">RLM ${e.rlm.toUpperCase()}</span>`
            : '';
        const flags = [e.steam ? 'steam' : '', e.stealth ? 'stealth' : ''].filter(Boolean).join(' + ');
        return `<div class="line-move-item"><div class="meta">${e.fighter} · ${e.platform.toUpperCase()} ${e.stat.toUpperCase()} · ${tm}${flags ? ` · ${flags}` : ''}</div><div class="delta ${deltaClass}">${e.direction === 'drop' ? '-' : '+'}${deltaAbs}</div><div>${rlmTag}${spike}</div></div>`;
    }).join('');
}
class LineDropService {
    constructor() {
        this.settings = {
            enabled: false,
            direction: 'drop',
            threshold: 1.5,
            watchPlatforms: ['pick6', 'underdog', 'betr'],
            watchStats: ['fp', 'ss', 'td'],
            fighterAllowList: [],
            detectStealth: true,
            detectSteam: true,
            playSound: false,
        };
        this.snapshot = new Map();
        this.timer = null;
        this.currentPollMinutes = null;
        this.isPaused = false;
        this.lastPollAt = null;
        this.stealthAccumulator = new Map();
        this.settingsKey = 'analyzer_line_watch_settings';
    }
    async init() {
        await this.loadSettings();
        this.bindVisibilityHandlers();
        this.bindSettingsUI();
        this.updateStatusUI();
        renderLineMoveFeed();
        if (this.settings.enabled)
            await this.start();
    }
    async toggle() {
        if (this.settings.enabled)
            await this.stop();
        else
            await this.start();
    }
    async start() {
        this.settings.enabled = true;
        await this.saveSettings();
        setWatcherVisualState('watching');
        await this.pollNow(true);
        this.scheduleTimer();
        this.updateStatusUI();
        showToast('Line watch enabled');
    }
    async stop() {
        this.settings.enabled = false;
        await this.saveSettings();
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        setWatcherVisualState('idle');
        this.updateStatusUI();
        showToast('Line watch stopped');
    }
    async manualPoll() {
        await this.pollNow(false);
    }
    getLatestSpikeForFighter(fighter) {
        return latestValueSpikeByFighter[fighter] || null;
    }
    async loadSettings() {
        if (typeof chrome === 'undefined' || !chrome.storage)
            return;
        const data = await storageGet([this.settingsKey]);
        const saved = data?.[this.settingsKey];
        if (saved)
            this.settings = { ...this.settings, ...saved };
        this.syncSettingsToUI();
    }
    async saveSettings() {
        await storageSet({ [this.settingsKey]: this.settings });
    }
    bindVisibilityHandlers() {
        document.addEventListener('visibilitychange', () => {
            this.isPaused = document.hidden;
            if (this.isPaused)
                this.updateStatusUI('Paused (tab hidden)');
            else {
                this.updateStatusUI();
                if (this.settings.enabled)
                    this.pollNow(false).catch(() => null);
            }
        });
    }
    bindSettingsUI() {
        document.getElementById('watcherSettingsBtn')?.addEventListener('click', () => {
            const panel = document.getElementById('watcherSettingsPanel');
            if (!panel)
                return;
            panel.classList.toggle('is-hidden');
        });
        document.getElementById('watcherApplyBtn')?.addEventListener('click', async () => {
            this.readSettingsFromUI();
            await this.saveSettings();
            this.scheduleTimer();
            this.updateStatusUI();
            showToast('Watch settings updated');
        });
        document.getElementById('watcherManualPollBtn')?.addEventListener('click', () => this.manualPoll());
    }
    syncSettingsToUI() {
        const setChecked = (id, value) => {
            const el = document.getElementById(id);
            if (el)
                el.checked = value;
        };
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el)
                el.value = value;
        };
        setVal('watchDirection', this.settings.direction);
        setVal('watchThreshold', String(this.settings.threshold));
        setVal('watchFighterFilter', this.settings.fighterAllowList.join(', '));
        setChecked('watchP6', this.settings.watchPlatforms.includes('pick6'));
        setChecked('watchUD', this.settings.watchPlatforms.includes('underdog'));
        setChecked('watchBetr', this.settings.watchPlatforms.includes('betr'));
        setChecked('watchPP', this.settings.watchPlatforms.includes('prizepicks'));
        setChecked('watchFP', this.settings.watchStats.includes('fp'));
        setChecked('watchSS', this.settings.watchStats.includes('ss'));
        setChecked('watchTD', this.settings.watchStats.includes('td'));
        setChecked('watchStealth', this.settings.detectStealth);
        setChecked('watchSteam', this.settings.detectSteam);
        setChecked('watchSound', this.settings.playSound);
    }
    readSettingsFromUI() {
        const q = (id) => document.getElementById(id);
        const direction = (q('watchDirection')?.value || 'drop');
        const threshold = parseFloat(q('watchThreshold')?.value || '1.5');
        const fighterList = (q('watchFighterFilter')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const watchPlatforms = [
            q('watchP6')?.checked ? 'pick6' : null,
            q('watchUD')?.checked ? 'underdog' : null,
            q('watchBetr')?.checked ? 'betr' : null,
            q('watchPP')?.checked ? 'prizepicks' : null,
        ].filter((v) => v != null);
        const watchStats = [
            q('watchFP')?.checked ? 'fp' : null,
            q('watchSS')?.checked ? 'ss' : null,
            q('watchTD')?.checked ? 'td' : null,
        ].filter((v) => v != null);
        this.settings = {
            ...this.settings,
            direction,
            threshold: Number.isFinite(threshold) ? Math.max(0.1, threshold) : 1.5,
            fighterAllowList: fighterList,
            watchPlatforms: watchPlatforms.length ? watchPlatforms : ['pick6', 'underdog', 'betr'],
            watchStats: watchStats.length ? watchStats : ['fp', 'ss', 'td'],
            detectStealth: !!q('watchStealth')?.checked,
            detectSteam: !!q('watchSteam')?.checked,
            playSound: !!q('watchSound')?.checked,
        };
    }
    scheduleTimer() {
        if (this.timer)
            clearInterval(this.timer);
        if (!this.settings.enabled)
            return;
        const mins = this.smartPollMinutes();
        this.currentPollMinutes = mins;
        this.timer = setInterval(() => {
            if (!this.settings.enabled || this.isPaused)
                return;
            this.pollNow(false).catch(() => null);
        }, mins * 60000);
    }
    refreshTimerIfNeeded() {
        if (!this.settings.enabled)
            return;
        const nextMins = this.smartPollMinutes();
        if (this.currentPollMinutes === nextMins)
            return;
        this.scheduleTimer();
        this.updateStatusUI();
    }
    smartPollMinutes() {
        const eventDateText = document.getElementById('eventDate')?.textContent || '';
        const eventMs = parseEventDateMs(eventDateText);
        const days = Number.isFinite(eventMs) ? ((eventMs - Date.now()) / 86400000) : 5;
        if (days <= 0.5)
            return 3;
        if (days <= 1.5)
            return 5;
        if (days <= 3)
            return 10;
        if (days <= 5)
            return 20;
        return 35;
    }
    async getSnapshotPoints() {
        if (typeof chrome === 'undefined' || !chrome.storage)
            return [];
        const storage = await storageGet([...STORAGE_LINE_KEYS]);
        const platformMap = [
            { platform: 'pick6', key: 'lines_pick6' },
            { platform: 'underdog', key: 'lines_underdog' },
            { platform: 'betr', key: 'lines_betr' },
            { platform: 'prizepicks', key: 'lines_prizepicks' },
        ];
        const points = [];
        platformMap.forEach(({ platform, key }) => {
            if (!this.settings.watchPlatforms.includes(platform))
                return;
            const fighters = storage?.[key]?.fighters || [];
            fighters.forEach((f) => {
                const name = String(f.name || '').trim();
                if (!name)
                    return;
                if (this.settings.fighterAllowList.length && !this.settings.fighterAllowList.some(n => name.toLowerCase().includes(n.toLowerCase())))
                    return;
                const pushPoint = (stat, value) => {
                    if (!this.settings.watchStats.includes(stat))
                        return;
                    if (value == null || value === '')
                        return;
                    const num = Number(value);
                    if (!Number.isFinite(num))
                        return;
                    points.push({ fighter: name, platform, stat, value: num });
                };
                pushPoint('fp', f.line_fp ?? f.line);
                pushPoint('ss', f.line_ss);
                pushPoint('td', f.line_td);
            });
        });
        return points;
    }
    shouldDirectionInclude(direction) {
        if (this.settings.direction === 'both')
            return true;
        return this.settings.direction === direction;
    }
    detectEvents(points) {
        const now = Date.now();
        const events = [];
        points.forEach((p) => {
            const key = `${p.fighter}|${p.platform}|${p.stat}`;
            const prev = this.snapshot.get(key);
            this.snapshot.set(key, p.value);
            if (prev == null || prev === p.value)
                return;
            const delta = p.value - prev;
            const direction = delta < 0 ? 'drop' : 'rise';
            if (!this.shouldDirectionInclude(direction))
                return;
            const absDelta = Math.abs(delta);
            let stealth = false;
            if (absDelta < this.settings.threshold && this.settings.detectStealth) {
                const accum = this.stealthAccumulator.get(key) || { cumulative: 0, lastTs: now };
                const decay = (now - accum.lastTs) > 30 * 60000;
                const cumulative = (decay ? 0 : accum.cumulative) + absDelta;
                this.stealthAccumulator.set(key, { cumulative, lastTs: now });
                if (cumulative >= this.settings.threshold)
                    stealth = true;
            }
            if (absDelta < this.settings.threshold && !stealth)
                return;
            const recentSame = recentLineMoves.filter(e => e.fighter === p.fighter && e.platform === p.platform && e.stat === p.stat && (now - e.timestamp) <= 20 * 60000);
            const steamMagnitude = recentSame.reduce((s, e) => s + Math.abs(e.delta), 0) + absDelta;
            const steam = this.settings.detectSteam && steamMagnitude >= (this.settings.threshold * 2.2) && recentSame.length >= 1;
            const spike = this.isValueSpike(p.fighter, direction, absDelta);
            const rlmInfo = this.classifyRLM(p, delta);
            events.push({
                id: `${key}|${now}`,
                timestamp: now,
                fighter: p.fighter,
                platform: p.platform,
                stat: p.stat,
                from: prev,
                to: p.value,
                delta,
                direction,
                stealth,
                steam,
                valueSpike: spike,
                rlm: rlmInfo.rlm,
                rlmReason: rlmInfo.rlmReason,
                notes: spike ? 'Value opportunity emerged after line move' : undefined,
            });
        });
        return events;
    }
    // Reverse-line-movement proxy. On pick-em platforms (p6/ud/pp/betr) the public
    // default on fantasy-style props is OVER, so a line RISING against opening is
    // a sharp-UNDER signal. A hard DROP well below opening is a sharp-OVER signal
    // (heavy OVER action forcing the book down). We prefer the opening-anchored
    // delta when available; otherwise fall back to within-session rises.
    classifyRLM(p, delta) {
        const absDelta = Math.abs(delta);
        if (absDelta < 1.0)
            return {};
        const direction = delta < 0 ? 'drop' : 'rise';
        const platMap = { pick6: 'p6', underdog: 'ud', betr: 'betr', prizepicks: 'pp' };
        const platShort = platMap[p.platform];
        if (!platShort)
            return {};
        const opening = _openingLines.get(`${platShort}|${p.stat}|${p.fighter.toLowerCase().trim()}`);
        const openingDelta = (typeof opening === 'number' && Number.isFinite(opening)) ? (p.value - opening) : null;
        if (direction === 'rise') {
            if (openingDelta != null && openingDelta >= 1.0) {
                return { rlm: 'under', rlmReason: `+${openingDelta.toFixed(1)} vs open · sharp UNDER flow` };
            }
            if (absDelta >= 1.5) {
                return { rlm: 'under', rlmReason: `rising against public OVER flow` };
            }
            return {};
        }
        // drop direction: only flag as sharp OVER when current is deep under opening
        // AND this single move was meaningful (not tiny drift).
        if (openingDelta != null && openingDelta <= -2.0 && absDelta >= 1.5) {
            return { rlm: 'over', rlmReason: `${openingDelta.toFixed(1)} vs open · heavy OVER action` };
        }
        return {};
    }
    isValueSpike(fighter, direction, absDelta) {
        if (absDelta < Math.max(0.8, this.settings.threshold * 0.75))
            return false;
        const f = allFighters.find(x => x.name.toLowerCase() === fighter.toLowerCase());
        if (!f)
            return false;
        const lean = getEffectiveLean(f);
        if (lean.conf < 62 || lean.lean === 'none' || lean.lean === 'push')
            return false;
        if (direction === 'drop' && lean.lean === 'over')
            return true;
        if (direction === 'rise' && lean.lean === 'under')
            return true;
        return false;
    }
    emitAlert(events) {
        recentLineMoves = [...events, ...recentLineMoves].slice(0, 120);
        events.filter(e => e.valueSpike).forEach(e => { latestValueSpikeByFighter[e.fighter] = e; });
        renderLineMoveFeed();
        renderFighters();
        const first = events[0];
        setWatcherVisualState('detected', 'Line Alert');
        showLineDropAlert({
            event: document.getElementById('eventName')?.textContent || 'UFC card',
            drops: events.map(e => ({ platform: e.platform.toUpperCase(), type: e.stat.toUpperCase(), count: 1 })),
            udCount: events.length,
            p6Count: 0,
        });
        if (this.settings.playSound)
            this.playAlertSound();
        const spikeCount = events.filter(e => e.valueSpike).length;
        showToast(`Line move: ${first.fighter} ${first.stat.toUpperCase()} ${first.direction === 'drop' ? 'dropped' : 'rose'} ${Math.abs(first.delta).toFixed(1)}${spikeCount ? ` · ${spikeCount} value spike${spikeCount > 1 ? 's' : ''}` : ''}`);
    }
    playAlertSound() {
        try {
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor)
                return;
            const ac = new AudioContextCtor();
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = 'triangle';
            osc.frequency.value = 660;
            gain.gain.value = 0.03;
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start();
            osc.stop(ac.currentTime + 0.12);
        }
        catch {
            // ignore audio failures
        }
    }
    updateStatusUI(override) {
        const { statusEl, pollBadge, lastBadge } = getWatcherStatusElements();
        if (!statusEl || !pollBadge || !lastBadge)
            return;
        if (!this.settings.enabled) {
            statusEl.textContent = 'Idle · set filters, threshold, and direction then start watch';
            pollBadge.textContent = 'Poll: off';
            lastBadge.textContent = 'Last: --';
            setWatcherVisualState('idle', 'Watch Lines');
            return;
        }
        const poll = this.smartPollMinutes();
        const last = this.lastPollAt ? new Date(this.lastPollAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
        const mode = this.settings.direction === 'both' ? 'drops + rises' : `${this.settings.direction}s only`;
        const watching = override || `Watching ${this.settings.watchPlatforms.map(p => p.toUpperCase()).join('/')} · ${this.settings.watchStats.map(s => s.toUpperCase()).join('/')} · ${mode} ≥ ${this.settings.threshold}`;
        statusEl.textContent = watching;
        pollBadge.textContent = `Poll: ${poll}m`;
        lastBadge.textContent = `Last: ${last}`;
        if (!document.getElementById('watcherToggleBtn')?.classList.contains('state-detected')) {
            setWatcherVisualState('watching', 'Watching');
        }
    }
    async pollNow(initial = false) {
        if (!this.settings.enabled || this.isPaused)
            return;
        try {
            const points = await this.getSnapshotPoints();
            const events = this.detectEvents(points);
            this.lastPollAt = Date.now();
            this.refreshTimerIfNeeded();
            this.updateStatusUI();
            if (events.length)
                this.emitAlert(events);
            else if (!initial)
                setWatcherVisualState('watching', 'Watching');
            if (!initial && typeof chrome !== 'undefined' && chrome.runtime) {
                void runtimeSendMessage({ type: 'MANUAL_POLL_NOW' });
            }
        }
        catch (e) {
            console.error('[LineDropService] Poll error', e);
            setWatcherVisualState('error', 'Watch Error');
            this.updateStatusUI('Error polling lines — retrying on next cycle');
        }
    }
}
const lineDropService = new LineDropService();
function toggleWatcher() {
    lineDropService.toggle().catch((e) => {
        console.error('[LineDropService] toggle failed', e);
        setWatcherVisualState('error', 'Watch Error');
    });
}
// ── AUTO-SCRAPE ────────────────────────────────────────────────────────────
async function triggerAutoScrape() {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        showToast('Extension not available — running in demo mode');
        return;
    }
    const btn = document.getElementById('autoScrapeBtn');
    const icon = document.getElementById('autoScrapeIcon');
    setButtonBusyState(btn, true);
    setIconSpinnerState(icon, true);
    showToast('⚡ Fast auto-fetch: Underdog API first, tabs only if needed...');
    let result = null;
    try {
        result = await runtimeSendMessage({ type: 'AUTO_SCRAPE_LINES' });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected auto-scrape error';
        showToast(`Auto-scrape failed: ${message}`);
        return;
    }
    finally {
        setIconSpinnerState(icon, false);
        setButtonBusyState(btn, false);
    }
    if (result?.status === 'done') {
        const totals = Object.values(result.results || {}).reduce((s, n) => s + n, 0);
        showToast(`✓ Fetched lines from ${Object.keys(result.results || {}).length} platforms — ${totals} fighters loaded`);
        requestDataReload();
    }
    else if (result?.status === 'already_running') {
        showToast('Auto-scrape already in progress...');
    }
    else {
        showToast('Auto-scrape complete — click Refresh to load');
        requestDataReload();
    }
}
// ── EVENT BANNER ──────────────────────────────────────────────────────────
function formatCountdown(eventDate) {
    const now = Date.now();
    const target = parseEventDateMs(eventDate);
    if (!Number.isFinite(target))
        return 'Date unavailable';
    const diff = target - now;
    if (diff <= 0)
        return 'LIVE NOW 🔴';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0)
        return `${days}d ${hours}h until event`;
    if (hours > 0)
        return `${hours}h ${mins}m until event`;
    return `${mins}m until event`;
}
async function loadEventBanner() {
    if (typeof chrome === 'undefined' || !chrome.runtime)
        return;
    const banner = document.getElementById('eventBanner');
    const nameEl = document.getElementById('eventName');
    const dateEl = document.getElementById('eventDate');
    const cntEl = document.getElementById('eventCountdown');
    if (banner)
        banner.style.display = 'flex';
    if (nameEl)
        nameEl.textContent = 'Detecting next UFC event...';
    const card = await syncUpcomingCardContext(true);
    if (!card) {
        upcomingCardPairs = [];
        upcomingEventName = '';
        if (banner)
            banner.style.display = 'none';
        debugLog('Upcoming card ignored: stale/invalid date in runtime+cache');
        return;
    }
    debugLog(`Upcoming card pairs loaded: ${upcomingCardPairs.length}`);
    const cardDate = card.date || '';
    if (nameEl)
        nameEl.textContent = card.event || 'Upcoming UFC Event';
    if (dateEl)
        dateEl.textContent = cardDate;
    if (cntEl)
        cntEl.textContent = formatCountdown(cardDate);
    // Venue badge
    const venueEl = document.getElementById('venueBadge');
    if (venueEl && currentVenueLabel) {
        let badge = `\ud83d\udccd ${currentVenueLabel}`;
        badge += ` \u00b7 <span class="cage-size">${currentVenueFactor.cageSizeFt}ft cage</span>`;
        if (currentVenueFactor.altitudeMeters >= 1200) {
            badge += ` \u00b7 <span class="altitude-warn">\u26a0 ${currentVenueFactor.altitudeMeters}m altitude</span>`;
        }
        if (currentVenueFactor.climateNote) {
            badge += ` \u00b7 <span style="opacity:0.6">${currentVenueFactor.climateNote}</span>`;
        }
        venueEl.innerHTML = badge;
        venueEl.style.display = '';
    }
    else if (venueEl) {
        venueEl.style.display = 'none';
    }
    if (eventCountdownTimer)
        clearInterval(eventCountdownTimer);
    eventCountdownTimer = setInterval(() => {
        if (cntEl)
            cntEl.textContent = formatCountdown(cardDate);
    }, 60000);
    if (card.fighters?.length && allFighters.length === 0) {
        debugLog(`Detected card: ${card.event} — ${card.fighters.length} fights`);
        const detected = [];
        card.fighters.forEach(({ f1, f2 }) => {
            detected.push(createPlaceholderAnalyzerFighter(f1, f2));
            detected.push(createPlaceholderAnalyzerFighter(f2, f1));
        });
        const result = await storageGet([...STORAGE_LINE_KEYS]);
        const hasRealData = (result['lines_pick6']?.fighters?.length || 0) +
            (result['lines_underdog']?.fighters?.length || 0) +
            (result['lines_prizepicks']?.fighters?.length || 0) +
            (result['lines_draftkings_sportsbook']?.fighters?.length || 0) +
            (result['lines_betr']?.fighters?.length || 0) > 0;
        if (!hasRealData) {
            showToast(`📅 Detected ${card.event} — ${card.fighters.length} fights found. Click ⚡ AUTO-FETCH LINES to get odds.`);
            allFighters = detected;
            renderFighters();
        }
    }
}
// ── BOOT ──────────────────────────────────────────────────────────────────
function setActivePlatform(platform) {
    currentPlatform = platform;
    document.querySelectorAll('[data-platform]').forEach(b => b.classList.remove('platform-selected'));
    const target = document.querySelector(`[data-platform="${platform}"]`);
    if (target)
        target.classList.add('platform-selected');
    renderFighters();
}
function setTrendWindow(w) {
    trendWindow = w;
    document.querySelectorAll('.trend-btn[data-window]').forEach(b => b.classList.remove('active'));
    document.querySelector(`.trend-btn[data-window="${w}"]`)?.classList.add('active');
    updateSortTrendTriggerLabel();
    renderFighters();
}
function updateSortTrendTriggerLabel() {
    const sortEl = document.getElementById('sortTrendActiveSort');
    const trendEl = document.getElementById('sortTrendActiveTrend');
    if (sortEl) {
        const activeSort = document.querySelector('.sort-btn.active');
        if (activeSort)
            sortEl.textContent = (activeSort.textContent || '').trim();
    }
    if (trendEl) {
        const activeTrend = document.querySelector('.trend-btn.active');
        if (activeTrend)
            trendEl.textContent = (activeTrend.textContent || '').trim();
    }
}
function bindSourceToggles() {
    const buttons = document.querySelectorAll('.source-toggle[data-source]');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = (btn.dataset.source || '');
            if (!(key in sourceVisibility))
                return;
            sourceVisibility[key] = !sourceVisibility[key];
            if (!Object.values(sourceVisibility).some(Boolean)) {
                sourceVisibility[key] = true;
            }
            updateSourceToggleUI();
            updateSourceRowVisibility(true);
            renderFighters();
        });
    });
    const trigger = document.getElementById('sourceToggleTrigger');
    trigger?.addEventListener('click', () => {
        sourceButtonsExpanded = !sourceButtonsExpanded;
        updateSourceRowVisibility(true);
    });
    updateSourceToggleUI();
}
function bindLearningDetailsToggle() {
    const toggle = document.getElementById('ldDetailsToggle');
    const details = document.getElementById('ldDetails');
    if (!toggle || !details)
        return;
    toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        const next = !expanded;
        toggle.setAttribute('aria-expanded', String(next));
        if (next)
            details.removeAttribute('hidden');
        else
            details.setAttribute('hidden', '');
    });
}
function syncDataTabsTrigger() {
    const trigger = document.getElementById('dataTabsTrigger');
    const labelEl = document.getElementById('dataTabsLabel');
    if (!trigger || !labelEl)
        return;
    const isDataView = currentView === 'calibration' || currentView === 'archive';
    trigger.classList.toggle('is-data-active', isDataView);
    if (isDataView) {
        const activeBtn = document.querySelector(`#dataTabsPopover [data-view="${currentView}"]`);
        labelEl.textContent = (activeBtn?.textContent || 'Data').trim();
    }
    else {
        labelEl.textContent = 'Data';
    }
}
function bindDataTabsTrigger() {
    const trigger = document.getElementById('dataTabsTrigger');
    const popover = document.getElementById('dataTabsPopover');
    if (!trigger || !popover)
        return;
    const closePopover = () => {
        trigger.setAttribute('aria-expanded', 'false');
        popover.setAttribute('hidden', '');
    };
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', String(!expanded));
        if (expanded)
            popover.setAttribute('hidden', '');
        else
            popover.removeAttribute('hidden');
    });
    // Selecting a sub-tab closes the popover (existing tab handler still fires)
    popover.addEventListener('click', () => closePopover());
    // Click outside → close
    document.addEventListener('click', (e) => {
        if (trigger.contains(e.target) || popover.contains(e.target))
            return;
        closePopover();
    });
}
function updateDensityTriggerDot() {
    const dot = document.getElementById('densityTriggerDot');
    const trigger = document.getElementById('densityTrigger');
    if (!dot || !trigger)
        return;
    const nonDefault = currentDensity === 'compact' || currentHistoryDensity === 'readable';
    dot.hidden = !nonDefault;
    if (nonDefault) {
        const labels = [];
        if (currentDensity === 'compact')
            labels.push('Compact View');
        if (currentHistoryDensity === 'readable')
            labels.push('History: Readable');
        trigger.title = `Active: ${labels.join(' · ')}`;
    }
    else {
        trigger.title = 'Display density options';
    }
}
function applyDensityMode() {
    const compact = currentDensity === 'compact';
    document.body.classList.toggle('compact-view', compact);
    const btn = document.getElementById('densityToggleBtn');
    if (btn) {
        btn.textContent = compact ? 'Detailed View' : 'Compact View';
        btn.classList.toggle('active', compact);
    }
    updateDensityTriggerDot();
}
function applyHistoryDensityMode() {
    const readable = currentHistoryDensity === 'readable';
    document.body.classList.toggle('readable-history', readable);
    const btn = document.getElementById('historyDensityToggleBtn');
    if (btn) {
        btn.textContent = readable ? 'History: Readable' : 'History: Compact';
        btn.classList.toggle('active', readable);
    }
    updateDensityTriggerDot();
}
function exportToCSV() {
    const fighters = allFighters.filter(f => getEffectiveLean(f).lean !== 'none');
    if (!fighters.length) {
        showToast('No leans to export');
        return;
    }
    const csv = [
        'Name,Opponent,Platform,Line,Lean,Confidence,ConfidenceGrade,BayesProb,CalibratedProb,ModelAgreement,KellyBetSize,EV,EV_Source,Vig,FairValue,FairValueEdge,Verdict',
        ...fighters.map(f => {
            const el = getEffectiveLean(f);
            const line = activePlatformLine(f);
            const platform = activePlatformLabel(f);
            const confidenceGrade = el.confidenceGrade || '';
            const bayesProb = el.bayesianProbability != null ? (el.bayesianProbability * 100).toFixed(1) : '';
            const calibratedProb = el.calibratedProbability != null ? (el.calibratedProbability * 100).toFixed(1) : '';
            const modelAgreement = el.ensembleAgreement != null ? (el.ensembleAgreement * 100).toFixed(1) : '';
            const kellyBetSize = el.kellyBetSize != null ? el.kellyBetSize.toFixed(2) : '';
            const evDetail = computeDetailedEV(f, el);
            const evStr = evDetail != null ? `${evDetail.ev}%` : '';
            const evSource = evDetail != null ? (evDetail.isAssumedVig ? 'assumed-110' : 'actual') : '';
            const vigStr = evDetail?.vig != null ? `${evDetail.vig}%` : '';
            const fairValue = el.fairValue != null ? el.fairValue.toFixed(1) : '';
            const fairValueEdge = el.fairValueEdge != null ? el.fairValueEdge.toFixed(1) : '';
            return `"${f.name}","${f.opponent || ''}","${platform}","${line || ''}","${el.lean}","${el.conf}","${confidenceGrade}","${bayesProb}","${calibratedProb}","${modelAgreement}","${kellyBetSize}","${evStr}","${evSource}","${vigStr}","${fairValue}","${fairValueEdge}","${el.verdict}"`;
        })
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ufc-leans-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported leans to CSV');
}
let _reportCardText = '';
function bestAvailableLine(f) {
    // Return the best FP line across all platforms with a short source label
    if (currentPlatform === 'pick6' && f.line_p6 != null)
        return { line: f.line_p6, src: 'P6' };
    if (currentPlatform === 'underdog' && f.line_ud != null)
        return { line: f.line_ud, src: 'UD' };
    if (currentPlatform === 'prizepicks' && f.line_pp != null)
        return { line: f.line_pp, src: 'PP' };
    if (currentPlatform === 'betr' && f.line_betr != null)
        return { line: f.line_betr, src: 'BT' };
    // Fallback: any platform with a line
    if (f.line_p6 != null)
        return { line: f.line_p6, src: 'P6' };
    if (f.line_ud != null)
        return { line: f.line_ud, src: 'UD' };
    if (f.line_pp != null)
        return { line: f.line_pp, src: 'PP' };
    if (f.line_betr != null)
        return { line: f.line_betr, src: 'BT' };
    if (f.line_dk_ss != null)
        return { line: f.line_dk_ss, src: 'DK' };
    return { line: null, src: '' };
}
// Fetches UFCStats directly from the popup (avoids MV3 service worker kill issue).
// Searches upcoming + completed pages for an event that overlaps with `names`.
async function fetchCardFromUFCStatsDirect(names) {
    const nameSet = new Set(names.map(n => n.toLowerCase().replace(/[^a-z ]/g, '')));
    const parseFighters = (html) => {
        const result = [];
        for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const row = rowM[1];
            if (row.includes('<th'))
                continue;
            const links = [...row.matchAll(/fighter-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/gi)];
            if (links.length < 2)
                continue;
            const f1 = links[0][1].trim();
            const f2 = links[1][1].trim();
            if (!f1 || !f2 || f1 === '--' || f2 === '--')
                continue;
            result.push({ f1, f2 });
        }
        return result;
    };
    const parseEventList = (html) => {
        const evts = [];
        for (const rowM of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const row = rowM[1];
            if (row.includes('<th'))
                continue;
            const linkM = row.match(/href="(http[^"]*event-details\/[a-f0-9]+)"/i);
            const nameM = row.match(/event-details\/[a-f0-9]+[^>]*>\s*([^<]+)\s*<\/a>/i);
            const dateM = row.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d+,\s+\d{4}/i);
            if (!linkM || !nameM)
                continue;
            const ts = dateM ? Date.parse(dateM[0]) : 0;
            evts.push({ name: nameM[1].trim(), url: linkM[1], ts });
        }
        return evts;
    };
    const hasEnoughOverlap = (fighters) => {
        let count = 0;
        for (const { f1, f2 } of fighters) {
            if (nameSet.has(f1.toLowerCase().replace(/[^a-z ]/g, '')) ||
                nameSet.has(f2.toLowerCase().replace(/[^a-z ]/g, '')))
                count++;
        }
        return fighters.length >= 4 && count >= Math.ceil(fighters.length * 0.35);
    };
    try {
        const sources = [
            'http://www.ufcstats.com/statistics/events/upcoming?page=all',
            'http://www.ufcstats.com/statistics/events/completed?page=1',
        ];
        for (const src of sources) {
            const listHtml = await ufcstatsFetchText(src);
            if (!listHtml)
                continue;
            const evts = parseEventList(listHtml);
            // Sort by proximity to today; check most recent 10
            const sorted = evts.slice().sort((a, b) => Math.abs(Date.now() - a.ts) - Math.abs(Date.now() - b.ts));
            for (const evt of sorted.slice(0, 10)) {
                const evHtml = await ufcstatsFetchText(evt.url);
                if (!evHtml)
                    continue;
                const fighters = parseFighters(evHtml);
                if (hasEnoughOverlap(fighters)) {
                    return { event: evt.name, fighters };
                }
            }
        }
    }
    catch { /* ignore */ }
    return null;
}
async function generateReportCard() {
    if (!allFighters.length) {
        showToast('No fighters loaded');
        return;
    }
    // Step 1: Pair fighters using opponent field (reliable — comes from line data, always set)
    const seenPair = new Set();
    const fighterPairs = [];
    for (const f of allFighters) {
        if (seenPair.has(f.name))
            continue;
        seenPair.add(f.name);
        let opp;
        if (f.opponent) {
            opp = allFighters.find(x => !seenPair.has(x.name) && (namesMatch(x.name, f.opponent) || strictCardNameMatch(x.name, f.opponent)));
        }
        if (opp) {
            seenPair.add(opp.name);
            fighterPairs.push([f, opp]);
        }
        else
            fighterPairs.push([f]);
    }
    // Step 2: Get card ordering data — only use card pairs that overlap with currently loaded fighters.
    // upcomingCardPairs may contain the NEXT event's fighters (not the event whose lines are loaded).
    let reportTitle = upcomingEventName || inferredEventNameFromLines;
    const loadedNames = new Set(allFighters.map(f => (normalizeName(f.name) || f.name).toLowerCase()));
    const hasOverlap = (pairs) => pairs.filter(cp => loadedNames.has(cp.f1.toLowerCase()) || loadedNames.has(cp.f2.toLowerCase())).length
        >= Math.ceil(pairs.length * 0.4);
    const normalizeCardFighters = (fighters) => fighters
        .map((fight) => {
        const f1 = normalizeName(fight.f1);
        const f2 = normalizeName(fight.f2);
        return (f1 && f2 && f1 !== f2) ? { f1, f2 } : null;
    })
        .filter((p) => p != null);
    const tryCardStorage = async () => {
        const raw = await storageGet(['upcoming_ufc_card', 'last_completed_ufc_card']);
        for (const key of ['upcoming_ufc_card', 'last_completed_ufc_card']) {
            const rawCard = raw[key];
            if (!rawCard?.fighters?.length)
                continue;
            const normalized = normalizeCardFighters(rawCard.fighters);
            if (hasOverlap(normalized)) {
                cardOrderPairs = normalized;
                if (!reportTitle)
                    reportTitle = buildEventDisplayName(rawCard.event || '', rawCard.fighters);
                return true;
            }
        }
        return false;
    };
    let cardOrderPairs = [];
    if (upcomingCardPairs.length && hasOverlap(upcomingCardPairs)) {
        cardOrderPairs = upcomingCardPairs.slice();
    }
    else {
        const found = await tryCardStorage();
        if (!found) {
            // Fetch UFCStats directly from popup (avoids MV3 service worker kill mid-fetch)
            const names = allFighters.map(f => f.name);
            const directCard = await fetchCardFromUFCStatsDirect(names);
            if (directCard?.fighters?.length) {
                const normalized = normalizeCardFighters(directCard.fighters);
                if (hasOverlap(normalized)) {
                    cardOrderPairs = normalized;
                    if (!reportTitle)
                        reportTitle = buildEventDisplayName(directCard.event || '', directCard.fighters);
                }
            }
        }
    }
    // Step 3: Sort pairs by card order (if available)
    const orderedPairs = [];
    if (cardOrderPairs.length) {
        const usedPairIdx = new Set();
        for (const cp of cardOrderPairs) {
            const idx = fighterPairs.findIndex((pair, i) => !usedPairIdx.has(i) && pair.some(f => strictCardNameMatch(f.name, cp.f1) || strictCardNameMatch(f.name, cp.f2)));
            if (idx >= 0) {
                usedPairIdx.add(idx);
                orderedPairs.push(fighterPairs[idx]);
            }
        }
        fighterPairs.forEach((pair, i) => { if (!usedPairIdx.has(i))
            orderedPairs.push(pair); });
    }
    else {
        // No UFCStats card data — use UD storage order as a proxy (UD lists fights in card order)
        const udStorage = await storageGet(['lines_underdog']);
        const udFighterNames = (udStorage['lines_underdog']?.fighters || [])
            .map((f) => (normalizeName(String(f?.name || '')) || '').toLowerCase())
            .filter(Boolean);
        if (udFighterNames.length) {
            const udPos = new Map();
            udFighterNames.forEach((n, i) => udPos.set(n, i));
            const pairMinUdPos = (pair) => {
                let min = Infinity;
                for (const f of pair) {
                    const key = (normalizeName(f.name) || f.name).toLowerCase();
                    const exact = udPos.get(key);
                    if (exact !== undefined && exact < min)
                        min = exact;
                    if (min === Infinity) {
                        const last = key.split(' ').pop() ?? '';
                        if (last.length > 4) {
                            for (const [k, p] of udPos) {
                                if (k.split(' ').pop() === last && p < min) {
                                    min = p;
                                    break;
                                }
                            }
                        }
                    }
                }
                return min;
            };
            const sorted = fighterPairs.slice().sort((a, b) => pairMinUdPos(a) - pairMinUdPos(b));
            orderedPairs.push(...sorted);
        }
        else {
            // No UD data — at least promote the main event headliner pair to position 0
            const headsMatch = reportTitle.match(/:\s*(.+?)\s+vs\.?\s+(.+)$/i);
            let headlinerIdx = -1;
            if (headsMatch) {
                const h1 = headsMatch[1].trim();
                const h2 = headsMatch[2].trim();
                headlinerIdx = fighterPairs.findIndex(pair => pair.some(f => strictCardNameMatch(f.name, h1) || strictCardNameMatch(f.name, h2) ||
                    namesMatch(f.name, h1) || namesMatch(f.name, h2)));
            }
            if (headlinerIdx > 0) {
                const reordered = fighterPairs.slice();
                reordered.unshift(...reordered.splice(headlinerIdx, 1));
                orderedPairs.push(...reordered);
            }
            else {
                orderedPairs.push(...fighterPairs);
            }
        }
    }
    const eventTitle = reportTitle || 'UFC Card';
    const eventDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const groups = [];
    const getBadge = (fi, total) => {
        if (fi === 0)
            return { badge: 'MAIN EVENT', badgeCls: 'main-event' };
        if (fi === 1)
            return { badge: 'CO-MAIN', badgeCls: 'co-main' };
        if (fi < Math.ceil(total * 0.55))
            return { badge: 'MAIN CARD', badgeCls: 'main-card' };
        return { badge: 'PRELIM', badgeCls: 'prelim' };
    };
    const total = orderedPairs.length;
    orderedPairs.forEach((pair, fi) => {
        const { badge, badgeCls } = getBadge(fi, total);
        groups.push({ badge, badgeCls, pair });
    });
    const leanFighters = allFighters.filter(f => getEffectiveLean(f).lean !== 'none');
    const overCount = leanFighters.filter(f => getEffectiveLean(f).lean === 'over').length;
    const underCount = leanFighters.filter(f => getEffectiveLean(f).lean === 'under').length;
    const avgConf = leanFighters.length
        ? Math.round(leanFighters.reduce((s, f) => s + getEffectiveLean(f).conf, 0) / leanFighters.length)
        : 0;
    const sections = [];
    sections.push(`
    <div class="rc-event-header">
      <div class="rc-event-name">${eventTitle}</div>
      <div class="rc-event-meta">Generated ${eventDate}</div>
    </div>
    <div class="rc-summary">
      <span class="rc-stat">${leanFighters.length} leans</span>
      <span class="rc-dot">·</span>
      <span class="rc-stat rc-over">${overCount} overs</span>
      <span class="rc-dot">·</span>
      <span class="rc-stat rc-under">${underCount} unders</span>
      <span class="rc-dot">·</span>
      <span class="rc-stat">avg conf: ${avgConf}%</span>
    </div>
  `);
    for (const g of groups) {
        const rows = g.pair.map(f => {
            const el = getEffectiveLean(f);
            const { line, src } = bestAvailableLine(f);
            const leanCls = el.lean === 'over' ? 'rc-over' : el.lean === 'under' ? 'rc-under' : 'rc-none';
            const leanLabel = el.lean === 'over' ? '▲ OVER' : el.lean === 'under' ? '▼ UNDER' : '—';
            const confEl = el.lean !== 'none'
                ? `<span class="rc-conf">${el.conf}%</span>`
                : `<span class="rc-conf" style="color:var(--text3)">—</span>`;
            const avgEl = f.db?.avgFP != null
                ? `<span class="rc-avg">avg ${f.db.avgFP.toFixed(1)}</span>`
                : `<span class="rc-avg"></span>`;
            const topReason = el.reasons?.[0]?.text ?? '';
            const lineStr = line != null ? line.toFixed(1) : '—';
            const srcEl = src ? `<span class="rc-src">${src}</span>` : '';
            return `<div class="rc-fighter-row">
        <span class="rc-name">${f.name}</span>
        <span class="rc-lean-chip ${leanCls}">${leanLabel}</span>
        <span class="rc-line">${lineStr}</span>
        ${srcEl}
        ${confEl}
        ${avgEl}
        ${topReason ? `<span class="rc-reason">${topReason}</span>` : ''}
      </div>`;
        }).join('');
        sections.push(`<div class="rc-fight-group">
      <span class="rc-fight-badge rc-badge-${g.badgeCls}">${g.badge}</span>
      <div class="rc-matchup">${rows}</div>
    </div>`);
    }
    const content = document.getElementById('reportContent');
    if (content)
        content.innerHTML = sections.join('');
    const sub = document.getElementById('reportModalSub');
    if (sub)
        sub.textContent = `${allFighters.length} fighters · ${leanFighters.length} actionable leans`;
    document.getElementById('reportModal')?.classList.remove('is-hidden');
    // Build plain-text version for clipboard/download
    const textLines = [
        `\uD83D\uDCCA ${eventTitle}`,
        `Generated: ${eventDate}`,
        '',
    ];
    for (const g of groups) {
        const bar = '\u2501'.repeat(Math.max(0, 38 - g.badge.length));
        textLines.push(`\u2501\u2501\u2501 ${g.badge} ${bar}`);
        const [fa, fb] = g.pair;
        if (fa && fb)
            textLines.push(`\u2694  ${fa.name.toUpperCase()} vs ${fb.name.toUpperCase()}`);
        else if (fa)
            textLines.push(`\u2694  ${fa.name.toUpperCase()}`);
        for (const f of g.pair) {
            const el = getEffectiveLean(f);
            const { line, src } = bestAvailableLine(f);
            const leanStr = el.lean === 'over' ? '\u25B2 OVER ' : el.lean === 'under' ? '\u25BC UNDER' : '\u2500      ';
            const lineStr = line != null ? `${src} ${line.toFixed(1)}`.padStart(9) : '         ';
            const confStr = el.lean !== 'none' ? `${el.conf}% conf` : '';
            const avgStr = f.db?.avgFP != null ? `avg: ${f.db.avgFP.toFixed(1)} FP` : '';
            textLines.push(`    ${f.name.padEnd(22)} ${leanStr}  ${lineStr}  ${confStr.padEnd(9)}  ${avgStr}`);
        }
        textLines.push('');
    }
    textLines.push('\u2500'.repeat(45));
    textLines.push(`${leanFighters.length} leans  \u00B7  ${overCount} overs  \u00B7  ${underCount} unders  \u00B7  avg conf: ${avgConf}%`);
    _reportCardText = textLines.join('\n');
}
function runWalkForwardDiagnostics() {
    const engine = new BacktestingEngine();
    const eventsByDate = new Map();
    let createdPredictions = 0;
    allFighters.forEach(f => {
        const line = activePlatformLine(f) ?? f.db?.avgFP ?? null;
        const history = (f.db?.history || []).filter(h => h.fp != null);
        if (!line || history.length < 7)
            return;
        for (let i = 6; i < history.length; i++) {
            const train = history.slice(Math.max(0, i - 6), i);
            const trainFP = train.map(h => h.fp || 0);
            if (!trainFP.length)
                continue;
            const mean = trainFP.reduce((s, v) => s + v, 0) / trainFP.length;
            const variance = trainFP.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / trainFP.length;
            const std = Math.max(8, Math.sqrt(variance));
            const overProb = 1 / (1 + Math.exp(-((mean - line) / std)));
            const lean = overProb > 0.52 ? 'over' : overProb < 0.48 ? 'under' : 'push';
            if (lean === 'push')
                continue;
            const confidence = Math.min(0.95, Math.abs(overProb - 0.5) * 2 + 0.45);
            const expectedValue = lean === 'over' ? overProb : 1 - overProb;
            const ts = history[i].date ? new Date(history[i].date).getTime() : (Date.now() - (history.length - i) * 86400000);
            const eventTs = Number.isFinite(ts) ? ts : Date.now();
            if (!eventsByDate.has(eventTs)) {
                eventsByDate.set(eventTs, {
                    timestamp: eventTs,
                    predictions: [],
                    actualResults: []
                });
            }
            const evt = eventsByDate.get(eventTs);
            evt.predictions.push({
                fighter: f.name,
                line,
                prediction: {
                    lean,
                    confidence,
                    edge: Math.abs(overProb - 0.5) * 2,
                    expectedValue
                }
            });
            evt.actualResults.push({
                fighter: f.name,
                actualFP: history[i].fp || 0
            });
            createdPredictions++;
        }
    });
    const events = Array.from(eventsByDate.values())
        .filter(e => e.predictions.length > 0)
        .sort((a, b) => a.timestamp - b.timestamp);
    if (events.length < 7) {
        showToast('Walk-forward needs more history (min 7 event buckets)');
        debugLog(`Walk-forward skipped: only ${events.length} event buckets`);
        return;
    }
    const result = engine.runWalkForwardValidation(events, 6);
    if (!result.folds.length) {
        showToast('Walk-forward produced no valid folds');
        debugLog('Walk-forward produced no folds after filtering');
        return;
    }
    const avgCal = result.folds.reduce((sum, f) => sum + f.calibrationScore, 0) / result.folds.length;
    const msg = `WF OK: acc ${(result.overallAccuracy * 100).toFixed(1)}% · brier ${result.overallBrierScore.toFixed(3)} · cal ${avgCal.toFixed(3)}`;
    showToast(msg);
    debugLog(`Walk-forward diagnostics: events=${events.length}, preds=${createdPredictions}, folds=${result.folds.length}`);
    result.folds.slice(0, 8).forEach((f, idx) => {
        debugLog(`WF fold ${idx + 1}: train=${f.trainSize}, test=${f.testSize}, acc=${(f.accuracy * 100).toFixed(1)}%, brier=${f.brierScore.toFixed(3)}, cal=${f.calibrationScore.toFixed(3)}`);
    });
}
function setExclusiveActive(selector, activeEl) {
    document.querySelectorAll(selector).forEach((el) => el.classList.remove('active'));
    activeEl.classList.add('active');
}
function bindExclusiveButtons(selector, onActivate) {
    document.querySelectorAll(selector).forEach((el) => {
        el.addEventListener('click', () => {
            setExclusiveActive(selector, el);
            onActivate(el);
        });
    });
}
// ── UI INIT ───────────────────────────────────────────────────────────────
function initAnalyzerCore() {
    // Load any persisted manual style overrides before predictions/fighter DBs build.
    void applyFighterStyleOverrides();
    // Platform switcher
    document.querySelectorAll('[data-platform]').forEach(btn => {
        btn.addEventListener('click', () => setActivePlatform(btn.dataset['platform'] || 'pick6'));
    });
    setActivePlatform('pick6');
    // Trend window toggle (L3 / L5 / Career)
    document.querySelectorAll('.trend-btn[data-window]').forEach(btn => {
        btn.addEventListener('click', () => {
            const w = parseInt(btn.dataset['window'] || '3');
            setTrendWindow((w === 0 || w === 5 ? w : 3));
        });
    });
    bindSourceToggles();
    bindLearningDetailsToggle();
    // Top-bar buttons
    document.getElementById('refreshBtn')?.addEventListener('click', loadData);
    document.getElementById('autoScrapeBtn')?.addEventListener('click', triggerAutoScrape);
    document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);
    // Header overflow ("More" dropdown) for rare actions
    const overflowBtn = document.getElementById('headerOverflowBtn');
    const overflowPanel = document.getElementById('headerOverflowPanel');
    if (overflowBtn && overflowPanel) {
        const closeOverflow = () => {
            overflowPanel.hidden = true;
            overflowBtn.setAttribute('aria-expanded', 'false');
        };
        overflowBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const willOpen = overflowPanel.hidden;
            overflowPanel.hidden = !willOpen;
            overflowBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
        document.addEventListener('click', (ev) => {
            if (overflowPanel.hidden)
                return;
            const target = ev.target;
            if (target && !overflowPanel.contains(target) && target !== overflowBtn && !overflowBtn.contains(target)) {
                closeOverflow();
            }
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !overflowPanel.hidden)
                closeOverflow();
        });
        overflowPanel.addEventListener('click', (ev) => {
            const target = ev.target;
            if (target?.closest('.overflow-item'))
                closeOverflow();
        });
    }
    // Line Movement Summary toggle
    document.getElementById('movementSummaryHeader')?.addEventListener('click', () => {
        const body = document.getElementById('movementSummaryBody');
        const toggle = document.getElementById('movementSummaryToggle');
        if (body && toggle) {
            const collapsed = body.style.display === 'none';
            body.style.display = collapsed ? '' : 'none';
            toggle.textContent = collapsed ? '▲' : '▼';
        }
    });
    document.getElementById('reportCardBtn')?.addEventListener('click', generateReportCard);
    document.getElementById('lineShopBtn')?.addEventListener('click', generateLineShopModal);
    document.getElementById('backupStorageBtn')?.addEventListener('click', async () => {
        try {
            const all = await new Promise((res) => chrome.storage.local.get(null, (data) => res(data || {})));
            const keys = Object.keys(all);
            const payload = {
                __ufcBackup: true,
                version: 1,
                exportedAt: new Date().toISOString(),
                keyCount: keys.length,
                storage: all,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const a = document.createElement('a');
            a.href = url;
            a.download = `ufc-storage-backup-${stamp}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            showToast(`✓ Backup: ${keys.length} keys saved`);
        }
        catch (e) {
            showToast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
    const restoreFileInput = document.getElementById('restoreStorageFile');
    document.getElementById('restoreStorageBtn')?.addEventListener('click', () => restoreFileInput?.click());
    restoreFileInput?.addEventListener('change', async () => {
        const file = restoreFileInput.files?.[0];
        if (!file)
            return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const storage = parsed?.storage && typeof parsed.storage === 'object' ? parsed.storage : null;
            if (!parsed?.__ufcBackup || !storage) {
                showToast('Restore failed: not a valid UFC backup file');
                return;
            }
            const keys = Object.keys(storage);
            if (!keys.length) {
                showToast('Restore failed: backup is empty');
                return;
            }
            const confirmed = confirm(`Restore ${keys.length} storage keys from backup exported ${parsed.exportedAt || 'unknown'}?\n\nThis OVERWRITES existing data for those keys. Other keys are left alone.`);
            if (!confirmed)
                return;
            await new Promise((res, rej) => chrome.storage.local.set(storage, () => {
                const err = chrome.runtime?.lastError;
                if (err)
                    rej(new Error(err.message));
                else
                    res();
            }));
            showToast(`✓ Restored ${keys.length} keys — reloading…`);
            setTimeout(() => location.reload(), 900);
        }
        catch (e) {
            showToast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        finally {
            restoreFileInput.value = '';
        }
    });
    const lineShopModal = document.getElementById('lineShopModal');
    document.getElementById('lineShopClose')?.addEventListener('click', () => lineShopModal?.classList.add('is-hidden'));
    lineShopModal?.addEventListener('click', (e) => { if (e.target === lineShopModal)
        lineShopModal.classList.add('is-hidden'); });
    const newsModal = document.getElementById('newsModal');
    document.getElementById('newsModalClose')?.addEventListener('click', () => newsModal?.classList.add('is-hidden'));
    newsModal?.addEventListener('click', (e) => { if (e.target === newsModal)
        newsModal.classList.add('is-hidden'); });
    const reportModal = document.getElementById('reportModal');
    document.getElementById('reportModalClose')?.addEventListener('click', () => reportModal?.classList.add('is-hidden'));
    reportModal?.addEventListener('click', (e) => { if (e.target === reportModal)
        reportModal.classList.add('is-hidden'); });
    document.getElementById('reportCopyBtn')?.addEventListener('click', async () => {
        if (!_reportCardText)
            return;
        await navigator.clipboard.writeText(_reportCardText);
        showToast('Report copied to clipboard');
    });
    document.getElementById('reportDownloadBtn')?.addEventListener('click', () => {
        if (!_reportCardText)
            return;
        const blob = new Blob([_reportCardText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ufc-report-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Report downloaded');
    });
    document.getElementById('densityToggleBtn')?.addEventListener('click', () => {
        currentDensity = currentDensity === 'compact' ? 'detailed' : 'compact';
        applyDensityMode();
    });
    document.getElementById('historyDensityToggleBtn')?.addEventListener('click', () => {
        currentHistoryDensity = currentHistoryDensity === 'compact' ? 'readable' : 'compact';
        applyHistoryDensityMode();
    });
    applyDensityMode();
    applyHistoryDensityMode();
    // Display-density gear popover
    const densityTrigger = document.getElementById('densityTrigger');
    const densityPopover = document.getElementById('densityPopover');
    if (densityTrigger && densityPopover) {
        const closeDensityPopover = () => {
            densityPopover.hidden = true;
            densityTrigger.setAttribute('aria-expanded', 'false');
        };
        densityTrigger.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const willOpen = densityPopover.hidden;
            densityPopover.hidden = !willOpen;
            densityTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
        document.addEventListener('click', (ev) => {
            if (densityPopover.hidden)
                return;
            const target = ev.target;
            if (target && !densityPopover.contains(target) && target !== densityTrigger && !densityTrigger.contains(target)) {
                closeDensityPopover();
            }
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !densityPopover.hidden)
                closeDensityPopover();
        });
    }
    // Line drop / empty-state buttons
    document.getElementById('emptyStateAutoFetchBtn')?.addEventListener('click', triggerAutoScrape);
    // Empty state predict button is wired inline in processData() where it's created
    // Watcher and event banner removed by request; ensure any prior background watcher is stopped.
    void runtimeSendMessage({ type: 'STOP_LINE_WATCHER' });
    // View tabs
    bindExclusiveButtons('.tab-btn[data-view]', (btn) => {
        currentView = btn.dataset['view'] || 'all';
        // Archive and best picks work without lines — ensure container is visible
        if (currentView === 'archive' || currentView === 'bestpicks' || currentView === 'parlaylab' || currentView === 'calibration') {
            const empty = document.getElementById('emptyState');
            const container = document.getElementById('cardContainer');
            if (empty)
                empty.style.display = 'none';
            if (container)
                container.style.display = 'block';
        }
        renderFighters();
        syncDataTabsTrigger();
    });
    bindDataTabsTrigger();
    syncDataTabsTrigger();
    // Reset baselines: re-anchor all baselines to current values so deltas become 0.
    // Future real movement will show correctly from this point forward.
    document.getElementById('resetBaselinesBtn')?.addEventListener('click', async () => {
        console.log('[UFC Analyzer] RESET LINES clicked — clearing all baselines and re-anchoring');
        const resetBtn = document.getElementById('resetBaselinesBtn');
        const resetLabel = resetBtn?.querySelector('.overflow-item-label');
        if (resetBtn && resetLabel) {
            resetLabel.textContent = 'DONE!';
            resetBtn.classList.add('overflow-item-success');
            setTimeout(() => {
                resetLabel.textContent = 'RESET LINES';
                resetBtn.classList.remove('overflow-item-success');
            }, 2000);
        }
        // Betr-clear rule: the Betr seed itself carries its event date (written by
        // initializeBetrLines in background.ts via BETR_EVENT_DATE). Read that directly
        // so the rule doesn't depend on upcomingEventTs, which can drift if the analyzer
        // auto-advances to the next card.
        //   • betr_event_date is future → we're in fight week → preserve Betr (user's
        //     manual modal entries must survive a baseline re-anchor).
        //   • betr_event_date is past → the seed is stale → wipe storage + in-memory.
        //   • betr_event_date missing → nothing to protect → wipe.
        let eventOver = true;
        try {
            const betrMeta = await new Promise(res => chrome.storage.local.get(['betr_event_date'], res));
            const raw = typeof betrMeta['betr_event_date'] === 'string' ? betrMeta['betr_event_date'] : '';
            _currentBetrEventDate = raw;
            if (raw) {
                const seedEventMs = new Date(`${raw}T23:59:59`).getTime();
                if (Number.isFinite(seedEventMs) && Date.now() <= seedEventMs)
                    eventOver = false;
            }
        }
        catch { }
        if (eventOver) {
            await new Promise((res) => chrome.storage.local.remove(['lines_betr', 'lines_betr_manual_v1'], () => res()));
            // Purge Betr values from in-memory fighters too — storage wipe alone leaves stale values on the render path.
            for (const f of allFighters) {
                f.line_betr = null;
                f.line_betr_ss = null;
                f.line_betr_td = null;
                f.line_betr_ft = null;
            }
            console.log('[UFC Analyzer] RESET LINES: event over — Betr lines cleared (storage + in-memory)');
        }
        _openingLines.clear();
        _prevRefreshLines.clear();
        // Re-anchor baselines to current live values
        const _psCombos = [
            ['p6', 'fp', f => f.line_p6], ['p6', 'ss', f => f.line_p6_ss], ['p6', 'td', f => f.line_p6_td], ['p6', 'ft', f => f.line_p6_ft],
            ['ud', 'fp', f => f.line_ud], ['ud', 'ss', f => f.line_ud_ss], ['ud', 'td', f => f.line_ud_td], ['ud', 'ft', f => f.line_ud_ft],
            ['pp', 'fp', f => f.line_pp], ['pp', 'ss', f => f.line_pp_ss], ['pp', 'td', f => f.line_pp_td], ['pp', 'ft', f => f.line_pp_ft],
            ['betr', 'fp', f => f.line_betr], ['betr', 'ss', f => f.line_betr_ss], ['betr', 'td', f => f.line_betr_td], ['betr', 'ft', f => f.line_betr_ft],
            ['dk', 'ss', f => f.line_dk_ss], ['dk', 'td', f => f.line_dk_td], ['dk', 'ft', f => f.line_dk_ft],
        ];
        for (const fighter of allFighters) {
            for (const [plat, stat, getVal] of _psCombos) {
                const val = getVal(fighter);
                if (val == null || !isPlausibleBaseline(stat, val))
                    continue;
                const key = openingLineKey(plat, stat, fighter.name);
                _openingLines.set(key, val);
                _prevRefreshLines.set(key, val);
            }
        }
        // Persist with fresh timestamp
        _baselineCapturedAt = Date.now();
        void storageSet({ lines_open_v1: buildOpeningLinesRecord() });
        const _oc = document.getElementById('openingLinesCount');
        if (_oc)
            _oc.textContent = ` · 📍re-anchored ${_openingLines.size} baselines`;
        showToast(eventOver
            ? `Baselines re-anchored + Betr lines cleared (event over)`
            : `Baselines re-anchored — Betr lines preserved (event live)`);
        renderFighters();
        renderLineMovementSummary();
    });
    // Debug panel toggle
    document.getElementById('debugToggleBtn')?.addEventListener('click', () => {
        const wrap = document.getElementById('debugPanelWrap');
        if (!wrap)
            return;
        const visible = !wrap.classList.contains('debug-panel-hidden');
        wrap.classList.toggle('debug-panel-hidden', visible);
        const icon = document.querySelector('#debugToggleBtn .debug-icon');
        if (icon)
            icon.textContent = visible ? '⚡' : '✕';
    });
    // Card row expand/collapse
    document.getElementById('cardContainer')?.addEventListener('click', (e) => {
        const newsBadgeBtn = e.target.closest('.news-warn-badge');
        if (newsBadgeBtn) {
            e.stopPropagation();
            const fighterName = newsBadgeBtn.dataset['newsFighter'] || '';
            const cached = _newsCache.get(fighterName.toLowerCase());
            if (!cached?.items.length) {
                showToast('No cached news — reload to refresh');
                return;
            }
            const alertItems = cached.items.filter(item => NEWS_INJURY_KEYWORDS.some(kw => item.title.toLowerCase().includes(kw)));
            const otherItems = cached.items.filter(item => !alertItems.includes(item));
            const titleEl = document.getElementById('newsModalTitle');
            const subEl = document.getElementById('newsModalSub');
            const contentEl = document.getElementById('newsModalContent');
            const nm = document.getElementById('newsModal');
            if (!nm || !contentEl)
                return;
            if (titleEl)
                titleEl.textContent = `⚠ ${fighterName.toUpperCase()} — NEWS`;
            if (subEl)
                subEl.textContent = `${alertItems.length} alert headline${alertItems.length !== 1 ? 's' : ''} · ${cached.items.length} total in last 7 days`;
            const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const safeHref = (url) => (url && /^https?:\/\//i.test(url) ? esc(url) : '#');
            const renderItem = (item, isAlert) => `<div class="news-item${isAlert ? ' news-item-alert' : ''}">
          <div class="news-item-title"><a href="${safeHref(item.link)}" target="_blank" rel="noopener">${esc(item.title || '(no title)')}</a></div>
          <div class="news-item-meta">${item.pubDate ? esc(new Date(item.pubDate).toLocaleDateString()) : ''}${item.source ? ` · ${esc(item.source)}` : ''}</div>
        </div>`;
            contentEl.innerHTML = [
                ...alertItems.map(item => renderItem(item, true)),
                ...otherItems.map(item => renderItem(item, false)),
            ].join('') || '<div style="color:var(--text3);font-size:12px">No headlines found.</div>';
            nm.classList.remove('is-hidden');
            return;
        }
        // Avatar click = head-to-head. The old ⚔ button was a 20px target whose
        // misses fell through to the row-expand handler ("pulls down fight history
        // instead"). The avatar is big, always visible, and unambiguous.
        const avatarHit = e.target.closest('.fighter-avatar-wrap');
        if (avatarHit) {
            const rowEl = avatarHit.closest('.fighter-row');
            const nm = rowEl?.dataset['name'] || '';
            if (nm) {
                e.stopPropagation();
                openH2HByName(nm);
                return;
            }
        }
        const h2hBtn = e.target.closest('.h2h-btn');
        if (h2hBtn) {
            e.stopPropagation();
            openH2HByName(h2hBtn.dataset['fighter'] || '');
            return;
        }
        const main = e.target.closest('.fighter-main');
        if (main)
            toggleRow(main.closest('.fighter-row'));
    });
    // H2H modal close
    const h2hModal = document.getElementById('h2hModal');
    document.getElementById('h2hModalClose')?.addEventListener('click', () => h2hModal?.classList.add('is-hidden'));
    h2hModal?.addEventListener('click', (e) => { if (e.target === h2hModal)
        h2hModal.classList.add('is-hidden'); });
    // Search
    document.getElementById('fighterSearch')?.addEventListener('input', (e) => {
        currentSearch = e.target.value || '';
        renderFighters();
    });
    // Sort
    bindExclusiveButtons('.sort-btn[data-sort]', (btn) => {
        currentSort = btn.dataset['sort'] || 'default';
        updateSortTrendTriggerLabel();
        renderFighters();
    });
    // Sort & Trend popover
    const sortTrendTrigger = document.getElementById('sortTrendTrigger');
    const sortTrendPopover = document.getElementById('sortTrendPopover');
    if (sortTrendTrigger && sortTrendPopover) {
        const closePopover = () => {
            sortTrendPopover.hidden = true;
            sortTrendTrigger.setAttribute('aria-expanded', 'false');
        };
        sortTrendTrigger.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const willOpen = sortTrendPopover.hidden;
            sortTrendPopover.hidden = !willOpen;
            sortTrendTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
        document.addEventListener('click', (ev) => {
            if (sortTrendPopover.hidden)
                return;
            const target = ev.target;
            if (target && !sortTrendPopover.contains(target) && target !== sortTrendTrigger && !sortTrendTrigger.contains(target)) {
                closePopover();
            }
        });
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape' && !sortTrendPopover.hidden)
                closePopover();
        });
        sortTrendPopover.addEventListener('click', (ev) => {
            const target = ev.target;
            if (target?.closest('.sort-btn, .trend-btn'))
                closePopover();
        });
    }
    updateSortTrendTriggerLabel();
    // ── Quick-jump command palette (press K) ──────────────────────────────────
    const cmdPalette = document.getElementById('cmdPalette');
    const cmdInput = document.getElementById('cmdPaletteInput');
    const cmdResults = document.getElementById('cmdPaletteResults');
    let cmdSel = 0;
    const closePalette = () => { cmdPalette?.classList.add('is-hidden'); };
    const renderPalette = (q) => {
        if (!cmdResults)
            return;
        const ql = q.trim().toLowerCase();
        const items = allFighters
            .filter(f => !ql || f.name.toLowerCase().includes(ql) || (f.opponent || '').toLowerCase().includes(ql))
            .slice(0, 12);
        cmdSel = Math.min(cmdSel, Math.max(0, items.length - 1));
        cmdResults.innerHTML = items.length ? items.map((f, i) => `
      <div class="cmd-item ${i === cmdSel ? 'sel' : ''}" data-name="${f.name}">
        <span class="bp-avatar bp-avatar-sm"><span class="bp-avatar-flag">${f.db?.country || '🥊'}</span><img class="bp-avatar-img" data-name="${f.name}" alt="" /></span>
        <span class="cmd-item-name">${prettyName(f.name)}</span>
        <span class="cmd-item-meta">${f.db?.record || ''} · vs ${prettyName(f.opponent || '—')}</span>
      </div>`).join('') : '<div class="cmd-item-empty">No fighters match</div>';
        hydrateAvatarImgs(cmdResults);
        cmdResults.querySelectorAll('.cmd-item').forEach(el => {
            el.addEventListener('click', () => { closePalette(); jumpToFighterCard(el.dataset['name'] || ''); });
        });
    };
    const openPalette = () => {
        if (!cmdPalette || !cmdInput)
            return;
        cmdSel = 0;
        cmdInput.value = '';
        renderPalette('');
        cmdPalette.classList.remove('is-hidden');
        cmdInput.focus();
    };
    const movePaletteSel = (d) => {
        const items = Array.from(cmdResults?.querySelectorAll('.cmd-item') || []);
        if (!items.length)
            return;
        cmdSel = (cmdSel + d + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('sel', i === cmdSel));
        items[cmdSel].scrollIntoView({ block: 'nearest' });
    };
    cmdInput?.addEventListener('input', () => { cmdSel = 0; renderPalette(cmdInput.value); });
    cmdInput?.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            movePaletteSel(1);
        }
        else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            movePaletteSel(-1);
        }
        else if (ev.key === 'Enter') {
            const sel = cmdResults?.querySelectorAll('.cmd-item')[cmdSel];
            if (sel?.dataset['name']) {
                closePalette();
                jumpToFighterCard(sel.dataset['name']);
            }
        }
        else if (ev.key === 'Escape') {
            closePalette();
        }
    });
    cmdPalette?.addEventListener('click', (e) => { if (e.target === cmdPalette)
        closePalette(); });
    // ── Keyboard shortcuts: "/" search, 1-5 views, "?" help overlay ───────────
    const kbdHelp = document.getElementById('kbdHelp');
    kbdHelp?.addEventListener('click', (e) => { if (e.target === kbdHelp)
        kbdHelp.classList.add('is-hidden'); });
    document.addEventListener('keydown', (ev) => {
        const t = ev.target;
        const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (ev.key === 'Escape') {
            kbdHelp?.classList.add('is-hidden');
            cmdPalette?.classList.add('is-hidden');
            return;
        }
        if (typing || ev.ctrlKey || ev.metaKey || ev.altKey)
            return;
        if (ev.key === '/') {
            ev.preventDefault();
            document.getElementById('fighterSearch')?.focus();
            return;
        }
        if (ev.key === '?') {
            ev.preventDefault();
            kbdHelp?.classList.toggle('is-hidden');
            return;
        }
        if (ev.key === 'k' || ev.key === 'K') {
            ev.preventDefault();
            openPalette();
            return;
        }
        const viewByKey = { '1': 'all', '2': 'over', '3': 'under', '4': 'bestpicks', '5': 'parlaylab' };
        const view = viewByKey[ev.key];
        if (view) {
            document.querySelector(`.tab-btn[data-view="${view}"]`)?.click();
        }
    });
    // Back-to-top floating button
    const backToTop = document.getElementById('backToTop');
    if (backToTop) {
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 600);
        }, { passive: true });
        backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    // ── GLOW-UP 19: floating tooltip for drilldown history bars ──────────────
    const histTip = document.createElement('div');
    histTip.id = 'histTip';
    histTip.setAttribute('hidden', '');
    document.body.appendChild(histTip);
    let histTipRow = null;
    const escHt = (x) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    document.addEventListener('mousemove', (ev) => {
        const row = ev.target?.closest?.('.history-bar-row.has-tip');
        if (!row) {
            if (histTipRow) {
                histTipRow = null;
                histTip.setAttribute('hidden', '');
            }
            return;
        }
        if (row !== histTipRow) {
            histTipRow = row;
            const d = row.dataset;
            const resCls = d['htRes'] === 'w' ? 'w' : d['htRes'] === 'l' ? 'l' : '';
            const overCls = d['htOver'] === '1' ? 'over' : 'under';
            histTip.innerHTML =
                `<div class="ht-head">vs ${escHt(d['htOpp'] || '?')}</div>` +
                    (d['htRestext'] ? `<div class="ht-res ${resCls}">${escHt(d['htRestext'])}</div>` : '') +
                    (d['htDate'] ? `<div class="ht-date">${escHt(d['htDate'])}</div>` : '') +
                    `<div class="ht-val ${overCls}">${escHt(d['htVal'] || '')}` +
                    (d['htLine'] ? ` <span class="ht-line">vs line ${escHt(d['htLine'])}</span>` : '') +
                    (d['htDelta'] ? ` <span class="ht-delta">${escHt(d['htDelta'])}</span>` : '') +
                    `</div>`;
            histTip.removeAttribute('hidden');
        }
        const pad = 13;
        const r = histTip.getBoundingClientRect();
        let x = ev.clientX + pad;
        let y = ev.clientY + pad;
        if (x + r.width > window.innerWidth - 8)
            x = ev.clientX - r.width - pad;
        if (y + r.height > window.innerHeight - 8)
            y = ev.clientY - r.height - pad;
        histTip.style.left = `${x}px`;
        histTip.style.top = `${y}px`;
    }, { passive: true });
    // One-time keyboard hint
    try {
        if (!localStorage.getItem('kbd_hint_v1')) {
            localStorage.setItem('kbd_hint_v1', '1');
            setTimeout(() => showToast('Tip: press ? for keyboard shortcuts — / to search, 1–5 to switch views'), 2500);
        }
    }
    catch { /* storage unavailable */ }
    // Initial data load
    requestDataReload();
    startPeriodicDataReload(60000);
    void runArchiveBackfillPass();
    // Fighter modal
    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('fighterModal')?.classList.remove('open');
    });
    document.getElementById('fighterModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('fighterModal'))
            document.getElementById('fighterModal')?.classList.remove('open');
    });
    bindExclusiveButtons('.modal-tab', (tab) => {
        document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(tab.dataset['panel'] || '')?.classList.add('active');
    });
}
initAnalyzerCore();
function getDebugPanelEl() {
    return document.getElementById('debugPanel');
}
function setDebugPanelText(text) {
    const panel = getDebugPanelEl();
    if (!panel)
        return null;
    panel.textContent = text;
    return panel;
}
function appendDebugPanelText(panel, text) {
    panel.textContent += text;
}
function scrollDebugPanelToBottom(panel) {
    panel.scrollTop = panel.scrollHeight;
}
document.getElementById('dbgTestBtn')?.addEventListener('click', async () => {
    const panel = setDebugPanelText('Reading stored card debug + live lines data...\n');
    if (!panel)
        return;
    const all = await storageGet([]);
    for (const platform of ['pick6', 'underdog']) {
        const key = `lines_${platform}`;
        const lineData = all[key];
        if (!lineData) {
            appendDebugPanelText(panel, `${platform}: no lines captured\n`);
            continue;
        }
        appendDebugPanelText(panel, `\n=== ${platform} captured fighters (${lineData.fighters?.length}) ===\n`);
        (lineData.fighters || []).slice(0, 5).forEach((f) => {
            appendDebugPanelText(panel, `  ${f.name}: fp=${f.line_fp ?? f.line} ss=${f.line_ss} td=${f.line_td} ft=${f.line_ft}\n`);
        });
    }
    for (const platform of STORAGE_LINE_DEBUG_KEYS) {
        const key = `debug_card_${platform}`;
        const debugEntry = all[key];
        if (!debugEntry) {
            appendDebugPanelText(panel, `\n${platform}: no card debug — visit the page\n`);
            continue;
        }
        appendDebugPanelText(panel, `\n=== ${platform} card text samples ===\n`);
        (debugEntry.samples || []).forEach((s, i) => { appendDebugPanelText(panel, `[${i}] ${s.text?.slice(0, 800)}\n`); });
    }
    scrollDebugPanelToBottom(panel);
});
document.getElementById('dbgDumpBtn')?.addEventListener('click', async () => {
    const panel = setDebugPanelText('Trying UFC Stats URLs with browser headers...\n');
    if (!panel)
        return;
    const headers = { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5', 'Cache-Control': 'no-cache' };
    const urls = ['http://www.ufcstats.com/fighter-details/0bc62e3c498b5011', 'http://ufcstats.com/fighter-details/0bc62e3c498b5011'];
    for (const url of urls) {
        try {
            appendDebugPanelText(panel, `GET ${url}\n`);
            const res = await fetch(url, { headers, redirect: 'follow', mode: 'cors' });
            const text = await res.text();
            appendDebugPanelText(panel, `Status: ${res.status} | Bytes: ${text.length} | Final URL: ${res.url}\n`);
            appendDebugPanelText(panel, `First 300 chars:\n${JSON.stringify(text.slice(0, 300))}\n\n`);
            if (text.length < 1000)
                continue;
            const trCount = (text.match(/<tr/gi) || []).length;
            appendDebugPanelText(panel, `<tr> tags: ${trCount}\n`);
            ['b-fight-details__table-body', 'fighter-details', 'b-fight-details'].forEach(m => { appendDebugPanelText(panel, `  "${m}": ${text.includes(m)}\n`); });
            const rows = [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
            const dataRow = rows.find(r => r[1].includes('fighter-details') && r[1].includes('<td'));
            if (!dataRow) {
                appendDebugPanelText(panel, 'No data row with fighter-details link found\n');
                continue;
            }
            const tds = [...dataRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
            appendDebugPanelText(panel, `\nDATA ROW — ${tds.length} tds:\n`);
            tds.forEach((td, i) => {
                const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
                if (ps.length > 0) {
                    appendDebugPanelText(panel, `  td[${i}]: "${ps[0]?.slice(0, 45)}" | "${(ps[1] || '').slice(0, 45)}"\n`);
                }
                else {
                    appendDebugPanelText(panel, `  td[${i}]: "${td[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)}"\n`);
                }
            });
            appendDebugPanelText(panel, `\nRAW (first 1000 chars):\n${dataRow[1].slice(0, 1000)}`);
            scrollDebugPanelToBottom(panel);
            return;
        }
        catch (e) {
            appendDebugPanelText(panel, `EXCEPTION: ${e.name}: ${e.message}\n\n`);
        }
    }
    appendDebugPanelText(panel, '\nAll URLs failed — UFC Stats may be blocking cross-origin requests.\n');
});
document.getElementById('dbgCopyBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('debugPanel');
    if (!panel)
        return;
    navigator.clipboard.writeText(panel.textContent || '').then(() => {
        const btn = document.getElementById('dbgCopyBtn');
        if (btn) {
            btn.textContent = '✓ COPIED';
            setTimeout(() => { btn.textContent = 'COPY LOG'; }, 2000);
        }
    });
});
document.getElementById('dbgClearBtn')?.addEventListener('click', async () => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        const all = await storageGet([]);
        const keys = Object.keys(all).filter(k => k.startsWith('ufcstats_'));
        keys.push('upcoming_ufc_card');
        await storageRemove(keys);
        const panel = document.getElementById('debugPanel');
        if (panel)
            panel.textContent = `Cleared ${keys.length} cached entries. Reloading...`;
        setTimeout(() => location.reload(), 800);
    }
});
document.getElementById('dbgBgDumpBtn')?.addEventListener('click', async () => {
    const panel = setDebugPanelText('Reading Max Holloway from cache (must be loaded in analyzer first)...\n');
    if (!panel)
        return;
    const resp = await runtimeSendMessage({ type: 'GET_CACHED_HTML', name: 'Max Holloway' });
    if (!resp || resp.error) {
        appendDebugPanelText(panel, `${resp?.error}\n`);
        appendDebugPanelText(panel, 'Scroll to Max Holloway in the analyzer to trigger a fetch, then try again.\n');
        return;
    }
    appendDebugPanelText(panel, `Cache hit! HTML: ${resp.html?.length} chars | URL: ${resp.detailUrl}\n`);
    appendDebugPanelText(panel, `\nParsed fights (${resp.fightHistory?.length}):\n`);
    (resp.fightHistory || []).forEach((f, i) => {
        appendDebugPanelText(panel, `  [${i}] ${f.opponent} kd=${f.kd} sig=${f.sigStr} tot=${f.totStr} td=${f.td} ctrl=${f.ctrlSecs}s rnd=${f.round} method=${f.method}\n`);
    });
    appendDebugPanelText(panel, '\n--- RAW TD STRUCTURE ---\n');
    const rows = [...(resp.html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const dataRows = rows.filter((r) => !r[1].includes('<th') && (r[1].match(/<td/gi) || []).length > 5);
    appendDebugPanelText(panel, `Total rows: ${rows.length}, data rows: ${dataRows.length}\n`);
    if (dataRows.length > 0) {
        const row = dataRows[0][1];
        const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        tds.forEach((td, i) => {
            const ps = [...td[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
            if (ps.length > 0) {
                appendDebugPanelText(panel, `td[${i}]: "${ps[0]?.slice(0, 45)}" | "${(ps[1] || '').slice(0, 45)}"\n`);
            }
        });
    }
    scrollDebugPanelToBottom(panel);
});
document.getElementById('dbgHideBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('debugPanelWrap');
    if (wrap)
        wrap.classList.add('debug-panel-hidden');
    const icon = document.querySelector('#debugToggleBtn .debug-icon');
    if (icon)
        icon.textContent = '⚡';
});
// ── BETR SCREENSHOT READER ────────────────────────────────────────────────
(function () {
    const modal = document.getElementById('manualModal');
    const openBtn = document.getElementById('manualEntryBtn');
    const closeBtn = document.getElementById('manualModalClose');
    const dropZone = document.getElementById('betrDropZone');
    const fileInput = document.getElementById('betrFileInput');
    const imageQueue = document.getElementById('betrImageQueue');
    const analyzeBtn = document.getElementById('betrAnalyzeBtn');
    const analyzeStatus = document.getElementById('betrAnalyzeStatus');
    const extracted = document.getElementById('betrExtracted');
    const extractedRows = document.getElementById('betrExtractedRows');
    const saveBtn = document.getElementById('betrSaveBtn');
    const addRowBtn = document.getElementById('betrAddRow');
    const saveStatus = document.getElementById('betrSaveStatus');
    let queuedImages = [];
    closeBtn?.addEventListener('click', () => { if (modal)
        modal.classList.add('is-hidden'); });
    modal?.addEventListener('click', (e) => { if (e.target === modal && modal)
        modal.classList.add('is-hidden'); });
    function setDropZoneHighlight(active) {
        if (!dropZone)
            return;
        if (active) {
            dropZone.style.borderColor = 'var(--orange)';
            dropZone.style.background = 'rgba(255,122,43,0.08)';
            return;
        }
        dropZone.style.borderColor = 'rgba(255,122,43,0.4)';
        dropZone.style.background = 'rgba(255,122,43,0.04)';
    }
    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); setDropZoneHighlight(true); });
    dropZone?.addEventListener('dragleave', () => { setDropZoneHighlight(false); });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        setDropZoneHighlight(false);
        if (e.dataTransfer)
            addFiles(Array.from(e.dataTransfer.files));
    });
    fileInput?.addEventListener('change', () => { if (fileInput.files)
        addFiles(Array.from(fileInput.files)); });
    function addFiles(files) {
        files.filter(f => f.type.startsWith('image/')).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result;
                queuedImages.push({ dataUrl, name: file.name });
                renderQueue();
            };
            reader.readAsDataURL(file);
        });
    }
    function renderQueue() {
        if (!imageQueue)
            return;
        imageQueue.innerHTML = '';
        queuedImages.forEach((img, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'betr-queue-item';
            wrap.innerHTML = `<img src="${img.dataUrl}" class="betr-queue-img"><button data-i="${i}" class="betr-queue-remove">✕</button><div class="betr-queue-name">${img.name}</div>`;
            wrap.querySelector('button').addEventListener('click', () => { queuedImages.splice(i, 1); renderQueue(); });
            imageQueue.appendChild(wrap);
        });
        if (analyzeBtn) {
            setButtonBusyState(analyzeBtn, queuedImages.length === 0, {
                busyOpacity: '0.4',
                idleOpacity: '1',
            });
        }
    }
    analyzeBtn?.addEventListener('click', async () => {
        if (!queuedImages.length)
            return;
        const apiKeyInput = document.getElementById('betrApiKey');
        const apiKey = apiKeyInput?.value?.trim();
        if (!apiKey) {
            if (analyzeStatus)
                analyzeStatus.textContent = '✗ Enter your Anthropic API key first';
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage)
            await storageSet({ betr_api_key: apiKey });
        setButtonBusyState(analyzeBtn, true, { busyText: '⟳ Reading...' });
        if (analyzeStatus)
            analyzeStatus.textContent = `Sending ${queuedImages.length} image(s) to AI...`;
        if (extracted)
            extracted.classList.add('is-hidden');
        try {
            const imageContent = queuedImages.map(img => ({
                type: 'image',
                source: { type: 'base64', media_type: img.dataUrl.split(';')[0].split(':')[1], data: img.dataUrl.split(',')[1] }
            }));
            const payload = {
                model: 'claude-sonnet-4-20250514', max_tokens: 1000,
                messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: `These are screenshots from the Betr fantasy sports app showing UFC fighter prop lines. Extract every fighter's lines.\nReturn ONLY a JSON array: [{"name":"First Last","fp":number_or_null,"ss":number_or_null}]` }] }]
            };
            const resp = await runtimeSendMessage({ type: 'CLAUDE_API', payload, apiKey });
            if (!resp)
                throw new Error('No response from analyzer runtime');
            if (resp?.error)
                throw new Error(resp.error);
            const data = resp.data;
            const text = data?.content?.map((c) => c.text || '').join('') || '';
            let fighters = [];
            try {
                fighters = JSON.parse(text.replace(/```json|```/g, '').trim());
            }
            catch (e) {
                throw new Error('Could not parse AI response: ' + text?.slice(0, 200));
            }
            if (analyzeStatus)
                analyzeStatus.textContent = `✓ Found ${fighters.length} fighter(s)`;
            renderExtractedRows(fighters);
            if (extracted)
                extracted.classList.remove('is-hidden');
        }
        catch (err) {
            if (analyzeStatus)
                analyzeStatus.textContent = '✗ Error: ' + err.message;
        }
        finally {
            setButtonBusyState(analyzeBtn, false, { idleText: '🔍 READ WITH AI' });
        }
    });
    function renderExtractedRows(fighters) { if (extractedRows) {
        extractedRows.innerHTML = '';
        fighters.forEach(f => addExtractedRow(f));
    } }
    function addExtractedRow(f = {}) {
        if (!extractedRows)
            return;
        const row = document.createElement('div');
        row.className = 'betr-row';
        row.innerHTML = `<input type="text" class="betr-name betr-input name" value="${f.name || ''}" placeholder="Fighter name"><input type="number" class="betr-fp betr-input fp" value="${f.fp ?? ''}" placeholder="—" step="0.5"><input type="number" class="betr-ss betr-input ss" value="${f.ss ?? ''}" placeholder="—" step="0.5"><button class="betr-remove-btn">✕</button>`;
        row.querySelector('button').addEventListener('click', () => row.remove());
        extractedRows.appendChild(row);
    }
    addRowBtn?.addEventListener('click', () => addExtractedRow());
    openBtn?.addEventListener('click', async () => {
        if (modal)
            modal.classList.remove('is-hidden');
        // Pre-populate rows from currently stored BETR lines AND update event title
        if (extractedRows) {
            try {
                await syncUpcomingCardContext(true);
                const stored = await storageGet(['lines_betr', 'lines_betr_manual_v1']);
                // Do not fall back to UFCStats event text here; that feed can lag and show the wrong card.
                const eventName = (inferredEventNameFromLines || '').trim();
                const reviewTitle = modal?.querySelector('.betr-review-title');
                if (reviewTitle) {
                    reviewTitle.textContent = eventName
                        ? `${eventName} Lines \u2014 Review & Edit Before Saving`
                        : 'Upcoming UFC Lines \u2014 Review & Edit Before Saving';
                }
                // Always refresh rows on modal open so stale event rows cannot linger between cards.
                extractedRows.innerHTML = '';
                const baseExisting = stored['lines_betr']?.fighters || [];
                const manualOverrides = stored['lines_betr_manual_v1']?.fighters;
                // Apply manual overrides so user-adjusted values survive a clear+re-seed cycle.
                const existing = manualOverrides?.length
                    ? applyBetrManualOverrides(baseExisting, manualOverrides)
                    : baseExisting;
                // Bypass card filter when upcoming event is >10 days away (avoids filtering against the wrong card)
                const tooFarAway = Number.isFinite(upcomingEventTs) && upcomingEventTs - Date.now() > 10 * 24 * 60 * 60 * 1000;
                const filteredExisting = (!tooFarAway && upcomingCardPairs.length)
                    ? existing.filter((f) => isUpcomingCardFighter(f.name) || isUpcomingCardFighter(f.opponent || ''))
                    : existing;
                if (filteredExisting.length > 0) {
                    renderExtractedRows(filteredExisting.map(f => ({ name: f.name || '', fp: f.line_fp ?? null, ss: f.line_ss ?? null })));
                }
                // No stored lines — modal opens empty, ready for new screenshots
            }
            catch { /* no stored lines is fine */ }
        }
    });
    saveBtn?.addEventListener('click', async () => {
        if (!extractedRows)
            return;
        const rows = extractedRows.querySelectorAll('div');
        const fighters = [];
        rows.forEach(row => {
            const name = row.querySelector('.betr-name')?.value?.trim();
            if (!name)
                return;
            const fp = parseFloat(row.querySelector('.betr-fp')?.value) || null;
            const ss = parseFloat(row.querySelector('.betr-ss')?.value) || null;
            if (fp || ss)
                fighters.push({ name, line_fp: fp, line_ss: ss, line_td: null });
        });
        if (!fighters.length) {
            // No valid lines — explicitly clear Betr manual storage
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.remove('lines_betr_manual_v1', () => {
                    if (saveStatus)
                        saveStatus.textContent = '✓ Betr lines cleared';
                    setTimeout(() => { if (saveStatus)
                        saveStatus.textContent = ''; }, 2000);
                });
            }
            return;
        }
        const capturedAt = Date.now();
        const data = { fighters, capturedAt };
        if (typeof chrome !== 'undefined' && chrome.storage) {
            // Detect line movements before saving — compare against opening lines
            const movements = [];
            for (const fighter of fighters) {
                const fname = String(fighter.name || '').trim();
                if (!fname)
                    continue;
                const checks = [
                    ['fp', fighter.line_fp ?? null],
                    ['ss', fighter.line_ss ?? null],
                    ['td', fighter.line_td ?? null],
                ];
                for (const [stat, val] of checks) {
                    if (val == null)
                        continue;
                    const key = openingLineKey('betr', stat, fname);
                    const openVal = _openingLines.get(key);
                    if (openVal != null && Math.abs(val - openVal) >= 0.5) {
                        const delta = parseFloat((val - openVal).toFixed(1));
                        movements.push(`${fname} ${stat.toUpperCase()} ${delta > 0 ? '▲+' : '▼'}${delta} (was ${openVal})`);
                    }
                }
            }
            await storageSet({ lines_betr: data, [STORAGE_BETR_MANUAL_KEY]: data });
            if (movements.length) {
                const msg = `✓ Saved — Line moves: ${movements.join(' · ')}`;
                if (saveStatus)
                    saveStatus.textContent = msg;
            }
            else {
                if (saveStatus)
                    saveStatus.textContent = `✓ Saved ${fighters.length} Betr lines`;
            }
            const countBetr = document.getElementById('countBetr');
            if (countBetr)
                countBetr.textContent = fighters.length + ' fighters';
            document.getElementById('pillBetr')?.classList.add('active');
            setTimeout(() => { if (modal)
                modal.classList.add('is-hidden'); }, 800);
            const result = await storageGet([...STORAGE_BETR_LINE_KEYS]);
            const p6 = result['lines_pick6']?.fighters || [];
            const ud = result['lines_underdog']?.fighters || [];
            const bt = result['lines_betr']?.fighters || [];
            await mergeAndEnrich(p6, ud, bt);
            detectAndRecordMovements();
            snapshotOpeningLines();
            snapshotLineHistory();
            renderFighters();
            renderLineMovementSummary();
        }
    });
})();
// ── ADVANCED UI ENHANCEMENTS ──────────────────────────────────────────────
// Mouse tracking for interactive backgrounds
let mouseX = 50;
let mouseY = 50;
let dynamicEffectsInitialized = false;
let performanceMonitorStarted = false;
document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 100;
    mouseY = (e.clientY / window.innerHeight) * 100;
    document.documentElement.style.setProperty('--mouse-x', `${mouseX}%`);
    document.documentElement.style.setProperty('--mouse-y', `${mouseY}%`);
});
// Dynamic class toggling for enhanced effects
function addDynamicEffects() {
    // Add morphing classes randomly
    setInterval(() => {
        const cards = document.querySelectorAll('.fighter-card');
        cards.forEach(card => {
            if (Math.random() > 0.95) { // 5% chance
                card.classList.add('morphing');
                setTimeout(() => card.classList.remove('morphing'), 6000);
            }
        });
    }, 3000);
    // Add energy field effects to strong leans
    setInterval(() => {
        const strongLeans = document.querySelectorAll('.lean-indicator.strong');
        strongLeans.forEach(lean => {
            if (Math.random() > 0.8) { // 20% chance
                lean.classList.add('energy-field');
                setTimeout(() => lean.classList.remove('energy-field'), 4000);
            }
        });
    }, 5000);
    // Dynamic particle generation
    setInterval(() => {
        if (Math.random() > 0.9) { // 10% chance
            const particle = document.createElement('div');
            particle.className = 'quantum-particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.top = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 4 + 's';
            document.querySelector('.quantum-particles')?.appendChild(particle);
            setTimeout(() => particle.remove(), 8000);
        }
    }, 2000);
}
// Enhanced hover effects with sound-like feedback (visual)
document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target.classList.contains('btn') || target.classList.contains('fighter-card') || target.classList.contains('line-cell')) {
        // Add ripple effect
        const ripple = document.createElement('div');
        ripple.style.position = 'absolute';
        ripple.style.border = '2px solid rgba(0,232,122,0.6)';
        ripple.style.borderRadius = '50%';
        ripple.style.width = '20px';
        ripple.style.height = '20px';
        ripple.style.left = '50%';
        ripple.style.top = '50%';
        ripple.style.transform = 'translate(-50%, -50%)';
        ripple.style.animation = 'ripple 0.6s ease-out';
        ripple.style.pointerEvents = 'none';
        target.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }
});
// Performance monitoring and dynamic adjustments
let frameCount = 0;
let lastTime = performance.now();
function monitorPerformance() {
    if (!performanceMonitorStarted)
        performanceMonitorStarted = true;
    frameCount++;
    const currentTime = performance.now();
    if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        if (fps < 30) {
            // Reduce animations for performance
            document.documentElement.style.setProperty('--animation-duration', '0.1s');
        }
        else {
            document.documentElement.style.setProperty('--animation-duration', '0.3s');
        }
        frameCount = 0;
        lastTime = currentTime;
    }
    requestAnimationFrame(monitorPerformance);
}
// Initialize advanced effects
document.addEventListener('DOMContentLoaded', () => {
    if (!dynamicEffectsInitialized) {
        dynamicEffectsInitialized = true;
        addDynamicEffects();
    }
    if (!performanceMonitorStarted)
        monitorPerformance();
    // Add loading animation to body
    document.body.classList.add('loading');
    setTimeout(() => document.body.classList.remove('loading'), 1000);
    // Enhanced scroll effects
    let scrollTimeout;
    window.addEventListener('scroll', () => {
        document.body.classList.add('scrolling');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            document.body.classList.remove('scrolling');
        }, 150);
    });
});
// Keyboard shortcuts for power users
function handleShortcutRefresh() {
    requestDataReload();
    // Add visual feedback
    document.body.style.animation = 'none';
    setTimeout(() => {
        document.body.style.animation = 'pulse 0.3s ease-in-out';
    }, 10);
}
function handleShortcutDebugToggle() {
    const debugPanel = document.getElementById('debugPanelWrap');
    if (debugPanel) {
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
    }
}
document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+R for rapid refresh
    if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        handleShortcutRefresh();
    }
    // Ctrl+Shift+D for debug mode toggle
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        handleShortcutDebugToggle();
    }
});
// Auto-save user preferences
let preferencesTimeout;
const PREFS_STORAGE_KEY = 'ufc-analyzer-prefs';
function readAnalyzerPreferences() {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (e) {
        console.warn('Failed to parse preferences:', e);
        return null;
    }
}
function savePreferences() {
    clearTimeout(preferencesTimeout);
    preferencesTimeout = setTimeout(() => {
        const prefs = {
            theme: document.documentElement.className,
            lastVisit: Date.now()
        };
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    }, 1000);
}
window.addEventListener('beforeunload', savePreferences);
// Load saved preferences
const savedPrefs = readAnalyzerPreferences();
if (savedPrefs?.theme) {
    document.documentElement.className = savedPrefs.theme;
}
//# sourceMappingURL=analyzer.js.map