export interface VenueFactorEntry {
    altitudeMeters: number;
    cageSizeFt: 25 | 30;
    climateNote?: string;
}
export declare const VENUE_DB: Record<string, VenueFactorEntry>;
export declare const DEFAULT_VENUE: VenueFactorEntry;
export declare function resolveVenueFactor(location: string | undefined): {
    factor: VenueFactorEntry;
    label: string;
};
//# sourceMappingURL=venue-factors.d.ts.map