// ── Layout: Topbar, Sidebar, Notif Panel ─────────────────────────
// SITES registry – single source of truth
const SITES = [
  { id: 'framesphere',  name: 'Frame-Sphere',  url: 'https://frame-sphere.vercel.app',   icon: 'layers',       color: '#a855f7', tabs: ['support','blog','daten'] },
  { id: 'frametrain',   name: 'FrameTrain',     url: 'https://frame-train.vercel.app',    icon: 'train-front',  color: '#f59e0b', tabs: ['support','changelog','daten'] },
  { id: 'wordify',      name: 'Wordify',         url: 'https://wordify.pages.dev',         icon: 'pen-line',     color: '#22c55e', tabs: ['wortanfragen','daten'] },
  { id: 'flaggues',     name: 'Flaggues',        url: 'https://flaggues.pages.dev',        icon: 'flag',         color: '#ef4444', tabs: ['daten'] },
  { id: 'spinselector', name: 'SpinSelector',    url: 'https://spinselector.pages.dev',    icon: 'shuffle',      color: '#06b6d4', tabs: ['vorschläge','daten'] },
  { id: 'brawlmystery', name: 'BrawlMystery',    url: 'https://brawlmystery.pages.dev',    icon: 'swords',       color: '#f97316', tabs: ['changelog','blog','daten'] },
  { id: 'traitora',     name: 'Traitora',        url: 'https://traitora.pages.dev',        icon: 'brain',        color: '#8b5cf6', tabs: ['daten'] },
  { id: 'fileflyr',     name: 'FileFlyr',        url: 'https://fileflyr.pages.dev',        icon: 'folder-open',  color: '#3b82f6', tabs: ['support','daten'] },
  { id: 'ratelimit',    name: 'Ratelimit API',   url: 'https://ratelimit-api.pages.dev',   icon: 'zap',          color: '#10b981', tabs: ['analytics','support','changelog','errors','notifications','daten'] },
  { id: 'framespell',   name: 'FrameSpell',      url: 'https://framespell.pages.dev',      icon: 'sparkles',     color: '#6366f1', tabs: ['support','changelog','blog','errors','daten'] },
];

// Returns an <i data-lucide> element for a site's icon
function siteIcon(site, size = 15) {
  return `<i data-lucide="${site.icon}" style="width:${size}px;height:${size}px;display:inline-flex;flex-shrink:0;color:${site.color}"></i>`;
}

function getSiteById(id) {
  return SITES.find(s => s.id === id) || null;
}

// Resolve relative path prefix depending on current page location
function pathPrefix() {
  return window.location.pathname.includes('/sites/') ? '../' : '';
}

function siteHref(siteId) {
  return `${pathPrefix()}sites/${siteId}.html`;
}

// ── Inject Login Screen ───────────────────────────────────────────
function injectLoginScreen() {
  const el = document.createElement('div');
  el.id = 'login-screen';
  el.innerHTML = `
    <div class="login-box" id="login-box">
      <div class="login-logo">
        <div class="login-logo-dot"></div>
        <div class="login-title">WEBCONTROL HQ</div>
      </div>
      <div class="login-sub">Passwort eingeben um fortzufahren</div>
      <div class="login-input-wrap">
        <input
          class="login-input"
          id="login-pw"
          type="password"
          placeholder="••••••••••••"
          autocomplete="current-password"
          autofocus
        >
        <button class="login-eye" id="login-eye-btn" onclick="togglePwVis()" title="Anzeigen">
          <i data-lucide="eye" style="width:15px;height:15px"></i>
        </button>
      </div>
      <div class="login-error" id="login-error"></div>
      <button class="btn btn-primary login-btn" id="login-submit-btn"
        onclick="doLogin(() => initAfterLogin())">Einloggen</button>
      <div class="login-hint">Token gilt 55 Minuten · wird automatisch erneuert</div>
    </div>
  `;
  document.body.prepend(el);
  refreshIcons();

  // Allow Enter key
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('login-screen')?.style.display !== 'none') {
      doLogin(() => initAfterLogin());
    }
  });
}

// ── Inject Topbar ─────────────────────────────────────────────────
function injectTopbar(activeSiteId = null) {
  const el = document.createElement('div');
  el.id = 'topbar';
  el.innerHTML = `
    <a class="logo" href="${pathPrefix()}index.html">
      <div class="logo-dot"></div>
      WEBCONTROL HQ
    </a>
    <div class="topbar-spacer"></div>
    <div class="topbar-stat">
      <i data-lucide="ticket" style="width:12px;height:12px"></i>
      TICKETS <span class="num" id="stat-tickets">–</span>
    </div>
    <div class="topbar-stat">
      <i data-lucide="x-circle" style="width:12px;height:12px"></i>
      ERRORS <span class="num" id="stat-errors" style="color:var(--red)">–</span>
    </div>
    <div class="topbar-stat">
      <i data-lucide="globe" style="width:12px;height:12px"></i>
      SITES <span class="num" style="color:var(--green)">10</span>
    </div>
    <div class="topbar-icon-btn" id="notif-btn" onclick="toggleNotif()" title="Benachrichtigungen">
      <i data-lucide="bell" style="width:16px;height:16px"></i>
      <span class="notif-badge" id="notif-count" style="display:none">0</span>
    </div>
    <div class="topbar-icon-btn danger" onclick="doLogout()" title="Ausloggen">
      <i data-lucide="log-out" style="width:16px;height:16px"></i>
    </div>
  `;
  document.body.prepend(el);
  refreshIcons();
}

