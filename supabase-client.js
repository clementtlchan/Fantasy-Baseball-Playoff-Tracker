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

  async function request(path, opts = {}) {
    const h = {...headers(), ...(opts.headers || {})};
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, {...opts, headers: h});
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!r.ok) {
      const msg = body?.message || body?.error_description || body?.hint || `Supabase HTTP ${r.status}`;
      throw new Error(msg);
    }
    return body;
  }

  async function authRequest(path, body, method = 'POST') {
    const r = await fetch(`${cfg.url}/auth/v1/${path}`, {
      method,
      headers: {...headers(), ...(session?.access_token ? {Authorization: `Bearer ${session.access_token}`} : {})},
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error(data?.msg || data?.message || data?.error_description || `Auth HTTP ${r.status}`);
    return data;
  }

  function loadSession() {
    try { session = JSON.parse(localStorage.getItem('playoff-fantasy:supabase-session') || 'null'); } catch { session = null; }
    return session;
  }
  function saveSession(s) {
    session = s || null;
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
    async refreshSession() {
      if (!session?.refresh_token) return null;
      try {
        const s = await authRequest('token?grant_type=refresh_token', {refresh_token: session.refresh_token});
        saveSession(s); return s;
      } catch { saveSession(null); return null; }
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
