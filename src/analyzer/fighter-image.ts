// Fetches a fighter's headshot URL from ufc.com athlete pages by parsing
// og:image / twitter:image meta tags. Two-tier cache: in-memory Map for
// the session, chrome.storage.local for cross-session persistence.
const _fighterImgCache = new Map<string, string | null>();

// UFC.com slugs that don't follow the standard word-hyphen pattern.
const _slugOverrides: Record<string, string> = {
  'Abdul Rakhman Yakhyaev': 'abdulrakhman-yakhyaev',
};

function nameToUfcSlug(name: string): string {
  if (_slugOverrides[name]) return _slugOverrides[name];
  return name.toLowerCase()
    .replace(/['''`]/g, '')        // drop apostrophes (O'Neill → oneill)
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphen
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
}

export async function fetchFighterImageUrl(name: string): Promise<string | null> {
  const slug = nameToUfcSlug(name);
  if (_fighterImgCache.has(slug)) return _fighterImgCache.get(slug) ?? null;

  const cacheKey = `ufc_img_v1_${slug}`;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await new Promise<Record<string, any>>(resolve =>
      chrome.storage.local.get([cacheKey], resolve)
    );
    if (stored[cacheKey] !== undefined) {
      _fighterImgCache.set(slug, stored[cacheKey]);
      return stored[cacheKey];
    }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`https://www.ufc.com/athlete/${slug}`, {
      signal: ctl.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timer);
    if (!res.ok) { _fighterImgCache.set(slug, null); return null; }
    const html = await res.text();
    // Try og:image and twitter:image in multiple attribute orderings
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    let url: string | null = null;
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1] && m[1].startsWith('http')) { url = m[1]; break; }
    }
    _fighterImgCache.set(slug, url);
    if (url && typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [cacheKey]: url });
    }
    return url;
  } catch {
    clearTimeout(timer);
    _fighterImgCache.set(slug, null);
    return null;
  }
}
