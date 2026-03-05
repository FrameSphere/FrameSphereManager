// ── Utils ─────────────────────────────────────────────────────────

// ── Lucide loader (auto-inject script once) ───────────────────────
(function () {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/lucide@0.263.1/dist/umd/lucide.min.js';
  s.onload = () => {
    lucide.createIcons();
    if (window._iconQueue) { window._iconQueue.forEach(fn => fn()); window._iconQueue = []; }
  };
  document.head.appendChild(s);
})();

// ── Lucide icon helper ───────────────────────────────────────────
function icon(name, size = 14, style = '') {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-flex;flex-shrink:0;vertical-align:-2px;${style}"></i>`;
}

function refreshIcons() {
  if (window.lucide) {
    requestAnimationFrame(() => lucide.createIcons());
  } else {
    (window._iconQueue = window._iconQueue || []).push(() => lucide.createIcons());
  }
}

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
  return `<div class="empty">${icon('inbox', 28, 'color:var(--text3);margin-bottom:8px')}<span>${msg}</span></div>`;
}

function errState() {
  return `<div class="empty">${icon('wifi-off', 28, 'color:var(--text3);margin-bottom:8px')}<span>API nicht erreichbar</span></div>`;
}

function loadingState() {
  return `<div class="loading">Lade…</div>`;
}
