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

  // ---------------------------------------------------------------- notifications
  // Alerts come from "Baseline alerts", a small always-on Cloudflare service (worker/ in the project), so they arrive
  // with the computer off. The phone subscribes to Web Push with the service's public key and posts its push address,
  // followed players (id + name), alert switches and time zone to it. A push address only works with the service's
  // private key, which never leaves the service.
  const ALERTS = window.BASELINE_ALERTS || null;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const deviceId = () => { let id = ls.get('baseline.device'); if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); ls.set('baseline.device', id); } return id; };
  const keyBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function serviceKey() {
    try { const r = await fetch(ALERTS + '/key', { cache: 'no-store' }); const j = await r.json(); if (j.key) { ls.set('baseline.alertsKey', j.key); return j.key; } } catch (e) { /* offline */ }
    return ls.get('baseline.alertsKey');
  }
  const sameKey = (sub, key) => { try { return new Uint8Array(sub.options.applicationServerKey).join() === keyBytes(key).join(); } catch (e) { return false; } };
  const push = {
    standalone: () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)),
    ios: () => /iPhone|iPad|iPod/.test(navigator.userAgent),
    supported: () => !!(ALERTS && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'),
    permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    async subscription() { if (!push.supported()) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); },
    // true when alerts are allowed but this phone isn't yet subscribed to the current service (needs one tap on Turn on)
    async needsTurnOn() {
      if (!push.supported() || push.permission() !== 'granted') return false;
      const sub = await push.subscription(); const key = await serviceKey();
      return !sub || !!(key && !sameKey(sub, key));
    },
    // Must be called straight from a tap (iPhone only allows the permission prompt and subscribing from a tap).
    async enable(settings) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return perm;
      const key = await serviceKey();
      if (!key) throw new Error('the alerts service is unreachable');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      await push.sync(settings, { force: true });
      return 'granted';
    },
    // Tell the service about this phone. Skipped when nothing changed in the last 12 hours. Returns the service's reply.
    async sync(settings, { force = false, test = false } = {}) {
      if (!ALERTS) return null;
      let sub = null;
      try { if (push.permission() === 'granted') sub = await push.subscription(); } catch (e) { /* no service worker yet */ }
      const msg = { v: 1, device: deviceId(), sub: sub ? sub.toJSON() : null, names: settings.names, notif: settings.notif, tz: settings.tz };
      const sig = JSON.stringify(msg);
      const last = Number(ls.get('baseline.syncedAt') || 0);
      if (!force && !test && sig === ls.get('baseline.synced') && Date.now() - last < 12 * 3600e3) return null;
      if (test) msg.test = Date.now();
      const r = await fetch(ALERTS + '/settings', { method: 'POST', body: JSON.stringify(msg) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'alerts service ' + r.status);
      ls.set('baseline.synced', sig); ls.set('baseline.syncedAt', String(Date.now()));
      return j;
    },
  };

  window.BaselineLoader = { data, live, headshot, image, direct: false, hosted: true, push };
})();
