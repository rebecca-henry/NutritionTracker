// ── NAV ───────────────────────────────────────────────────────────────────────
function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if (btn) btn.classList.add('active');
  if (page === 'history') renderHistory();
  if (page === 'weight')  loadWeights().then(renderWeight);
  if (page === 'goals')   renderGoalsPage();
  if (page === 'dishes')  { showDishListView(); renderDishList(); }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ── INIT ──────────────────────────────────────────────────────────────────────
// Called by auth.js once a logged-in session is confirmed (not on script load,
// since we don't want to touch Supabase before we know who's logged in).
async function init() {
  await loadWeights();
  await loadGoals();
  await loadTodayLogs();
}
