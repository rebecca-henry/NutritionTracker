// ── STATE ─────────────────────────────────────────────────────────────────────
let dishIngredients = [];
let dishPhotoData = null;
let cachedDishes = [];
let editingDishId = null;

// ── INGREDIENT LOOKUP (per 100g) ─────────────────────────────────────────────
// Same waterfall as regular food lookup (your DB → USDA → Claude estimate),
// but always normalized to per-100g since ingredients are always weighed.
async function lookupIngredientPer100g(name) {
  try {
    const rows = await SB.query('Foods', `?name=ilike.${encodeURIComponent(name)}&limit=1`);
    if (rows.length && rows[0].serving_grams) {
      const f = rows[0], ratio = 100 / f.serving_grams;
      return {
        calories: (f.calories_per_serving||0)*ratio, protein: (f.protein_per_serving||0)*ratio,
        carbs: (f.carbs_per_serving||0)*ratio, fat: (f.fat_per_serving||0)*ratio, source: 'db'
      };
    }
  } catch(e) {}

  const usdaMatches = await searchUsdaCandidates(name); // already per-100g
  if (usdaMatches.length) {
    const u = usdaMatches[0];
    saveIngredientToFoods(name, u, 'usda');
    return { calories: u.calories_per_serving, protein: u.protein_per_serving, carbs: u.carbs_per_serving, fat: u.fat_per_serving, source: 'usda' };
  }

  try {
    const ai = await claudeCall([{ role:'user', content:`Give USDA-style nutrition per 100g for: "${name}". ONLY JSON (no markdown): {"calories":number,"protein":number,"carbs":number,"fat":number}` }], 300);
    saveIngredientToFoods(name, { calories_per_serving: ai.calories, protein_per_serving: ai.protein, carbs_per_serving: ai.carbs, fat_per_serving: ai.fat, serving_grams: 100 }, 'ai');
    return { calories: ai.calories||0, protein: ai.protein||0, carbs: ai.carbs||0, fat: ai.fat||0, source: 'ai' };
  } catch(e) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, source: 'ai' };
  }
}

async function saveIngredientToFoods(name, per100, source) {
  try {
    await SB.insert('Foods', {
      name,
      calories_per_serving: Math.round(per100.calories_per_serving ?? per100.calories ?? 0),
      protein_per_serving:  Math.round(per100.protein_per_serving ?? per100.protein ?? 0),
      carbs_per_serving:    Math.round(per100.carbs_per_serving ?? per100.carbs ?? 0),
      fat_per_serving:      Math.round(per100.fat_per_serving ?? per100.fat ?? 0),
      serving_grams: 100, serving_other: null, source, user_id: currentUserId
    });
  } catch(e) {}
}

// ── BUILDER: INGREDIENTS ──────────────────────────────────────────────────────
async function addDishIngredient() {
  const nameEl = document.getElementById('dish-ingredient-name');
  const gramsEl = document.getElementById('dish-ingredient-grams');
  const noCal = document.getElementById('dish-ingredient-nocal').checked;
  const name = nameEl.value.trim();
  const grams = parseFloat(gramsEl.value);
  if (!name) { setStatus('dish-ingredient-status', 'Enter an ingredient name.', 'error'); return; }
  if (isNaN(grams) || grams <= 0) { setStatus('dish-ingredient-status', 'Enter the weight in grams.', 'error'); return; }

  let per100 = { calories: 0, protein: 0, carbs: 0, fat: 0, source: 'manual' };
  if (!noCal) {
    setStatus('dish-ingredient-status', `🔍 Looking up ${name}…`, '');
    per100 = await lookupIngredientPer100g(name);
  }
  setStatus('dish-ingredient-status', '', '');

  const ratio = grams / 100;
  dishIngredients.push({
    name, grams, noCal,
    calories: Math.round(per100.calories*ratio), protein: Math.round(per100.protein*ratio),
    carbs: Math.round(per100.carbs*ratio), fat: Math.round(per100.fat*ratio),
    source: noCal ? 'manual' : per100.source
  });
  nameEl.value = ''; gramsEl.value = ''; document.getElementById('dish-ingredient-nocal').checked = false;
  renderDishIngredients();
  nameEl.focus();
}

