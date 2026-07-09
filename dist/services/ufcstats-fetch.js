// UFCStats deploys a SHA-256 proof-of-work bot challenge: until solved, every
// page returns a ~3KB "Checking your browser…" stub instead of real content.
// This wrapper transparently detects the challenge, solves it, posts the
// solution to /__c (which sets a session cookie), and retries the fetch.
//
// Used by analyzer.ts (fighter/event lookups) and background.ts (settle +
// upcoming-card detection). Cookies are shared across both contexts via the
// browser's cookie jar — solving once unblocks all subsequent fetches.
//
// THUNDERING-HERD PROTECTION (added 2026-07-09). The analyzer fans out over the
// whole card at once (Promise.all across ~28 fighters), and each fighter pulls an
// index page + detail page + one page PER FIGHT — hundreds of simultaneous requests.
// The per-fighter cache has a 24h TTL, so a batch written on one day all expires
// together the next, and the whole card re-fetches at once. Under that load UFCStats
// rate-limits (429) and re-issues challenges; the old code returned null on the first
// non-ok response and allowed only a single challenge retry, so most fighters silently
// failed and stuck on "Fetching from UFCStats…". Two guards now live here, at the one
// choke point every call site shares:
//   1. a global semaphore capping in-flight requests, and
//   2. retry with exponential backoff + jitter on 429/5xx/network blips.
// Nothing holds a semaphore slot while awaiting another acquire, so nested batches
// (fight pages inside a fighter fetch) cannot deadlock.
let _powInFlight = null;
// ── Global concurrency gate ──────────────────────────────────────────────────
const MAX_CONCURRENT = 4;
let _active = 0;
const _waiters = [];
async function acquire() {
    if (_active < MAX_CONCURRENT) {
        _active++;
        return;
    }
    await new Promise((resolve) => _waiters.push(resolve));
    // release() handed its slot straight to us — _active stays constant.
}
function release() {
    const next = _waiters.shift();
    if (next)
        next();
    else
        _active--;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ±25% jitter so a released herd doesn't retry in lockstep.
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));
function isChallengeHtml(html) {
    return html.length < 8000
        && html.includes('Checking your browser')
        && html.includes('nonce=');
}
async function solvePow(html, originUrl) {
    const nonceMatch = html.match(/nonce="([^"]+)"/);
    if (!nonceMatch)
        return false;
    const nonce = nonceMatch[1];
    const targetMatch = html.match(/new Array\((\d+)\+1\)\.join\('0'\)/);
    const prefixLen = targetMatch ? parseInt(targetMatch[1], 10) : 2;
    const targetPrefix = '0'.repeat(prefixLen);
    const enc = new TextEncoder();
    // 16^prefixLen ≈ expected iterations; cap with 64x safety margin.
    const maxIter = Math.max(1000000, Math.pow(16, prefixLen) * 64);
    for (let n = 0; n < maxIter; n++) {
        const buf = await crypto.subtle.digest('SHA-256', enc.encode(nonce + ':' + n));
        const arr = new Uint8Array(buf);
        let hex = '';
        for (let i = 0; i < arr.length && hex.length < prefixLen; i++) {
            hex += arr[i].toString(16).padStart(2, '0');
        }
        if (hex.slice(0, prefixLen) !== targetPrefix)
            continue;
        try {
            const base = new URL(originUrl).origin;
            const res = await fetch(base + '/__c', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'nonce=' + encodeURIComponent(nonce) + '&n=' + n,
                credentials: 'include',
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    return false;
}
async function ensureSession(html, originUrl) {
    if (!_powInFlight) {
        _powInFlight = solvePow(html, originUrl).finally(() => { _powInFlight = null; });
    }
    return _powInFlight;
}
const MAX_ATTEMPTS = 4;
const MAX_CHALLENGE_SOLVES = 2;
export async function ufcstatsFetchText(url, init) {
    await acquire();
    try {
        let challengeSolves = 0;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            // Backoff before every retry (400ms → 800ms → 1600ms, jittered). Also gives the
            // /__c session cookie a moment to commit after a challenge solve.
            if (attempt > 0)
                await sleep(jitter(400 * 2 ** (attempt - 1)));
            let res;
            try {
                res = await fetch(url, { ...(init || {}), credentials: 'include' });
            }
            catch {
                continue; // network blip — back off and retry
            }
            // Transient: rate-limited or server-side. Honour Retry-After when sane.
            if (res.status === 429 || res.status >= 500) {
                const ra = Number(res.headers.get('retry-after'));
                if (Number.isFinite(ra) && ra > 0)
                    await sleep(Math.min(ra * 1000, 5000));
                continue;
            }
            // Genuine miss (404, 403 block, …) — retrying won't help.
            if (!res.ok)
                return null;
            const text = await res.text();
            if (!isChallengeHtml(text))
                return text;
            // Challenged. Solve (deduped across concurrent callers) and retry.
            if (challengeSolves >= MAX_CHALLENGE_SOLVES)
                return null;
            challengeSolves++;
            const ok = await ensureSession(text, url);
            if (!ok)
                return null;
        }
        return null;
    }
    finally {
        release();
    }
}
//# sourceMappingURL=ufcstats-fetch.js.map