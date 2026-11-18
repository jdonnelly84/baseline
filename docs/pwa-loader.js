// Loader for the hosted Baseline (GitHub Pages, added to the iPhone Home Screen from Safari).
//  - Live scores come straight from ATP's live feed, which any website may read, so they are real-time anywhere.
//  - Everything else (draws, order of play, results, rankings, news) comes from data.json, which the updater on
//    the computer (updater/updater.py) refreshes every 10 minutes and publishes to GitHub.
// window.BASELINE_DATA_URL is set by scripts/build_web.py.
(function () {
  'use strict';
  const ATP = 'https://www.atptour.com';
  const LIVE_URL = 'https://app.atptour.com/api/v2/gateway/livematches/website?scoringTournamentLevel=tour';

  // Same as parseLive in src/parse.js (kept in step by hand; it is small and has no dependencies).
  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const LIVE_STATUS = { P: 'live', W: 'warmup', C: 'oncourt', F: 'finished', S: 'suspended', D: 'delayed', R: 'retired', X: 'finished' };
  function mapTeam(T) {
    if (!T || !T.Player) return null;
    const pl = [T.Player, T.Partner].filter((p) => p && p.PlayerId);
    return {
      players: pl.map((p) => ({ id: p.PlayerId.toUpperCase(), first: p.PlayerFirstName, last: p.PlayerLastName, country: p.PlayerCountry })),
      seed: T.Seed || null, entry: T.EntryType || null, game: T.GameScore,
      sets: (T.SetScores || []).filter((s) => s.SetScore !== null && s.SetScore !== undefined).map((s) => ({ g: s.SetScore, tb: s.TieBreakScore })),
    };
  }
  function parseLive(json) {
    const data = json.Data || json;
    const out = {};
    for (const t of data.LiveMatchesTournamentsOrdered || []) {
      out[String(t.EventId)] = {
        id: String(t.EventId), title: t.EventTitle, city: t.EventCity, day: t.EventCurrentDayNumber,
        matches: (t.LiveMatches || []).map((m) => ({
          id: m.MatchId, round: m.RoundName, court: m.CourtName, doubles: !!m.IsDoubles,
          status: LIVE_STATUS[m.MatchStatus] || m.MatchStatus, rawStatus: m.MatchStatus,
          server: m.ServerTeam, duration: m.MatchTimeTotal, message: clean(m.ExtendedMessage),
          updated: m.LastUpdated, winner: m.WinningPlayerId ? m.WinningPlayerId.toUpperCase() : null,
          umpire: [m.UmpireFirstName, m.UmpireLastName].filter(Boolean).join(' '),
          a: mapTeam(m.PlayerTeam), b: mapTeam(m.OpponentTeam),
        })),
      };
    }
    return out;
  }

  async function live() {
    const r = await fetch(LIVE_URL, { credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error('live ' + r.status);
    return { at: new Date().toISOString(), live: parseLive(await r.json()) };
  }

  async function data() {
    const r = await fetch(window.BASELINE_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('data ' + r.status);
    const d = await r.json();
    d.dataAt = d.generatedAt; // when the computer last refreshed draws, schedules and rankings
    try { const L = await live(); d.live = L.live; d.generatedAt = L.at; } catch (e) { /* keep the updater's copy */ }
    return d;
  }

  const headshot = (id) => ATP + '/-/media/alias/player-headshot/' + id.toLowerCase();
  const image = (p) => (p.startsWith('http') ? p : ATP + p);
  window.BaselineLoader = { data, live, headshot, image, direct: false, hosted: true };
})();
