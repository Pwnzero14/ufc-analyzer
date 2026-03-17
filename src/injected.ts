/**
 * Injected script for Underdog - runs in page context
 * Intercepts window.fetch to capture API responses containing fighter data
 * Communicates back to content script via custom event
 */

(function () {
  // Prevent multiple injections
  if ((window as any).__ufcExtInjected) return;
  (window as any).__ufcExtInjected = true;

  const allFighters: Record<string, any> = {};

  function parseUnderdog(data: any): any[] {
    const lines = data.over_under_lines || {};
    const appearances = data.appearances || {};
    const players = data.players || {};
    const matchups = data.over_under || data.over_unders || data.over_under_appearances || {};

    Object.values(lines).forEach((line: any) => {
      if (line.status !== 'active') return;

      const statValue = parseFloat(line.stat_value);
      if (isNaN(statValue) || statValue < 0) return;

      const title = (line.title || line.stat || line.stat_type || '').toLowerCase();

      // Classify by stat type
      let lineType: 'ss' | 'td' | 'fp' | null = null;
      if (
        title.includes('significant strike') ||
        title === 'significant strikes'
      ) {
        lineType = 'ss';
      } else if (title.includes('takedown') && !title.includes('def')) {
        lineType = 'td';
      } else if (
        title.includes('fantasy') ||
        title.includes(' pts') ||
        title === 'fantasy points' ||
        title === ''
      ) {
        lineType = 'fp';
      }

      if (!lineType) return;

      // Validate ranges
      const validation: Record<string, [number, number]> = {
        fp: [5, 300],
        ss: [1, 300],
        td: [0.5, 20],
      };
      const [min, max] = validation[lineType];
      if (statValue < min || statValue > max) return;

      const app = appearances[line.appearance_id] || {};
      const player = players[app.player_id] || {};
      const name = player.full_name || player.name;
      if (!name) return;

      // Sport filter
      const sport = app.sport || '';
      if (sport && !/ufc|mma/i.test(sport)) return;

      // Find opponent
      let opponent: string | null = null;
      const matchupId = app.over_under_id || line.over_under_id;
      if (matchupId && matchups[matchupId]) {
        const mu = matchups[matchupId];
        const otherAppId = (mu.over_under_appearance_ids || []).find(
          (id: string) => id !== line.appearance_id
        );
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
          line_td: null,
          opponent,
        };
      }
      allFighters[name][`line_${lineType}`] = statValue;
      if (opponent) allFighters[name].opponent = opponent;
    });

    return Object.values(allFighters).filter(
      (f) => f.line_fp || f.line_ss || f.line_td
    );
  }

  // Intercept fetch
  const origFetch = window.fetch;
  (window as any).fetch = async function (...args: any[]): Promise<Response> {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await origFetch.apply(this, args as [RequestInfo | URL, RequestInit?]);

    if (url.includes('over_under_lines') || url.includes('pick_em')) {
      try {
        const json = await response.clone().json();
        const fighters = parseUnderdog(json);
        if (fighters.length > 0) {
          window.dispatchEvent(
            new CustomEvent('__ufc_underdog__', { detail: { fighters } })
          );
        }
      } catch (e) {
        // Silently ignore parse errors
      }
    }

    return response;
  };
})();
