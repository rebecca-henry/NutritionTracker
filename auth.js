// ── SUPABASE AUTH CLIENT ─────────────────────────────────────────────────────
// persistSession + autoRefreshToken are on by default — the session is stored
// in localStorage and silently refreshed, so you stay logged in between visits.
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let appInitialized = false;

function setLoginStatus(msg, type) {
  const el = document.getElementById('login-status');
  el.textContent = msg;
  el.className = 'status-msg' + (msg ? ' visible' : '') + (type ? ' ' + type : '');
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { setLoginStatus('Enter your email and password', 'error'); return; }
  setLoginStatus('Logging in…', '');
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) { setLoginStatus(error.message, 'error'); return; }
  setLoginStatus('', '');
  document.getElementById('login-password').value = '';
}

function logout() {
  supa.auth.signOut();
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
}

// Fires immediately with whatever's in localStorage, then again on every
// sign-in, sign-out, and token refresh.
supa.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token || null;
  currentUserId = session?.user?.id || null;
  if (session) {
    showApp();
    if (!appInitialized) {
      appInitialized = true;
      // If init() throws for any reason, un-flag so the NEXT auth event
      // (e.g. a token refresh) gets a chance to retry, instead of leaving
      // Today/Goals permanently blank until a manual page refresh.
      Promise.resolve().then(init).catch(err => {
        console.error('init() failed, will retry on next auth event:', err);
        appInitialized = false;
      });
    }
  } else {
    showLoginScreen();
    appInitialized = false;
  }
});
