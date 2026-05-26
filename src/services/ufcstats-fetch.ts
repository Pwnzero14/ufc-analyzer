// UFCStats deploys a SHA-256 proof-of-work bot challenge: until solved, every
// page returns a ~3KB "Checking your browser…" stub instead of real content.
// This wrapper transparently detects the challenge, solves it, posts the
// solution to /__c (which sets a session cookie), and retries the fetch.
//
// Used by analyzer.ts (fighter/event lookups) and background.ts (settle +
// upcoming-card detection). Cookies are shared across both contexts via the
// browser's cookie jar — solving once unblocks all subsequent fetches.

let _powInFlight: Promise<boolean> | null = null;

function isChallengeHtml(html: string): boolean {
  return html.length < 8000
      && html.includes('Checking your browser')
      && html.includes('nonce=');
}

async function solvePow(html: string, originUrl: string): Promise<boolean> {
  const nonceMatch = html.match(/nonce="([^"]+)"/);
  if (!nonceMatch) return false;
  const nonce = nonceMatch[1];
  const targetMatch = html.match(/new Array\((\d+)\+1\)\.join\('0'\)/);
  const prefixLen = targetMatch ? parseInt(targetMatch[1], 10) : 2;
  const targetPrefix = '0'.repeat(prefixLen);
  const enc = new TextEncoder();
  // 16^prefixLen ≈ expected iterations; cap with 64x safety margin.
  const maxIter = Math.max(1_000_000, Math.pow(16, prefixLen) * 64);
  for (let n = 0; n < maxIter; n++) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(nonce + ':' + n));
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < arr.length && hex.length < prefixLen; i++) {
      hex += arr[i].toString(16).padStart(2, '0');
    }
    if (hex.slice(0, prefixLen) !== targetPrefix) continue;
    try {
      const base = new URL(originUrl).origin;
      const res = await fetch(base + '/__c', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'nonce=' + encodeURIComponent(nonce) + '&n=' + n,
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return false;
}

async function ensureSession(html: string, originUrl: string): Promise<boolean> {
  if (!_powInFlight) {
    _powInFlight = solvePow(html, originUrl).finally(() => { _powInFlight = null; });
  }
  return _powInFlight;
}

export async function ufcstatsFetchText(url: string, init?: RequestInit): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...(init || {}), credentials: 'include' });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const text = await res.text();
    if (!isChallengeHtml(text)) return text;
    if (attempt > 0) return null;
    const ok = await ensureSession(text, url);
    if (!ok) return null;
  }
  return null;
}
