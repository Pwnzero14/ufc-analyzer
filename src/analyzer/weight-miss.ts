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

export function parseWeightMissFromTitle(title: string, fighterName: string): WeightMissSignal | null {
  const lower = title.toLowerCase();
  const fLower = fighterName.toLowerCase();
  const lastName = fLower.split(' ').pop() || fLower;
  // Title must reference this fighter (full name OR last name)
  if (!lower.includes(fLower) && !lower.includes(lastName)) return null;
  // Reject negations: "never missed weight", "didn't miss weight", "won't miss"
  if (/\b(never|didn'?t|did\s+not|won'?t|will\s+not|hasn'?t|has\s+not)\s+miss(?:ed)?\s+weight\b/i.test(title)) return null;
  // Positive miss indicators
  const missPatterns = [
    /miss(?:ed|es|ing)?\s+weight/i,
    /fail(?:ed|s|ing)?\s+to\s+(?:make|hit)\s+weight/i,
    /(?:came|comes|coming|came in|comes in|coming in)\s+(?:in\s+)?(?:heavy|over)/i,
    /(?:weighs?|weighed)\s+in\s+(?:heavy|over)/i,
    /overweight/i,
    /over\s+the\s+(?:weight\s+)?limit/i,
    /\bover\s+by\s+[\d.]+\s*(?:lbs?|pounds?)/i,
    /[\d.]+\s*(?:lbs?|pounds?)\s+(?:over|heavy|overweight)/i,
  ];
  if (!missPatterns.some(p => p.test(title))) return null;
  // Extract pounds-over amount; take the most plausible match
  const lbsPatterns = [
    /by\s+([\d.]+)\s*(?:lbs?|pounds?)/i,
    /([\d.]+)\s*(?:lbs?|pounds?)\s+(?:over|heavy|overweight)/i,
    /over\s+by\s+([\d.]+)/i,
  ];
  let lbsOver: number | null = null;
  for (const re of lbsPatterns) {
    const m = title.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      // Reject implausible values (e.g., "scale weight 187" matched by greedy pattern)
      if (v > 0 && v < 30) { lbsOver = v; break; }
    }
  }
  return { lbsOver, severity: severityFromLbs(lbsOver), source: title };
}
