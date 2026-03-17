import { LineDropState, LineDrop } from '../types/index.js';
import { CONFIG } from '../config/index.js';

/**
 * Line drop detection and monitoring service
 * Handles predictable UFC line drop schedules and triggers automatic scraping
 */
export class LineDropDetector {
  private static log(msg: string): void {
    console.log('[UFC LineWatch]', msg);
  }

  private static logError(msg: string, error?: unknown): void {
    const err = error instanceof Error ? error.message : String(error);
    console.error('[UFC LineWatch] ERROR:', msg, err);
  }

  // ── GET EXPECTED PLATFORMS BY DAYS UNTIL EVENT ─────────────────────────
  // Line drop schedule (event is always Saturday):
  //   SUNDAY    → Underdog SS/TD + PrizePicks SS/TD
  //   MONDAY    → Underdog SS/TD + PrizePicks SS/TD (continued)
  //   WEDNESDAY → Pick6 (DraftKings Fantasy) FP lines
  //   THURSDAY  → Pick6 FP (if not Wed), Betr FP starts, PP FP sometimes
  //   FRIDAY    → Betr FP (latest), PrizePicks FP (latest)
  // NOTE: FP lines do NOT drop Monday. SS/TD are the Monday lines.

  static getPlatformSchedule(eventSaturdayMs: number): Array<{ platform: string; type: string; label: string }> {
    const daysUntil = (eventSaturdayMs - Date.now()) / 86400000;
    const schedule: Array<{ platform: string; type: string; label: string }> = [];

    // Sunday afternoon (6.5 days before Sat)
    if (daysUntil <= 6.5) {
      schedule.push({
        platform: 'underdog',
        type: 'ss_td',
        label: 'Underdog SS/TD',
      });
      schedule.push({
        platform: 'prizepicks',
        type: 'ss_td',
        label: 'PrizePicks SS/TD',
      });
    }

    // Wednesday (3.5 days before Sat)
    if (daysUntil <= 3.5) {
      schedule.push({
        platform: 'pick6',
        type: 'fp',
        label: 'Pick6 FP',
      });
    }

    // Thursday-Friday (2.5 days before Sat)
    if (daysUntil <= 2.5) {
      schedule.push({
        platform: 'betr',
        type: 'fp',
        label: 'Betr FP',
      });
      schedule.push({
        platform: 'prizepicks',
        type: 'fp',
        label: 'PrizePicks FP',
      });
    }

    return schedule;
  }

  // ── ADAPTIVE POLL RATE ───────────────────────────────────────────────
  // Accelerates as event approaches:
  //   >6.5 days  → null  (too early, outside window)
  //   5.5-6.5    → 60min (Sunday: watching for afternoon SS/TD drop)
  //   4-5.5      → 30min (Monday: lines populating, more fighters added)
  //   2.5-4      → 15min (Wed: Pick6 FP expected)
  //   0-2.5      → 5min  (Thu-Fri: Betr + PP FP, event approaching)

  static getPollIntervalMinutes(daysUntil: number): number | null {
    if (daysUntil > 6.5) return null;
    if (daysUntil > 5.5) return 60;
    if (daysUntil > 4) return 30;
    if (daysUntil > 2.5) return 15;
    return 5;
  }

  // ── QUICK UNDERDOG LINE CHECK ──────────────────────────────────────────

