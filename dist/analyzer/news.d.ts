export interface NewsItem {
    title: string;
    link: string;
    pubDate: string;
    source: string;
    description: string;
}
export declare const _newsCache: Map<string, {
    items: NewsItem[];
    fetchedAt: number;
}>;
export declare const _newsAlertFighters: Set<string>;
export declare const NEWS_INJURY_KEYWORDS: string[];
export declare function fetchFighterNews(name: string): Promise<NewsItem[]>;
//# sourceMappingURL=news.d.ts.map