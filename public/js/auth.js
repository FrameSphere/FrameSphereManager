// ── Auth ──────────────────────────────────────────────────────────

let AUTH_TOKEN = localStorage.getItem('hq_token') || null;

function getToken() { return AUTH_TOKEN; }

function saveToken(t) {
  AUTH_TOKEN = t;
  localStorage.setItem('hq_token', t);
  localStorage.setItem('hq_token_ts', Date.now().toString());
}

function clearToken() {
  AUTH_TOKEN = null;
  localStorage.removeItem('hq_token');
  localStorage.removeItem('hq_token_ts');
}

function isTokenFresh() {
  const ts = parseInt(localStorage.getItem('hq_token_ts') || '0');
  return Date.now() - ts < 55 * 60 * 1000; // 55 min
}

// Called on every page load – shows login or runs callback
function checkAuth(onSuccess) {
  if (AUTH_TOKEN && isTokenFresh()) {
    document.getElementById('login-screen').style.display = 'none';
    onSuccess();
  }
  // else: login screen stays visible
}

async function doLogin(onSuccess) {
  const pw     = document.getElementById('login-pw').value;
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-submit-btn');
  const box    = document.getElementById('login-box');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Bitte Passwort eingeben'; return; }
  btn.textContent = 'Prüfe…';
  btn.disabled = true;
  try {
    const r = await fetch(API_URL + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await r.json();
    if (!r.ok || !data.token) {
      box.classList.add('login-shake');
      setTimeout(() => box.classList.remove('login-shake'), 400);
      errEl.textContent = data.error || 'Falsches Passwort';
      document.getElementById('login-pw').value = '';
      document.getElementById('login-pw').focus();
    } else {
      saveToken(data.token);
      document.getElementById('login-screen').style.display = 'none';
      onSuccess();
    }
  } catch (e) {
    errEl.textContent = 'Verbindung fehlgeschlagen';
  }
  btn.textContent = 'Einloggen';
  btn.disabled = false;
}

function togglePwVis() {
  const inp = document.getElementById('login-pw');
  const btn = document.getElementById('login-eye-btn');
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
  else                         { inp.type = 'password'; btn.textContent = '👁'; }
}

function doLogout() {
  clearToken();
  // Redirect to index regardless of current page
  const depth = window.location.pathname.includes('/sites/') ? '../' : '';
  window.location.href = depth + 'index.html';
}
