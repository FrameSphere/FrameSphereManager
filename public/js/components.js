// ── Tab Components ────────────────────────────────────────────────
// Each function receives a siteId and a DOM panel element,
// fetches data and renders HTML into the panel.

// ── SUPPORT (Postfach + Chat) ──────────────────────────────────────
async function renderSupport(siteId, panel) {
  const tickets = await api(`/api/support?site_id=${siteId}`);
  if (!tickets) { panel.innerHTML = errState(); return; }

  const byStatus = (s) => tickets.filter(t => t.status === s).length;
  const newCount = tickets.filter(t => t.status === 'open').length;

  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">
        📥 Posteingang
        ${newCount > 0 ? `<span class="nav-badge" style="margin-left:8px">${newCount} neu</span>` : ''}
        <span style="color:var(--text3);font-weight:400;margin-left:8px">(${tickets.length} gesamt)</span>
      </div>
      <div class="flex-1"></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="support-filter" onchange="filterSupportList()" style="padding:4px 10px;font-size:11px;width:auto">
          <option value="">Alle (${tickets.length})</option>
          <option value="open">Offen (${byStatus('open')})</option>
          <option value="in_progress">In Bearbeitung (${byStatus('in_progress')})</option>
          <option value="resolved">Gelöst (${byStatus('resolved')})</option>
          <option value="closed">Geschlossen (${byStatus('closed')})</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','support')">&#8635; Aktualisieren</button>
      </div>
    </div>

    <div style="display:flex;gap:0;height:620px;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:12px">
      <!-- Ticket sidebar -->
      <div id="ticket-sidebar" style="width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);background:var(--surface)">
        ${tickets.length === 0
          ? `<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:13px">📭<br><br>Keine Tickets</div>`
          : tickets.map(t => `
          <div class="ticket-item" id="ti-${t.id}" data-status="${t.status}" onclick="openTicket(${t.id},'${siteId}')"
               style="padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
              <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${
                t.status === 'open' ? 'rgba(96,165,250,0.2)' :
                t.status === 'in_progress' ? 'rgba(251,191,36,0.2)' :
                t.status === 'resolved' ? 'rgba(52,211,153,0.2)' : 'rgba(156,163,175,0.15)'
              };color:${
                t.status === 'open' ? '#60a5fa' :
                t.status === 'in_progress' ? '#fbbf24' :
                t.status === 'resolved' ? '#34d399' : '#9ca3af'
              }">${{open:'Offen',in_progress:'Bearbeitung',resolved:'Gelöst',closed:'Geschlossen'}[t.status] || t.status}</span>
              <span class="mono" style="color:var(--text3);font-size:10px;margin-left:auto">#${t.id}</span>
              ${t.status === 'open' ? '<span style="width:6px;height:6px;border-radius:50%;background:#60a5fa;flex-shrink:0"></span>' : ''}
            </div>
            <div style="font-weight:700;font-size:12px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.subject)}</div>
            <div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name || t.email || 'Anonym')}</div>
            <div class="mono" style="font-size:10px;color:var(--text3);margin-top:2px">${fmtDate(t.created_at)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Chat area -->
      <div id="ticket-chat" style="flex:1;display:flex;flex-direction:column;background:var(--bg);min-width:0">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text3)">
          <div style="text-align:center">
            <div style="font-size:36px;margin-bottom:10px">📬</div>
            <div style="font-size:13px">Ticket auswählen um die Konversation zu sehen</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function openTicket(ticketId, siteId) {
  // Highlight selected
  document.querySelectorAll('.ticket-item').forEach(el => el.style.background = '');
  const ti = document.getElementById(`ti-${ticketId}`);
  if (ti) ti.style.background = 'rgba(255,255,255,0.06)';

  const chat = document.getElementById('ticket-chat');
  chat.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Lädt…</div>`;

  const [allTickets, messages] = await Promise.all([
    api(`/api/support?site_id=${siteId}`),
    api(`/api/support/${ticketId}/messages`),
  ]);
  const ticket = allTickets?.find(t => t.id === ticketId);

  if (!ticket || !messages) { chat.innerHTML = errState(); return; }

  const statusLabels = { open:'Offen', in_progress:'In Bearbeitung', resolved:'Gelöst', closed:'Geschlossen' };

  chat.innerHTML = `
    <!-- Chat header -->
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px;flex-shrink:0;background:var(--surface)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;margin-bottom:2px">${esc(ticket.subject)}</div>
        <div style="font-size:11px;color:var(--text3);display:flex;flex-wrap:wrap;gap:8px">
          <span>👤 ${esc(ticket.name || 'Anonym')}${ticket.email ? ` &lt;${esc(ticket.email)}&gt;` : ''}</span>
          <span>· User-ID: <span class="mono">${esc(ticket.user_id || '–')}</span></span>
          <span>· ${fmtDate(ticket.created_at)}</span>
        </div>
      </div>
      <select onchange="updateTicketStatus(${ticketId},'${siteId}',this.value)"
              style="padding:5px 10px;font-size:11px;width:auto;flex-shrink:0;border-radius:6px">
        ${Object.entries(statusLabels).map(([v,l]) =>
          `<option value="${v}"${ticket.status === v ? ' selected' : ''}>${l}</option>`
        ).join('')}
      </select>
    </div>

    <!-- Messages -->
    <div id="chat-msgs-${ticketId}" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">
      ${messages.length ? messages.map(m => chatBubble(m)).join('') : `<div style="text-align:center;color:var(--text3);font-size:12px;padding:20px">Keine Nachrichten</div>`}
    </div>

    <!-- Reply box -->
    <div style="padding:12px 16px;border-top:1px solid var(--border);flex-shrink:0;background:var(--surface)">
      <div style="display:flex;gap:8px">
        <textarea id="reply-input-${ticketId}" placeholder="Antwort schreiben… (Strg+Enter zum Senden)" rows="2"
          style="flex:1;resize:none;padding:8px 12px;font-size:12px;border-radius:8px;background:var(--bg);border:1px solid var(--border);color:var(--text1);outline:none"
          onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){sendAdminReply(${ticketId},'${siteId}')}"
        ></textarea>
        <button class="btn btn-primary" style="align-self:flex-end;padding:8px 16px" onclick="sendAdminReply(${ticketId},'${siteId}')">
          ➤ Senden
        </button>
      </div>
    </div>
  `;

  const msgs = document.getElementById(`chat-msgs-${ticketId}`);
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function chatBubble(m) {
  const isAdmin = m.sender === 'admin';
  return `
    <div style="display:flex;flex-direction:column;align-items:${isAdmin ? 'flex-end' : 'flex-start'}">
      <div style="
        max-width:78%;padding:8px 13px;
        border-radius:${isAdmin ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
        background:${isAdmin ? 'var(--accent, #7c3aed)' : 'var(--surface)'};
        color:${isAdmin ? '#fff' : 'var(--text1)'};
        font-size:12px;line-height:1.55;
        border:1px solid ${isAdmin ? 'transparent' : 'var(--border)'};
        word-break:break-word;
      ">${esc(m.message).replace(/\n/g,'<br>')}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px;padding:0 4px">
        ${isAdmin ? '🔧 Du' : '👤 User'} · ${fmtDate(m.created_at)}
      </div>
    </div>
  `;
}

async function sendAdminReply(ticketId, siteId) {
  const input = document.getElementById(`reply-input-${ticketId}`);
  const message = input?.value?.trim();
  if (!message) return;
  const btn = input.closest('div').querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  input.value = '';

  const res = await api(`/api/support/${ticketId}/messages`, { method: 'POST', body: { message } });

  if (btn) { btn.disabled = false; btn.innerHTML = '➤ Senden'; }
  if (res?.success) {
    const msgs = document.getElementById(`chat-msgs-${ticketId}`);
    if (msgs) {
      const div = document.createElement('div');
      div.innerHTML = chatBubble({ sender: 'admin', message, created_at: new Date().toISOString() });
      msgs.appendChild(div.firstElementChild);
      msgs.scrollTop = msgs.scrollHeight;
    }
    // Update status badge in sidebar to in_progress if was open
    const ti = document.getElementById(`ti-${ticketId}`);
    if (ti && ti.dataset.status === 'open') {
      ti.dataset.status = 'in_progress';
      const statusSpan = ti.querySelector('span');
      if (statusSpan) { statusSpan.textContent = 'Bearbeitung'; statusSpan.style.color = '#fbbf24'; }
    }
  }
}

async function updateTicketStatus(ticketId, siteId, status) {
  await api(`/api/support/${ticketId}`, { method: 'PATCH', body: { status } });
  const ti = document.getElementById(`ti-${ticketId}`);
  if (ti) {
    ti.dataset.status = status;
    const span = ti.querySelector('span[style*="font-size:9px"]');
    const labels = {open:'Offen',in_progress:'Bearbeitung',resolved:'Gelöst',closed:'Geschlossen'};
    if (span) span.textContent = labels[status] || status;
  }
}

function filterSupportList() {
  const val = document.getElementById('support-filter')?.value;
  document.querySelectorAll('.ticket-item').forEach(el => {
    el.style.display = (!val || el.dataset.status === val) ? '' : 'none';
  });
}

async function updateTicket(id, field, value, siteId) {
  await api(`/api/support/${id}`, { method: 'PATCH', body: { [field]: value } });
  reloadPanel(siteId, 'support');
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
  const suggs = await api(`/api/suggestions?site_id=${siteId}`);
  if (!suggs) { panel.innerHTML = errState(); return; }
  const unread = suggs.filter(s => !s.read).length;
  // Silently mark all as read
  suggs.filter(s => !s.read).forEach(s => {
    api(`/api/suggestions/${s.id}`, { method: 'PATCH', body: { read: true } });
  });
  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">
        💡 Vorschläge (${suggs.length})
        ${unread > 0 ? `<span class="nav-badge" style="margin-left:8px">${unread} neu</span>` : ''}
      </div>
      <div class="flex-1"></div>
      <select id="sugg-filter" onchange="filterSuggList()" style="padding:4px 10px;font-size:11px;width:auto">
        <option value="">Alle (${suggs.length})</option>
        <option value="open">Offen (${suggs.filter(s=>s.status==='open').length})</option>
        <option value="done">Done (${suggs.filter(s=>s.status==='done').length})</option>
        <option value="rejected">Abgelehnt (${suggs.filter(s=>s.status==='rejected').length})</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','vorschläge')">↻ Aktualisieren</button>
    </div>
    ${suggs.length ? suggTable(suggs, siteId) : emptyState('Noch keine Vorschläge – der Button auf der Seite wartet auf Input!')}
  `;
}

function filterSuggList() {
  const val = document.getElementById('sugg-filter')?.value;
  document.querySelectorAll('.sugg-row').forEach(el => {
    el.style.display = (!val || el.dataset.status === val) ? '' : 'none';
  });
}

function suggTable(suggs, siteId) {
  return `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
    ${suggs.map(s => `
      <div class="sugg-row" data-status="${s.status}" style="
        background:var(--surface);
        border:1px solid ${!s.read && s.status==='open' ? 'rgba(96,165,250,0.35)' : 'var(--border)'};
        border-radius:10px;padding:14px 16px;
        ${!s.read && s.status==='open' ? 'box-shadow:0 0 0 1px rgba(96,165,250,0.1);' : ''}
      ">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              ${!s.read ? '<span class="badge open" style="font-size:9px">NEU</span>' : ''}
              ${s.category ? `<span class="mono" style="font-size:10px;color:var(--text3);background:rgba(255,255,255,.06);padding:2px 7px;border-radius:4px">${esc(s.category)}</span>` : ''}
              <span class="badge ${s.status}" style="font-size:9px">${s.status}</span>
              <span class="mono" style="color:var(--text3);font-size:10px;margin-left:auto">${fmtDate(s.created_at)}</span>
            </div>
            <div style="font-size:13px;font-weight:600;line-height:1.5;word-break:break-word">${esc(s.suggestion)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${s.status !== 'done' ? `<button class="btn btn-ghost btn-sm" onclick="updateSugg(${s.id},'done','${siteId}')">✓ Umgesetzt</button>` : ''}
            ${s.status !== 'rejected' ? `<button class="btn btn-danger btn-sm" onclick="updateSugg(${s.id},'rejected','${siteId}')">✕</button>` : ''}
            ${s.status === 'done' || s.status === 'rejected' ? `<button class="btn btn-ghost btn-sm" onclick="updateSugg(${s.id},'open','${siteId}')">↺</button>` : ''}
          </div>
        </div>
      </div>
    `).join('')}
  </div>`;
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

// ── HF MONITOR (FrameSpell) ──────────────────────────────────────────────
async function renderHfMonitor(siteId, panel) {
  const HF_URL = 'https://framespherehf-mt5-rechtschreibkorrektur.hf.space';
  const logs = await api('/api/hf-ping-log?limit=100');
  if (!logs) { panel.innerHTML = errState(); return; }

  // Stats
  const now = Date.now();
  const h24 = logs.filter(l => now - new Date(l.created_at).getTime() < 86400000);
  const lastLog = logs[0] || null;
  const okCount  = h24.filter(l => l.status === 'ok').length;
  const errCount = h24.filter(l => l.status === 'error').length;
  const msArr    = h24.filter(l => l.response_ms != null);
  const avgMs    = msArr.length ? Math.round(msArr.reduce((a,b) => a + b.response_ms, 0) / msArr.length) : null;

  const statusColor = !lastLog ? '#9ca3af'
    : lastLog.status === 'ok' ? '#34d399' : '#f87171';
  const statusLabel = !lastLog ? 'Unbekannt'
    : lastLog.status === 'ok'
      ? (lastLog.model_loaded ? 'Online • Modell geladen' : 'Online • Modell lädt')
      : 'Offline / Fehler';
  const statusDot = !lastLog ? '⚪' : lastLog.status === 'ok' ? '🟢' : '🔴';

  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">🤖 HuggingFace Space Monitor</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" id="hf-manual-ping-btn" onclick="hfManualPing('${siteId}')"
        style="display:flex;align-items:center;gap:5px">
        ${icon('zap', 12)} Jetzt pingen
      </button>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','hfmonitor')">&#8635; Aktualisieren</button>
    </div>

    <!-- Status-Karten -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Status</div>
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:18px">${statusDot}</span>
          <span style="font-size:12px;font-weight:700;color:${statusColor}">${statusLabel}</span>
        </div>
        ${lastLog ? `<div class="mono" style="font-size:10px;color:var(--text3);margin-top:5px">Letzter Ping: ${fmtDate(lastLog.created_at)}</div>` : '<div style="font-size:11px;color:var(--text3);margin-top:5px">Noch kein Ping</div>'}
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Antwortzeit</div>
        <div style="font-size:22px;font-weight:800;color:var(--text1)">
          ${lastLog?.response_ms != null ? `${lastLog.response_ms}<span style="font-size:12px;font-weight:400;color:var(--text3)"> ms</span>` : '–'}
        </div>
        ${avgMs != null ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">⌀ ${avgMs}ms (24h)</div>` : ''}
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Pings (24h)</div>
        <div style="font-size:22px;font-weight:800;color:var(--text1)">${h24.length}</div>
        <div style="font-size:11px;margin-top:3px">
          <span style="color:#34d399">${okCount} ok</span>
          &bull; <span style="color:#f87171">${errCount} fehler</span>
        </div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Space</div>
        <a href="${HF_URL}" target="_blank"
           style="font-size:10px;color:#6366f1;word-break:break-all;font-family:'Space Mono',monospace;line-height:1.4">${HF_URL}</a>
        <div style="font-size:10px;color:var(--text3);margin-top:5px">Keepalive alle 23h (Cron)</div>
      </div>
    </div>

    <!-- Ping-Verlauf -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <div style="font-size:12px;font-weight:700;flex:1">${icon('list', 13)} Ping-Verlauf
          <span style="color:var(--text3);font-weight:400;margin-left:6px">(letzte ${logs.length})</span>
        </div>
        <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(52,211,153,.15);color:#34d399;font-weight:700">ok</span>
        <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(248,113,113,.15);color:#f87171;font-weight:700">fehler</span>
        <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(251,191,36,.15);color:#fbbf24;font-weight:700">manual</span>
        <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(99,102,241,.15);color:#a5b4fc;font-weight:700">cron</span>
      </div>
      <div style="max-height:420px;overflow-y:auto">
        ${logs.length === 0
          ? `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px">
              ${icon('clock', 22, 'color:var(--text3);margin-bottom:8px')}<br><br>
              Noch keine Pings aufgezeichnet.<br>
              <span style="font-size:11px">Klicke "Jetzt pingen" oder warte auf den nächsten Cron-Aufruf.</span>
             </div>`
          : `<table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:var(--bg)">
                  <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);white-space:nowrap">Zeit</th>
                  <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">Status</th>
                  <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">HTTP</th>
                  <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">ms</th>
                  <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">Modell</th>
                  <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">Auslöser</th>
                  <th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)">Fehler</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map(l => `
                  <tr style="border-top:1px solid var(--border);transition:background .1s"
                      onmouseover="this.style.background='rgba(255,255,255,.03)'"
                      onmouseout="this.style.background=''">
                    <td class="mono" style="padding:8px 14px;color:var(--text3);white-space:nowrap;font-size:11px">${fmtDate(l.created_at)}</td>
                    <td style="padding:8px 10px;text-align:center">
                      <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;
                        background:${l.status === 'ok' ? 'rgba(52,211,153,.15)' : 'rgba(248,113,113,.15)'};
                        color:${l.status === 'ok' ? '#34d399' : '#f87171'}">
                        ${l.status === 'ok' ? 'OK' : 'ERR'}
                      </span>
                    </td>
                    <td class="mono" style="padding:8px 10px;text-align:right;color:${l.http_code === 200 ? '#34d399' : '#f87171'}">${l.http_code ?? '–'}</td>
                    <td class="mono" style="padding:8px 10px;text-align:right;color:var(--text2)">${l.response_ms != null ? l.response_ms : '–'}</td>
                    <td style="padding:8px 10px;text-align:center;font-size:14px">${l.model_loaded ? '✅' : '⏳'}</td>
                    <td style="padding:8px 14px">
                      <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;
                        background:${l.triggered_by === 'manual' ? 'rgba(251,191,36,.15)' : 'rgba(99,102,241,.15)'};
                        color:${l.triggered_by === 'manual' ? '#fbbf24' : '#a5b4fc'}">
                        ${l.triggered_by === 'manual' ? 'manual' : 'cron'}
                      </span>
                    </td>
                    <td style="padding:8px 14px;color:#f87171;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.error || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>`
        }
      </div>
    </div>
  `;
  refreshIcons();
}

window.hfManualPing = async function(siteId) {
  const btn = document.getElementById('hf-manual-ping-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = icon('loader', 12) + ' Pinge…'; }
  const result = await api('/api/hf-ping', { method: 'POST', body: {} });
  if (btn) { btn.disabled = false; btn.innerHTML = icon('zap', 12) + ' Jetzt pingen'; }
  if (result) {
    const ok = result.status === 'ok';
    const msg = ok
      ? `✅ Online — ${result.response_ms}ms${result.model_loaded ? ' • Modell geladen' : ' • Modell lädt noch'}`
      : `❌ Fehler — ${result.error || 'unbekannt'}`;
    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed;bottom:24px;right:24px;z-index:9999',
      'padding:10px 18px;border-radius:9px;font-size:12px;font-weight:700',
      `background:${ok ? 'rgba(52,211,153,.15)' : 'rgba(248,113,113,.15)'}`,
      `border:1px solid ${ok ? 'rgba(52,211,153,.4)' : 'rgba(248,113,113,.4)'}`,
      `color:${ok ? '#34d399' : '#f87171'}`,
      'box-shadow:0 8px 24px rgba(0,0,0,.3)',
    ].join(';');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
    setTimeout(() => reloadPanel(siteId, 'hfmonitor'), 800);
  }
};

// ── WORT DES TAGES (Dashboard) ───────────────────────────────
const LANGS = [
  { code: 'de', label: 'Deutsch 🇩🇪' },
  { code: 'en', label: 'English 🇬🇧' },
  { code: 'es', label: 'Español 🇪🇸' },
  { code: 'fr', label: 'Français 🇫🇷' },
  { code: 'it', label: 'Italiano 🇮🇹' },
];

async function renderWortDesTages(siteId, panel) {
  const entries = await api('/api/daily-words');
  if (!entries) { panel.innerHTML = errState(); return; }

  const byDate = {};
  entries.forEach(e => {
    byDate[e.date] = byDate[e.date] || {};
    byDate[e.date][e.language] = { word: e.word, id: e.id };
  });
  const dates = Object.keys(byDate).sort().reverse().slice(0, 60);

  panel.innerHTML = `
    <div class="form-card">
      <div class="form-card-title">📅 Wort des Tages eintragen</div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:16px">
        Du kannst mehrere Sprachen gleichzeitig für ein Datum setzen. Das Wort wird automatisch in Großbuchstaben gespeichert.
      </p>
      <div class="form-row">
        <div class="form-group"><label>Datum</label>
          <input type="date" id="wdt-date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group"><label>Sprache</label>
          <select id="wdt-lang">
            ${LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Wort (5 Buchstaben)</label>
          <input id="wdt-word" placeholder="HALLO" maxlength="5"
            oninput="this.value=this.value.toUpperCase()"
            style="font-family:'Space Mono',monospace;font-size:18px;letter-spacing:0.15em"></div>
      </div>
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveWdt()">Eintragen</button>
        <button class="btn btn-ghost btn-sm" onclick="bulkWdtOpen()">+ Mehrere auf einmal</button>
      </div>
    </div>

    <div id="wdt-bulk-box" style="display:none" class="form-card mt-16">
      <div class="form-card-title">Mehrere Einträge (eine Zeile pro Eintrag)</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px;font-family:'Space Mono',monospace">
        Format: JJJJ-MM-TT SPRACHE WORT &nbsp;→&nbsp; z.B. 2026-03-05 de HALLO
      </div>
      <textarea id="wdt-bulk-text" style="min-height:120px;font-family:'Space Mono',monospace;font-size:12px"
        placeholder="2026-03-05 de HALLO\n2026-03-05 en HELLO\n2026-03-06 de SUPER"></textarea>
      <div class="flex gap-8 mt-8">
        <button class="btn btn-primary" onclick="saveBulkWdt()">Alle speichern</button>
        <button class="btn btn-ghost" onclick="document.getElementById('wdt-bulk-box').style.display='none'">Abbrechen</button>
      </div>
    </div>

    <div class="mt-16">
      <div class="actions-bar">
        <div style="font-size:13px;font-weight:700">Eingestellte Wörter (${entries.length})</div>
        <div class="flex-1"></div>
        <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','wortdestages')">&#8635; Aktualisieren</button>
      </div>
      ${dates.length ? wdtTable(byDate, dates, siteId) : emptyState('Noch keine Wörter eingetragen')}
    </div>
  `;
}

function wdtTable(byDate, dates, siteId) {
  return `
    <div style="overflow-x:auto">
    <table class="data-table">
      <thead><tr>
        <th>Datum</th>
        ${LANGS.map(l => `<th>${l.label}</th>`).join('')}
        <th>Aktionen</th>
      </tr></thead>
      <tbody>
        ${dates.map(date => `
          <tr>
            <td class="mono" style="color:var(--accent2);font-weight:700">${date}</td>
            ${LANGS.map(l => {
              const e = byDate[date][l.code];
              return `<td>${e
                ? `<span style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:0.1em">${esc(e.word)}</span>`
                : `<span style="color:var(--text3)">–</span>`
              }</td>`;
            }).join('')}
            <td>
              <button class="btn btn-danger btn-sm" onclick="deleteWdtDate('${date}',${JSON.stringify(Object.values(byDate[date]).map(e=>e.id)).replace(/"/g,"'")})">× Löschen</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function bulkWdtOpen() {
  const box = document.getElementById('wdt-bulk-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function saveWdt() {
  const date = document.getElementById('wdt-date').value;
  const lang = document.getElementById('wdt-lang').value;
  const word = document.getElementById('wdt-word').value.trim().toUpperCase();
  if (!date) { alert('Datum fehlt'); return; }
  if (word.length !== 5) { alert('Wort muss genau 5 Buchstaben haben'); return; }
  await api('/api/daily-words', { method: 'POST', body: { date, language: lang, word } });
  document.getElementById('wdt-word').value = '';
  reloadPanel('wordify', 'wortdestages');
}

async function saveBulkWdt() {
  const lines = document.getElementById('wdt-bulk-text').value.trim().split('\n');
  const rows = lines.map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\s+/);
    return { date: parts[0], language: parts[1], word: (parts[2] || '').toUpperCase() };
  }).filter(r => r.date && r.language && r.word.length === 5);
  if (!rows.length) { alert('Keine gültigen Einträge gefunden'); return; }
  for (const r of rows) {
    await api('/api/daily-words', { method: 'POST', body: r });
  }
  document.getElementById('wdt-bulk-text').value = '';
  document.getElementById('wdt-bulk-box').style.display = 'none';
  reloadPanel('wordify', 'wortdestages');
}

async function deleteWdtDate(date, ids) {
  if (!confirm(`Alle Wörter für ${date} löschen?`)) return;
  for (const id of ids) {
    await api(`/api/daily-words/${id}`, { method: 'DELETE' });
  }
  reloadPanel('wordify', 'wortdestages');
}

// ── KONTAKT NACHRICHTEN (Dashboard) ───────────────────────────
async function renderKontakt(siteId, panel) {
  const msgs = await api(`/api/contact?site_id=${siteId}`);
  if (!msgs) { panel.innerHTML = errState(); return; }
  const unread = msgs.filter(m => !m.read).length;

  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">
        Nachrichten (${msgs.length})
        ${unread > 0 ? `<span class="nav-badge" style="margin-left:8px">${unread} neu</span>` : ''}
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','kontakt')">&#8635; Aktualisieren</button>
    </div>
    ${msgs.length ? kontaktTable(msgs, siteId) : emptyState('Keine Nachrichten')}
  `;
}

function kontaktTable(msgs, siteId) {
  const langFlag = { de: '\ud83c\udde9\ud83c\uddea', en: '\ud83c\uddec\ud83c\udde7', es: '\ud83c\uddea\ud83c\uddf8', fr: '\ud83c\uddeb\ud83c\uddf7', it: '\ud83c\uddee\ud83c\uddf9' };
  const siteLabel = { wordify: '\ud83d\udcdd Wordify', flaggues: '\ud83d\udea9 FlagGuess' };
  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${msgs.map(m => `
      <div style="background:var(--surface);border:1px solid ${m.read ? 'var(--border)' : 'rgba(96,165,250,0.3)'};border-radius:10px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:18px">${langFlag[m.language] || '\ud83c\udf10'}</span>
          <span style="font-weight:700;font-size:13px">${esc(m.name || 'Anonym')}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.07);color:var(--text3)">${siteLabel[m.site_id] || m.site_id || '–'}</span>
          ${!m.read ? '<span class="badge open" style="font-size:9px">NEU</span>' : ''}
          <span class="mono" style="color:var(--text3);margin-left:auto">${fmtDate(m.created_at)}</span>
        </div>
        <div style="font-size:13px;color:var(--text2);line-height:1.5;white-space:pre-wrap">${esc(m.message)}</div>
        ${!m.read ? `
          <div style="margin-top:10px">
            <button class="btn btn-ghost btn-sm" onclick="markContactRead(${m.id},'${siteId}',this)">\u2713 Als gelesen markieren</button>
          </div>` : ''}
      </div>`).join('')}
  </div>`;
}

async function markContactRead(id, siteId, btn) {
  await api(`/api/contact/${id}/read`, { method: 'PATCH' });
  reloadPanel(siteId, 'kontakt');
  loadTopbarStats();
}

// ── RATELIMIT ANALYTICS ────────────────────────────────────────────────
async function renderRatelimitAnalytics(siteId, panel) {
  const range = panel.dataset.range || '24h';
  const data = await api(`/api/ratelimit-stats?range=${range}`);
  if (!data) { panel.innerHTML = errState(); return; }

  const { summary, all_time, hourly, daily, top_endpoints, top_ips } = data;
  const total    = summary?.total_requests    || 0;
  const blocked  = summary?.blocked_requests  || 0;
  const allowed  = total - blocked;
  const uniqueIps = summary?.unique_ips       || 0;
  const blockRate = total > 0 ? ((blocked / total) * 100).toFixed(1) : '0.0';

  // Chart data: hourly or daily depending on range
  const chartData = range === '24h' ? hourly : daily;
  const maxVal = Math.max(...chartData.map(d => d.requests || d.total || 0), 1);

  const rangeLabel = { '24h': 'Letzte 24 Stunden', '7d': 'Letzte 7 Tage', '30d': 'Letzte 30 Tage' };

  panel.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <div style="font-size:13px;font-weight:800;flex:1">⚡ RateLimit API – Anfragen-Statistiken</div>
      <div style="display:flex;gap:4px">
        ${['24h','7d','30d'].map(r => `
          <button onclick="setRlRange('${r}', this)" style="
            padding:5px 12px;font-size:11px;font-weight:700;border-radius:6px;cursor:pointer;
            border:1px solid ${r === range ? 'var(--accent2)' : 'var(--border)'};
            background:${r === range ? 'rgba(99,102,241,.15)' : 'var(--surface)'};
            color:${r === range ? 'var(--accent2)' : 'var(--text2)'};
            font-family:inherit"
          >${r}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','analytics')">&#8635;</button>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="stats-row" style="margin-bottom:16px">
      <div class="stat-card">
        <div class="stat-label">Anfragen gesamt</div>
        <div class="stat-val" style="color:var(--accent2)">${total.toLocaleString('de-DE')}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${rangeLabel[range]}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Durchgelassen</div>
        <div class="stat-val green">${allowed.toLocaleString('de-DE')}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${total > 0 ? (100 - parseFloat(blockRate)).toFixed(1) : '0.0'}% der Anfragen</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Blockiert</div>
        <div class="stat-val red">${blocked.toLocaleString('de-DE')}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${blockRate}% Block-Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unique IPs</div>
        <div class="stat-val yellow">${uniqueIps.toLocaleString('de-DE')}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${rangeLabel[range]}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Gesamt (all-time)</div>
        <div class="stat-val">${(all_time?.total || 0).toLocaleString('de-DE')}</div>
        <div style="font-size:10px;color:var(--red);margin-top:2px">${(all_time?.blocked || 0).toLocaleString('de-DE')} blockiert</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-card-title">Anfragen-Verlauf – ${rangeLabel[range]}</div>
      ${chartData.length ? `
        <div style="display:flex;align-items:flex-end;gap:2px;height:90px;margin-top:12px;overflow-x:auto;padding-bottom:4px">
          ${chartData.map(d => {
            const total_d = d.requests || d.total || 0;
            const blocked_d = d.blocked || 0;
            const h = Math.max(Math.round((total_d / maxVal) * 80), 2);
            const bh = Math.max(Math.round((blocked_d / Math.max(total_d,1)) * h), total_d > 0 && blocked_d > 0 ? 2 : 0);
            const label = (d.hour || d.day || '').slice(5, 13).replace('T',' ');
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;flex:1;min-width:12px" title="${esc(d.hour || d.day || '')}\nGesamt: ${total_d}\nBlockiert: ${blocked_d}">
              <div style="width:100%;display:flex;flex-direction:column;justify-content:flex-end;height:80px">
                <div style="width:100%;background:#10b981;border-radius:2px 2px 0 0;height:${h - bh}px"></div>
                ${bh > 0 ? `<div style="width:100%;background:#ef4444;height:${bh}px"></div>` : ''}
              </div>
              <div style="font-size:8px;color:var(--text3);white-space:nowrap;overflow:hidden;max-width:40px">${label}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:16px;margin-top:8px">
          <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)">
            <span style="width:10px;height:10px;border-radius:2px;background:#10b981"></span> Durchgelassen
          </span>
          <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)">
            <span style="width:10px;height:10px;border-radius:2px;background:#ef4444"></span> Blockiert
          </span>
        </div>` : '<div style="color:var(--text3);font-size:12px;padding:20px 0;text-align:center">Noch keine Daten im Zeitraum</div>'}
    </div>

    <!-- Top Endpoints + Top IPs -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <!-- Top Endpoints -->
      <div class="form-card">
        <div class="form-card-title">Top Endpoints</div>
        ${top_endpoints.length ? `
          <table class="data-table" style="margin-top:8px">
            <thead><tr><th>Endpoint</th><th style="text-align:right">Anfragen</th></tr></thead>
            <tbody>
              ${top_endpoints.map(e => `<tr>
                <td class="mono" style="font-size:11px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.endpoint || '–')}</td>
                <td style="text-align:right;font-weight:700;color:var(--accent2)">${(e.count || 0).toLocaleString('de-DE')}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine Daten</div>'}
      </div>
      <!-- Top IPs -->
      <div class="form-card">
        <div class="form-card-title">Top IPs</div>
        ${top_ips.length ? `
          <table class="data-table" style="margin-top:8px">
            <thead><tr><th>IP</th><th style="text-align:right">Anfragen</th><th style="text-align:right">Blockiert</th></tr></thead>
            <tbody>
              ${top_ips.map(ip => `<tr>
                <td class="mono" style="font-size:11px">${esc(ip.ip_address || '–')}</td>
                <td style="text-align:right;font-weight:700">${(ip.count || 0).toLocaleString('de-DE')}</td>
                <td style="text-align:right;color:${ip.blocked > 0 ? 'var(--red)' : 'var(--text3)'};font-weight:${ip.blocked > 0 ? 700 : 400}">${ip.blocked || 0}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine Daten</div>'}
      </div>
    </div>
  `;
}

window.setRlRange = function(range, btn) {
  const panel = document.getElementById('tab-analytics');
  if (!panel) return;
  panel.dataset.range = range;
  panel.dataset.reload = '1';
  // Get current siteId from page
  const siteId = document.querySelector('[data-site-id]')?.dataset.siteId || 'ratelimit';
  renderRatelimitAnalytics(siteId, panel);
};

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
  if (_loadedTabs.has(key) && !panel.dataset.reload) return;
  _loadedTabs.add(key);
  delete panel.dataset.reload;

  panel.innerHTML = loadingState();
  // Ratelimit uses its own analytics renderer
  if (siteId === 'ratelimit' && tabName === 'analytics') {
    renderRatelimitAnalytics(siteId, panel);
    return;
  }
  switch (tabName) {
    case 'support':       renderSupport(siteId, panel);       break;
    case 'changelog':     renderChangelog(siteId, panel);     break;
    case 'blog':          renderBlog(siteId, panel);          break;
    case 'wortanfragen':  renderWordRequests(siteId, panel);  break;
    case 'vorschläge':    renderSuggestions(siteId, panel);   break;
    case 'analytics':     renderAnalytics(siteId, panel);     break;
    case 'wortdestages':  renderWortDesTages(siteId, panel);  break;
    case 'kontakt':       renderKontakt(siteId, panel);       break;
    case 'daten':         renderDaten(siteId, panel);         break;
    case 'errors':        renderErrors(siteId, panel);        break;
    case 'notifications': renderNotifications(siteId, panel); break;
    case 'hfmonitor':    renderHfMonitor(siteId, panel);    break;
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
    loadTabContent(siteId, firstTab);
    loadTabContent(siteId, 'errors');
    loadTabContent(siteId, 'notifications');
    _startLivePolling(siteId);
  });

  window.initAfterLogin = () => {
    initLayout(siteId);
    loadTabContent(siteId, firstTab);
    loadTabContent(siteId, 'errors');
    loadTabContent(siteId, 'notifications');
    _startLivePolling(siteId);
  };
}

// ── Live Polling: errors & notifications refresh silently ─────────
// Runs every 45s. If the tab is currently active, a full reload runs
// (user sees fresh data). If not, we do a background fetch and update
// the nav badge count without disrupting what the user is reading.
function _startLivePolling(siteId) {
  setInterval(async () => {
    // Always reload errors + notifications data
    const errPanel  = document.getElementById('tab-errors');
    const notifPanel = document.getElementById('tab-notifications');

    // Errors: reload silently in background, update badge
    const errors = await api(`/api/errors?site_id=${siteId}`);
    if (errors) {
      const unresolved = errors.filter(e => !e.resolved).length;
      // Update sidebar badge
      const badge = document.getElementById('nav-badge-errors');
      if (badge) {
        badge.textContent = unresolved;
        badge.style.display = unresolved > 0 ? '' : 'none';
      }
      // If errors tab is active, re-render it
      if (errPanel && errPanel.classList.contains('active')) {
        errPanel.dataset.reload = '1';
        loadTabContent(siteId, 'errors');
      }
    }

    // Notifications: reload silently, update topbar badge
    const notifs = await api(`/api/notifications?site_id=${siteId}`);
    if (notifs) {
      const unread = notifs.filter(n => !n.read).length;
      // Update topbar global counter
      loadTopbarStats();
      // If notifications tab is active, re-render it
      if (notifPanel && notifPanel.classList.contains('active')) {
        notifPanel.dataset.reload = '1';
        loadTabContent(siteId, 'notifications');
      }
    }

    // Suggestions: update nav badge count
    const suggPanel = document.getElementById('tab-vorschläge');
    const newSuggs = await api(`/api/suggestions?site_id=${siteId}`);
    if (newSuggs) {
      const unreadSugg = newSuggs.filter(s => !s.read).length;
      const suggBadge = document.getElementById('nav-badge-vorschläge');
      if (suggBadge) {
        suggBadge.textContent = unreadSugg;
        suggBadge.style.display = unreadSugg > 0 ? '' : 'none';
      }
      if (suggPanel && suggPanel.classList.contains('active')) {
        suggPanel.dataset.reload = '1';
        loadTabContent(siteId, 'vorschläge');
      }
    }
  }, 45 * 1000);
}

// ── WORT DES TAGES ──────────────────────────────────────────────
async function renderWortDesTages(siteId, panel) {
  const words = await api('/api/daily-words');
  if (!words) { panel.innerHTML = errState(); return; }

  const LANGS = [
    { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
    { code: 'en', flag: '🇬🇧', label: 'English' },
    { code: 'fr', flag: '🇫🇷', label: 'Français' },
    { code: 'es', flag: '🇪🇸', label: 'Español' },
    { code: 'it', flag: '🇮🇹', label: 'Italiano' },
  ];

  // Existing words als Map: date+lang -> word
  const existing = {};
  words.forEach(w => { existing[`${w.date}|${w.language}`] = w.word; });

  // Bereits verwendete Wörter pro Sprache speichern (für Duplikat-Check)
  window._wdtUsedWords = {};
  words.forEach(w => {
    if (!window._wdtUsedWords[w.language]) window._wdtUsedWords[w.language] = new Set();
    window._wdtUsedWords[w.language].add(w.word.toUpperCase());
  });

  // Nächster freier Tag pro Sprache
  function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function nextFreeDate(lang) {
    const today = new Date(); today.setHours(12,0,0,0);
    let d = new Date(today);
    for (let i = 0; i < 365; i++) {
      const key = localDateStr(d) + '|' + lang;
      if (!existing[key]) return localDateStr(d);
      d.setDate(d.getDate() + 1);
    }
    const far = new Date(Date.now() + 366*86400000);
    return localDateStr(far);
  }

  // Gruppiere Einträge nach Datum
  const byDate = {};
  words.forEach(w => {
    if (!byDate[w.date]) byDate[w.date] = {};
    byDate[w.date][w.language] = w.word;
  });
  const sortedDates = Object.keys(byDate).sort().reverse().slice(0, 30);

  const langTabs = LANGS.map((l, i) =>
    `<button onclick="_wdtTab('${l.code}')" id="wdt-tab-${l.code}" style="
      padding:6px 14px;border-radius:8px 8px 0 0;cursor:pointer;font-family:inherit;
      border:1px solid ${i===0?'var(--border)':'transparent'};
      border-bottom:${i===0?'1px solid var(--surface)':'none'};
      background:${i===0?'var(--surface)':'transparent'};
      color:${i===0?'var(--text1)':'var(--text3)'};
      font-size:13px;font-weight:600;margin-bottom:-1px;transition:all .15s">
      ${l.flag} ${l.code.toUpperCase()}
    </button>`
  ).join('');

  const langPanels = LANGS.map((l, i) => {
    const nextDate = nextFreeDate(l.code);
    return `<div id="wdt-panel-${l.code}" style="display:${i===0?'block':'none'};
      background:var(--surface);border:1px solid var(--border);border-top:none;
      border-radius:0 8px 8px 8px;padding:16px">

      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">
          Nächster freier Tag: <span style="color:var(--text1);font-family:'Space Mono',monospace">${nextDate}</span>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:200px">
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">📋 Bulk-Import (ein Wort pro Zeile oder Komma-getrennt)</label>
          <textarea id="wdt-bulk-${l.code}" rows="6" placeholder="WORT1
WORT2
WORT3
...
or: WORT1, WORT2, WORT3"
            style="width:100%;font-family:'Space Mono',monospace;font-size:13px;text-transform:uppercase;letter-spacing:.05em"
            oninput="_wdtPreview('${l.code}')"></textarea>
        </div>
        <div style="flex:1;min-width:180px">
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">📅 Startdatum</label>
          <input type="date" id="wdt-startdate-${l.code}" value="${nextDate}"
            oninput="_wdtPreview('${l.code}')"
            style="width:100%;margin-bottom:10px">
          <div id="wdt-preview-${l.code}" style="font-size:11px;color:var(--text3);line-height:1.7;font-family:'Space Mono',monospace"></div>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" onclick="_wdtSaveBulk('${l.code}')">
          ✓ Alle speichern
        </button>
        <span id="wdt-status-${l.code}" style="font-size:12px;color:var(--text3)"></span>
      </div>
    </div>`;
  }).join('');

  // Tabelle der letzten 30 Tage
  const tableRows = sortedDates.map(date => {
    const cells = LANGS.map(l => {
      const w = byDate[date][l.code];
      return `<td style="font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:${w?'var(--text1)':'var(--text3)'}">${w || '–'}</td>`;
    }).join('');
    const today = new Date().toISOString().slice(0,10);
    const isToday = date === today;
    return `<tr style="${isToday?'background:rgba(34,197,94,.05)':''}">
      <td class="mono" style="color:${isToday?'#34d399':'var(--text3)'};font-weight:${isToday?'700':'400'}">
        ${date}${isToday?' <span style="font-size:9px;background:rgba(34,197,94,.2);color:#34d399;padding:1px 5px;border-radius:3px">HEUTE</span>':''}
      </td>
      ${cells}
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="form-card" style="margin-bottom:20px">
      <div class="form-card-title">📅 Wörter eintragen</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px">
        Pro Sprache eine Liste einfügen — jedes Wort wird automatisch dem nächsten freien Tag zugewiesen.
      </div>
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">${langTabs}</div>
      ${langPanels}
    </div>

    <div class="actions-bar" style="margin-bottom:8px">
      <div style="font-size:13px;font-weight:700">Einträge (letzte 30 Tage)</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','wortdestages')">↻ Aktualisieren</button>
    </div>

    ${sortedDates.length ? `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>Datum</th>
          ${LANGS.map(l => `<th>${l.flag} ${l.code.toUpperCase()}</th>`).join('')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>` : emptyState('Noch keine Wörter eingetragen')}
  `;

  // Validierungs-Handler patchen (ersetzt die einfachen inline handlers)
  setTimeout(() => window._wdtPatchHandlers && window._wdtPatchHandlers(siteId), 50);

  // JS-Funktionen für Tabs + Preview + Save
  window._wdtTab = function(code) {
    const langs = ['de','en','fr','es','it'];
    langs.forEach(l => {
      const p = document.getElementById('wdt-panel-' + l);
      const t = document.getElementById('wdt-tab-' + l);
      const active = l === code;
      if (p) p.style.display = active ? 'block' : 'none';
      if (t) {
        t.style.background   = active ? 'var(--surface)' : 'transparent';
        t.style.color        = active ? 'var(--text1)'   : 'var(--text3)';
        t.style.border       = active ? '1px solid var(--border)' : '1px solid transparent';
        t.style.borderBottom = active ? '1px solid var(--surface)' : 'none';
      }
    });
  };

  window._wdtPreview = function(lang) {
    const raw   = document.getElementById('wdt-bulk-' + lang)?.value || '';
    const start = document.getElementById('wdt-startdate-' + lang)?.value;
    const words = raw.split(/[\n,]+/).map(w => w.trim().toUpperCase()).filter(Boolean);
    const prev  = document.getElementById('wdt-preview-' + lang);
    if (!prev) return;
    if (!words.length || !start) { prev.textContent = ''; return; }
    const lines = [];
    let d = new Date(start + 'T00:00:00');
    words.slice(0, 14).forEach(w => {
      lines.push(d.toISOString().slice(0,10) + '  →  ' + w);
      d.setDate(d.getDate() + 1);
    });
    if (words.length > 14) lines.push('… +' + (words.length - 14) + ' weitere');
    prev.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  };

  window._wdtSaveBulk = async function(lang) {
    const raw   = document.getElementById('wdt-bulk-' + lang)?.value || '';
    const start = document.getElementById('wdt-startdate-' + lang)?.value;
    const statusEl = document.getElementById('wdt-status-' + lang);
    const words = raw.split(/[\n,]+/).map(w => w.trim().toUpperCase()).filter(Boolean);
    if (!words.length) { alert('Bitte mindestens ein Wort eingeben.'); return; }
    if (!start) { alert('Bitte Startdatum wählen.'); return; }

    statusEl.textContent = 'Speichert…'; statusEl.style.color = 'var(--text3)';

    let d = new Date(start + 'T00:00:00');
    let saved = 0;
    for (const word of words) {
      const date = d.toISOString().slice(0,10);
      await api('/api/daily-words', { method: 'POST', body: { date, language: lang, word } });
      saved++;
      statusEl.textContent = `${saved}/${words.length} gespeichert…`;
      d.setDate(d.getDate() + 1);
    }

    statusEl.textContent = `✓ ${saved} Wörter gespeichert!`;
    statusEl.style.color = '#34d399';
    document.getElementById('wdt-bulk-' + lang).value = '';
    document.getElementById('wdt-preview-' + lang).textContent = '';
    setTimeout(() => reloadPanel(siteId, 'wortdestages'), 1000);
  };
}

async function renderKontakt(siteId, panel) {
  const msgs = await api(`/api/contact?site_id=${siteId}`);
  if (!msgs) { panel.innerHTML = errState(); return; }
  panel.innerHTML = `
    <div class="actions-bar">
      <div style="font-size:13px;font-weight:700">Nachrichten (${msgs.length})</div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','kontakt')">↻ Aktualisieren</button>
    </div>
    ${msgs.length ? `<table class="data-table">
      <thead><tr><th>Name</th><th>Nachricht</th><th>Sprache</th><th>Datum</th></tr></thead>
      <tbody>${msgs.map(m => `<tr>
        <td style="font-weight:700">${esc(m.name || 'Anonym')}</td>
        <td style="max-width:300px;font-size:12px">${esc(m.message)}</td>
        <td class="mono">${esc(m.language || '–')}</td>
        <td class="mono" style="color:var(--text3)">${fmtDate(m.created_at)}</td>
      </tr>`).join('')}</tbody>
    </table>` : emptyState('Keine Nachrichten')}
  `;
}

// ── CHANGELOG (Öffentlich auf /changelog, verwaltet im HQ) ───────────────
// ── CHANGELOG ANALYTICS ──────────────────────────────────────
window._clToggleAnalytics = async function(siteId) {
  const panel = document.getElementById('cl-analytics-panel');
  const btn   = document.getElementById('cl-analytics-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  if (open) {
    panel.style.display = 'none';
    if (btn) { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }
    return;
  }
  panel.style.display = 'block';
  if (btn) { btn.style.background = 'rgba(99,102,241,.15)'; btn.style.borderColor = 'rgba(99,102,241,.4)'; btn.style.color = '#818cf8'; }
  panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Lade Analytics\u2026</div>';
  const data = await api(`/api/changelog/analytics?site_id=${siteId}&days=30`);
  if (!data) { panel.innerHTML = errState(); return; }
  panel.innerHTML = _renderChangelogAnalytics(data);
};

function _renderChangelogAnalytics(data) {
  const { byPost, scrollDist, devices, referrers, byDay, reactions } = data;
  const totalViews   = (byPost||[]).reduce((s,r) => s + Number(r.views),   0);
  const totalUniques = (byPost||[]).reduce((s,r) => s + Number(r.uniques), 0);

  function fmtTime(sec) {
    if (!sec || sec < 1) return '\u2013';
    if (sec < 60) return Math.round(sec) + 's';
    return Math.floor(sec/60) + 'm ' + Math.round(sec%60) + 's';
  }
  function sparkline(rows) {
    if (!rows||!rows.length) return '<div style="color:var(--text3);font-size:11px">Noch keine Daten</div>';
    const vals = rows.map(r => Number(r.views));
    const max  = Math.max(...vals, 1);
    return '<div style="display:flex;align-items:flex-end;gap:2px;height:44px;padding-top:4px">' +
      vals.map(v => { const h=Math.max(4,Math.round(v/max*40)); return `<div style="flex:1;height:${h}px;background:#818cf8;border-radius:2px 2px 0 0;opacity:.7;min-width:4px" title="${v}"></div>`; }).join('') +
      '</div>';
  }

  const scrollMap = {};
  (scrollDist||[]).forEach(r => { scrollMap[r.slug] = r; });

  const reactMap = {};
  (reactions||[]).forEach(r => {
    if (!reactMap[r.entry_slug]) reactMap[r.entry_slug] = {fire:0,rocket:0,love:0,clap:0};
    reactMap[r.entry_slug][r.reaction] = Number(r.cnt);
  });

  const totalReactions = (reactions||[]).reduce((s,r)=>s+Number(r.cnt),0);
  const devArr = devices||[];

  let html = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
    <div style="display:flex;border-bottom:1px solid var(--border);flex-wrap:wrap">
      ${[
        {label:'Views (30T)',  val:totalViews,     col:'#818cf8'},
        {label:'Unique Visits',val:totalUniques,   col:'#60a5fa'},
        {label:'Eintr\u00e4ge',val:(byPost||[]).length, col:'#34d399'},
        {label:'Reactions',    val:totalReactions, col:'#f59e0b'},
      ].map(k=>`<div style="padding:14px 20px;flex:1;min-width:90px;border-right:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:4px">${k.label}</div>
        <div style="font-size:22px;font-weight:800;color:${k.col}">${k.val}</div>
      </div>`).join('')}
      <div style="padding:14px 20px;flex:1;min-width:110px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:6px">Ger\u00e4te</div>
        ${devArr.length ? devArr.map(d=>{ const tot=devArr.reduce((s,x)=>s+Number(x.cnt),0)||1; const pct=Math.round(Number(d.cnt)/tot*100); return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><span style="font-size:11px">${d.device==='mobile'?'\uD83D\uDCF1':'\uD83D\uDCBB'} ${d.device}</span><div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px"><div style="width:${pct}%;height:100%;background:#818cf8;border-radius:3px"></div></div><span style="font-size:10px;color:var(--text3)">${pct}%</span></div>`; }).join('') : '<div style="font-size:11px;color:var(--text3)">Keine Daten</div>'}
      </div>
    </div>
    <div style="padding:14px 18px;border-bottom:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:8px">Views letzte 30 Tage</div>
      ${sparkline(byDay)}
      ${byDay&&byDay.length?`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);font-family:'Space Mono',monospace;margin-top:4px"><span>${byDay[0]?.day||''}</span><span>${byDay[byDay.length-1]?.day||''}</span></div>`:''}
    </div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:rgba(255,255,255,.02)">
        <th style="text-align:left;padding:10px 16px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Eintrag</th>
        <th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Views</th>
        <th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Uniques</th>
        <th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Ø Zeit</th>
        <th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Scroll 75%</th>
        <th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Reactions</th>
      </tr></thead><tbody>`;

  (byPost||[]).forEach((r, ri) => {
    const sd = scrollMap[r.slug];
    const s75 = sd && sd.total > 0 ? Math.round(Number(sd.s75)/Number(sd.total)*100) : null;
    const rx = reactMap[r.slug] || {fire:0,rocket:0,love:0,clap:0};
    const rxT = rx.fire+rx.rocket+rx.love+rx.clap;
    const bg = ri%2===0 ? 'transparent' : 'rgba(255,255,255,.015)';
    function sBadge(p) {
      if (p===null) return '<span style="color:var(--text3)">-</span>';
      const c=p>=60?'#34d399':p>=30?'#fbbf24':'#f87171';
      const b=p>=60?'rgba(52,211,153,.1)':p>=30?'rgba(251,191,36,.1)':'rgba(239,68,68,.1)';
      return `<span style="padding:2px 6px;border-radius:5px;background:${b};color:${c};font-size:11px;font-weight:700;font-family:'Space Mono',monospace">${p}%</span>`;
    }
    html += `<tr style="background:${bg}" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background='${bg}'">
      <td style="padding:10px 16px;border-bottom:1px solid rgba(35,46,66,.4);font-size:12px;font-weight:600">${r.slug||'(unbekannt)'}</td>
      <td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:13px;font-weight:700;color:#818cf8">${r.views}</td>
      <td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:13px;font-weight:700;color:#60a5fa">${r.uniques}</td>
      <td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:12px;color:var(--text2);font-family:'Space Mono',monospace">${fmtTime(r.avg_time)}</td>
      <td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${sBadge(s75)}</td>
      <td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${rxT>0?`<span title="\uD83D\uDD25${rx.fire} \uD83D\uDE80${rx.rocket} \u2764\uFE0F${rx.love} \uD83D\uDC4F${rx.clap}">\uD83D\uDD25${rx.fire} \uD83D\uDE80${rx.rocket} \u2764\uFE0F${rx.love} \uD83D\uDC4F${rx.clap}</span>`:'<span style="color:var(--text3)">–</span>'}</td>
    </tr>`;
  });

  if (!(byPost||[]).length) html += `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text3);font-size:12px">📊 Noch keine Analytics-Daten — werden automatisch gesammelt wenn jemand eine Changelog-Seite aufruft.</td></tr>`;

  html += `</tbody></table></div>
    <div style="display:flex;border-top:1px solid var(--border);flex-wrap:wrap">
      <div style="flex:1;min-width:180px;padding:14px 18px;border-right:1px solid var(--border)">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:10px">Top Referrer</div>
        ${(referrers||[]).length ? (referrers||[]).map(r=>{ const h=r.referrer.replace(/^https?:\/\//,'').split('/')[0]||r.referrer; return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h||'(direkt)')}</span><span style="font-size:11px;font-weight:700;color:#818cf8;font-family:'Space Mono',monospace">${r.cnt}</span></div>`; }).join('') : '<div style="font-size:11px;color:var(--text3)">Keine Daten</div>'}
      </div>
      <div style="flex:1;min-width:180px;padding:14px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:10px">Top Reactions</div>
        ${(reactions||[]).length ? Object.entries((reactions||[]).reduce((a,r)=>{ a[r.reaction]=(a[r.reaction]||0)+Number(r.cnt); return a; },{})).sort((a,b)=>b[1]-a[1]).map(([r,cnt])=>{ const icons={fire:'\uD83D\uDD25',rocket:'\uD83D\uDE80',love:'\u2764\uFE0F',clap:'\uD83D\uDC4F'}; return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:16px">${icons[r]||r}</span><span style="font-size:12px;font-weight:700;color:var(--text2)">${cnt}</span></div>`; }).join('') : '<div style="font-size:11px;color:var(--text3)">Noch keine Reactions</div>'}
      </div>
    </div>
    <div style="padding:8px 18px;font-size:10px;color:var(--text3);font-family:'Space Mono',monospace;border-top:1px solid var(--border)">Zeitraum: letzte 30 Tage \u00b7 Reactions: alle Zeit \u00b7 Session-IDs sind anonym</div>
  </div>`;

  return html;
}

async function renderChangelog(siteId, panel) {
  const entries = await api(`/api/changelog?site_id=${siteId}`);
  if (!entries) { panel.innerHTML = errState(); return; }

  const typeColors = {
    feature:     { bg: 'rgba(99,102,241,.15)',  color: '#818cf8' },
    converter:   { bg: 'rgba(34,197,94,.15)',   color: '#4ade80' },
    improvement: { bg: 'rgba(245,158,11,.15)',  color: '#fbbf24' },
    bugfix:      { bg: 'rgba(239,68,68,.15)',   color: '#f87171' },
    content:     { bg: 'rgba(139,92,246,.15)',  color: '#c084fc' },
  };
  const typeOpts = [
    { value: 'feature',     label: '🚀 New Feature' },
    { value: 'converter',   label: '🔄 New Converter' },
    { value: 'improvement', label: '⚡ Improvement' },
    { value: 'bugfix',      label: '🐛 Bugfix' },
    { value: 'content',     label: '📝 Content' },
  ];

  panel.innerHTML = `
    <div class="form-card" style="margin-bottom:20px">
      <div class="form-card-title">📋 Neuen Eintrag erstellen</div>
      <div class="form-row">
        <div class="form-group">
          <label>Titel</label>
          <input id="cl-title" placeholder="z.B. PNG zu JPG Converter verbessert">
        </div>
        <div class="form-group" style="max-width:200px">
          <label>Typ</label>
          <select id="cl-type">
            ${typeOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group form-full">
          <label>Beschreibung (HTML erlaubt)</label>
          <textarea id="cl-desc" rows="5" placeholder="&lt;p&gt;Was wurde gemacht...&lt;/p&gt;
&lt;ul&gt;&lt;li&gt;Punkt 1&lt;/li&gt;&lt;/ul&gt;"
            style="font-family:'Space Mono',monospace;font-size:12px"></textarea>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="cl-publish" style="width:16px;height:16px" onchange="document.getElementById('cl-schedule-wrap').style.display='none';document.getElementById('cl-schedule-check').checked=false">
          Sofort veröffentlichen
        </label>
        <button id="cl-schedule-btn" class="btn btn-ghost btn-sm" style="font-size:13px" onclick="_openClScheduleModal()">\u23F0 Zeitplan</button>
        <button class="btn btn-primary" onclick="submitChangelog('${siteId}')">Eintrag erstellen</button>
      </div>
    </div>

    <div class="actions-bar" style="margin-bottom:8px">
      <div style="font-size:13px;font-weight:700">Einträge (${entries.length})
        <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:8px">${entries.filter(e=>e.published).length} live</span>
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" id="cl-analytics-btn" onclick="_clToggleAnalytics('${siteId}')">📊 Analytics</button>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','changelog')">↻ Aktualisieren</button>
    </div>

    <div id="cl-analytics-panel" style="display:none;margin-bottom:16px">
      <div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Lade Analytics\u2026</div>
    </div>

    ${entries.length ? `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${entries.map(e => {
          const tc = typeColors[e.type] || typeColors.feature;
          const descPreview = (e.description || '').replace(/<[^>]+>/g, '').slice(0, 100);
          return `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                  <span style="font-size:11px;padding:2px 8px;border-radius:5px;background:${tc.bg};color:${tc.color};font-weight:700">${e.type || 'feature'}</span>
                  ${e.published
                    ? '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(52,211,153,.15);color:#34d399;font-weight:700">✓ Live</span>'
                    : '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.07);color:var(--text3)">Entwurf</span>'}
                  <span class="mono" style="color:var(--text3);font-size:10px;margin-left:auto">${fmtDate(e.created_at)}</span>
                </div>
                <div style="font-weight:700;font-size:13px;margin-bottom:4px">${esc(e.title)}</div>
                ${descPreview ? `<div style="font-size:12px;color:var(--text2);line-height:1.4">${esc(descPreview)}${e.description?.length > 100 ? '…' : ''}</div>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column;align-items:flex-end">
                <button class="btn btn-ghost btn-sm"
                  onclick="toggleChangelogPublish(${e.id}, ${e.published ? 0 : 1}, '${siteId}')">
                  ${e.published ? '↙ Entwurf' : '🌐 Veröff.'}
                </button>
                <button class="btn btn-ghost btn-sm" style="${e.publish_at ? 'color:#fbbf24;border-color:rgba(251,191,36,.35)' : ''}"
                  onclick="_clScheduleEntry(${e.id}, '${siteId}', ${e.publish_at ? `'${e.publish_at}'` : 'null'})">
                  ${e.publish_at ? '⏰ ' + new Date(e.publish_at).toLocaleString('de-DE', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '⏰ Planen'}
                </button>
                <button class="btn btn-danger btn-sm"
                  onclick="deleteChangelog(${e.id}, '${siteId}')">× Löschen</button>
              </div>
            </div>
          </div>`;}).join('')}
      </div>` : emptyState('Noch keine Einträge – erstelle den ersten Changelog-Post!')}
  `;
}

async function submitChangelog(siteId) {
  const title      = document.getElementById('cl-title')?.value?.trim();
  const type       = document.getElementById('cl-type')?.value;
  const desc       = document.getElementById('cl-desc')?.value?.trim();
  const publish    = document.getElementById('cl-publish')?.checked ? 1 : 0;
  const publishAtISO = window._clScheduleISO || null;
  if (!title) { alert('Titel ist erforderlich'); return; }
  await api('/api/changelog', {
    method: 'POST',
    body: { site_id: siteId, version: new Date().toISOString().slice(0,10), title, description: desc, type, published: publish, publish_at: publishAtISO }
  });
  if (publish) {
    await api('/api/notifications', {
      method: 'POST',
      body: { site_id: siteId, type: 'info', title: `📋 Changelog: ${title}`, message: 'Neuer Eintrag veröffentlicht auf /changelog' }
    });
  }
  document.getElementById('cl-title').value = '';
  document.getElementById('cl-desc').value = '';
  document.getElementById('cl-publish').checked = false;
  reloadPanel(siteId, 'changelog');
}

async function toggleChangelogPublish(id, newVal, siteId) {
  await api(`/api/changelog/${id}`, { method: 'PATCH', body: { published: newVal } });
  if (newVal) {
    const entries = await api(`/api/changelog?site_id=${siteId}`);
    const entry = entries?.find(e => e.id === id);
    if (entry) {
      await api('/api/notifications', {
        method: 'POST',
        body: { site_id: siteId, type: 'info', title: `📋 Changelog live: ${entry.title}`, message: 'Veröffentlicht auf /changelog' }
      });
    }
  }
  reloadPanel(siteId, 'changelog');
}

async function deleteChangelog(id, siteId) {
  if (!confirm('Eintrag wirklich löschen?')) return;
  await api(`/api/changelog/${id}`, { method: 'DELETE' });
  reloadPanel(siteId, 'changelog');
}

window._clScheduleEntry = function(id, siteId, currentISO) {
  _openScheduleModal({
    currentISO: currentISO || null,
    onConfirm: async function(iso) {
      await api(`/api/changelog/${id}`, { method: 'PATCH', body: { publish_at: iso, published: 0 } });
      reloadPanel(siteId, 'changelog');
    },
    onClear: async function() {
      await api(`/api/changelog/${id}`, { method: 'PATCH', body: { publish_at: null } });
      reloadPanel(siteId, 'changelog');
    }
  });
};

// ── Zeitplan-Modal (wiederverwendbar) ────────────────────────────
function _fmtSchedule(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleString('de-DE', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

window._openScheduleModal = function(opts) {
  var old = document.getElementById('_sched-modal');
  if (old) old.remove();

  var initDt = (opts.currentISO && opts.currentISO.trim())
    ? new Date(opts.currentISO)
    : new Date(Date.now() + 86400000);
  if (!opts.currentISO) initDt.setHours(9, 0, 0, 0);

  var pad = function(n){ return String(n).padStart(2,'0'); };
  var localStr = initDt.getFullYear()+'-'+pad(initDt.getMonth()+1)+'-'+pad(initDt.getDate())+'T'+pad(initDt.getHours())+':'+pad(initDt.getMinutes());

  var modal = document.createElement('div');
  modal.id = '_sched-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(3px)';

  modal.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 28px;width:340px;max-width:calc(100vw - 40px);box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:18px;color:var(--text1)">⏰ Zeitplan festlegen</div>' +
      '<div style="margin-bottom:14px">' +
        '<label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Datum &amp; Uhrzeit</label>' +
        '<input type="datetime-local" id="_sched-dt" value="' + localStr + '" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text1);font-size:14px;font-family:inherit">' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">' +
        '<button onclick="_schedQuick(1,9,0)" class="btn btn-ghost btn-sm" style="font-size:11px">Morgen 9:00</button>' +
        '<button onclick="_schedQuick(2,9,0)" class="btn btn-ghost btn-sm" style="font-size:11px">Übermorgen 9:00</button>' +
        '<button onclick="_schedQuick(7,9,0)" class="btn btn-ghost btn-sm" style="font-size:11px">+ 1 Woche</button>' +
        '<button onclick="_schedQuick(30,9,0)" class="btn btn-ghost btn-sm" style="font-size:11px">+ 1 Monat</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        (opts.onClear ? '<button onclick="_schedClear()" class="btn btn-ghost btn-sm" style="font-size:12px;color:var(--text3)">× Zeitplan entfernen</button>' : '') +
        '<div style="flex:1"></div>' +
        '<button onclick="_schedCancel()" class="btn btn-ghost" style="font-size:13px">Abbrechen</button>' +
        '<button onclick="_schedConfirm()" class="btn btn-primary" style="font-size:13px">⏰ Planen</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){ if (e.target === modal) _schedCancel(); });

  window._schedQuick = function(days, h, m) {
    var d = new Date(Date.now() + days * 86400000); d.setHours(h, m, 0, 0);
    document.getElementById('_sched-dt').value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  };
  window._schedCancel  = function(){ var m=document.getElementById('_sched-modal'); if(m) m.remove(); };
  window._schedClear   = function(){ document.getElementById('_sched-modal').remove(); if(opts.onClear) opts.onClear(); };
  window._schedConfirm = function(){
    var val = document.getElementById('_sched-dt')?.value;
    if (!val) { alert('Bitte Datum und Uhrzeit wählen.'); return; }
    var d = new Date(val);
    if (isNaN(d.getTime())) { alert('Ungültiges Datum.'); return; }
    document.getElementById('_sched-modal').remove();
    if (opts.onConfirm) opts.onConfirm(d.toISOString());
  };
};

// Helper: Blog-Neu-Schedule-Modal öffnen (referenziert bl-schedule-btn)
window._openBlogScheduleModal = function() {
  _openScheduleModal({
    currentISO: window._blgNewScheduleISO,
    onConfirm: function(iso) {
      window._blgNewScheduleISO = iso;
      var btn = document.getElementById('bl-schedule-btn');
      if (btn) { btn.textContent = '⏰ ' + _fmtSchedule(iso); btn.style.color = '#fbbf24'; btn.style.borderColor = 'rgba(251,191,36,.35)'; }
    },
    onClear: function() {
      window._blgNewScheduleISO = null;
      var btn = document.getElementById('bl-schedule-btn');
      if (btn) { btn.textContent = '⏰ Zeitplan wählen'; btn.style.color = ''; btn.style.borderColor = ''; }
    }
  });
};

// Helper: Changelog-Schedule-Modal öffnen
window._openClScheduleModal = function() {
  _openScheduleModal({
    currentISO: window._clScheduleISO,
    onConfirm: function(iso) {
      window._clScheduleISO = iso;
      var btn = document.getElementById('cl-schedule-btn');
      if (btn) { btn.textContent = '⏰ ' + _fmtSchedule(iso); btn.style.color = '#fbbf24'; btn.style.borderColor = 'rgba(251,191,36,.35)'; }
      var pub = document.getElementById('cl-publish'); if (pub) pub.checked = false;
    },
    onClear: function() {
      window._clScheduleISO = null;
      var btn = document.getElementById('cl-schedule-btn');
      if (btn) { btn.textContent = '⏰ Zeitplan'; btn.style.color = ''; btn.style.borderColor = ''; }
    }
  });
};

// ── BLOG MEHRSPRACHIG ────────────────────────────────────────────
const BLOG_LANG_MAP = { de:'🇩🇪 DE', en:'🇬🇧 EN', fr:'🇫🇷 FR', es:'🇪🇸 ES', it:'🇮🇹 IT' };

// Blog-Gruppen aufklappen/zuklappen
window._blgToggle = function(id) {
  var box = document.getElementById(id);
  var arr = document.getElementById(id + '_arr');
  if (!box) return;
  var open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'flex';
  if (arr) arr.style.transform = open ? '' : 'rotate(180deg)';
};
// Blog-Post Aktionen (data-attribute Handler)
window._blgAction = function(btn) {
var act  = btn.dataset.act;
var id   = Number(btn.dataset.id);
var site = btn.dataset.site;
var st   = btn.dataset.st;
  if (act === 'pub')    toggleBlogPublish(id, st, site);
if (act === 'edit')   openBlogEdit(id, site);
  if (act === 'del')    deleteBlogPost(id, site);
};

function _renderBlogPostList(posts, siteId) {
// Gruppiere nach group_id; Fallback: erster Tag; sonst Solo
var groups   = [];
var groupMap = {};
posts.forEach(function(p) {
  var gid = (p.group_id && p.group_id.trim()) ? p.group_id : null;
  // Fallback: gruppiere nach erstem Tag wenn kein group_id
  if (!gid) {
    var firstTag = (p.tags || '').split(',')[0].trim();
    gid = firstTag ? ('__tag__' + firstTag) : ('__solo__' + p.id);
  }
  if (!groupMap[gid]) {
    groupMap[gid] = { key: gid, posts: [], date: p.created_at, isTagGroup: gid.startsWith('__tag__') };
    groups.push(groupMap[gid]);
  }
  groupMap[gid].posts.push(p);
  if (p.created_at < groupMap[gid].date) groupMap[gid].date = p.created_at;
});

var LANG_ORDER = ['de','en','fr','es','it'];
var html = '<div style="display:flex;flex-direction:column;gap:8px">';

groups.forEach(function(g, gi) {
var repPost   = g.posts.find(function(p){ return p.lang==='de'; }) || g.posts[0];
var title     = esc(repPost.title);
    var tags      = repPost.tags || '';
var liveCount = g.posts.filter(function(p){ return p.status==='published'; }).length;
var total     = g.posts.length;
var gid       = 'blg' + gi;

// Sprach-Badges
var badges = '';
LANG_ORDER.forEach(function(lc) {
var p = g.posts.find(function(x){ return x.lang===lc; });
if (!p) {
  badges += '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.04);color:var(--text3);opacity:.4">' + BLOG_LANG_MAP[lc] + '</span>';
} else if (p.status === 'published') {
  badges += '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(52,211,153,.15);color:#34d399;font-weight:700">' + BLOG_LANG_MAP[lc] + ' \u2713</span>';
} else {
badges += '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.06);color:var(--text3)">' + BLOG_LANG_MAP[lc] + '</span>';
}
});

// Tag-Badges
var tagHtml = '';
if (tags) tags.split(',').forEach(function(t) {
tagHtml += '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(139,92,246,.15);color:#c084fc">' + esc(t.trim()) + '</span>';
});

    // Gruppen-Header (onclick via _blgToggle)
    var borderColor = liveCount === total ? 'rgba(52,211,153,.3)' : 'var(--border)';
html += '<div style="background:var(--surface);border:1px solid ' + borderColor + ';border-radius:10px;overflow:hidden">';
html += '<div onclick="_blgToggle(\'' + gid + '\')" style="display:flex;align-items:flex-start;gap:12px;padding:13px 16px;cursor:pointer;user-select:none;transition:background .15s" onmouseover="this.style.background=\'rgba(255,255,255,.03)\'" onmouseout="this.style.background=\'\'">';
html +=   '<div style="flex:1;min-width:0">';
html +=     '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:6px">';
html +=       badges;
html +=       (tagHtml ? '<span style="margin-left:4px">' + tagHtml + '</span>' : '');
// Warnung wenn Tag-Gruppe (noch kein echtes group_id)
if (g.isTagGroup && total > 1) {
  html += '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(251,191,36,.15);color:#fbbf24;margin-left:4px">Tag-Gruppe</span>';
}
html +=       '<span class="mono" style="color:var(--text3);font-size:10px;margin-left:auto">' + fmtDate(g.date) + '</span>';
html +=     '</div>';
html +=     '<div style="font-weight:700;font-size:13px;color:var(--text1)">' + title + '</div>';
html +=     '<div style="display:flex;align-items:center;gap:10px;margin-top:3px">';
html +=       '<span style="font-size:11px;color:' + (liveCount===total?'#34d399':'var(--text3)') + '">' + liveCount + '/' + total + ' Sprachen live</span>';
// Button: Tag-Gruppe in echte Gruppe umwandeln
if (g.isTagGroup && total > 1) {
  var postIds = JSON.stringify(g.posts.map(function(p){return p.id;}));
  html += '<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();_blgFixGroup(' + postIds + ',\'' + siteId + '\')">🔗 Gruppe fixieren</button>';
}
var allIds   = JSON.stringify(g.posts.map(function(p){return p.id;}));
var allLive  = liveCount === total;
var schedISO = g.posts.reduce(function(f,p){ return f||(p.publish_at&&p.publish_at.trim()?p.publish_at:null); }, null);
var schedLbl = schedISO ? ('\u23f0 ' + _fmtSchedule(schedISO)) : '\u23f0 Planen';
var schedSt  = schedISO ? 'font-size:10px;padding:2px 8px;color:#fbbf24;border-color:rgba(251,191,36,.35)' : 'font-size:10px;padding:2px 8px';
var schedArg = schedISO ? ("'" + schedISO + "'") : 'null';
html += '<button class="btn btn-ghost btn-sm" style="' + schedSt + '" onclick="event.stopPropagation();_blgScheduleGroup(' + allIds + ',\'' + siteId + '\',' + schedArg + ')">' + schedLbl + '</button>';
html += '<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();_blgPublishGroup(' + allIds + ',\'' + (allLive?'draft':'published') + '\',\'' + siteId + '\')">'
  + (allLive ? '\u2199 Alle Entwurf' : '\uD83C\uDF10 Alle live') + '</button>';
html += '<button class="btn btn-danger btn-sm" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();_blgDeleteGroup(' + allIds + ',\'' + siteId + '\')">&times; Gruppe löschen</button>';
html +=     '</div>';
html +=   '</div>';
html +=   '<span id="' + gid + '_arr" style="font-size:16px;color:var(--text3);flex-shrink:0;padding-top:2px;transition:transform .2s">&#9660;</span>';
html += '</div>';

// Ausgeklappte Sprach-Zeilen (standardmäßig geschlossen)
html += '<div id="' + gid + '" style="display:none;flex-direction:column;gap:6px;padding:0 12px 12px">';
LANG_ORDER.forEach(function(lc) {
var p = g.posts.find(function(x){ return x.lang===lc; });
if (!p) return;
var isLive = p.status === 'published';
    var newSt  = isLive ? 'draft' : 'published';
      var lbl    = isLive ? '\u2199 Entwurf' : '\uD83C\uDF10 Ver\u00F6ff.';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:7px;background:var(--bg);border:1px solid var(--border)">';
      html +=   '<span style="min-width:54px;font-size:11px;font-weight:700;color:' + (isLive ? '#34d399' : 'var(--text3)') + '">' + BLOG_LANG_MAP[lc] + '</span>';
      html +=   '<span style="flex:1;font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title) + '</span>';
      // SEO-Badge
      if (p.meta_keywords && p.meta_keywords.length > 0) {
        html += '<span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.2);color:#c084fc;flex-shrink:0;margin-left:4px" title="SEO generiert: ' + esc(p.meta_description||'') + '">🔍 SEO</span>';
      } else {
        html += '<span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);color:#fbbf24;flex-shrink:0;margin-left:4px">⚠ kein SEO</span>';
      }
      // Feedback-Badge
      var fb = window._blgFeedback && window._blgFeedback[p.id];
      if (fb && fb.total > 0) {
        var pct = Math.round(fb.yes / fb.total * 100);
        var fbCol = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
        html += '<span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:' + fbCol + ';font-family:\'Space Mono\',monospace;flex-shrink:0;margin-left:4px" title="' + fb.yes + ' Ja / ' + fb.no + ' Nein">' +
          '\uD83D\uDC4D ' + pct + '% (' + fb.total + ')</span>';
      }
      html +=   '<div style="display:flex;gap:4px;flex-shrink:0">';
      html +=     '<button class="btn btn-ghost btn-sm" data-act="pub" data-id="' + p.id + '" data-site="' + siteId + '" data-st="' + newSt + '" onclick="_blgAction(this)">' + lbl + '</button>';
      html +=     '<button class="btn btn-ghost btn-sm" data-act="edit" data-id="' + p.id + '" data-site="' + siteId + '" onclick="_blgAction(this)">\u270f Edit</button>';
      html +=     '<button class="btn btn-danger btn-sm" data-act="del" data-id="' + p.id + '" data-site="' + siteId + '" onclick="_blgAction(this)">&times;</button>';
      html +=   '</div>';
      html += '</div>';
      html += '<div id="bl-edit-' + p.id + '" style="display:none"></div>';
    });
    html += '</div>'; // end collapsible
    html += '</div>'; // end group card
  });

  html += '</div>';
  return html;
}

const BLOG_LANGS = [
  { code: 'de', flag: '\uD83C\uDDE9\uD83C\uDDEA', label: 'Deutsch' },
  { code: 'en', flag: '\uD83C\uDDEC\uD83C\uDDE7', label: 'English' },
  { code: 'fr', flag: '\uD83C\uDDEB\uD83C\uDDF7', label: 'Fran\u00E7ais' },
  { code: 'es', flag: '\uD83C\uDDEA\uD83C\uDDF8', label: 'Espa\u00F1ol' },
  { code: 'it', flag: '\uD83C\uDDEE\uD83C\uDDF9', label: 'Italiano' },
];

function _renderFeedbackTable(posts, feedback) {
  if (!feedback.length) {
    return `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px">
      Noch kein Feedback eingegangen. Sobald User den Widget nutzen erscheinen hier die Daten.
    </div>`;
  }

  const LANGS = ['de','en','fr','es','it'];
  const FLAGS = { de:'\uD83C\uDDE9\uD83C\uDDEA', en:'\uD83C\uDDEC\uD83C\uDDE7', fr:'\uD83C\uDDEB\uD83C\uDDF7', es:'\uD83C\uDDEA\uD83C\uDDF8', it:'\uD83C\uDDEE\uD83C\uDDF9' };

  // Post-Map: id -> title (DE preferred)
  const postTitles = {};
  posts.forEach(p => {
    if (!postTitles[p.id] || p.lang === 'de') postTitles[p.id] = p.title;
  });

  // Feedback gruppiert nach post_id
  const byPost = {};
  feedback.forEach(f => {
    const pid = f.post_id;
    if (!byPost[pid]) byPost[pid] = { post_id: pid, slug: f.post_slug, langs: {}, yes: 0, no: 0, total: 0 };
    byPost[pid].langs[f.lang] = { yes: Number(f.yes), no: Number(f.no), total: Number(f.total) };
    byPost[pid].yes   += Number(f.yes);
    byPost[pid].no    += Number(f.no);
    byPost[pid].total += Number(f.total);
  });

  // Sortiert nach Gesamtanzahl desc
  const rows = Object.values(byPost).sort((a, b) => b.total - a.total);

  function fbCell(d) {
    if (!d || d.total === 0) return '<td style="text-align:center;padding:8px;color:var(--text3);font-size:11px">&ndash;</td>';
    const pct = Math.round(d.yes / d.total * 100);
    const col = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
    return `<td style="text-align:center;padding:8px">
      <span style="font-size:11px;font-family:'Space Mono',monospace;color:${col}" title="${d.yes} Ja / ${d.no} Nein">
        ${pct}%<br><span style="font-size:9px;opacity:.6">(${d.total})</span>
      </span>
    </td>`;
  }

  function overallBadge(r) {
    if (r.total === 0) return '';
    const pct = Math.round(r.yes / r.total * 100);
    const col = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
    const icon = pct >= 70 ? '\uD83D\uDC4D' : pct >= 40 ? '\u26A0\uFE0F' : '\uD83D\uDC4E';
    return `<span style="font-size:11px;font-weight:700;color:${col};font-family:'Space Mono',monospace">${icon} ${pct}% <span style="opacity:.6;font-weight:400">(${r.total})</span></span>`;
  }

  const tableRows = rows.map((r, i) => {
    const title = postTitles[r.post_id] || r.slug || 'Post #' + r.post_id;
    const bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)';
    return `<tr style="background:${bg}">
      <td style="padding:8px 12px;font-size:12px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(title)}">${esc(title)}</td>
      <td style="text-align:center;padding:8px 12px">${overallBadge(r)}</td>
      ${LANGS.map(l => fbCell(r.langs[l])).join('')}
    </tr>`;
  }).join('');

  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;font-weight:700">�\uDC4D Feedback-Analyse</span>
        <span style="font-size:11px;color:var(--text3)">${rows.length} Posts mit Feedback &middot; ${feedback.reduce((s,f)=>s+Number(f.total),0)} Stimmen gesamt</span>
      </div>
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace">Post</th>
            <th style="text-align:center;padding:8px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace">Gesamt</th>
            ${LANGS.map(l => `<th style="text-align:center;padding:8px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace">${FLAGS[l]} ${l.toUpperCase()}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      </div>
    </div>`;
}

window._blgToggleFeedback = function(siteId) {
  const panel = document.getElementById('bl-feedback-panel');
  const btn   = document.getElementById('bl-feedback-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (btn) {
    btn.style.background     = open ? '' : 'rgba(96,165,250,.1)';
    btn.style.borderColor    = open ? '' : 'rgba(96,165,250,.3)';
    btn.style.color          = open ? '' : '#60a5fa';
  }
};

// ── Blog Analytics ─────────────────────────────────────────────────
window._blgToggleAnalytics = async function(siteId) {
  const panel = document.getElementById('bl-analytics-panel');
  const btn   = document.getElementById('bl-analytics-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  if (open) {
    panel.style.display = 'none';
    if (btn) { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }
    return;
  }
  panel.style.display = 'block';
  if (btn) { btn.style.background = 'rgba(99,102,241,.15)'; btn.style.borderColor = 'rgba(99,102,241,.4)'; btn.style.color = '#818cf8'; }
  panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Lade Analytics\u2026</div>';
  const data = await api(`/api/blog/analytics?site_id=${siteId}&days=30`);
  if (!data) { panel.innerHTML = errState(); return; }
  panel.innerHTML = _renderBlogAnalytics(data);
};

function _renderBlogAnalytics(data) {
  const { byPost, scrollDist, referrers, countries, devices, byDay } = data;

  const totalViews   = byPost.reduce((s,r) => s + Number(r.views),   0);
  const totalUniques = byPost.reduce((s,r) => s + Number(r.uniques), 0);

  // Avg time helper
  function fmtTime(sec) {
    if (!sec || sec < 1) return '–';
    if (sec < 60) return Math.round(sec) + 's';
    return Math.floor(sec/60) + 'm ' + Math.round(sec%60) + 's';
  }

  // Sparkline für Views pro Tag
  function sparkline(rows) {
    if (!rows.length) return '<div style="color:var(--text3);font-size:11px">Noch keine Daten</div>';
    const vals = rows.map(r => Number(r.views));
    const max  = Math.max(...vals, 1);
    const bars = vals.map(v => {
      const h = Math.max(4, Math.round(v / max * 40));
      return `<div style="flex:1;height:${h}px;background:#818cf8;border-radius:2px 2px 0 0;opacity:.7;min-width:4px" title="${v}"></div>`;
    }).join('');
    return `<div style="display:flex;align-items:flex-end;gap:2px;height:44px;padding-top:4px">${bars}</div>`;
  }

  // Post-Tabelle: Grupp nach Slug (alle Sprachen zusammen)
  const bySlug = {};
  byPost.forEach(r => {
    if (!bySlug[r.post_slug]) bySlug[r.post_slug] = { views:0, uniques:0, times:[], langs:{} };
    bySlug[r.post_slug].views   += Number(r.views);
    bySlug[r.post_slug].uniques += Number(r.uniques);
    if (r.avg_time) bySlug[r.post_slug].times.push(Number(r.avg_time));
    bySlug[r.post_slug].langs[r.lang] = Number(r.views);
  });
  const sortedPosts = Object.entries(bySlug).sort((a,b) => b[1].views - a[1].views);

  // Scroll-Tiefe Map
  const scrollMap = {};
  scrollDist.forEach(r => { scrollMap[r.post_slug] = r; });

  // Flag emoji für Länder
  function flag(cc) {
    if (!cc || cc.length !== 2) return cc || '?';
    return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0))) + ' ' + cc;
  }

  let html = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">

    <!-- Header KPIs -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      ${[
        { label:'Views (30T)',    val: totalViews,   col:'#818cf8' },
        { label:'Unique Visitors', val: totalUniques, col:'#60a5fa' },
        { label:'Posts getrackt', val: sortedPosts.length, col:'#34d399' },
      ].map(k => `<div style="padding:14px 22px;flex:1;min-width:100px;border-right:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:4px">${k.label}</div>
        <div style="font-size:22px;font-weight:800;color:${k.col}">${k.val}</div>
      </div>`).join('')}
      <!-- Device split -->
      <div style="padding:14px 22px;flex:1;min-width:120px">
        <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:6px">Geräte</div>
        ${devices.map(d => {
          const total = devices.reduce((s,x) => s+Number(x.cnt),0) || 1;
          const pct   = Math.round(Number(d.cnt)/total*100);
          const icon  = d.device === 'mobile' ? '📱' : '💻';
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <span style="font-size:11px">${icon} ${d.device}</span>
            <div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px">
              <div style="width:${pct}%;height:100%;background:#818cf8;border-radius:3px"></div>
            </div>
            <span style="font-size:10px;color:var(--text3);font-family:'Space Mono',monospace">${pct}%</span>
          </div>`;
        }).join('') || '<div style="font-size:11px;color:var(--text3)">Keine Daten</div>'}
      </div>
    </div>

    <!-- Sparkline -->
    <div style="padding:14px 18px;border-bottom:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:8px">Views letzte 30 Tage</div>
      ${sparkline(byDay)}
      ${byDay.length ? `<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);font-family:'Space Mono',monospace;margin-top:4px"><span>${byDay[0]?.day||''}</span><span>${byDay[byDay.length-1]?.day||''}</span></div>` : ''}
    </div>

    <!-- Post-Tabelle -->
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:rgba(255,255,255,.02)">
        <th style="text-align:left;padding:10px 18px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Post</th>
        <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Views</th>
        <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Uniques</th>
        <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Eis Zeit</th>
        <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Scroll 75%+</th>
        <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Scroll 100%</th>
      </tr></thead>
      <tbody>`;

  sortedPosts.forEach(([slug, d], ri) => {
    const avgTime = d.times.length ? d.times.reduce((a,b)=>a+b,0)/d.times.length : null;
    const sd = scrollMap[slug];
    const s75pct  = sd && sd.total > 0 ? Math.round(Number(sd.s75)  / Number(sd.total) * 100) : null;
    const s100pct = sd && sd.total > 0 ? Math.round(Number(sd.s100) / Number(sd.total) * 100) : null;
    const rowBg = ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)';

    function scrollBadge(pct) {
      if (pct === null) return '<span style="color:var(--text3)">-</span>';
      const col = pct >= 60 ? '#34d399' : pct >= 30 ? '#fbbf24' : '#f87171';
      const bg  = pct >= 60 ? 'rgba(52,211,153,.1)' : pct >= 30 ? 'rgba(251,191,36,.1)' : 'rgba(239,68,68,.1)';
      return `<span style="padding:2px 7px;border-radius:5px;background:${bg};color:${col};font-size:11px;font-weight:700;font-family:'Space Mono',monospace">${pct}%</span>`;
    }

    html += `<tr style="background:${rowBg}" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background='${rowBg}'">
      <td style="padding:10px 18px;border-bottom:1px solid rgba(35,46,66,.4)">
        <div style="font-size:12px;font-weight:600">${slug || '(unbekannt)'}</div>
        <div style="font-size:10px;color:var(--text3);font-family:'Space Mono',monospace;margin-top:2px">${Object.entries(d.langs).map(([l,v])=>`${l}:${v}`).join(' · ')}</div>
      </td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:13px;font-weight:700;color:#818cf8">${d.views}</td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:13px;font-weight:700;color:#60a5fa">${d.uniques}</td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4);font-size:12px;color:var(--text2);font-family:'Space Mono',monospace">${fmtTime(avgTime)}</td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${scrollBadge(s75pct)}</td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${scrollBadge(s100pct)}</td>
    </tr>`;
  });

  if (!sortedPosts.length) {
    html += `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text3);font-size:12px">📊 Noch keine Analytics-Daten — werden automatisch gesammelt sobald jemand einen Blog-Post aufruft.</td></tr>`;
  }

  html += `</tbody></table></div>

    <!-- Bottom: Referrer + Länder -->
    <div style="display:flex;gap:0;border-top:1px solid var(--border);flex-wrap:wrap">
      <!-- Referrer -->
      <div style="flex:1;min-width:200px;padding:14px 18px;border-right:1px solid var(--border)">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:10px">Top Referrer</div>
        ${referrers.length
          ? referrers.map(r => {
              const host = r.referrer.replace(/^https?:\/\//,'').split('/')[0] || r.referrer;
              return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.referrer)}">${esc(host||'(direkt)')}</span>
                <span style="font-size:11px;font-weight:700;color:#818cf8;font-family:'Space Mono',monospace;flex-shrink:0">${r.cnt}</span>
              </div>`;
            }).join('')
          : '<div style="font-size:11px;color:var(--text3)">Keine Daten</div>'}
      </div>
      <!-- Länder -->
      <div style="flex:1;min-width:200px;padding:14px 18px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;margin-bottom:10px">Top Länder</div>
        ${countries.length
          ? countries.map(c => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="flex:1;font-size:11px">${flag(c.country)}</span>
              <span style="font-size:11px;font-weight:700;color:#60a5fa;font-family:'Space Mono',monospace;flex-shrink:0">${c.cnt}</span>
            </div>`).join('')
          : '<div style="font-size:11px;color:var(--text3)">Keine Daten</div>'}
      </div>
    </div>

    <div style="padding:8px 18px;font-size:10px;color:var(--text3);font-family:'Space Mono',monospace;border-top:1px solid var(--border)">
      Zeitraum: letzte 30 Tage · Session-IDs sind anonym · kein Tracking von IPs
    </div>
  </div>`;

  return html;
}

// ── Feedback-Tabelle ───────────────────────────────────────────────────
function _renderFeedbackTable(posts, feedbackRows) {
  if (!feedbackRows.length) {
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;text-align:center;color:var(--text3);font-size:12px">
      <div style="font-size:28px;margin-bottom:8px">👍</div>
      Noch kein Feedback gesammelt — der Widget erscheint wenn User 60% des Artikels gelesen haben.
    </div>`;
  }

  // Aggregiere pro post_id (alle Sprachen zusammen)
  const byPost = {};
  feedbackRows.forEach(f => {
    if (!byPost[f.post_id]) byPost[f.post_id] = { yes:0, no:0, total:0, langs:{} };
    byPost[f.post_id].yes   += Number(f.yes);
    byPost[f.post_id].no    += Number(f.no);
    byPost[f.post_id].total += Number(f.total);
    byPost[f.post_id].langs[f.lang] = { yes: Number(f.yes), no: Number(f.no), total: Number(f.total) };
  });

  // Sortiere: meiste Votes zuerst
  const sorted = Object.entries(byPost)
    .sort((a, b) => b[1].total - a[1].total);

  // Sprachen die vorkommen
  const allLangs = ['de','en','fr','es','it'].filter(l =>
    feedbackRows.some(f => f.lang === l)
  );

  function pctBadge(yes, total) {
    if (!total) return '<span style="color:var(--text3);font-size:11px">-</span>';
    const pct = Math.round(yes / total * 100);
    const col = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
    const bg  = pct >= 70 ? 'rgba(52,211,153,.1)' : pct >= 40 ? 'rgba(251,191,36,.1)' : 'rgba(239,68,68,.1)';
    const icon = pct >= 70 ? '\uD83D\uDC4D' : pct >= 40 ? '\u26A0' : '\uD83D\uDC4E';
    return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:5px;background:${bg};color:${col};font-size:11px;font-weight:700;font-family:'Space Mono',monospace">${icon} ${pct}%<span style="opacity:.6;font-size:10px;margin-left:2px">(${total})</span></span>`;
  }

  // Gesamtzahlen
  const totalYes   = feedbackRows.reduce((s,f) => s + Number(f.yes), 0);
  const totalNo    = feedbackRows.reduce((s,f) => s + Number(f.no), 0);
  const totalVotes = totalYes + totalNo;
  const overallPct = totalVotes ? Math.round(totalYes / totalVotes * 100) : 0;
  const overallCol = overallPct >= 70 ? '#34d399' : overallPct >= 40 ? '#fbbf24' : '#f87171';

  let html = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:16px;padding:14px 18px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:13px;font-weight:700">👍 Feedback-Analyse</span>
          <span style="font-size:11px;color:var(--text3)">${totalVotes} Stimmen gesamt</span>
        </div>
        <div style="display:flex;gap:16px;margin-left:auto;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace">Gesamt</div>
            <div style="font-size:20px;font-weight:800;color:${overallCol}">${overallPct}%</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace">👍 Ja</div>
            <div style="font-size:20px;font-weight:800;color:#34d399">${totalYes}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace">👎 Nein</div>
            <div style="font-size:20px;font-weight:800;color:#f87171">${totalNo}</div>
          </div>
        </div>
      </div>
      <!-- Tabelle -->
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:rgba(255,255,255,.02)">
            <th style="text-align:left;padding:10px 18px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Post</th>
            <th style="text-align:center;padding:10px 12px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">Gesamt</th>
            ${allLangs.map(l => `<th style="text-align:center;padding:10px 10px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);font-family:'Space Mono',monospace;border-bottom:1px solid var(--border)">${{'de':'🇩🇪','en':'🇬🇧','fr':'🇫🇷','es':'🇪🇸','it':'🇮🇹'}[l]||l.toUpperCase()}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

  sorted.forEach(([postId, data], ri) => {
    // Post-Titel finden
    const post = posts.find(p => p.id == postId);
    const title = post ? post.title : `Post #${postId}`;
    const slug  = post ? post.slug  : '';
    const rowBg = ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)';
    const overallPct2 = data.total ? Math.round(data.yes / data.total * 100) : 0;

    html += `<tr style="background:${rowBg};transition:background .12s" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background='${rowBg}'">
      <td style="padding:10px 18px;border-bottom:1px solid rgba(35,46,66,.4);max-width:260px">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(title)}">${esc(title)}</div>
        ${slug ? `<div style="font-size:10px;color:var(--text3);font-family:'Space Mono',monospace;margin-top:2px">${slug}</div>` : ''}
      </td>
      <td style="padding:10px 12px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${pctBadge(data.yes, data.total)}</td>
      ${allLangs.map(l => {
        const ld = data.langs[l];
        return `<td style="padding:10px 10px;text-align:center;border-bottom:1px solid rgba(35,46,66,.4)">${ld ? pctBadge(ld.yes, ld.total) : '<span style="color:var(--text3);font-size:11px">–</span>'}</td>`;
      }).join('')}
    </tr>`;
  });

  html += `</tbody></table></div>
    <div style="padding:10px 18px;font-size:10px;color:var(--text3);font-family:'Space Mono',monospace;border-top:1px solid var(--border)">
      👍 = >=70% hilfreich &nbsp;·&nbsp; ⚠ = 40-69% &nbsp;·&nbsp; 👎 = <40% &nbsp;·&nbsp; Votes werden intern gesammelt, sind nicht öffentlich sichtbar
    </div>
  </div>`;

  return html;
}

window._blgToggleFeedback = function(siteId) {
  const panel = document.getElementById('bl-feedback-panel');
  const btn   = document.getElementById('bl-feedback-btn');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (btn) {
    btn.style.background     = open ? '' : 'rgba(99,102,241,.15)';
    btn.style.borderColor    = open ? '' : 'rgba(99,102,241,.4)';
    btn.style.color          = open ? '' : '#818cf8';
  }
};

async function renderBlog(siteId, panel) {
  const [posts, feedback] = await Promise.all([
    api(`/api/blog?site_id=${siteId}`),
    api(`/api/blog/feedback?site_id=${siteId}`),
  ]);
  if (!posts) { panel.innerHTML = errState(); return; }

  // Feedback-Map: post_id -> { yes, no, total }
  window._blgFeedback = {};
  window._blgPostsCache = posts; // Cache für Bulk-SEO und andere globale Aktionen
  (feedback || []).forEach(f => {
    if (!window._blgFeedback[f.post_id]) window._blgFeedback[f.post_id] = { yes:0, no:0, total:0 };
    window._blgFeedback[f.post_id].yes   += Number(f.yes);
    window._blgFeedback[f.post_id].no    += Number(f.no);
    window._blgFeedback[f.post_id].total += Number(f.total);
  });
  const pubCount = posts.filter(p => p.status === 'published').length;

  const langTabs = BLOG_LANGS.map((l, i) => `
    <button onclick="switchBlogLang('${l.code}')" id="bl-tab-${l.code}" style="
      padding:7px 16px;border-radius:8px 8px 0 0;cursor:pointer;font-family:inherit;
      border:1px solid ${i===0?'var(--border)':'transparent'};
      border-bottom:${i===0?'1px solid var(--surface)':'none'};
      background:${i===0?'var(--surface)':'transparent'};
      color:${i===0?'var(--text1)':'var(--text3)'};
      font-size:13px;font-weight:600;margin-bottom:-1px;transition:all .15s">
      ${l.flag} ${l.code.toUpperCase()}
      <span id="bl-dot-${l.code}" style="display:none;width:6px;height:6px;background:#34d399;border-radius:50%;margin-left:5px;vertical-align:middle"></span>
    </button>`).join('');

  const langPanels = BLOG_LANGS.map((l, i) => `
    <div id="bl-panel-${l.code}" style="display:${i===0?'block':'none'};background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 8px 8px 8px;padding:16px">
      <div class="form-row">
        <div class="form-group form-full">
          <label>${l.flag} Titel (${l.label})</label>
          <input id="bl-title-${l.code}" placeholder="Titel auf ${l.label}\u2026" oninput="updateBlogDot('${l.code}')">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group form-full">
          <label>Auszug</label>
          <input id="bl-excerpt-${l.code}" placeholder="Kurze Vorschau\u2026">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group form-full">
          <label>Inhalt (HTML erlaubt)</label>
          <textarea id="bl-content-${l.code}" rows="7"
            style="font-family:'Space Mono',monospace;font-size:12px"
            placeholder="&lt;p&gt;Einleitung...&lt;/p&gt;\n&lt;h2&gt;Abschnitt&lt;/h2&gt;"></textarea>
        </div>
      </div>
      ${i === 0 ? `
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="bl-translate-btn" onclick="translateBlogWithAI()">\uD83E\uDD16 Alle \u00FCbersetzen (DE \u2192 EN / FR / ES / IT)</button>
        <span id="bl-translate-status" style="font-size:12px;color:var(--text3)"></span>
      </div>` : ''}
    </div>`).join('');

  const postLangMap = { de:'\uD83C\uDDE9\uD83C\uDDEA DE', en:'\uD83C\uDDEC\uD83C\uDDE7 EN', fr:'\uD83C\uDDEB\uD83C\uDDF7 FR', es:'\uD83C\uDDEA\uD83C\uDDF8 ES', it:'\uD83C\uDDEE\uD83C\uDDF9 IT' };

  panel.innerHTML = `
    <div class="form-card" style="margin-bottom:20px">
      <div class="form-card-title">\uD83D\uDCDD Neuen Blogpost erstellen \u2013 Mehrsprachig</div>

      <div class="form-row">
        <div class="form-group" style="max-width:320px">
          <label>Tags (komma-getrennt, f\u00FCr alle Sprachen)</label>
          <input id="bl-tags" placeholder="Psychologie, IRT, Traits">
        </div>
        <div class="form-group" style="max-width:190px">
          <label>Status (f\u00FCr alle Sprachen)</label>
          <select id="bl-status">
            <option value="draft">\uD83D\uDCDD Entwurf</option>
            <option value="published">\uD83C\uDF10 Sofort ver\u00F6ffentlichen</option>
          </select>
        </div>
        <div class="form-group" style="max-width:220px">
          <label>\u23F0 Zeitplan (optional)</label>
          <button id="bl-schedule-btn" class="btn btn-ghost" style="width:100%;justify-content:flex-start;font-size:13px" onclick="_openBlogScheduleModal()">\u23F0 Zeitplan w\u00e4hlen</button>
        </div>
      </div>

      <div style="margin-top:16px">
        <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">${langTabs}</div>
        ${langPanels}
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="submitBlogAllLangs('${siteId}')">
          \u2713 Alle ausgef\u00FCllten Sprachen erstellen
        </button>
        <span id="bl-submit-status" style="font-size:12px;color:var(--text3)"></span>
      </div>
    </div>

    <div class="actions-bar" style="margin-bottom:8px">
      <div style="font-size:13px;font-weight:700">Posts (${posts.length})
        <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:8px">${pubCount} ver\u00F6ffentlicht</span>
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" id="bl-analytics-btn" onclick="_blgToggleAnalytics('${siteId}')">📊 Analytics</button>
      <button class="btn btn-ghost btn-sm" id="bl-feedback-btn" onclick="_blgToggleFeedback('${siteId}')">👍 Feedback</button>
      <button class="btn btn-ghost btn-sm" onclick="_blgBulkSEO('${siteId}')" title="SEO für alle Posts ohne Keywords generieren">🔍 Bulk-SEO</button>
      <button class="btn btn-ghost btn-sm" onclick="_blgExportTxt('${siteId}')" title="Alle Posts als .txt ZIP für KeywordSystem exportieren">📥 TXT Export</button>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','blog')">\u21BB Aktualisieren</button>
    </div>

    <div id="bl-analytics-panel" style="display:none;margin-bottom:16px">
      <div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Lade Analytics\u2026</div>
    </div>

    <div id="bl-feedback-panel" style="display:none;margin-bottom:16px">
      ${_renderFeedbackTable(posts, feedback || [])}
    </div>

    ${posts.length ? _renderBlogPostList(posts, siteId) : emptyState('Noch keine Posts \u2013 erstelle den ersten Blogartikel!')}
  `;
}

window.switchBlogLang = function(code) {
  BLOG_LANGS.forEach(l => {
    const active = l.code === code;
    const p = document.getElementById(`bl-panel-${l.code}`);
    const t = document.getElementById(`bl-tab-${l.code}`);
    if (p) p.style.display = active ? 'block' : 'none';
    if (t) {
      t.style.background   = active ? 'var(--surface)' : 'transparent';
      t.style.color        = active ? 'var(--text1)'   : 'var(--text3)';
      t.style.border       = active ? '1px solid var(--border)' : '1px solid transparent';
      t.style.borderBottom = active ? '1px solid var(--surface)' : 'none';
    }
  });
};

window.updateBlogDot = function(code) {
  const has = !!document.getElementById(`bl-title-${code}`)?.value?.trim();
  const dot = document.getElementById(`bl-dot-${code}`);
  if (dot) dot.style.display = has ? 'inline-block' : 'none';
};

window.translateBlogWithAI = async function() {
  const title   = document.getElementById('bl-title-de')?.value?.trim();
  const excerpt = document.getElementById('bl-excerpt-de')?.value?.trim() || '';
  const content = document.getElementById('bl-content-de')?.value?.trim() || '';
  if (!title) { alert('Bitte zuerst den deutschen Titel ausf\u00FCllen.'); return; }

  let apiKey = localStorage.getItem('anthropic_api_key');
  if (!apiKey) {
    apiKey = prompt('Anthropic API Key eingeben (wird einmalig in localStorage gespeichert):');
    if (!apiKey?.trim()) return;
    localStorage.setItem('anthropic_api_key', apiKey.trim());
    apiKey = apiKey.trim();
  }

  const btn    = document.getElementById('bl-translate-btn');
  const status = document.getElementById('bl-translate-status');
  btn.disabled = true; btn.textContent = '\u23F3 Wird \u00FCbersetzt\u2026';
  status.textContent = ''; status.style.color = 'var(--text3)';

  try {
    const prompt = `Translate this blog post from German to English, French, Spanish, and Italian. Return ONLY raw JSON, no markdown, no explanation.\n\nGerman title: ${title}\nGerman excerpt: ${excerpt}\nGerman content: ${content}\n\nReturn exactly this JSON structure (preserve all HTML tags, translate naturally):\n{"en":{"title":"...","excerpt":"...","content":"..."},"fr":{"title":"...","excerpt":"...","content":"..."},"es":{"title":"...","excerpt":"...","content":"..."},"it":{"title":"...","excerpt":"...","content":"..."}}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const translations = JSON.parse(text);

    for (const lang of ['en', 'fr', 'es', 'it']) {
      const t = translations[lang]; if (!t) continue;
      const el = id => document.getElementById(`bl-${id}-${lang}`);
      if (el('title'))   el('title').value   = t.title   || '';
      if (el('excerpt')) el('excerpt').value = t.excerpt || '';
      if (el('content')) el('content').value = t.content || '';
      window.updateBlogDot(lang);
    }

    status.textContent = '\u2713 \u00DCbersetzungen eingef\u00FCgt!';
    status.style.color = '#34d399';
  } catch(e) {
    status.textContent = `Fehler: ${e.message}`;
    status.style.color = 'var(--red)';
    if (String(e.message).includes('401') || String(e.message).includes('auth')) {
      localStorage.removeItem('anthropic_api_key');
      status.textContent += ' \u2013 API Key gel\u00F6scht, bitte erneut versuchen.';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '\uD83E\uDD16 Alle \u00FCbersetzen (DE \u2192 EN / FR / ES)';
  }
};

window.submitBlogAllLangs = async function(siteId) {
  const tags         = document.getElementById('bl-tags')?.value?.trim() || '';
  const status       = document.getElementById('bl-status')?.value || 'draft';
  const publishAtISO = window._blgNewScheduleISO || null;
  const statusEl     = document.getElementById('bl-submit-status');

  const toPost = BLOG_LANGS.filter(l =>
    !!document.getElementById(`bl-title-${l.code}`)?.value?.trim()
  );
  if (!toPost.length) { alert('Mindestens eine Sprache muss einen Titel haben.'); return; }

  // Gemeinsame group_id für alle Sprach-Posts dieses Artikels
  const group_id = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  statusEl.textContent = `Erstelle ${toPost.length} Posts\u2026`;
  statusEl.style.color = 'var(--text3)';

  let done = 0;
  for (const l of toPost) {
    const title   = document.getElementById(`bl-title-${l.code}`)?.value?.trim();
    const excerpt = document.getElementById(`bl-excerpt-${l.code}`)?.value?.trim() || '';
    const content = document.getElementById(`bl-content-${l.code}`)?.value?.trim() || '';
    await api('/api/blog', {
      method: 'POST',
      body: { site_id: siteId, title, tags, excerpt, content, status, lang: l.code, group_id, publish_at: publishAtISO }
    });
    done++;
    statusEl.textContent = `${done}/${toPost.length} erstellt\u2026`;
  }

  if (status === 'published') {
    await api('/api/notifications', { method: 'POST', body: {
      site_id: siteId, type: 'info',
      title: `\uD83D\uDCDD Blog: ${done} Posts live`,
      message: `Ver\u00F6ffentlicht in: ${toPost.map(l => l.code.toUpperCase()).join(', ')}`
    }});
  }

  statusEl.textContent = `\u2713 ${done} Posts erstellt!`;
  statusEl.style.color = '#34d399';
  setTimeout(() => reloadPanel(siteId, 'blog'), 1200);
};

async function submitBlog(siteId) { await window.submitBlogAllLangs(siteId); }

async function toggleBlogPublish(id, newStatus, siteId) {
  await api(`/api/blog/${id}`, { method: 'PATCH', body: { status: newStatus } });
  if (newStatus === 'published') {
    const posts = await api(`/api/blog?site_id=${siteId}`);
    const post = posts?.find(p => p.id === id);
    if (post) {
      await api('/api/notifications', {
        method: 'POST',
        body: { site_id: siteId, type: 'info', title: `\uD83D\uDCDD Blog live: ${post.title}`, message: 'Ver\u00F6ffentlicht auf /blog' }
      });
    }
  }
  reloadPanel(siteId, 'blog');
}

async function deleteBlogPost(id, siteId) {
  if (!confirm('Blogpost wirklich l\u00F6schen?')) return;
  await api(`/api/blog/${id}`, { method: 'DELETE' });
  reloadPanel(siteId, 'blog');
}

window.openBlogEdit = async function(id, siteId) {
  const box = document.getElementById(`bl-edit-${id}`);
  if (!box) return;
  // Toggle: close if already open
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }

  box.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">L\u00E4dt\u2026</div>';
  box.style.display = 'block';

  const posts = await api(`/api/blog?site_id=${siteId}`);
  const p = posts?.find(x => x.id === id);
  if (!p) { box.innerHTML = '<div style="padding:12px;color:var(--red)">Fehler beim Laden.</div>'; return; }

  box.innerHTML = `
    <div style="margin-top:12px;padding:16px;background:var(--bg);border:1px solid var(--border);border-radius:10px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:12px">✏ Bearbeiten \u2013 ${esc(p.title)}</div>
      <div class="form-row">
        <div class="form-group form-full"><label>Titel</label>
          <input id="ble-title-${id}" value="${esc(p.title)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group" style="max-width:320px"><label>Tags</label>
          <input id="ble-tags-${id}" value="${esc(p.tags||'')}"></div>
        <div class="form-group" style="max-width:130px"><label>Sprache</label>
          <select id="ble-lang-${id}">
            ${['de','en','fr','es','it'].map(lc => `<option value="${lc}" ${(p.lang||'de')===lc?'selected':''}>${{de:'\uD83C\uDDE9\uD83C\uDDEA DE',en:'\uD83C\uDDEC\uD83C\uDDE7 EN',fr:'\uD83C\uDDEB\uD83C\uDDF7 FR',es:'\uD83C\uDDEA\uD83C\uDDF8 ES',it:'\uD83C\uDDEE\uD83C\uDDF9 IT'}[lc]}</option>`).join('')}
          </select></div>
        <div class="form-group" style="max-width:160px"><label>Status</label>
          <select id="ble-status-${id}">
            <option value="draft" ${p.status==='draft'?'selected':''}>\uD83D\uDCDD Entwurf</option>
            <option value="published" ${p.status==='published'?'selected':''}> \uD83C\uDF10 Ver\u00F6ffentlicht</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Auszug</label>
          <input id="ble-excerpt-${id}" value="${esc(p.excerpt||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group form-full"><label>Inhalt (HTML)</label>
          <textarea id="ble-content-${id}" rows="10"
            style="font-family:'Space Mono',monospace;font-size:12px">${esc(p.content||'')}</textarea></div>
      </div>
      <div style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.2);border-radius:8px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#c084fc">🔍 SEO-Vorschau</span>
          <span id="ble-seo-ts-${id}" style="font-size:10px;color:var(--text3);margin-left:auto">${p.seo_generated_at ? '⚡ ' + new Date(p.seo_generated_at).toLocaleDateString('de-DE') : '⚠️ Noch nicht generiert'}</span>
          <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 10px" onclick="_blgRegenSEO(${id},'${siteId}')">🔄 SEO neu generieren</button>
        </div>
        <div id="ble-seo-panel-${id}">
          ${p.meta_description ? `
          <div style="margin-bottom:8px">
            <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Meta-Description <span id="ble-seo-metalen-${id}" style="font-weight:400">(${(p.meta_description||'').length} Zeichen)</span></div>
            <div id="ble-seo-meta-${id}" style="font-size:12px;color:var(--text2);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.5">${esc(p.meta_description||'')}</div>
          </div>
          <div style="margin-bottom:8px">
            <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Keywords (${(p.meta_keywords||'').split(',').filter(Boolean).length})</div>
            <div id="ble-seo-kw-${id}" style="display:flex;flex-wrap:wrap;gap:4px">${(p.meta_keywords||'').split(',').filter(Boolean).map(k => '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(139,92,246,.15);color:#c084fc">' + esc(k.trim()) + '</span>').join('')}</div>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Long-Tail Keywords</div>
            <div id="ble-seo-lt-${id}" style="display:flex;flex-wrap:wrap;gap:4px">${(() => { try { return JSON.parse(p.longtail_keywords||'[]').map(k => '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(96,165,250,.1);color:#60a5fa">' + esc(k) + '</span>').join(''); } catch(e) { return '<span style="color:var(--text3);font-size:11px">–</span>'; } })()}</div>
          </div>` : '<div style="font-size:12px;color:var(--text3)">Noch keine SEO-Daten – klicke auf „🔄 SEO neu generieren".</div>'}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveBlogEdit(${id},'${siteId}')">\u2713 Speichern</button>
        <button class="btn btn-ghost" onclick="document.getElementById('bl-edit-${id}').style.display='none'">Abbrechen</button>
        <span id="ble-status-msg-${id}" style="font-size:12px;color:var(--text3)"></span>
      </div>
    </div>`;
};

window.saveBlogEdit = async function(id, siteId) {
  const g = s => document.getElementById(`ble-${s}-${id}`)?.value?.trim();
  const msg = document.getElementById(`ble-status-msg-${id}`);
  const title = g('title');
  if (!title) { alert('Titel ist erforderlich'); return; }

  msg.textContent = 'Speichert\u2026'; msg.style.color = 'var(--text3)';

  const res = await api(`/api/blog/${id}`, {
    method: 'PATCH',
    body: {
      title,
      tags:    g('tags'),
      lang:    document.getElementById(`ble-lang-${id}`)?.value,
      status:  document.getElementById(`ble-status-${id}`)?.value,
      excerpt: g('excerpt'),
      content: document.getElementById(`ble-content-${id}`)?.value,
    }
  });

  if (res?.success) {
    msg.textContent = '\u2713 Gespeichert!'; msg.style.color = '#34d399';
    setTimeout(() => reloadPanel(siteId, 'blog'), 900);
  } else {
    msg.textContent = 'Fehler beim Speichern.'; msg.style.color = 'var(--red)';
  }
};

window.setBlogLang = async function(id, siteId, lang) {
  await api(`/api/blog/${id}`, { method: 'PATCH', body: { lang } });
  reloadPanel(siteId, 'blog');
};

// ── SEO Regenerieren (einzelner Post) ────────────────────────────────────────
window._blgRegenSEO = async function(id, siteId) {
  const panel  = document.getElementById(`ble-seo-panel-${id}`);
  const tsEl   = document.getElementById(`ble-seo-ts-${id}`);
  if (panel) panel.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:4px 0">⏳ Generiert SEO…</div>';
  const res = await api(`/api/seo/regenerate/${id}`, { method: 'POST' });
  if (!res?.success || !res.seo) {
    if (panel) panel.innerHTML = '<div style="font-size:12px;color:var(--red)">❌ Fehler beim Generieren.</div>';
    return;
  }
  const seo = res.seo;
  if (tsEl) tsEl.textContent = '⚡ Gerade generiert';
  if (panel) {
    const kwHtml = seo.keywords.map(k =>
      '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(139,92,246,.15);color:#c084fc">' + esc(k) + '</span>'
    ).join('');
    const ltHtml = seo.longtailKeywords.map(k =>
      '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(96,165,250,.1);color:#60a5fa">' + esc(k) + '</span>'
    ).join('');
    panel.innerHTML = `
      <div style="margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Meta-Description (${seo.metaDescription.length} Zeichen)</div>
        <div style="font-size:12px;color:var(--text2);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;line-height:1.5">${esc(seo.metaDescription)}</div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Keywords (${seo.keywords.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${kwHtml}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Long-Tail Keywords</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${ltHtml || '<span style="color:var(--text3);font-size:11px">Keine (Text zu kurz für N-Gramme)</span>'}</div>
      </div>`;
  }
};

// ── SEO Bulk-Regenerierung (alle Posts ohne Keywords) ───────────────────────
window._blgBulkSEO = async function(siteId) {
  const posts = window._blgPostsCache || [];
  const missing = posts.filter(p => !p.meta_keywords || p.meta_keywords.trim() === '');
  if (missing.length === 0) {
    alert('\u2705 Alle Posts haben bereits SEO-Daten.');
    return;
  }
  if (!confirm(`SEO f\u00fcr ${missing.length} Post(s) ohne Keywords generieren?`)) return;

  const btn = document.querySelector('[onclick*="_blgBulkSEO"]');
  if (btn) { btn.disabled = true; btn.textContent = `\u23F3 0/${missing.length}\u2026`; }

  let done = 0;
  let failed = 0;
  for (const post of missing) {
    const res = await api(`/api/seo/regenerate/${post.id}`, { method: 'POST' }).catch(() => null);
    if (res?.success) done++; else failed++;
    if (btn) btn.textContent = `\u23F3 ${done}/${missing.length}\u2026`;
  }

  if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDD0D Bulk-SEO'; }
  alert(`\u2705 ${done} Posts aktualisiert${failed > 0 ? ` (${failed} Fehler)` : ''}.`);
  reloadPanel(siteId, 'blog');
};

// ── TXT Export für KeywordSystem ─────────────────────────────────────
window._blgExportTxt = async function(siteId) {
  const btn = document.querySelector('[onclick*="_blgExportTxt"]');
  if (btn) { btn.disabled = true; btn.textContent = '\u23F3 Lädt…'; }

  // JSZip dynamisch laden (nur einmal)
  if (!window.JSZip) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('JSZip konnte nicht geladen werden'));
      document.head.appendChild(s);
    }).catch(e => {
      alert('Fehler: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCE5 TXT Export'; }
      return;
    });
  }

  // Alle Posts laden (alle Sprachen)
  const posts = await api(`/api/blog?site_id=${siteId}`);
  if (!posts || posts.length === 0) {
    alert('Keine Posts gefunden.');
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCE5 TXT Export'; }
    return;
  }

  // HTML zu reinem Text
  function htmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')           // alle restlichen Tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')        // max 2 Leerzeilen
      .trim();
  }

  const zip  = new window.JSZip();
  const langs = ['de', 'en', 'fr', 'es', 'it'];

  // Ordner pro Sprache, Dateien nach Slug benennen
  for (const post of posts) {
    const lang   = post.lang || 'de';
    const slug   = (post.slug || `post-${post.id}`).slice(0, 60);
    const title  = htmlToText(post.title || '');
    const excerpt = htmlToText(post.excerpt || '');
    const content = htmlToText(post.content || '');

    // Aufbau der .txt Datei:
    // Zeile 1: Titel (extra Gewicht für KeywordSystem)
    // Zeile 2: Titel nochmal (Title-Bonus)
    // Leerzeile
    // Auszug
    // Leerzeile
    // Hauptinhalt
    const parts = [title, title];
    if (excerpt) parts.push('', excerpt);
    if (content) parts.push('', content);
    const txtContent = parts.join('\n');

    zip.folder(lang).file(`${slug}.txt`, txtContent);
  }

  // Auch alle Posts gemeinsam in einem 'alle/' Ordner (sprachgemischt, für themen-übergreifende Analyse)
  for (const post of posts) {
    const lang    = post.lang || 'de';
    const slug    = (post.slug || `post-${post.id}`).slice(0, 60);
    const title   = htmlToText(post.title || '');
    const excerpt = htmlToText(post.excerpt || '');
    const content = htmlToText(post.content || '');
    const parts   = [title, title];
    if (excerpt) parts.push('', excerpt);
    if (content) parts.push('', content);
    zip.folder('alle').file(`${lang}-${slug}.txt`, parts.join('\n'));
  }

  // README für den ZIP
  zip.file('README.txt',
    `KeywordSystem Export – ${siteId}\n` +
    `Exportiert: ${new Date().toLocaleString('de-DE')}\n` +
    `Posts: ${posts.length}\n\n` +
    `Ordnerstruktur:\n` +
    `  de/   – Deutsche Posts\n` +
    `  en/   – Englische Posts\n` +
    `  fr/   – Franz\u00f6sische Posts\n` +
    `  es/   – Spanische Posts\n` +
    `  it/   – Italienische Posts\n` +
    `  alle/ – Alle Posts gemischt (f\u00fcr Themen-Analyse)\n\n` +
    `Verwendung:\n` +
    `  Gew\u00fcnschten Ordner in KeywordSystem/texts/<thema>/ kopieren\n` +
    `  Dann: node analyze.mjs\n`
  );

  // ZIP generieren und herunterladen
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${siteId}-blog-posts-${new Date().toISOString().slice(0,10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDCE5 TXT Export'; }
};

// Tag-Gruppe in echte group_id-Gruppe umwandeln
window._blgFixGroup = async function(postIds, siteId) {
  var newGid = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  for (var i = 0; i < postIds.length; i++) {
    await api('/api/blog/' + postIds[i], { method: 'PATCH', body: { group_id: newGid } });
  }
  reloadPanel(siteId, 'blog');
};

// Geplante Veröffentlichung für eine Gruppe setzen – via Modal
window._blgScheduleGroup = function(postIds, siteId, currentISO) {
  _openScheduleModal({
    currentISO: currentISO || null,
    onConfirm: async function(iso) {
      for (var i = 0; i < postIds.length; i++) {
        await api('/api/blog/' + postIds[i], { method: 'PATCH', body: { status: 'draft', publish_at: iso } });
      }
      reloadPanel(siteId, 'blog');
    },
    onClear: async function() {
      for (var i = 0; i < postIds.length; i++) {
        await api('/api/blog/' + postIds[i], { method: 'PATCH', body: { publish_at: null } });
      }
      reloadPanel(siteId, 'blog');
    }
  });
};

// Gesamte Gruppe veröffentlichen / zu Entwurf machen
window._blgPublishGroup = async function(postIds, newStatus, siteId) {
  for (var i = 0; i < postIds.length; i++) {
    await api('/api/blog/' + postIds[i], { method: 'PATCH', body: { status: newStatus } });
  }
  reloadPanel(siteId, 'blog');
};

// Gesamte Gruppe löschen (alle Sprach-Versionen)
window._blgDeleteGroup = async function(postIds, siteId) {
  if (!confirm('Alle ' + postIds.length + ' Sprachversionen dieser Gruppe löschen?')) return;
  for (var i = 0; i < postIds.length; i++) {
    await api('/api/blog/' + postIds[i], { method: 'DELETE' });
  }
  reloadPanel(siteId, 'blog');
};

// ── WDT Wordlist-Validierung (erweitert die renderWortDesTages-Closures) ─────────────
window._wdtWordlists = window._wdtWordlists || {};

window._wdtLoadWordlist = async function(lang) {
  if (window._wdtWordlists[lang]) return window._wdtWordlists[lang];
  try {
    const res = await fetch('https://wordify.pages.dev/api/wordlist?lang=' + lang);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    window._wdtWordlists[lang] = new Set(arr);
    return window._wdtWordlists[lang];
  } catch(_) { return null; }
};

// Override _wdtPreview: live validation in preview panel
window._wdtPreviewValidated = function(lang) {
  const raw   = document.getElementById('wdt-bulk-' + lang);
  const startEl = document.getElementById('wdt-startdate-' + lang);
  const prev  = document.getElementById('wdt-preview-' + lang);
  if (!raw || !prev) return;
  const words = raw.value.split(/[\n,]+/).map(function(w){ return w.trim().toUpperCase(); }).filter(Boolean);
  const start = startEl && startEl.value;
  if (!words.length || !start) { prev.innerHTML = ''; return; }
  const wl = window._wdtWordlists[lang];
  const lines = [];
  var d = new Date(start + 'T12:00:00');
  words.slice(0, 14).forEach(function(w) {
    const badLen   = w.length !== 5;
    const usedAgain = !badLen && window._wdtUsedWords && window._wdtUsedWords[lang] && window._wdtUsedWords[lang].has(w);
    const notInWl  = !badLen && !usedAgain && wl && !wl.has(w);
    const color    = badLen ? '#f87171' : usedAgain ? '#f87171' : notInWl ? '#fbbf24' : 'var(--text2)';
    const badge    = badLen
      ? '<span style="font-size:9px;background:rgba(239,68,68,.2);color:#f87171;padding:1px 5px;border-radius:3px;margin-left:6px">✗ ' + w.length + ' Buchstaben</span>'
      : usedAgain
        ? '<span style="font-size:9px;background:rgba(239,68,68,.2);color:#f87171;padding:1px 5px;border-radius:3px;margin-left:6px">🔄 schon benutzt</span>'
      : notInWl
        ? '<span style="font-size:9px;background:rgba(251,191,36,.2);color:#fbbf24;padding:1px 5px;border-radius:3px;margin-left:6px">⚠ nicht in Liste</span>'
        : '<span style="font-size:9px;background:rgba(34,197,94,.2);color:#34d399;padding:1px 5px;border-radius:3px;margin-left:6px">✓</span>';
    lines.push('<div style="color:' + color + '">' + d.toISOString().slice(0,10) + '  →  ' + w + badge + '</div>');
    d.setDate(d.getDate() + 1);
  });
  if (words.length > 14) lines.push('<div style="color:var(--text3)">… +' + (words.length - 14) + ' weitere</div>');
  prev.innerHTML = lines.join('');
};

// Override _wdtSaveBulk: add validation before save
// Hilfsfunktion: lokales Datum als YYYY-MM-DD (kein UTC-Versatz)
function _wdtLocalDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

  window._wdtSaveBulkValidated = async function(lang, siteId) {
  const rawEl    = document.getElementById('wdt-bulk-' + lang);
  const startEl  = document.getElementById('wdt-startdate-' + lang);
  const statusEl = document.getElementById('wdt-status-' + lang);
  if (!rawEl || !startEl || !statusEl) return;
  const words = rawEl.value.split(/[\n,]+/).map(function(w){ return w.trim().toUpperCase(); }).filter(Boolean);
  const start = startEl.value;
  if (!words.length) { alert('Bitte mindestens ein Wort eingeben.'); return; }
  if (!start) { alert('Bitte Startdatum wählen.'); return; }

  // Validierung 1: 5 Buchstaben
  const wrongLen = words.filter(function(w){ return w.length !== 5; });
  if (wrongLen.length) {
    alert(wrongLen.length + ' Wort' + (wrongLen.length > 1 ? 'örter haben' : ' hat') +
      ' nicht genau 5 Buchstaben:\n\n' + wrongLen.slice(0, 10).join(', ') +
      (wrongLen.length > 10 ? ' …' : '') +
      '\n\nBitte korrigieren und erneut speichern.');
    return;
  }

  // Validierung 2: bereits als Wort des Tages verwendet?
  const usedSet = window._wdtUsedWords && window._wdtUsedWords[lang];
  if (usedSet) {
    const duplicates = words.filter(function(w){ return usedSet.has(w); });
    if (duplicates.length) {
      const formatted = duplicates.map(function(w){ return "'" + w + "'"; }).join(', ');
      const proceed = await new Promise(function(resolve) {
        var old = document.getElementById('_wdt-dup-modal');
        if (old) old.remove();
        const modal = document.createElement('div');
        modal.id = '_wdt-dup-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)';
        modal.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 28px;width:480px;max-width:calc(100vw - 40px);box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--text1)">🔄 ' + duplicates.length + ' Wort' + (duplicates.length > 1 ? 'örter wurden' : ' wurde') + ' bereits verwendet</div>' +
          '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Diese Wörter waren schon einmal Wort des Tages für ' + lang.toUpperCase() + ':</div>' +
          '<div style="position:relative;margin-bottom:18px">' +
            '<textarea id="_wdt-dup-txt" readonly rows="3" style="width:100%;font-family:\'Space Mono\',monospace;font-size:12px;background:var(--bg);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:10px 12px;color:#f87171;resize:vertical">' + formatted + '</textarea>' +
            '<button onclick="(function(){var t=document.getElementById(\'_wdt-dup-txt\');t.select();navigator.clipboard.writeText(t.value).then(function(){var b=document.getElementById(\'_wdt-dup-copy\');b.textContent=\'✓ Kopiert!\';b.style.color=\'#34d399\';setTimeout(function(){b.textContent=\'📋\';b.style.color=\'\';},2000);});})()" id="_wdt-dup-copy" class="btn btn-ghost btn-sm" style="position:absolute;top:8px;right:8px;font-size:11px">📋</button>' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="_wdt-dup-cancel" class="btn btn-ghost">Abbrechen</button>' +
            '<button id="_wdt-dup-proceed" class="btn btn-primary">Trotzdem speichern</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(modal);
        document.getElementById('_wdt-dup-cancel').onclick  = function(){ modal.remove(); resolve(false); };
        document.getElementById('_wdt-dup-proceed').onclick = function(){ modal.remove(); resolve(true); };
        modal.addEventListener('click', function(e){ if (e.target === modal){ modal.remove(); resolve(false); } });
      });
      if (!proceed) { statusEl.textContent = ''; return; }
    }
  }

  // Validierung 3: in Wortliste
  statusEl.textContent = 'Prüfe Wortliste…'; statusEl.style.color = 'var(--text3)';
  const wl = await window._wdtLoadWordlist(lang);
  if (wl) {
    const missing = words.filter(function(w){ return !wl.has(w); });
    if (missing.length) {
      // Modal mit Kopier-Funktion anzeigen
      const proceed = await new Promise(function(resolve) {
        var old = document.getElementById('_wdt-missing-modal');
        if (old) old.remove();
        const formatted = missing.map(function(w){ return "'" + w + "'"; }).join(', ');
        const modal = document.createElement('div');
        modal.id = '_wdt-missing-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)';
        modal.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 28px;width:520px;max-width:calc(100vw - 40px);box-shadow:0 20px 60px rgba(0,0,0,.5);max-height:80vh;overflow-y:auto">' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:6px;color:var(--text1)">⚠️ ' + missing.length + ' Wort' + (missing.length > 1 ? 'örter nicht' : ' nicht') + ' in der ' + lang.toUpperCase() + '-Liste</div>' +
          '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Diese Wörter können im Spiel nicht gelöst werden. Du kannst sie hier kopieren und in die <code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px">words/words_' + lang + '.js</code> Datei einfügen.</div>' +
          '<div style="position:relative;margin-bottom:16px">' +
            '<textarea id="_wdt-missing-txt" readonly rows="4" style="width:100%;font-family:\'Space Mono\',monospace;font-size:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text1);resize:vertical">' + formatted + '</textarea>' +
            '<button onclick="(function(){var t=document.getElementById(\'_wdt-missing-txt\');t.select();navigator.clipboard.writeText(t.value).then(function(){var b=document.getElementById(\'_wdt-copy-btn\');b.textContent=\'✓ Kopiert!\';b.style.color=\'#34d399\';setTimeout(function(){b.textContent=\'📋 Kopieren\';b.style.color=\'\';},2000);});})()" id="_wdt-copy-btn" class="btn btn-ghost btn-sm" style="position:absolute;top:8px;right:8px;font-size:11px">📋 Kopieren</button>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-bottom:18px;padding:8px 12px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:6px">' +
            '💡 In <code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px">words/words_' + lang + '.js</code> einfügen — alphabetisch einsortieren, dann git push.' +
          '</div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end">' +
            '<button id="_wdt-cancel-btn" class="btn btn-ghost">Abbrechen</button>' +
            '<button id="_wdt-proceed-btn" class="btn btn-primary">Trotzdem speichern</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(modal);
        document.getElementById('_wdt-cancel-btn').onclick  = function(){ modal.remove(); resolve(false); };
        document.getElementById('_wdt-proceed-btn').onclick = function(){ modal.remove(); resolve(true); };
        modal.addEventListener('click', function(e){ if (e.target === modal){ modal.remove(); resolve(false); } });
      });
      if (!proceed) { statusEl.textContent = ''; return; }
    }
  }

  statusEl.textContent = 'Speichert…'; statusEl.style.color = 'var(--text3)';
  var d = new Date(start + 'T12:00:00'); // Mittags statt Mitternacht → kein Timezone-Slip
  var saved = 0;
  for (var i = 0; i < words.length; i++) {
    const date = _wdtLocalDate(d);
    await api('/api/daily-words', { method: 'POST', body: { date: date, language: lang, word: words[i] } });
    saved++;
    statusEl.textContent = saved + '/' + words.length + ' gespeichert…';
    d.setDate(d.getDate() + 1);
  }
  statusEl.textContent = '✓ ' + saved + ' Wörter gespeichert!';
  statusEl.style.color = '#34d399';
  rawEl.value = '';
  const prevEl = document.getElementById('wdt-preview-' + lang);
  if (prevEl) prevEl.innerHTML = '';
  setTimeout(function(){ reloadPanel(siteId, 'wortdestages'); }, 1000);
};

// Patch oninput handlers nach render — called by renderWortDesTages after panel.innerHTML is set
window._wdtPatchHandlers = function(siteId) {
  ['de','en','fr','es','it'].forEach(function(lang) {
    const bulk  = document.getElementById('wdt-bulk-' + lang);
    const start = document.getElementById('wdt-startdate-' + lang);
    const btn   = document.querySelector('#wdt-panel-' + lang + ' .btn-primary');
    if (bulk)  bulk.oninput  = function(){ window._wdtPreviewValidated(lang); };
    if (start) start.oninput = function(){ window._wdtPreviewValidated(lang); };
    if (btn)   btn.onclick   = function(){ window._wdtSaveBulkValidated(lang, siteId); };
    // Preload wordlist silently
    window._wdtLoadWordlist(lang).then(function(){ window._wdtPreviewValidated(lang); });
  });
};
