"use strict";
/**
 * Injected script for Underdog - runs in page context
 * Intercepts window.fetch to capture API responses containing fighter data
 * Communicates back to content script via custom event
 */
(function () {
    // Prevent multiple injections
    if (window.__ufcExtInjected)
        return;
    window.__ufcExtInjected = true;
    const allFighters = {};
    function parseUnderdog(data) {
        const lines = data.over_under_lines || {};
        const appearances = data.appearances || {};
        const players = data.players || {};
        const matchups = data.over_under || data.over_unders || data.over_under_appearances || {};
        Object.values(lines).forEach((line) => {
            if (line.status !== 'active')
                return;
            const statValue = parseFloat(line.stat_value);
            if (isNaN(statValue) || statValue < 0)
                return;
            const title = (line.title || line.stat || line.stat_type || '').toLowerCase();
            // "(Combo)" props sum both fighters' totals — not an individual line. Skip so the
            // combined value can't clobber the real per-fighter stat (see PrizePicks parser).
            if (title.includes('combo'))
                return;
            // Classify by stat type. Body/Leg strike props are checked BEFORE the generic
            // significant-strikes branch so they get their own buckets (their titles —
            // "Significant Body/Leg Strikes" — don't match the generic substring anyway,
            // but order keeps intent explicit).
            let lineType = null;
            if (title.includes('strike') && title.includes('body')) {
                lineType = 'ss_body';
            }
            else if (title.includes('strike') && title.includes('leg')) {
                lineType = 'ss_leg';
            }
            else if (title.includes('significant strike') ||
                title === 'significant strikes') {
                // Round-1-only variants ("Round 1 Significant Strikes") get their own
                // bucket so they don't overwrite the total-fight SS line.
                lineType = /\bround\b|\brd\.?\s*\d|\br\d\b/i.test(title) ? 'ss_r1' : 'ss';
            }
            else if (title.includes('takedown') && !title.includes('def') && !title.includes('attempt')) {
                // "Takedown Attempts" is a different prop (attempts, not landed) — not fetched.
                lineType = 'td';
            }
            else if (title.includes('fantasy') ||
                title.includes(' pts') ||
                title === 'fantasy points' ||
                title === '') {
                lineType = 'fp';
            }
            if (!lineType)
                return;
            // Validate ranges
            const validation = {
                fp: [5, 300],
                ss: [1, 300],
                ss_r1: [1, 150],
                ss_body: [1, 200],
                ss_leg: [0.5, 150],
                td: [0.5, 20],
            };
            const [min, max] = validation[lineType];
            if (statValue < min || statValue > max)
                return;
            const app = appearances[line.appearance_id] || {};
            const player = players[app.player_id] || {};
            const name = player.full_name || player.name;
            if (!name)
                return;
            // Sport filter
            const sport = app.sport || '';
            if (sport && !/ufc|mma/i.test(sport))
                return;
            // Find opponent
            let opponent = null;
            const matchupId = app.over_under_id || line.over_under_id;
            if (matchupId && matchups[matchupId]) {
                const mu = matchups[matchupId];
                const otherAppId = (mu.over_under_appearance_ids || []).find((id) => id !== line.appearance_id);
                if (otherAppId && appearances[otherAppId]) {
                    const otherPlayer = players[appearances[otherAppId].player_id] || {};
                    opponent = otherPlayer.full_name || otherPlayer.name || null;
                }
            }
            if (!allFighters[name]) {
                allFighters[name] = {
                    name,
                    line_fp: null,
                    line_ss: null,
                    line_ss_r1: null,
                    line_ss_body: null,
                    line_ss_leg: null,
                    line_td: null,
                    opponent,
                };
            }
            allFighters[name][`line_${lineType}`] = statValue;
            if (opponent)
                allFighters[name].opponent = opponent;
        });
        return Object.values(allFighters).filter((f) => f.line_fp || f.line_ss || f.line_ss_r1 || f.line_ss_body || f.line_ss_leg || f.line_td);
    }
    // Intercept fetch
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const response = await origFetch.apply(this, args);
        if (url.includes('over_under_lines') || url.includes('pick_em')) {
            try {
                const json = await response.clone().json();
                const fighters = parseUnderdog(json);
                if (fighters.length > 0) {
                    window.dispatchEvent(new CustomEvent('__ufc_underdog__', { detail: { fighters } }));
                }
            }
            catch (e) {
                // Silently ignore parse errors
            }
        }
        return response;
    };
})();
//# sourceMappingURL=injected.js.map