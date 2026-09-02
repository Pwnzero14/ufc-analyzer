/*
 * Standalone UFCStats fetcher for VERIFYING cached data against the source.
 *
 * The extension already does this via src/services/ufcstats-fetch.ts; this is the
 * node equivalent so a diagnosis can check a page WITHOUT the browser. Solves the
 * SHA-256 proof-of-work challenge UFCStats added ~2026-05-25 (see
 * project_ufcstats_bot_challenge), posts the nonce back, keeps the cookie and
 * refetches. Read-only GETs of public fight statistics.
 *
 *   node scripts/ufcstats-fetch-cli.mjs "http://ufcstats.com/fight-details/<id>"
 *
 * Used 2026-09-02 to settle the archive-FP direction: the live Davis vs Ziam page
 * reads col 8 (Rev.) as Ziam 2 / Davis 3, matching the CACHE — so the cache is
 * right and the archive row is the stale one. That flipped a question that had
 * been assumed rather than checked for several sessions.
 */
// Minimal equivalent of the extension's ufcstatsFetchText: solve the SHA-256 PoW
// challenge, post the nonce, keep the cookie, refetch. Read-only GETs of public
// fight statistics — the same flow the extension already performs.
import { createHash } from 'crypto';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
let cookie = '';
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

async function raw(url, opts = {}) {
  const r = await fetch(url, { ...opts, redirect: 'follow',
    headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const k = kv.split('=')[0];
    cookie = cookie.split('; ').filter(Boolean).filter(x => x.split('=')[0] !== k).concat(kv).join('; '); }
  return r;
}

export async function get(url, depth = 0) {
  const r = await raw(url);
  const html = await r.text();
  if (!/Checking your browser/i.test(html) || depth > 2) return html;
  const nonce = html.match(/var nonce="([^"]+)"/)?.[1];
  const zeros = html.match(/new Array\((\d+)\+1\)\.join\('0'\)/)?.[1];
  if (!nonce || !zeros) throw new Error('challenge shape changed');
  const target = '0'.repeat(Number(zeros));
  let n = 0;
  while (sha(nonce + ':' + n).slice(0, target.length) !== target) n++;
  const origin = new URL(url).origin;
  await raw(origin + '/__c', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'nonce=' + encodeURIComponent(nonce) + '&n=' + n });
  return get(url, depth + 1);
}

if (process.argv[2]) {
  const html = await get(process.argv[2]);
  process.stdout.write(html);
}
