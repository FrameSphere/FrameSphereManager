// ── Utils ─────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '–';
  const date = new Date(d);
  return date.toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function emptyState(msg) {
  return `<div class="empty"><div class="emoji">📭</div>${msg}</div>`;
}

function errState() {
  return `<div class="empty"><div class="emoji">⚡</div>API nicht erreichbar</div>`;
}

function loadingState() {
  return `<div class="loading">Lade…</div>`;
}
