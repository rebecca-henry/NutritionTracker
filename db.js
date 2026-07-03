// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wbetwrnqdkfldmceyvun.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HonxeV201TiNCi2qrYx6Jw_BbJRi4Gu';
const WORKER_URL = 'https://nutri-track.rebeccahenryy12.deno.net'; // Deno Deploy proxy
const AI = WORKER_URL + '/claude';
let currentUserId = null; // set by auth.js from session.user.id on login

// Set by auth.js once a session exists. Every Supabase call AND every Worker
// call now authenticates with this — no more static shared secret.
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 600, messages })
  });
  const d = await r.json();
  const text = d.content?.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── USDA FOODDATA CENTRAL ─────────────────────────────────────────────────────
async function usdaSearch(query) {
  const r = await fetch(`${WORKER_URL}/usda?query=${encodeURIComponent(query)}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error('USDA lookup failed');
  return r.json();
}

async function usdaFoodDetails(fdcId) {
  const r = await fetch(`${WORKER_URL}/usda?fdcId=${encodeURIComponent(fdcId)}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error('USDA details lookup failed');
  return r.json();
}
