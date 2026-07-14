// ── STATE ─────────────────────────────────────────────────────────────────────
let cachedFoodDbItems = [];
let fooddbFilter = 'all'; // 'all' | 'foods' | 'dishes'
let editingFoodDbId = null;

// ── ENTRY POINT (called from showPage) ───────────────────────────────────────
async function renderFoodDb() {
  document.getElementById('fooddb-search-input').value = '';
  toggleFoodDbAddForm(false);
  editingFoodDbId = null;
  await loadFoodDbRecent();
}

// ── LOAD: 5 MOST RECENT ───────────────────────────────────────────────────────
async function loadFoodDbRecent() {
  document.getElementById('fooddb-section-label').textContent = 'Recently added';
  const listEl = document.getElementById('fooddb-list');
  listEl.innerHTML = '<div class="status-msg visible">Loading…</div>';
  let rows = [];
  try {
    // Prefer created_at if the table has it — falls back to id ordering
    // (still roughly recency-ordered) if that column doesn't exist.
    rows = await SB.query('Foods', `?order=created_at.desc&limit=5`);
  } catch (e) {
    try { rows = await SB.query('Foods', `?order=id.desc&limit=5`); }
    catch (e2) { rows = []; }
  }
  cachedFoodDbItems = rows;
  renderFoodDbList();
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
async function searchFoodDb() {
  const q = document.getElementById('fooddb-search-input').value.trim();
  if (!q) { await loadFoodDbRecent(); return; }
  document.getElementById('fooddb-section-label').textContent = `Results for "${q}"`;
  const listEl = document.getElementById('fooddb-list');
  listEl.innerHTML = '<div class="status-msg visible">Searching…</div>';
  let rows = [];
  try { rows = await SB.query('Foods', `?name=ilike.*${encodeURIComponent(q)}*&order=name&limit=50`); }
  catch (e) { rows = []; }
  cachedFoodDbItems = rows;
  renderFoodDbList();
}

// ── FILTER (All / Foods / Dishes) ────────────────────────────────────────────
function setFoodDbFilter(f) {
  fooddbFilter = f;
  ['all', 'foods', 'dishes'].forEach(x =>
    document.getElementById(`fooddb-filter-${x}-btn`).classList.toggle('active', x === f)
  );
  renderFoodDbList();
}

function filteredFoodDbItems() {
  if (fooddbFilter === 'foods') return cachedFoodDbItems.filter(f => !f.is_dish);
  if (fooddbFilter === 'dishes') return cachedFoodDbItems.filter(f => f.is_dish);
  return cachedFoodDbItems;
}

// ── LIST RENDER ───────────────────────────────────────────────────────────────
function renderFoodDbList() {
  const items = filteredFoodDbItems();
  const listEl = document.getElementById('fooddb-list');
  if (!items.length) { listEl.innerHTML = '<div class="status-msg visible">No foods found.</div>'; return; }
  listEl.innerHTML = items.map(foodDbCardHtml).join('');
}

function foodDbCardHtml(f) {
  if (editingFoodDbId === f.id) return foodDbEditFormHtml(f);
  const badge = f.is_dish
    ? '<span class="source-badge manual">Dish</span>'
    : f.source ? `<span class="source-badge ${['db','usda','ai','manual'].includes(f.source) ? f.source : 'manual'}">${f.source}</span>` : '';
  const servingLabel = f.serving_other || (f.serving_grams ? `${f.serving_grams}g` : 'per serving');
  return `<div class="card" style="display:flex;gap:12px;align-items:center" id="fooddb-card-${f.id}">
    ${f.photo_data
      ? `<img src="${f.photo_data}" style="width:48px;height:48px;border-radius:10px;object-fit:cover;flex-shrink:0">`
      : `<div class="food-icon">${f.is_dish ? '🍽️' : '🍎'}</div>`}
    <div style="flex:1;min-width:0">
      <div class="food-name">${escapeHtml(f.name)}${badge}</div>
      <div class="food-meta">${f.calories_per_serving||0} kcal · ${f.protein_per_serving||0}p / ${f.carbs_per_serving||0}c / ${f.fat_per_serving||0}f · ${escapeHtml(servingLabel)}</div>
    </div>
    <button class="back-btn" style="width:auto;padding:8px 10px" onclick="startEditFoodDb('${f.id}')">Edit</button>
    <button class="food-del" onclick="deleteFoodDbItem('${f.id}')">✕</button>
  </div>`;
}

// ── EDIT ──────────────────────────────────────────────────────────────────────
function startEditFoodDb(id) {
  editingFoodDbId = id;
  renderFoodDbList();
}

function cancelEditFoodDb() {
  editingFoodDbId = null;
  renderFoodDbList();
}

function foodDbEditFormHtml(f) {
  return `<div class="card" id="fooddb-card-${f.id}">
    <div class="manual-grid">
      <div class="manual-field full">
        <label>Name</label>
        <input id="fdb-edit-name-${f.id}" value="${escapeAttr(f.name)}">
      </div>
      <div class="manual-field full">
        <label>Serving size (describe it)</label>
        <input id="fdb-edit-servingother-${f.id}" value="${escapeAttr(f.serving_other||'')}">
      </div>
      <div class="manual-field full">
        <label>Serving weight (grams)</label>
        <input type="number" id="fdb-edit-servinggrams-${f.id}" value="${f.serving_grams||''}">
      </div>
      <div class="manual-field">
        <label>Calories (kcal)</label>
        <input type="number" id="fdb-edit-cal-${f.id}" value="${f.calories_per_serving||0}">
      </div>
      <div class="manual-field">
        <label>Protein (g)</label>
        <input type="number" id="fdb-edit-protein-${f.id}" value="${f.protein_per_serving||0}">
      </div>
      <div class="manual-field">
        <label>Carbs (g)</label>
        <input type="number" id="fdb-edit-carbs-${f.id}" value="${f.carbs_per_serving||0}">
      </div>
      <div class="manual-field">
        <label>Fat (g)</label>
        <input type="number" id="fdb-edit-fat-${f.id}" value="${f.fat_per_serving||0}">
      </div>
    </div>
    <div class="status-msg" id="fdb-edit-status-${f.id}"></div>
    <button class="confirm-btn" onclick="saveEditFoodDb('${f.id}')">Save changes</button>
    <button class="back-btn" onclick="cancelEditFoodDb()">Cancel</button>
  </div>`;
}

async function saveEditFoodDb(id) {
  const name = document.getElementById(`fdb-edit-name-${id}`).value.trim();
  if (!name) { setStatus(`fdb-edit-status-${id}`, 'Name is required.', 'error'); return; }
  const body = {
    name,
    serving_other: document.getElementById(`fdb-edit-servingother-${id}`).value.trim() || null,
    serving_grams: parseFloat(document.getElementById(`fdb-edit-servinggrams-${id}`).value) || null,
    calories_per_serving: Math.round(parseFloat(document.getElementById(`fdb-edit-cal-${id}`).value) || 0),
    protein_per_serving:  Math.round(parseFloat(document.getElementById(`fdb-edit-protein-${id}`).value) || 0),
    carbs_per_serving:    Math.round(parseFloat(document.getElementById(`fdb-edit-carbs-${id}`).value) || 0),
    fat_per_serving:      Math.round(parseFloat(document.getElementById(`fdb-edit-fat-${id}`).value) || 0),
  };
  try {
    await SB.patch('Foods', `?id=eq.${id}`, body);
    const idx = cachedFoodDbItems.findIndex(x => x.id === id);
    if (idx > -1) cachedFoodDbItems[idx] = { ...cachedFoodDbItems[idx], ...body };
    editingFoodDbId = null;
    showToast('Saved');
    renderFoodDbList();
  } catch (e) {
    setStatus(`fdb-edit-status-${id}`, 'Error saving — check Supabase RLS/columns.', 'error');
    console.error(e);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async function deleteFoodDbItem(id) {
  if (!confirm('Delete this entry from your food database? This cannot be undone.')) return;
  try {
    await SB.remove('Foods', `?id=eq.${id}`);
    cachedFoodDbItems = cachedFoodDbItems.filter(x => x.id !== id);
    renderFoodDbList();
    showToast('Deleted');
  } catch (e) { showToast('Error deleting'); }
}

// ── ADD NEW FOOD DIRECTLY ─────────────────────────────────────────────────────
function toggleFoodDbAddForm(show) {
  document.getElementById('fooddb-add-form').style.display = show ? 'block' : 'none';
  document.getElementById('fooddb-add-btn').style.display = show ? 'none' : 'flex';
  if (!show) clearFoodDbAddForm();
}

function clearFoodDbAddForm() {
  ['name','servingother','servinggrams','cal','protein','carbs','fat'].forEach(k => {
    const el = document.getElementById('fdb-add-' + k);
    if (el) el.value = '';
  });
  setStatus('fdb-add-status', '', '');
}

async function submitFoodDbAdd() {
  const name = document.getElementById('fdb-add-name').value.trim();
  if (!name) { setStatus('fdb-add-status', 'Please enter a food name.', 'error'); return; }
  const body = {
    name,
    serving_other: document.getElementById('fdb-add-servingother').value.trim() || null,
    serving_grams: parseFloat(document.getElementById('fdb-add-servinggrams').value) || null,
    calories_per_serving: Math.round(parseFloat(document.getElementById('fdb-add-cal').value) || 0),
    protein_per_serving:  Math.round(parseFloat(document.getElementById('fdb-add-protein').value) || 0),
    carbs_per_serving:    Math.round(parseFloat(document.getElementById('fdb-add-carbs').value) || 0),
    fat_per_serving:      Math.round(parseFloat(document.getElementById('fdb-add-fat').value) || 0),
    source: 'manual', user_id: currentUserId
  };
  try {
    await SB.insert('Foods', body);
    showToast(name + ' added');
    toggleFoodDbAddForm(false);
    await loadFoodDbRecent();
  } catch (e) {
    setStatus('fdb-add-status', 'Error saving — check required fields.', 'error');
    console.error(e);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
