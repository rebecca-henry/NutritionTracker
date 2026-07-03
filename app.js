// ── NAV ───────────────────────────────────────────────────────────────────────
function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if (btn) btn.classList.add('active');
  if (page === 'history') renderHistory();
  if (page === 'weight')  renderWeight();
  if (page === 'goals')   renderGoalsPage();
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
async function init() {
  loadWeights();
  await loadGoals();
  await loadTodayLogs();
}
init();
