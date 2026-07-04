// ── STATE ─────────────────────────────────────────────────────────────────────
let weights = [];
let currentDate = todayStr();
let todayLogs = [];
let historyChart = null;
let weightChart = null;

// Returns a LOCAL calendar-day string (YYYY-MM-DD) for the given Date (defaults to now).
// Deliberately avoids toISOString(), which converts to UTC and rolls over to the
// next calendar day in the evening for timezones behind UTC (like Toronto).
function todayStr(d) {
  d = d || new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function formatDate(str) {
  const t = todayStr(), y = new Date(); y.setDate(y.getDate()-1); const ys = todayStr(y);
  if (str === t) return 'Today'; if (str === ys) return 'Yesterday';
  return new Date(str+'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function mealEmoji(m) { return { Breakfast:'☕', Lunch:'🥗', Dinner:'🍽️', Snacks:'🍎' }[m] || '🍴'; }

// ── DATE NAV ──────────────────────────────────────────────────────────────────
function changeDay(d) {
  const dt = new Date(currentDate+'T12:00:00'); dt.setDate(dt.getDate()+d);
  // Compare calendar-day strings (not exact timestamps) so this can't block
  // navigating to "today" depending on what time of day it currently is.
  if (todayStr(dt) > todayStr()) return;
  currentDate = todayStr(dt); loadTodayLogs();
}

// ── FOOD LOGS ─────────────────────────────────────────────────────────────────
async function loadTodayLogs() {
  document.getElementById('date-display').textContent = formatDate(currentDate);
  try {
    const from = currentDate+'T00:00:00.000Z', to = currentDate+'T23:59:59.999Z';
    todayLogs = await SB.query('Food_Logs', `?date=gte.${from}&date=lte.${to}&select=*`);
  } catch(e) { todayLogs = []; }
  renderToday();
}

async function deleteLog(id) {
  try { await SB.remove('Food_Logs', `?id=eq.${id}`); await loadTodayLogs(); showToast('Removed'); }
  catch(e) { showToast('Error removing entry'); }
}

// Opens the existing Add-food modal pre-filled for an existing log entry.
// Tries to find the original food record (by name) so amount/serving math
// stays consistent; falls back to the Manual tab, prefilled with the log's
// own numbers, if that food no longer exists in "Foods".
async function editLog(id) {
  const log = todayLogs.find(l => l.id === id); if (!log) return;
  editingLogId = id;
  document.getElementById('modal-title').textContent = 'Edit entry';
  document.getElementById('edit-meal-select').value = log.meal;
  document.getElementById('edit-meal-row').style.display = 'block';
  document.getElementById('add-modal').classList.add('open');
  resetAllInputs();

  let food = null;
  try {
    const rows = await SB.query('Foods', `?name=ilike.${encodeURIComponent(log.food_name)}&limit=1`);
    if (rows.length) food = rows[0];
  } catch(e) {}

  if (food) {
    currentMeal = log.meal;
    pendingFood = food;
    showServingStep('db');
    if (food.serving_grams) {
      setServingMode('grams');
      document.getElementById('serving-amount').value = log.grams || food.serving_grams;
    } else {
      setServingMode('servings');
      document.getElementById('serving-amount').value = parseFloat((log.serving_size||'').split('×')[0]) || 1;
    }
    updateServingPreview();
  } else {
    goToStep('step-method'); selectMethod('manual');
    document.getElementById('manual-name').value = log.food_name || '';
    document.getElementById('manual-serving-other').value = log.serving_size || '';
    document.getElementById('manual-serving-grams').value = log.grams || '';
    document.getElementById('manual-cal').value = Math.round(log.calories||0);
    document.getElementById('manual-protein').value = Math.round(log.protein||0);
    document.getElementById('manual-carbs').value = Math.round(log.carbs||0);
    document.getElementById('manual-fat').value = Math.round(log.fat||0);
  }
  document.getElementById('confirm-btn').textContent = 'Save changes';
}

// ── RENDER TODAY ──────────────────────────────────────────────────────────────
function renderToday() {
  let tc=0, tp=0, tca=0, tf=0;
  todayLogs.forEach(l => { tc+=l.calories||0; tp+=l.protein||0; tca+=l.carbs||0; tf+=l.fat||0; });
  tc=Math.round(tc); tp=Math.round(tp); tca=Math.round(tca); tf=Math.round(tf);

  ['Breakfast','Lunch','Dinner','Snacks'].forEach(meal => {
    const el = document.getElementById('meal-'+meal.toLowerCase());
    const items = todayLogs.filter(l => l.meal === meal);
    if (!items.length) { el.innerHTML = '<div class="empty-state"><span class="empty-icon">🥣</span>No entries yet</div>'; return; }
    el.innerHTML = items.map(l => `<div class="food-item">
      <div class="food-icon">${mealEmoji(meal)}</div>
      <div class="food-info">
        <div class="food-name">${l.food_name||'—'}</div>
        <div class="food-meta">${l.serving_size||''} · P:${Math.round(l.protein||0)}g C:${Math.round(l.carbs||0)}g F:${Math.round(l.fat||0)}g</div>
      </div>
      <span class="food-cal">${Math.round(l.calories||0)}</span>
      <button class="food-del" onclick="editLog(${l.id})" style="color:#3b82f6">✎</button>
      <button class="food-del" onclick="deleteLog(${l.id})">✕</button>
    </div>`).join('');
  });

  const gc = goals.calories || 0;
  document.getElementById('ring-cal').textContent = tc;
  document.getElementById('ring-progress').style.strokeDashoffset = gc ? 251.2*(1-Math.min(tc/gc,1)) : 251.2;
  document.getElementById('ring-progress').style.stroke = tc>gc&&gc ? '#ef4444' : '#10b981';
  document.getElementById('today-protein').textContent = tp+'g';
  document.getElementById('today-carbs').textContent = tca+'g';
  document.getElementById('today-fat').textContent = tf+'g';
  document.getElementById('goal-protein-lbl').textContent = goals.protein ? '/ '+goals.protein+'g' : '';
  document.getElementById('goal-carbs-lbl').textContent = goals.carbs ? '/ '+goals.carbs+'g' : '';
  document.getElementById('goal-fat-lbl').textContent = goals.fat ? '/ '+goals.fat+'g' : '';
  if (goals.protein) document.getElementById('bar-protein').style.width = Math.min(tp/goals.protein*100,100)+'%';
  if (goals.carbs)   document.getElementById('bar-carbs').style.width   = Math.min(tca/goals.carbs*100,100)+'%';
  if (goals.fat)     document.getElementById('bar-fat').style.width     = Math.min(tf/goals.fat*100,100)+'%';
  document.getElementById('cal-goal-lbl').textContent = gc || '—';
  document.getElementById('cal-remain').textContent = gc ? Math.max(gc-tc,0) : '—';
  renderStreak();
}

async function renderStreak() {
  try {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-60);
    const logs = await SB.query('Food_Logs', '?date=gte.'+cutoff.toISOString()+'&select=date');
    const days = new Set(logs.map(l => todayStr(new Date(l.date))));
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      if (days.has(todayStr(d))) streak++;
      else if (i > 0) break;
    }
    document.getElementById('streak-val').textContent = streak;
  } catch(e) { document.getElementById('streak-val').textContent = '—'; }
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
async function renderHistory() {
  const from14 = new Date(); from14.setDate(from14.getDate()-13); from14.setHours(0,0,0,0);
  let allLogs = [];
  try { allLogs = await SB.query('Food_Logs', '?date=gte.'+from14.toISOString()+'&select=date,calories'); } catch(e) {}
  const calByDate = {};
  allLogs.forEach(l => { const day = todayStr(new Date(l.date)); calByDate[day] = (calByDate[day]||0) + (l.calories||0); });
  const dates = [], cals = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i); const str = todayStr(d);
    dates.push(formatDate(str)); cals.push(Math.round(calByDate[str]||0));
  }
  const ctx = document.getElementById('history-chart').getContext('2d');
  if (historyChart) historyChart.destroy();
  const gc = goals.calories || 0;
  historyChart = new Chart(ctx, { type:'bar', data:{ labels:dates, datasets:[{ data:cals, backgroundColor:cals.map(c=>gc&&c>gc?'#ef4444':'#10b981'), borderRadius:4 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:v=>v.raw+' kcal'}} }, scales:{ x:{grid:{display:false},ticks:{font:{size:10},maxRotation:45}}, y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10}}} } } });
  const list = document.getElementById('history-list'), rows = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate()-i); const str = todayStr(d);
    const c = Math.round(calByDate[str]||0); if (!c) continue;
    rows.push(`<div class="card" style="padding:.75rem 1rem;margin-bottom:.5rem"><div style="display:flex;justify-content:space-between"><span style="font-size:14px;font-weight:500">${formatDate(str)}</span><span style="font-size:14px;font-weight:600;color:${gc&&c>gc?'#ef4444':'#10b981'}">${c} kcal</span></div></div>`);
  }
  list.innerHTML = rows.length ? rows.join('') : '<div class="empty-state"><span class="empty-icon">📊</span>No history yet</div>';
}

