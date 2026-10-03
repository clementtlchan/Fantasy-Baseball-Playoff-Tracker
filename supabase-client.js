(() => {
  'use strict';
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !cfg?.key) throw new Error('Supabase configuration is missing.');

  const headers = () => ({
    apikey: cfg.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
  let session = null;

  // Refresh a little before the access token expires (it lasts about an hour).
  const EXPIRY_MARGIN_S = 60;
  const isExpired = (s) => Boolean(s?.expires_at) && Date.now() / 1000 >= s.expires_at - EXPIRY_MARGIN_S;
  const looksExpired = (status, msg) => status === 401 || /jwt (is )?expired|invalid jwt/i.test(msg || '');

  // Keeps a valid access token, or drops the session so requests go out as the public reader.
  async function ensureFresh() {
    if (session?.access_token && isExpired(session)) await api.refreshSession();
  }

  const SESSION_ENDED = 'Your admin session expired. Sign in again on the Manage tab.';

  async function request(path, opts = {}, retried = false) {
    const isRead = (opts.method || 'GET').toUpperCase() === 'GET';
    const wasSignedIn = Boolean(session?.access_token);
    await ensureFresh();
    // A write must not quietly go out as the public reader after the session ended.
    if (wasSignedIn && !session?.access_token && !isRead) throw new Error(SESSION_ENDED);
    const h = {...headers(), ...(opts.headers || {})};
    const hadSession = Boolean(session?.access_token);
    if (hadSession) h.Authorization = `Bearer ${session.access_token}`;
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, {...opts, headers: h});
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!r.ok) {
      const msg = body?.message || body?.error_description || body?.hint || `Supabase HTTP ${r.status}`;
      // The token expired between the check and the request (or the clock is off): refresh once and retry.
      if (hadSession && !retried && looksExpired(r.status, msg)) {
        await api.refreshSession();
        if (!session?.access_token && !isRead) throw new Error(SESSION_ENDED);
        return request(path, opts, true);
      }
      throw new Error(msg);
    }
    return body;
  }

  // Sign-in and refresh calls never carry the old access token: an expired one can make them fail.
  async function authRequest(path, body, method = 'POST') {
    const sendToken = path === 'logout' && session?.access_token;
    const r = await fetch(`${cfg.url}/auth/v1/${path}`, {
      method,
      headers: {...headers(), ...(sendToken ? {Authorization: `Bearer ${session.access_token}`} : {})},
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) {
      const err = new Error(data?.msg || data?.message || data?.error_description || `Auth HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  function loadSession() {
    try { session = JSON.parse(localStorage.getItem('playoff-fantasy:supabase-session') || 'null'); } catch { session = null; }
    return session;
  }
  let refreshing = null;
  function saveSession(s) {
    session = s || null;
    // Older Auth servers send only expires_in; store an absolute time so expiry can be checked later.
    if (session && !session.expires_at && session.expires_in) {
      session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in);
    }
    try {
      if (session) localStorage.setItem('playoff-fantasy:supabase-session', JSON.stringify(session));
      else localStorage.removeItem('playoff-fantasy:supabase-session');
    } catch {}
  }
  loadSession();

  const api = {
    config: cfg,
    session: () => session,
    isSignedIn: () => Boolean(session?.access_token),
    async signIn(email, password) {
      const s = await authRequest('token?grant_type=password', {email, password});
      saveSession(s);
      return s;
    },
    async signOut() {
      try { if (session?.access_token) await authRequest('logout', null); } finally { saveSession(null); }
    },
    // Refresh tokens are single use, so concurrent callers share one request.
    refreshSession() {
      if (!session?.access_token) return Promise.resolve(null);
      if (!session.refresh_token) { saveSession(null); return Promise.resolve(null); }
      if (!refreshing) {
        refreshing = authRequest('token?grant_type=refresh_token', {refresh_token: session.refresh_token})
          .then((s) => { saveSession(s); return session; })
          .catch((err) => {
            // The server rejected the refresh token: the admin has to sign in again.
            // A network error keeps the session so the next call can try again.
            if (err.status >= 400 && err.status < 500) saveSession(null);
            return null;
          })
          .finally(() => { refreshing = null; });
      }
      return refreshing;
    },
    async getTeams() {
      return request('league_teams?select=id,name,owner,player_ids&order=created_at.asc');
    },
    async createTeam(team) {
      const rows = await request('league_teams', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(team)});
      return rows[0];
    },
    async updateTeam(id, patch) {
      const rows = await request(`league_teams?id=eq.${encodeURIComponent(id)}`, {method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(patch)});
      return rows[0];
    },
    async deleteTeam(id) {
      await request(`league_teams?id=eq.${encodeURIComponent(id)}`, {method:'DELETE'});
    },
    async getTeam(id) {
      const rows = await request(`league_teams?id=eq.${encodeURIComponent(id)}&select=id,name,owner,player_ids`);
      return rows[0] || null;
    },
  };
  window.SupabaseFantasy = api;
})();
