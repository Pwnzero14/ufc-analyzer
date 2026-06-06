/**
 * Content script for UFC fantasy lines scraping
 * Runs in the context of sportsbook & fantasy platform pages
 * Scrapes DOM to extract fighter lines and sends them to background service worker
 *
 * NOTE: This file must not use ESM imports because chrome content scripts are
 * injected as classic scripts (not modules). Keeping this file self-contained
 * avoids the "Cannot use import statement outside a module" error.
 */
declare const host: string;
declare const SCRAPE_CONFIG: {
    validation: {
        fp: {
            min: number;
            max: number;
        };
        ss: {
            min: number;
            max: number;
        };
        td: {
            min: number;
            max: number;
        };
    };
    scroll: {
        timeoutMs: number;
        intervalMs: number;
    };
    scrape: {
        maxAttempts: number;
        attemptIntervalMs: number;
        timeoutMs: number;
    };
};
declare function sleep(ms: any): Promise<unknown>;
declare function scrollToLoadAll(options?: {}): Promise<unknown>;
declare function log(platform: any, msg: any): void;
declare function logError(platform: any, msg: any, error: any): void;
declare function scrapePick6(): unknown[];
declare function getStatCoverage(fighters?: never[]): {
    total: number;
    fpCount: number;
    ssCount: number;
    tdCount: number;
    ctrlCount: number;
};
declare function scrapePick6AllStats(): Promise<any[]>;
declare function scrapeUnderdog(): unknown[];
declare function scrapePrizePicksCurrentView(): unknown[];
declare function findButtonByText(labels: any): Element | null;
declare function getPrizePicksCardCount(): number;
declare function waitForPrizePicksBoardReady(timeoutMs?: number): Promise<boolean>;
declare function clickLikeUser(el: any): void;
declare function clickButtonByLabels(context: any, labels: any, waitMs?: number): Promise<boolean>;
declare function clickPrizePicksButton(labels: any, waitMs?: number): Promise<boolean>;
declare function scrapePrizePicksAllStats(): Promise<any[]>;
declare function scrapeDKSportsbookProps(): unknown[];
declare function getScrapeProfile(platform: any): {
    maxAttempts: number;
    attemptIntervalMs: number;
    timeoutMs: number;
    stableTarget: number;
    minAttemptsBeforeResolve: number;
    scrollTimeoutMs: number;
    scrollIntervalMs: number;
};
declare function tryScrape(platform: any, scrapeFn: any): Promise<unknown>;
declare function main(): Promise<void>;
//# sourceMappingURL=content.d.ts.map