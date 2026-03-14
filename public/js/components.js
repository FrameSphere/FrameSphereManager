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

// ── CHANGELOG (Öffentlich auf /changelog, verwaltet im HQ) ───────────────
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
          <input type="checkbox" id="cl-publish" style="width:16px;height:16px">
          Sofort veröffentlichen
        </label>
        <button class="btn btn-primary" onclick="submitChangelog('${siteId}')">Eintrag erstellen</button>
      </div>
    </div>

    <div class="actions-bar" style="margin-bottom:8px">
      <div style="font-size:13px;font-weight:700">Einträge (${entries.length})
        <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:8px">${entries.filter(e=>e.published).length} live</span>
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','changelog')">↻ Aktualisieren</button>
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
                <button class="btn btn-danger btn-sm"
                  onclick="deleteChangelog(${e.id}, '${siteId}')">× Löschen</button>
              </div>
            </div>
          </div>`;}).join('')}
      </div>` : emptyState('Noch keine Einträge – erstelle den ersten Changelog-Post!')}
  `;
}

async function submitChangelog(siteId) {
  const title   = document.getElementById('cl-title')?.value?.trim();
  const type    = document.getElementById('cl-type')?.value;
  const desc    = document.getElementById('cl-desc')?.value?.trim();
  const publish = document.getElementById('cl-publish')?.checked ? 1 : 0;
  if (!title) { alert('Titel ist erforderlich'); return; }
  await api('/api/changelog', {
    method: 'POST',
    body: { site_id: siteId, version: new Date().toISOString().slice(0,10), title, description: desc, type, published: publish }
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
var allIds = JSON.stringify(g.posts.map(function(p){return p.id;}));
var allLive = liveCount === total;
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

async function renderBlog(siteId, panel) {
  const posts = await api(`/api/blog?site_id=${siteId}`);
  if (!posts) { panel.innerHTML = errState(); return; }
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
            <option value="published">\uD83C\uDF10 Ver\u00F6ffentlichen</option>
          </select>
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
      <button class="btn btn-ghost btn-sm" onclick="reloadPanel('${siteId}','blog')">\u21BB Aktualisieren</button>
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
  const tags     = document.getElementById('bl-tags')?.value?.trim() || '';
  const status   = document.getElementById('bl-status')?.value || 'draft';
  const statusEl = document.getElementById('bl-submit-status');

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
      body: { site_id: siteId, title, tags, excerpt, content, status, lang: l.code, group_id }
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

// Tag-Gruppe in echte group_id-Gruppe umwandeln
window._blgFixGroup = async function(postIds, siteId) {
  var newGid = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  for (var i = 0; i < postIds.length; i++) {
    await api('/api/blog/' + postIds[i], { method: 'PATCH', body: { group_id: newGid } });
  }
  reloadPanel(siteId, 'blog');
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
