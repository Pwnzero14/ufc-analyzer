// Runs in PAGE context — intercepts window.fetch to capture Underdog API data
(function () {
  if (window.__ufcExtInjected) return;
  window.__ufcExtInjected = true;

  const allFighters = {};

  function parseUnderdog(data) {
    const lines       = data.over_under_lines        || {};
    const appearances = data.appearances             || {};
    const players     = data.players                 || {};
    const matchups    = data.over_under_appearances  || data.matchups || {};

    Object.values(lines).forEach(line => {
      if (line.status !== 'active') return;
      const statValue = parseFloat(line.stat_value);
      if (isNaN(statValue) || statValue < 0) return;

      const title = (line.title || line.stat || line.stat_type || '').toLowerCase();

      // Classify by stat_type/title
      let lineType = null;
      if (title.includes('significant strike') || title === 'significant strikes') lineType = 'ss';
      else if (title.includes('takedown') && !title.includes('def')) lineType = 'td';
      else if (title.includes('fantasy') || title.includes(' pts') || title === 'fantasy points') lineType = 'fp';
      else if (title === '') lineType = 'fp'; // empty title = fantasy points (Underdog default)

      if (!lineType) return;
      if (lineType === 'fp'  && (statValue < 5   || statValue > 300)) return;
      if (lineType === 'ss'  && (statValue < 1   || statValue > 300)) return;
      if (lineType === 'td'  && (statValue < 0.5 || statValue > 20))  return;

      const app    = appearances[line.appearance_id] || {};
      const player = players[app.player_id]          || {};
      const name   = player.full_name || player.name;
      if (!name) return;

      let opponent = null;
      const matchupId = app.over_under_id || line.over_under_id;
      if (matchupId && matchups[matchupId]) {
        const mu = matchups[matchupId];
        const otherAppId = (mu.over_under_appearance_ids || []).find(id => id !== line.appearance_id);
        if (otherAppId && appearances[otherAppId]) {
          const otherPlayer = players[appearances[otherAppId].player_id] || {};
          opponent = otherPlayer.full_name || otherPlayer.name || null;
        }
      }

      if (!allFighters[name]) allFighters[name] = { name, line_fp: null, line_ss: null, line_td: null, opponent };
      allFighters[name][`line_${lineType}`] = statValue;
      if (opponent) allFighters[name].opponent = opponent;
    });

    return Object.values(allFighters).filter(f => f.line_fp || f.line_ss || f.line_td);
  }

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
      } catch (e) {}
    }
    return response;
  };
})();
