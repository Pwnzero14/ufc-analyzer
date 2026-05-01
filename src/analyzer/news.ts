// Google News RSS fetch + per-fighter cache. The news modal and the
// fetchAllFighterNews orchestrator (which also writes the weight-miss signal
// map) read from the shared exports below.

export interface NewsItem { title: string; link: string; pubDate: string; source: string; description: string }

export const _newsCache = new Map<string, { items: NewsItem[]; fetchedAt: number }>();
export const _newsAlertFighters = new Set<string>();
export const NEWS_INJURY_KEYWORDS = [
  'injur', 'withdraw', 'pull', 'weight cut', 'hospitali', 'surgery',
  'fracture', 'concussion', 'illness', 'sick', 'off the card', 'cancel',
  "won't fight", 'replac', 'medic',
];

const NEWS_CACHE_TTL = 30 * 60 * 1000;

export async function fetchFighterNews(name: string): Promise<NewsItem[]> {
  const key = name.toLowerCase();
  const cached = _newsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL) return cached.items;
  try {
    const query = encodeURIComponent(`"${name}" UFC`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const resp = await fetch(url);
    if (!resp.ok) { _newsCache.set(key, { items: [], fetchedAt: Date.now() }); return []; }
    const xml = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const items = Array.from(doc.querySelectorAll('item')).map(item => {
      const rawLink = (item.querySelector('link')?.textContent || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      let link = rawLink;
      if (link && !/^https?:\/\//i.test(link)) {
        // Google News RSS sometimes yields only the article slug; rebuild absolute URL.
        link = 'https://news.google.com/rss/articles/' + link.replace(/^\/+/, '');
      }
      // Description is HTML — strip tags and decode common entities so we can
      // text-match (used for fighter-name attribution when titles are generic).
      const rawDesc = (item.querySelector('description')?.textContent || '').replace(/<!\[CDATA\[|\]\]>/g, '');
      const description = rawDesc
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
      return {
        title: (item.querySelector('title')?.textContent || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        link,
        pubDate: item.querySelector('pubDate')?.textContent || '',
        source: item.querySelector('source')?.textContent?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '',
        description,
      };
    }).filter(item => {
      const pub = item.pubDate ? new Date(item.pubDate).getTime() : 0;
      return pub > cutoff;
    });
    _newsCache.set(key, { items, fetchedAt: Date.now() });
    return items;
  } catch {
    _newsCache.set(key, { items: [], fetchedAt: Date.now() });
    return [];
  }
}
