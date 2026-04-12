// ── Layout: Topbar, Sidebar, Notif Panel ─────────────────────────
// SITES registry – single source of truth
const SITES = [
  { id: 'framesphere',  name: 'Frame-Sphere',  url: 'https://frame-sphere.vercel.app',   icon: 'layers',       color: '#a855f7', tabs: ['support','blog','daten'] },
  { id: 'frametrain',   name: 'FrameTrain',     url: 'https://frame-train.vercel.app',    icon: 'train-front',  color: '#f59e0b', tabs: ['support','changelog','errors','notifications','daten'] },
  { id: 'wordify',      name: 'Wordify',         url: 'https://wordify.pages.dev',         icon: 'pen-line',     color: '#22c55e', tabs: ['wortanfragen','daten'] },
  { id: 'flaggues',     name: 'Flaggues',        url: 'https://flaggues.pages.dev',        icon: 'flag',         color: '#ef4444', tabs: ['daten'] },
  { id: 'spinselector', name: 'SpinSelector',    url: 'https://spinselector.pages.dev',    icon: 'shuffle',      color: '#06b6d4', tabs: ['vorschläge','daten'] },
  { id: 'brawlmystery', name: 'BrawlMystery',    url: 'https://brawlmystery.pages.dev',    icon: 'swords',       color: '#f97316', tabs: ['changelog','blog','daten'] },
  { id: 'traitora',     name: 'Traitora',        url: 'https://traitora.pages.dev',        icon: 'brain',        color: '#8b5cf6', tabs: ['daten'] },
  { id: 'fileflyr',     name: 'FileFlyr',        url: 'https://fileflyr.pages.dev',        icon: 'folder-open',  color: '#3b82f6', tabs: ['vorschläge','changelog','errors','notifications','daten'] },
  { id: 'ratelimit',    name: 'Ratelimit API',   url: 'https://ratelimit-api.pages.dev',   icon: 'zap',          color: '#10b981', tabs: ['analytics','support','changelog','errors','notifications','daten'] },
  { id: 'framespell',   name: 'FrameSpell',      url: 'https://framespell.pages.dev',      icon: 'sparkles',     color: '#6366f1', tabs: ['support','changelog','blog','errors','daten','hfmonitor'] },
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
  const p = window.location.pathname;
  if (p.includes('/sites/') || p.includes('/apps/')) return '../';
  return '';
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
    <div style="flex:1;overflow-y:auto;min-height:0">
    <div class="sidebar-section">
      <div class="sidebar-label">Übersicht</div>
      <a class="nav-item${!activeSiteId && !window.location.pathname.includes('todo') && !window.location.pathname.includes('infrastructure') && !window.location.pathname.includes('analytics') && !window.location.pathname.includes('db') && !window.location.pathname.includes('pinboard') && !window.location.pathname.includes('vault') && !window.location.pathname.includes('search-radar') && !window.location.pathname.includes('revenue') && !window.location.pathname.includes('apps') ? ' active' : ''}" href="${pathPrefix()}index.html">
        <span class="icon"><i data-lucide="layout-dashboard" style="width:14px;height:14px"></i></span>
        Dashboard
      </a>
      <a class="nav-item${window.location.pathname.includes('todo') ? ' active' : ''}" href="${pathPrefix()}todo.html">
        <span class="icon"><i data-lucide="check-square-2" style="width:14px;height:14px"></i></span>
        To Do
      </a>
      <a class="nav-item${window.location.pathname.includes('infrastructure') ? ' active' : ''}" href="${pathPrefix()}infrastructure.html">
        <span class="icon"><i data-lucide="network" style="width:14px;height:14px"></i></span>
        Infrastruktur
      </a>
      <a class="nav-item${window.location.pathname.includes('analytics') ? ' active' : ''}" href="${pathPrefix()}analytics.html">
        <span class="icon"><i data-lucide="bar-chart-2" style="width:14px;height:14px"></i></span>
        Analytics
      </a>
      <a class="nav-item${window.location.pathname.includes('db') ? ' active' : ''}" href="${pathPrefix()}db.html">
        <span class="icon"><i data-lucide="database" style="width:14px;height:14px"></i></span>
        Data Explorer
      </a>
      <a class="nav-item${window.location.pathname.includes('pinboard') ? ' active' : ''}" href="${pathPrefix()}pinboard.html">
        <span class="icon"><i data-lucide="layout-grid" style="width:14px;height:14px"></i></span>
        Pin Board
      </a>
      <a class="nav-item${window.location.pathname.includes('vault') ? ' active' : ''}" href="${pathPrefix()}vault.html">
        <span class="icon"><i data-lucide="shield" style="width:14px;height:14px;color:var(--yellow)"></i></span>
        Vault
      </a>
      <a class="nav-item${window.location.pathname.includes('search-radar') ? ' active' : ''}" href="${pathPrefix()}search-radar.html">
        <span class="icon"><i data-lucide="search" style="width:14px;height:14px;color:#34d399"></i></span>
        Search Radar
      </a>
      <a class="nav-item${window.location.pathname.includes('revenue') ? ' active' : ''}" href="${pathPrefix()}revenue.html">
        <span class="icon"><i data-lucide="circle-dollar-sign" style="width:14px;height:14px;color:#22c55e"></i></span>
        Revenue
      </a>
      <a class="nav-item${window.location.pathname.includes('blog-verwaltung') ? ' active' : ''}" href="${pathPrefix()}blog-verwaltung.html">
        <span class="icon"><i data-lucide="book-open" style="width:14px;height:14px;color:#f59e0b"></i></span>
        Blog Verwaltung
      </a>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">Webseiten</div>
      ${nav}
    </div>
    <div class="sidebar-section">
      <div class="sidebar-label">Apps</div>
      <a class="nav-item${window.location.pathname.includes('stride') ? ' active' : ''}" href="${pathPrefix()}apps/stride.html">
        <span class="icon"><i data-lucide="activity" style="width:14px;height:14px;color:#6366f1"></i></span>
        Stride
        <span class="site-color" style="background:#6366f1"></span>
      </a>
    </div>
    </div>
    <div style="padding:10px 12px 14px;border-top:1px solid var(--border);flex-shrink:0">
      <button class="nav-item" onclick="openSettings()" style="width:100%;cursor:pointer;border:none;background:none;text-align:left;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;color:var(--text2);font-size:12px;font-weight:600;transition:background .12s;font-family:inherit">
        <span class="icon"><i data-lucide="settings" style="width:14px;height:14px"></i></span>
        Einstellungen
      </button>
    </div>
  `;
  document.getElementById('layout').prepend(el);
  refreshIcons();
}

// ── Settings Modal ─────────────────────────────────────────────
function injectSettingsModal() {
  const el = document.createElement('div');
  el.id = 'settings-overlay';
  el.style.cssText = 'display:none;position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);align-items:center;justify-content:center';
  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:0;width:min(560px,96vw);max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0">
        <div style="display:flex;align-items:center;gap:10px">
          <i data-lucide="settings" style="width:18px;height:18px;color:var(--accent2)"></i>
          <span style="font-size:15px;font-weight:800">Einstellungen</span>
        </div>
        <button onclick="closeSettings()" style="width:28px;height:28px;border-radius:6px;border:none;background:none;cursor:pointer;font-size:16px;color:var(--text3);display:flex;align-items:center;justify-content:center;transition:background .12s" onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background='none'">✕</button>
      </div>
      <!-- Tabs -->
      <div style="display:flex;gap:2px;padding:14px 24px 0;border-bottom:1px solid var(--border)">
        <button class="settings-tab active" id="stab-connections" onclick="switchSettingsTab('connections')" style="padding:8px 16px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:none;background:none;border-bottom:2px solid var(--accent2);color:var(--accent2);cursor:pointer;font-family:inherit;margin-bottom:-1px">
          <i data-lucide="plug" style="width:11px;height:11px"></i> Verbindungen
        </button>
      </div>
      <!-- Tab content -->
      <div style="overflow-y:auto;padding:24px">
        <!-- Connections Tab -->
        <div id="stab-connections-panel">
          <div style="font-size:12px;color:var(--text3);margin-bottom:20px;line-height:1.6">
            Trage hier einmalig deine Google OAuth Client-IDs ein. Die Seiten verbinden sich danach automatisch beim Öffnen.
          </div>

          <!-- Search Console -->
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
              <i data-lucide="search" style="width:15px;height:15px;color:#34d399"></i>
              <span style="font-size:13px;font-weight:700">Google Search Console</span>
              <span id="sc-status-badge" style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:4px;display:none"></span>
            </div>
            <label style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">OAuth Client-ID</label>
            <input id="settings-gsc-id" type="text"
              placeholder="12345678.apps.googleusercontent.com"
              style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-family:'Space Mono',monospace;font-size:11px;padding:9px 12px;outline:none;transition:border-color .15s"
              onfocus="this.style.borderColor='#34d399'" onblur="this.style.borderColor='var(--border)'">
            <div style="font-size:10px;color:var(--text3);margin-top:7px;font-family:'Space Mono',monospace">
              Wird für <a href="search-radar.html" style="color:#34d399">Search Radar</a> verwendet.
            </div>
          </div>

          <!-- AdSense -->
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:20px">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
              <i data-lucide="circle-dollar-sign" style="width:15px;height:15px;color:#22c55e"></i>
              <span style="font-size:13px;font-weight:700">Google AdSense</span>
              <span id="ads-status-badge" style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:4px;display:none"></span>
            </div>
            <label style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);display:block;margin-bottom:6px">OAuth Client-ID</label>
            <input id="settings-ads-id" type="text"
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              style="width:100%;box-sizing:border-box;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text1);font-family:'Space Mono',monospace;font-size:11px;padding:9px 12px;outline:none;transition:border-color .15s"
              onfocus="this.style.borderColor='#22c55e'" onblur="this.style.borderColor='var(--border)'">
            <div style="font-size:10px;color:var(--text3);margin-top:7px;font-family:'Space Mono',monospace">
              Wird für <a href="revenue.html" style="color:#22c55e">Revenue</a> verwendet.
            </div>
          </div>

          <!-- Save button -->
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button onclick="closeSettings()" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text2);cursor:pointer;font-size:12px;font-family:inherit">Abbrechen</button>
            <button onclick="saveSettings()" style="padding:8px 18px;border-radius:8px;border:none;background:var(--accent2);color:#fff;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;display:flex;align-items:center;gap:6px">
              <i data-lucide="save" style="width:12px;height:12px"></i> Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeSettings(); });
  refreshIcons();
}

function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  // Populate current values
  const gscId = localStorage.getItem('sr_gsc_client_id') || '';
  const adsId = localStorage.getItem('rv_adsense_client_id') || '';
  document.getElementById('settings-gsc-id').value = gscId;
  document.getElementById('settings-ads-id').value = adsId;
  // Show status badges
  const scBadge  = document.getElementById('sc-status-badge');
  const adsBadge = document.getElementById('ads-status-badge');
  if (gscId) {
    scBadge.textContent = '✓ Gespeichert';
    scBadge.style.cssText = 'font-size:9px;font-weight:800;padding:2px 8px;border-radius:4px;background:rgba(52,211,153,.15);color:#34d399;border:1px solid rgba(52,211,153,.3)';
    scBadge.style.display = 'inline-flex';
  } else { scBadge.style.display = 'none'; }
  if (adsId) {
    adsBadge.textContent = '✓ Gespeichert';
    adsBadge.style.cssText = 'font-size:9px;font-weight:800;padding:2px 8px;border-radius:4px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3)';
    adsBadge.style.display = 'inline-flex';
  } else { adsBadge.style.display = 'none'; }
  overlay.style.display = 'flex';
  refreshIcons();
}

function closeSettings() {
  document.getElementById('settings-overlay').style.display = 'none';
}

function saveSettings() {
  const gscId = document.getElementById('settings-gsc-id').value.trim();
  const adsId = document.getElementById('settings-ads-id').value.trim();
  if (gscId) localStorage.setItem('sr_gsc_client_id', gscId);
  else localStorage.removeItem('sr_gsc_client_id');
  if (adsId) localStorage.setItem('rv_adsense_client_id', adsId);
  else localStorage.removeItem('rv_adsense_client_id');
  closeSettings();
  // Show a quick success toast if possible
  const btn = document.querySelector('#settings-overlay button[onclick="saveSettings()"]');
  // Re-open to show updated badges
  openSettings();
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => {
    t.classList.remove('active');
    t.style.borderBottomColor = 'transparent';
    t.style.color = 'var(--text3)';
  });
  const active = document.getElementById('stab-' + tab);
  if (active) { active.classList.add('active'); active.style.borderBottomColor = 'var(--accent2)'; active.style.color = 'var(--accent2)'; }
  document.querySelectorAll('[id^="stab-"][id$="-panel"]').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('stab-' + tab + '-panel');
  if (panel) panel.style.display = '';
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
  refreshIcons();
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
  injectSettingsModal();
  loadTopbarStats();
  setInterval(loadTopbarStats, 30000);
}