function removeDishIngredient(i) { dishIngredients.splice(i, 1); renderDishIngredients(); }

// Edits a single ingredient's weight in place, scaling its macros
// proportionally (no re-lookup needed since per-100g values don't change).
// To change an ingredient's name/type, remove it and add it again instead.
function editDishIngredient(i) {
  const ing = dishIngredients[i];
  const input = prompt(`Grams for "${ing.name}":`, ing.grams);
  if (input === null) return;
  const newGrams = parseFloat(input);
  if (isNaN(newGrams) || newGrams <= 0) { showToast('Enter a valid weight'); return; }
  const ratio = newGrams / ing.grams;
  ing.grams = newGrams;
  ing.calories = Math.round(ing.calories * ratio);
  ing.protein = Math.round(ing.protein * ratio);
  ing.carbs = Math.round(ing.carbs * ratio);
  ing.fat = Math.round(ing.fat * ratio);
  renderDishIngredients();
}

function renderDishIngredients() {
  const el = document.getElementById('dish-ingredients-list');
  el.innerHTML = dishIngredients.map((ing, i) => {
    const badge = ing.noCal ? '<span class="source-badge manual">0 cal</span>'
      : ing.source === 'db' ? '<span class="source-badge db">Your DB</span>'
      : ing.source === 'usda' ? '<span class="source-badge usda">✓ USDA</span>'
      : '<span class="source-badge ai">⚠ AI estimate</span>';
    return `<div class="search-result-item" style="display:flex;justify-content:space-between;align-items:center;cursor:default">
      <div style="cursor:pointer" onclick="editDishIngredient(${i})" title="Tap to edit weight">
        <div class="search-result-name">${ing.name} · ${ing.grams}g${badge} ✏️</div>
        <div class="search-result-meta">${ing.calories} kcal · P:${ing.protein}g C:${ing.carbs}g F:${ing.fat}g</div>
      </div>
      <button class="food-del" onclick="removeDishIngredient(${i})">✕</button>
    </div>`;
  }).join('');
  updateDishTotals();
}

// ── BUILDER: WEIGHT & TOTALS ──────────────────────────────────────────────────
function dishRawTotals() {
  return dishIngredients.reduce((t, ing) => ({
    grams: t.grams + ing.grams, calories: t.calories + ing.calories,
    protein: t.protein + ing.protein, carbs: t.carbs + ing.carbs, fat: t.fat + ing.fat
  }), { grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0 });
}

// Estimates final cooked weight without requiring a scale big enough for the
// whole dish. Defaults to the raw ingredient sum (accurate as long as drained
// water wasn't counted as an ingredient); offers a rough correction for
// dishes that genuinely lose moisture, or a manual override if measured.
function finalDishWeight(rawGrams) {
  const mode = document.getElementById('dish-weight-mode').value;
  if (mode === 'actual') {
    const w = parseFloat(document.getElementById('dish-actual-weight').value);
    return (!isNaN(w) && w > 0) ? w : rawGrams;
  }
  if (mode === 'light') return rawGrams * 0.9;
  if (mode === 'heavy') return rawGrams * 0.75;
  return rawGrams;
}

function onDishWeightModeChange() {
  document.getElementById('dish-actual-weight-wrap').style.display =
    document.getElementById('dish-weight-mode').value === 'actual' ? 'block' : 'none';
  updateDishTotals();
}

