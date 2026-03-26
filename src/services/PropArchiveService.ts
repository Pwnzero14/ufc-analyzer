import type { PropArchiveRecord, PropType } from '../types/index.js';

const ARCHIVE_KEY = 'prop_archive_v1';
const BACKFILL_META_KEY = 'prop_archive_backfill_meta_v1';

function normalizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\./g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeEvent(eventName: unknown): string {
  if (typeof eventName !== 'string') return '';
  return eventName.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizePropType(propType: unknown): PropType {
  const v = String(propType || '').trim();
  if (!v) return 'Fantasy';
  if (/^ss$/i.test(v)) return 'SS';
  if (/^td$/i.test(v)) return 'TD';
  if (/^fantasy$/i.test(v)) return 'Fantasy';
  if (/^control$/i.test(v)) return 'Control';
  if (/^fight\s*time$/i.test(v) || /^fighttime$/i.test(v)) return 'FightTime';
  return v as PropType;
}

function isValidIsoLike(value: string): boolean {
  const ts = Date.parse(value);
  return Number.isFinite(ts);
}

function normalizeRecord(record: PropArchiveRecord): PropArchiveRecord | null {
  const fighter = String(record.fighter || '').trim();
  const opponent = String(record.opponent || '').trim();
  const event = String(record.event || '').trim();
  const date = String(record.date || '').trim();
  const propType = normalizePropType(record.propType);

  if (!fighter || !opponent || !event || !date || !isValidIsoLike(date)) return null;
  const result = Number(record.result);
  if (!Number.isFinite(result) && !Number.isNaN(result)) return null;

  const normalized: PropArchiveRecord = {
    fighter,
    opponent,
    event,
    date: new Date(date).toISOString(),
    propType,
    result,
  };

  if (record.platform) normalized.platform = String(record.platform).trim().toLowerCase();
  if (record.line != null) {
    const line = Number(record.line);
    if (Number.isFinite(line)) normalized.line = line;
  }
  return normalized;
}

function recordKey(record: PropArchiveRecord): string {
  const platform = (record.platform || '').toLowerCase();
  const day = record.date.slice(0, 10);
  return [
    normalizeName(record.fighter),
    normalizeEvent(record.event),
    platform,
    String(normalizePropType(record.propType)).toLowerCase(),
    day,
  ].join('|');
}

function dateDay(value: string): string {
  return String(value || '').slice(0, 10);
}

function scoreBackfillCandidate(target: PropArchiveRecord, candidate: PropArchiveRecord): number {
  let score = 0;

  const targetEvent = normalizeEvent(target.event);
  const candEvent = normalizeEvent(candidate.event);
  if (targetEvent && candEvent && targetEvent === candEvent) score += 0;
  else if (targetEvent && candEvent && (targetEvent.includes(candEvent) || candEvent.includes(targetEvent))) score += 2;
  else score += 6;

  const targetOpp = normalizeName(target.opponent);
  const candOpp = normalizeName(candidate.opponent);
  if (targetOpp && candOpp && targetOpp === candOpp) score += 0;
  else if (targetOpp && candOpp && (targetOpp.includes(candOpp) || candOpp.includes(targetOpp))) score += 2;
  else score += 4;

  const t = Date.parse(target.date);
  const c = Date.parse(candidate.date);
  if (Number.isFinite(t) && Number.isFinite(c)) {
    const days = Math.abs(t - c) / 86400000;
    score += Math.min(20, days / 2);
  } else {
    score += 8;
  }

  return score;
}

export class PropArchiveService {
  private static readonly RESULT_MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

  private static async chromeGet(keys: string[]): Promise<Record<string, any>> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
    return new Promise((resolve) => chrome.storage.local.get(keys, (result) => resolve(result || {})));
  }

  private static async chromeSet(obj: Record<string, any>): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime?.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  private static async getAllRecords(): Promise<PropArchiveRecord[]> {
    const raw = await this.chromeGet([ARCHIVE_KEY]);
    const rows = raw[ARCHIVE_KEY];
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => r && typeof r === 'object') as PropArchiveRecord[];
  }

  private static async setAllRecords(records: PropArchiveRecord[]): Promise<void> {
    await this.chromeSet({ [ARCHIVE_KEY]: records });
  }

  static async addProp(record: PropArchiveRecord): Promise<void> {
    const normalized = normalizeRecord(record);
    if (!normalized) return;

    const all = await this.getAllRecords();
    const idx = all.findIndex((r) => recordKey(r) === recordKey(normalized));
    if (idx >= 0) {
      const merged = { ...all[idx], ...normalized };
      if (all[idx].line != null && normalized.line == null) merged.line = all[idx].line;
      if (Number.isNaN(normalized.result) && Number.isFinite(all[idx].result)) merged.result = all[idx].result;
      all[idx] = merged;
    } else {
      all.push(normalized);
    }
    await this.setAllRecords(all);
  }

  static async addProps(records: PropArchiveRecord[]): Promise<void> {
    if (!Array.isArray(records) || !records.length) return;
    const all = await this.getAllRecords();
    const byKey = new Map<string, PropArchiveRecord>(all.map((r) => [recordKey(r), r]));

    for (const rec of records) {
      const normalized = normalizeRecord(rec);
      if (!normalized) continue;
      const key = recordKey(normalized);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, normalized);
        continue;
      }
      const merged = { ...prev, ...normalized };
      if (prev.line != null && normalized.line == null) merged.line = prev.line;
      if (Number.isNaN(normalized.result) && Number.isFinite(prev.result)) merged.result = prev.result;
      byKey.set(key, merged);
    }

    await this.setAllRecords(Array.from(byKey.values()));
  }

  static async updateResult(
    fighter: string,
    event: string,
    propType: PropType,
    result: number,
    options?: { date?: string; opponent?: string | null }
  ): Promise<boolean> {
    const normalizedFighter = normalizeName(fighter);
    const normalizedEvent = normalizeEvent(event);
    const normalizedProp = String(normalizePropType(propType)).toLowerCase();
    const numericResult = Number(result);
    if (!normalizedFighter || !normalizedEvent || !Number.isFinite(numericResult)) return false;

    const all = await this.getAllRecords();
    const candidates = all.filter((row) => {
      if (normalizeName(row.fighter) !== normalizedFighter) return false;
      if (String(normalizePropType(row.propType)).toLowerCase() !== normalizedProp) return false;
      return true;
    });

    if (!candidates.length) return false;

    const exactEvent = candidates.filter((row) => normalizeEvent(row.event) === normalizedEvent);
    const targetDateTs = options?.date ? Date.parse(options.date) : NaN;
    const normalizedOpponent = normalizeName(options?.opponent || '');

    let targetRows: PropArchiveRecord[] = [];
    if (exactEvent.length > 0) {
      targetRows = exactEvent;
    } else if (Number.isFinite(targetDateTs)) {
      const dated = candidates
        .map((row) => ({ row, ts: Date.parse(row.date) }))
        .filter((x) => Number.isFinite(x.ts));

      let nearestDelta = Infinity;
      for (const x of dated) {
        const delta = Math.abs(x.ts - targetDateTs);
        if (delta < nearestDelta) nearestDelta = delta;
      }

      if (nearestDelta <= this.RESULT_MATCH_WINDOW_MS) {
        targetRows = dated
          .filter((x) => Math.abs(x.ts - targetDateTs) === nearestDelta)
          .map((x) => x.row);

        if (normalizedOpponent) {
          const oppMatches = targetRows.filter((row) => normalizeName(row.opponent) === normalizedOpponent);
          if (oppMatches.length) targetRows = oppMatches;
        }
      }
    }

    if (!targetRows.length && candidates.length === 1) {
      targetRows = [candidates[0]];
    }

    if (!targetRows.length) return false;

    let changed = false;
    const targetSet = new Set(targetRows);
    for (const row of all) {
      if (!targetSet.has(row)) continue;
      row.result = numericResult;
      changed = true;
    }
    if (changed) await this.setAllRecords(all);
    return changed;
  }

  static async getFighterHistory(fighter: string): Promise<PropArchiveRecord[]> {
    const normalizedFighter = normalizeName(fighter);
    const all = await this.getAllRecords();
    return all
      .filter((r) => normalizeName(r.fighter) === normalizedFighter)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  static async getPlatformHistory(fighter: string, platform: string, propType?: PropType): Promise<PropArchiveRecord[]> {
    const normalizedFighter = normalizeName(fighter);
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const normalizedProp = propType ? String(normalizePropType(propType)).toLowerCase() : null;

    const all = await this.getAllRecords();
    return all
      .filter((r) => normalizeName(r.fighter) === normalizedFighter)
      .filter((r) => String(r.platform || '').toLowerCase() === normalizedPlatform)
      .filter((r) => !normalizedProp || String(normalizePropType(r.propType)).toLowerCase() === normalizedProp)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  static async fighterHasFantasyLineHistory(fighter: string): Promise<boolean> {
    const rows = await this.getFighterHistory(fighter);
    return rows.some((r) => r.propType === 'Fantasy' && r.line != null && Number.isFinite(r.line));
  }

  static async fighterHasPerformanceHistory(fighter: string): Promise<boolean> {
    const rows = await this.getFighterHistory(fighter);
    return rows.some((r) => Number.isFinite(r.result));
  }

  static async backfillUnresolvedFromKnownOutcomes(options?: {
    eventIncludes?: string;
    maxScore?: number;
    minHoursBetweenRuns?: number;
  }): Promise<{ changed: number; unresolvedBefore: number; unresolvedAfter: number }> {
    const eventIncludes = normalizeEvent(options?.eventIncludes || '');
    const maxScore = Number.isFinite(options?.maxScore as number) ? Number(options?.maxScore) : 12;
    const minHoursBetweenRuns = Number.isFinite(options?.minHoursBetweenRuns as number)
      ? Number(options?.minHoursBetweenRuns)
      : 6;

    // Prevent excessive write churn from frequent page refreshes.
    const meta = await this.chromeGet([BACKFILL_META_KEY]);
    const lastRun = Number(meta?.[BACKFILL_META_KEY]?.lastRunMs || 0);
    const now = Date.now();
    if (Number.isFinite(lastRun) && lastRun > 0 && now - lastRun < minHoursBetweenRuns * 60 * 60 * 1000) {
      return { changed: 0, unresolvedBefore: 0, unresolvedAfter: 0 };
    }

    const all = await this.getAllRecords();
    const eligibleRows = eventIncludes
      ? all.filter((r) => normalizeEvent(r.event).includes(eventIncludes))
      : all;

    const known = eligibleRows.filter((r) => Number.isFinite(Number(r.result)));
    const unresolved = eligibleRows.filter((r) => Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result)));
    const unresolvedBefore = unresolved.length;

    let changed = 0;
    for (const row of unresolved) {
      const fighter = normalizeName(row.fighter);
      const prop = String(normalizePropType(row.propType)).toLowerCase();

      const candidates = known
        .filter((k) => normalizeName(k.fighter) === fighter)
        .filter((k) => String(normalizePropType(k.propType)).toLowerCase() === prop);

      if (!candidates.length) continue;

      let best: PropArchiveRecord | null = null;
      let bestScore = Infinity;
      for (const c of candidates) {
        const s = scoreBackfillCandidate(row, c);
        if (s < bestScore) {
          bestScore = s;
          best = c;
        }
      }

      if (!best || !Number.isFinite(Number(best.result))) continue;
      if (bestScore > maxScore) continue;

      row.result = Number(best.result);
      changed += 1;
    }

    if (changed > 0) {
      await this.setAllRecords(all);
    }

    const unresolvedAfter = all.filter((r) => {
      if (eventIncludes && !normalizeEvent(r.event).includes(eventIncludes)) return false;
      return Number.isFinite(Number(r.line)) && Number(r.line) > 0 && !Number.isFinite(Number(r.result));
    }).length;

    await this.chromeSet({ [BACKFILL_META_KEY]: { lastRunMs: now } });
    return { changed, unresolvedBefore, unresolvedAfter };
  }
}