// ── Inject Sidebar ────────────────────────────────────────────────
function injectSidebar(activeSiteId = null) {
  const nav = SITES.map(s => `
    <a class="nav-item${s.id === activeSiteId ? ' active' : ''}" href="${siteHref(s.id)}">
      <span class="icon">${siteIcon(s, 14)}</span>
      <span>${s.name}</span>
      <span class="site-color" style="background:${s.color}"></span>
    </a>
  `).join('');

  const el = document.createElement('nav');
  el.id = 'sidebar';
  el.innerHTML = `
    <div class="sidebar-section">
      <div class="sidebar-label">Übersicht</div>
      <a class="nav-item${!activeSiteId && !window.location.pathname.includes('todo') ? ' active' : ''}" href="${pathPrefix()}index.html">
        <span class="icon"><i data-lucide="layout-dashboard" style="width:14px;height:14px"></i></span>
        Dashboard
      </a>
      <a class="nav-item${window.location.pathname.includes('todo') ? ' active' : ''}" href="${pathPrefix()}todo.html">
        <span class="icon"><i data-lucide="check-square-2" style="width:14px;height:14px"></i></span>
        To Do
      </a>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">Webseiten</div>
      ${nav}
    </div>
  `;
  document.getElementById('layout').prepend(el);
  refreshIcons();
}

// ── Inject Notif Panel ────────────────────────────────────────────
function injectNotifPanel() {
  const el = document.createElement('div');
  el.id = 'notif-panel';
  el.innerHTML = `
    <div class="notif-panel-head">
      <h3 style="display:flex;align-items:center;gap:7px">
        <i data-lucide="bell" style="width:14px;height:14px"></i>
        Benachrichtigungen
      </h3>
      <button class="btn btn-ghost btn-sm" onclick="markAllRead()">Alle gelesen</button>
    </div>
    <div class="notif-list" id="notif-list">
      <div class="loading">Lade…</div>
    </div>
  `;
  document.body.appendChild(el);
  refreshIcons();
}

// ── Topbar Stats ──────────────────────────────────────────────────
async function loadTopbarStats() {
  const stats = await api('/api/stats');
  if (!stats) return;
  const openTickets      = stats.tickets?.find(t => t.status === 'open')?.c || 0;
  const unresolvedErrors = stats.errors?.find(e => e.resolved === 0)?.c    || 0;
  const unreadNotifs     = stats.notifs?.find(n => n.read === 0)?.c        || 0;
  document.getElementById('stat-tickets').textContent = openTickets;
  document.getElementById('stat-errors').textContent  = unresolvedErrors;
  const badge = document.getElementById('notif-count');
  if (unreadNotifs > 0) { badge.textContent = unreadNotifs; badge.style.display = 'flex'; }
  else                  { badge.style.display = 'none'; }
}

// ── Notif Panel Logic ─────────────────────────────────────────────
let notifOpen = false;

function toggleNotif() {
  notifOpen = !notifOpen;
  document.getElementById('notif-panel').classList.toggle('open', notifOpen);
  if (notifOpen) loadNotifPanel();
}

async function loadNotifPanel() {
  const list = document.getElementById('notif-list');
  const data = await api('/api/notifications?limit=40');
  if (!data) { list.innerHTML = errState(); refreshIcons(); return; }
  if (!data.length) {
    list.innerHTML = `<div class="empty">${icon('party-popper', 28, 'color:var(--text3);margin-bottom:8px')}<span>Keine Benachrichtigungen</span></div>`;
    refreshIcons();
    return;
  }
  list.innerHTML = data.map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}" onclick="markOneRead(${n.id}, this)">
      <div class="notif-item-head">
        <div class="notif-type-dot ${n.type}"></div>
        <div class="notif-title">${esc(n.title)}</div>
        <div class="notif-site">${getSiteById(n.site_id)?.name || n.site_id}</div>
      </div>
      ${n.message ? `<div class="notif-msg">${esc(n.message).slice(0, 80)}</div>` : ''}
      <div class="notif-time">${fmtDate(n.created_at)}</div>
    </div>
  `).join('');
}

async function markOneRead(id, el) {
  await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
  el.classList.remove('unread');
  loadTopbarStats();
}

async function markAllRead() {
  await api('/api/notifications/read-all', { method: 'POST', body: {} });
  loadNotifPanel();
  loadTopbarStats();
}

// ── Full layout init (called once auth is confirmed) ──────────────
function initLayout(activeSiteId = null) {
  // Inject Lucide CDN once
  if (!document.getElementById('lucide-cdn')) {
    const s = document.createElement('script');
    s.id  = 'lucide-cdn';
    s.src = 'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js';
    s.onload = () => lucide.createIcons();
    document.head.appendChild(s);
  }
  injectTopbar(activeSiteId);
  const layoutEl = document.getElementById('layout');
  if (layoutEl) injectSidebar(activeSiteId);
  injectNotifPanel();
  loadTopbarStats();
  setInterval(loadTopbarStats, 30000);
}
