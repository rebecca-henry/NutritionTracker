// ── STATE ─────────────────────────────────────────────────────────────────────
let currentMeal = 'Breakfast';
let pendingFood = null;
let servingMode = 'grams';
let editingLogId = null; // set when editing an existing Food_Logs entry instead of creating a new one

// ── USDA MATCHING ─────────────────────────────────────────────────────────────
// Prefer unbranded reference data (most accurate, lab-analyzed) over branded
// packaged-food entries (self-reported by manufacturers, more variable).
const USDA_TYPE_PRIORITY = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'];

function parseUsdaFood(item) {
  const n = {};
  (item.foodNutrients || []).forEach(x => { n[x.nutrientId] = x.value; });
  const cal = n[1008]; // Energy (kcal)
  if (cal == null) return null; // unusable entry, skip it
  return {
    fdcId: item.fdcId,
    name: item.description,
    calories_per_serving: Math.round(cal),
    protein_per_serving: Math.round(n[1003] || 0), // Protein
    carbs_per_serving: Math.round(n[1005] || 0),   // Carbohydrate, by difference
    fat_per_serving: Math.round(n[1004] || 0),     // Total lipid (fat)
    serving_grams: 100,
    serving_other: '100g',
  };
}

// Picks the first usable household portion USDA reports for a food (e.g.
// "1 medium" = 118g for a banana), so logging can use natural units instead
// of always defaulting to 100g. Falls back to null if nothing usable exists.
function pickNaturalPortion(portions) {
  if (!Array.isArray(portions)) return null;
  for (const p of portions) {
    if (!p.gramWeight) continue;
    if (p.portionDescription && p.portionDescription.trim()) {
      return { grams: p.gramWeight, label: p.portionDescription.trim() };
    }
    if (p.modifier && isNaN(parseFloat(p.modifier))) {
      return { grams: p.gramWeight, label: `${p.amount || 1} ${p.modifier.trim()}` };
    }
  }
  return null;
}

// Best-effort enhancement: look up the specific food's natural portion size.
// Never blocks logging — if this fails for any reason, the 100g default
// from parseUsdaFood is used as-is.
async function enrichWithNaturalPortion(food) {
  if (!food.fdcId) return food;
  try {
    const details = await usdaFoodDetails(food.fdcId);
    const portion = pickNaturalPortion(details.foodPortions);
    if (portion) return { ...food, serving_grams: Math.round(portion.grams), serving_other: portion.label };
  } catch (e) {}
  return food;
}

