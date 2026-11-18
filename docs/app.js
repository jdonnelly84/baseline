/* Baseline — ATP scores, draws, calendar, news and rankings.
   Data comes from window.ATP_DATA (preview snapshot) or /api/data (live server). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  let D = null;                      // the data bundle
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
    espn: {},                         // ESPN lookups for past events and last year's editions: { 'tid:year': {loading|error|ev} }
    favs: store.get('favs', ['S0AG', 'A0E2']),
    notif: store.get('notif', { start: true, sets: false, result: true, schedule: true }),
    tz: store.get('tz', null),
    theme: store.get('theme', 'system'),
    feed: store.get('feed', []),
    unread: store.get('unread', 0),
    sheet: null,
    addQuery: '',
  };
  const tz = () => S.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Pacific/Auckland';
  const nowRef = () => (D && D.source === 'snapshot' ? new Date(D.generatedAt) : new Date());

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('en-NZ'));
  const catClass = (t) => ({ GS: 'GS', '1000': 'm1000', '500': 'a500', '250': 'a250' }[t] || '');
  const catLabel = (t) => ({ GS: 'GS', '1000': '1000', '500': '500', '250': '250', WC: 'FINALS', XXI: 'NEXTGEN', DCR: 'DAVIS', UC: 'UNITED', LVR: 'LAVER' }[t] || t);
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
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp';
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
      espnMem.set(url, rec); kv.set(url, rec);
      return rec.v;
    } catch (e) { if (hit) return hit.v; throw e; }
  }
  const normName = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  const nameKeys = (s) => { const n = normName(s); return [n.replace(/ /g, ''), n.split(' ').sort().join('')]; };
  // ESPN names → ATP player ids (exact name, or the same words in another order, e.g. "Wu Yibing" / "Yibing Wu")
  let idIdx = null, idIdxFor = null;
  function atpId(name) {
    if (idIdxFor !== D) {
      idIdx = new Map(); idIdxFor = D;
      const add = (p) => { if (p && p.id && p.name && !p.name.includes('.')) for (const k of nameKeys(p.name)) if (!idIdx.has(k)) idIdx.set(k, p.id); };
      Object.values(D.players || {}).forEach(add);
      Object.values(D.rankings || {}).forEach((R) => (R.rows || []).forEach((r) => r.players.forEach(add)));
    }
    for (const k of nameKeys(name)) if (idIdx.has(k)) return idIdx.get(k);
    return null;
  }
  const espnEids = new Map(); // ATP id → ESPN athlete id, learnt from ESPN's rankings and matches

  // A week of ESPN's scoreboard, cut down to the men's events and what Baseline shows.
  function shrinkWeek(j) {
    return (j.events || []).map((e) => {
      const matches = [];
      for (const g of e.groupings || []) {
        const slug = g.grouping && g.grouping.slug; if (slug !== 'mens-singles' && slug !== 'mens-doubles') continue;
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
          matches.push({ id: c.id, dbl: slug === 'mens-doubles', round: (c.round && c.round.displayName) || '', utc: c.date, timed: !!c.timeValid,
            state: c.status && c.status.type && c.status.type.state, status: c.status && c.status.type && c.status.type.name,
            court: (c.venue && c.venue.court) || '', note, a: side(cs[0]), b: side(cs[1]) });
        }
      }
      const v = e.venue || {};
      return { id: e.id, name: e.name, start: e.date, end: e.endDate, where: v.displayName || v.fullName || '', matches };
    }).filter((e) => e.matches.length);
  }
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const espnWeek = (date, maxAge) => espnJson(`${ESPN}/scoreboard?dates=${ymd(date)}`, maxAge, shrinkWeek);
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
  async function loadEspnEvent(t, year) {
    const key = t.id + ':' + year;
    if (S.espn[key] && !S.espn[key].error) return;
    S.espn[key] = { loading: true };
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
    S._keepScroll = true; render();
  }
  function espnResultsView(t, year) {
    const E = S.espn[t.id + ':' + year];
    if (!E) { setTimeout(() => loadEspnEvent(t, year), 0); return '<div class="empty">Loading results…</div>'; }
    if (E.loading) return '<div class="empty">Loading results…</div>';
    if (E.error) return `<div class="empty">${esc(E.error)}</div>`;
    const dbl = S.resType === 'dbl';
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

  // When the computer's ATP data is old (computer off), fill this week's results, order of play and draws from ESPN.
  async function espnRefresh() {
    if (!D || !D.dataAt || Date.now() - new Date(D.dataAt) < 90 * 60e3) return false;
    const today = new Date().toISOString().slice(0, 10);
    const ts = D.tournaments.filter((t) => ['250', '500', '1000', 'GS', 'WC', 'XXI'].includes(t.type) && t.start && t.start <= today && t.end >= new Date(Date.now() - 864e5).toISOString().slice(0, 10));
    if (!ts.length) return false;
    let week; try { week = await espnNow(); } catch (e) { return false; }
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
      try { const rk = await espnJson(`${ESPN}/rankings`, 12 * 3600e3, (j) => ((j.rankings && j.rankings[0] && j.rankings[0].ranks) || []).map((r) => ({ eid: r.athlete && r.athlete.id, name: r.athlete && r.athlete.displayName }))); rk.forEach((r) => { const a = atpId(r.name); if (a && r.eid && !espnEids.has(a)) espnEids.set(a, r.eid); }); } catch (e) { return null; }
    }
    const eid = espnEids.get(id); if (!eid) return null;
    return espnJson(`${ESPN_CORE}/athletes/${eid}/statistics`, 24 * 3600e3, (j) => { const o = {}; ((j.splits && j.splits.categories) || []).forEach((c) => (c.stats || []).forEach((s) => { o[s.name] = s.value; })); return o; });
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
  function render() {
    const scr = $('#screen'); const keep = scr && S._keepScroll ? scr.scrollTop : 0;
    applyTheme();
    let head = '', body = '';
    if (S.view && S.view.type === 'tournament') ({ head, body } = viewTournament(S.view));
    else ({ head, body } = ({ scores: viewScores, calendar: viewCalendar, news: viewNews, rankings: viewRankings, following: viewFollowing }[S.tab])());
    $('#top').innerHTML = head;
    $('#screen').innerHTML = body;
    $('#nav').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k && !S.view ? 'on' : ''}" aria-label="${l}">${ICON[k]}<span>${l}</span>${k === 'following' && S.unread ? `<span class="dot">${S.unread}</span>` : ''}</button>`).join('');
    renderSheet();
    if (S._keepScroll) { $('#screen').scrollTop = keep; S._keepScroll = false; }
    if (S._scrollTo) { const el = document.getElementById(S._scrollTo); if (el) $('#screen').scrollTop = el.offsetTop - 60; S._scrollTo = null; }
  }
  const tourSwitch = '<div class="tour-switch" title="WTA coming later"><span class="on">ATP</span><span class="off">WTA</span></div>';
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

    const head = `<div class="top-row"><h1>Scores</h1>${tourSwitch}</div><div class="sub">${snapNote()}</div>
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
    const espnOk = !['UC', 'DCR', 'LVR'].includes(t.type) && !!t.start;
    const subs = hasEvent ? [['live', 'Live'], ['results', 'Results'], ['schedule', 'Schedule'], ['draw', 'Draws'], ['about', 'About']]
      : st === 'past' ? [...(espnOk ? [['past', 'Results']] : []), ['about', 'Overview']]
      : [['about', 'Overview'], ['field', t.type === 'WC' || t.type === 'XXI' ? 'Qualifying' : 'Projected field'], ...(espnOk ? [['lastyear', `${year - 1} results`]] : [])];
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
      body = fieldView(t);
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
    const F = { all: () => true, GS: (t) => t.type === 'GS', 1000: (t) => t.type === '1000', 500: (t) => t.type === '500', 250: (t) => t.type === '250', other: (t) => !['GS', '1000', '500', '250'].includes(t.type) };
    const list = D.tournaments.filter(F[S.calFilter]).filter((t) => S.calPast || tournamentState(t) !== 'past');
    const byMonth = {};
    list.forEach((t) => { const k = (t.start || '').slice(0, 7); (byMonth[k] ||= []).push(t); });
    const head = `<div class="top-row"><h1>Calendar</h1>${tourSwitch}</div><div class="sub">${D.tournaments[0]?.start?.slice(0, 4)} season · ${D.tournaments.length} events</div>
      <div class="tabs">${[['all', 'All'], ['GS', 'Grand Slams'], ['1000', 'Masters 1000'], ['500', 'ATP 500'], ['250', 'ATP 250'], ['other', 'Team & Finals']].map(([k, l]) => `<button data-calf="${k}" class="${S.calFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
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
    const head = `<div class="top-row"><h1>Latest</h1>${tourSwitch}</div><div class="sub">From atptour.com</div>
      <div class="tabs">${tags.map((t) => `<button data-newsf="${esc(t)}" class="${S.newsFilter === t ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
    // Lead with the first story that has a picture; the rest keep their order.
    const li = Math.max(0, items.findIndex((n) => img(n))); const lead = items[li]; const rest = items.filter((n, i) => i !== li);
    const body = `<div class="pad">
      ${lead ? `<a class="lead" href="${esc(lead.url)}" target="_blank" rel="noopener"><div class="img" style="background-image:url('${esc(img(lead))}')"></div><div class="body"><span class="tag">${esc(lead.video ? 'Video' : lead.tag || 'News')}</span><h3>${esc(lead.title)}</h3>${lead.author ? `<span class="muted" style="font-size:12.5px">${esc(lead.author)}</span>` : ''}</div></a>` : '<div class="empty">No stories.</div>'}
      <div class="list">${rest.map((n) => `<a class="story" href="${esc(n.url)}" target="_blank" rel="noopener"><div><span class="tag">${esc(n.video ? 'Video' : n.tag || 'News')}</span><h4>${esc(n.title)}</h4></div><div class="thumb" style="background-image:url('${esc(img(n))}')">${n.video ? '<span class="play"></span>' : ''}</div></a>`).join('')}</div>
      <p class="note" style="text-align:center">Stories open on atptour.com.</p>
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Rankings
  const RK = {
    singles: [['sgl', 'Official'], ['sgl_live', 'Live'], ['sgl_race', 'Race to Turin'], ['nextgen', 'Next Gen race']],
    doubles: [['dbl', 'Official'], ['dbl_live', 'Live'], ['dbl_race', 'Team race']],
  };
  function viewRankings() {
    const lists = RK[S.rkKind];
    if (!lists.some(([k]) => k === S.rkList)) S.rkList = lists[0][0];
    const R = D.rankings[S.rkList] || { rows: [] };
    const q = S.rkQuery.trim().toLowerCase();
    const rows = R.rows.filter((r) => !q || r.players.some((p) => pname(p).toLowerCase().includes(q)));
    const cut = { sgl_race: 8, nextgen: 7, dbl_race: 8 }[S.rkList];
    const head = `<div class="top-row"><h1>Rankings</h1>${tourSwitch}</div><div class="sub">PIF ATP Rankings${R.asOf ? ' · ' + esc(R.asOf.replace(/\./g, '-')) : ''}</div>
      <div class="tabs">${lists.map(([k, l]) => `<button data-rklist="${k}" class="${S.rkList === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sub = (r) => {
      if (S.rkList.endsWith('_live')) return r.current ? esc(r.current) : r.age ? `Age ${esc(r.age)}` : '';
      if (S.rkList === 'sgl' || S.rkList === 'dbl') return [r.age && `Age ${esc(r.age)}`, r.tourns && `${r.tourns} events`, r.dropping && `dropping ${fmtNum(r.dropping)}`].filter(Boolean).join(' · ');
      return r.age ? `Age ${esc(r.age)}` : '';
    };
    const body = `<div class="pad" style="gap:12px">
      <div class="seg">${[['singles', 'Singles'], ['doubles', 'Doubles']].map(([k, l]) => `<button data-rkkind="${k}" class="${S.rkKind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="search">${ICON.search}<input id="rkq" placeholder="Search players" value="${esc(S.rkQuery)}" autocomplete="off"></div>
      ${S.rkList === 'sgl_race' ? '<p class="note" style="margin:0">The top 8 at the end of the season qualify for the Nitto ATP Finals in Turin.</p>' : S.rkList === 'nextgen' ? '<p class="note" style="margin:0">Players 21 and under. The top 7 qualify for the Next Gen ATP Finals.</p>' : S.rkList.endsWith('_live') ? '<p class="note" style="margin:0">Live rankings include points won and dropped this week.</p>' : '<p class="note" style="margin:0">Tap a player for their points, movement and who’s around them.</p>'}
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
    const matches = q ? Object.values(D.players).filter((p) => p.name && p.name.toLowerCase().includes(q) && !p.name.includes('/')).sort((a, b) => (a.rank || 9999) - (b.rank || 9999)).slice(0, 8) : [];
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    const head = `<div class="top-row"><h1>Following</h1></div><div class="sub">${S.favs.length} player${S.favs.length === 1 ? '' : 's'} · alerts for their matches</div><div class="tabs lone"></div>`;
    const body = `<div class="pad">
      <section class="stack"><div class="section-h"><h2>Your players</h2></div>
        <div class="list">${S.favs.map((id) => { const p = player(id) || { id, name: id }; const st = playerStatus(id); return `<div class="fav-card">${avatar(p)}<button data-player="${esc(id)}" style="text-align:left;min-width:0"><b>${flag(p.country)} ${esc(p.name)}</b><div class="st ${st.live ? 'live' : ''}">${esc(st.text)}</div></button><button class="star on" data-fav="${esc(id)}" aria-label="Unfollow">${ICON.star}</button></div>`; }).join('') || '<div class="empty" style="border:0">Follow players from here, the rankings or any match.</div>'}</div>
        <div class="search">${ICON.search}<input id="addq" placeholder="Add a player" value="${esc(S.addQuery)}" autocomplete="off"></div>
        ${matches.length ? `<div class="list">${matches.map((p) => `<div class="fav-card">${avatar(p, 'sm')}<button data-player="${esc(p.id)}" style="text-align:left"><b>${flag(p.country)} ${esc(p.name)}</b><div class="st">${p.rank ? 'Singles No. ' + p.rank : p.dblRank ? 'Doubles No. ' + p.dblRank : ''}</div></button><button class="star ${isFav(p.id) ? 'on' : ''}" data-fav="${esc(p.id)}">${isFav(p.id) ? ICON.star : ICON.starO}</button></div>`).join('')}</div>` : ''}
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
          <div class="toggle-row"><div class="lbl"><b>Data</b><small>${D.source === 'snapshot' ? 'Preview snapshot taken ' + esc(new Date(D.generatedAt).toLocaleString('en-NZ', { timeZone: tz(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + '. The installed app refreshes live.' : (D.dataAt ? 'Live scores straight from ATP every 20 s. Draws, order of play, results and rankings from the updater on your computer, last refreshed ' + esc(ago(D.dataAt)) + '.' : 'Live from atptour.com · scores every 20 s, everything else every 5 min')}</small></div></div>
        </div>
      </section>
    </div>`;
    return { head, body };
  }

  // ---------------------------------------------------------------- Player sheet
  function renderSheet() {
    const host = $('#sheet');
    if (!S.sheet) { host.innerHTML = ''; return; }
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
    host.innerHTML = `<div class="sheet-wrap" data-closesheet><div class="sheet" role="dialog" aria-label="${esc(p.name)}">
      <div class="grab"></div>
      <div class="pl-head">${avatar(p, 'lg')}<div style="flex:1;min-width:0"><div class="eyebrow">${flag(p.country)} ${esc(p.country || '')}${sg?.age ? ' · Age ' + esc(sg.age) : ''}</div><h3>${esc(p.name)}</h3><div class="muted" style="font-size:13px;margin-top:4px;${st.live ? 'color:var(--live);font-weight:700' : ''}">${esc(st.text)}</div></div></div>
      <div class="stat-row">
        <div class="stat"><b class="num">${sg ? sg.rank : '–'}</b><span>Singles</span></div>
        <div class="stat"><b class="num">${rc ? rc.rank : ng ? ng.rank : lv ? lv.rank : '–'}</b><span>${rc ? 'Race' : ng ? 'Next Gen' : 'Live'}</span></div>
        <div class="stat"><b class="num">${db ? db.rank : '–'}</b><span>Doubles</span></div>
      </div>
      <div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-fav="${esc(id)}">${isFav(id) ? ICON.star + ' Following' : ICON.starO + ' Follow'}</button>
        ${slug ? `<a class="btn ghost" href="https://www.atptour.com/en/players/${slug}/${id.toLowerCase()}/overview" target="_blank" rel="noopener">${ICON.ext} Profile</a>` : ''}</div>
      ${rankingBlock(id)}
      ${pathHtml}
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
        R ? ['Race to Turin', `No. ${R.r.rank} · ${fmtNum(R.r.points)}<small class="muted">points this season</small>`] : N ? ['Next Gen race', `No. ${N.r.rank} · ${fmtNum(N.r.points)}`] : null,
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
    if (c === undefined) { career[id] = null; espnCareer(id).then((v) => { career[id] = v || false; if (S.sheet && S.sheet.id === id) renderSheet(); }).catch(() => { career[id] = false; }); }
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
  const pushSettings = () => ({ names: Object.fromEntries(S.favs.map((id) => [id, (player(id) && player(id).name) || id])), notif: { ...S.notif }, tz: tz() });
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
  function fit() {
    const r = document.documentElement; const dev = document.getElementById('device');
    const w = (dev && dev.clientWidth) || innerWidth, h = (dev && dev.clientHeight) || innerHeight;
    r.dataset.size = w >= 700 ? 'xl' : w >= 420 ? 'lg' : w >= 385 && h >= 720 ? 'md' : 'sm';
    r.dataset.short = h < 700 ? 'yes' : 'no';
    r.style.setProperty('--app-h', h + 'px');
  }
  fit(); addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 250));
  (function () {
    const scr = document.getElementById('screen'), top = document.getElementById('top');
    if (scr && top) scr.addEventListener('scroll', () => { const on = top.classList.contains('mini'); const y = scr.scrollTop; if (!on && y > 48) top.classList.add('mini'); else if (on && y < 6) top.classList.remove('mini'); }, { passive: true });
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
    const el = e.target.closest('[data-tab],[data-open],[data-back],[data-sub],[data-scoresub],[data-calf],[data-calpast],[data-newsf],[data-rkkind],[data-rklist],[data-fav],[data-player],[data-drawplayer],[data-drawtype],[data-round],[data-restype],[data-notif],[data-perm],[data-pushtest],[data-testnotif],[data-clearfeed],[data-theme-set],[data-closesheet]');
    if (!el) return;
    const d = el.dataset;
    if ('closesheet' in d) { if (e.target === el) { S.sheet = null; renderSheet(); } return; }
    if (d.fav !== undefined) { toggleFav(d.fav); S._keepScroll = true; render(); return; }
    if (d.player !== undefined || d.drawplayer !== undefined) { const id = d.player ?? d.drawplayer; if (id) { S.sheet = { id }; renderSheet(); } return; }
    if (d.tab) { if (S.tab === d.tab && !S.view) { $('#screen').scrollTop = 0; return; } S.tab = d.tab; S.view = null; S.sheet = null; store.set('tab', S.tab); if (d.tab === 'following') { S.unread = 0; store.set('unread', 0); } if (d.tab === 'calendar') { const m = currentEvents()[0]?.start?.slice(0, 7); if (m) S._scrollTo = 'm-' + m; } render(); if (!S._scrollTo) $('#screen').scrollTop = 0; return; }
    if (d.open) { S._prev = { tab: S.tab, scroll: $('#screen').scrollTop }; S.view = { type: 'tournament', id: d.open }; S.drawRound = null; S.drawQuery = ''; S.resDay = 0; S.schedDay = null; S.pastRound = null; render(); $('#screen').scrollTop = 0; return; }
    if ('back' in d) { S.view = null; render(); if (S._prev) $('#screen').scrollTop = S._prev.scroll; return; }
    if (d.sub) { S.view.sub = d.sub; render(); $('#screen').scrollTop = 0; return; }
    if (d.scoresub) S.scoresSub = d.scoresub;
    else if (d.calf) S.calFilter = d.calf;
    else if ('calpast' in d) S.calPast = !S.calPast;
    else if (d.newsf) S.newsFilter = d.newsf;
    else if (d.rkkind) { S.rkKind = d.rkkind; S.rkList = RK[d.rkkind][0][0]; }
    else if (d.rklist) S.rkList = d.rklist;
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); } });

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
  async function boot() {
    if (window.ATP_DATA) D = window.ATP_DATA;
    else {
      const saved = cache.load();
      if (saved && saved.tournaments) { D = saved; await setFlags(); render(); }
      else {
        $('#screen').innerHTML = '<div class="pad"><div class="empty" id="firstload">Loading the latest from atptour.com…</div></div>';
        // First launch on the phone reads every page slowly (about a minute); after that the app opens from its saved copy.
        window.addEventListener('baseline-progress', (e) => { const el = document.getElementById('firstload'); if (el && e.detail.total) el.textContent = `Setting up for the first time… ${e.detail.done} of ${e.detail.total} pages. This takes about a minute, once.`; });
      }
      try { const fresh = await loadData(); const prev = D; D = fresh; cache.save(D); await setFlags(); if (prev) { S._keepScroll = true; } }
      catch (e) {
        if (!D) { $('#screen').innerHTML = `<div class="pad"><div class="empty">Couldn't load data from atptour.com (${esc(e.message)}). ${DIRECT || window.BaselineLoader?.hosted ? 'Check your connection, wait a minute, then reopen Baseline.' : 'Check the Baseline window is still open, then reload.'}</div></div>`; return; }
      }
    }
    if (window.ATP_FLAGS) $('#flags').innerHTML = window.ATP_FLAGS;
    S.favs = S.favs.filter((id) => D.players[id] || true);
    if (S.tab === 'calendar') { const m = currentEvents()[0]?.start?.slice(0, 7); if (m) S._scrollTo = 'm-' + m; }
    render();
    const fillFromEspn = () => espnRefresh().then((used) => { if (used && !document.querySelector('input:focus, select:focus')) { S._keepScroll = true; render(); } }).catch(() => {});
    if (LIVE_MODE && !DIRECT) { fillFromEspn(); setInterval(() => { if (!document.hidden) fillFromEspn(); }, 3 * 60e3); }
    syncPush(); // keeps the alerts service's copy of followed players and alert switches current
    PUSH()?.needsTurnOn().then((v) => { if (v !== !!S.pushRenew) { S.pushRenew = v; S._keepScroll = true; render(); } }).catch(() => {});
    if (LIVE_MODE) {
      setInterval(async () => { if (document.hidden) return; try { const L = await loadLive(); const prev = D.live; D.live = L.live; D.generatedAt = L.at; diffLive(prev, D.live); if (!document.querySelector('input:focus')) { S._keepScroll = true; render(); } } catch (e) { /* retry next tick */ } }, 20000);
      // The full refresh re-reads about 30 pages, so on the phone (no server in between) it runs less often.
      setInterval(async () => { if (document.hidden) return; try { const N = await loadData(); const prev = D; D = N; await espnRefresh().catch(() => {}); cache.save(D); diffSchedule(prev, N); if (!document.querySelector('input:focus, select:focus')) { S._keepScroll = true; render(); } } catch (e) { /* retry */ } }, DIRECT ? 600000 : 300000);
    }
  }
  // What the iPhone home-screen widget shows between its own live-score checks (read by the Scriptable launcher).
  function widgetSummary() {
    if (!D) return null;
    return {
      at: new Date().toISOString(), tz: tz(), favs: S.favs.slice(),
      players: S.favs.map((id) => { const p = player(id) || { id, name: id }; let st = { text: '' }; try { st = playerStatus(id); } catch (e) { /* partial data */ } return { id, name: p.name, short: shortName({ id, name: p.name }), rank: p.rank || null, status: st.text, live: !!st.live }; }),
    };
  }
  window.BaselineApp = { boot, diffLive: (a, b) => diffLive(a, b), get data() { return D; }, widget: widgetSummary,
    espnEvent: async (tid, year) => { const t = tById(tid); delete S.espn[tid + ':' + year]; await loadEspnEvent(t, year); const E = S.espn[tid + ':' + year]; return E.ev ? { name: E.ev.name, where: E.ev.where, matches: E.ev.matches.length } : E; } };
  boot();
})();
