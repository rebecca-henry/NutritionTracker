// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wbetwrnqdkfldmceyvun.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HonxeV201TiNCi2qrYx6Jw_BbJRi4Gu';
const WORKER_URL = 'https://nutri-track.rebeccahenryy12.deno.net'; // Deno Deploy proxy
const APP_SECRET = 'eb1c8243823746c433d7fb8e2165a2b064db92381b799cf1'; // must match APP_SECRET in Deno Deploy env vars
const AI = WORKER_URL + '/claude';
const USER_ID = 'rebecca'; // replace with auth.uid() when login is added

// Set by auth.js once a session exists. Falls back to the publishable key
// (read-only-ish, wide-open RLS) until Stage 3 tightens the policies —
// after that, requests are only authorized when this carries a real session.
let accessToken = null;
function authHeaders(extra = {}) {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${accessToken || SUPABASE_KEY}`, ...extra };
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SB = {
  async query(table, params = '') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: authHeaders()
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async insert(table, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async patch(table, params, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
  },
  async remove(table, params) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!r.ok) throw new Error(await r.text());
  }
};

// ── CLAUDE ────────────────────────────────────────────────────────────────────
async function claudeCall(messages, maxTokens) {
  const r = await fetch(AI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Secret': APP_SECRET },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 600, messages })
  });
  const d = await r.json();
  const text = d.content?.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── USDA FOODDATA CENTRAL ─────────────────────────────────────────────────────
async function usdaSearch(query) {
  const r = await fetch(`${WORKER_URL}/usda?query=${encodeURIComponent(query)}`, {
    headers: { 'X-App-Secret': APP_SECRET }
  });
  if (!r.ok) throw new Error('USDA lookup failed');
  return r.json();
}