async function searchUsdaCandidates(query) {
  try {
    const data = await usdaSearch(query);
    const foods = (data.foods || []).slice().sort(
      (a, b) => USDA_TYPE_PRIORITY.indexOf(a.dataType) - USDA_TYPE_PRIORITY.indexOf(b.dataType)
    );
    return foods.map(parseUsdaFood).filter(Boolean).slice(0, 3);
  } catch (e) { return []; }
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openAdd(meal) {
  currentMeal = meal;
  editingLogId = null;
  document.getElementById('edit-meal-row').style.display = 'none';
  document.getElementById('confirm-btn').textContent = 'Add to meal';
  document.getElementById('modal-title').textContent = 'Add to ' + meal;
  document.getElementById('add-modal').classList.add('open');
  goToStep('step-method'); selectMethod('label'); resetAllInputs();
}
function closeModal() {
  document.getElementById('add-modal').classList.remove('open');
  pendingFood = null; editingLogId = null;
  document.getElementById('edit-meal-row').style.display = 'none';
  document.getElementById('confirm-btn').textContent = 'Add to meal';
}
document.getElementById('add-modal').addEventListener('click', e => { if (e.target === document.getElementById('add-modal')) closeModal(); });
function goToStep(id) { document.querySelectorAll('.step').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function goBackToMethod() { goToStep('step-method'); pendingFood = null; }

function selectMethod(m) {
  ['label','identify','search','manual'].forEach(x => {
    document.getElementById('method-'+x).style.display = x===m ? 'block' : 'none';
    document.getElementById('tab-'+x+'-btn').classList.toggle('active', x===m);
  });
}

function resetAllInputs() {
  document.getElementById('label-preview').style.display = 'none'; setStatus('label-status','',''); document.getElementById('label-input').value = '';
  document.getElementById('identify-preview').style.display = 'none'; setStatus('identify-status','',''); document.getElementById('identify-input').value = '';
  document.getElementById('search-input').value = ''; setStatus('search-status','','');
  document.getElementById('search-results').style.display = 'none'; document.getElementById('search-results').innerHTML = '';
  ['manual-name','manual-serving-other','manual-serving-grams','manual-cal','manual-protein','manual-carbs','manual-fat'].forEach(id => document.getElementById(id).value = '');
  setStatus('manual-status','','');
}

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status-msg' + (msg?' visible':'') + (type?' '+type:'');
}

// ── MULTI-PHOTO HELPERS ─────────────────────────────────────────────────────
// Shared by food.js and dishes.js scan flows. Loaded before dishes.js.
const MAX_SCAN_PHOTOS = 5;

function readFilesAsDataURLs(files) {
  return Promise.all(Array.from(files).map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve({ file, dataUrl: e.target.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
}

function renderPhotoGrid(gridEl, photos) {
  gridEl.innerHTML = photos.map((p, i) => `
    <div class="photo-thumb scanning" id="${gridEl.id}-thumb-${i}">
      <img src="${p.dataUrl}"/>
      <div class="thumb-spinner"></div>
    </div>`).join('');
  gridEl.style.display = 'flex';
}

function markPhotosDone(gridEl) {
  gridEl.querySelectorAll('.photo-thumb').forEach(t => t.classList.remove('scanning'));
}

function imageBlocks(photos) {
  return photos.map(p => ({ type:'image', source:{ type:'base64', media_type:p.file.type||'image/jpeg', data:p.dataUrl.split(',')[1] } }));
}

// Multi-photo responses need room for one full JSON object per possible item,
// or they get truncated mid-response and fail to parse. Scale with photo count.
function scanTokenBudget(photoCount) {
  return Math.min(500 + photoCount * 400, 2400);
}

// Shows a tappable list of results when a multi-photo scan turns up more than
// one distinct item. resolverFnName is the name of a global function
// (resolveFood or setCandidateFromItem) that will be called with (item, source).
function showScanPicker(containerId, items, source, resolverFnName) {
  const el = document.getElementById(containerId);
  el._items = items; el._source = source; el._resolver = resolverFnName;
  el.innerHTML = items.map((item, i) => {
    const badge = item._source === 'usda' ? '<span class="source-badge usda">✓ USDA verified</span>'
      : item._source === 'ai' || item._source === 'identify' ? '<span class="source-badge ai">⚠ AI estimate — unverified</span>' : '';
    return `<div class="search-result-item" onclick="pickScanResult('${containerId}', ${i})">
      <div class="search-result-name">${item.name}${badge}</div>
      <div class="search-result-meta">${item.serving_other||''}</div>
    </div>`;
  }).join('');
  el.style.display = 'block';
}

async function pickScanResult(containerId, i) {
  const el = document.getElementById(containerId);
  const item = el._items[i];
  el.style.display = 'none'; el.innerHTML = '';
  await window[el._resolver](item, item._source || el._source);
}

// ── SCAN LABEL ────────────────────────────────────────────────────────────────
async function handleLabelScan(input) {
  const files = Array.from(input.files || []).slice(0, MAX_SCAN_PHOTOS);
  if (!files.length) return;
  const overflow = input.files.length > MAX_SCAN_PHOTOS;
  const grid = document.getElementById('label-preview-grid');
  document.getElementById('label-scan-results').style.display = 'none';
  const photos = await readFilesAsDataURLs(files);
  renderPhotoGrid(grid, photos);
  setStatus('label-status', overflow ? `Only the first ${MAX_SCAN_PHOTOS} photos are used. Reading…` : (photos.length > 1 ? '🔍 Reading labels…' : '🔍 Reading label…'), '');
  try {
    const multi = photos.length > 1;
    const result = await claudeCall([{ role:'user', content:[
      ...imageBlocks(photos),
      { type:'text', text: `You are shown ${photos.length} photo(s) of nutrition label(s).${multi ? ' Work out whether these photos are different angles/sides of the SAME single product, or labels for DIFFERENT products.' : ''}
Read the label(s) carefully. Respond ONLY with JSON (no markdown):
{"items":[{"name":"product name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number_or_null,"serving_other":"household measure e.g. 1 cup or null"}]}
${multi ? 'If all photos are the SAME product, "items" must contain exactly ONE merged object combining info from all the photos. If they are DIFFERENT products, "items" should contain one object per distinct product.' : '"items" should contain exactly one object.'}
All values per ONE serving as labeled.` }
    ]}], scanTokenBudget(photos.length));
    markPhotosDone(grid);
    setStatus('label-status', '', '');
    const items = result.items || [];
    if (!items.length) { setStatus('label-status', 'Could not read label(s) — try clearer photos.', 'error'); return; }
    if (items.length === 1) { await resolveFood(items[0], 'label'); return; }
    showScanPicker('label-scan-results', items.map(it => ({...it, _source:'label'})), 'label', 'resolveFood');
  } catch(err) { console.error('label scan failed:', err); markPhotosDone(grid); setStatus('label-status', 'Could not read label(s) — try clearer photos.', 'error'); }
}

// ── IDENTIFY FOOD ─────────────────────────────────────────────────────────────
async function handleIdentifyScan(input) {
  const files = Array.from(input.files || []).slice(0, MAX_SCAN_PHOTOS);
  if (!files.length) return;
  const overflow = input.files.length > MAX_SCAN_PHOTOS;
  const grid = document.getElementById('identify-preview-grid');
  document.getElementById('identify-scan-results').style.display = 'none';
  const photos = await readFilesAsDataURLs(files);
  renderPhotoGrid(grid, photos);
  setStatus('identify-status', overflow ? `Only the first ${MAX_SCAN_PHOTOS} photos are used. Identifying…` : (photos.length > 1 ? '🔍 Identifying foods…' : '🔍 Identifying food…'), '');
  try {
    const multi = photos.length > 1;
    const result = await claudeCall([{ role:'user', content:[
      ...imageBlocks(photos),
      { type:'text', text:`You are shown ${photos.length} photo(s). Identify raw whole foods only: fresh fruit, veg, raw dry grains, nuts, seeds, eggs, raw meat/fish. Do NOT identify cooked dishes or packaged foods.
${multi ? 'Work out whether these photos show different angles of the SAME single food item, or MULTIPLE distinct food items.' : ''}
Respond ONLY with JSON (no markdown):
{"items":[{"name":"specific food name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number,"serving_other":"e.g. 1 cup"}]}
${multi ? 'If all photos are the SAME item, "items" must contain exactly ONE object. If they are DIFFERENT items, include one object per distinct item.' : '"items" should contain exactly one object.'}
For any food that isn't identifiable, use {"error":"brief reason"} in its place in the array instead.` }
    ]}], scanTokenBudget(photos.length));
    markPhotosDone(grid);
    const items = result.items || [];
    const valid = items.filter(it => !it.error);
    if (!valid.length) { setStatus('identify-status', `Can't identify: ${items[0]?.error||'try clearer photos'}. Try Search instead.`, 'error'); return; }

    setStatus('identify-status', '📊 Verifying with USDA…', '');
    const enrichedItems = [];
    for (const it of valid) {
      const usdaMatch = (await searchUsdaCandidates(it.name))[0];
      if (usdaMatch) enrichedItems.push({ ...(await enrichWithNaturalPortion(usdaMatch)), name: it.name, _source:'usda' });
      else enrichedItems.push({ ...it, _source:'identify' });
    }
    setStatus('identify-status', '', '');
    if (enrichedItems.length === 1) { await resolveFood(enrichedItems[0], enrichedItems[0]._source); return; }
    showScanPicker('identify-scan-results', enrichedItems, 'identify', 'resolveFood');
  } catch(err) { console.error('identify scan failed:', err); markPhotosDone(grid); setStatus('identify-status', 'Could not identify — try clearer photos or use Search.', 'error'); }
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
async function doSearch() {
  const query = document.getElementById('search-input').value.trim(); if (!query) return;
  const resultsEl = document.getElementById('search-results'); resultsEl.style.display = 'none'; resultsEl.innerHTML = '';
  setStatus('search-status', '🔍 Searching your database…', '');
  try {
    const dbResults = await SB.query('Foods', `?name=ilike.*${encodeURIComponent(query)}*&limit=6`);
    if (dbResults.length > 0) { setStatus('search-status','',''); showResults(dbResults.map(f => ({...f, _src:'db'}))); return; }
  } catch(e) {}

  setStatus('search-status', '📊 Checking USDA database…', '');
  const usdaMatches = await searchUsdaCandidates(query);

  let aiResult = null;
  if (usdaMatches.length === 0) {
    // Only fall back to an AI estimate when USDA has nothing at all
    setStatus('search-status', '🤖 No USDA match — getting AI estimate…', '');
    try {
      aiResult = await claudeCall([{ role:'user', content:`USDA nutrition for: "${query}". ONLY JSON (no markdown): {"name":"food name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number,"serving_other":"standard serving e.g. 1 cup"}. Use USDA FoodData Central values.` }]);
    } catch(err) {}
  }

  setStatus('search-status', '', '');
  const items = [...usdaMatches.map(f => ({...f, _src:'usda'})), ...(aiResult ? [{...aiResult, _src:'claude'}] : [])];
  if (!items.length) { setStatus('search-status', 'No results found. Try different words or use Manual entry.', 'error'); return; }
  showResults(items);
}

function showResults(items) {
  const el = document.getElementById('search-results');
  el.innerHTML = items.map((item, i) => {
    const badge = item._src==='db' ? '<span class="source-badge db">Your DB</span>'
      : item._src==='usda' ? '<span class="source-badge usda">✓ USDA verified</span>'
      : '<span class="source-badge ai">⚠ AI estimate — unverified</span>';
    return `<div class="search-result-item" onclick="pickResult(${i})">
      <div class="search-result-name">${item.name}${badge}</div>
      <div class="search-result-meta">${item.serving_other||''}</div>
    </div>`;
  }).join('');
  el.style.display = 'block'; el._items = items;
}

async function pickResult(i) {
  const item = document.getElementById('search-results')._items[i];
  setStatus('search-status', '', ''); document.getElementById('search-results').style.display = 'none';
  if (item._src === 'db') { pendingFood = item; showServingStep('db'); return; }
  let food = item;
  if (item._src === 'usda') food = await enrichWithNaturalPortion(item);
  await resolveFood(food, item._src); // 'usda' or 'claude'
}

// ── MANUAL ENTRY ──────────────────────────────────────────────────────────────
async function submitManual() {
  const name = document.getElementById('manual-name').value.trim();
  if (!name) { setStatus('manual-status', 'Please enter a food name.', 'error'); return; }
  await resolveFood({
    name,
    calories_per_serving: parseFloat(document.getElementById('manual-cal').value)||0,
    protein_per_serving:  parseFloat(document.getElementById('manual-protein').value)||0,
    carbs_per_serving:    parseFloat(document.getElementById('manual-carbs').value)||0,
    fat_per_serving:      parseFloat(document.getElementById('manual-fat').value)||0,
    serving_other:        document.getElementById('manual-serving-other').value.trim()||null,
    serving_grams:        parseFloat(document.getElementById('manual-serving-grams').value)||null,
  }, 'manual');
}

// ── RESOLVE: DB CHECK → SAVE → SERVING STEP ──────────────────────────────────
async function resolveFood(extracted, source) {
  try {
    const rows = await SB.query('Foods', `?name=ilike.${encodeURIComponent(extracted.name)}&limit=1`);
    if (rows.length > 0) { pendingFood = rows[0]; showServingStep('db'); return; }
  } catch(e) {}
  const newFood = {
    name: extracted.name,
    calories_per_serving: Math.round(extracted.calories_per_serving||0),
    protein_per_serving:  Math.round(extracted.protein_per_serving||0),
    carbs_per_serving:    Math.round(extracted.carbs_per_serving||0),
    fat_per_serving:      Math.round(extracted.fat_per_serving||0),
    serving_grams:        extracted.serving_grams ? Math.round(extracted.serving_grams) : null,
    serving_other:        extracted.serving_other || null,
    source, user_id: currentUserId
  };
  try { const ins = await SB.insert('Foods', newFood); pendingFood = ins[0] || newFood; }
  catch(e) { pendingFood = newFood; }
  showServingStep('new');
}

// ── SERVING STEP ──────────────────────────────────────────────────────────────
function showServingStep(dbStatus) {
  const f = pendingFood;
  document.getElementById('match-name').textContent = f.name;
  const src = document.getElementById('match-source');
  if (dbStatus === 'db') {
    src.innerHTML = '<span class="source-badge db">✓ Found in your database</span>';
  } else if (f.source === 'usda') {
    src.innerHTML = '<span class="source-badge usda">✓ Added — USDA verified</span>';
  } else if (f.source === 'label' || f.source === 'manual') {
    src.innerHTML = '<span class="source-badge manual">✓ Added to your database</span>';
  } else {
    src.innerHTML = '<span class="source-badge ai">⚠ Added — AI estimate, not verified</span>';
  }
  const sg = f.serving_grams, so = f.serving_other, desc = so ? so : (sg ? sg+'g' : '1 serving');
  document.getElementById('match-macros').innerHTML = `
    <div class="match-macro"><div class="match-macro-val">${f.calories_per_serving||0}</div><div class="match-macro-name">kcal</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.protein_per_serving||0}g</div><div class="match-macro-name">protein</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.carbs_per_serving||0}g</div><div class="match-macro-name">carbs</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.fat_per_serving||0}g</div><div class="match-macro-name">fat</div></div>
    <div style="grid-column:1/-1;font-size:11px;color:#999;text-align:center">per serving (${desc})</div>`;
  document.getElementById('by-grams-btn').style.display = sg ? '' : 'none';
  setServingMode(sg ? 'grams' : 'servings');
  document.getElementById('serving-amount').value = '';
  document.getElementById('serving-preview').textContent = '';
  goToStep('step-serving');
}

function setServingMode(mode) {
  servingMode = mode;
  document.getElementById('by-grams-btn').classList.toggle('active', mode==='grams');
  document.getElementById('by-servings-btn').classList.toggle('active', mode==='servings');
  const f = pendingFood;
  document.getElementById('serving-unit-label').textContent = mode==='grams' ? 'grams' : '× '+(f?.serving_other||(f?.serving_grams?f.serving_grams+'g':'serving'));
  updateServingPreview();
}

function updateServingPreview() {
  const f = pendingFood; if (!f) return;
  const amt = parseFloat(document.getElementById('serving-amount').value);
  if (isNaN(amt) || amt <= 0) { document.getElementById('serving-preview').textContent = ''; return; }
  let ratio;
  if (servingMode === 'grams') {
    if (!f.serving_grams) { document.getElementById('serving-preview').textContent = 'No gram weight on file'; return; }
    ratio = amt / f.serving_grams;
  } else { ratio = amt; }
  const cal=Math.round((f.calories_per_serving||0)*ratio), p=Math.round((f.protein_per_serving||0)*ratio),
        c=Math.round((f.carbs_per_serving||0)*ratio), ft=Math.round((f.fat_per_serving||0)*ratio);
  document.getElementById('serving-preview').textContent = `→ ${cal} kcal · P:${p}g C:${c}g F:${ft}g`;
}

async function confirmLog() {
  const f = pendingFood; if (!f) return;
  const amt = parseFloat(document.getElementById('serving-amount').value);
  if (isNaN(amt) || amt <= 0) { showToast('Enter an amount'); return; }
  let ratio, grams = null, servingSize;
  if (servingMode === 'grams') {
    ratio = amt/f.serving_grams; grams = Math.round(amt); servingSize = amt+'g';
  } else {
    ratio = amt; grams = f.serving_grams ? Math.round(f.serving_grams*amt) : null;
    servingSize = amt+' × '+(f.serving_other||(f.serving_grams?f.serving_grams+'g':'serving'));
  }
  const meal = editingLogId ? document.getElementById('edit-meal-select').value : currentMeal;
  const entry = {
    date: new Date(currentDate+'T12:00:00').toISOString(),
    meal, food_id: f.name, food_name: f.name,
    grams, serving_size: servingSize,
    calories: Math.round((f.calories_per_serving||0)*ratio),
    protein:  Math.round((f.protein_per_serving||0)*ratio),
    carbs:    Math.round((f.carbs_per_serving||0)*ratio),
    fat:      Math.round((f.fat_per_serving||0)*ratio),
    user_id: currentUserId
  };
  const wasEditing = editingLogId;
  const btn = document.getElementById('confirm-btn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (wasEditing) await SB.patch('Food_Logs', `?id=eq.${wasEditing}`, entry);
    else await SB.insert('Food_Logs', entry);
    closeModal(); await loadTodayLogs();
    showToast(wasEditing ? 'Entry updated' : f.name+' added');
  } catch(err) { showToast('Error saving — check Supabase RLS'); console.error(err); }
  finally { btn.disabled = false; }
}