function updateDishTotals() {
  const raw = dishRawTotals();
  const el = document.getElementById('dish-totals');
  if (raw.grams === 0) { el.innerHTML = ''; return; }
  const finalWeight = Math.round(finalDishWeight(raw.grams));
  const per100 = finalWeight > 0 ? {
    calories: Math.round(raw.calories / finalWeight * 100), protein: Math.round(raw.protein / finalWeight * 100),
    carbs: Math.round(raw.carbs / finalWeight * 100), fat: Math.round(raw.fat / finalWeight * 100)
  } : { calories: 0, protein: 0, carbs: 0, fat: 0 };
  el.innerHTML = `
    <div style="font-size:12px;color:#666;margin-bottom:4px">Raw ingredients: ${raw.grams}g · ${raw.calories} kcal total</div>
    <div style="font-size:12px;color:#666;margin-bottom:8px">Estimated final dish weight: ${finalWeight}g</div>
    <div class="match-macros">
      <div class="match-macro"><div class="match-macro-val">${per100.calories}</div><div class="match-macro-name">kcal/100g</div></div>
      <div class="match-macro"><div class="match-macro-val">${per100.protein}g</div><div class="match-macro-name">protein</div></div>
      <div class="match-macro"><div class="match-macro-val">${per100.carbs}g</div><div class="match-macro-name">carbs</div></div>
      <div class="match-macro"><div class="match-macro-val">${per100.fat}g</div><div class="match-macro-name">fat</div></div>
    </div>`;
}

