// ── STATE ─────────────────────────────────────────────────────────────────────
let currentMeal = 'Breakfast';
let pendingFood = null;
let servingMode = 'grams';

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
  document.getElementById('modal-title').textContent = 'Add to ' + meal;
  document.getElementById('add-modal').classList.add('open');
  goToStep('step-method'); selectMethod('label'); resetAllInputs();
}
function closeModal() { document.getElementById('add-modal').classList.remove('open'); pendingFood = null; }
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

// ── SCAN LABEL ────────────────────────────────────────────────────────────────
async function handleLabelScan(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const img = document.getElementById('label-preview'); img.src = e.target.result; img.style.display = 'block';
    setStatus('label-status', '🔍 Reading label…', '');
    try {
      const result = await claudeCall([{ role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:file.type||'image/jpeg', data:e.target.result.split(',')[1] } },
        { type:'text', text:'Read this nutrition label carefully. Respond ONLY with JSON (no markdown): {"name":"product name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number_or_null,"serving_other":"household measure e.g. 1 cup or null"}. All values per ONE serving as labeled.' }
      ]}], 800);
      setStatus('label-status', '', '');
      await resolveFood(result, 'label');
    } catch(err) { setStatus('label-status', 'Could not read label — try a clearer photo.', 'error'); }
  };
  reader.readAsDataURL(file);
}

// ── IDENTIFY FOOD ─────────────────────────────────────────────────────────────
async function handleIdentifyScan(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const img = document.getElementById('identify-preview'); img.src = e.target.result; img.style.display = 'block';
    setStatus('identify-status', '🔍 Identifying food…', '');
    try {
      const result = await claudeCall([{ role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:file.type||'image/jpeg', data:e.target.result.split(',')[1] } },
        { type:'text', text:`Identify the raw whole food in this photo. Only identify: fresh fruit, veg, raw dry grains, nuts, seeds, eggs, raw meat/fish. Do NOT identify cooked dishes or packaged foods.

If identifiable, respond ONLY with JSON (no markdown):
{"name":"specific food name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number,"serving_other":"e.g. 1 cup"}

If not identifiable, respond ONLY with: {"error":"brief reason"}` }
      ]}], 800);
      if (result.error) { setStatus('identify-status', `Can't identify: ${result.error}. Try Search instead.`, 'error'); return; }

      setStatus('identify-status', '📊 Verifying with USDA…', '');
      const usdaMatch = (await searchUsdaCandidates(result.name))[0];
      setStatus('identify-status', '', '');
      if (usdaMatch) {
        const enriched = await enrichWithNaturalPortion(usdaMatch);
        await resolveFood({ ...enriched, name: result.name }, 'usda');
      } else {
        await resolveFood(result, 'identify');
      }
    } catch(err) { setStatus('identify-status', 'Could not identify — try a clearer photo or use Search.', 'error'); }
  };
  reader.readAsDataURL(file);
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
  const entry = {
    date: new Date(currentDate+'T12:00:00').toISOString(),
    meal: currentMeal, food_id: f.name, food_name: f.name,
    grams, serving_size: servingSize,
    calories: Math.round((f.calories_per_serving||0)*ratio),
    protein:  Math.round((f.protein_per_serving||0)*ratio),
    carbs:    Math.round((f.carbs_per_serving||0)*ratio),
    fat:      Math.round((f.fat_per_serving||0)*ratio),
    user_id: currentUserId
  };
  const btn = document.getElementById('confirm-btn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await SB.insert('Food_Logs', entry); closeModal(); await loadTodayLogs(); showToast(f.name+' added');
  } catch(err) { showToast('Error saving — check Supabase RLS'); console.error(err); }
  finally { btn.disabled = false; btn.textContent = 'Add to meal'; }
}
