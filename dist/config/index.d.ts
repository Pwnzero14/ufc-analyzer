export declare const CONFIG: {
    readonly platforms: {
        readonly pick6: {
            readonly id: "pick6";
            readonly label: "Pick6 (DraftKings)";
            readonly color: "#63b3ed";
            readonly url: "https://pick6.draftkings.com/category/46?sport=UFC";
        };
        readonly underdog: {
            readonly id: "underdog";
            readonly label: "Underdog Fantasy";
            readonly color: "#9b4ae8";
            readonly url: "https://underdogfantasy.com/pick-em/higher-lower";
        };
        readonly betr: {
            readonly id: "betr";
            readonly label: "Betr Fantasy";
            readonly color: "#ff6b2b";
            readonly url: "https://betr.app/fantasy";
        };
        readonly prizepicks: {
            readonly id: "prizepicks";
            readonly label: "PrizePicks";
            readonly color: "#3bcf8e";
            readonly url: "https://app.prizepicks.com/board";
        };
    };
    readonly selectors: {
        readonly pick6: {
            readonly cardButton: "[data-testid=\"cardButton\"]";
            readonly playerCard: "[class*=\"PlayerCard\"], [class*=\"player\"], [class*=\"Pick\"]";
        };
        readonly underdog: {
            readonly overUnderCell: "[data-testid=\"over-under-cell\"]";
            readonly mmaIcon: "[data-testid=\"test-icon-mma\"]";
            readonly nameSelector: "[class*=\"nameAndButtons\"] [class*=\"name\"], [class*=\"playerName\"], [class*=\"displayName\"]";
        };
        readonly draftkings: {
            readonly tdLabel: "Total Takedowns Landed O/U";
            readonly betButton: "[class*=\"Bet\"], [class*=\"Button\"]";
        };
    };
    readonly api: {
        readonly underdog: readonly ["https://api.underdogfantasy.com/v2/over_under_lines", "https://api.underdogfantasy.com/v1/over_under_lines"];
        readonly ufcstats: {
            readonly upcoming: "http://www.ufcstats.com/statistics/events/upcoming?page=all";
            readonly completed: "http://www.ufcstats.com/statistics/events/completed?page=all";
            readonly base: "http://www.ufcstats.com";
        };
    };
    readonly polling: {
        readonly schedule: {
            readonly earlyWindow: {
                readonly daysUntil: 6.5;
                readonly intervalMinutes: 60;
            };
            readonly midWindow: {
                readonly daysUntil: 4;
                readonly intervalMinutes: 30;
            };
            readonly wednesdayWindow: {
                readonly daysUntil: 2.5;
                readonly intervalMinutes: 15;
            };
            readonly lateWindow: {
                readonly daysUntil: 0;
                readonly intervalMinutes: 5;
            };
        };
        readonly scrape: {
            readonly maxAttempts: 20;
            readonly attemptIntervalMs: 1500;
            readonly timeoutMs: 35000;
            readonly scrollTimeoutMs: 12000;
            readonly scrollIntervalMs: 600;
        };
        readonly storage: {
            readonly cacheExpireMs: 7200000;
            readonly pollAlarmName: "ufc_line_poll";
        };
    };
    readonly validation: {
        readonly fp: {
            readonly min: 5;
            readonly max: 300;
        };
        readonly ss: {
            readonly min: 1;
            readonly max: 300;
        };
        readonly td: {
            readonly min: 0.5;
            readonly max: 20;
        };
    };
    readonly http: {
        readonly userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        readonly defaultTimeout: 15000;
    };
    readonly logging: {
        readonly debug: false;
        readonly prefix: "[UFC]";
    };
};
export declare const LINE_DROP_SCHEDULE: {
    sunday: {
        window: string;
        label: string;
    };
    monday: {
        window: string;
        label: string;
    };
    wednesday: {
        window: string;
        label: string;
    };
    thursday: {
        window: string;
        label: string;
    };
    friday: {
        window: string;
        label: string;
    };
};
export declare const FANTASY_SCORING: {
    readonly sigStrike: 0.4;
    readonly nonSigStrike: 0.2;
    readonly controlTimePerSec: 0.03;
    readonly takedown: 5;
    readonly reversal: 5;
    readonly knockdown: 10;
    readonly quickWinBonus: 25;
    readonly winBonus: {
        readonly round1: 90;
        readonly round2: 70;
        readonly round3: 45;
        readonly round4Plus: 40;
        readonly decision: 30;
    };
};
export declare const PRIZEPICKS_SCORING: {
    readonly sigStrike: 0.5;
    readonly nonSigStrike: 0;
    readonly controlTimePerSec: 0;
    readonly takedown: 5;
    readonly reversal: 0;
    readonly knockdown: 10;
    readonly submissionAttempt: 4;
    readonly winBonus: {
        readonly round1: 50;
        readonly round2: 40;
        readonly round3: 30;
        readonly round4Plus: 20;
        readonly decision: 10;
    };
};
export declare const NAME_ALIASES: Record<string, string>;
//# sourceMappingURL=index.d.ts.map