// ── BUILDER: PHOTO ────────────────────────────────────────────────────────────
function handleDishPhoto(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 600;
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = h*maxDim/w; w = maxDim; }
      else if (h > maxDim) { w = w*maxDim/h; h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      dishPhotoData = canvas.toDataURL('image/jpeg', 0.7);
      const prev = document.getElementById('dish-photo-preview');
      prev.src = dishPhotoData; prev.style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── SAVE / RESET ──────────────────────────────────────────────────────────────
async function saveDish() {
  const name = document.getElementById('dish-name').value.trim();
  if (!name) { setStatus('dish-save-status', 'Give your dish a name.', 'error'); return; }
  if (!dishIngredients.length) { setStatus('dish-save-status', 'Add at least one ingredient.', 'error'); return; }
  const raw = dishRawTotals();
  const finalWeight = Math.round(finalDishWeight(raw.grams));
  if (finalWeight <= 0) { setStatus('dish-save-status', 'Something is off with the weight.', 'error'); return; }

  const per100 = {
    calories: Math.round(raw.calories / finalWeight * 100), protein: Math.round(raw.protein / finalWeight * 100),
    carbs: Math.round(raw.carbs / finalWeight * 100), fat: Math.round(raw.fat / finalWeight * 100)
  };
  const body = {
    name, calories_per_serving: per100.calories, protein_per_serving: per100.protein,
    carbs_per_serving: per100.carbs, fat_per_serving: per100.fat,
    serving_grams: 100, serving_other: null, source: 'dish', is_dish: true,
    ingredients: dishIngredients, photo_data: dishPhotoData, dish_final_weight: finalWeight,
    user_id: currentUserId
  };

  const btn = document.getElementById('dish-save-btn'); btn.disabled = true;
  btn.textContent = editingDishId ? 'Updating…' : 'Saving…';
  try {
    if (editingDishId) await SB.patch('Foods', `?id=eq.${editingDishId}`, body);
    else await SB.insert('Foods', body);
    showToast(name + (editingDishId ? ' updated' : ' saved'));
    resetDishBuilder();
    await renderDishList();
    showDishListView();
  } catch (err) {
    setStatus('dish-save-status', 'Error saving — check Supabase RLS/columns.', 'error'); console.error(err);
  } finally { btn.disabled = false; btn.textContent = editingDishId ? 'Update dish' : 'Save dish'; }
}

function resetDishBuilder() {
  dishIngredients = []; dishPhotoData = null; editingDishId = null;
  document.getElementById('dish-name').value = '';
  document.getElementById('dish-ingredients-list').innerHTML = '';
  document.getElementById('dish-totals').innerHTML = '';
  document.getElementById('dish-photo-preview').style.display = 'none';
  document.getElementById('dish-photo-input').value = '';
  document.getElementById('dish-weight-mode').value = 'same';
  document.getElementById('dish-actual-weight').value = '';
  document.getElementById('dish-actual-weight-wrap').style.display = 'none';
  document.getElementById('dish-save-btn').textContent = 'Save dish';
  setStatus('dish-save-status', '', '');
}

function cancelDishBuilder() { resetDishBuilder(); showDishListView(); }

// Loads a saved dish's ingredients back into the builder for editing.
// Preserves the original final weight (via dish_final_weight) so edits
// don't silently drift from whatever moisture-loss assumption was used originally.
function editDish(i) {
  const d = cachedDishes[i];
  resetDishBuilder();
  editingDishId = d.id;
  document.getElementById('dish-name').value = d.name;
  dishIngredients = JSON.parse(JSON.stringify(d.ingredients || []));
  if (d.photo_data) {
    dishPhotoData = d.photo_data;
    const prev = document.getElementById('dish-photo-preview');
    prev.src = d.photo_data; prev.style.display = 'block';
  }
  if (d.dish_final_weight) {
    document.getElementById('dish-weight-mode').value = 'actual';
    document.getElementById('dish-actual-weight').value = d.dish_final_weight;
    document.getElementById('dish-actual-weight-wrap').style.display = 'block';
  }
  document.getElementById('dish-save-btn').textContent = 'Update dish';
  renderDishIngredients();
  showDishBuilderView();
}

// ── LIST VIEW ─────────────────────────────────────────────────────────────────
function showDishBuilderView() {
  document.getElementById('dish-list-view').style.display = 'none';
  document.getElementById('dish-builder-view').style.display = 'block';
}
function showDishListView() {
  document.getElementById('dish-builder-view').style.display = 'none';
  document.getElementById('dish-list-view').style.display = 'block';
}

async function renderDishList() {
  const grid = document.getElementById('dishes-grid');
  grid.innerHTML = '<div class="status-msg visible">Loading…</div>';
  try { cachedDishes = await SB.query('Foods', `?is_dish=eq.true&order=name`); }
  catch(e) { cachedDishes = []; }
  if (!cachedDishes.length) { grid.innerHTML = '<div class="status-msg visible">No dishes yet — create one above.</div>'; return; }
  grid.innerHTML = cachedDishes.map((d, i) => `
    <div class="card" style="display:flex;gap:12px;align-items:center">
      ${d.photo_data ? `<img src="${d.photo_data}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0">` : `<div class="food-icon" style="width:56px;height:56px;font-size:24px">🍽️</div>`}
      <div style="flex:1;min-width:0">
        <div class="food-name">${d.name}</div>
        <div class="food-meta">${d.calories_per_serving} kcal / 100g · ${(d.ingredients||[]).length} ingredients</div>
      </div>
      <button class="log-btn" onclick="promptLogDish(${i})">Log</button>
      <button class="back-btn" style="width:auto;padding:8px 10px" onclick="editDish(${i})">Edit</button>
      <button class="food-del" onclick="deleteDish('${d.id}')">✕</button>
    </div>`).join('');
}

async function deleteDish(id) {
  if (!confirm('Delete this dish?')) return;
  try { await SB.remove('Foods', `?id=eq.${id}`); await renderDishList(); }
  catch(e) { showToast('Error deleting'); }
}

// Lets you log a serving straight from the Dishes tab, reusing the existing
// serving-entry step from food.js instead of duplicating that UI.
function promptLogDish(i) {
  const meal = prompt('Log to which meal? (Breakfast/Lunch/Dinner/Snack)', 'Breakfast');
  if (!meal) return;
  const d = cachedDishes[i];
  currentMeal = meal;
  document.getElementById('modal-title').textContent = 'Add to ' + meal;
  pendingFood = d;
  document.getElementById('add-modal').classList.add('open');
  showServingStep('db');
}
