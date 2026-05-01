// Severity buckets: small <1lb, moderate 1-2lb, big 2-5lb, extreme 5+lb.
// Each tier has different lean implications (small = drained no upside,
// big = mixed size-advantage + cardio risk, extreme = major red flag).
export type WeightMissSeverity = 'small' | 'moderate' | 'big' | 'extreme' | 'unknown';
export interface WeightMissSignal { lbsOver: number | null; severity: WeightMissSeverity; source: string }

// Module-scoped signal map shared across the analyzer. Keys are lowercased
// fighter names. The lean engine reads this; the news fetcher writes it.
export const _weightMissSignals = new Map<string, WeightMissSignal>();

function severityFromLbs(lbs: number | null): WeightMissSeverity {
  if (lbs == null) return 'unknown';
  if (lbs < 1) return 'small';
  if (lbs < 2) return 'moderate';
  if (lbs < 5) return 'big';
  return 'extreme';
}

// Word-form numbers up through twelve — covers all plausible weight-miss
// magnitudes (anything bigger usually gets reported as digits).
const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM_TOKEN = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
function tokenToNumber(tok: string): number | null {
  const lower = tok.toLowerCase();
  if (WORD_NUMS[lower] != null) return WORD_NUMS[lower];
  const v = parseFloat(tok);
  return isNaN(v) ? null : v;
}

export function parseWeightMissFromTitle(title: string, _fighterName: string): WeightMissSignal | null {
  // No name-in-title gate: outlets often use "Longtime veteran" / "UFC Perth fighter"
  // instead of the name. Caller is responsible for context — fetchAllFighterNews
  // searches Google News per-fighter and applies a cross-fighter guard before
  // attributing the signal.
  // Reject negations: "never missed weight", "didn't miss weight", "won't miss"
  if (/\b(never|didn'?t|did\s+not|won'?t|will\s+not|hasn'?t|has\s+not)\s+miss(?:ed)?\s+weight\b/i.test(title)) return null;
  // Positive miss indicators
  const missPatterns = [
    /miss(?:ed|es|ing)?\s+weight/i,
    /weight\s+miss(?:ed|es|ing)?\b/i,
    /fail(?:ed|s|ing)?\s+to\s+(?:make|hit)\s+weight/i,
    /(?:came|comes|coming|came in|comes in|coming in)\s+(?:in\s+)?(?:heavy|over)/i,
    /(?:weighs?|weighed)\s+in\s+(?:heavy|over)/i,
    /overweight/i,
    /over\s+the\s+(?:weight\s+)?limit/i,
    /\bover\s+by\s+[\d.]+\s*(?:lbs?|pounds?)/i,
    /[\d.]+\s*(?:lbs?|pounds?)\s+(?:over|heavy|overweight)/i,
    // Hyphenated/word-form: "four-pound weight miss", "4-pound miss"
    new RegExp(`${NUM_TOKEN}[-\\s]+(?:lb|lbs|pound|pounds)\\s+(?:weight\\s+)?miss`, 'i'),
  ];
  if (!missPatterns.some(p => p.test(title))) return null;
  // Extract pounds-over amount; take the most plausible match. Patterns ordered
  // most-specific first so "missed by four pounds" wins over a stray digit.
  const lbsPatterns = [
    new RegExp(`by\\s+${NUM_TOKEN}\\s*(?:lbs?|pounds?)`, 'i'),
    new RegExp(`${NUM_TOKEN}[-\\s]+(?:lbs?|pounds?)\\s+(?:over|heavy|overweight|(?:weight\\s+)?miss)`, 'i'),
    new RegExp(`${NUM_TOKEN}\\s*(?:lbs?|pounds?)\\s+(?:over|heavy|overweight)`, 'i'),
    new RegExp(`miss(?:ed|es|ing)?\\s+(?:weight\\s+)?by\\s+${NUM_TOKEN}`, 'i'),
    new RegExp(`over\\s+by\\s+${NUM_TOKEN}`, 'i'),
  ];
  let lbsOver: number | null = null;
  for (const re of lbsPatterns) {
    const m = title.match(re);
    if (m) {
      const v = tokenToNumber(m[1]);
      // Reject implausible values (e.g., "scale weight 187" matched by greedy pattern)
      if (v != null && v > 0 && v < 30) { lbsOver = v; break; }
    }
  }
  return { lbsOver, severity: severityFromLbs(lbsOver), source: title };
}