  static async quickCheckUnderdogLines(): Promise<number> {
    const endpoints = CONFIG.api.underdog;

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;

        const data = await res.json();
        const lines = Object.values(data.over_under_lines || {}) as any[];
        const appearances = data.appearances || {};

        let mmaCount = 0;

        lines.forEach((line) => {
          const val = parseFloat(line.stat_value);
          if (isNaN(val) || val < 20 || val > 400) return;

          const title = (line.title || line.stat || line.display_stat || '').toLowerCase();

          // Filter out non-FP lines
          if (
            title.includes('strike') ||
            title.includes('takedown') ||
            title.includes('round')
          ) {
            return;
          }

          const app = appearances[line.appearance_id] || {};
          const sport = app.sport || '';

          if (sport && !/ufc|mma/i.test(sport)) return;

          mmaCount++;
        });

        return mmaCount;
      } catch (error) {
        // Continue to next endpoint
      }
    }

    return 0;
  }

  // ── DETECT LINE DROPS ──────────────────────────────────────────────────

  static detectDrops(
    schedule: Array<{ platform: string; type: string; label: string }>,
    udCount: number,
    prevUDCount: number,
    p6Count: number,
    prevP6Count: number,
    detectedUD: number | null,
    detectedP6: number | null
  ): LineDrop[] {
    const drops: LineDrop[] = [];

    // Underdog SS/TD detection (Monday window)
    // Threshold: appeared when wasn't there, or +4 fighters
    if (
      schedule.find((e) => e.platform === 'underdog') &&
      !detectedUD
    ) {
      if ((udCount > 3 && prevUDCount === 0) || udCount > prevUDCount + 4) {
        drops.push({
          platform: 'Underdog',
          type: 'SS/TD',
          count: udCount,
        });
      }
    }

    // Pick6 FP detection (Wednesday window)
    if (
      schedule.find((e) => e.platform === 'pick6') &&
      !detectedP6
    ) {
      if ((p6Count > 3 && prevP6Count === 0) || p6Count > prevP6Count + 4) {
        drops.push({
          platform: 'Pick6',
          type: 'FP',
          count: p6Count,
        });
      }
    }

    return drops;
  }

  // ── UPDATE POLL RATE ───────────────────────────────────────────────────

  static shouldUpdatePollRate(
    state: LineDropState,
    daysUntil: number
  ): { shouldUpdate: boolean; newMinutes: number | null } {
    const newMins = this.getPollIntervalMinutes(daysUntil);
    const curMins = state._currentPollMins || 30;

    // Only update if difference is >= 5 minutes
    if (newMins === null || Math.abs(newMins - curMins) < 5) {
      return { shouldUpdate: false, newMinutes: newMins };
    }

    return { shouldUpdate: true, newMinutes: newMins };
  }

  // ── HELPERS ───────────────────────────────────────────────────────────

  static isOutsideWindow(daysUntil: number): boolean {
    return daysUntil > 6.5 || daysUntil < -1;
  }

  static formatSchedule(
    schedule: Array<{ platform: string; type: string; label: string }>
  ): string {
    if (schedule.length === 0) return 'None';
    return schedule.map((e) => e.label).join(', ');
  }

  static logPollStatus(
    daysUntil: number,
    schedule: Array<{ platform: string; type: string; label: string }>,
    udCount: number,
    prevUDCount: number,
    p6Count: number,
    prevP6Count: number
  ): void {
    this.log(
      `${daysUntil.toFixed(1)}d out | UD:${udCount}(was ${prevUDCount}) P6:${p6Count}(was ${prevP6Count}) | ` +
      `Expecting: ${this.formatSchedule(schedule)}`
    );
  }

  static logLineDrops(drops: LineDrop[]): void {
    const formatted = drops.map((d) => `${d.platform} ${d.type}(${d.count})`).join(', ');
    this.log(`LINE DROP: ${formatted}`);
  }

  static logWatcherStart(
    eventName: string,
    eventDateStr: string,
    daysUntil: number,
    pollMins: number
  ): void {
    this.log(
      `Started — "${eventName}" ${eventDateStr} (${daysUntil.toFixed(1)}d out) | Poll: ${pollMins}min`
    );
    this.log(
      `Schedule: Mon=UD/PP SS+TD · Wed=Pick6 FP · Thu-Fri=Betr+PP FP`
    );
  }

  static logWatcherStop(): void {
    this.log('Stopped');
  }
}
