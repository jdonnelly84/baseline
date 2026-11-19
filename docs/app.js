/* Baseline — ATP scores, draws, calendar, news and rankings.
   Data comes from window.ATP_DATA (preview snapshot) or /api/data (live server). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  let D = null;                      // the data bundle on screen: DA (ATP) or DW (WTA)
  let DA = null, DW = null;
  const LIVE_MODE = !window.ATP_DATA;  // server mode polls /api/live
  const store = {
    get(k, d) { try { const v = localStorage.getItem('baseline.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('baseline.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const S = {
    tab: store.get('tab', 'scores'),
    view: null,                       // { type: 'tournament', id, sub }
    scoresSub: 'all',
    calFilter: 'all', calPast: false,
    newsFilter: 'All',
    rkKind: 'singles', rkList: 'sgl', rkQuery: '',
    drawType: 'sgl', drawRound: null, drawQuery: '', resType: 'sgl',
    resDay: 0, schedDay: null, pastRound: null, // tournament screens: chosen results day, schedule day, past-event round
    espn: {},
    entry: {},                        // WTA entry lists: { 'tid:year': list | false }                         // ESPN lookups for past events and last year's editions: { 'tid:year': {loading|error|ev} }
    favs: store.get('favs', ['S0AG', 'A0E2']),
    notif: store.get('notif', { start: true, sets: false, result: true, schedule: true }),
    tz: store.get('tz', null),
    theme: store.get('theme', 'system'),
    tour: store.get('tour', 'atp'),       // which tour the screens show: atp or wta
    topFix: store.get('topfix', 'auto'),  // top spacing under the status bar: auto, or forced on/off from Settings
    feed: store.get('feed', []),
    unread: store.get('unread', 0),
    sheet: null,
    addQuery: '',
  };
  const dataFor = (id) => (/^W\d/.test(id || '') ? DW : DA) || D;
  function withD(data, fn) { const save = D; D = data || save; try { return fn(); } finally { D = save; } }
  const tz = () => S.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Pacific/Auckland';
  const nowRef = () => (D && D.source === 'snapshot' ? new Date(D.generatedAt) : new Date());

  // ---------------------------------------------------------------- fast dates and numbers
  // Formatting a date or number with options builds a new formatter every time, which is slow on a phone when a
  // screen shows hundreds of dates (the calendar). These keep one formatter per style and reuse it; same output.
  (function () {
    const cache = new Map();
    const has = (o, ks) => ks.some((k) => o[k] !== undefined);
    const DATE = ['weekday', 'era', 'year', 'month', 'day', 'dateStyle'], TIME = ['hour', 'minute', 'second', 'dayPeriod', 'timeStyle', 'fractionalSecondDigits'];
    const withDefaults = (kind, o) => {
      const d = { year: 'numeric', month: 'numeric', day: 'numeric' }, t = { hour: 'numeric', minute: 'numeric', second: 'numeric' };
      if (kind === 'date' && !has(o, DATE)) return { ...d, ...o };
      if (kind === 'time' && !has(o, TIME)) return { ...t, ...o };
      if (kind === 'any' && !has(o, DATE) && !has(o, TIME)) return { ...d, ...t, ...o };
      return o;
    };
    const patch = (proto, name, kind, make) => {
      const orig = proto[name];
      proto[name] = function (loc, opts) {
        if (loc === undefined && opts === undefined) return orig.call(this);
        try {
          const k = name + '|' + loc + '|' + (opts ? JSON.stringify(opts) : '');
          let f = cache.get(k); if (!f) { f = make(loc, opts ? withDefaults(kind, opts) : withDefaults(kind, {})); cache.set(k, f); }
          return f.format(this);
        } catch (e) { return orig.call(this, loc, opts); }
      };
    };
    patch(Date.prototype, 'toLocaleDateString', 'date', (l, o) => new Intl.DateTimeFormat(l, o));
    patch(Date.prototype, 'toLocaleTimeString', 'time', (l, o) => new Intl.DateTimeFormat(l, o));
    patch(Date.prototype, 'toLocaleString', 'any', (l, o) => new Intl.DateTimeFormat(l, o));
    patch(Number.prototype, 'toLocaleString', 'num', (l, o) => new Intl.NumberFormat(l, o));
  })();

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('en-NZ'));
  const catClass = (t) => ({ GS: 'GS', '1000': 'm1000', '500': 'a500', '250': 'a250', '125': 'a125' }[t] || '');
  const catLabel = (t) => ({ GS: 'GS', '1000': '1000', '500': '500', '250': '250', WC: 'FINALS', XXI: 'NEXTGEN', BJK: 'BJK CUP', '125': '125', DCR: 'DAVIS', UC: 'UNITED', LVR: 'LAVER' }[t] || t);
  const tById = (id) => D.tournaments.find((t) => t.id === String(id));
  const player = (id) => (id && D.players[id]) || null;
  const pname = (p) => (p && (player(p.id)?.name || p.name)) || 'TBA';
  const shortName = (p) => { const pl = player(p?.id); if (pl?.short) return pl.short; if (p?.last && p?.first) return p.first[0] + '. ' + p.last; const n = pname(p); const parts = n.split(' '); return parts.length > 1 && !n.includes('.') ? parts[0][0] + '. ' + parts.slice(1).join(' ') : n; };
  const isFav = (id) => id && S.favs.includes(id);
  const teamHasFav = (t) => (t?.players || []).some((p) => isFav(p.id));

  function flag(code) {
    if (!code || code === 'RUS' || code === 'BLR') return '';
    const c = code.toLowerCase();
    // flags come with the ATP data; a country it doesn't have (e.g. from ESPN results) uses ESPN's flag picture
    if (document.getElementById('flag-' + c) || !document.querySelector('#flags symbol')) return `<svg class="flag" aria-label="${esc(code)}"><use href="#flag-${esc(c)}"/></svg>`;
    return `<img class="flag" alt="${esc(code)}" src="https://a.espncdn.com/i/teamlogos/countries/500/${esc(c)}.png" loading="lazy" onerror="this.remove()">`;
  }
  function headshotSrc(id) {
    if (!id) return null;
    if (/^W\d/.test(id)) { const e = espnEids.get(id); return e ? `https://a.espncdn.com/i/headshots/tennis/players/full/${e}.png` : null; }
    if (D.images) return D.images['p_' + id] || null;
    if (window.BaselineLoader) return window.BaselineLoader.headshot(id);
    return '/api/headshot/' + id;
  }
  function avatar(p, cls = '') {
    const id = p?.id; const src = headshotSrc(id) || p?.img || null;
    const initials = pname(p).split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').replace('.', '');
    return src ? `<img class="av ${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'av ${cls}',textContent:'${esc(initials)}'}))">`
      : `<span class="av ${cls}">${esc(initials)}</span>`;
  }
  const ICON = {
    scores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M4.6 7.5c3.2 1.6 5 4.5 5 8.5M19.4 16.5c-3.2-1.6-5-4.5-5-8.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor"/><circle cx="12" cy="14.5" r="1" fill="currentColor"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M7 8.5h10M7 12h10M7 15.5h6"/></svg>',
    rankings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 20v-6M12 20V5M19 20v-9"/></svg>',
    following: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
    starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  };

  // Dates and times ---------------------------------------------------
  const dateFrom = (iso) => new Date(iso + 'T12:00:00Z');
  const fmtDay = (iso, opts = { day: 'numeric', month: 'short' }) => dateFrom(iso).toLocaleDateString('en-NZ', { ...opts, timeZone: 'UTC' });
  const fmtRange = (t) => { if (!t.start) return t.dates; const a = dateFrom(t.start), b = dateFrom(t.end); const sm = a.getUTCMonth() === b.getUTCMonth(); return sm ? `${a.getUTCDate()}–${fmtDay(t.end)}` : `${fmtDay(t.start)} – ${fmtDay(t.end)}`; };
  const fmtTime = (utc) => new Date(utc).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: tz() }).replace(' ', '').toLowerCase();
  const fmtWeekday = (utc) => new Date(utc).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz() });
  const tzName = () => { try { return new Intl.DateTimeFormat('en-NZ', { timeZone: tz(), timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; } catch (e) { return tz(); } };
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }); };
  // "Wed, 18 November, 2026" + "Day 4" → "Wed 18 Nov · Day 4"
  const dayLabel = (date, day) => [(date || '').replace(/,? \d{4}$/, '').replace(/^(\w+),/, '$1').replace(/(\d+) (\w{3})\w*/, '$1 $2'), day].filter(Boolean).join(' · ');
  function tournamentState(t) {
    const today = nowRef().toISOString().slice(0, 10);
    if (D.live[t.id] || (t.start <= today && t.end >= today)) return 'live';
    if (t.end < today) return 'past';
    return 'upcoming';
  }
  const currentEvents = () => D.tournaments.filter((t) => D.events[t.id] || D.live[t.id]).sort((a, b) => (b.end > a.end) - (a.end > b.end) || ({ '1000': 0, '500': 1, '250': 2 }[a.type] ?? 3) - ({ '1000': 0, '500': 1, '250': 2 }[b.type] ?? 3));

  // ---------------------------------------------------------------- match model
  // Normalises live-feed, results and draw matches into one shape.
  function fromLive(m, tid) {
    const fin = m.status === 'finished';
    let winner = null;
    if (fin) {
      const wa = m.winner && m.a.players.some((p) => p.id === m.winner); const wb = m.winner && m.b.players.some((p) => p.id === m.winner);
      if (wa) winner = 0; else if (wb) winner = 1;
      else { const sa = setsWon(m.a.sets, m.b.sets); winner = sa[0] > sa[1] ? 0 : sa[1] > sa[0] ? 1 : null; }
    }
    return { tid, id: m.id, round: m.round, court: m.court, status: m.status, doubles: m.doubles, a: m.a, b: m.b, server: m.server, winner, duration: m.duration, message: m.message, updated: m.updated };
  }
  function fromResult(m, tid, date) {
    return { tid, id: m.id, round: m.round, court: m.court, status: 'finished', a: m.a, b: m.b, winner: m.a?.won ? 0 : m.b?.won ? 1 : null, duration: m.duration, message: m.notes, date };
  }
  function setsWon(sa, sb) {
    let a = 0, b = 0;
    (sa || []).forEach((s, i) => { const o = sb?.[i]; if (!o || s.g == null || o.g == null) return; if (s.g > o.g && s.g >= 6) a++; else if (o.g > s.g && o.g >= 6) b++; });
    return [a, b];
  }
  const liveMatches = () => Object.values(D.live).flatMap((t) => t.matches.map((m) => fromLive(m, t.id)));
  const isOn = (m) => ['live', 'warmup', 'oncourt', 'suspended', 'delayed'].includes(m.status);
  const roundShort = (r) => (r || '').replace('Round Robin', 'RR').replace('Round of ', 'R').replace('Quarterfinals', 'QF').replace('Quarter-Finals', 'QF').replace('Semifinals', 'SF').replace('Semi-Finals', 'SF').replace('1st Round Qualifying', 'Q1').replace('2nd Round Qualifying', 'Q2').replace('3rd Round Qualifying', 'Q3').replace('Final', 'F');

  function teamRow(team, other, { won, lost, serving, live, game } = {}) {
    if (!team) return '';
    const ps = team.players || [];
    const tag = team.seed ? `(${team.seed})` : team.entry ? `(${team.entry})` : '';
    const names = ps.length ? ps.map((p) => `<span class="pname clickable" data-player="${esc(p.id || '')}">${flag(p.country)}<span>${esc(ps.length > 1 ? shortName(p) : pname(p))}</span>${p === ps[ps.length - 1] && tag ? `<span class="seed">${esc(tag)}</span>` : ''}${isFav(p.id) ? `<span style="color:var(--warn);font-size:12px">★</span>` : ''}</span>`).join('') : '<span class="pname">TBA</span>';
    const sets = (team.sets || []).map((s, i) => {
      const o = other?.sets?.[i]; const lostSet = o && o.g != null && s.g != null && s.g < o.g;
      return `<span class="${lostSet ? 'lost' : ''}">${s.g ?? ''}${s.tb != null && lostSet ? `<sup>${s.tb}</sup>` : ''}</span>`;
    }).join('');
    return `<div class="team ${won ? 'won' : ''} ${lost ? 'lost' : ''}">
      <div class="who">${ps.length === 1 ? avatar(ps[0], 'sm') : ''}<div class="names">${names}</div>${serving ? '<span class="serve" title="Serving"></span>' : ''}</div>
      <div class="sets">${sets}${live && game != null && game !== '' ? `<span class="game">${esc(game)}</span>` : ''}</div>
    </div>`;
  }
  function statusLabel(m) {
    return { live: '<span class="pill live">Live</span>', warmup: '<span class="pill warn">Warm-up</span>', oncourt: '<span class="pill warn">On court</span>', suspended: '<span class="pill warn">Suspended</span>', delayed: '<span class="pill warn">Delayed</span>', finished: '<span class="pill done">Final</span>' }[m.status] || '';
  }
  function matchCard(m, { showEvent = true } = {}) {
    const t = tById(m.tid); const on = isOn(m);
    const fav = teamHasFav(m.a) || teamHasFav(m.b);
    const dur = m.duration && m.duration !== '00:00:00' ? m.duration.replace(/^0(\d):/, '$1:').replace(/:\d\d$/, '') : '';
    const msg = on && m.message ? m.message : m.status === 'finished' && /^(Retired|Walkover)$/.test(m.message || '') ? m.message : m.status === 'finished' && m.date ? m.date : '';
    return `<article class="match ${fav ? 'fav' : ''}">
      <div class="m-head"><div class="l">${showEvent && t ? `<span class="cat ${catClass(t.type)}" style="min-width:30px;height:18px;font-size:11px">${catLabel(t.type)}</span><span class="t">${esc(t.city)} · ${esc(roundShort(m.round))}</span>` : `<span class="t">${esc(m.round || '')}</span>`}${m.court ? `<span class="t">· ${esc(m.court)}</span>` : ''}</div><div class="r">${!msg && dur ? `<span class="num dur">${esc(dur)}</span>` : ''}${statusLabel(m)}</div></div>
      ${teamRow(m.a, m.b, { won: m.winner === 0, lost: m.winner === 1, serving: on && m.server === 1 && m.status === 'live', live: m.status === 'live', game: m.a?.game })}
      ${teamRow(m.b, m.a, { won: m.winner === 1, lost: m.winner === 0, serving: on && m.server === 2 && m.status === 'live', live: m.status === 'live', game: m.b?.game })}
      ${msg ? `<div class="m-foot"><span class="msg">${esc(msg)}</span><span class="num">${dur ? esc(dur) : ''}</span></div>` : ''}
    </article>`;
  }

  // ---------------------------------------------------------------- schedule helpers
  // Order of play with times; "Followed by" matches inherit an estimate from the court's start.
  function scheduleItems(tid, { atpOnly = true } = {}) {
    const ev = D.events[tid]; if (!ev) return [];
    const out = [];
    for (const day of ev.schedule) for (const c of day.courts) {
      let last = null; let seq = 0;
      for (const m of c.matches) {
        if (m.utc) { last = m.utc; seq = 0; } else seq++;
        if (atpOnly && m.tour && m.tour !== 'ATP') continue;
        out.push({ ...m, tid, court: c.court, day: day.label, date: day.date, estUtc: m.utc || (last ? new Date(new Date(last).getTime() + seq * 95 * 60e3).toISOString() : null), seq });
      }
    }
    return out;
  }
  function schedCard(m) {
    const fav = teamHasFav(m.a) || teamHasFav(m.b);
    const when = m.utc ? `${fmtTime(m.utc)}<small>${m.suffix === 'Not Before' ? 'Not before' : 'Starts'}</small>` : `<span style="font-size:13px">Next</span><small>${m.estUtc ? '≈ ' + fmtTime(m.estUtc) : 'Followed by'}</small>`;
    const side = (t) => (t.players.length ? t.players.map((p) => `${flag(p.country)}<span class="nm clickable" data-player="${esc(p.id || '')}">${esc(p.name && p.name.includes('.') ? pname(p).includes('.') ? p.name : shortName(p) : pname(p))}</span>`).join('<span class="muted">/</span>') : '<span class="nm muted">TBD</span>') + (t.seed ? ` <span class="muted" style="font-weight:600;font-size:12px">(${t.seed})</span>` : t.entry ? ` <span class="muted" style="font-weight:600;font-size:12px">(${esc(t.entry)})</span>` : '');
    const done = /defeat/i.test(m.status);
    return `<div class="sched ${fav ? 'fav' : ''}"><div class="time num">${when}</div><div class="vs">
      <div class="line">${side(m.a)}</div><div class="line">${side(m.b)}</div>
      <div class="res">${esc(m.round || '')}${done ? ` · ${esc(m.a.players.map(shortName).join('/'))} won ${esc(formatScore(m.score))}` : m.score ? ' · ' + esc(formatScore(m.score)) : ''}</div></div></div>`;
  }
  const formatScore = (s) => (s || '').split(' ').map((x) => (/^\d\d+$/.test(x) ? x[0] + '-' + x.slice(1) : x)).join(' ');

  // ---------------------------------------------------------------- ESPN (free, readable from any phone)
  // ESPN's public tennis scoreboard returns every match of a tournament, any season, for a date in its week.
  // Baseline uses it for completed events' results, last year's edition of upcoming events, career numbers,
  // and to keep results, order of play and draws moving when the computer that refreshes the ATP data is off.
  const ESPN_ROOT = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
  const ESPN = ESPN_ROOT + '/atp';
  const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp';
  const kv = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res) => { try { const r = indexedDB.open('baseline-espn', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }));
    const op = async (mode, fn) => { const d = await open(); if (!d) return null; return new Promise((res) => { try { const q = fn(d.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); } catch (e) { res(null); } }); };
    return { get: (k) => op('readonly', (s) => s.get(k)), set: (k, v) => op('readwrite', (s) => s.put(v, k)) };
  })();
  const espnMem = new Map();
  async function espnJson(url, maxAge, shrink = (j) => j) {
    const hit = espnMem.get(url) || await kv.get(url);
    if (hit && Date.now() - hit.t < maxAge) { espnMem.set(url, hit); return hit.v; }
    try {
      const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!r.ok) throw new Error('ESPN ' + r.status);
      const rec = { t: Date.now(), v: shrink(await r.json()) };
      // fast-changing feeds (live scores) are kept in memory; the offline copy on the phone is refreshed every 2 minutes
      const prevRec = espnMem.get(url); espnMem.set(url, rec);
      if (maxAge >= 60e3 || !prevRec || !prevRec.saved || rec.t - prevRec.saved > 120e3) { rec.saved = rec.t; kv.set(url, rec); } else rec.saved = prevRec.saved;
      return rec.v;
    } catch (e) { if (hit) return hit.v; throw e; }
  }
  const normName = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  const nameKeys = (s) => { const n = normName(s); return [n.replace(/ /g, ''), n.split(' ').sort().join('')]; };
  // ESPN names → ATP player ids (exact name, or the same words in another order, e.g. "Wu Yibing" / "Yibing Wu")
  let idIdx = null, idIdxFor = null;
  function atpId(name, data = D) {
    if (idIdxFor !== data) {
      const D = data; idIdx = new Map(); idIdxFor = data;
      const add = (p) => { if (p && p.id && p.name && !p.name.includes('.')) for (const k of nameKeys(p.name)) if (!idIdx.has(k)) idIdx.set(k, p.id); };
      Object.values(D.players || {}).forEach(add);
      Object.values(D.rankings || {}).forEach((R) => (R.rows || []).forEach((r) => r.players.forEach(add)));
    }
    for (const k of nameKeys(name)) if (idIdx.has(k)) return idIdx.get(k);
    return null;
  }
  const espnEids = new Map(); // ATP id → ESPN athlete id, learnt from ESPN's rankings and matches

  // A week of ESPN's scoreboard, cut down to the men's events and what Baseline shows.
  const shrinkWeek = (j) => shrinkWeekFor(j, 'mens');
  function shrinkWeekFor(j, who) {
    return (j.events || []).map((e) => {
      const matches = [];
      for (const g of e.groupings || []) {
        const slug = g.grouping && g.grouping.slug; if (slug !== who + '-singles' && slug !== who + '-doubles') continue;
        for (const c of g.competitions || []) {
          const note = (c.notes && c.notes[0] && c.notes[0].text) || '';
          const side = (x) => {
            if (!x) return null;
            const ath = x.athlete ? [x.athlete] : ((x.roster && x.roster.athletes) || []);
            const ids = String(x.id || '').split('-');
            return {
              players: ath.map((a, i) => ({ eid: a.id || (x.athlete ? x.id : ids[i]) || null, name: a.displayName || a.fullName || 'TBD', country: (((a.flag && a.flag.href) || '').match(/countries\/\d+\/(\w+)\./) || [])[1]?.toUpperCase() || null })),
              sets: (x.linescores || []).map((l) => ({ g: l.value == null ? null : Math.round(l.value), tb: l.tiebreak ?? null })),
              won: !!x.winner, crank: (x.curatedRank && x.curatedRank.current) || null,
              seed: (() => { const n = ath[0] && ath[0].displayName; if (!n || !note) return null; const m = note.match(new RegExp('\\((\\d+|WC|Q|LL|PR|SE|Alt)\\)\\s+' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); return m ? (/^\d+$/.test(m[1]) ? +m[1] : null) : null; })(),
              entry: (() => { const n = ath[0] && ath[0].displayName; if (!n || !note) return null; const m = note.match(new RegExp('\\((WC|Q|LL|PR|SE|Alt)\\)\\s+' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); return m ? m[1] : null; })(),
            };
          };
          const cs = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
          matches.push({ id: c.id, dbl: slug === who + '-doubles', round: (c.round && c.round.displayName) || '', utc: c.date, timed: !!c.timeValid,
            state: c.status && c.status.type && c.status.type.state, status: c.status && c.status.type && c.status.type.name,
            court: (c.venue && c.venue.court) || '', note, a: side(cs[0]), b: side(cs[1]) });
        }
      }
      const v = e.venue || {};
      return { id: e.id, name: e.name, start: e.date, end: e.endDate, where: v.displayName || v.fullName || '', matches };
    }).filter((e) => e.matches.length);
  }
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const espnWeek = (date, maxAge, tour = 'atp') => espnJson(`${ESPN_ROOT}/${tour}/scoreboard?dates=${ymd(date)}`, maxAge, (j) => shrinkWeekFor(j, tour === 'wta' ? 'womens' : 'mens'));
  const espnNow = () => espnJson(`${ESPN}/scoreboard`, 2 * 60e3, shrinkWeek);
  // Which ESPN event is this ATP tournament? Same city (or the same name), weeks overlapping.
  function espnMatch(t, events) {
    const city = normName((t.city || '').split(/[-/]/)[0]).replace(/ /g, '');
    const nm = normName(t.name).replace(/ /g, '').replace(/^(nitto|bnp|the)/, '');
    let best = null, bestScore = 0;
    for (const e of events) {
      const where = normName(e.where + ' ' + e.name).replace(/ /g, '');
      const s = (city.length > 2 && where.includes(city) ? 2 : 0) + (nm.length > 5 && normName(e.name).replace(/ /g, '').includes(nm.slice(0, 9)) ? 1 : 0);
      if (s > bestScore) { best = e; bestScore = s; }
    }
    return best;
  }
  // Round names in ATP's words, in playing order.
  function espnRounds(ev, dbl) {
    const ms = ev.matches.filter((m) => m.dbl === dbl);
    const r1 = ms.filter((m) => m.round === 'Round 1').length;
    const hasQ2 = ms.some((m) => m.round === 'Qualifying 2nd Round');
    const name = (r) => {
      const k = (r.match(/^Round (\d)$/) || [])[1];
      if (k && r1) { const n = (r1 * 2) >> (k - 1); return n > 8 ? `Round of ${n}` : n === 8 ? 'Quarter-Finals' : `Round ${k}`; }
      return { Quarterfinal: 'Quarter-Finals', Semifinal: 'Semi-Finals', 'Group Stage': 'Round Robin', 'Qualifying 1st Round': '1st Round Qualifying', 'Qualifying 2nd Round': '2nd Round Qualifying', 'Qualifying Final': hasQ2 ? '3rd Round Qualifying' : '2nd Round Qualifying' }[r] || r;
    };
    const order = (r) => (/Qualifying/.test(r) ? 0 : r === 'Round Robin' ? 1 : /Round of (\d+)/.test(r) ? 1000 - +r.match(/\d+/)[0] : /^Round \d/.test(r) ? 500 + +r.match(/\d/)[0] : { 'Quarter-Finals': 2000, 'Semi-Finals': 3000, Final: 4000 }[r] || 1500) + (/(\d)(st|nd|rd) Round Q/.test(r) ? +r.match(/\d/)[0] : 0);
    return { name, order };
  }
  // ESPN match → the app's match shape (results, draws and match cards all use it)
  function espnTeam(s) {
    if (!s) return null;
    return { players: s.players.map((p) => { const id = atpId(p.name); if (id && p.eid && !espnEids.has(id) && !s.players[1]) espnEids.set(id, p.eid); return { id, name: p.name, country: p.country, img: !id && p.eid && !s.players[1] ? `https://a.espncdn.com/i/headshots/tennis/players/full/${p.eid}.png` : null }; }),
      seed: s.seed || (s.entry ? null : s.crank), entry: s.entry, sets: s.sets.filter((x) => x.g != null), won: s.won };
  }
  function fromEspn(m, tid, roundName) {
    const a = espnTeam(m.a), b = espnTeam(m.b);
    const ret = /\bret\b|retired|walkover|w\/o/i.test(m.note) || /RETIRED|WALKOVER/.test(m.status || '');
    return { tid, id: 'e' + m.id, round: roundName, court: m.court, status: m.state === 'post' ? 'finished' : m.state === 'in' ? 'live' : 'scheduled', a, b,
      winner: a && a.won ? 0 : b && b.won ? 1 : null, message: ret ? (/w\/o|walkover/i.test(m.note + m.status) ? 'Walkover' : 'Retired') : '', utc: m.utc };
  }
  // Results for an ATP tournament in a given year, straight from ESPN (cached on the phone; finished weeks never change).
  // The WTA has no match data for a few small events; ESPN's WTA scoreboard often does.
  async function espnWtaFallback(t, year) {
    try {
      const shift = (Number(t.start.slice(0, 4)) - year) * 364 * 864e5;
      const base = dateFrom(t.start).getTime() - shift + 2 * 864e5;
      for (const off of [0, -7, 7]) {
        const ev = espnMatch(t, await espnWeek(new Date(base + off * 864e5), 30 * 864e5, 'wta'));
        if (ev && ev.matches.some((m) => m.state === 'post')) return { ev };
        if (!shift) break;
      }
    } catch (e) { /* fall through */ }
    return { error: `Neither the WTA nor ESPN has ${year} results for this event.` };
  }
  async function loadEspnEvent(t, year) {
    const key = (D.tour || 'atp') + t.id + ':' + year;
    if (S.espn[key] && !S.espn[key].error) return;
    S.espn[key] = { loading: true };
    if (D.tour === 'wta') {
      try { const list = await loadWtaPast(t, year, dateFrom(t.end || t.start).getTime() + (Number(t.start.slice(0, 4)) - year) * 365 * 864e5 + 3 * 864e5 < Date.now()); S.espn[key] = list.length ? { wta: list } : await espnWtaFallback(t, year); }
      catch (e) { S.espn[key] = { error: 'Couldn’t load the results. Check your connection and try again.' }; }
      refresh(); return;
    }
    try {
      const shift = (Number(t.start.slice(0, 4)) - year) * 364 * 864e5;
      const base = dateFrom(t.start).getTime() - shift + 2 * 864e5;
      const done = base + 12 * 864e5 < Date.now();
      let ev = null;
      for (const off of [0, -7, 7, -14, 14]) {
        const week = await espnWeek(new Date(base + off * 864e5), done ? 3650 * 864e5 : 5 * 60e3);
        ev = espnMatch(t, week); if (ev) break;
        if (Number(t.start.slice(0, 4)) === year) break; // this year's dates are exact
      }
      S.espn[key] = ev ? { ev } : { error: 'ESPN doesn’t have this event.' };
    } catch (e) { S.espn[key] = { error: 'Couldn’t reach ESPN. Check your connection and try again.' }; }
    refresh();
  }
  function espnResultsView(t, year) {
    const E = S.espn[(D.tour || 'atp') + t.id + ':' + year];
    if (!E) { setTimeout(() => loadEspnEvent(t, year), 0); return '<div class="empty">Loading results…</div>'; }
    if (E.loading) return '<div class="empty">Loading results…</div>';
    if (E.error) return `<div class="empty">${esc(E.error)}</div>`;
    const dbl = S.resType === 'dbl';
    if (E.wta) return pastView(t, year, E.wta.filter((x) => x.doubles === dbl).map((x) => ({ tid: t.id, id: x.id, round: x.round, court: x.court, status: 'finished', a: x.a, b: x.b, winner: x.winner, message: x.notes, utc: x.utc })), 'Results from the WTA.');
    const { name, order } = espnRounds(E.ev, dbl);
    const ms = E.ev.matches.filter((m) => m.dbl === dbl && m.a && m.b);
    const rounds = [...new Set(ms.map((m) => name(m.round)))].sort((a, b) => order(a) - order(b));
    const fin = ms.find((m) => m.round === 'Final' && m.state === 'post');
    const champ = fin ? fromEspn(fin, t.id, 'Final') : null;
    let rd = S.pastRound && rounds.includes(S.pastRound) ? S.pastRound : (rounds.includes('Final') ? 'Final' : rounds[rounds.length - 1]);
    const list = ms.filter((m) => name(m.round) === rd).map((m) => fromEspn(m, t.id, rd)).sort((a, b) => (a.utc > b.utc) - (a.utc < b.utc));
    const win = champ && champ.winner != null ? (champ.winner === 0 ? champ.a : champ.b) : null;
    const lose = champ && champ.winner != null ? (champ.winner === 0 ? champ.b : champ.a) : null;
    return `<div class="seg">${[['sgl', 'Singles'], ['dbl', 'Doubles']].map(([k, l]) => `<button data-restype="${k}" class="${S.resType === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${win ? `<button class="list fav-card champ" data-player="${esc(win.players[0].id || '')}">${win.players.length === 1 ? avatar(win.players[0]) : ''}<div><b>${win.players.map((p) => `${flag(p.country)} ${esc(win.players.length > 1 ? shortName(p) : pname(p))}`).join(' / ')}</b><div class="st">Beat ${esc(lose.players.map((p) => shortName(p)).join(' / '))} ${esc((win === champ.a ? champ.a.sets.map((s, i) => `${s.g}-${champ.b.sets[i]?.g ?? ''}`) : champ.b.sets.map((s, i) => `${s.g}-${champ.a.sets[i]?.g ?? ''}`)).join(' '))}</div></div><span class="crown">${year} champion</span></button>` : ''}
      ${rounds.length ? `<label class="pick"><span>Round</span><select class="select" id="roundsel">${rounds.map((r) => `<option value="${esc(r)}" ${r === rd ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
      ${list.length ? list.map((m) => matchCard(m, { showEvent: false })).join('') : '<div class="empty">No matches in this round.</div>'}
      <p class="note" style="text-align:center">Results from ESPN.</p>`;
  }

  function pastView(t, year, list) {
    const order = espnRounds({ matches: [] }, false).order;
    const rounds = [...new Set(list.map((m) => m.round))].sort((a, b) => order(a) - order(b));
    const champ = list.find((m) => m.round === 'Final' && m.winner != null) || null;
    const rd = S.pastRound && rounds.includes(S.pastRound) ? S.pastRound : (rounds.includes('Final') ? 'Final' : rounds[rounds.length - 1]);
    const shown = list.filter((m) => m.round === rd).sort((a, b) => (a.utc > b.utc) - (a.utc < b.utc));
    const win = champ ? (champ.winner === 0 ? champ.a : champ.b) : null, lose = champ ? (champ.winner === 0 ? champ.b : champ.a) : null;
    return `<div class="seg">${[['sgl', 'Singles'], ['dbl', 'Doubles']].map(([k, l]) => `<button data-restype="${k}" class="${S.resType === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${win ? `<button class="list fav-card champ" data-player="${esc(win.players[0].id || '')}">${win.players.length === 1 ? avatar(win.players[0]) : ''}<div><b>${win.players.map((p) => `${flag(p.country)} ${esc(win.players.length > 1 ? shortName(p) : pname(p))}`).join(' / ')}</b><div class="st">Beat ${esc(lose.players.map((p) => shortName(p)).join(' / '))} ${esc(champ.message === 'Walkover' ? 'by walkover' : win.sets.map((x, i) => `${x.g}-${lose.sets[i]?.g ?? ''}`).join(' '))}${champ.message === 'Retired' ? ' (retired)' : ''}</div></div><span class="crown">${year} champion</span></button>` : ''}
      ${rounds.length ? `<label class="pick"><span>Round</span><select class="select" id="roundsel">${rounds.map((r) => `<option value="${esc(r)}" ${r === rd ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}
      ${shown.length ? shown.map((m) => matchCard(m, { showEvent: false })).join('') : '<div class="empty">No matches in this round.</div>'}
      <p class="note" style="text-align:center">Results from the WTA.</p>`;
  }

  // When the computer's ATP data is old (computer off), fill this week's results, order of play and draws from ESPN.
  async function espnRefresh() { const save = D; D = DA; try { return await espnRefreshA(); } finally { if (D === DA) D = save; } }
  async function espnRefreshA() {
    const A = DA;
    if (!A || !A.dataAt || Date.now() - new Date(D.dataAt) < 90 * 60e3) return false;
    const today = new Date().toISOString().slice(0, 10);
    const ts = D.tournaments.filter((t) => ['250', '500', '1000', 'GS', 'WC', 'XXI'].includes(t.type) && t.start && t.start <= today && t.end >= new Date(Date.now() - 864e5).toISOString().slice(0, 10));
    if (!ts.length) return false;
    let week; try { week = await espnNow(); } catch (e) { return false; }
    D = A; // the rest runs in one go against the ATP data
    let used = false;
    for (const t of ts) {
      const ev = espnMatch(t, week); if (!ev) continue;
      const E = D.events[t.id] || (D.events[t.id] = { results: [], resultsDbl: [], schedule: [], draws: null, drawsDbl: null, groups: [] });
      for (const dbl of [false, true]) {
        const { name } = espnRounds(ev, dbl);
        const done = ev.matches.filter((m) => m.dbl === dbl && m.state === 'post' && m.a && m.b && !/Qualifying/.test(m.round));
        const byDay = {};
        for (const m of done) { const k = new Date(m.utc).toLocaleDateString('en-CA', { timeZone: tz() }); (byDay[k] ||= []).push(m); }
        const days = Object.keys(byDay).sort().reverse().map((k) => ({ date: dateFrom(k).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), day: '', iso: k,
          matches: byDay[k].sort((a, b) => (b.utc > a.utc) - (b.utc < a.utc)).map((m) => { const x = fromEspn(m, t.id, name(m.round)); return { id: x.id, round: x.round, court: x.court, a: x.a, b: x.b, notes: x.message }; }) }));
        const have = (dbl ? E.resultsDbl : E.results) || [];
        if (days.reduce((n, d) => n + d.matches.length, 0) >= have.reduce((n, d) => n + d.matches.length, 0)) { E[dbl ? 'resultsDbl' : 'results'] = days; used = true; }
        // move this week's draw on: fill in finished matches and send winners through
        const dr = dbl ? E.drawsDbl : E.draws;
        if (dr && dr.rounds) {
          const key = (tm) => (tm && tm.players || []).map((p) => p.id || normName(p.name)).sort().join('|');
          const fin = new Map(); for (const m of done) { const x = fromEspn(m, t.id, ''); fin.set([key(x.a), key(x.b)].sort().join('#'), x); }
          dr.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
            if (m.winner != null || !m.a?.players?.[0]?.id || !m.b?.players?.[0]?.id) return;
            const x = fin.get([key(m.a), key(m.b)].sort().join('#')); if (!x) return;
            const flip = key(x.a) !== key(m.a);
            m.a = { ...m.a, sets: (flip ? x.b : x.a).sets, won: (flip ? x.b : x.a).won }; m.b = { ...m.b, sets: (flip ? x.a : x.b).sets, won: (flip ? x.a : x.b).won };
            m.winner = m.a.won ? 0 : m.b.won ? 1 : null; used = true;
            const next = dr.rounds[ri + 1] && dr.rounds[ri + 1].matches[mi >> 1];
            if (next && m.winner != null) { const w = m.winner === 0 ? m.a : m.b; const slot = mi % 2 ? 'b' : 'a'; if (!next[slot]?.players?.[0]?.id) next[slot] = { players: w.players, seed: w.seed, entry: w.entry, sets: [], won: false }; }
          }));
        }
      }
      // order of play: matches with a court or a start time that haven't started
      const up = ev.matches.filter((m) => m.state === 'pre' && m.a && m.b && (m.timed || m.court) && new Date(m.utc) > Date.now() - 6 * 3600e3);
      if (up.length) {
        const byDay = {};
        for (const m of up.sort((a, b) => (a.utc > b.utc) - (a.utc < b.utc))) { const k = new Date(m.utc).toLocaleDateString('en-CA', { timeZone: tz() }); ((byDay[k] ||= {})[m.court || 'Court to be confirmed'] ||= []).push(m); }
        E.schedule = Object.keys(byDay).sort().map((k) => ({ date: k, label: dateFrom(k).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
          courts: Object.entries(byDay[k]).map(([court, ms]) => ({ court, matches: ms.map((m) => { const x = fromEspn(m, t.id, espnRounds(ev, m.dbl).name(m.round)); return { utc: m.timed ? m.utc : null, suffix: 'Starts At', display: '', round: x.round, tour: 'ATP', status: 'Vs', score: null, a: x.a, b: x.b }; }) })) }));
        used = true;
      }
    }
    if (used) D.espnAt = new Date().toISOString();
    return used;
  }

  // Career numbers for the player sheet (ESPN; players in ESPN's top 150 or seen in its results)
  async function espnCareer(id) {
    if (!espnEids.has(id)) {
      const tour = /^W\d/.test(id) ? 'wta' : 'atp'; const data = dataFor(id);
      try { const rk = await espnJson(`${ESPN_ROOT}/${tour}/rankings`, 12 * 3600e3, (j) => ((j.rankings && j.rankings[0] && j.rankings[0].ranks) || []).map((r) => ({ eid: r.athlete && r.athlete.id, name: r.athlete && r.athlete.displayName }))); rk.forEach((r) => { const a = atpId(r.name, data); if (a && r.eid && !espnEids.has(a)) espnEids.set(a, r.eid); }); } catch (e) { return null; }
    }
    const eid = espnEids.get(id); if (!eid) return null;
    return espnJson(`${ESPN_CORE.replace('/atp', /^W\d/.test(id) ? '/wta' : '/atp')}/athletes/${eid}/statistics`, 24 * 3600e3, (j) => { const o = {}; ((j.splits && j.splits.categories) || []).forEach((c) => (c.stats || []).forEach((s) => { o[s.name] = s.value; })); return o; });
  }

  // ---------------------------------------------------------------- WTA
  // The WTA's data service (calendar, rankings, and each tournament's matches: live scores, results, order of play and
  // the draw) only answers its own website in a browser, so the app reads it through the Baseline alerts service
  // (worker/, /wta/...), which passes it on untouched. News, career numbers and player photos come from ESPN.
  // Everything here runs on the phone; the computer isn't involved.
  const SERVICE = () => window.BASELINE_ALERTS || 'https://baseline-alerts.jdonnelly84.workers.dev';
  const isW = (id) => /^W\d/.test(id || '');
  const titleCase = (s) => (s || '').toLowerCase().replace(/(^|[\s\-+/'(.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  function wtaTournament(t) {
    const g = t.tournamentGroup || {};
    const type = /UNITED CUP/i.test(g.name || '') ? 'UC' : /BILLIE|BJK/i.test((g.name || '') + t.title) ? 'BJK'
      : ({ 'Grand Slam': 'GS', 'WTA 1000': '1000', 'WTA 500': '500', 'WTA 250': '250', 'WTA 125': '125', Finals: 'WC' }[t.level] || t.level || '');
    const name = (t.title || '').split(' - ')[0].trim() || titleCase(g.name);
    const city = titleCase((t.city || '').replace(/\s*\+\s*/g, '-').split(',')[0]);
    const slug = (g.name || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    return { id: String(g.id), year: t.year, name, city, country: t.country, location: [city, t.country].filter(Boolean).join(', '), type, typeLabel: t.level,
      start: t.startDate, end: t.endDate, surface: t.surface || '', inOut: t.inOutdoor === 'I' ? 'Indoor' : 'Outdoor', sgl: t.singlesDrawSize || null, dbl: t.doublesDrawSize || null,
      prize: t.prizeMoney ? (t.prizeMoneyCurrency === 'USD' || !t.prizeMoneyCurrency ? '$' : t.prizeMoneyCurrency + ' ') + Number(t.prizeMoney).toLocaleString('en-US') : '',
      flag: t.country, site: `https://www.wtatennis.com/tournaments/${g.id}/${slug}/${t.year}` };
  }
  const wtaEntry = (e) => (e ? ({ Wc: 'WC', WC: 'WC', Q: 'Q', LL: 'LL', PR: 'PR', SE: 'SE', Alt: 'Alt', ALT: 'Alt' }[e] || e) : null);
  function wtaTeam(m, s) {
    const players = ['', '2'].map((k) => ({ id: m['PlayerID' + s + k] ? 'W' + m['PlayerID' + s + k] : null, name: [m['PlayerNameFirst' + s + k], m['PlayerNameLast' + s + k]].filter(Boolean).join(' '), country: m['PlayerCountry' + s + k] || null }))
      .filter((p) => p.id || p.name);
    return { players, seed: m['Seed' + s] && /^\d+$/.test(m['Seed' + s]) ? +m['Seed' + s] : null, entry: wtaEntry(m['EntryType' + s]) };
  }
  function wtaSets(m) {
    const A = [], B = [];
    for (let i = 1; i <= 5; i++) {
      const a = m['ScoreSet' + i + 'A'], b = m['ScoreSet' + i + 'B'];
      if (a === '' || a == null || b === '' || b == null) break;
      const ga = +a, gb = +b, tb = m['ScoreTbSet' + i] !== '' && m['ScoreTbSet' + i] != null ? +m['ScoreTbSet' + i] : null;
      A.push({ g: ga, tb: tb != null && ga < gb ? tb : null }); B.push({ g: gb, tb: tb != null && gb < ga ? tb : null });
    }
    return [A, B];
  }
  const wtaWinner = (m) => ({ 2: 0, 4: 0, 6: 0, 3: 1, 5: 1, 7: 1 }[m.Winner] ?? null); // 4/5: won by retirement, 6/7: by walkover
  const wtaNum = (m) => parseInt(String(m.MatchID || '').slice(2), 10) || 0;
  const wtaMain = (m) => m.DrawLevelType !== 'Q' && /^L/.test(m.MatchID || '');
  function wtaRound(m) {
    if (!wtaMain(m)) { const r = String(m.RoundID || ''); return /^\d$/.test(r) ? `${r}${['st', 'nd', 'rd'][+r - 1] || 'th'} Round Qualifying` : 'Qualifying'; }
    const L = Math.floor(Math.log2(wtaNum(m) || 1));
    return L === 0 ? 'Final' : L === 1 ? 'Semi-Finals' : L === 2 ? 'Quarter-Finals' : `Round of ${2 ** (L + 1)}`;
  }
  // a WTA match in the app's match shape
  function wtaMatch(m) {
    const a = wtaTeam(m, 'A'), b = wtaTeam(m, 'B'); const [sa, sb] = wtaSets(m); a.sets = sa; b.sets = sb;
    const w = wtaWinner(m); a.won = w === 0; b.won = w === 1;
    const state = m.MatchState === 'F' ? 'finished' : m.MatchState === 'P' ? 'live' : m.MatchState === 'U' ? 'scheduled' : sa.length ? 'suspended' : 'scheduled';
    return { id: m.MatchID, round: wtaRound(m), court: m.CourtName || '', doubles: m.DrawMatchType === 'D', state, a, b, winner: w,
      duration: m.MatchTimeTotal || '', notes: /^[45]$/.test(m.Winner) ? 'Retired' : /^[67]$/.test(m.Winner) ? 'Walkover' : '', game: [m.PointA, m.PointB], serve: m.Serve, utc: m.MatchTimeStamp || null, raw: m };
  }
  // The draw: WTA numbers main-draw matches like a family tree (the final is 1, its two semis 2 and 3, match n is fed
  // by 2n and 2n+1), so the bracket order, byes and each player's path come straight from the numbers.
  // Works down from the latest round: each match's two players came from the matches they won in the round before.
  // Exact for finished draws; while a draw is under way the later rounds aren't known yet, so it's marked `loose`
  // (rounds are shown, and paths only list opponents that are certain).
  function traceDraw(list, dbl) {
    const ms = list.filter((x) => wtaMain(x.raw) && x.doubles === dbl && x.size && x.round !== 'Round Robin');
    if (!ms.length) return null;
    const bySize = new Map(); ms.forEach((x) => { if (!bySize.has(x.size)) bySize.set(x.size, []); bySize.get(x.size).push(x); });
    const sizes = [...bySize.keys()].sort((a, b) => a - b);
    const key = (tm) => ((tm && tm.players) || []).map((p) => p.id || p.name).sort().join('|');
    const byId = (a, b) => wtaNum(a.raw) - wtaNum(b.raw);
    let loose = sizes[0] !== 2;
    const levels = [bySize.get(sizes[0]).slice().sort(byId)];
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i] !== sizes[i - 1] * 2) loose = true;
      const pool = bySize.get(sizes[i]); const used = new Set(); const next = [];
      const from = (tm) => { const k = key(tm); if (!k) return null; const c = pool.find((x) => !used.has(x) && (key(x.a) === k || key(x.b) === k)); if (c) used.add(c); return c || null; };
      for (const m of levels[levels.length - 1]) next.push(m ? from(m.a) : null, m ? from(m.b) : null);
      const rest = pool.filter((x) => !used.has(x)).sort(byId);
      if (rest.length) { loose = true; next.push(...rest); }
      levels.push(next);
    }
    const tba = () => ({ players: [], seed: null, entry: null, sets: [], won: false });
    const rounds = levels.reverse().map((row, i) => {
      const size = sizes[sizes.length - 1 - i];
      return { name: size === 2 ? 'Final' : size === 4 ? 'Semi-Finals' : size === 8 ? 'Quarter-Finals' : `Round of ${size}`,
        matches: row.filter((x) => x || !loose).map((x) => (x ? { a: x.a, b: x.b, winner: x.winner, id: x.id } : { a: tba(), b: tba(), winner: null, id: null })) };
    });
    return { rounds, loose };
  }
  function wtaDraw(list, dbl, finals = false) {
    const by = new Map();
    list.forEach((x) => { if (wtaMain(x.raw) && x.doubles === dbl && (!finals || wtaNum(x.raw) < 4)) by.set(wtaNum(x.raw), x); });
    if (!by.size) return null;
    const levels = Math.floor(Math.log2(Math.max(...by.keys()))) + 1;
    if (levels > 8) return traceDraw(list, dbl); // more than a 256 draw: not draw numbering
    const tba = () => ({ players: [], seed: null, entry: null, sets: [], won: false });
    const bye = () => ({ players: [{ id: null, name: 'Bye', country: null }], seed: null, entry: null, sets: [], won: false });
    const winnerOf = (x) => (x && x.winner != null ? (x.winner === 0 ? x.a : x.b) : null);
    const node = new Map(); const rounds = [];
    for (let L = levels - 1; L >= 0; L--) {
      const matches = [];
      for (let i = 0; i < 1 << L; i++) {
        const n = (1 << L) + i; const x = by.get(n);
        let out;
        if (x) out = { a: x.a, b: x.b, winner: x.winner, id: x.id };
        else if (L === levels - 1) {
          // no first-round match here: a bye. The player shows up in the next round, on the side the sibling didn't fill.
          const parent = by.get(n >> 1); const sib = by.get(n ^ 1);
          const key = (t) => (t && t.players || []).map((p) => p.id).join();
          let p = null;
          if (parent) { const sw = winnerOf(sib); p = [parent.a, parent.b].find((t) => t && t.players.length && (!sw || key(t) !== key(sw))) || null; }
          out = { a: p ? { ...p, sets: [], won: true } : tba(), b: bye(), winner: p ? 0 : null, id: null };
        } else {
          const ca = node.get(2 * n), cb = node.get(2 * n + 1);
          const wa = winnerOf(ca), wb = winnerOf(cb);
          out = { a: wa && wa.players[0]?.name !== 'Bye' ? { ...wa, sets: [], won: false } : tba(), b: wb && wb.players[0]?.name !== 'Bye' ? { ...wb, sets: [], won: false } : tba(), winner: null, id: null };
        }
        node.set(n, out); matches.push(out);
      }
      rounds.push({ name: L === 0 ? 'Final' : L === 1 ? 'Semi-Finals' : L === 2 ? 'Quarter-Finals' : `Round of ${2 ** (L + 1)}`, matches });
    }
    return { rounds };
  }
  const isoDayIn = (utc) => new Date(utc).toLocaleDateString('en-CA', { timeZone: tz() });
  const longDay = (iso) => dateFrom(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  // One tournament's matches → results by day, order of play, draws and the live scores
  // Round-robin groups (WTA Finals): players who meet in the group stage form a group; ordered by wins, then sets.
  function wtaGroups(rr, dbl) {
    const key = (tm) => tm.players.map((p) => p.id || p.name).sort().join('|');
    const team = new Map(), link = new Map();
    const find = (k) => { while (link.get(k) !== k) k = link.get(k); return k; };
    for (const x of rr) for (const tm of [x.a, x.b]) { const k = key(tm); if (!team.has(k)) { team.set(k, { players: tm.players, seed: tm.seed, w: 0, l: 0, sw: 0, sl: 0 }); link.set(k, k); } }
    for (const x of rr) {
      const ka = key(x.a), kb = key(x.b); link.set(find(ka), find(kb));
      if (x.winner == null) continue;
      const A = team.get(ka), B = team.get(kb); const [w, l] = x.winner === 0 ? [A, B] : [B, A]; w.w++; l.l++;
      x.a.sets.forEach((st, i) => { const o = x.b.sets[i]; if (!o) return; if (st.g > o.g) { A.sw++; B.sl++; } else if (o.g > st.g) { B.sw++; A.sl++; } });
    }
    const groups = {};
    for (const k of team.keys()) (groups[find(k)] ||= []).push(team.get(k));
    return Object.values(groups).sort((a, b) => Math.min(...a.map((t) => t.seed || 99)) - Math.min(...b.map((t) => t.seed || 99)))
      .map((ts, i) => ({ name: `${dbl ? 'Doubles group' : 'Group'} ${'ABCD'[i] || i + 1}`, doubles: dbl,
        rows: ts.sort((a, b) => b.w - a.w || (b.sw - b.sl) - (a.sw - a.sl) || (a.seed || 99) - (b.seed || 99)).map((t, j) => ({ pos: j + 1, players: t.players, matches: t.w + t.l ? `${t.w}-${t.l}` : null, sets: t.w + t.l ? `${t.sw}-${t.sl}` : null })) }));
  }
  function wtaEvent(t, json) {
    const list = ((json && json.matches) || []).filter((m) => m.MatchID && (m.PlayerNameLastA || m.PlayerIDA)).map(wtaMatch);
    const finals = t.type === 'WC';
    if (finals) list.forEach((x) => { if (wtaMain(x.raw) && wtaNum(x.raw) >= 4) x.round = 'Round Robin'; });
    const numbered = {};
    for (const dbl of [false, true]) {
      const main = list.filter((x) => wtaMain(x.raw) && x.doubles === dbl && x.round !== 'Round Robin');
      const heap = main.length > 0 && main.every((x) => wtaNum(x.raw) > 0 && wtaNum(x.raw) < 256);
      numbered[dbl] = heap;
      const drawSize = dbl ? t.dbl : t.sgl;
      const first = drawSize ? 2 ** Math.ceil(Math.log2(drawSize)) : 0;
      const played = main.filter((x) => x.raw.MatchState !== 'U' && /^\d+$/.test(String(x.raw.RoundID)));
      const most = played.length ? Math.max(...played.map((x) => +x.raw.RoundID)) : 0;
      for (const x of main) {
        let size = null;
        if (heap) size = 2 ** (Math.floor(Math.log2(wtaNum(x.raw))) + 1);
        else {
          const r = String(x.raw.RoundID);
          if (r === 'F') size = 2; else if (r === 'S') size = 4; else if (r === 'Q') size = 8;
          else if (/^\d+$/.test(r)) size = x.raw.MatchState === 'U' ? 2 ** +r : first ? first >> (+r - 1) : 2 ** (most - +r + 4);
        }
        if (size && size >= 2 && size <= 256) { x.size = size; x.round = size === 2 ? 'Final' : size === 4 ? 'Semi-Finals' : size === 8 ? 'Quarter-Finals' : `Round of ${size}`; }
      }
    }
    const results = (dbl) => {
      const byDay = {};
      list.filter((x) => x.doubles === dbl && x.state === 'finished').forEach((x) => { const k = x.utc ? isoDayIn(x.utc) : '0'; (byDay[k] ||= []).push(x); });
      return Object.keys(byDay).sort().reverse().map((k) => ({ date: k === '0' ? '' : longDay(k), day: '', iso: k,
        matches: byDay[k].sort((p, q) => (q.utc > p.utc) - (q.utc < p.utc)).map((x) => ({ id: x.id, round: x.round, court: x.court, duration: x.duration, a: x.a, b: x.b, notes: x.notes })) }));
    };
    // order of play: the matches still to come, by the tournament's own date and court
    const byDay = {};
    list.filter((x) => x.state === 'scheduled' && x.utc).forEach((x) => {
      const r = x.raw; const k = String(r.MatchTimeStamp).slice(0, 10); const later = /T23:59/.test(r.MatchTimeStamp) || /followed/i.test(r.NotBeforeText || '');
      const court = r.CourtName || 'Court to be confirmed';
      ((byDay[k] ||= {})[court] ||= []).push({ utc: later ? null : new Date(r.MatchTimeStamp).toISOString(), suffix: /not before/i.test(r.NotBeforeText || '') ? 'Not Before' : 'Starts At',
        display: later ? '' : (r.NotBefore || '').replace(/^Starting at /i, 'Starts At ').replace(/^Not before /i, 'Not Before '), round: x.round, status: 'Vs', score: null, a: x.a, b: x.b });
    });
    const schedule = Object.keys(byDay).sort().map((k) => ({ date: k, label: longDay(k), courts: Object.entries(byDay[k]).map(([court, matches]) => ({ court, matches })) }));
    const live = list.filter((x) => x.state === 'live' || x.state === 'suspended').map((x) => ({
      id: x.id, round: x.round, court: x.court, doubles: x.doubles, status: x.state === 'live' ? 'live' : 'suspended', rawStatus: x.raw.MatchState,
      server: x.serve === 'A' ? 1 : x.serve === 'B' ? 2 : null, duration: x.duration, message: '', updated: x.raw.LastUpdated, winner: null, umpire: '',
      a: { ...x.a, game: x.game[0] }, b: { ...x.b, game: x.game[1] } }));
    const rr = finals ? list.filter((x) => x.round === 'Round Robin') : [];
    const groups = finals ? [...wtaGroups(rr.filter((x) => !x.doubles), false), ...wtaGroups(rr.filter((x) => x.doubles), true)] : [];
    return { event: { results: results(false), resultsDbl: results(true), schedule, draws: numbered[false] ? wtaDraw(list, false, finals) : traceDraw(list, false), drawsDbl: numbered[true] ? wtaDraw(list, true, finals) : traceDraw(list, true), groups },
      live: live.length ? { id: t.id, title: t.name, city: t.city, matches: live } : null, list };
  }
  const wtaRows = (arr) => (Array.isArray(arr) ? arr : (arr && arr.content) || []).map((r) => {
    const p = r.player || {}; const dob = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
    return { rank: r.ranking, players: [{ id: 'W' + p.id, name: p.fullName, country: p.countryCode }], age: dob ? String(Math.floor((Date.now() - dob) / 31557600000)) : null,
      points: r.points, pointsMove: null, tourns: r.tournamentsPlayed ?? null, dropping: null, nextBest: null, next: null, max: null, current: null, rankMove: r.movement || null, at: r.rankedAt };
  });
  // WTA ranking points by round reached (main draw), used to estimate the live rankings, as live-ranking sites do:
  // official points + what each player has earned at this week's events − what they earned at the same events last year.
  const WTA_PTS = {
    GS: { W: 2000, F: 1300, SF: 780, QF: 430, R16: 240, R32: 130, R64: 70, R128: 10 },
    M96: { W: 1000, F: 650, SF: 390, QF: 215, R16: 120, R32: 65, R64: 35, R128: 10 },
    M56: { W: 1000, F: 650, SF: 390, QF: 215, R16: 120, R32: 65, R64: 10 },
    P48: { W: 500, F: 325, SF: 195, QF: 108, R16: 60, R32: 32, R64: 1 },
    P28: { W: 500, F: 325, SF: 195, QF: 108, R16: 60, R32: 1 },
    I32: { W: 250, F: 163, SF: 98, QF: 54, R16: 30, R32: 1 },
    C32: { W: 160, F: 95, SF: 57, QF: 29, R16: 15, R32: 1 },
  };
  const WTA_PTS_D = { GS: { W: 2000, F: 1300, SF: 780, QF: 430, R16: 240, R32: 130, R64: 10 }, 1000: { W: 1000, F: 650, SF: 390, QF: 215, R16: 120, R32: 10 }, 500: { W: 500, F: 325, SF: 195, QF: 108, R16: 1 }, 250: { W: 250, F: 163, SF: 98, QF: 54, R16: 1 }, 125: { W: 160, F: 95, SF: 57, QF: 29, R16: 1 } };
  const roundKey = (r) => ({ Final: 'F', 'Semi-Finals': 'SF', 'Quarter-Finals': 'QF' }[r] || ((r || '').match(/Round of (\d+)/) ? 'R' + r.match(/Round of (\d+)/)[1] : null));
  const NEXT_ROUND = { R128: 'R64', R64: 'R32', R32: 'R16', R16: 'QF', QF: 'SF', SF: 'F', F: 'W' };
  const ROUND_WORD = { W: 'champion', F: 'final', SF: 'semis', QF: 'quarters', R16: 'R16', R32: 'R32', R64: 'R64', R128: 'R128' };
  function wtaTable(t, dbl) {
    if (dbl) return WTA_PTS_D[t.type] || null;
    return t.type === 'GS' ? WTA_PTS.GS : t.type === '1000' ? ((t.sgl || 96) > 64 ? WTA_PTS.M96 : WTA_PTS.M56) : t.type === '500' ? ((t.sgl || 28) > 32 ? WTA_PTS.P48 : WTA_PTS.P28)
      : t.type === '250' ? WTA_PTS.I32 : t.type === '125' ? WTA_PTS.C32 : null;
  }
  // Points each player has from one event so far: the round they've reached (a player still in has at least the next round's points).
  function wtaEventPoints(t, list, dbl) {
    const out = new Map();
    if (t.type === 'WC') { // Finals: 200 a group win, 400 for winning the semi, 500 for the final
      for (const x of list) {
        if (x.doubles !== dbl || x.winner == null || !wtaMain(x.raw)) continue;
        const n = wtaNum(x.raw); const pts = n === 1 ? 500 : n < 4 ? 400 : 200;
        (x.winner === 0 ? x.a : x.b).players.forEach((p) => { if (p.id) { const o = out.get(p.id) || { pts: 0, round: 'RR' }; o.pts += pts; if (n === 1) o.round = 'W'; out.set(p.id, o); } });
        (x.winner === 0 ? x.b : x.a).players.forEach((p) => { if (p.id && !out.has(p.id)) out.set(p.id, { pts: 0, round: 'RR', out: n < 4 }); });
      }
      return out;
    }
    const tbl = wtaTable(t, dbl); if (!tbl) return out;
    const best = new Map();
    for (const x of list) {
      if (x.doubles !== dbl || !wtaMain(x.raw) || x.state === 'scheduled') continue;
      const k = roundKey(x.round); if (!k) continue; const lvl = x.size || wtaNum(x.raw);
      [[x.a, 0], [x.b, 1]].forEach(([tm, side]) => tm.players.forEach((p) => { if (!p.id) return; const b = best.get(p.id); if (b && b.lvl <= lvl) return; best.set(p.id, { lvl, k, done: x.winner != null, won: x.winner === side }); }));
    }
    for (const [id, b] of best) { const key = b.done && b.won ? NEXT_ROUND[b.k] : b.k; out.set(id, { pts: tbl[key] ?? 0, round: key, out: b.done && !b.won }); }
    return out;
  }
  function wtaLiveList(R, current, dbl) {
    const base = (R && R.rows) || []; const delta = new Map(), drop = new Map(), note = new Map();
    for (const c of current) {
      const now = wtaEventPoints(c.t, c.list, dbl), before = c.last ? wtaEventPoints(c.t, c.last, dbl) : new Map();
      for (const [id, v] of now) { delta.set(id, (delta.get(id) || 0) + v.pts); note.set(id, v.round === 'W' ? `${c.t.city} champion` : v.out ? `Out in the ${ROUND_WORD[v.round] || 'group'} · ${c.t.city}` : `${c.t.city} · ${ROUND_WORD[v.round] || 'group stage'}`); }
      for (const [id, v] of before) { delta.set(id, (delta.get(id) || 0) - v.pts); drop.set(id, (drop.get(id) || 0) + v.pts); }
    }
    const rows = base.map((r) => { const id = r.players[0].id; const d = delta.get(id) || 0; return { ...r, official: r.points, officialRank: r.rank, points: r.points + d, pointsMove: d || null, current: note.get(id) || null, dropping: drop.get(id) || null }; })
      .sort((a, b) => b.points - a.points || a.officialRank - b.officialRank);
    rows.forEach((r, i) => { r.rank = i + 1; r.rankMove = r.officialRank - r.rank || null; });
    return { asOf: R && R.asOf, rows, estimated: true, drop };
  }
  // Who's likely to play upcoming events, until the WTA publishes the entry list (then the Field tab shows that instead).
  const WTA_DIRECT = { 128: 104, 96: 76, 64: 48, 56: 44, 48: 36, 32: 22, 30: 22, 28: 20 };
  function wtaProjections(upcoming, sgl, race, hist) {
    const out = {}; const ranked = ((sgl && sgl.rows) || []).filter((r) => r.players[0] && r.players[0].id);
    const overlap = (a, b) => a.start <= b.end && b.start <= a.end;
    for (const t of upcoming) {
      if (t.type === 'WC') out[t.id] = { basis: 'The top 8 in the Race to the WTA Finals qualify. Places 9 and 10 are the alternates.', players: ((race && race.rows) || []).slice(0, 10).map((r, i) => ({ id: r.players[0].id, rank: r.rank, points: r.points, status: i < 8 ? 'in' : 'alt' })) };
      else if (t.type === 'GS' || t.type === '1000') { const n = WTA_DIRECT[t.sgl] || 48; out[t.id] = { basis: `Mandatory event for top players. The top ${n} or so get in on ranking.`, cutoff: ranked[n - 1]?.rank, players: ranked.slice(0, n).map((r) => ({ id: r.players[0].id, rank: r.rank, status: 'expected' })) }; }
    }
    const small = upcoming.filter((t) => ['500', '250', '125'].includes(t.type)); const done = new Set();
    for (const t of small) {
      if (done.has(t.id)) continue;
      const group = small.filter((x) => overlap(x, t)); group.forEach((g) => done.add(g.id));
      const busy = new Set(); upcoming.forEach((x) => { if ((x.type === '1000' || x.type === 'GS') && group.some((g) => overlap(g, x)) && out[x.id]) out[x.id].players.forEach((p) => busy.add(p.id)); });
      const slots = Object.fromEntries(group.map((g) => [g.id, WTA_DIRECT[g.sgl] || 22])); const lists = Object.fromEntries(group.map((g) => [g.id, []]));
      const tier = { 500: 0, 250: 1, 125: 2 };
      for (const r of ranked) {
        const id = r.players[0].id; if (busy.has(id)) continue;
        let pick = group.find((g) => hist[g.id] && hist[g.id].has(id) && lists[g.id].length < slots[g.id]); let status = pick ? 'likely' : 'possible';
        if (!pick) {
          const open = group.filter((g) => lists[g.id].length < slots[g.id] && !(g.type === '125' && r.rank <= 60) && !(g.type === '250' && r.rank <= 12));
          if (!open.length) continue;
          open.sort((a, b) => tier[a.type] - tier[b.type] || (slots[b.id] - lists[b.id].length) - (slots[a.id] - lists[a.id].length)); pick = open[0];
        }
        lists[pick.id].push({ id, rank: r.rank, status });
        if (group.every((g) => lists[g.id].length >= slots[g.id])) break;
      }
      for (const g of group) { const others = group.filter((x) => x.id !== g.id).map((x) => x.city); out[g.id] = { basis: `Based on the rankings${others.length ? ` and a split with ${others.join(' and ')} the same week` : ''}. Players who played here last year are marked likely.`, cutoff: lists[g.id][lists[g.id].length - 1]?.rank, players: lists[g.id] }; }
    }
    return out;
  }
  const wtaCurrent = (t) => { const now = Date.now(); return t.start && t.type !== 'UC' && dateFrom(t.start) - now < 1.5 * 864e5 && now - dateFrom(t.end) < 1.5 * 864e5; };
  // Everything the WTA side shows, built on the phone. matchesOnly: just re-read this week's tournaments (live scores).
  async function loadWta(prev, { matchesOnly = false } = {}) {
    const base = SERVICE() + '/wta'; const yr = new Date().getFullYear();
    let W;
    if (matchesOnly && prev) W = { ...prev, events: { ...prev.events }, live: {} };
    else {
      const get = (u, age, fb, shrink) => espnJson(u, age, shrink).catch(() => fb);
      const [pages, s0, s1, d0, d1, newsRaw, r0, r1, rd, last] = await Promise.all([
        Promise.all([0, 1].map((p) => get(`${base}/tournaments?page=${p}&from=${yr}-01-01&to=${yr}-12-31`, 12 * 3600e3, null))),
        get(`${base}/rankings/singles?page=0`, 3 * 3600e3, []), get(`${base}/rankings/singles?page=1`, 3 * 3600e3, []),
        get(`${base}/rankings/doubles?page=0`, 3 * 3600e3, []), get(`${base}/rankings/doubles?page=1`, 3 * 3600e3, []),
        get(`${ESPN_ROOT}/wta/news`, 20 * 60e3, [], (j) => (j.articles || []).map((a) => ({ title: a.headline, url: a.links && a.links.web && a.links.web.href, img: a.images && a.images[0] && a.images[0].url, tag: a.type === 'Media' ? 'Video' : 'News', video: a.type === 'Media', author: a.byline || '' }))),
        get(`${base}/race/singles?page=0`, 3 * 3600e3, []), get(`${base}/race/singles?page=1`, 3 * 3600e3, []), get(`${base}/race/doubles?page=0`, 3 * 3600e3, []),
        Promise.all([0, 1].map((p) => get(`${base}/tournaments?page=${p}&from=${yr - 1}-01-01&to=${yr - 1}-12-31`, 7 * 864e5, null))),
      ]);
      const tournaments = pages.flatMap((p) => (p && p.content) || []).map(wtaTournament).filter((t) => t.start).sort((a, b) => (a.start > b.start) - (a.start < b.start));
      if (!tournaments.length) throw new Error('WTA calendar unavailable');
      const sgl = wtaRows([...(s0 || []), ...(s1 || [])]), dbl = wtaRows([...(d0 || []), ...(d1 || [])]);
      const asOf = (sgl[0] && sgl[0].at || '').slice(0, 10);
      const news = (newsRaw || []).filter((x) => x.url && x.title);
      const players = {};
      const add = (p, k, rank) => { if (!p.id) return; const o = players[p.id] || (players[p.id] = { id: p.id, name: p.name, country: p.country, short: p.name ? p.name.split(' ')[0][0] + '. ' + p.name.split(' ').slice(1).join(' ') : p.name }); if (k) o[k] = rank; };
      sgl.forEach((r) => add(r.players[0], 'rank', r.rank)); dbl.forEach((r) => add(r.players[0], 'dblRank', r.rank));
      // the races to the WTA Finals (singles players, doubles teams)
      const race = wtaRows([...(r0 || []), ...(r1 || [])]);
      const teamRace = (Array.isArray(rd) ? rd : []).map((r) => ({ rank: r.ranking, players: [r.player1, r.player2].filter(Boolean).map((p) => ({ id: 'W' + p.id, name: p.fullName, country: p.countryCode })), points: r.points, tourns: r.tournamentsPlayed ?? null, rankMove: r.movement || null, pointsMove: null }));
      race.forEach((r) => add(r.players[0])); teamRace.forEach((r) => r.players.forEach((p) => add(p)));
      // defending champions: last season's winners
      const champions = {};
      try {
        last.flatMap((x) => (x && x.content) || []).forEach((t) => { const w = (t.winners || []).find((x) => x && x.singles && x.singles.player); const gid = t.tournamentGroup && t.tournamentGroup.id; if (w && gid) { const pl = w.singles.player; champions[String(gid)] = 'W' + pl.id; add({ id: 'W' + pl.id, name: pl.fullName, country: pl.countryCode }); } });
      } catch (e) { /* no champions shown */ }
      W = { source: 'live', tour: 'wta', generatedAt: new Date().toISOString(), tournaments, live: {}, events: {}, players,
        rankings: { sgl: { asOf, rows: sgl }, dbl: { asOf, rows: dbl }, sgl_race: { asOf, rows: race }, dbl_race: { asOf, rows: teamRace } },
        news, projections: {}, champions, lastYear: {}, flagsSvg: (DA && DA.flagsSvg) || '' };
      // projected fields for the next four weeks, using who played each event last year
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = tournaments.filter((t) => t.start > today && dateFrom(t.start) - Date.now() < 28 * 864e5 && ['GS', '1000', '500', '250', '125', 'WC'].includes(t.type));
      const hist = {};
      await Promise.all(upcoming.filter((x) => ['500', '250', '125'].includes(x.type)).map(async (t) => {
        try { const l = await loadWtaPast(t, t.year - 1, true); hist[t.id] = new Set(l.filter((x) => !x.doubles).flatMap((x) => [...x.a.players, ...x.b.players].map((p) => p.id)).filter(Boolean)); W.lastYear[t.id] = [...hist[t.id]]; } catch (e) { /* projection without it */ }
      }));
      W.projections = wtaProjections(upcoming, W.rankings.sgl, W.rankings.sgl_race, hist);
    }
    if (matchesOnly && prev) W.rankings = { ...prev.rankings };
    const current = [];
    const fetched = await Promise.all(W.tournaments.filter(wtaCurrent).map((t) => Promise.all([
      espnJson(`${base}/matches/${t.id}/${t.year}`, 15e3).catch((e) => e), loadWtaPast(t, t.year - 1, true).catch(() => null)]).then(([j, last]) => ({ t, j, last }))));
    for (const { t, j, last } of fetched) {
      try {
        if (j instanceof Error) throw j;
        const { event, live, list } = wtaEvent(t, j);
        if (list.length) W.events[t.id] = event;
        if (live) W.live[t.id] = live;
        current.push({ t, list, last });
        list.forEach((x) => [x.a, x.b].forEach((tm) => tm.players.forEach((p) => { if (p.id && !W.players[p.id]) W.players[p.id] = { id: p.id, name: p.name, country: p.country, short: p.name.split(' ')[0][0] + '. ' + p.name.split(' ').slice(1).join(' ') }; })));
      } catch (e) { /* keep what we had for this event */ if (prev && prev.events[t.id]) W.events[t.id] = prev.events[t.id]; }
    }
    // live rankings (estimated) from this week's results
    if (W.rankings.sgl) {
      const ls = wtaLiveList(W.rankings.sgl, current, false), ld = wtaLiveList(W.rankings.dbl, current, true);
      W.rankings.sgl_live = ls; W.rankings.dbl_live = ld;
      // the official lists show what each player is defending this week
      W.rankings.sgl = { ...W.rankings.sgl, rows: W.rankings.sgl.rows.map((r) => ({ ...r, dropping: ls.drop.get(r.players[0].id) || null })) };
      W.rankings.dbl = { ...W.rankings.dbl, rows: W.rankings.dbl.rows.map((r) => ({ ...r, dropping: ld.drop.get(r.players[0].id) || null })) };
      delete ls.drop; delete ld.drop;
    }
    W.generatedAt = new Date().toISOString();
    if (!matchesOnly) wtaPhotos(W);
    return W;
  }
  // Player photos: ESPN has them, matched by name through ESPN's WTA rankings
  function wtaPhotos(W) {
    espnJson(`${ESPN_ROOT}/wta/rankings`, 12 * 3600e3, (j) => ((j.rankings && j.rankings[0] && j.rankings[0].ranks) || []).map((r) => ({ eid: r.athlete && r.athlete.id, name: r.athlete && r.athlete.displayName })))
      .then((rk) => { rk.forEach((r) => { const id = atpId(r.name, W); if (id && r.eid) espnEids.set(id, r.eid); }); if (S.tour === 'wta') refresh(); }).catch(() => {});
  }
  // Results of a WTA tournament in any year (completed events, and last year's edition of upcoming ones)
  async function loadWtaPast(t, year, done) {
    const j = await espnJson(`${SERVICE()}/wta/matches/${t.id}/${year}`, done ? 30 * 864e5 : 60e3);
    return wtaEvent({ ...t, year }, j).list.filter((x) => x.state === 'finished' || x.state === 'live');
  }

  // ---------------------------------------------------------------- draw path
  // For a player in a knockout draw, list who they could meet in each later round.
  function drawIndex(draw) {
    const alive = new Set(); const out = new Set();
    draw.rounds.forEach((r) => r.matches.forEach((m) => {
      if (m.winner === 0) (m.b?.players || []).forEach((p) => p.id && out.add(p.id));
      if (m.winner === 1) (m.a?.players || []).forEach((p) => p.id && out.add(p.id));
    }));
    return { out, alive };
  }
  function findSlot(draw, pid) {
    const r0 = draw.rounds[0];
    for (let i = 0; i < r0.matches.length; i++) {
      const m = r0.matches[i];
      if ((m.a?.players || []).some((p) => p.id === pid)) return i;
      if ((m.b?.players || []).some((p) => p.id === pid)) return i;
    }
    return -1;
  }
  function entrantsIn(draw, startIdx, count) {
    const r0 = draw.rounds[0]; const list = [];
    for (let i = startIdx; i < startIdx + count && i < r0.matches.length; i++) for (const t of [r0.matches[i].a, r0.matches[i].b]) if (t?.players?.length && t.players[0].id) list.push(t);
    return list;
  }
  function drawPath(draw, pid) {
    if (draw.loose) {
      const has = (tm) => ((tm && tm.players) || []).some((p) => p.id === pid);
      const rounds = []; let lostIn = null;
      for (const r of draw.rounds) {
        const m = r.matches.find((x) => has(x.a) || has(x.b)); if (!m) continue;
        const mine = has(m.a) ? m.a : m.b, opp = mine === m.a ? m.b : m.a;
        if (m.winner != null) { const won = (m.winner === 0 ? m.a : m.b) === mine; rounds.push({ name: r.name, played: true, won, opp: [opp] }); if (!won) { lostIn = r.name; break; } }
        else rounds.push({ name: r.name, played: false, opp: opp && opp.players && opp.players.length ? [opp] : [] });
      }
      return rounds.length ? { rounds: rounds.filter((r) => r.played || r.opp.length), lostIn } : null;
    }
    const slot = findSlot(draw, pid); if (slot < 0) return null;
    const { out } = drawIndex(draw);
    const rounds = [];
    let lostIn = null;
    for (let k = 0; k < draw.rounds.length; k++) {
      const m = draw.rounds[k].matches[slot >> k]; if (!m) break;
      const mine = [m.a, m.b].find((t) => (t?.players || []).some((p) => p.id === pid));
      if (m.winner != null && mine) { const iWon = (m.winner === 0 ? m.a : m.b) === mine; const opp = mine === m.a ? m.b : m.a; rounds.push({ name: draw.rounds[k].name, played: true, won: iWon, opp: [opp] }); if (!iWon) { lostIn = draw.rounds[k].name; break; } continue; }
      // Opponent comes from the sibling block of round-one matches.
      let opps;
      if (k === 0) opps = [mine === m.a ? m.b : m.a].filter(Boolean);
      else {
        const block = 1 << (k - 1); const sib = ((slot >> (k - 1)) ^ 1) * block;
        const known = mine ? (mine === m.a ? m.b : m.a) : null;
        opps = known && known.players?.[0]?.id ? [known] : entrantsIn(draw, sib, block).filter((t) => !t.players.some((p) => out.has(p.id)));
      }
      rounds.push({ name: draw.rounds[k].name, played: false, opp: opps });
    }
    return { rounds, lostIn };
  }

  // ---------------------------------------------------------------- rendering: shell
  const TABS = [['scores', 'Scores'], ['calendar', 'Calendar'], ['news', 'News'], ['rankings', 'Rankings'], ['following', 'Following']];
  // Problems are kept on the phone (Following → Settings shows them) and sent to the Baseline service, so a crash
  // can be looked at afterwards. Nothing personal is included: the message, where in the app, the screen size and build.
  function logProblem(where, e) {
    const item = { at: new Date().toISOString(), where, msg: String((e && e.message) || e || '').slice(0, 300), stack: String((e && e.stack) || '').split('\n').slice(0, 5).join(' | ').slice(0, 700),
      tour: S.tour, tab: S.tab, view: S.view ? S.view.sub || 'event' : '', sheet: !!S.sheet, size: (document.documentElement.dataset.size || '') + ' ' + innerWidth + 'x' + innerHeight, build: window.BASELINE_BUILD || '' };
    try { const a = store.get('problems', []); a.unshift(item); store.set('problems', a.slice(0, 15)); } catch (x) { /* storage full */ }
    try { const svc = window.BASELINE_ALERTS; if (svc && navigator.sendBeacon) navigator.sendBeacon(svc + '/log', JSON.stringify(item)); } catch (x) { /* offline */ }
  }
  addEventListener('error', (e) => { if (e && (e.error || e.message) && !/Script error/.test(e.message || '')) logProblem('error', e.error || e.message); });
  addEventListener('unhandledrejection', (e) => logProblem('promise', e && e.reason));
  let touching = false; // a finger is on the screen
  const shown = { top: null, screen: null, nav: null };
  const put = (id, html) => { if (shown[id] !== html) { $('#' + id).innerHTML = html; shown[id] = html; } };
  function render() {
    try { renderIn(); }
    catch (e) {
      logProblem('render', e);
      // step back to somewhere safe and say so, rather than leaving a frozen screen
      shown.top = shown.screen = shown.nav = null;
      if (S.sheet) S.sheet = null; else if (S.view) S.view = null; else { S.tab = 'scores'; S.scoresSub = 'all'; }
      try { renderIn(); toast('That screen hit a problem', 'Baseline went back a step. It’s been noted so it can be fixed.'); }
      catch (e2) { logProblem('render-again', e2); $('#screen').innerHTML = '<div class="pad"><div class="empty">Something went wrong showing this. <button class="btn" onclick="location.reload()">Reload Baseline</button></div></div>'; }
    }
  }
  // For updates that arrive on their own (live scores every 20 s and so on): never redraw under a finger or while
  // the list is still moving; catch up a moment after it stops.
  let lastScrollAt = 0, idleTimer = null;
  function refresh() {
    if (touching || Date.now() - lastScrollAt < 900 || document.querySelector('input:focus, select:focus')) { S._refreshDue = true; whenIdle(); return; }
    S._refreshDue = false; S._keepScroll = true; render();
  }
  function whenIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (S._refreshDue) refresh(); }, 1000); }
  function renderIn() {
    D = (S.tour === 'wta' ? DW : DA) || DA || D;
    if (S.tour === 'wta' && !DW) S._wtaWaiting = true;
    document.documentElement.dataset.tourview = S.tour === 'wta' && DW ? 'wta' : 'atp';
    const scr = $('#screen'); const keep = scr && S._keepScroll ? scr.scrollTop : 0;
    applyTheme();
    let head = '', body = '';
    if (S.tour === 'wta' && !DW) {
      head = `<div class="top-row"><h1>${esc(TABS.find(([k]) => k === S.tab)?.[1] || 'WTA')}</h1>${tourSwitch()}</div><div class="sub">WTA</div><div class="tabs lone"></div>`;
      body = `<div class="pad"><div class="empty">${S.wtaError ? `Couldn’t load the WTA right now (${esc(S.wtaError)}). Check your connection; it tries again shortly.` : 'Loading the WTA…'}</div></div>`;
      put('top', head); put('screen', body);
      put('nav', TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k && !S.view ? 'on' : ''}" aria-label="${l}">${ICON[k]}<span>${l}</span></button>`).join(''));
      if (S.tab !== 'following') return;
      head = ''; body = '';
    }
    if (S.view && S.view.type === 'tournament') ({ head, body } = viewTournament(S.view));
    else ({ head, body } = ({ scores: viewScores, calendar: viewCalendar, news: viewNews, rankings: viewRankings, following: viewFollowing }[S.tab])());
    put('top', head);
    put('screen', body);
    put('nav', TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k && !S.view ? 'on' : ''}" aria-label="${l}">${ICON[k]}<span>${l}</span>${k === 'following' && S.unread ? `<span class="dot">${S.unread}</span>` : ''}</button>`).join(''));
    renderSheet({ soft: true });
    if (S._keepScroll) { $('#screen').scrollTop = keep; S._keepScroll = false; }
    if (S._scrollTo) {
      const id = S._scrollTo; S._scrollTo = null;
      const go = () => { const el = document.getElementById(id), scr = $('#screen'); if (el) scr.scrollTop += el.getBoundingClientRect().top - scr.getBoundingClientRect().top - 4; };
      go(); requestAnimationFrame(() => { go(); requestAnimationFrame(go); }); // again once rows above have their real heights
    }
  }
  const tourSwitch = () => '<div class="tour-switch" role="tablist" aria-label="Tour">' + [['atp', 'ATP'], ['wta', 'WTA']].map(([k, l]) => `<button data-tour="${k}" role="tab" aria-selected="${S.tour === k}" class="${S.tour === k ? 'on' : 'off'}">${l}</button>`).join('') + '</div>';
  function snapNote() {
    if (!D) return '';
    return D.source === 'snapshot'
      ? `<span class="snapbar">Snapshot from ${esc(new Date(D.generatedAt).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz() }))}</span>`
      : `<span class="snapbar live">Live · updated ${esc(ago(D.generatedAt))}${D.espnAt && D.dataAt && Date.now() - new Date(D.dataAt) > 90 * 60e3 ? ' · results via ESPN' : D.dataAt && Date.now() - new Date(D.dataAt) > 45 * 60e3 ? ` · draws &amp; schedule from ${esc(ago(D.dataAt))}` : ''}</span>`;
  }

  // ---------------------------------------------------------------- Scores
  function viewScores() {
    const evs = currentEvents();
    const lm = liveMatches();
    const on = lm.filter(isOn).sort((a, b) => (teamHasFav(b.a) || teamHasFav(b.b)) - (teamHasFav(a.a) || teamHasFav(a.b)) || (b.status === 'live') - (a.status === 'live'));
    // Recent results: finished live-feed matches plus the latest day of each event's results
    const seen = new Set(); const recent = [];
    lm.filter((m) => m.status === 'finished').forEach((m) => { seen.add(m.tid + m.id); recent.push(m); });
    for (const t of evs) {
      const ev = D.events[t.id]; if (!ev) continue;
      const days = [...(ev.results || [])].slice(0, 1).concat((ev.resultsDbl || []).slice(0, 1));
      for (const d of days) for (const m of d.matches) { const k = t.id + m.id; if (seen.has(k)) continue; seen.add(k); recent.push(fromResult(m, t.id, d.date)); }
    }
    const filt = (arr) => S.scoresSub === 'all' ? arr : S.scoresSub === 'fav' ? arr.filter((m) => teamHasFav(m.a) || teamHasFav(m.b)) : arr.filter((m) => m.tid === S.scoresSub);
    const onF = filt(on), recentF = filt(recent).sort((a, b) => (teamHasFav(b.a) || teamHasFav(b.b)) - (teamHasFav(a.a) || teamHasFav(a.b)));
    const now = nowRef().getTime();
    const upcoming = evs.flatMap((t) => scheduleItems(t.id)).filter((m) => !/defeat/i.test(m.status) && !m.score && (!m.estUtc || new Date(m.estUtc).getTime() > now - 3 * 3600e3));
    const upF = S.scoresSub === 'all' ? upcoming : S.scoresSub === 'fav' ? upcoming.filter((m) => teamHasFav(m.a) || teamHasFav(m.b)) : upcoming.filter((m) => m.tid === S.scoresSub);

    const head = `<div class="top-row"><h1>Scores</h1>${tourSwitch()}</div><div class="sub">${snapNote()}</div>
      <div class="tabs">${[['all', 'All'], ['fav', 'Following'], ...evs.map((t) => [t.id, t.city])].map(([k, l]) => `<button data-scoresub="${k}" class="${S.scoresSub === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const evCards = evs.map((t) => {
      const st = tournamentState(t); const lc = (D.live[t.id]?.matches || []).filter((m) => ['live'].includes(m.status)).length;
      const finalDone = D.events[t.id]?.draws && (() => { const r = D.events[t.id].draws.rounds; const f = r[r.length - 1]?.matches[0]; return f && f.winner != null ? (f.winner === 0 ? f.a : f.b) : null; })();
      return `<button class="ev" data-open="${t.id}">
        <div class="row"><span class="cat ${catClass(t.type)}">${catLabel(t.type)}</span>${lc ? `<span class="pill live">${lc} live</span>` : st === 'live' ? '<span class="pill soft">This week</span>' : ''}</div>
        <div class="name">${esc(t.city)}</div><div class="where">${esc(t.name)}</div>
        <div class="foot"><span>${flag(t.flag)} ${esc(fmtRange(t))}</span><span class="surf ${esc(t.surface)}">${esc(t.surface || '')}</span></div>
        ${finalDone ? `<div class="foot"><span>Champion</span><b style="color:var(--fg)">${esc(pname(finalDone.players[0]))}</b></div>` : ''}
      </button>`;
    }).join('');
    const body = `<div class="pad">
      ${S.scoresSub === 'all' || S.scoresSub === 'fav' ? `<section class="stack"><div class="section-h"><h2>This week</h2><span class="meta">${evs.length} event${evs.length === 1 ? '' : 's'}</span></div><div class="events">${evCards}</div></section>` : `<button class="btn ghost" data-open="${esc(S.scoresSub)}">Open ${esc(tById(S.scoresSub)?.city)}: draws, results & schedule</button>`}
      <section class="stack"><div class="section-h"><h2>Live now</h2><span class="meta">${onF.length ? onF.length + ' on court' : ''}</span></div>
        ${onF.length ? onF.map((m) => matchCard(m)).join('') : `<div class="empty">No matches on court right now${S.scoresSub === 'fav' ? ' for the players you follow' : ''}.</div>`}</section>
      <section class="stack"><div class="section-h"><h2>Up next</h2><span class="meta">Times in ${esc(tzName())}</span></div>
        ${upF.length ? upF.slice(0, 8).map(schedCard).join('') : '<div class="empty">The next order of play hasn\'t been released yet.</div>'}</section>
      <section class="stack"><div class="section-h"><h2>Latest results</h2></div>
        ${recentF.length ? recentF.slice(0, 16).map((m) => matchCard(m)).join('') : '<div class="empty">No results yet.</div>'}</section>
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Tournament detail
  function viewTournament(v) {
    const t = tById(v.id); const ev = D.events[t.id]; const st = tournamentState(t);
    const hasEvent = !!(ev || D.live[t.id]);
    const year = Number((t.start || '').slice(0, 4)) || new Date().getFullYear();
    const espnOk = !['UC', 'DCR', 'LVR', 'BJK'].includes(t.type) && !!t.start;
    const subs = hasEvent ? [['live', 'Live'], ['results', 'Results'], ['schedule', 'Schedule'], ['draw', 'Draws'], ['about', 'About']]
      : st === 'past' ? [...(espnOk ? [['past', 'Results']] : []), ['about', 'Overview']]
      : [['about', 'Overview'], ['field', t.type === 'WC' || t.type === 'XXI' ? 'Qualifying' : D.tour === 'wta' ? 'Field' : 'Projected field'], ...(espnOk ? [['lastyear', `${year - 1} results`]] : [])];
    if (!v.sub || !subs.some(([k]) => k === v.sub)) v.sub = subs[0][0];
    const head = `<div class="top-row"><button class="back" data-back>${ICON.back}<span>Back</span></button><span style="flex:1"></span><span class="cat ${catClass(t.type)}">${catLabel(t.type)}</span></div>
      <div class="top-row" style="margin-top:6px"><h1>${esc(t.city)}</h1></div>
      <div class="sub">${esc(t.name)} · ${esc(fmtRange(t))}${st === 'live' ? ' · <span class="pill live" style="height:18px">On now</span>' : ''}</div>
      <div class="tabs">${subs.map(([k, l]) => `<button data-sub="${k}" class="${v.sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (v.sub === 'live') {
      // only matches being played right now
      const on = (D.live[t.id]?.matches || []).map((m) => fromLive(m, t.id)).filter(isOn).sort((a, b) => (teamHasFav(b.a) || teamHasFav(b.b)) - (teamHasFav(a.a) || teamHasFav(a.b)) || (b.status === 'live') - (a.status === 'live'));
      body = on.length ? on.map((m) => matchCard(m, { showEvent: false })).join('')
        : `<div class="empty">Nothing on court at the moment.</div><button class="btn ghost" data-sub="schedule">See the schedule</button>`;
    } else if (v.sub === 'results') {
      const days = S.resType === 'dbl' ? ev?.resultsDbl || [] : ev?.results || [];
      const di = Math.min(S.resDay || 0, Math.max(0, days.length - 1)); const d = days[di];
      body = `<div class="seg">${[['sgl', 'Singles'], ['dbl', 'Doubles']].map(([k, l]) => `<button data-restype="${k}" class="${S.resType === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${d ? `<label class="pick"><span>Day</span><select class="select" id="daysel">${days.map((x, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>${esc(dayLabel(x.date, x.day))} · ${x.matches.length} match${x.matches.length === 1 ? '' : 'es'}</option>`).join('')}</select></label>
          ${d.matches.map((m) => matchCard(fromResult(m, t.id), { showEvent: false })).join('')}` : '<div class="empty">No completed matches yet.</div>'}`;
    } else if (v.sub === 'schedule') {
      const days = ev?.schedule || [];
      const today = new Date().toLocaleDateString('en-CA', { timeZone: tz() });
      let di = S.schedDay != null ? S.schedDay : days.findIndex((x) => !x.date || x.date >= today);
      di = Math.min(Math.max(di, 0), Math.max(0, days.length - 1));
      const d = days[di];
      if (d) {
        const courts = d.courts.map((c) => { const ms = c.matches.filter((m) => !m.tour || m.tour === 'ATP'); if (!ms.length) return ''; return { court: c.court, ms }; }).filter(Boolean);
        const items = scheduleItems(t.id);
        body = `<label class="pick"><span>Day</span><select class="select" id="schedsel">${days.map((x, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>${esc(x.label.replace(/, \d{4}/, '').replace(/\(Day (\d+)\)/, '· Day $1'))}</option>`).join('')}</select></label>
          <p class="note" style="margin:0">Times in ${esc(tzName())}. Matches after the first on each court are estimates.</p>
          ${courts.map((c) => `<div class="court-h">${esc(c.court || 'Court')}<span>${c.ms[0].utc && c.ms[0].display ? esc((c.ms[0].display || '').replace(/^Starts At /, '').replace(/^Not Before /, 'NB ')) + ' local' : ''}</span></div>${items.filter((m) => m.court === c.court && m.day === d.label).map(schedCard).join('')}`).join('')}`;
      } else body = '<div class="empty">The order of play for the next day hasn’t been published yet.</div>';
    } else if (v.sub === 'past') {
      body = espnResultsView(t, year);
    } else if (v.sub === 'lastyear') {
      body = espnResultsView(t, year - 1);
    } else if (v.sub === 'draw') {
      body = drawView(t, ev);
    } else if (v.sub === 'about') {
      body = aboutView(t, hasEvent);
    } else if (v.sub === 'field') {
      body = D.tour === 'wta' && t.type !== 'WC' ? wtaFieldView(t) : fieldView(t);
    }
    return { head, body: `<div class="pad">${body}</div>` };
  }

  function drawView(t, ev) {
    const draw = S.drawType === 'dbl' ? ev?.drawsDbl : ev?.draws;
    const segs = `<div class="seg">${[['sgl', 'Singles'], ['dbl', 'Doubles']].map(([k, l]) => `<button data-drawtype="${k}" class="${S.drawType === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    // Round-robin events (ATP Finals, Next Gen Finals): group tables first, knockout bracket once it is set.
    const groups = (ev?.groups || []).filter((g) => !!g.doubles === (S.drawType === 'dbl'));
    const groupsHtml = groups.map((g) => `<div class="section-h"><h2>${esc(g.name)}</h2><span class="meta">${g.rows.some((r) => r.matches) ? 'W-L · sets' : 'Round robin'}</span></div>
      <div class="list grp">${g.rows.map((r) => `<div class="rk-row ${r.players.some((p) => isFav(p.id)) ? 'fav' : ''}"><span class="n">${r.matches ? r.pos : '–'}</span>
        <span class="p">${r.players.length === 1 ? avatar(r.players[0]) : ''}<span style="min-width:0"><span class="pn">${r.players.map((p) => `<span class="clickable" data-player="${esc(p.id || '')}">${flag(p.country)} ${esc(r.players.length > 1 ? shortName(p) : pname(p))}</span>`).join(' <span class="muted">/</span> ')}</span>${r.players.length === 1 && player(r.players[0].id)?.rank ? `<span class="pm">World No. ${player(r.players[0].id).rank}</span>` : ''}</span></span>
        <span class="pts">${r.matches ? esc(r.matches) : '0-0'}<small class="muted">${r.sets ? esc(r.sets) + ' sets' : ''}</small></span></div>`).join('')}</div>`).join('');
    const hasBracket = draw && draw.rounds.length && draw.rounds[0].matches.some((m) => m.a?.players?.[0]?.id);
    if (groups.length && !hasBracket) return segs + groupsHtml + '<p class="note" style="text-align:center">The top two in each group reach the semi-finals.</p>';
    if (!hasBracket) return segs + '<div class="empty">This draw isn\'t available yet.</div>';
    // default to the earliest round still being played
    let ri = S.drawRound;
    if (ri == null || ri >= draw.rounds.length) { ri = draw.rounds.findIndex((r) => r.matches.some((m) => m.winner == null && m.a?.players?.[0]?.id && m.b?.players?.[0]?.id)); if (ri < 0) ri = draw.rounds.length - 1; }
    const q = S.drawQuery.trim().toLowerCase();
    const r = draw.rounds[ri];
    const matchesHtml = r.matches.map((m, i) => {
      const hit = !q || [m.a, m.b].some((tm) => (tm?.players || []).some((p) => pname(p).toLowerCase().includes(q)));
      if (!hit) return '';
      const row = (tm, won, lost) => {
        if (!tm) return '';
        const ps = tm.players || [];
        const nm = ps.length ? ps.map((p) => `<span class="clickable" data-drawplayer="${esc(p.id || '')}">${flag(p.country)} ${esc(ps.length > 1 ? shortName(p) : (pname(p) === 'Bye' ? 'Bye' : pname(p)))}</span>`).join(' <span class="muted">/</span> ') : 'TBA';
        const tag = tm.seed ? `(${tm.seed})` : tm.entry ? `(${tm.entry})` : '';
        const sets = (tm.sets || []).map((s, k) => { const o = (tm === m.a ? m.b : m.a)?.sets?.[k]; const l = o && s.g < o.g; return `<span class="${l ? 'lost' : ''}">${s.g}${s.tb != null && l ? `<sup>${s.tb}</sup>` : ''}</span>`; }).join('');
        return `<div class="team ${won ? 'won' : ''} ${lost ? 'lost' : ''}"><div class="who"><div class="pname" style="gap:6px">${nm}${tag ? ` <span class="seed">${esc(tag)}</span>` : ''}${ps.some((p) => isFav(p.id)) ? '<span style="color:var(--warn)">★</span>' : ''}</div></div><div class="sets">${sets}</div></div>`;
      };
      return `<div class="dmatch">${row(m.a, m.winner === 0, m.winner === 1)}${row(m.b, m.winner === 1, m.winner === 0)}</div>`;
    }).join('');
    return `${segs}${groupsHtml}
      <div class="search">${ICON.search}<input id="drawq" placeholder="Find a player in the draw" value="${esc(S.drawQuery)}" autocomplete="off"></div>
      <div class="chips">${draw.rounds.map((x, i) => `<button class="chip ${i === ri ? 'on' : ''}" data-round="${i}">${esc(roundShort(x.name))}</button>`).join('')}</div>
      <div class="section-h"><h2>${esc(r.name)}</h2><span class="meta">Tap a player to see their path</span></div>
      <div class="draw-round">${matchesHtml || '<div class="empty">No match for that name in this round.</div>'}</div>`;
  }

  function aboutView(t, hasEvent) {
    const champ = D.champions[t.id]; const cp = champ ? player(champ) || { name: champ } : null;
    const draw = D.events[t.id]?.draws; let winner = null;
    if (draw) { const f = draw.rounds[draw.rounds.length - 1]?.matches[0]; if (f && f.winner != null) winner = (f.winner === 0 ? f.a : f.b).players[0]; }
    const days = t.start ? Math.round((dateFrom(t.start) - dateFrom(nowRef().toISOString().slice(0, 10))) / 864e5) : null;
    return `<div class="facts">
        <div><span class="eyebrow">Dates</span><b>${esc(fmtRange(t))}</b></div>
        <div><span class="eyebrow">Starts</span><b>${days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : days === 0 ? 'Today' : 'Started'}</b></div>
        <div><span class="eyebrow">Surface</span><b><span class="surf ${esc(t.surface)}" style="color:var(--fg);font-size:15px">${esc([t.surface, t.inOut].filter(Boolean).join(' · ') || '–')}</span></b></div>
        <div><span class="eyebrow">Draw</span><b>${t.sgl ? `${t.sgl} singles` : '–'}${t.dbl ? ` · ${t.dbl} dbl` : ''}</b></div>
        <div><span class="eyebrow">Prize money</span><b class="num">${esc(t.prize || '–')}</b></div>
        <div><span class="eyebrow">Location</span><b>${flag(t.flag)} ${esc(t.location)}</b></div>
      </div>
      ${winner ? `<section class="stack"><div class="section-h"><h2>Champion</h2></div><button class="list fav-card" data-player="${esc(winner.id)}">${avatar(winner)}<div><b>${esc(pname(winner))}</b><div class="st">${esc(t.name)} ${esc(t.start.slice(0, 4))}</div></div><span class="crown">Winner</span></button></section>` : ''}
      ${cp ? `<section class="stack"><div class="section-h"><h2>Defending champion</h2></div><button class="list fav-card" data-player="${esc(cp.id || '')}">${avatar(cp)}<div><b>${esc(cp.name)}</b><div class="st">Won the ${esc(String(Number(t.start.slice(0, 4)) - 1))} title</div></div><span class="crown">Holder</span></button></section>` : ''}
      ${!hasEvent && D.projections[t.id] ? `<button class="btn ghost" data-sub="field">See who's expected to play</button>` : ''}
      ${t.site ? `<a class="btn ghost" href="${esc(t.site)}" target="_blank" rel="noopener">${ICON.ext} Tournament website</a>` : ''}`;
  }

  function wtaFieldView(t) {
    const key = t.id + ':' + t.year; const E = S.entry[key];
    if (E === undefined) {
      S.entry[key] = null;
      espnJson(`${SERVICE()}/wta/players/${t.id}/${t.year}`, 3 * 3600e3).then((j) => { S.entry[key] = ((j && j.events) || []).find((e) => e.eventTypeCode === 'LS' && (e.eventPlayers || []).length) || false; refresh(); })
        .catch(() => { S.entry[key] = false; refresh(); });
    }
    if (E === null || E === undefined) return '<div class="empty">Loading the entry list…</div>';
    if (!E) return `<p class="note" style="margin:0">The WTA hasn’t published the entry list yet, so this is a projection.</p>${fieldView(t)}`;
    const last = new Set(D.lastYear[t.id] || []); const champ = D.champions[t.id];
    const ENTRY = { M: '', Q: 'Qualifier', WC: 'Wildcard', Wc: 'Wildcard', PR: 'Protected', SE: 'Special exempt', Alt: 'Alternate', ALT: 'Alternate', LL: 'Lucky loser' };
    const rows = E.eventPlayers.map((e) => { const pl = (e.players || [])[0] || {}; const id = 'W' + pl.id; const p = player(id) || { id, name: titleCase(pl.fullName || ''), country: pl.countryCode }; return { id, p, seed: /^\d+$/.test(e.seed || '') ? +e.seed : null, entry: ENTRY[e.entryType] ?? e.entryType, rank: player(id)?.rank || null, out: e.eliminated }; })
      .sort((a, b) => (a.seed || 999) - (b.seed || 999) || (a.rank || 9999) - (b.rank || 9999));
    const favIn = rows.filter((r) => isFav(r.id));
    return `<p class="note" style="margin:0">The WTA’s entry list for the main draw. Seeds appear once the draw is made.</p>
      <div class="facts"><div><span class="eyebrow">Players entered</span><b>${rows.length}</b></div><div><span class="eyebrow">Players you follow</span><b>${favIn.length ? favIn.map((r) => esc(pname(r.p).split(' ').pop())).join(', ') : 'None entered'}</b></div></div>
      <div class="list">${rows.map((r) => `<button class="rk-row ${isFav(r.id) ? 'fav' : ''}" data-player="${esc(r.id)}"><span class="n num">${r.rank || '–'}</span>
        <span class="p">${avatar(r.p)}<span style="min-width:0"><div class="pn">${flag(r.p.country)} ${esc(pname(r.p))}</div><div class="pm">${champ === r.id ? '<span class="crown">Defending champion</span> · ' : ''}${[r.seed ? 'Seed ' + r.seed : '', r.entry, last.has(r.id) ? 'Played here last year' : ''].filter(Boolean).join(' · ') || 'Main draw'}</div></span></span>
        <span class="status-chip ${r.entry ? 'likely' : 'in'}">${r.entry ? esc(r.entry) : 'In'}</span></button>`).join('')}</div>`;
  }
  function fieldView(t) {
    const pr = D.projections[t.id];
    if (!pr) return '<div class="empty">No projection for this event yet. Projections appear once it is within the next few weeks.</div>';
    const last = new Set(D.lastYear[t.id] || []);
    const champ = D.champions[t.id];
    const label = { expected: 'Expected', likely: 'Likely', possible: 'Possible', in: 'Qualifying', alt: 'Alternate' };
    const favIn = pr.players.filter((p) => isFav(p.id));
    return `<p class="note" style="margin:0">${esc(pr.basis)} Official entry lists aren't published on atptour.com, so this is a projection. It updates as the rankings move.</p>
      ${pr.cutoff ? `<div class="facts"><div><span class="eyebrow">Projected cut-off</span><b>No. ${pr.cutoff}</b></div><div><span class="eyebrow">Players you follow</span><b>${favIn.length ? favIn.map((p) => esc(pname(p).split(' ').pop())).join(', ') : 'None projected'}</b></div></div>` : ''}
      <div class="list">${pr.players.map((p, i) => `
        ${pr.players[i - 1] && pr.players[i - 1].status === 'in' && p.status === 'alt' ? '<div class="cutline">Alternates</div>' : ''}
        <button class="rk-row ${isFav(p.id) ? 'fav' : ''}" data-player="${esc(p.id)}"><span class="n num">${p.rank}</span>
        <span class="p">${avatar(player(p.id) || { id: p.id })}<span style="min-width:0"><div class="pn">${flag(player(p.id)?.country)} ${esc(pname(player(p.id) || { id: p.id }))}</div><div class="pm">${champ === p.id ? '<span class="crown">Defending champion</span> · ' : ''}${last.has(p.id) ? 'Played here last year' : t.type === 'WC' || t.type === 'XXI' ? `${fmtNum(p.points)} pts` : 'Ranking entry'}</div></span></span>
        <span class="status-chip ${p.status}">${label[p.status]}</span></button>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Calendar
  function viewCalendar() {
    const W = D.tour === 'wta';
    const F = { all: () => true, GS: (t) => t.type === 'GS', 1000: (t) => t.type === '1000', 500: (t) => t.type === '500', 250: (t) => t.type === '250', 125: (t) => t.type === '125', other: (t) => !['GS', '1000', '500', '250', '125'].includes(t.type) };
    if (!F[S.calFilter] || (!W && S.calFilter === '125')) S.calFilter = 'all';
    const list = D.tournaments.filter(F[S.calFilter]).filter((t) => S.calPast || tournamentState(t) !== 'past');
    const byMonth = {};
    list.forEach((t) => { const k = (t.start || '').slice(0, 7); (byMonth[k] ||= []).push(t); });
    const head = `<div class="top-row"><h1>Calendar</h1>${tourSwitch()}</div><div class="sub">${D.tournaments[0]?.start?.slice(0, 4)} season · ${D.tournaments.length} events</div>
      <div class="tabs">${(W ? [['all', 'All'], ['GS', 'Grand Slams'], ['1000', 'WTA 1000'], ['500', 'WTA 500'], ['250', 'WTA 250'], ['125', 'WTA 125'], ['other', 'Finals & team']] : [['all', 'All'], ['GS', 'Grand Slams'], ['1000', 'Masters 1000'], ['500', 'ATP 500'], ['250', 'ATP 250'], ['other', 'Team & Finals']]).map(([k, l]) => `<button data-calf="${k}" class="${S.calFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const body = `<div class="pad" style="gap:10px">
      <button class="chip ${S.calPast ? 'on' : ''}" data-calpast style="align-self:flex-start">${S.calPast ? 'Hide' : 'Show'} completed events</button>
      ${Object.entries(byMonth).map(([k, ts]) => `<div id="m-${k}"><div class="month-h">${esc(dateFrom(k + '-01').toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</div><div class="list">${ts.map(calRow).join('')}</div></div>`).join('') || '<div class="empty">No events match that filter.</div>'}
    </div>`;
    return { head, body };
  }
  function calRow(t) {
    const st = tournamentState(t); const a = t.start ? dateFrom(t.start) : null;
    const hasProj = !!D.projections[t.id]; const champ = D.champions[t.id];
    const lc = (D.live[t.id]?.matches || []).filter((m) => m.status === 'live').length;
    return `<button class="cal-row ${st === 'past' ? 'past' : ''} ${st === 'live' ? 'now' : ''}" data-open="${t.id}">
      <span class="d"><b>${a ? a.getUTCDate() : ''}</b><small>${a ? a.toLocaleDateString('en-NZ', { month: 'short', timeZone: 'UTC' }) : ''}</small></span>
      <span class="mid"><span class="t">${esc(t.city)}</span><span class="s">${flag(t.flag)}<span>${esc(fmtRange(t))}</span>${t.surface ? `<span class="surf ${esc(t.surface)}">${esc(t.surface)}${t.inOut === 'Indoor' ? ' (i)' : ''}</span>` : ''}</span>
        ${st === 'upcoming' && (hasProj || champ) ? `<span class="s" style="color:var(--accent);font-weight:700">${champ ? 'Holder ' + esc(pname(player(champ) || { name: champ }).split(' ').pop()) : ''}${champ && hasProj ? ' · ' : ''}${hasProj ? 'Field projected' : ''}</span>` : ''}</span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="cat ${catClass(t.type)}">${catLabel(t.type)}</span>${st === 'live' ? (lc ? '<span class="pill live">Live</span>' : '<span class="pill soft">Now</span>') : ''}</span>
    </button>`;
  }

  // ---------------------------------------------------------------- News
  function viewNews() {
    const tags = ['All', ...new Set(D.news.map((n) => (n.video ? 'Video' : n.tag)).filter(Boolean))].slice(0, 8);
    const items = D.news.filter((n) => S.newsFilter === 'All' || (S.newsFilter === 'Video' ? n.video : n.tag === S.newsFilter));
    const img = (n) => n.imgData || (n.img && !D.images ? (n.img.startsWith('http') ? n.img : window.BaselineLoader ? window.BaselineLoader.image(n.img) : '/api/img?u=' + encodeURIComponent(n.img)) : '');
    const head = `<div class="top-row"><h1>Latest</h1>${tourSwitch()}</div><div class="sub">${D.tour === 'wta' ? 'WTA stories from ESPN' : 'From atptour.com'}</div>
      <div class="tabs">${tags.map((t) => `<button data-newsf="${esc(t)}" class="${S.newsFilter === t ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
    // Lead with the first story that has a picture; the rest keep their order.
    const li = Math.max(0, items.findIndex((n) => img(n))); const lead = items[li]; const rest = items.filter((n, i) => i !== li);
    const body = `<div class="pad">
      ${lead ? `<a class="lead" href="${esc(lead.url)}" target="_blank" rel="noopener"><div class="img" style="background-image:url('${esc(img(lead))}')"></div><div class="body"><span class="tag">${esc(lead.video ? 'Video' : lead.tag || 'News')}</span><h3>${esc(lead.title)}</h3>${lead.author ? `<span class="muted" style="font-size:12.5px">${esc(lead.author)}</span>` : ''}</div></a>` : '<div class="empty">No stories.</div>'}
      <div class="list">${rest.map((n) => `<a class="story" href="${esc(n.url)}" target="_blank" rel="noopener"><div><span class="tag">${esc(n.video ? 'Video' : n.tag || 'News')}</span><h4>${esc(n.title)}</h4></div><div class="thumb" style="background-image:url('${esc(img(n))}')">${n.video ? '<span class="play"></span>' : ''}</div></a>`).join('')}</div>
      <p class="note" style="text-align:center">Stories open on ${D.tour === 'wta' ? 'espn.com' : 'atptour.com'}.</p>
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Rankings
  const RK = {
    singles: [['sgl', 'Official'], ['sgl_live', 'Live'], ['sgl_race', 'Race to Turin'], ['nextgen', 'Next Gen race']],
    doubles: [['dbl', 'Official'], ['dbl_live', 'Live'], ['dbl_race', 'Team race']],
  };
  const RKW = { singles: [['sgl', 'Official'], ['sgl_live', 'Live'], ['sgl_race', 'Race to the Finals']], doubles: [['dbl', 'Official'], ['dbl_live', 'Live'], ['dbl_race', 'Team race']] };
  function viewRankings() {
    const lists = (D.tour === 'wta' ? RKW : RK)[S.rkKind];
    if (!lists.some(([k]) => k === S.rkList)) S.rkList = lists[0][0];
    const R = D.rankings[S.rkList] || { rows: [] };
    const q = S.rkQuery.trim().toLowerCase();
    const all = R.rows.filter((r) => !q || r.players.some((p) => pname(p).toLowerCase().includes(q)));
    // the first 60 straight away (fast to open); the rest a tap away. Searching always covers everyone.
    const rows = q || S.rkMore ? all : all.slice(0, 60);
    const cut = { sgl_race: 8, nextgen: 7, dbl_race: 8 }[S.rkList];
    const head = `<div class="top-row"><h1>Rankings</h1>${tourSwitch()}</div><div class="sub">${D.tour === 'wta' ? 'WTA Rankings' : 'PIF ATP Rankings'}${R.asOf ? ' · ' + esc(R.asOf.replace(/\./g, '-')) : ''}</div>
      <div class="tabs">${lists.map(([k, l]) => `<button data-rklist="${k}" class="${S.rkList === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sub = (r) => {
      if (S.rkList.endsWith('_live')) return r.current ? esc(r.current) : r.age ? `Age ${esc(r.age)}` : '';
      if (S.rkList === 'sgl' || S.rkList === 'dbl') return [r.age && `Age ${esc(r.age)}`, r.tourns && `${r.tourns} events`, r.dropping && `dropping ${fmtNum(r.dropping)}`].filter(Boolean).join(' · ');
      return r.age ? `Age ${esc(r.age)}` : '';
    };
    const body = `<div class="pad" style="gap:12px">
      <div class="seg">${[['singles', 'Singles'], ['doubles', 'Doubles']].map(([k, l]) => `<button data-rkkind="${k}" class="${S.rkKind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="search">${ICON.search}<input id="rkq" placeholder="Search players" value="${esc(S.rkQuery)}" autocomplete="off"></div>
      ${S.rkList === 'sgl_race' ? `<p class="note" style="margin:0">The top 8 at the end of the season qualify for the ${D.tour === 'wta' ? 'WTA Finals' : 'Nitto ATP Finals in Turin'}.</p>` : S.rkList.endsWith('_live') && D.tour === 'wta' ? '<p class="note" style="margin:0">The WTA doesn’t publish live rankings, so Baseline works them out the way live-ranking sites do: official points, plus what each player has earned this week, minus what they earned at the same events last year. Treat them as close estimates.</p>' : S.rkList === 'dbl_race' && D.tour === 'wta' ? '<p class="note" style="margin:0">The top 8 teams at the end of the season qualify for the WTA Finals.</p>' : S.rkList === 'nextgen' ? '<p class="note" style="margin:0">Players 21 and under. The top 7 qualify for the Next Gen ATP Finals.</p>' : S.rkList.endsWith('_live') ? '<p class="note" style="margin:0">Live rankings include points won and dropped this week.</p>' : '<p class="note" style="margin:0">Tap a player for their points, movement and who’s around them.</p>'}
      <div class="list rk">${rows.map((r, i) => {
        const fav = r.players.some((p) => isFav(p.id));
        const mv = r.rankMove; const move = mv ? `<span class="mv ${mv > 0 ? 'up' : 'down'}">${mv > 0 ? '▲' : '▼'}${Math.abs(mv)}</span>` : '';
        const pm = r.pointsMove != null ? `<small class="${r.pointsMove > 0 ? 'pos' : 'neg'}">${r.pointsMove > 0 ? '+' : ''}${fmtNum(r.pointsMove)}</small>` : r.next ? `<small class="muted">next ${fmtNum(r.next)}</small>` : '';
        const names = r.players.map((p) => `${flag(p.country)} ${esc(r.players.length > 1 ? pname(p).split(' ').pop() : pname(p))}`).join(' <span class="muted">/</span> ');
        return `${cut && i === cut && !q ? `<div class="cutline">Qualifying line</div>` : ''}<div class="rk-row ${fav ? 'fav' : ''}">
          <span class="n num">${r.rank}${move}</span>
          <button class="p" data-player="${esc(r.players[0].id)}">${r.players.length === 1 ? avatar(r.players[0]) : ''}<span class="pw"><span class="pn">${names}</span><span class="pm">${sub(r)}</span></span></button>
          <button class="pts num" data-player="${esc(r.players[0].id)}">${fmtNum(r.points)}${pm}</button>
          ${r.players.length === 1 ? `<button class="star ${fav ? 'on' : ''}" data-fav="${esc(r.players[0].id)}" aria-label="${fav ? 'Unfollow' : 'Follow'}">${fav ? ICON.star : ICON.starO}</button>` : '<span></span>'}
        </div>`;
      }).join('') || '<div class="empty">No players match that search.</div>'}</div>
      ${rows.length < all.length ? `<button class="btn ghost" data-rkmore>Show all ${all.length} players</button>` : ''}
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Following
  function playerStatus(id) {
    for (const m of liveMatches()) {
      const inA = m.a.players.some((p) => p.id === id), inB = m.b.players.some((p) => p.id === id);
      if (!inA && !inB) continue;
      const t = tById(m.tid); const opp = inA ? m.b : m.a;
      const vs = opp.players.map(shortName).join('/');
      if (isOn(m)) return { live: true, text: `${m.status === 'live' ? 'Playing now' : 'On court'} vs ${vs} · ${t.city} ${roundShort(m.round)}` };
    }
    for (const t of currentEvents()) {
      const up = scheduleItems(t.id).find((m) => !/defeat/i.test(m.status) && !m.score && [m.a, m.b].some((x) => x.players.some((p) => p.id === id)));
      if (up) { const opp = up.a.players.some((p) => p.id === id) ? up.b : up.a; return { text: `Next: ${opp.players.length ? 'vs ' + opp.players.map((p) => p.name).join('/') : 'opponent TBD'} · ${t.city} · ${up.estUtc ? fmtWeekday(up.estUtc) + ' ' + (up.utc ? '' : '≈ ') + fmtTime(up.estUtc) : 'time TBC'}` }; }
    }
    for (const t of currentEvents()) {
      const g = (D.events[t.id]?.groups || []).find((x) => x.rows.some((r) => r.players.some((p) => p.id === id)));
      if (g) { const r = g.rows.find((x) => x.players.some((p) => p.id === id)); return { text: `${t.city} · ${g.name}${r.matches ? ' · ' + r.matches : ''}` }; }
    }
    for (const t of currentEvents()) {
      for (const [dk, label] of [['draws', ''], ['drawsDbl', ' (doubles)']]) {
        const dr = D.events[t.id]?.[dk]; if (!dr) continue;
        const path = drawPath(dr, id); if (!path) continue;
        if (path.lostIn) return { text: `Out in the ${path.lostIn}${label} at ${t.city}` };
        const nx = path.rounds.find((r) => !r.played);
        if (nx) return { text: `${t.city}${label} · ${roundShort(nx.name)} next${nx.opp.length === 1 && nx.opp[0].players?.[0]?.id ? ' vs ' + nx.opp[0].players.map(shortName).join('/') : ''}` };
        return { text: `${t.city} champion${label}` };
      }
    }
    const nextT = D.tournaments.filter((t) => tournamentState(t) === 'upcoming').find((t) => D.projections[t.id]?.players.some((p) => p.id === id));
    return { text: nextT ? `Not playing this week · projected for ${nextT.city}` : 'Not playing this week' };
  }
  function viewFollowing() {
    const q = S.addQuery.trim().toLowerCase();
    const matches = q ? [...Object.values((DA && DA.players) || {}), ...Object.values((DW && DW.players) || {})].filter((p) => p.name && p.name.toLowerCase().includes(q) && !p.name.includes('/')).sort((a, b) => (a.rank || 9999) - (b.rank || 9999)).slice(0, 8) : [];
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    const head = `<div class="top-row"><h1>Following</h1></div><div class="sub">${S.favs.length} player${S.favs.length === 1 ? '' : 's'} · alerts for their matches</div><div class="tabs lone"></div>`;
    const body = `<div class="pad">
      <section class="stack"><div class="section-h"><h2>Your players</h2></div>
        <div class="list">${S.favs.map((id) => withD(dataFor(id), () => { const p = player(id) || { id, name: id }; const st = playerStatus(id); return `<div class="fav-card">${avatar(p)}<button data-player="${esc(id)}" style="text-align:left;min-width:0"><b>${flag(p.country)} ${esc(p.name)}</b><div class="st ${st.live ? 'live' : ''}">${esc(st.text)}</div></button><button class="star on" data-fav="${esc(id)}" aria-label="Unfollow">${ICON.star}</button></div>`; })).join('') || '<div class="empty" style="border:0">Follow players from here, the rankings or any match.</div>'}</div>
        <div class="search">${ICON.search}<input id="addq" placeholder="Add a player" value="${esc(S.addQuery)}" autocomplete="off"></div>
        ${matches.length ? `<div class="list">${matches.map((p) => `<div class="fav-card">${avatar(p, 'sm')}<button data-player="${esc(p.id)}" style="text-align:left"><b>${flag(p.country)} ${esc(p.name)}</b><div class="st">${/^W\d/.test(p.id) ? 'WTA · ' : 'ATP · '}${p.rank ? 'Singles No. ' + p.rank : p.dblRank ? 'Doubles No. ' + p.dblRank : 'not ranked in the top 200'}</div></button><button class="star ${isFav(p.id) ? 'on' : ''}" data-fav="${esc(p.id)}">${isFav(p.id) ? ICON.star : ICON.starO}</button></div>`).join('')}</div>` : ''}
      </section>
      <section class="stack"><div class="section-h"><h2>Notify me when</h2></div>
        <div class="list">${[['start', 'A match starts', 'When one of your players walks on court'], ['sets', 'Each set ends', 'Set-by-set score updates'], ['result', 'A match finishes', 'Final score and who won'], ['schedule', 'Their next match is scheduled', 'Court and start time in your time zone']].map(([k, l, d]) => `<div class="toggle-row"><div class="lbl"><b>${l}</b><small>${d}</small></div><button class="switch ${S.notif[k] ? 'on' : ''}" role="switch" aria-checked="${!!S.notif[k]}" data-notif="${k}" aria-label="${l}"></button></div>`).join('')}
          ${notifRow(perm)}
        </div>
        <button class="btn ghost" data-testnotif>${ICON.bell} Preview an alert</button>
      </section>
      <section class="stack"><div class="section-h"><h2>Recent alerts</h2>${S.feed.length ? '<button class="meta" data-clearfeed>Clear</button>' : ''}</div>
        <div class="list">${S.feed.slice(0, 20).map((f) => `<div class="feed-item">${avatar({ id: f.pid }, 'sm')}<div><b>${esc(f.title)}</b><p>${esc(f.body)}</p><p style="font-size:11.5px">${esc(ago(f.at))}</p></div></div>`).join('') || '<div class="empty" style="border:0">Alerts about your players will collect here.</div>'}</div>
      </section>
      <section class="stack"><div class="section-h"><h2>Settings</h2></div>
        <div class="list">
          <div class="toggle-row"><div class="lbl"><b>Time zone</b><small>Match times are converted to this</small></div><select class="select" id="tzsel">${['', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'].map((z) => `<option value="${z}" ${(S.tz || '') === z ? 'selected' : ''}>${z ? z.split('/').pop().replace('_', ' ') : 'This device (' + esc(Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop().replace('_', ' ')) + ')'}</option>`).join('')}</select></div>
          <div class="toggle-row"><div class="lbl"><b>Appearance</b></div><div class="seg" style="min-width:210px">${[['system', 'Auto'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-theme-set="${k}" class="${S.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="toggle-row"><div class="lbl"><b>Top spacing</b><small>If the top of Baseline sits under the clock or camera, pick More</small></div><div class="seg" style="min-width:190px">${[['auto', 'Auto'], ['on', 'More'], ['off', 'Less']].map(([k, l]) => `<button data-topfix="${k}" class="${S.topFix === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          ${store.get('problems', []).length ? `<div class="toggle-row"><div class="lbl"><b>Recent problems</b><small>${esc(store.get('problems', []).slice(0, 3).map((x) => `${ago(x.at)}: ${x.msg} (${x.tour} ${x.tab}${x.view ? ' ' + x.view : ''})`).join(' · '))}</small></div><button class="btn ghost" data-clearproblems style="padding:8px 12px">Clear</button></div>` : ''}
          <div class="toggle-row"><div class="lbl"><b>This screen</b><small>${esc([SCREEN.model ? SCREEN.model + ' size' : null, SCREEN.size, 'layout ' + (document.documentElement.dataset.size || '?'), 'top ' + SCREEN.top + (SCREEN.fallback ? ' (fixed)' : ''), SCREEN.standalone ? 'Home Screen app' : 'in browser'].filter(Boolean).join(' · '))}</small></div></div>
          <div class="toggle-row"><div class="lbl"><b>Data</b><small>${D.source === 'snapshot' ? 'Preview snapshot taken ' + esc(new Date(D.generatedAt).toLocaleString('en-NZ', { timeZone: tz(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + '. The installed app refreshes live.' : (D.dataAt ? 'ATP: live scores straight from ATP every 20 s; draws, order of play, results and rankings from the updater on your computer, last refreshed ' + esc(ago(D.dataAt)) + '. WTA: everything straight from the WTA through the Baseline service, live scores every 20 s.' : 'Live from atptour.com · scores every 20 s, everything else every 5 min')}</small></div></div>
        </div>
      </section>
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Player sheet
  // soft: refresh the open panel's content in place (live updates, career numbers arriving) without rebuilding it,
  // keeping its scroll position, and never while a finger is on the screen (that would cut a swipe short).
  document.addEventListener('touchstart', () => { touching = true; }, { passive: true, capture: true });
  const untouch = () => { touching = false; if (S._refreshDue) whenIdle(); if (S._sheetDue) { S._sheetDue = false; renderSheet({ soft: true }); } };
  document.addEventListener('touchend', untouch, { capture: true }); document.addEventListener('touchcancel', untouch, { capture: true });
  function renderSheet(opts = {}) { if (!S.sheet) return renderSheetIn(opts); return withD(dataFor(S.sheet.id), () => renderSheetIn(opts)); }
  function renderSheetIn({ soft = false } = {}) {
    const host = $('#sheet');
    if (!S.sheet) { host.innerHTML = ''; return; }
    const open = host.querySelector('.sheet'); const same = open && open.dataset.pid === S.sheet.id && !host.querySelector('.sheet-wrap.closing');
    if (soft && same && touching) { S._sheetDue = true; return; }
    const id = S.sheet.id; const p = player(id) || { id, name: S.sheet.name || 'Player' };
    const find = (k) => D.rankings[k]?.rows.find((r) => r.players.some((x) => x.id === id));
    const sg = find('sgl'), lv = find('sgl_live'), rc = find('sgl_race'), db = find('dbl'), ng = find('nextgen');
    const st = playerStatus(id);
    // path in any current draw
    let pathHtml = '';
    for (const t of currentEvents()) {
      for (const [dk, lab] of [['draws', 'Singles'], ['drawsDbl', 'Doubles']]) {
        const dr = D.events[t.id]?.[dk]; if (!dr) continue; const path = drawPath(dr, id); if (!path) continue;
        pathHtml += `<section class="stack"><div class="section-h"><h2>${esc(t.city)} ${lab.toLowerCase()} path</h2><span class="meta">${path.lostIn ? 'Eliminated' : 'Possible opponents'}</span></div>
          ${path.rounds.map((r) => `<div class="path-r"><div class="rh"><span>${esc(r.name)}</span><span class="${r.played ? (r.won ? 'pos' : 'neg') : 'muted'}" style="font-size:12.5px">${r.played ? (r.won ? 'Won' : 'Lost') : r.opp.length === 1 ? 'Opponent' : r.opp.length + ' possible'}</span></div>
            <div class="opp">${r.opp.slice(0, 16).map((tm) => `<button data-player="${esc(tm.players[0].id || '')}">${tm.players.length === 1 ? avatar(tm.players[0], 'sm') : ''}${flag(tm.players[0].country)} ${esc(tm.players.map((x) => shortName(x)).join('/'))}${tm.seed ? ` <span class="seed">(${tm.seed})</span>` : ''}</button>`).join('')}${r.opp.length > 16 ? `<span class="muted" style="font-size:12px;align-self:center">+${r.opp.length - 16} more</span>` : ''}</div></div>`).join('')}</section>`;
      }
    }
    const slug = (p.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    const bodyHtml = `
      <div class="pl-head">${avatar(p, 'lg')}<div style="flex:1;min-width:0"><div class="eyebrow">${flag(p.country)} ${esc(p.country || '')}${sg?.age ? ' · Age ' + esc(sg.age) : ''}</div><h3>${esc(p.name)}</h3><div class="muted" style="font-size:13px;margin-top:4px;${st.live ? 'color:var(--live);font-weight:700' : ''}">${esc(st.text)}</div></div></div>
      <div class="stat-row">
        <div class="stat"><b class="num">${sg ? sg.rank : '–'}</b><span>Singles</span></div>
        <div class="stat"><b class="num">${rc ? rc.rank : ng ? ng.rank : lv ? lv.rank : '–'}</b><span>${rc ? 'Race' : ng ? 'Next Gen' : 'Live'}</span></div>
        <div class="stat"><b class="num">${db ? db.rank : '–'}</b><span>Doubles</span></div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-fav="${esc(id)}">${isFav(id) ? ICON.star + ' Following' : ICON.starO + ' Follow'}</button>
        ${slug ? `<a class="btn ghost" href="${/^W\d/.test(id) ? `https://www.wtatennis.com/players/${id.slice(1)}/${slug}` : `https://www.atptour.com/en/players/${slug}/${id.toLowerCase()}/overview`}" target="_blank" rel="noopener">${ICON.ext} Profile</a>` : ''}</div>
      ${rankingBlock(id)}
      ${pathHtml}`;
    if (same) { const b = open.querySelector('.sheet-body'); const y = open.scrollTop; b.innerHTML = bodyHtml; open.scrollTop = y; return; }
    host.innerHTML = `<div class="sheet-wrap" data-closesheet><div class="sheet" role="dialog" aria-label="${esc(p.name)}" data-pid="${esc(id)}">
      <div class="sheet-bar"><span class="grab"></span><button class="sheet-x" data-closesheetbtn aria-label="Close">${ICON.close}</button></div>
      <div class="sheet-body">${bodyHtml}</div>
    </div></div>`;
  }

  // Ranking and points detail for the player sheet: where they stand, what's moving, who's around them, career numbers.
  const career = {};
  function rankingBlock(id) {
    const find = (k) => { const rows = D.rankings[k]?.rows || []; const i = rows.findIndex((r) => r.players.some((x) => x.id === id)); return i < 0 ? null : { r: rows[i], i, rows }; };
    const S1 = find('sgl'), L = find('sgl_live'), R = find('sgl_race'), N = find('nextgen'), DB = find('dbl'), DL = find('dbl_live');
    const nameOf = (r) => esc(shortName(r.players[0]));
    let html = '';
    if (S1) {
      const { r, i, rows } = S1;
      const mv = r.rankMove ? `<span class="mv ${r.rankMove > 0 ? 'up' : 'down'}">${r.rankMove > 0 ? '▲' : '▼'}${Math.abs(r.rankMove)}</span>` : '<span class="muted" style="font-size:12px">no change</span>';
      const pm = r.pointsMove ? `<small class="${r.pointsMove > 0 ? 'pos' : 'neg'}">${r.pointsMove > 0 ? '+' : ''}${fmtNum(r.pointsMove)} since last week</small>` : '';
      const above = rows[i - 1], below = rows[i + 1];
      const goal = [1, 3, 5, 10, 20, 30, 50, 100, 200].filter((m) => m < r.rank).pop();
      const goalRow = goal && rows[goal - 1];
      const cells = [
        ['Points', `${fmtNum(r.points)}${pm}`],
        ['Movement', mv],
        ['Events counted', r.tourns ?? '–'],
        L && L.r.points !== r.points ? ['Live', `No. ${L.r.rank} · ${fmtNum(L.r.points)}${L.r.points !== r.points ? `<small class="${L.r.points > r.points ? 'pos' : 'neg'}">${L.r.points > r.points ? '+' : ''}${fmtNum(L.r.points - r.points)} this week</small>` : ''}`] : null,
        R ? [D.tour === 'wta' ? 'Race to the Finals' : 'Race to Turin', `No. ${R.r.rank} · ${fmtNum(R.r.points)}<small class="muted">points this season</small>`] : N ? ['Next Gen race', `No. ${N.r.rank} · ${fmtNum(N.r.points)}`] : null,
        r.dropping ? ['Dropping next', `${fmtNum(r.dropping)}${r.nextBest ? `<small class="muted">next best ${fmtNum(r.nextBest)}</small>` : ''}`] : null,
        above ? [`Behind No. ${above.rank}`, `${fmtNum(above.points - r.points)}<small class="muted">${nameOf(above)}</small>`] : ['World No. 1', below ? `Leads by ${fmtNum(r.points - below.points)}` : '–'],
        below && above ? [`Ahead of No. ${below.rank}`, `${fmtNum(r.points - below.points)}<small class="muted">${nameOf(below)}</small>`] : null,
        goalRow && goal !== r.rank - 1 ? [`To reach the top ${goal}`, `${fmtNum(goalRow.points - r.points + 1)}<small class="muted">No. ${goal} has ${fmtNum(goalRow.points)}</small>`] : null,
      ].filter(Boolean);
      const lo = Math.max(0, Math.min(i - 2, rows.length - 5)); const ladder = rows.slice(lo, lo + 5); const top = Math.max(...ladder.map((x) => x.points || 0)) || 1;
      html += `<section class="stack"><div class="section-h"><h2>Singles ranking</h2><span class="meta">${D.rankings.sgl.asOf ? 'As of ' + esc(D.rankings.sgl.asOf.replace(/\./g, '-')) : ''}</span></div>
        <div class="facts rkfacts">${cells.map(([k, v]) => `<div><span class="eyebrow">${k}</span><b class="num">${v}</b></div>`).join('')}</div>
        <div class="list ladder">${ladder.map((x) => `<button class="lad ${x === r ? 'me' : ''}" data-player="${esc(x.players[0].id)}"><span class="n num">${x.rank}</span><span class="nm">${flag(x.players[0].country)} ${esc(pname(x.players[0]))}</span><span class="bar"><i style="width:${Math.round(100 * (x.points || 0) / top)}%"></i></span><span class="pts num">${fmtNum(x.points)}</span></button>`).join('')}</div></section>`;
    }
    if (DB) html += `<section class="stack"><div class="section-h"><h2>Doubles ranking</h2></div><div class="facts rkfacts"><div><span class="eyebrow">Rank</span><b class="num">No. ${DB.r.rank}</b></div><div><span class="eyebrow">Points</span><b class="num">${fmtNum(DB.r.points)}</b></div>${DL && DL.r.rank !== DB.r.rank ? `<div><span class="eyebrow">Live</span><b class="num">No. ${DL.r.rank} · ${fmtNum(DL.r.points)}</b></div>` : ''}</div></section>`;
    const c = career[id];
    if (c === undefined) { career[id] = null; espnCareer(id).then((v) => { career[id] = v || false; if (S.sheet && S.sheet.id === id) renderSheet({ soft: true }); }).catch(() => { career[id] = false; }); }
    if (c && (c.singlesWon != null || c.singlesTitles != null)) {
      const w = c.singlesWon || 0, l = c.singlesLost || 0;
      html += `<section class="stack"><div class="section-h"><h2>Career</h2><span class="meta">from ESPN</span></div><div class="facts rkfacts">
        <div><span class="eyebrow">Singles W-L</span><b class="num">${w}-${l}${w + l ? `<small class="muted">${Math.round(100 * w / (w + l))}% won</small>` : ''}</b></div>
        <div><span class="eyebrow">Titles</span><b class="num">${c.singlesTitles ?? 0}${c.doublesTitles ? `<small class="muted">+ ${c.doublesTitles} doubles</small>` : ''}</b></div>
        ${c.prize ? `<div><span class="eyebrow">Prize money</span><b class="num">$${fmtNum(Math.round(c.prize))}</b></div>` : ''}</div></section>`;
    }
    return html;
  }

  // ---------------------------------------------------------------- phone notifications (hosted app)
  const PUSH = () => (window.BaselineLoader && window.BaselineLoader.push) || null;
  const pushSettings = () => ({ names: Object.fromEntries(S.favs.map((id) => [id, withD(dataFor(id), () => (player(id) && player(id).name) || id)])), notif: { ...S.notif }, tz: tz() });
  let syncTimer = null;
  function syncPush() { const P = PUSH(); if (!P) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => P.sync(pushSettings()).catch(() => { /* try again next time */ }), 1500); }
  function notifRow(perm) {
    const P = PUSH();
    const row = (text, btn = '') => `<div class="toggle-row"><div class="lbl"><b>Phone notifications</b><small>${text}</small></div>${btn}</div>`;
    if (!P) {
      return row(perm === 'granted' ? 'On. Alerts also show when the app is in the background.' : perm === 'denied' ? 'Blocked in this browser. Alerts still appear inside the app.' : perm === 'unsupported' ? (DIRECT ? 'Alerts show here while Baseline is open. With the Baseline widget on your Home Screen, your phone also gets a notification when a followed player starts or finishes a match.' : 'This preview can only show alerts inside the app.') : 'Allow alerts outside the app',
        perm === 'default' ? '<button class="btn" data-perm style="padding:8px 12px">Allow</button>' : '');
    }
    if (P.ios() && !P.standalone()) return row('Open Baseline from its Home Screen icon to turn on notifications.');
    if (!P.supported()) return row('This browser can’t receive notifications. Alerts still appear inside the app.');
    if (perm === 'granted' && S.pushRenew) return row('Tap Turn on once more to switch to the new always-on alerts.', '<button class="btn" data-perm style="padding:8px 12px">Turn on</button>');
    if (perm === 'granted') return row('On. Alerts come from the cloud, so they arrive even with your computer off and Baseline closed.', '<button class="btn" data-pushtest style="padding:8px 12px">Test</button>');
    if (perm === 'denied') return row('Turned off for Baseline. Turn them on in the iPhone Settings app: Notifications, then Baseline.');
    return row('Get alerts for your players even when Baseline is closed and your computer is off.', '<button class="btn" data-perm style="padding:8px 12px">Turn on</button>');
  }
  function toast(title, body, pid = null) {
    const box = $('#toasts'); if (!box) return; const el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = `${avatar({ id: pid }, 'sm')}<div><b>${esc(title)}</b><p>${esc(body)}</p></div>`;
    box.prepend(el); setTimeout(() => el.remove(), 5200);
  }
  function pushAlert(a) {
    S.feed.unshift({ ...a, at: new Date().toISOString() }); S.feed = S.feed.slice(0, 50); store.set('feed', S.feed);
    if (S.tab !== 'following' || S.view) { S.unread++; store.set('unread', S.unread); }
    toast(a.title, a.body, a.pid);
    // The hosted app's system notifications come from the computer (Web Push), so only the other versions show one here.
    try { if (!PUSH() && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(a.title, { body: a.body, tag: a.key }); } catch (e) { /* not allowed here */ }
  }
  const scoreLine = (m) => (m.a.sets || []).map((s, i) => `${s.g}-${m.b.sets?.[i]?.g ?? ''}`).join(' ');
  // Compare two live snapshots and alert for followed players.
  function diffLive(prev, next) {
    const pm = {}; Object.values(prev || {}).forEach((t) => t.matches.forEach((m) => { pm[t.id + m.id] = m; }));
    Object.values(next).forEach((t) => t.matches.forEach((raw) => {
      const m = fromLive(raw, t.id); const o = pm[t.id + raw.id];
      const favP = [...m.a.players, ...m.b.players].find((p) => isFav(p.id)); if (!favP) return;
      const inA = m.a.players.includes(favP); const me = inA ? m.a : m.b, op = inA ? m.b : m.a;
      const who = pname(favP), vs = op.players.map(shortName).join('/'); const city = tById(t.id)?.city || t.city;
      if (S.notif.start && m.status === 'live' && (!o || !['live'].includes(o.status))) pushAlert({ key: 'st' + raw.id, pid: favP.id, title: `${who} is on court`, body: `${roundShort(m.round)} vs ${vs} · ${city}${m.court ? ', ' + m.court : ''}` });
      if (S.notif.sets && o && m.status === 'live') { const a = setsWon(me.sets, op.sets), b = setsWon(inA ? o.a.sets : o.b.sets, inA ? o.b.sets : o.a.sets); if (a[0] + a[1] > b[0] + b[1]) pushAlert({ key: 'set' + raw.id + (a[0] + a[1]), pid: favP.id, title: `${who} ${a[0] > b[0] ? 'wins' : 'loses'} a set`, body: `${scoreLine(m)} vs ${vs} · ${city}` }); }
      if (S.notif.result && m.status === 'finished' && o && o.status !== 'finished') { const won = (m.winner === 0) === inA; pushAlert({ key: 'fin' + raw.id, pid: favP.id, title: `${who} ${won ? 'wins' : 'loses'}`, body: `${scoreLine(m)} vs ${vs} · ${city} ${roundShort(m.round)}` }); }
    }));
  }
  function diffSchedule(prevD, nextD) {
    if (!S.notif.schedule) return;
    const key = (m) => m.date + m.court + m.a.players.map((p) => p.id).join() + m.b.players.map((p) => p.id).join();
    const old = new Set(); if (prevD) for (const t of Object.keys(prevD.events || {})) { const save = D; D = prevD; scheduleItems(t).forEach((m) => old.add(key(m))); D = save; }
    for (const t of Object.keys(nextD.events || {})) for (const m of scheduleItems(t)) {
      if (old.has(key(m)) || m.score) continue;
      const favP = [...m.a.players, ...m.b.players].find((p) => isFav(p.id)); if (!favP) continue;
      const op = m.a.players.includes(favP) ? m.b : m.a;
      pushAlert({ key: 'sch' + key(m), pid: favP.id, title: `${pname(favP)} scheduled`, body: `vs ${op.players.map((p) => p.name).join('/') || 'TBD'} · ${m.court} · ${m.estUtc ? fmtWeekday(m.estUtc) + ' ' + fmtTime(m.estUtc) : ''}` });
    }
  }
  function testAlert() {
    const id = S.favs[0];
    if (!id) { pushAlert({ key: 'demo', pid: null, title: 'Follow a player first', body: 'Alerts are about the players you follow.' }); render(); return; }
    const st = playerStatus(id);
    pushAlert({ key: 'demo', pid: id, title: `${pname(player(id) || { id })} (preview)`, body: st.text });
    S._keepScroll = true; render();
  }

  // ---------------------------------------------------------------- fit to the phone
  // Works out the screen it's on and sets data-size on <html>: "sm" for small phones (SE, mini), "md" for the usual
  // 6.1"/6.3" phones, "lg" for Plus/Pro Max sizes, "xl" for tablets and landscape. The CSS sizes spacing, text and
  // columns from it, and the header shrinks while you scroll so the screen is mostly scores.
  // iPhone screens in points (portrait) and how much the status bar / Dynamic Island takes at the top of a
  // Home Screen app. Used only when iOS draws the app under the status bar but reports no safe area.
  const IPHONES = {
    '375x667': [20, 'iPhone SE / 8'], '414x736': [20, 'iPhone 8 Plus'],
    '375x812': [50, 'iPhone X / XS / 11 Pro / 12 mini / 13 mini'], '414x896': [48, 'iPhone XR / 11 / XS Max / 11 Pro Max'],
    '390x844': [47, 'iPhone 12 / 13 / 14 / 16e'], '428x926': [47, 'iPhone 12 Pro Max / 13 Pro Max / 14 Plus'],
    '393x852': [59, 'iPhone 14 Pro / 15 / 15 Pro / 16'], '430x932': [59, 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus'],
    '402x874': [62, 'iPhone 16 Pro / 17 / 17 Pro'], '440x956': [62, 'iPhone 16 Pro Max / 17 Pro Max'], '420x912': [62, 'iPhone Air'],
  };
  const SCREEN = {};
  function safeAreas() {
    const r = document.documentElement;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px)';
    document.body.appendChild(probe); const envTop = probe.offsetHeight; probe.remove();
    const ios = /iPhone|iPod/.test(navigator.userAgent);
    const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
    const sw = Math.min(screen.width, screen.height), sh = Math.max(screen.width, screen.height);
    const model = IPHONES[sw + 'x' + sh] || null;
    const portrait = innerHeight > innerWidth;
    // drawn from the very top of the screen (under the status bar) yet no inset reported: use the phone's known value
    let fallback = ios && standalone && portrait && envTop === 0 && model && innerHeight >= sh - 2;
    let top = fallback ? model[0] : envTop;
    if (S.topFix === 'on') { top = Math.max(envTop, model ? model[0] : 54); fallback = top !== envTop; }
    if (S.topFix === 'off') { top = 0; fallback = envTop !== 0; }
    if (fallback) r.style.setProperty('--safe-top', top + 'px'); else r.style.removeProperty('--safe-top');
    Object.assign(SCREEN, { model: model ? model[1] : null, size: sw + '×' + sh, view: innerWidth + '×' + innerHeight, envTop, top, standalone, fallback });
  }
  function fit() {
    try { safeAreas(); } catch (e) { /* layout still works with the CSS values */ }
    const r = document.documentElement; const dev = document.getElementById('device');
    const w = (dev && dev.clientWidth) || innerWidth, h = (dev && dev.clientHeight) || innerHeight;
    r.dataset.size = w >= 700 ? 'xl' : w >= 420 ? 'lg' : w >= 385 && h >= 720 ? 'md' : 'sm';
    r.dataset.short = h < 700 ? 'yes' : 'no';
    r.style.setProperty('--app-h', h + 'px');
  }
  fit(); addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 250));
  (function () {
    const scr = document.getElementById('screen'), top = document.getElementById('top');
    if (scr && top) scr.addEventListener('scroll', () => { lastScrollAt = Date.now(); if (S._refreshDue) whenIdle(); const on = top.classList.contains('mini'); const y = scr.scrollTop; if (!on && y > 48) top.classList.add('mini'); else if (on && y < 6) top.classList.remove('mini'); }, { passive: true });
  })();

  // ---------------------------------------------------------------- theme
  function applyTheme() { const r = document.documentElement; if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme); }

  // ---------------------------------------------------------------- events
  function toggleFav(id) {
    if (!id) return;
    S.favs = isFav(id) ? S.favs.filter((x) => x !== id) : [...S.favs, id];
    store.set('favs', S.favs);
    syncPush();
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tab],[data-open],[data-back],[data-sub],[data-scoresub],[data-calf],[data-calpast],[data-newsf],[data-rkkind],[data-rklist],[data-fav],[data-player],[data-drawplayer],[data-drawtype],[data-round],[data-restype],[data-notif],[data-perm],[data-pushtest],[data-testnotif],[data-clearfeed],[data-theme-set],[data-closesheet],[data-closesheetbtn],[data-topfix],[data-tour],[data-clearproblems],[data-rkmore]');
    if (!el) return;
    const d = el.dataset;
    if ('closesheet' in d) { if (e.target === el) goBack(); return; }
    if ('closesheetbtn' in d) { goBack(); return; }
    if (d.fav !== undefined) { toggleFav(d.fav); S._keepScroll = true; render(); return; }
    if (d.player !== undefined || d.drawplayer !== undefined) { const id = d.player ?? d.drawplayer; if (id) openSheet(id); return; }
    if (d.tab) { if (nav.mine()) { S._quietPop = true; history.go(-(history.state.baseline === 'sheet' && S.view ? 2 : 1)); } if (S.tab === d.tab && !S.view) { $('#screen').scrollTop = 0; return; } S.tab = d.tab; S.view = null; S.sheet = null; store.set('tab', S.tab); if (d.tab === 'following') { S.unread = 0; store.set('unread', 0); } if (d.tab === 'calendar') { const m = currentEvents()[0]?.start?.slice(0, 7); if (m) S._scrollTo = 'm-' + m; } const jump = !!S._scrollTo; if (!jump) $('#screen').scrollTop = 0; render(); if (!jump) $('#screen').scrollTop = 0; return; }
    if (d.open) { if (!S.view) nav.push('view'); S._prev = { tab: S.tab, scroll: $('#screen').scrollTop }; S.view = { type: 'tournament', id: d.open }; S.drawRound = null; S.drawQuery = ''; S.resDay = 0; S.schedDay = null; S.pastRound = null; render(); $('#screen').scrollTop = 0; return; }
    if ('back' in d) { goBack(); return; }
    if (d.sub) { S.view.sub = d.sub; render(); $('#screen').scrollTop = 0; return; }
    if (d.scoresub) S.scoresSub = d.scoresub;
    else if (d.calf) S.calFilter = d.calf;
    else if ('calpast' in d) S.calPast = !S.calPast;
    else if (d.newsf) S.newsFilter = d.newsf;
    else if (d.tour) { if (S.tour === d.tour) return; S.tour = d.tour; store.set('tour', S.tour); if (nav.mine()) { S._quietPop = true; history.go(-(history.state.baseline === 'sheet' && S.view ? 2 : 1)); } S.view = null; S.sheet = null; S.scoresSub = 'all'; S.calFilter = 'all'; S.newsFilter = 'All'; S.rkKind = 'singles'; S.rkList = 'sgl'; S.rkQuery = ''; if (S.tour === 'wta' && !DW) wtaRefresh(); if (S.tab === 'calendar') { render(); const m = currentEvents()[0]?.start?.slice(0, 7); if (m) S._scrollTo = 'm-' + m; } render(); $('#screen').scrollTop = 0; if (S._scrollTo) render(); return; }
    else if (d.rkkind) { S.rkMore = false; S.rkKind = d.rkkind; S.rkList = (S.tour === 'wta' ? RKW : RK)[d.rkkind][0][0]; }
    else if (d.rklist) { S.rkList = d.rklist; S.rkMore = false; }
    else if (d.drawtype) { S.drawType = d.drawtype; S.drawRound = null; }
    else if (d.round) S.drawRound = +d.round;
    else if (d.restype) { S.resType = d.restype; S.resDay = 0; S.pastRound = null; }
    else if (d.notif) { S.notif[d.notif] = !S.notif[d.notif]; store.set('notif', S.notif); syncPush(); S._keepScroll = true; }
    else if ('perm' in d) {
      const P = PUSH();
      if (P) {
        P.enable(pushSettings()).then((res) => { if (res === 'granted') { S.pushRenew = false; toast('Notifications are on', 'Tap Test to check one arrives.'); } S._keepScroll = true; render(); })
          .catch((err) => { toast('Couldn’t turn on notifications', String(err && err.message || err)); S._keepScroll = true; render(); });
      } else { try { Notification.requestPermission().then(() => { S._keepScroll = true; render(); }); } catch (err) { /* unsupported */ } }
      return;
    }
    else if ('pushtest' in d) {
      PUSH()?.sync(pushSettings(), { test: true }).then((j) => (j && j.test === 'ok' ? toast('Test sent', 'It should show up in a few seconds.') : toast('Test not sent', (j && j.test) || 'Turn notifications on first.')))
        .catch(() => toast('Couldn’t reach the relay', 'Check your connection and try again.'));
      return;
    }
    else if ('testnotif' in d) { testAlert(); return; }
    else if ('clearfeed' in d) { S.feed = []; store.set('feed', []); S._keepScroll = true; }
    else if ('rkmore' in d) { S.rkMore = true; S._keepScroll = true; }
    else if ('clearproblems' in d) { store.set('problems', []); S._keepScroll = true; }
    else if (d.topfix) { S.topFix = d.topfix; store.set('topfix', S.topFix); fit(); S._keepScroll = true; }
    else if (d.themeSet) { S.theme = d.themeSet; store.set('theme', S.theme); S._keepScroll = true; }
    render();
  });
  document.addEventListener('input', (e) => {
    const id = e.target.id; const map = { rkq: 'rkQuery', drawq: 'drawQuery', addq: 'addQuery' };
    if (!map[id]) return;
    S[map[id]] = e.target.value; const pos = e.target.selectionStart; S._keepScroll = true; render();
    const inp = document.getElementById(id); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
  });
  document.addEventListener('change', (e) => {
    const id = e.target.id, v = e.target.value;
    if (id === 'tzsel') { S.tz = v || null; store.set('tz', S.tz); syncPush(); S._keepScroll = true; render(); }
    else if (id === 'daysel') { S.resDay = +v; render(); }
    else if (id === 'schedsel') { S.schedDay = +v; render(); }
    else if (id === 'roundsel') { S.pastRound = v; render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.sheet || S.view)) goBack(); });

  // ---------------------------------------------------------------- getting back out: Back, swipes and the phone's back gesture
  // Opening a player or a tournament adds a step to the browser history, so Android's back gesture/button and a
  // computer's Back key close it like the on-screen Back. On the iPhone (no system back in Home Screen apps):
  // swipe the player panel down to close it, or swipe right from the left edge to leave a tournament.
  const nav = {
    push(kind) { try { history.pushState({ baseline: kind }, ''); } catch (e) { /* not allowed here */ } },
    mine: () => !!(history.state && history.state.baseline),
  };
  function openSheet(id) { if (!S.sheet) nav.push('sheet'); S.sheet = { id }; renderSheet(); const sh = $('.sheet'); if (sh) sh.scrollTop = 0; }
  function closeTop() { // close the panel if one is open, else leave the tournament
    if (S.sheet) {
      const w = $('.sheet-wrap'); S.sheet = null;
      if (w) { w.classList.add('closing'); setTimeout(() => { if (!S.sheet) renderSheet(); }, 200); } else renderSheet();
      return;
    }
    if (S.view) { S.view = null; render(); if (S._prev) $('#screen').scrollTop = S._prev.scroll; }
  }
  // Close straight away; the matching history step is removed quietly so the phone's Back stays in step.
  function goBack() {
    if (nav.mine()) { S._quietPop = true; setTimeout(() => { S._quietPop = false; }, 600); history.back(); }
    closeTop();
  }
  addEventListener('popstate', () => { if (S._quietPop) { S._quietPop = false; return; } if (S.sheet || S.view) closeTop(); });

  // Swipe the player panel down to close it (from its top bar at any time, or anywhere once it is scrolled to the top).
  (function () {
    let g = null;
    document.addEventListener('touchstart', (e) => {
      const sh = e.target.closest && e.target.closest('.sheet');
      g = sh && e.touches.length === 1 ? { sh, x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), bar: !!e.target.closest('.sheet-bar'), dy: 0, on: false } : null;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!g) return;
      const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
      if (!g.on) {
        if (dy > 6 && dy > Math.abs(dx) && (g.bar || g.sh.scrollTop <= 0)) g.on = true;
        else if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { g = null; return; } else return;
      }
      e.preventDefault();
      g.dy = Math.max(0, dy - 6);
      g.sh.style.transition = 'none'; g.sh.style.transform = `translateY(${g.dy}px)`;
      g.sh.parentNode.style.opacity = String(Math.max(0.35, 1 - g.dy / 500));
    }, { passive: false });
    const end = () => {
      if (!g || !g.on) { g = null; return; }
      const { sh, dy } = g; const fast = dy / Math.max(1, Date.now() - g.t) > 0.5; g = null;
      sh.style.transition = 'transform .2s ease';
      if (dy > 110 || (fast && dy > 30)) { sh.style.transform = 'translateY(105%)'; goBack(); }
      else { sh.style.transform = ''; sh.parentNode.style.opacity = ''; }
    };
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
  })();

  // Swipe right from the left edge to go back from a tournament (like the iPhone's own back swipe).
  (function () {
    let g = null;
    const parts = () => [$('#top'), $('#screen')];
    document.addEventListener('touchstart', (e) => {
      const x = e.touches[0].clientX - ($('#device')?.getBoundingClientRect().left || 0);
      g = S.view && !S.sheet && e.touches.length === 1 && x < 26 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false, dx: 0 } : null;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!g) return;
      const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
      if (!g.on) { if (dx > 10 && dx > Math.abs(dy) * 1.5) g.on = true; else if (Math.abs(dy) > 10) { g = null; return; } else return; }
      e.preventDefault(); g.dx = Math.max(0, dx);
      parts().forEach((el) => { if (el) { el.style.transition = 'none'; el.style.transform = `translateX(${g.dx}px)`; } });
    }, { passive: false });
    const end = () => {
      if (!g || !g.on) { g = null; return; }
      const go = g.dx > 80; g = null;
      parts().forEach((el) => { if (el) { el.style.transition = 'transform .18s ease'; el.style.transform = go ? 'translateX(100%)' : ''; } });
      setTimeout(() => { parts().forEach((el) => { if (el) { el.style.transition = ''; el.style.transform = ''; } }); if (go) goBack(); }, go ? 170 : 200);
    };
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
  })();
  // tap a pop-up alert to dismiss it
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.toast'); if (t) t.remove(); });

  // ---------------------------------------------------------------- boot
  const loadData = async () => { if (window.BaselineLoader) return window.BaselineLoader.data(); const r = await fetch('/api/data'); if (!r.ok) throw new Error('server ' + r.status); return r.json(); };
  const loadLive = async () => (window.BaselineLoader ? window.BaselineLoader.live() : (await fetch('/api/live')).json());
  // Last good data bundle, kept on the device so the app opens instantly and still shows something offline.
  const cache = {
    load() { try { return JSON.parse(localStorage.getItem('baseline.cache') || 'null'); } catch (e) { return null; } },
    save(d) { try { localStorage.setItem('baseline.cache', JSON.stringify(d)); } catch (e) { /* full or unavailable */ } },
  };
  const DIRECT = !!(window.BaselineLoader && window.BaselineLoader.direct);
  const setFlags = async () => { try { const f = D.flagsSvg || await (await fetch('/api/flags.svg')).text(); $('#flags').innerHTML = f; } catch (e) { /* flags optional */ } };
  const cacheW = {
    load() { try { return JSON.parse(localStorage.getItem('baseline.cacheW') || 'null'); } catch (e) { return null; } },
    save(d) { try { localStorage.setItem('baseline.cacheW', JSON.stringify(d)); } catch (e) { /* full or unavailable */ } },
  };
  // WTA: everything on first use, then this week's matches (live scores, results, order of play) every 20 s while the
  // WTA side is on screen, every minute if you only follow WTA players, and the calendar/rankings every 10 minutes.
  let wtaBusy = false;
  async function wtaRefresh(matchesOnly = false) {
    if (wtaBusy) return; wtaBusy = true;
    try {
      const W = await loadWta(DW, { matchesOnly: matchesOnly && !!DW });
      const prevLive = DW && DW.live; DW = W; S.wtaError = null;
      // keep a copy for instant opening, but not every 20 s: writing half a megabyte that often makes a phone stutter
      if (!matchesOnly || Date.now() - (S._wtaSavedAt || 0) > 3 * 60e3) { cacheW.save(DW); S._wtaSavedAt = Date.now(); }
      if (prevLive) withD(DW, () => diffLive(prevLive, DW.live));
      if (S.tour === 'wta') refresh();
    } catch (e) { S.wtaError = String(e && e.message || e); if (S.tour === 'wta' && !DW) render(); }
    finally { wtaBusy = false; }
  }
  async function boot() {
    if (window.ATP_DATA) DA = D = window.ATP_DATA;
    else {
      const saved = cache.load(); const savedW = cacheW.load();
      if (savedW && savedW.tournaments) DW = savedW;
      if (saved && saved.tournaments) { DA = D = saved; await setFlags(); render(); }
      else {
        $('#screen').innerHTML = '<div class="pad"><div class="empty" id="firstload">Loading the latest from atptour.com…</div></div>';
        // First launch on the phone reads every page slowly (about a minute); after that the app opens from its saved copy.
        window.addEventListener('baseline-progress', (e) => { const el = document.getElementById('firstload'); if (el && e.detail.total) el.textContent = `Setting up for the first time… ${e.detail.done} of ${e.detail.total} pages. This takes about a minute, once.`; });
      }
      try { const fresh = await loadData(); const prev = DA; DA = D = fresh; cache.save(DA); await setFlags(); if (prev) { S._keepScroll = true; } }
      catch (e) {
        if (!DA) { $('#screen').innerHTML = `<div class="pad"><div class="empty">Couldn't load data from atptour.com (${esc(e.message)}). ${DIRECT || window.BaselineLoader?.hosted ? 'Check your connection, wait a minute, then reopen Baseline.' : 'Check the Baseline window is still open, then reload.'}</div></div>`; return; }
      }
    }
    if (window.ATP_FLAGS) $('#flags').innerHTML = window.ATP_FLAGS;
    if (S.tab === 'calendar') { const m = withD((S.tour === 'wta' ? DW : DA) || DA, () => currentEvents()[0]?.start?.slice(0, 7)); if (m) S._scrollTo = 'm-' + m; }
    render();
    wtaRefresh();
    const fillFromEspn = () => espnRefresh().then((used) => { if (used && S.tour === 'atp') refresh(); }).catch(() => {});
    if (LIVE_MODE && !DIRECT) { fillFromEspn(); setInterval(() => { if (!document.hidden) fillFromEspn(); }, 3 * 60e3); }
    syncPush(); // keeps the alerts service's copy of followed players and alert switches current
    PUSH()?.needsTurnOn().then((v) => { if (v !== !!S.pushRenew) { S.pushRenew = v; refresh(); } }).catch(() => {});
    const calm = () => !document.querySelector('input:focus, select:focus');
    if (LIVE_MODE) {
      setInterval(async () => { if (document.hidden || !DA) return; try { const A = DA; const L = await loadLive(); const prev = A.live; A.live = L.live; A.generatedAt = L.at; withD(A, () => diffLive(prev, A.live)); if (S.tour === 'atp') refresh(); } catch (e) { /* retry next tick */ } }, 20000);
      // The full refresh re-reads about 30 pages, so on the phone (no server in between) it runs less often.
      setInterval(async () => { if (document.hidden) return; try { const N = await loadData(); const prev = DA; DA = N; await espnRefresh().catch(() => {}); cache.save(DA); withD(DA, () => diffSchedule(prev, N)); if (S.tour === 'atp') refresh(); } catch (e) { /* retry */ } }, DIRECT ? 600000 : 300000);
    }
    let wtaTicks = 0;
    setInterval(() => {
      if (document.hidden) return; wtaTicks++;
      if (wtaTicks % 30 === 0) wtaRefresh(false);
      else if (S.tour === 'wta' || (wtaTicks % 3 === 0 && S.favs.some((id) => /^W\d/.test(id)))) wtaRefresh(true);
    }, 20000);
  }

  // What the iPhone home-screen widget shows between its own live-score checks (read by the Scriptable launcher).
  function widgetSummary() {
    if (!D) return null;
    return {
      at: new Date().toISOString(), tz: tz(), favs: S.favs.slice(),
      players: S.favs.map((id) => withD(dataFor(id), () => { const p = player(id) || { id, name: id }; let st = { text: '' }; try { st = playerStatus(id); } catch (e) { /* partial data */ } return { id, name: p.name, short: shortName({ id, name: p.name }), rank: p.rank || null, status: st.text, live: !!st.live }; })),
    };
  }
  window.BaselineApp = { boot, diffLive: (a, b) => diffLive(a, b), get data() { return D; }, widget: widgetSummary,
    wtaGroups: async (tid, year) => { const t = DW.tournaments.find((x) => x.id === String(tid)); const j = await espnJson(`${SERVICE()}/wta/matches/${tid}/${year}`, 60e3); const ev = wtaEvent({ ...t, year }, j).event; return { groups: ev.groups.map((g) => g.name + ': ' + g.rows.map((r) => `${r.pos}. ${r.players.map((p) => p.name.split(' ').pop()).join('/')} ${r.matches}`).join(', ')), bracket: ev.draws && ev.draws.rounds.map((r) => r.name + ' ' + r.matches.length) }; },
    espnEvent: async (tid, year) => { const t = tById(tid); delete S.espn[tid + ':' + year]; await loadEspnEvent(t, year); const E = S.espn[tid + ':' + year]; return E.ev ? { name: E.ev.name, where: E.ev.where, matches: E.ev.matches.length } : E; } };
  boot();
})();
