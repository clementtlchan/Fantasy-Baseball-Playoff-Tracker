(() => {
  'use strict';

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Trimmed to two decimals, with a real minus sign.
  const fmt = (n) => {
    const v = Math.round(n * 100) / 100;
    return v < 0 ? `−${Math.abs(v)}` : String(v);
  };
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
  const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');

  const BAT_LABELS = {
    H: 'Hits', '1B': 'Singles', '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs', R: 'Runs', RBI: 'RBI',
    BB: 'Walks', IBB: 'Intentional walks', SO: 'Strikeouts', HBP: 'Hit by pitch', SF: 'Sacrifice flies',
    SH: 'Sacrifice hits', GIDP: 'Double plays', SB: 'Stolen bases', CS: 'Caught stealing',
    GS: 'Grand slams', GWRBI: 'Game-winning RBI',
  };
  const PIT_LABELS = {
    GS: 'Games started', QS: 'Quality starts',
    W: 'Wins', L: 'Losses', SV: 'Saves', HLD: 'Holds', BS: 'Blown saves', IP: 'Innings pitched',
    ER: 'Earned runs', BB: 'Walks', IBB: 'Intentional walks', HBP: 'Hit batters', BK: 'Balks',
    SO: 'Strikeouts', PK: 'Pickoffs', CG: 'Complete games', SHO: 'Shutouts', NH: 'No-hitters', PG: 'Perfect games',
  };

  // GitHub Pages has no Node API. The static build provides the same API
  // contract through a browser-side engine backed by localStorage + MLB Stats API.
  async function api(path, opts = {}) {
    return window.PlayoffFantasy.api(path, opts);
  }

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ---------- state ----------

  let state = null;
  let tab = 'standings';
  const open = new Set(); // expanded team ids on Standings
  const players = { list: [], filter: 'all', sort: 'total', dir: 'desc', seq: 0 };
  const manage = { queries: {}, results: {}, confirmDelete: null, pending: false };
  let openPlayerId = null;

  // Same pulsing red dot and wording as the header, shown when the player's team is playing right now.
  const liveBadge = (p) => (p.live ? '<span class="live-badge"><span class="dot"></span>Live</span>' : '');

  // ---------- header ----------

  function renderHeader() {
    $('#season').textContent = `${state.season} postseason`;
    const live = state.games.filter((g) => g.state === 'Live').length;
    const el = $('#status');
    el.classList.toggle('live', live > 0);
    if (live > 0) {
      el.dataset.action = 'show-live-games';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Show ${live} live ${live === 1 ? 'game' : 'games'}`);
      el.title = 'Go to live games';
      el.innerHTML = `<span class="dot"></span>Live · ${live} ${live === 1 ? 'game' : 'games'}`;
    } else if (state.checkedAt) {
      delete el.dataset.action;
      el.removeAttribute('tabindex');
      el.setAttribute('role', 'status');
      el.removeAttribute('aria-label');
      el.removeAttribute('title');
      const t = new Date(state.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      el.innerHTML = `<span class="dot"></span>Checked ${esc(t)}`;
    } else {
      delete el.dataset.action;
      el.removeAttribute('tabindex');
      el.setAttribute('role', 'status');
      el.removeAttribute('aria-label');
      el.removeAttribute('title');
      el.innerHTML = '<span class="dot"></span>Waiting for first check';
    }
    const banner = $('#banner');
    if (state.error) {
      banner.hidden = false;
      banner.textContent = `Data refresh failed: ${state.error}. Showing the last saved stats.`;
    } else {
      banner.hidden = true;
    }
  }

  // ---------- standings ----------

  function playerRow(p) {
    return `<tr class="${p.eliminated ? 'is-out' : ''}">
      <td><button type="button" class="link" data-action="open-player" data-id="${p.id}">${esc(p.name)}</button><span class="pos-tag">${esc(p.pos)}</span>${liveBadge(p)}</td>
      <td>${esc(p.team) || '–'} ${p.team ? `<span class="tag ${p.eliminated ? 'out' : 'in'}">${p.eliminated ? 'OUT' : 'IN'}</span>` : ''}</td>
      <td class="num wide">${p.games}</td>
      <td class="num ${tone(p.today)}">${p.today ? signed(p.today) : '–'}</td>
      <td class="num"><strong>${fmt(p.total)}</strong></td>
    </tr>`;
  }

  function renderStandings() {
    const el = $('#standings-list');
    if (!state.teams.length) {
      el.innerHTML = '<div class="empty">No teams yet. Create the first team on the <a href="#manage">Manage</a> tab.</div>';
      return;
    }
    el.innerHTML = state.teams
      .map((t) => {
        const isOpen = open.has(t.id);
        const meta = [
          t.owner,
          t.players.length ? `${t.alive} of ${t.players.length} players still playing` : 'No players yet',
          t.today ? `${signed(t.today)} today` : '',
        ].filter(Boolean);
        return `<article class="team">
          <button type="button" class="team-head" data-action="toggle-team" data-id="${esc(t.id)}" aria-expanded="${isOpen}">
            <span class="rank">${t.rank}</span>
            <span><span class="team-name">${esc(t.name)}</span><br><span class="team-meta">${esc(meta.join(' · '))}</span></span>
            <span class="total">${fmt(t.total)}<small>points</small></span>
          </button>
          ${
            isOpen
              ? t.players.length
                ? `<div class="roster"><table>
                    <thead><tr><th>Player</th><th>Team</th><th class="num wide">GP</th><th class="num">Today</th><th class="num">Total</th></tr></thead>
                    <tbody>${t.players.map(playerRow).join('')}</tbody>
                  </table></div>`
                : '<div class="roster"><p class="note" style="padding:12px 16px;margin:0">Add players on the Manage tab.</p></div>'
              : ''
          }
        </article>`;
      })
      .join('');
  }

  // ---------- players ----------

  function filteredPlayers() {
    const filter = players.filter;
    const out = players.list.filter((p) => {
      const pos = String(p.pos || '').toUpperCase();
      if (filter === 'available') return !p.ownerTeam;
      if (filter === 'of') return ['OF','LF','CF','RF'].includes(pos);
      if (filter !== 'all') return pos === filter.toUpperCase();
      return true;
    });
    const dir = players.dir === 'asc' ? 1 : -1;
    const text = (v) => String(v || '').toLowerCase();
    return out.sort((x, y) => {
      let cmp = 0;
      if (players.sort === 'today' || players.sort === 'total') cmp = Number(x[players.sort] || 0) - Number(y[players.sort] || 0);
      else if (players.sort === 'owner') cmp = text(x.ownerTeam).localeCompare(text(y.ownerTeam));
      else if (players.sort === 'team') cmp = text(x.team).localeCompare(text(y.team));
      else cmp = text(x.name).localeCompare(text(y.name));
      return cmp * dir || text(x.name).localeCompare(text(y.name));
    });
  }

  function sortHead(key, label, cls = '') {
    const active = players.sort === key;
    const arrow = active ? (players.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="${cls}"><button type="button" class="sort-head" data-sort="${key}" aria-label="Sort by ${esc(label)}">${esc(label)}${arrow}</button></th>`;
  }

  function renderPlayersTable() {
    const list = filteredPlayers();
    const el = $('#players-table');
    if (!list.length) {
      el.innerHTML = '<div class="empty">No players match. Stats appear once playoff games have been played.</div>';
      return;
    }
    el.innerHTML = `<div class="card table-card"><table>
      <thead><tr>${sortHead('name','Player')}${sortHead('team','Team')}${sortHead('owner','Owner','wide')}${sortHead('today','Today','num')}${sortHead('total','Total','num')}</tr></thead>
      <tbody>${list
        .map(
          (p) => `<tr class="${p.eliminated ? 'is-out' : ''}">
        <td><button type="button" class="link" data-action="open-player" data-id="${p.id}">${esc(p.name)}</button><span class="pos-tag">${esc(p.pos)}</span>${liveBadge(p)}</td>
        <td>${esc(p.team) || '–'} ${p.team ? `<span class="tag ${p.eliminated ? 'out' : 'in'}">${p.eliminated ? 'OUT' : 'IN'}</span>` : ''}</td>
        <td class="wide">${esc(p.ownerTeam || '–')}</td>
        <td class="num ${tone(p.today)}">${p.today ? signed(p.today) : '–'}</td>
        <td class="num"><strong>${fmt(p.total)}</strong></td></tr>`,
        )
        .join('')}</tbody></table></div>`;
  }

  async function loadPlayers() {
    const q = $('#players-q').value.trim();
    const seq = ++players.seq;
    try {
      const r = await api(`/api/players?q=${encodeURIComponent(q)}&limit=200`);
      if (seq !== players.seq) return;
      players.list = r.players;
      renderPlayersTable();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- games ----------

  function dayLabel(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function gameCard(g) {
    const live = g.state === 'Live';
    const final = g.state === 'Final';
    let when;
    if (live) when = g.detail && g.detail !== 'In Progress' ? g.detail : `${g.inningState || ''} ${g.inning || ''}`.trim() || 'Live';
    else if (final) when = 'Final';
    else when = new Date(g.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const winner = final ? (g.away.score > g.home.score ? 'away' : 'home') : null;
    const line = (side, key) => `<div class="game-line ${final && winner !== key ? 'lost' : ''}">
        <span><span class="team-abbr">${esc(side.abbr)}</span>${side.out ? ' <span class="tag out">OUT</span>' : ''}</span>
        <span class="score">${side.score ?? ''}</span></div>`;
    return `<div class="game ${live ? 'is-live' : ''}">
      <div class="game-state"><span>${esc(g.series || 'Postseason')}${g.gameNumber ? ` · G${g.gameNumber}` : ''}</span><span class="when">${esc(when)}</span></div>
      ${line(g.away, 'away')}${line(g.home, 'home')}
    </div>`;
  }

  function renderGames() {
    const el = $('#games-list');
    if (!state.games.length) {
      el.innerHTML = `<div class="empty">No ${state.season} playoff games found yet.</div>`;
      return;
    }
    const byDay = new Map();
    for (const g of [...state.games].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))) {
      if (!byDay.has(g.date)) byDay.set(g.date, []);
      byDay.get(g.date).push(g);
    }
    const days = [...byDay.keys()].sort().reverse();
    el.innerHTML = days
      .map((d) => `<div class="day"><h2>${esc(dayLabel(d))}${d === state.today ? ' · Today' : ''}</h2><div class="game-grid">${byDay.get(d).map(gameCard).join('')}</div></div>`)
      .join('');
  }

  // ---------- manage ----------

  function renderScoring() {
    const rows = (table, labels) =>
      Object.entries(table)
        .map(([k, v]) => `<div class="row"><dt>${esc(labels[k] || k)}</dt><dd class="${tone(v)}">${signed(v)}</dd></div>`)
        .join('');
    $('#manage-scoring').innerHTML = `
      <div><h3>Hitters</h3><dl>${rows(state.scoring.batting, BAT_LABELS)}</dl></div>
      <div><h3>Pitchers</h3><dl>${rows(state.scoring.pitching, PIT_LABELS)}</dl></div>`;
  }

  function resultsHtml(teamId) {
    const list = manage.results[teamId];
    if (!list) return '';
    if (!list.length) return '<p class="note">No players found.</p>';
    return `<ul class="results">${list
      .map(
        (p) => `<li><span class="who">${esc(p.name)} <span class="pos-tag">${esc(p.pos)} ${esc(p.team)}</span></span>
        ${
          p.ownerTeam
            ? `<span class="taken">On ${esc(p.ownerTeam)}</span>`
            : `<button type="button" class="btn small" data-action="add-player" data-team="${esc(teamId)}" data-player="${p.id}">Add</button>`
        }</li>`,
      )
      .join('')}</ul>`;
  }

  function renderManage() {
    const signedIn = window.SupabaseFantasy.isSignedIn();
    $('#admin-signout').hidden = !signedIn;
    $('#admin-email').value = signedIn ? (window.SupabaseFantasy.session()?.user?.email || '') : '';
    $('#admin-email').disabled = signedIn;
    $('#admin-password').required = !signedIn;
    $('#admin-password').disabled = signedIn;
    $('#admin-form button[type=submit]').hidden = signedIn;

    $('#admin-form').hidden = false;
    renderScoring();
    const el = $('#manage-teams');
    if (!state.teams.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = state.teams
      .map((t) => {
        const confirming = manage.confirmDelete === t.id;
        return `<section class="card manage-team" data-team="${esc(t.id)}">
          <h2>${esc(t.name)}</h2>
          <div class="form-row">
            <label class="field grow"><span class="label">Team name</span><input type="text" id="name-${esc(t.id)}" value="${esc(t.name)}" maxlength="60"></label>
            <label class="field grow"><span class="label">Owner</span><input type="text" id="owner-${esc(t.id)}" value="${esc(t.owner)}" maxlength="60"></label>
            <button type="button" class="btn" data-action="save-team" data-id="${esc(t.id)}">Save</button>
          </div>
          ${
            t.players.length
              ? `<div class="table-card"><table><thead><tr><th>Player</th><th class="num">Total</th><th></th></tr></thead><tbody>${t.players
                  .map(
                    (p) => `<tr><td>${esc(p.name)}<span class="pos-tag">${esc(p.pos)} ${esc(p.team)}</span></td><td class="num">${fmt(p.total)}</td>
                  <td class="num"><button type="button" class="btn small" data-action="remove-player" data-team="${esc(t.id)}" data-player="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button></td></tr>`,
                  )
                  .join('')}</tbody></table></div>`
              : '<p class="note">No players yet.</p>'
          }
          <label class="field" style="margin-top:12px"><span class="label">Add a player</span>
            <input type="search" class="team-search" data-team="${esc(t.id)}" value="${esc(manage.queries[t.id] || '')}" placeholder="Search by name" autocomplete="off"></label>
          ${resultsHtml(t.id)}
          <div class="team-actions">
            ${
              confirming
                ? `<button type="button" class="btn danger small" data-action="delete-team" data-id="${esc(t.id)}">Yes, delete this team</button>
                   <button type="button" class="btn small" data-action="cancel-delete">Keep it</button>`
                : `<button type="button" class="btn danger small" data-action="delete-team" data-id="${esc(t.id)}">Delete team</button>`
            }
          </div>
        </section>`;
      })
      .join('');
  }

  function manageBusy() {
    const a = document.activeElement;
    return tab === 'manage' && a && a.tagName === 'INPUT' && $('#manage-teams').contains(a);
  }

  function renderManageSafely() {
    if (manageBusy()) {
      manage.pending = true;
      return;
    }
    manage.pending = false;
    renderManage();
  }

  async function mutate(fn, okMessage) {
    try {
      await fn();
      if (okMessage) toast(okMessage);
      await refresh({ force: true });
    } catch (err) {
      toast(err.message);
    }
  }

  let searchTimer;
  function runTeamSearch(teamId, query) {
    manage.queries[teamId] = query;
    clearTimeout(searchTimer);
    if (!query.trim()) {
      delete manage.results[teamId];
      searchTimer = setTimeout(() => updateResultsOnly(teamId), 0);
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const r = await api(`/api/players?q=${encodeURIComponent(query.trim())}&limit=12`);
        if (manage.queries[teamId] !== query) return;
        manage.results[teamId] = r.players;
        updateResultsOnly(teamId);
      } catch (err) {
        toast(err.message);
      }
    }, 250);
  }

  // Replace only the results list so the search box keeps focus while typing.
  function updateResultsOnly(teamId) {
    const section = $(`.manage-team[data-team="${CSS.escape(teamId)}"]`);
    if (!section) return;
    const field = $('input.team-search', section).parentElement;
    let next = field.nextElementSibling;
    while (next && (next.classList.contains('results') || next.classList.contains('note'))) {
      const after = next.nextElementSibling;
      next.remove();
      next = after;
    }
    field.insertAdjacentHTML('afterend', resultsHtml(teamId));
  }

  // ---------- player dialog ----------

  function partsHtml(kind, block, labels) {
    const rows = Object.entries(block.parts)
      .map(([k, v]) => {
        let count = fmt(v.count);
        if (k === 'IP') {
          const outs = Math.round(v.count * 3);
          count = `${Math.floor(outs / 3)}.${outs % 3}`;
        }
        return `<li><span>${esc(labels[k] || k)}</span><span class="c">${count}</span><span class="p ${tone(v.points)}">${signed(v.points)}</span></li>`;
      })
      .join('');
    return `<ul class="stat-list"><li class="kind"><span>${kind} · ${signed(block.total)}</span></li>${rows || '<li><span class="note">No scoring events</span></li>'}</ul>`;
  }

  function playerDialogHtml(p) {
    const games = [...p.games].reverse();
    return `<div class="dlg">
      <div class="dlg-head">
        <h2 id="player-dialog-title">${esc(p.name)} ${liveBadge(p)}</h2>
        <div class="total">${fmt(p.total)}<small>points</small></div>
      </div>
      <p class="dlg-sub">${esc([p.pos, p.team].filter(Boolean).join(' · '))}${p.team ? ` · ${p.eliminated ? 'Team eliminated' : 'Team still playing'}` : ''} · Hitting ${fmt(p.hitting)} · Pitching ${fmt(p.pitching)}</p>
      ${
        games.length
          ? games
              .map(
                (g) => `<section class="gamebox">
            <h3><span>${esc(dayLabel(g.date))}${g.opp ? ` vs ${esc(g.opp)}` : ''}${g.final ? '' : ' (in progress)'}</span><span class="${tone(g.total)}">${signed(g.total)}</span></h3>
            ${g.batting ? partsHtml('Hitting', g.batting, BAT_LABELS) : ''}
            ${g.pitching ? partsHtml('Pitching', g.pitching, PIT_LABELS) : ''}
          </section>`,
              )
              .join('')
          : '<p class="note">No playoff games played yet.</p>'
      }
      <div class="team-actions"><button type="button" class="btn" data-action="close-dialog">Close</button></div>
    </div>`;
  }

  async function openPlayer(id) {
    try {
      const p = await api(`/api/players/${id}`);
      openPlayerId = id;
      $('#player-dialog-body').innerHTML = playerDialogHtml(p);
      const dialog = $('#player-dialog');
      if (!dialog.open) dialog.showModal();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- tabs & rendering ----------

  function showLiveGames() {
    if (!state?.games?.some((g) => g.state === 'Live')) return;
    if (location.hash !== '#games') location.hash = '#games';
    setTab('games');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const liveGame = $('#games-list .game.is-live');
        if (liveGame) liveGame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function setTab(name) {
    tab = ['standings', 'players', 'games', 'manage'].includes(name) ? name : 'standings';
    for (const a of $$('.tabs a')) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const panel of $$('.panel')) panel.hidden = panel.id !== `tab-${tab}`;
    if (!state) return;
    if (tab === 'players') loadPlayers();
    if (tab === 'manage') renderManage();
  }

  function renderAll() {
    renderHeader();
    renderStandings();
    renderGames();
    if (tab === 'players') loadPlayers();
    renderManageSafely();
    if (openPlayerId && $('#player-dialog').open) openPlayer(openPlayerId);
  }

  // ---------- polling ----------

  let pollTimer;
  async function refresh({ force = false } = {}) {
    clearTimeout(pollTimer);
    // Background tabs skip the request and check again later.
    if (document.hidden && !force && state) {
      pollTimer = setTimeout(() => refresh(), 15000);
      return;
    }
    try {
      const data = await api('/api/state');
      const changed = !state || data.version !== state.version || force;
      state = data;
      if (changed) renderAll();
      else renderHeader();
    } catch (err) {
      const banner = $('#banner');
      banner.hidden = false;
      console.error("Tracker refresh failed:", err);
      banner.textContent = `Tracker error: ${err.message || "Unknown error"}. Retrying…`;
    }
    // Fast while games are live, slow otherwise.
    pollTimer = setTimeout(() => refresh(), state && state.live ? 15000 : 60000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  // ---------- events ----------

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-filter], [data-sort]');
    if (!target) return;

    if (target.dataset.sort) {
      const key = target.dataset.sort;
      if (players.sort === key) players.dir = players.dir === 'asc' ? 'desc' : 'asc';
      else {
        players.sort = key;
        players.dir = (key === 'today' || key === 'total') ? 'desc' : 'asc';
      }
      renderPlayersTable();
      return;
    }

    if (target.dataset.filter) {
      players.filter = target.dataset.filter;
      for (const chip of $$('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.filter === players.filter));
      renderPlayersTable();
      return;
    }

    const { action, id, team, player } = target.dataset;
    switch (action) {
      case 'show-live-games':
        showLiveGames();
        break;
      case 'toggle-team':
        if (open.has(id)) open.delete(id);
        else open.add(id);
        renderStandings();
        break;
      case 'open-player':
        openPlayer(Number(id));
        break;
      case 'close-dialog':
        $('#player-dialog').close();
        break;
      case 'add-player':
        mutate(
          () => api(`/api/teams/${encodeURIComponent(team)}/players`, { method: 'POST', body: JSON.stringify({ playerId: Number(player) }) }).then(() => {
            manage.queries[team] = '';
            delete manage.results[team];
          }),
          'Player added.',
        );
        break;
      case 'remove-player':
        mutate(() => api(`/api/teams/${encodeURIComponent(team)}/players/${player}`, { method: 'DELETE' }), 'Player removed.');
        break;
      case 'save-team':
        mutate(
          () => api(`/api/teams/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: $(`#name-${CSS.escape(id)}`).value, owner: $(`#owner-${CSS.escape(id)}`).value }),
          }),
          'Team saved.',
        );
        break;
      case 'delete-team':
        if (manage.confirmDelete !== id) {
          manage.confirmDelete = id;
          renderManage();
        } else {
          manage.confirmDelete = null;
          mutate(() => api(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Team deleted.');
        }
        break;
      case 'cancel-delete':
        manage.confirmDelete = null;
        renderManage();
        break;
      default:
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.dataset?.action === 'show-live-games') {
      e.preventDefault();
      showLiveGames();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'players-q') {
      clearTimeout(e.target._t);
      e.target._t = setTimeout(loadPlayers, 250);
    } else if (e.target.classList.contains('team-search')) {
      runTeamSearch(e.target.dataset.team, e.target.value);
    }
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (manage.pending && !manageBusy()) renderManageSafely();
    }, 0);
  });

  $('#create-team').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#new-team-name').value;
    const owner = $('#new-team-owner').value;
    mutate(async () => {
      await api('/api/teams', { method: 'POST', body: JSON.stringify({ name, owner }) });
      $('#new-team-name').value = '';
      $('#new-team-owner').value = '';
    }, 'Team created.');
  });

  $('#admin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await window.SupabaseFantasy.signIn($('#admin-email').value.trim(), $('#admin-password').value);
      $('#admin-password').value = '';
      $('#admin-signout').hidden = false;
      toast('Signed in.');
      renderManageSafely();
    } catch (err) { toast(err.message); }
  });
  $('#admin-signout').addEventListener('click', async () => {
    await window.SupabaseFantasy.signOut();
    toast('Signed out.');
    renderManageSafely();
  });

  $('#player-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  $('#player-dialog').addEventListener('close', () => { openPlayerId = null; });

  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

  // ---------- start ----------

  setTab(location.hash.slice(1));
  refresh();
})();
