// ── STATE ─────────────────────────────────────────────────────────────────────
let goals = { calories: null, protein: null, carbs: null, fat: null };

// ── PERSIST ───────────────────────────────────────────────────────────────────
async function loadGoals() {
  try {
    const rows = await SB.query('goals', `?user_id=eq.${currentUserId}&select=calories,protein,carbs,fat`);
    if (rows.length > 0) {
      const g = rows[0];
      goals = { calories: g.calories, protein: g.protein, carbs: g.carbs, fat: g.fat };
      return;
    }
  } catch(e) {}
  // Offline fallback
  try { const g = localStorage.getItem('nt-goals'); if (g) goals = JSON.parse(g); } catch(e) {}
}

async function saveGoalsRemote() {
  try {
    await SB.patch('goals', `?user_id=eq.${currentUserId}`, {
      calories: goals.calories, protein: goals.protein,
      carbs: goals.carbs, fat: goals.fat,
      updated_at: new Date().toISOString()
    });
  } catch(e) {}
  localStorage.setItem('nt-goals', JSON.stringify(goals));
}

// ── FORM HELPERS ──────────────────────────────────────────────────────────────
function gv(id) { const v = parseFloat(document.getElementById(id).value); return isNaN(v) || v < 0 ? null : v; }
function sv(id, val) { document.getElementById(id).value = val === null ? '' : String(Math.round(val * 10) / 10); }

function onMacroInput() { updateGoalPreview(); }
function onCalInput() {
  const nc = gv('g-cal'), p = gv('g-protein'), c = gv('g-carbs'), f = gv('g-fat');
  if (nc === null) { updateGoalPreview(); return; }
  const cur = (p||0)*4 + (c||0)*4 + (f||0)*9;
  if (cur > 0) {
    const r = nc / cur;
    if (p !== null) sv('g-protein', p * r);
    if (c !== null) sv('g-carbs', c * r);
    if (f !== null) sv('g-fat', f * r);
  }
  updateGoalPreview();
}

function updateGoalPreview() {
  const p = gv('g-protein')||0, c = gv('g-carbs')||0, f = gv('g-fat')||0, cal = gv('g-cal')||0;
  const pv = document.getElementById('goals-preview');
  if (!p && !c && !f && !cal) { pv.style.display = 'none'; return; }
  pv.style.display = 'block';
  const mk = p*4+c*4+f*9, isOver = cal>0&&mk>cal, excess = isOver?mk-cal:0, unused = !isOver&&cal>0?cal-mk:0, bt = Math.max(cal,mk)||1;
  ['p','c','f'].forEach((k,i) => {
    const kcal = [p*4, c*4, f*9][i];
    document.getElementById('seg-'+k).style.flex = String(kcal/bt);
  });
  document.getElementById('seg-u').style.flex = String(unused/bt);
  document.getElementById('seg-x').style.flex = String(excess/bt);
  const labels = { p: p?`Protein ${Math.round(p*4/bt*100)}%`:'', c: c?`Carbs ${Math.round(c*4/bt*100)}%`:'', f: f?`Fat ${Math.round(f*9/bt*100)}%`:'' };
  Object.entries(labels).forEach(([k,v]) => document.getElementById('lbl-'+k).textContent = v);
  document.getElementById('lbl-u').textContent = unused > 0 ? `Unassigned ${Math.round(unused/bt*100)}%` : '';
  document.getElementById('lbl-x').textContent = excess > 0 ? `Over by ${Math.round(excess)} kcal` : '';
  const parts = [];
  if (p) parts.push(`<strong>${Math.round(p)}g</strong> protein × 4 = <strong>${Math.round(p*4)}</strong> kcal`);
  if (c) parts.push(`<strong>${Math.round(c)}g</strong> carbs × 4 = <strong>${Math.round(c*4)}</strong> kcal`);
  if (f) parts.push(`<strong>${Math.round(f)}g</strong> fat × 9 = <strong>${Math.round(f*9)}</strong> kcal`);
  const status = isOver ? ` — <strong style="color:#ef4444">+${Math.round(excess)} kcal over</strong>`
    : unused > 0 ? ` — <strong>${Math.round(unused)} kcal unassigned</strong>` : ' — balanced ✓';
  const bd = document.getElementById('cal-breakdown');
  bd.innerHTML = parts.join(' · ') + (parts.length?' · ':'') + `= <strong>${Math.round(mk)} kcal</strong>` + status;
  bd.className = 'cal-breakdown ' + (isOver ? 'over' : 'ok');
}

function renderGoalsPage() {
  sv('g-cal', goals.calories); sv('g-protein', goals.protein);
  sv('g-carbs', goals.carbs); sv('g-fat', goals.fat);
  updateGoalPreview();
}

async function saveGoals() {
  goals = { calories: gv('g-cal'), protein: gv('g-protein'), carbs: gv('g-carbs'), fat: gv('g-fat') };
  await saveGoalsRemote();
  renderToday();
  showToast('Goals saved');
  showPage('today', document.getElementById('tab-today'));
}