// ── WEIGHT ────────────────────────────────────────────────────────────────────
async function loadWeights() {
  try { weights = await SB.query('Weights', '?select=*&order=date.asc'); }
  catch(e) { weights = []; }
}

function renderWeight() {
  const list = document.getElementById('weight-list');
  list.innerHTML = weights.length
    ? weights.slice().reverse().slice(0,15).map(w => `<div class="weight-log-item">
        <div class="weight-log-info">
          <span style="color:#999;font-size:13px">${formatDate(w.date)}</span>
          <span style="font-weight:600">${w.value} ${w.unit}</span>
        </div>
        <button class="food-del" onclick="deleteWeight(${w.id})">✕</button>
      </div>`).join('')
    : '<div class="empty-state"><span class="empty-icon">⚖️</span>No weight entries yet</div>';
  const ctx = document.getElementById('weight-chart').getContext('2d');
  if (weightChart) weightChart.destroy();
  const wd = weights.slice(-30);
  weightChart = new Chart(ctx, { type:'line', data:{ labels:wd.length?wd.map(w=>formatDate(w.date)):[''], datasets:[{ data:wd.length?wd.map(w=>w.value):[0], borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.1)', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#10b981' }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{font:{size:10},maxRotation:45}}, y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10}}} } } });
}

async function logWeight() {
  const val = parseFloat(document.getElementById('weight-input').value), unit = document.getElementById('weight-unit').value;
  if (isNaN(val) || val < 20) return showToast('Enter a valid weight');
  const btn = document.querySelector('.log-btn'); if (btn) btn.disabled = true;
  try {
    await SB.insert('Weights', { date: todayStr(), value: val, unit, user_id: currentUserId });
    document.getElementById('weight-input').value = '';
    await loadWeights(); renderWeight(); showToast('Weight logged');
  } catch(e) { showToast('Error saving weight'); console.error(e); }
  finally { if (btn) btn.disabled = false; }
}

async function deleteWeight(id) {
  try { await SB.remove('Weights', `?id=eq.${id}`); await loadWeights(); renderWeight(); showToast('Removed'); }
  catch(e) { showToast('Error removing entry'); }
}
