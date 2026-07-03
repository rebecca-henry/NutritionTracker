// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wbetwrnqdkfldmceyvun.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HonxeV201TiNCi2qrYx6Jw_BbJRi4Gu';
const AI = 'https://api.anthropic.com/v1/messages';
const USER_ID = 'rebecca'; // replace with auth.uid() when login is added

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SB = {
  async query(table, params = '') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async insert(table, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async patch(table, params, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
  },
  async remove(table, params) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!r.ok) throw new Error(await r.text());
  }
};

// ── CLAUDE ────────────────────────────────────────────────────────────────────
async function claudeCall(messages, maxTokens) {
  const r = await fetch(AI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 600, messages })
  });
  const d = await r.json();
  const text = d.content?.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
