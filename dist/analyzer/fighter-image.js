// Fetches a fighter's headshot URL from ufc.com athlete pages by parsing
// og:image / twitter:image meta tags. Two-tier cache: in-memory Map for
// the session, chrome.storage.local for cross-session persistence.
const _fighterImgCache = new Map();
// UFC.com slugs that don't follow the standard word-hyphen pattern.
const _slugOverrides = {
    'Abdul Rakhman Yakhyaev': 'abdulrakhman-yakhyaev',
};
function nameToUfcSlug(name) {
    if (_slugOverrides[name])
        return _slugOverrides[name];
    return name.toLowerCase()
        .replace(/['''`]/g, '') // drop apostrophes (O'Neill → oneill)
        .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → hyphen
        .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}
export async function fetchFighterImageUrl(name) {
    const slug = nameToUfcSlug(name);
    if (_fighterImgCache.has(slug))
        return _fighterImgCache.get(slug) ?? null;
    const cacheKey = `ufc_img_v1_${slug}`;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await new Promise(resolve => chrome.storage.local.get([cacheKey], resolve));
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
        if (!res.ok) {
            _fighterImgCache.set(slug, null);
            return null;
        }
        const html = await res.text();
        // Try og:image and twitter:image in multiple attribute orderings
        const patterns = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
        ];
        let url = null;
        for (const p of patterns) {
            const m = html.match(p);
            if (m?.[1] && m[1].startsWith('http')) {
                url = m[1];
                break;
            }
        }
        _fighterImgCache.set(slug, url);
        if (url && typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ [cacheKey]: url });
        }
        return url;
    }
    catch {
        clearTimeout(timer);
        _fighterImgCache.set(slug, null);
        return null;
    }
}
// ── GLOW-UP 33b: fighter country from the same ufc.com athlete pages ──────
// Separate cache from images so fighters with already-cached headshots still
// get a one-time country fetch. Returns the country name, e.g. "Georgia".
const _fighterCountryCache = new Map();
export async function fetchFighterCountry(name) {
    const slug = nameToUfcSlug(name);
    if (_fighterCountryCache.has(slug))
        return _fighterCountryCache.get(slug) ?? null;
    const cacheKey = `ufc_country_v1_${slug}`;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const stored = await new Promise(resolve => chrome.storage.local.get([cacheKey], resolve));
        if (stored[cacheKey] !== undefined) {
            _fighterCountryCache.set(slug, stored[cacheKey]);
            return stored[cacheKey];
        }
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
        const res = await fetch(`https://www.ufc.com/athlete/${slug}`, {
            signal: ctl.signal,
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });
        clearTimeout(timer);
        if (!res.ok) {
            _fighterCountryCache.set(slug, null);
            return null;
        }
        const html = await res.text();
        // <div class="c-bio__label">Place of Birth</div><div class="c-bio__text">Tbilisi, Georgia</div>
        const m = html.match(/Place of Birth<\/div>\s*<div[^>]*>([^<]+)</i);
        let country = null;
        if (m?.[1]) {
            const parts = m[1].split(',').map(x => x.trim()).filter(Boolean);
            country = parts.length ? parts[parts.length - 1] : null;
        }
        _fighterCountryCache.set(slug, country);
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ [cacheKey]: country });
        }
        return country;
    }
    catch {
        clearTimeout(timer);
        _fighterCountryCache.set(slug, null);
        return null;
    }
}
//# sourceMappingURL=fighter-image.js.map