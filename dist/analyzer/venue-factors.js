export const VENUE_DB = {
    // High altitude venues
    'mexico city': { altitudeMeters: 2240, cageSizeFt: 30 },
    'bogota': { altitudeMeters: 2640, cageSizeFt: 30 },
    'denver': { altitudeMeters: 1609, cageSizeFt: 30 },
    'salt lake city': { altitudeMeters: 1288, cageSizeFt: 30 },
    'calgary': { altitudeMeters: 1045, cageSizeFt: 30 },
    'sao paulo': { altitudeMeters: 760, cageSizeFt: 30 },
    'edmonton': { altitudeMeters: 668, cageSizeFt: 30 },
    // Small cage (UFC APEX — 25ft octagon)
    'ufc apex': { altitudeMeters: 620, cageSizeFt: 25 },
    'apex': { altitudeMeters: 620, cageSizeFt: 25 },
    // Standard arenas (30ft, low altitude)
    'las vegas': { altitudeMeters: 620, cageSizeFt: 30 },
    'new york': { altitudeMeters: 10, cageSizeFt: 30 },
    'newark': { altitudeMeters: 10, cageSizeFt: 30 },
    'los angeles': { altitudeMeters: 71, cageSizeFt: 30 },
    'anaheim': { altitudeMeters: 47, cageSizeFt: 30 },
    'houston': { altitudeMeters: 15, cageSizeFt: 30 },
    'jacksonville': { altitudeMeters: 5, cageSizeFt: 30 },
    'miami': { altitudeMeters: 2, cageSizeFt: 30 },
    'atlantic city': { altitudeMeters: 3, cageSizeFt: 30 },
    'london': { altitudeMeters: 11, cageSizeFt: 30 },
    'paris': { altitudeMeters: 35, cageSizeFt: 30 },
    'abu dhabi': { altitudeMeters: 27, cageSizeFt: 30, climateNote: 'Hot/humid climate' },
    'riyadh': { altitudeMeters: 612, cageSizeFt: 30, climateNote: 'Hot/dry climate' },
    'perth': { altitudeMeters: 31, cageSizeFt: 30 },
    'sydney': { altitudeMeters: 58, cageSizeFt: 30 },
    'toronto': { altitudeMeters: 76, cageSizeFt: 30 },
    'montreal': { altitudeMeters: 36, cageSizeFt: 30 },
    'chicago': { altitudeMeters: 176, cageSizeFt: 30 },
    'boston': { altitudeMeters: 43, cageSizeFt: 30 },
    'detroit': { altitudeMeters: 183, cageSizeFt: 30 },
    'nashville': { altitudeMeters: 182, cageSizeFt: 30 },
    'sacramento': { altitudeMeters: 9, cageSizeFt: 30 },
    'san antonio': { altitudeMeters: 198, cageSizeFt: 30 },
    'dallas': { altitudeMeters: 131, cageSizeFt: 30 },
    'philadelphia': { altitudeMeters: 12, cageSizeFt: 30 },
    'louisville': { altitudeMeters: 142, cageSizeFt: 30 },
    'macau': { altitudeMeters: 3, cageSizeFt: 30 },
    'singapore': { altitudeMeters: 15, cageSizeFt: 30 },
    'shanghai': { altitudeMeters: 4, cageSizeFt: 30 },
    'seoul': { altitudeMeters: 38, cageSizeFt: 30 },
};
export const DEFAULT_VENUE = { altitudeMeters: 0, cageSizeFt: 30 };
export function resolveVenueFactor(location) {
    if (!location)
        return { factor: DEFAULT_VENUE, label: '' };
    const loc = location.toLowerCase();
    // Check venue name first (for "UFC APEX" etc.)
    if (loc.includes('apex'))
        return { factor: VENUE_DB['apex'], label: 'UFC APEX, Las Vegas' };
    // Match by city
    for (const [key, entry] of Object.entries(VENUE_DB)) {
        if (loc.includes(key))
            return { factor: entry, label: location.split(',').slice(0, 2).join(',').trim() };
    }
    return { factor: DEFAULT_VENUE, label: location.split(',').slice(0, 2).join(',').trim() };
}
//# sourceMappingURL=venue-factors.js.map