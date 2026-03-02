// ── Tab Components ────────────────────────────────────────────────
// Each function receives a siteId and a DOM panel element,
// fetches data and renders HTML into the panel.

// ── SUPPORT ───────────────────────────────────────────────────────
async function renderSupport(siteId, panel) {
  const tickets = await api(`/api/support?site_id=${siteId}`);
  if (!tickets) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="form-card">
      <div class="form-card-title">Neues Ticket</div>
      <div class="form-row">
        <div class="form-group"><label>Name</label>
          <input id="s-name" placeholder="Max Mustermann"></div>
        <div class="form-group"><label>E-Mail</label>
          <input id="s-email" type="email" placeholder="max@example.com"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Betreff</label>
          <input id="s-subject" placeholder="Problem beschreiben…"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Nachricht</label>
          <textarea id="s-msg" placeholder="Details…"></textarea></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Priorität</label>
          <select id="s-prio">
            <option value="low">Low</option>
            <option value="normal" selected>Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select></div>
      </div>
      <button class="btn btn-primary" onclick="submitSupport('${siteId}')">Ticket erstellen</button>
    </div>
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">Tickets (${tickets.length})</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','support')">↻ Aktualisieren</button>
    </div>
    ${tickets.length ? supportTable(tickets, siteId) : emptyState('Keine Tickets vorhanden')}
  `;
}

function supportTable(tickets, siteId) {
  return `<table class="data-table">
    <thead><tr><th>#</th><th>Betreff</th><th>Von</th><th>Status</th><th>Priorität</th><th>Datum</th><th>Aktion</th></tr></thead>
    <tbody>${tickets.map(t => `
      <tr>
        <td class="mono">${t.id}</td>
        <td style="max-width:200px">
          <div style="font-weight:600">${esc(t.subject)}</div>
          <div class="mono" style="color:var(--text3)">${esc(t.message || '').slice(0, 60)}…</div>
        </td>
        <td>
          <div style="font-size:12px">${esc(t.name || '–')}</div>
          <div class="mono" style="color:var(--text3)">${esc(t.email || '')}</div>
        </td>
        <td><span class="badge ${t.status}">${t.status}</span></td>
        <td><span class="badge ${t.priority === 'urgent' ? 'urgent' : t.priority === 'high' ? 'in_progress' : 'draft'}">${t.priority}</span></td>
        <td class="mono" style="color:var(--text3)">${fmtDate(t.created_at)}</td>
        <td>
          <select onchange="updateTicket(${t.id},'status',this.value,'${siteId}')"
                  style="padding:4px 8px;font-size:11px;width:auto">
            ${['open','in_progress','resolved','closed'].map(s =>
              `<option value="${s}"${t.status === s ? ' selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

async function submitSupport(siteId) {
  const data = {
    site_id: siteId,
    name:     document.getElementById('s-name')?.value,
    email:    document.getElementById('s-email')?.value,
    subject:  document.getElementById('s-subject')?.value,
    message:  document.getElementById('s-msg')?.value,
    priority: document.getElementById('s-prio')?.value,
  };
  if (!data.subject || !data.message) { alert('Betreff und Nachricht sind erforderlich'); return; }
  await api('/api/support', { method: 'POST', body: data });
  reloadPanel(siteId, 'support');
}

async function updateTicket(id, field, value, siteId) {
  await api(`/api/support/${id}`, { method: 'PATCH', body: { [field]: value } });
  reloadPanel(siteId, 'support');
}

// ── CHANGELOG ─────────────────────────────────────────────────────
async function renderChangelog(siteId, panel) {
  const entries = await api(`/api/changelog?site_id=${siteId}`);
  if (!entries) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="form-card">
      <div class="form-card-title">Neuer Eintrag</div>
      <div class="form-row">
        <div class="form-group"><label>Version</label>
          <input id="cl-ver" placeholder="v1.2.0"></div>
        <div class="form-group"><label>Typ</label>
          <select id="cl-type">
            <option value="feature">✨ Feature</option>
            <option value="fix">🐛 Fix</option>
            <option value="improvement">⚡ Improvement</option>
            <option value="breaking">💥 Breaking</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Titel</label>
          <input id="cl-title" placeholder="Was wurde geändert?"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Beschreibung</label>
          <textarea id="cl-desc" placeholder="Details…"></textarea></div>
      </div>
      <div class="flex gap-8" style="align-items:center">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text2)">
          <input type="checkbox" id="cl-pub"> Direkt veröffentlichen
        </label>
        <button class="btn btn-primary" onclick="submitChangelog('${siteId}')">Erstellen</button>
      </div>
    </div>
    <div class="mt-16">
      ${entries.length ? changelogList(entries, siteId) : emptyState('Keine Einträge')}
    </div>
  `;
}

function changelogList(entries, siteId) {
  const typeIcon = { feature: '✨', fix: '🐛', improvement: '⚡', breaking: '💥' };
  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${entries.map(e => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:18px;flex-shrink:0">${typeIcon[e.type] || '📋'}</span>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="mono" style="color:var(--accent2)">${esc(e.version)}</span>
            <span style="font-weight:700;font-size:13px">${esc(e.title)}</span>
            <span class="badge ${e.published ? 'published' : 'draft'}">${e.published ? 'Veröffentlicht' : 'Draft'}</span>
          </div>
          ${e.description ? `<div style="font-size:12px;color:var(--text2);margin-top:4px">${esc(e.description)}</div>` : ''}
          <div class="mono" style="color:var(--text3);margin-top:4px">${fmtDate(e.created_at)}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteChangelog(${e.id},'${siteId}')">✕</button>
      </div>
    `).join('')}
  </div>`;
}

async function submitChangelog(siteId) {
  const data = {
    site_id:     siteId,
    version:     document.getElementById('cl-ver')?.value,
    title:       document.getElementById('cl-title')?.value,
    description: document.getElementById('cl-desc')?.value,
    type:        document.getElementById('cl-type')?.value,
    published:   document.getElementById('cl-pub')?.checked,
  };
  if (!data.version || !data.title) { alert('Version und Titel sind erforderlich'); return; }
  await api('/api/changelog', { method: 'POST', body: data });
  reloadPanel(siteId, 'changelog');
}

async function deleteChangelog(id, siteId) {
  if (!confirm('Eintrag löschen?')) return;
  await api(`/api/changelog/${id}`, { method: 'DELETE' });
  reloadPanel(siteId, 'changelog');
}

// ── BLOG ──────────────────────────────────────────────────────────
async function renderBlog(siteId, panel) {
  const posts = await api(`/api/blog?site_id=${siteId}`);
  if (!posts) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="form-card">
      <div class="form-card-title">Neuer Blogpost</div>
      <div class="form-row">
        <div class="form-group form-full"><label>Titel</label>
          <input id="bl-title" placeholder="Post Titel"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Auszug</label>
          <input id="bl-excerpt" placeholder="Kurze Beschreibung…"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Inhalt (Markdown)</label>
          <textarea id="bl-content" style="min-height:120px" placeholder="## Überschrift\n\nInhalt hier…"></textarea></div>
      </div>
      <div class="flex gap-8">
        <select id="bl-status" style="width:auto">
          <option value="draft">Draft</option>
          <option value="published">Veröffentlichen</option>
        </select>
        <button class="btn btn-primary" onclick="submitBlog('${siteId}')">Erstellen</button>
      </div>
    </div>
    <div class="mt-16">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Posts (${posts.length})</div>
      ${posts.length ? blogTable(posts) : emptyState('Keine Posts')}
    </div>
  `;
}

function blogTable(posts) {
  return `<table class="data-table">
    <thead><tr><th>Titel</th><th>Slug</th><th>Status</th><th>Erstellt</th></tr></thead>
    <tbody>${posts.map(p => `
      <tr>
        <td style="font-weight:600">${esc(p.title)}</td>
        <td class="mono" style="color:var(--text3)">${esc(p.slug)}</td>
        <td><span class="badge ${p.status}">${p.status}</span></td>
        <td class="mono" style="color:var(--text3)">${fmtDate(p.created_at)}</td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

async function submitBlog(siteId) {
  const data = {
    site_id: siteId,
    title:   document.getElementById('bl-title')?.value,
    excerpt: document.getElementById('bl-excerpt')?.value,
    content: document.getElementById('bl-content')?.value,
    status:  document.getElementById('bl-status')?.value,
  };
  if (!data.title) { alert('Titel ist erforderlich'); return; }
  await api('/api/blog', { method: 'POST', body: data });
  reloadPanel(siteId, 'blog');
}

// ── WORT-ANFRAGEN ─────────────────────────────────────────────────
async function renderWordRequests(siteId, panel) {
  const words = await api('/api/words');
  if (!words) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="form-card">
      <div class="form-card-title">Wort hinzufügen</div>
      <div class="form-row">
        <div class="form-group"><label>Wort</label>
          <input id="wr-word" placeholder="Wort…"></div>
        <div class="form-group"><label>Sprache</label>
          <select id="wr-lang">
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
            <option value="fr">Französisch</option>
          </select></div>
      </div>
      <button class="btn btn-primary" onclick="submitWord('${siteId}')">Hinzufügen</button>
    </div>
    <div class="actions-bar mt-16">
      <div style="font-size:13px;font-weight:700">Anfragen (${words.length})</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','wortanfragen')">↻ Aktualisieren</button>
    </div>
    ${words.length ? wordTable(words, siteId) : emptyState('Keine Anfragen')}
  `;
}

function wordTable(words, siteId) {
  return `<table class="data-table">
    <thead><tr><th>Wort</th><th>Sprache</th><th>Status</th><th>Datum</th><th>Aktionen</th></tr></thead>
    <tbody>${words.map(w => `
      <tr>
        <td style="font-weight:700;font-family:'Space Mono',monospace">${esc(w.word)}</td>
        <td class="mono">${esc(w.language)}</td>
        <td><span class="badge ${w.status}">${w.status}</span></td>
        <td class="mono" style="color:var(--text3)">${fmtDate(w.created_at)}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-sm" onclick="updateWord(${w.id},'approved','${siteId}')">✓ Annehmen</button>
            <button class="btn btn-danger btn-sm" onclick="updateWord(${w.id},'rejected','${siteId}')">✕ Ablehnen</button>
          </div>
        </td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

async function submitWord(siteId) {
  const data = {
    word:     document.getElementById('wr-word')?.value,
    language: document.getElementById('wr-lang')?.value,
  };
  if (!data.word) { alert('Wort ist erforderlich'); return; }
  await api('/api/words', { method: 'POST', body: data });
  reloadPanel(siteId, 'wortanfragen');
}

async function updateWord(id, status, siteId) {
  await api(`/api/words/${id}`, { method: 'PATCH', body: { status } });
  reloadPanel(siteId, 'wortanfragen');
}

// ── VORSCHLÄGE ────────────────────────────────────────────────────
async function renderSuggestions(siteId, panel) {
  const suggs = await api('/api/suggestions');
  if (!suggs) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">Vorschläge (${suggs.length})</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','vorschläge')">↻ Aktualisieren</button>
    </div>
    ${suggs.length ? suggTable(suggs, siteId) : emptyState('Keine Vorschläge')}
  `;
}

function suggTable(suggs, siteId) {
  return `<table class="data-table">
    <thead><tr><th>Vorschlag</th><th>Kategorie</th><th>Votes</th><th>Status</th><th>Datum</th><th>Aktionen</th></tr></thead>
    <tbody>${suggs.map(s => `
      <tr>
        <td style="font-weight:600;max-width:200px">${esc(s.suggestion)}</td>
        <td class="mono" style="color:var(--text3)">${esc(s.category || '–')}</td>
        <td style="color:var(--accent2);font-weight:700;font-family:'Space Mono',monospace">↑${s.upvotes}</td>
        <td><span class="badge ${s.status}">${s.status}</span></td>
        <td class="mono" style="color:var(--text3)">${fmtDate(s.created_at)}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-sm" onclick="updateSugg(${s.id},'done','${siteId}')">✓ Done</button>
            <button class="btn btn-danger btn-sm" onclick="updateSugg(${s.id},'rejected','${siteId}')">✕</button>
          </div>
        </td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

async function updateSugg(id, status, siteId) {
  await api(`/api/suggestions/${id}`, { method: 'PATCH', body: { status } });
  reloadPanel(siteId, 'vorschläge');
}

// ── ANALYTICS ─────────────────────────────────────────────────────
async function renderAnalytics(siteId, panel) {
  const data = await api(`/api/analytics?site_id=${siteId}&days=7`);
  if (!data) { panel.innerHTML = errState(); return; }
  const { by_type, by_day } = data;
  const maxViews = Math.max(...by_day.map(d => d.views), 1);

  panel.innerHTML = `
    <div class="analytics-grid">
      <div class="chart-card" style="grid-column:1/-1">
        <div class="chart-title">Pageviews – letzte 7 Tage</div>
        <div class="bar-chart">
          ${by_day.length
            ? by_day.map(d => `
                <div class="bar-col">
                  <div class="bar-fill" style="height:${Math.round((d.views / maxViews) * 70) + 10}px"></div>
                  <div class="bar-label">${d.day.slice(5)}</div>
                </div>`).join('')
            : '<div style="color:var(--text3);font-size:12px;font-family:Space Mono">Noch keine Daten</div>'
          }
        </div>
      </div>
      ${by_type.map(t => `
        <div class="chart-card">
          <div class="chart-title">${t.event_type}</div>
          <div style="font-size:32px;font-weight:800;color:var(--accent2)">${t.count}</div>
        </div>`).join('')}
    </div>
    <div class="mt-16 form-card">
      <div class="form-card-title">Tracking-Snippet</div>
      <pre style="font-family:'Space Mono',monospace;font-size:11px;color:var(--text2);overflow-x:auto;white-space:pre-wrap">fetch('${API_URL}/api/analytics', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    site_id: '${siteId}',
    event_type: 'pageview',
    path: window.location.pathname
  })
});</pre>
    </div>
  `;
}

// ── DATEN ─────────────────────────────────────────────────────────
async function renderDaten(siteId, panel) {
  const [tickets, errors, notifs] = await Promise.all([
    api(`/api/support?site_id=${siteId}`),
    api(`/api/errors?site_id=${siteId}`),
    api(`/api/notifications?site_id=${siteId}&limit=10`),
  ]);
  const site = getSiteById(siteId);
  panel.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Tickets gesamt</div>
        <div class="stat-val blue">${tickets?.length || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Offen</div>
        <div class="stat-val yellow">${tickets?.filter(t => t.status === 'open').length || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Fehler ungelöst</div>
        <div class="stat-val red">${errors?.filter(e => !e.resolved).length || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Notifs ungelesen</div>
        <div class="stat-val">${notifs?.filter(n => !n.read).length || 0}</div></div>
    </div>
    <div class="form-card">
      <div class="form-card-title">Site Info</div>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:var(--text3);font-size:11px;font-family:'Space Mono',monospace;width:130px">ID</td>
            <td class="mono">${siteId}</td></tr>
        <tr><td style="padding:8px 0;color:var(--text3);font-size:11px;font-family:'Space Mono',monospace">URL</td>
            <td><a href="${site?.url}" target="_blank" style="color:var(--accent2)">${site?.url}</a></td></tr>
        <tr><td style="padding:8px 0;color:var(--text3);font-size:11px;font-family:'Space Mono',monospace">Features</td>
            <td>${(site?.tabs || []).map(t => `<span class="chip neutral">${t}</span>`).join(' ')}</td></tr>
      </table>
    </div>
    <div class="form-card">
      <div class="form-card-title">Benachrichtigung senden</div>
      <div class="form-row">
        <div class="form-group"><label>Typ</label>
          <select id="nd-type">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="success">Success</option>
          </select></div>
        <div class="form-group"><label>Titel</label>
          <input id="nd-title" placeholder="Titel…"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Nachricht</label>
          <input id="nd-msg" placeholder="Nachricht…"></div>
      </div>
      <button class="btn btn-primary" onclick="sendNotif('${siteId}')">Senden</button>
    </div>
  `;
}

async function sendNotif(siteId) {
  const data = {
    site_id: siteId,
    type:    document.getElementById('nd-type')?.value,
    title:   document.getElementById('nd-title')?.value,
    message: document.getElementById('nd-msg')?.value,
  };
  if (!data.title) { alert('Titel ist erforderlich'); return; }
  await api('/api/notifications', { method: 'POST', body: data });
  reloadPanel(siteId, 'notifications');
  loadTopbarStats();
}

// ── ERRORS ────────────────────────────────────────────────────────
async function renderErrors(siteId, panel) {
  const errors = await api(`/api/errors?site_id=${siteId}`);
  if (!errors) { panel.innerHTML = errState(); return; }
  const unresolved = errors.filter(e => !e.resolved);
  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">
        Fehler – <span style="color:var(--red)">${unresolved.length} ungelöst</span>
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','errors')">↻ Aktualisieren</button>
    </div>
    ${errors.length
      ? `<table class="data-table">
          <thead><tr><th>Typ</th><th>Nachricht</th><th>Pfad</th><th>Status</th><th>Datum</th><th>Aktion</th></tr></thead>
          <tbody>${errors.map(e => `
            <tr>
              <td class="mono" style="color:var(--red)">${esc(e.error_type)}</td>
              <td style="max-width:200px;font-size:12px">${esc(e.message)}</td>
              <td class="mono" style="color:var(--text3)">${esc(e.path || '–')}</td>
              <td><span class="badge ${e.resolved ? 'resolved' : 'open'}">${e.resolved ? 'resolved' : 'open'}</span></td>
              <td class="mono" style="color:var(--text3)">${fmtDate(e.created_at)}</td>
              <td>${!e.resolved
                ? `<button class="btn btn-ghost btn-sm" onclick="resolveError(${e.id},'${siteId}')">✓ Lösen</button>`
                : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : emptyState('Keine Fehler – alles grün ✓')}
  `;
}

async function resolveError(id, siteId) {
  await api(`/api/errors/${id}/resolve`, { method: 'PATCH' });
  reloadPanel(siteId, 'errors');
}

// ── NOTIFICATIONS (site tab) ──────────────────────────────────────
async function renderNotifications(siteId, panel) {
  const notifs = await api(`/api/notifications?site_id=${siteId}`);
  if (!notifs) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">Benachrichtigungen (${notifs.length})</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="markSiteRead('${siteId}')">Alle gelesen</button>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','notifications')">↻ Aktualisieren</button>
    </div>
    ${notifs.length
      ? `<div style="display:flex;flex-direction:column;gap:6px">
          ${notifs.map(n => `
            <div class="notif-item${n.read ? '' : ' unread'}">
              <div class="notif-item-head">
                <div class="notif-type-dot ${n.type}"></div>
                <div class="notif-title">${esc(n.title)}</div>
                <div class="notif-site">${n.read ? 'gelesen' : 'NEU'}</div>
              </div>
              ${n.message ? `<div class="notif-msg">${esc(n.message)}</div>` : ''}
              <div class="notif-time">${fmtDate(n.created_at)}</div>
            </div>`).join('')}
         </div>`
      : emptyState('Keine Benachrichtigungen')}
  `;
}

async function markSiteRead(siteId) {
  await api('/api/notifications/read-all', { method: 'POST', body: { site_id: siteId } });
  reloadPanel(siteId, 'notifications');
  loadTopbarStats();
}

// ── Tab Switcher (shared by all site pages) ───────────────────────
function showTab(siteId, tabName, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  loadTabContent(siteId, tabName);
}

let _loadedTabs = new Set();

function loadTabContent(siteId, tabName) {
  const key = `${siteId}:${tabName}`;
  const panel = document.getElementById(`tab-${tabName}`);
  if (!panel) return;
  // Already loaded and not a reload
  if (_loadedTabs.has(key) && !panel.dataset.reload) return;
  _loadedTabs.add(key);
  delete panel.dataset.reload;

  panel.innerHTML = loadingState();
  switch (tabName) {
    case 'support':       renderSupport(siteId, panel);       break;
    case 'changelog':     renderChangelog(siteId, panel);     break;
    case 'blog':          renderBlog(siteId, panel);          break;
    case 'wortanfragen':  renderWordRequests(siteId, panel);  break;
    case 'vorschläge':    renderSuggestions(siteId, panel);   break;
    case 'analytics':     renderAnalytics(siteId, panel);     break;
    case 'daten':         renderDaten(siteId, panel);         break;
    case 'errors':        renderErrors(siteId, panel);        break;
    case 'notifications': renderNotifications(siteId, panel); break;
  }
}

function reloadPanel(siteId, tabName) {
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) {
    panel.dataset.reload = '1';
    loadTabContent(siteId, tabName);
  }
}

// ── Site Page Init ────────────────────────────────────────────────
function initSitePage(siteId, firstTab) {
  injectLoginScreen();
  checkAuth(() => {
    initLayout(siteId);
    // Load first tab + background tabs
    loadTabContent(siteId, firstTab);
    loadTabContent(siteId, 'errors');
    loadTabContent(siteId, 'notifications');
  });

  // Wire login button since it's injected dynamically
  window.initAfterLogin = () => {
    initLayout(siteId);
    loadTabContent(siteId, firstTab);
    loadTabContent(siteId, 'errors');
    loadTabContent(siteId, 'notifications');
  };
}
