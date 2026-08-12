// ── Utils ─────────────────────────────────────────────────────────

// ── Lucide icon helper ───────────────────────────────────────────
function icon(name, size = 14, style = '') {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-flex;flex-shrink:0;vertical-align:-2px;${style}"></i>`;
}

function refreshIcons() {
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
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

// ── Mini-Markdown → HTML (Reports, Berichte) ─────────────────────
function mdToHtml(md) {
  if (!md) return '<p style="color:var(--text3)">Kein Text vorhanden.</p>';
  let s = esc(md);
  // Codeblöcke ```
  s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.replace(/^\n/, '')}</code></pre>`);
  // Inline-Code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Überschriften
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>')
       .replace(/^## (.*)$/gm, '<h2>$1</h2>')
       .replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Listen
  s = s.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, m => m.includes('<ul>') ? m : `<ul>${m}</ul>`);
  // Absätze
  s = s.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return '';
    if (/^<(h[1-3]|ul|ol|pre|li)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return s;
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
