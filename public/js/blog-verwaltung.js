var BV_SITES = [
  { id: 'wordify',      name: 'Wordify',      color: '#22c55e' },
  { id: 'traitora',     name: 'Traitora',     color: '#8b5cf6' },
  { id: 'brawlmystery', name: 'BrawlMystery', color: '#f97316' },
];
var BV_BLOG_LANGS = [
  { code: 'de', flag: '🇩🇪', label: 'Deutsch'  },
  { code: 'en', flag: '🇬🇧', label: 'English'  },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'es', flag: '🇪🇸', label: 'Español'  },
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
];
var LANG_FLAGS     = { de:'🇩🇪', en:'🇬🇧', fr:'🇫🇷', es:'🇪🇸', it:'🇮🇹' };
var SEO_IGNORE_KEY = 'bv_seo_ignore_list';

var _bvSeoAuto      = true;
var _bvScheduleISO  = null;
var _bvActiveLang   = 'de';
var _bvEnabledLangs = { de:true, en:false, fr:false, es:false, it:false };
var _seoAllPosts    = [];
var _seoLoading     = false;
var _aiAllPosts     = [];
var _aiParsed       = [];

// Tinder state
var _tinderQueue   = [];
var _tinderIndex   = 0;
var _tinderKept    = 0;
var _tinderIgnored = 0;

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
(function() {
  injectLoginScreen();
  checkAuth(function() {
    initLayout(null);
    bvInitLangTabs();
    bvLoadRecentPosts();
    refreshIcons();
  });
  window.initAfterLogin = function() {
    initLayout(null);
    bvInitLangTabs();
    bvLoadRecentPosts();
    refreshIcons();
  };
})();

function bvShowTab(name, btn) {
  document.querySelectorAll('#bv-tabs .tab-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.tab-content-area .tab-panel').forEach(function(p){ p.classList.remove('active'); });
  var panel = document.getElementById('bvtab-' + name);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'seo-manager')   seoLoad();
  if (name === 'neuer-beitrag') bvLoadRecentPosts();
  refreshIcons();
}

// ─────────────────────────────────────────────────────────────
// Neuer Beitrag
// ─────────────────────────────────────────────────────────────
function bvInitLangTabs() {
  var tabsEl   = document.getElementById('bv-lang-tabs');
  var panelsEl = document.getElementById('bv-lang-panels');
  if (!tabsEl || !panelsEl) return;

  var tabsHtml = BV_BLOG_LANGS.map(function(l) {
    var active = l.code === 'de';
    return '<div id="bvt-tab-' + l.code + '" onclick="bvSwitchLang(\'' + l.code + '\')" style="' +
      'padding:7px 14px;cursor:pointer;font-size:13px;font-weight:600;border-radius:6px 6px 0 0;' +
      'display:flex;align-items:center;gap:6px;user-select:none;transition:all .15s;' +
      (active ? 'background:var(--surface);border:1px solid var(--border);border-bottom:1px solid var(--surface);color:var(--text1)' : 'color:var(--text3)') +
      '">' + l.flag + ' ' + l.code.toUpperCase() +
      '<span id="bvt-enable-' + l.code + '" onclick="event.stopPropagation();bvToggleLang(\'' + l.code + '\')" title="Sprache ein/aus" ' +
      'style="width:14px;height:14px;border-radius:3px;border:1px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.75;flex-shrink:0">' +
      (active ? '✓' : '') + '</span></div>';
  }).join('');
  tabsEl.innerHTML = tabsHtml;

  var panelsHtml = BV_BLOG_LANGS.map(function(l) {
    return '<div id="bvt-panel-' + l.code + '" style="display:' + (l.code==='de'?'block':'none') + ';' +
      'background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 6px 6px 6px;padding:16px">' +
      bvLangPanelHtml(l) + '</div>';
  }).join('');
  panelsEl.innerHTML = panelsHtml;
}

function bvLangPanelHtml(l) {
  return [
    '<div class="form-row">',
    '  <div class="form-group form-full">',
    '    <label>' + l.flag + ' Titel</label>',
    '    <input id="bv-title-' + l.code + '" placeholder="Titel auf ' + l.label + '…">',
    '  </div>',
    '</div>',
    '<div class="form-row">',
    '  <div class="form-group form-full">',
    '    <label>Excerpt / Teaser</label>',
    '    <textarea id="bv-excerpt-' + l.code + '" rows="2" placeholder="Kurze Zusammenfassung…"></textarea>',
    '  </div>',
    '</div>',
    '<div class="form-row">',
    '  <div class="form-group form-full">',
    '    <label>Inhalt <span style="color:var(--text3);font-weight:400">(HTML erlaubt)</span></label>',
    '    <textarea id="bv-content-' + l.code + '" rows="10" placeholder="&lt;p&gt;Inhalt hier…&lt;/p&gt;" style="font-family:\'Space Mono\',monospace;font-size:12px"></textarea>',
    '  </div>',
    '</div>',
  ].join('');
}

function bvSwitchLang(code) {
  _bvActiveLang = code;
  BV_BLOG_LANGS.forEach(function(l) {
    var tab   = document.getElementById('bvt-tab-'   + l.code);
    var panel = document.getElementById('bvt-panel-' + l.code);
    var active = l.code === code;
    if (panel) panel.style.display = active ? 'block' : 'none';
    if (tab) {
      tab.style.background   = active ? 'var(--surface)' : 'transparent';
      tab.style.color        = active ? 'var(--text1)'   : (_bvEnabledLangs[l.code] ? 'var(--text2)' : 'var(--text3)');
      tab.style.border       = active ? '1px solid var(--border)' : 'none';
      tab.style.borderBottom = active ? '1px solid var(--surface)' : 'none';
    }
  });
}

function bvToggleLang(code) {
  if (code === 'de') return;
  _bvEnabledLangs[code] = !_bvEnabledLangs[code];
  var enableEl = document.getElementById('bvt-enable-' + code);
  var tab      = document.getElementById('bvt-tab-'    + code);
  if (enableEl) enableEl.textContent = _bvEnabledLangs[code] ? '✓' : '';
  if (tab && code !== _bvActiveLang) {
    tab.style.opacity = _bvEnabledLangs[code] ? '1' : '.45';
    tab.style.color   = _bvEnabledLangs[code] ? 'var(--text2)' : 'var(--text3)';
  }
}

function bvSiteChanged() {
  var sel = document.getElementById('bv-site');
  if (sel) sel.style.borderColor = sel.value ? 'rgba(245,158,11,.4)' : 'rgba(239,68,68,.5)';
}

function bvToggleSeoAuto() {
  _bvSeoAuto = !_bvSeoAuto;
  var ind = document.getElementById('bv-seo-auto-indicator');
  var btn = document.getElementById('bv-seo-auto-btn');
  if (ind) ind.style.background = _bvSeoAuto ? '#34d399' : '#f87171';
  if (btn) btn.style.color = _bvSeoAuto ? '' : '#f87171';
}

function bvOpenSchedule() {
  _openScheduleModal({
    currentISO: _bvScheduleISO,
    onConfirm: function(iso) {
      _bvScheduleISO = iso;
      var btn = document.getElementById('bv-schedule-btn');
      var d = new Date(iso);
      if (btn) { btn.textContent = '⏰ ' + d.toLocaleString('de-DE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); btn.style.color='#fbbf24'; }
    },
    onClear: function() {
      _bvScheduleISO = null;
      var btn = document.getElementById('bv-schedule-btn');
      if (btn) { btn.textContent = '⏰ Zeitplan'; btn.style.color=''; }
    }
  });
}

async function bvSubmit() {
  var siteId = document.getElementById('bv-site').value;
  if (!siteId) {
    document.getElementById('bv-site').style.borderColor = 'rgba(239,68,68,.5)';
    document.getElementById('bv-status').textContent = '✕ Bitte eine Seite auswählen!';
    document.getElementById('bv-status').style.color = '#f87171';
    return;
  }
  var langs = BV_BLOG_LANGS.filter(function(l) {
    return _bvEnabledLangs[l.code] && ((document.getElementById('bv-title-' + l.code)||{}).value||'').trim();
  });
  if (!langs.length) {
    document.getElementById('bv-status').textContent = '✕ Mindestens DE-Titel benötigt.';
    document.getElementById('bv-status').style.color = '#f87171';
    return;
  }

  var tags      = document.getElementById('bv-tags').value.trim();
  var groupId   = document.getElementById('bv-group').value.trim() || ('grp-' + Date.now() + '-' + Math.random().toString(36).slice(2,6));
  var published = document.getElementById('bv-publish').checked ? 1 : 0;
  var publishAt = _bvScheduleISO || null;
  var statusEl  = document.getElementById('bv-status');

  statusEl.textContent = 'Erstelle ' + langs.length + ' Version(en)…';
  statusEl.style.color = 'var(--text3)';

  var createdIds = [];
  for (var i = 0; i < langs.length; i++) {
    var l       = langs[i];
    var title   = document.getElementById('bv-title-'   + l.code).value.trim();
    var slug    = title.toLowerCase()
      .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
      .replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
    var excerpt = document.getElementById('bv-excerpt-' + l.code).value.trim();
    var content = document.getElementById('bv-content-' + l.code).value.trim();

    var body = {
      site_id: siteId, lang: l.code, title: title, slug: slug,
      excerpt: excerpt, content: content, tags: tags, group_id: groupId,
      status: published ? 'published' : 'draft',
      publish_at: publishAt,
    };

    var res = await api('/api/blog', { method: 'POST', body: body });
    if (res && (res.id || res.post_id)) createdIds.push(res.id || res.post_id);
    statusEl.textContent = (i+1) + '/' + langs.length + ' erstellt…';
  }

  if (_bvSeoAuto && createdIds.length) {
    statusEl.textContent = 'Generiere SEO-Keywords…';
    var seoOk = 0;
    for (var j = 0; j < createdIds.length; j++) {
      if (!createdIds[j]) continue;
      var r = await api('/api/seo/regenerate/' + createdIds[j], { method: 'POST' }).catch(function(){ return null; });
      if (r && r.success) seoOk++;
    }
    statusEl.textContent = '✓ ' + langs.length + ' Version(en) · ' + seoOk + '/' + createdIds.length + ' SEO generiert';
  } else {
    statusEl.textContent = '✓ ' + langs.length + ' Sprachversion(en) erstellt!';
  }
  statusEl.style.color = '#34d399';

  BV_BLOG_LANGS.forEach(function(l) {
    ['bv-title-','bv-excerpt-','bv-content-'].forEach(function(pre) {
      var el = document.getElementById(pre + l.code);
      if (el) el.value = '';
    });
  });
  document.getElementById('bv-tags').value  = '';
  document.getElementById('bv-group').value = '';
  document.getElementById('bv-publish').checked = false;
  _bvScheduleISO = null;
  var sbtn = document.getElementById('bv-schedule-btn');
  if (sbtn) { sbtn.textContent='⏰ Zeitplan'; sbtn.style.color=''; }

  setTimeout(function(){ statusEl.textContent=''; bvLoadRecentPosts(); }, 3500);
}

async function bvLoadRecentPosts() {
  var container = document.getElementById('bv-recent-posts');
  if (!container) return;
  container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Lade…</div>';

  var filterSite = (document.getElementById('bv-filter-site')||{}).value || '';
  var sites      = filterSite ? [filterSite] : BV_SITES.map(function(s){ return s.id; });
  var siteMap    = {};
  BV_SITES.forEach(function(s){ siteMap[s.id] = s; });

  var allPosts = [];
  for (var i = 0; i < sites.length; i++) {
    var posts = await api('/api/blog?site_id=' + sites[i]);
    if (posts && posts.length) {
      posts.forEach(function(p){ p._siteId = sites[i]; });
      allPosts = allPosts.concat(posts);
    }
  }
  if (!allPosts.length) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">Keine Beiträge gefunden.</div>';
    return;
  }
  allPosts.sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); });
  allPosts = allPosts.slice(0, 40);

  var html = '<div style="display:flex;flex-direction:column;gap:5px">';
  allPosts.forEach(function(p) {
    var site   = siteMap[p._siteId] || {};
    var col    = site.color || '#888';
    var isLive = p.status === 'published';
    var hasSeo = p.meta_keywords && (Array.isArray(p.meta_keywords) ? p.meta_keywords.length > 0 : (p.meta_keywords||'').trim());
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 14px;display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;background:' + col + '20;color:' + col + ';flex-shrink:0">' + (site.name||p._siteId) + '</span>';
    html += '<span style="font-size:13px">' + (LANG_FLAGS[p.lang]||p.lang) + '</span>';
    html += '<span style="flex:1;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title||'(kein Titel)') + '</span>';
    html += '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:' + (isLive?'rgba(52,211,153,.15)':'rgba(255,255,255,.06)') + ';color:' + (isLive?'#34d399':'var(--text3)') + '">' + (isLive?'✓ Live':'Entwurf') + '</span>';
    html += '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:' + (hasSeo?'rgba(139,92,246,.12)':'rgba(251,191,36,.08)') + ';color:' + (hasSeo?'#c084fc':'#fbbf24') + '">' + (hasSeo?'🔍 SEO':'⚠ kein SEO') + '</span>';
    html += '<span class="mono" style="font-size:10px;color:var(--text3);flex-shrink:0">' + fmtDate(p.created_at) + '</span>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// SEO Manager – Hilfsfunktionen
// ─────────────────────────────────────────────────────────────
function seoGetIgnoreList() {
  try { return JSON.parse(localStorage.getItem(SEO_IGNORE_KEY) || '[]'); } catch(e) { return []; }
}
function seoSaveIgnoreList(list) {
  localStorage.setItem(SEO_IGNORE_KEY, JSON.stringify(list));
}

// Normalisiert meta_keywords (Array, JSON-String oder komma-String) → String-Array
function _parseKwField(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(function(k){ return String(k).trim(); }).filter(Boolean);
  var s = String(raw).trim();
  if (!s) return [];
  if (s.charAt(0) === '[') {
    try { return JSON.parse(s).map(function(k){ return String(k).trim(); }).filter(Boolean); } catch(e) {}
  }
  return s.split(',').map(function(k){ return k.trim(); }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// SEO Load & Filter
// ─────────────────────────────────────────────────────────────
async function seoLoad() {
  if (_seoLoading) return;
  _seoLoading = true;
  var filterSite = (document.getElementById('seo-filter-site')||{}).value || '';
  var sites = filterSite ? [filterSite] : BV_SITES.map(function(s){ return s.id; });
  _seoAllPosts = [];
  for (var i = 0; i < sites.length; i++) {
    var posts = await api('/api/blog?site_id=' + sites[i]);
    if (posts && posts.length) {
      posts.forEach(function(p){ p._siteId = sites[i]; });
      _seoAllPosts = _seoAllPosts.concat(posts);
    }
  }
  _seoLoading = false;
  seoApplyFilter();
  seoRenderIgnored();
  seoRenderPostsTab();
}

function seoApplyFilter() {
  if (!_seoAllPosts.length && !_seoLoading) { seoLoad(); return; }

  var langFilter = (document.getElementById('seo-filter-lang')||{}).value || '';
  var search     = ((document.getElementById('seo-search')||{}).value||'').toLowerCase().trim();
  var sortBy     = (document.getElementById('seo-sort')||{}).value || 'freq';
  var posts      = _seoAllPosts;
  if (langFilter) posts = posts.filter(function(p){ return (p.lang || 'de') === langFilter; });

  var kwMap = {};
  posts.forEach(function(p) {
    _parseKwField(p.meta_keywords).forEach(function(kw) {
      kw = kw.toLowerCase();
      if (!kw) return;
      if (!kwMap[kw]) kwMap[kw] = { kw: kw, count: 0, sites: {}, isLongtail: kw.indexOf(' ') >= 0 };
      kwMap[kw].count++;
      kwMap[kw].sites[p._siteId] = true;
    });
  });

  var ignoreList = seoGetIgnoreList();
  var allKws     = Object.values(kwMap);
  if (search) allKws = allKws.filter(function(k){ return k.kw.indexOf(search) >= 0; });

  if (sortBy === 'az')        allKws.sort(function(a,b){ return a.kw.localeCompare(b.kw); });
  else if (sortBy === 'site') allKws.sort(function(a,b){ return Object.keys(b.sites).length - Object.keys(a.sites).length; });
  else allKws.sort(function(a,b){ return b.count - a.count; });

  var postsWithSeo = posts.filter(function(p){
    return p.meta_keywords && (_parseKwField(p.meta_keywords).length > 0);
  }).length;
  var longtailCount  = allKws.filter(function(k){ return k.isLongtail; }).length;
  var ignoredInView  = allKws.filter(function(k){ return ignoreList.indexOf(k.kw) >= 0; }).length;

  // KPI-Stats
  var statsEl = document.getElementById('seo-stats-row');
  if (statsEl) {
    statsEl.innerHTML = [
      { label:'Posts',           val: posts.length,               col:'var(--text1)' },
      { label:'Mit SEO',         val: postsWithSeo,               col:'#34d399' },
      { label:'Ohne SEO',        val: posts.length - postsWithSeo, col:'#f87171' },
      { label:'Keywords',        val: allKws.length,              col:'#a5b4fc' },
      { label:'Longtail 🏆',     val: longtailCount,              col:'#fbbf24' },
      { label:'Ignoriert',       val: ignoredInView,              col:'#f87171' },
    ].map(function(s){
      return '<div class="kpi-card"><div class="kpi-label">' + s.label + '</div><div class="kpi-value" style="color:' + s.col + '">' + s.val + '</div></div>';
    }).join('');
  }

  var gridEl = document.getElementById('seo-kw-grid');
  if (gridEl) {
    if (!allKws.length) {
      gridEl.innerHTML = _seoAllPosts.length
        ? '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine Keywords für diesen Filter.</div>'
        : '<div style="color:var(--text3);font-size:12px;padding:12px 0">Lade Daten…</div>';
    } else {
      var maxCount = Math.max.apply(null, allKws.map(function(k){ return k.count; })) || 1;
      // ALLE anzeigen, kein Limit
      gridEl.innerHTML = allKws.map(function(k) {
        var isIgnExact = ignoreList.indexOf(k.kw) >= 0;
        // Longtail: enthält ein ignoriertes Wort (aber nicht exakt in der Liste)?
        var hasIgnWord = !isIgnExact && k.isLongtail && ignoreList.some(function(iw){
          return k.kw.split(' ').indexOf(iw) >= 0;
        });

        var size = Math.round(10 + (k.count / maxCount) * 6);
        var bg, col, brd;
        if (isIgnExact) {
          bg='rgba(239,68,68,.1)'; col='#f87171'; brd='rgba(239,68,68,.25)';
        } else if (hasIgnWord) {
          // Longtail enthält ignorierten Einzelbegriff → orange Warnung, aber NICHT als ignoriert markiert
          bg='rgba(251,146,60,.1)'; col='#fb923c'; brd='rgba(251,146,60,.25)';
        } else if (k.isLongtail) {
          bg='rgba(251,191,36,.1)'; col='#fbbf24'; brd='rgba(251,191,36,.25)';
        } else {
          bg='rgba(165,180,252,.08)'; col='#a5b4fc'; brd='rgba(165,180,252,.2)';
        }

        var siteNames = Object.keys(k.sites).join(', ');
        var title = k.count + 'x · ' + siteNames +
          (k.isLongtail ? ' · 🏆 Longtail' : '') +
          (hasIgnWord ? ' · ⚠ enthält ignorierten Begriff (Longtail trotzdem ok)' : '') +
          (isIgnExact ? ' · 🚫 Ignoriert' : '') +
          ' · Klick = ' + (isIgnExact ? 'aus Ignore entfernen' : 'ignorieren');

        return '<span title="' + title + '" ' +
          'style="font-size:' + size + 'px;padding:3px 9px;border-radius:20px;cursor:pointer;' +
          'background:' + bg + ';color:' + col + ';border:1px solid ' + brd + ';transition:all .15s" ' +
          'onclick="seoKwToggleIgnore(\'' + k.kw.replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\')">' +
          esc(k.kw) + (k.count > 1 ? ' <span style="font-size:9px;opacity:.6">×' + k.count + '</span>' : '') +
          '</span>';
      }).join('');
    }
  }

  seoRenderPostsTab();
}

window.seoKwToggleIgnore = function(kw) {
  var list  = seoGetIgnoreList();
  var lower = kw.toLowerCase();
  var idx   = list.indexOf(lower);
  if (idx >= 0) { list.splice(idx,1); seoSaveIgnoreList(list); seoShowToast('🔓 "' + kw + '" aus Ignore entfernt', '#34d399'); }
  else           { list.push(lower);  seoSaveIgnoreList(list); seoShowToast('🚫 "' + kw + '" ignoriert', '#fbbf24'); }
  seoApplyFilter(); seoRenderIgnored();
};

// ─────────────────────────────────────────────────────────────
// Post-Keywords Tab
// ─────────────────────────────────────────────────────────────
function seoRenderPostsTab() {
  var el = document.getElementById('seo-posts-table');
  if (!el) return;

  var langFilter = (document.getElementById('seo-filter-lang')||{}).value || '';
  var ignoreList = seoGetIgnoreList();
  var siteMap    = {}; BV_SITES.forEach(function(s){ siteMap[s.id] = s; });

  var posts = _seoAllPosts.slice();
  if (langFilter) posts = posts.filter(function(p){ return (p.lang||'de') === langFilter; });

  // Posts mit SEO zuerst
  posts.sort(function(a,b){
    var aKws = _parseKwField(a.meta_keywords);
    var bKws = _parseKwField(b.meta_keywords);
    return (bKws.length > 0 ? 1 : 0) - (aKws.length > 0 ? 1 : 0);
  });

  if (!posts.length) {
    el.innerHTML = _seoAllPosts.length
      ? '<div style="color:var(--text3);font-size:12px;padding:20px 0">Keine Posts für diesen Filter.</div>'
      : '<div style="color:var(--text3);font-size:12px;padding:20px 0">Lade…</div>';
    return;
  }

  var html = '<div style="display:flex;flex-direction:column;gap:8px">';
  posts.forEach(function(p) {
    var kws  = _parseKwField(p.meta_keywords);
    var site = siteMap[p._siteId] || {};
    var col  = site.color || '#888';

    // Trennung: Longtail (Leerzeichen) und Einzelwörter
    var longtails   = kws.filter(function(k){ return k.indexOf(' ') >= 0; });
    var singleWords = kws.filter(function(k){ return k.indexOf(' ') < 0; });

    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:12px 14px">';

    // Header
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
    html +=   '<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;background:' + col + '20;color:' + col + '">' + esc(site.name||p._siteId) + '</span>';
    html +=   '<span style="font-size:13px">' + (LANG_FLAGS[p.lang]||p.lang) + '</span>';
    html +=   '<span style="font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title||'(kein Titel)') + '</span>';
    html +=   '<button onclick="seoRegenPost(' + p.id + ',this)" class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 8px;flex-shrink:0">🔄 SEO neu</button>';
    html += '</div>';

    if (!kws.length) {
      html += '<div style="font-size:11px;color:#fbbf24;margin-bottom:4px">⚠ Keine Keywords</div>';
    } else {
      // Longtail-Keywords (gold)
      if (longtails.length > 0) {
        html += '<div style="font-size:10px;font-weight:700;color:#fbbf24;margin-bottom:5px;letter-spacing:.04em">🏆 LONGTAIL (' + longtails.length + ')</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">';
        longtails.forEach(function(kw) {
          var isIgnExact = ignoreList.indexOf(kw.toLowerCase()) >= 0;
          // Longtail: enthält ein ignoriertes Wort aber selbst nicht in der Ignore-Liste?
          var hasIgnWord = !isIgnExact && ignoreList.some(function(iw){ return kw.toLowerCase().split(' ').indexOf(iw) >= 0; });
          var bg, col2, brd;
          if (isIgnExact) {
            bg='rgba(239,68,68,.12)'; col2='#f87171'; brd='rgba(239,68,68,.25)';
          } else if (hasIgnWord) {
            // Orange: enthält ignorierten Begriff, aber Longtail-Phrase ist trotzdem ok
            bg='rgba(251,146,60,.12)'; col2='#fb923c'; brd='rgba(251,146,60,.25)';
          } else {
            bg='rgba(251,191,36,.12)'; col2='#fbbf24'; brd='rgba(251,191,36,.25)';
          }
          var tip = isIgnExact ? 'Exakt ignoriert' : (hasIgnWord ? 'Enthält ignorierten Begriff – Longtail aber trotzdem ok!' : 'Longtail 🏆');
          html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;padding:2px 9px;border-radius:4px;background:' + bg + ';color:' + col2 + ';border:1px solid ' + brd + '" title="' + tip + '">' +
            esc(kw) +
            '<button onclick="seoRemoveKeyword(' + p.id + ',\'' + esc(kw).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\',this)" ' +
            'title="Entfernen" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;padding:0;margin-left:2px;opacity:.55;line-height:1">×</button>' +
            '</span>';
        });
        html += '</div>';
      }

      // Einzelwörter (lila / rot wenn ignoriert)
      if (singleWords.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
        singleWords.forEach(function(kw) {
          var isIgn = ignoreList.indexOf(kw.toLowerCase()) >= 0;
          html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;padding:2px 8px;border-radius:4px;background:' +
            (isIgn?'rgba(239,68,68,.12)':'rgba(139,92,246,.12)') +
            ';color:' + (isIgn?'#f87171':'#c084fc') +
            ';border:1px solid ' + (isIgn?'rgba(239,68,68,.25)':'rgba(139,92,246,.25)') + '" ' +
            'title="' + (isIgn?'Ignoriert – wird rot markiert':'Einzelwort') + '">' +
            esc(kw) +
            '<button onclick="seoRemoveKeyword(' + p.id + ',\'' + esc(kw).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\',this)" ' +
            'title="Entfernen (+ zu Ignore)" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;padding:0;margin-left:2px;opacity:.55;line-height:1">×</button>' +
            '</span>';
        });
        html += '</div>';
      }
    }

    if (p.meta_description) {
      html += '<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px">' + esc(p.meta_description.slice(0,140)) + (p.meta_description.length>140?'…':'') + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

window.seoRemoveKeyword = async function(postId, kw, btn) {
  var post = _seoAllPosts.find(function(p){ return p.id === postId; });
  if (!post) return;

  var kws     = _parseKwField(post.meta_keywords);
  var updated = kws.filter(function(k){ return k.toLowerCase() !== kw.toLowerCase(); });
  btn.disabled = true;
  var res = await api('/api/blog/' + postId, { method: 'PATCH', body: { meta_keywords: updated } });
  if (res && res.success !== false) {
    post.meta_keywords = updated;
    var isLongtail = kw.trim().indexOf(' ') >= 0;
    if (!isLongtail) {
      // Einzelwort entfernen → automatisch zur Ignore-Liste
      var ignoreList = seoGetIgnoreList();
      var lower = kw.trim().toLowerCase();
      if (ignoreList.indexOf(lower) < 0) {
        ignoreList.push(lower);
        seoSaveIgnoreList(ignoreList);
        seoShowToast('"' + kw + '" entfernt + ignoriert 🚫', '#fbbf24');
      } else {
        seoShowToast('"' + kw + '" entfernt', '#34d399');
      }
    } else {
      // Longtail entfernen → nur entfernen, NICHT ignorieren
      seoShowToast('🏆 Longtail "' + kw + '" entfernt (nicht ignoriert)', '#34d399');
    }
    seoApplyFilter(); seoRenderPostsTab(); seoRenderIgnored();
  } else { btn.disabled = false; }
};

window.seoRegenPost = async function(postId, btn) {
  var orig = btn.textContent; btn.disabled = true; btn.textContent = '⏳';
  var res = await api('/api/seo/regenerate/' + postId, { method: 'POST' }).catch(function(){ return null; });
  if (res && res.success) {
    var post = _seoAllPosts.find(function(p){ return p.id === postId; });
    if (post && res.seo) {
      if (res.seo.metaDescription) post.meta_description = res.seo.metaDescription;
      if (res.seo.metaKeywords)    post.meta_keywords    = res.seo.metaKeywords;
    }
    btn.textContent = '✓'; btn.style.color = '#34d399';
    setTimeout(function(){ btn.textContent=orig; btn.style.color=''; btn.disabled=false; seoApplyFilter(); seoRenderPostsTab(); }, 1500);
  } else {
    btn.textContent = '✗'; btn.style.color = '#f87171';
    setTimeout(function(){ btn.textContent=orig; btn.style.color=''; btn.disabled=false; }, 1500);
  }
};

// ─────────────────────────────────────────────────────────────
// Sub-Tab Switcher
// ─────────────────────────────────────────────────────────────
function seoSubTab(name, btn) {
  ['overview','posts','tinder','ignored','ai'].forEach(function(n) {
    var el = document.getElementById('seotab-' + n);
    var b  = document.getElementById('seotab-btn-' + n);
    if (el) el.style.display = (n === name) ? '' : 'none';
    if (b)  b.classList.toggle('active', n === name);
  });
  if (name === 'ignored') seoRenderIgnored();
  if (name === 'posts')   seoRenderPostsTab();
  if (name === 'tinder')  tinderInit();
}

// ─────────────────────────────────────────────────────────────
// 🃏 Tinder – Schnell-Review
// ─────────────────────────────────────────────────────────────
function tinderInit() {
  var root = document.getElementById('tinder-root');
  if (!root) return;

  if (!_seoAllPosts.length) {
    root.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Noch keine Daten geladen – wechsle erst zur Übersicht und lade die Posts.</div>';
    return;
  }

  // Alle Keywords sammeln
  var ignoreList = seoGetIgnoreList();
  var kwMap = {};
  _seoAllPosts.forEach(function(p) {
    _parseKwField(p.meta_keywords).forEach(function(kw) {
      var lower = kw.toLowerCase().trim();
      if (!lower) return;
      if (!kwMap[lower]) kwMap[lower] = { kw: lower, count: 0, sites: {}, isLongtail: lower.indexOf(' ') >= 0, posts: [] };
      kwMap[lower].count++;
      kwMap[lower].sites[p._siteId] = true;
      if (kwMap[lower].posts.indexOf(p.title) < 0) kwMap[lower].posts.push(p.title);
    });
  });

  // Sortierung: noch nicht bewertet zuerst, dann nach Häufigkeit
  _tinderQueue = Object.values(kwMap).sort(function(a,b){ return b.count - a.count; });
  _tinderIndex   = 0;
  _tinderKept    = 0;
  _tinderIgnored = 0;

  tinderRender();
}

function tinderRender() {
  var root = document.getElementById('tinder-root');
  if (!root) return;

  var total = _tinderQueue.length;
  if (!total) {
    root.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Keine Keywords vorhanden.</div>';
    return;
  }

  // Fertig
  if (_tinderIndex >= total) {
    root.innerHTML =
      '<div style="text-align:center;padding:48px 24px">' +
      '<div style="font-size:48px;margin-bottom:16px">🎉</div>' +
      '<div style="font-size:18px;font-weight:800;color:var(--text1);margin-bottom:10px">Review abgeschlossen!</div>' +
      '<div style="font-size:14px;color:var(--text2);margin-bottom:20px">' +
      '<span style="color:#34d399">✓ ' + _tinderKept + ' behalten</span> &nbsp;·&nbsp; ' +
      '<span style="color:#f87171">🚫 ' + _tinderIgnored + ' ignoriert</span>' +
      '</div>' +
      '<button class="btn btn-primary" onclick="tinderInit()">↻ Neu starten</button>' +
      '</div>';
    seoRenderIgnored();
    seoApplyFilter();
    return;
  }

  var ignoreList = seoGetIgnoreList();
  var item = _tinderQueue[_tinderIndex];
  var isIgnExact = ignoreList.indexOf(item.kw) >= 0;
  var hasIgnWord = !isIgnExact && item.isLongtail && ignoreList.some(function(iw){
    return item.kw.split(' ').indexOf(iw) >= 0;
  });
  var siteNames = Object.keys(item.sites).map(function(id){
    var s = BV_SITES.find(function(x){ return x.id === id; });
    return s ? s.name : id;
  }).join(', ');

  var kwColor, kwBg, kwTag;
  if (isIgnExact) {
    kwColor='#f87171'; kwBg='rgba(239,68,68,.12)'; kwTag='🚫 Ignoriert';
  } else if (hasIgnWord) {
    kwColor='#fb923c'; kwBg='rgba(251,146,60,.12)'; kwTag='⚠ Enthält ignorierten Begriff';
  } else if (item.isLongtail) {
    kwColor='#fbbf24'; kwBg='rgba(251,191,36,.12)'; kwTag='🏆 Longtail';
  } else {
    kwColor='#a5b4fc'; kwBg='rgba(165,180,252,.1)'; kwTag='';
  }

  // Vorherige/nächste Vorschau-Keywords
  var prevKw = _tinderIndex > 0 ? _tinderQueue[_tinderIndex - 1].kw : null;
  var nextKw = _tinderIndex < total - 1 ? _tinderQueue[_tinderIndex + 1].kw : null;

  root.innerHTML =
    // Fortschritt
    '<div style="margin-bottom:18px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
    '<span style="font-size:12px;color:var(--text3)">' + (_tinderIndex + 1) + ' / ' + total + ' Keywords</span>' +
    '<span style="font-size:11px;color:var(--text3)">' +
    '<span style="color:#34d399">✓ ' + _tinderKept + '</span> &nbsp; <span style="color:#f87171">🚫 ' + _tinderIgnored + '</span>' +
    '</span>' +
    '</div>' +
    '<div style="height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">' +
    '<div style="width:' + Math.round(_tinderIndex / total * 100) + '%;height:100%;background:linear-gradient(90deg,#6366f1,#a5b4fc);border-radius:3px;transition:width .3s"></div>' +
    '</div>' +
    '</div>' +

    // Stack-Vorschau (nächstes Keyword als Schatten)
    '<div style="position:relative;margin-bottom:24px">' +
    (nextKw ? '<div style="position:absolute;inset:-4px;transform:rotate(1deg) translateY(4px);background:var(--surface);border:1px solid var(--border);border-radius:16px;opacity:.4;pointer-events:none"></div>' : '') +

    // Haupt-Karte
    '<div id="tinder-card" style="position:relative;background:var(--surface);border:2px solid ' + kwColor + '40;border-radius:14px;padding:36px 28px;text-align:center;transition:all .2s">' +

    // Keyword groß
    '<div style="font-size:clamp(22px,4vw,34px);font-weight:800;color:' + kwColor + ';margin-bottom:12px;line-height:1.2;word-break:break-word">' + esc(item.kw) + '</div>' +

    // Typ-Badge
    (kwTag ? '<div style="display:inline-block;font-size:12px;padding:3px 12px;border-radius:20px;background:' + kwBg + ';color:' + kwColor + ';margin-bottom:14px">' + kwTag + '</div>' : '') +

    // Longtail-Info
    (hasIgnWord ? '<div style="font-size:11px;color:#fb923c;margin-bottom:10px;padding:6px 12px;background:rgba(251,146,60,.08);border-radius:8px">⚠ Enthält ignorierten Begriff, aber als Longtail-Phrase oft trotzdem sinnvoll!</div>' : '') +

    // Meta-Infos
    '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px">' +
    '<span style="font-size:11px;color:var(--text3);background:rgba(255,255,255,.05);padding:4px 10px;border-radius:8px">📊 ' + item.count + 'x verwendet</span>' +
    '<span style="font-size:11px;color:var(--text3);background:rgba(255,255,255,.05);padding:4px 10px;border-radius:8px">🌐 ' + esc(siteNames) + '</span>' +
    '</div>' +

    // Posts-Vorschau
    (item.posts.length ?
      '<div style="font-size:10px;color:var(--text3);margin-bottom:20px;max-height:52px;overflow:hidden">' +
      item.posts.slice(0,3).map(function(t){ return esc(t); }).join(' · ') +
      (item.posts.length > 3 ? ' · +' + (item.posts.length - 3) + ' weitere' : '') +
      '</div>' : '') +

    // Action-Buttons
    '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' +
    (prevKw ? '<button onclick="tinderUndo()" class="btn btn-ghost btn-sm" style="font-size:11px;opacity:.6" title="Letztes rückgängig">↩</button>' : '') +
    '<button onclick="tinderDecide(false)" id="tinder-ignore-btn" class="btn btn-danger" style="min-width:120px;font-size:14px;font-weight:700;padding:12px 20px" title="Ignorieren (Pfeiltaste ←)">' +
    '🚫 Ignorieren' +
    '</button>' +
    '<button onclick="tinderDecide(true)" id="tinder-keep-btn" class="btn btn-primary" style="min-width:120px;font-size:14px;font-weight:700;padding:12px 20px;background:#22c55e;border-color:#22c55e" title="Behalten (Pfeiltaste →)">' +
    '✓ Behalten' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>' +

    // Filter-Optionen
    '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center">' +
    '<button onclick="tinderSkipAll(\'longtail\')" class="btn btn-ghost btn-sm" style="font-size:11px">🏆 Alle Longtails behalten</button>' +
    '<button onclick="tinderSkipAll(\'ignored\')" class="btn btn-ghost btn-sm" style="font-size:11px">🚫 Alle Ignorierten überspringen</button>' +
    '<button onclick="seoSubTab(\'overview\', document.getElementById(\'seotab-btn-overview\'))" class="btn btn-ghost btn-sm" style="font-size:11px">↩ Zur Übersicht</button>' +
    '</div>';

  // Keyboard-Handler registrieren
  document.onkeydown = tinderKeyHandler;
}

function tinderKeyHandler(e) {
  var el = document.getElementById('tinder-root');
  if (!el || el.style.display === 'none') return;
  // Nur wenn Tinder-Tab aktiv
  var tinderTab = document.getElementById('seotab-tinder');
  if (!tinderTab || tinderTab.style.display === 'none') return;

  if (e.key === 'ArrowLeft'  || e.key === 'Escape') { e.preventDefault(); tinderDecide(false); }
  if (e.key === 'ArrowRight' || e.key === 'Enter')  { e.preventDefault(); tinderDecide(true);  }
  if (e.key === 'ArrowUp')                           { e.preventDefault(); tinderUndo(); }
}

function tinderDecide(keep) {
  if (_tinderIndex >= _tinderQueue.length) return;
  var item = _tinderQueue[_tinderIndex];

  // Kurze Animations-Klasse
  var card = document.getElementById('tinder-card');
  if (card) {
    card.style.transform = keep ? 'rotate(3deg) translateX(30px)' : 'rotate(-3deg) translateX(-30px)';
    card.style.opacity = '0';
  }

  if (!keep) {
    var ignoreList = seoGetIgnoreList();
    if (ignoreList.indexOf(item.kw) < 0) {
      ignoreList.push(item.kw);
      seoSaveIgnoreList(ignoreList);
    }
    _tinderIgnored++;
  } else {
    _tinderKept++;
  }
  _tinderIndex++;

  setTimeout(function(){ tinderRender(); }, 200);
}

function tinderUndo() {
  if (_tinderIndex <= 0) return;
  _tinderIndex--;
  var item = _tinderQueue[_tinderIndex];
  // Wenn es ignoriert wurde, aus der Liste entfernen
  var ignoreList = seoGetIgnoreList();
  var idx = ignoreList.indexOf(item.kw);
  if (idx >= 0) {
    ignoreList.splice(idx, 1);
    seoSaveIgnoreList(ignoreList);
    _tinderIgnored = Math.max(0, _tinderIgnored - 1);
  } else {
    _tinderKept = Math.max(0, _tinderKept - 1);
  }
  tinderRender();
}

function tinderSkipAll(type) {
  var ignoreList = seoGetIgnoreList();
  var remaining  = _tinderQueue.slice(_tinderIndex);

  if (type === 'longtail') {
    // Alle verbleibenden Longtails als "behalten" markieren
    remaining.forEach(function(item) {
      if (item.isLongtail) { _tinderKept++; _tinderIndex++; }
    });
    // Nicht-Longtail bleiben übrig – Tinder springt zum nächsten
    tinderRender();
  } else if (type === 'ignored') {
    // Alle die bereits in der Ignore-Liste sind überspringen
    while (_tinderIndex < _tinderQueue.length && ignoreList.indexOf(_tinderQueue[_tinderIndex].kw) >= 0) {
      _tinderIndex++;
    }
    tinderRender();
  }
}

// ─────────────────────────────────────────────────────────────
// Ignoriert-Tab
// ─────────────────────────────────────────────────────────────
function seoAddIgnore() {
  var input = document.getElementById('seo-ignore-input');
  var val   = (input ? input.value : '').trim();
  if (!val) return;
  var list  = seoGetIgnoreList();
  val.split(',').forEach(function(k) {
    k = k.trim().toLowerCase();
    if (k && list.indexOf(k) < 0) list.push(k);
  });
  seoSaveIgnoreList(list);
  input.value = '';
  seoRenderIgnored(); seoApplyFilter();
}

function seoRenderIgnored() {
  var el = document.getElementById('seo-ignore-list');
  if (!el) return;
  var list = seoGetIgnoreList();

  if (!list.length) {
    el.innerHTML =
      '<div style="text-align:center;color:var(--text3);font-size:12px;padding:20px">' +
      'Keine ignorierten Keywords.<br>' +
      '<span style="font-size:11px">Klicke in der Übersicht auf ein Keyword oder nutze den Schnell-Review-Tab.</span>' +
      '</div>';
    return;
  }

  var exportHtml =
    '<div style="background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:10px;padding:14px 16px;margin-bottom:16px">' +
    '<div style="font-size:12px;font-weight:700;color:#fbbf24;margin-bottom:8px">📤 Export für worker/seo.js</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.6">' +
    '1. "Format kopieren" → 2. In <code style="background:rgba(255,255,255,.07);padding:1px 5px;border-radius:3px">worker/seo.js</code> STOPWORDS-Array einfügen → 3. "Implementiert – leeren"' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '  <select id="seo-export-lang" style="padding:6px 10px;font-size:12px;border-radius:7px;background:var(--surface);border:1px solid var(--border);color:var(--text1)">' +
    '    <option value="de">🇩🇪 Deutsch</option><option value="en">🇬🇧 English</option>' +
    '    <option value="fr">🇫🇷 Français</option><option value="es">🇪🇸 Español</option><option value="it">🇮🇹 Italiano</option>' +
    '  </select>' +
    '  <button class="btn btn-primary" onclick="seoExportIgnored()" style="font-size:12px">📋 Format kopieren</button>' +
    '  <button class="btn btn-ghost btn-sm" onclick="seoClearIgnored()" style="font-size:12px;color:#f87171">× Alle löschen</button>' +
    '</div>' +
    '<div id="seo-export-preview" style="display:none;margin-top:12px">' +
    '  <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">' +
    '    Ausgabe (in STOPWORDS einfügen)' +
    '    <button onclick="seoMarkImplemented()" class="btn btn-ghost btn-sm" style="font-size:10px;margin-left:8px;color:#34d399">✓ Implementiert – leeren</button>' +
    '  </div>' +
    '  <textarea id="seo-export-text" readonly rows="3" style="width:100%;font-family:\'Space Mono\',monospace;font-size:11px;background:var(--bg);border:1px solid rgba(251,191,36,.3);border-radius:7px;padding:10px 12px;color:#fbbf24;resize:vertical"></textarea>' +
    '</div>' +
    '</div>';

  var listHtml =
    '<div style="margin-bottom:8px;font-size:11px;color:var(--text3)">' + list.length + ' ignorierte Wörter</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">' +
    list.map(function(kw) {
      var safe = kw.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return '<span style="font-size:12px;padding:4px 10px;border-radius:20px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#f87171;display:flex;align-items:center;gap:6px">' +
        esc(kw) +
        '<button onclick="seoRemoveIgnored(\'' + safe + '\')" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:14px;padding:0;line-height:1;opacity:.7">×</button>' +
        '</span>';
    }).join('') +
    '</div>';

  el.innerHTML = exportHtml + listHtml;
}

window.seoExportIgnored = function() {
  var list = seoGetIgnoreList();
  if (!list.length) { seoShowToast('Keine Wörter', '#f87171'); return; }
  var formatted = list.map(function(w){ return ",'" + w + "'"; }).join('');
  var ta = document.getElementById('seo-export-text');
  var wrap = document.getElementById('seo-export-preview');
  if (ta) ta.value = formatted;
  if (wrap) wrap.style.display = 'block';
  navigator.clipboard.writeText(formatted).then(function(){ seoShowToast('📋 ' + list.length + ' Wörter kopiert!', '#fbbf24'); }).catch(function(){});
};

window.seoMarkImplemented = function() {
  var list = seoGetIgnoreList();
  if (!confirm('Alle ' + list.length + ' Wörter als implementiert markieren und löschen?')) return;
  seoSaveIgnoreList([]);
  seoRenderIgnored(); seoApplyFilter();
  seoShowToast('✓ ' + list.length + ' Wörter gelöscht (implementiert)', '#34d399');
};

window.seoRemoveIgnored = function(kw) {
  seoSaveIgnoreList(seoGetIgnoreList().filter(function(k){ return k !== kw; }));
  seoRenderIgnored(); seoApplyFilter();
};

window.seoClearIgnored = function() {
  if (!confirm('Alle ignorierten Keywords endgültig löschen?')) return;
  seoSaveIgnoreList([]); seoRenderIgnored(); seoApplyFilter();
};

// ─────────────────────────────────────────────────────────────
// KI-Batch
// ─────────────────────────────────────────────────────────────
async function aiLoadPosts() {
  var siteFilter = (document.getElementById('ai-filter-site')||{}).value || '';
  var sites = siteFilter ? [siteFilter] : BV_SITES.map(function(s){ return s.id; });
  _aiAllPosts = [];
  for (var i = 0; i < sites.length; i++) {
    var posts = await api('/api/blog?site_id=' + sites[i]);
    if (posts && posts.length) {
      posts.forEach(function(p){ p._siteId = sites[i]; });
      _aiAllPosts = _aiAllPosts.concat(posts);
    }
  }
  aiApplyPostFilter();
}

function aiApplyPostFilter() {
  var langFilter = (document.getElementById('ai-filter-lang')||{}).value || '';
  var container  = document.getElementById('ai-post-list');
  if (!container) return;
  var posts = _aiAllPosts;
  if (langFilter) posts = posts.filter(function(p){ return (p.lang||'de') === langFilter; });
  if (!posts.length) { container.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:12px 0">Keine Posts.</div>'; aiUpdateCount(); return; }

  var siteMap = {}; BV_SITES.forEach(function(s){ siteMap[s.id] = s; });
  var html = '';
  posts.forEach(function(p) {
    var site  = siteMap[p._siteId] || {};
    var col   = site.color || '#888';
    var hasKw = _parseKwField(p.meta_keywords).length > 0;
    html += '<label style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid var(--border);background:var(--bg);' +
      (!hasKw ? 'border-color:rgba(251,191,36,.2);' : '') + '">' +
      '<input type="checkbox" data-postid="' + p.id + '" onchange="aiUpdateCount()" style="flex-shrink:0"' + (!hasKw ? ' checked' : '') + '>' +
      '<span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;background:' + col + '20;color:' + col + ';flex-shrink:0">' + esc(site.name||p._siteId) + '</span>' +
      '<span style="font-size:12px">' + (LANG_FLAGS[p.lang]||p.lang) + '</span>' +
      '<span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">' + esc(p.title||'(kein Titel)') + '</span>' +
      (!hasKw ? '<span style="font-size:10px;color:#fbbf24;flex-shrink:0">⚠</span>' : '<span style="font-size:10px;color:#c084fc;flex-shrink:0">🔍</span>') +
      '</label>';
  });
  container.innerHTML = html;
  aiUpdateCount();
}

function aiFilterNoSeo() {
  document.querySelectorAll('#ai-post-list input[type=checkbox]').forEach(function(cb) {
    var post = _aiAllPosts.find(function(p){ return p.id === parseInt(cb.dataset.postid); });
    cb.checked = !(post && _parseKwField(post.meta_keywords).length > 0);
  });
  aiUpdateCount();
}
function aiSelectAll()  { document.querySelectorAll('#ai-post-list input[type=checkbox]').forEach(function(cb){ cb.checked=true;  }); aiUpdateCount(); }
function aiSelectNone() { document.querySelectorAll('#ai-post-list input[type=checkbox]').forEach(function(cb){ cb.checked=false; }); aiUpdateCount(); }

function aiGetSelectedPosts() {
  var ids = [];
  document.querySelectorAll('#ai-post-list input[type=checkbox]:checked').forEach(function(cb){ ids.push(parseInt(cb.dataset.postid)); });
  return _aiAllPosts.filter(function(p){ return ids.indexOf(p.id) >= 0; });
}
function aiUpdateCount() {
  var el = document.getElementById('ai-selected-count');
  if (el) el.textContent = aiGetSelectedPosts().length + ' Posts ausgewählt';
}

function aiGeneratePrompt() {
  var posts = aiGetSelectedPosts();
  if (!posts.length) { seoShowToast('Keine Posts ausgewählt', '#f87171'); return; }
  var LANG_NAMES = { de:'Deutsch', en:'Englisch', fr:'Französisch', es:'Spanisch', it:'Italienisch' };
  var ignoreList = seoGetIgnoreList();

  function htmlToText(html) {
    return (html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,350);
  }

  var prompt = 'Du bist ein SEO-Experte. Erstelle für jeden Blog-Beitrag optimierte SEO-Metadaten.\n\n';

  if (ignoreList.length) {
    prompt += '⛔ STOPWORDS – als EINZELNE Keywords verboten:\n' + ignoreList.join(', ') + '\n';
    prompt += '⚠️ WICHTIG: Diese Wörter dürfen als EINZELNE Keywords NICHT erscheinen.\n';
    prompt += '   In LONGTAIL-PHRASEN (2+ Wörter) sind sie aber erlaubt wenn die Kombination sinnvoll ist!\n';
    prompt += '   Beispiel: "gehen" = verboten · "schlafen gehen" = erlaubt\n\n';
  }

  prompt += '📋 BLOG-BEITRÄGE (' + posts.length + '):\n' + '─'.repeat(60) + '\n\n';

  posts.forEach(function(p, i) {
    var kws = _parseKwField(p.meta_keywords);
    prompt += (i+1) + '. ID: ' + p.id + ' | Sprache: ' + (LANG_NAMES[p.lang]||p.lang) + ' | Site: ' + p._siteId + '\n';
    prompt += '   Titel: ' + (p.title||'') + '\n';
    if (p.excerpt) prompt += '   Excerpt: ' + htmlToText(p.excerpt) + '\n';
    else if (p.content) prompt += '   Inhalt: ' + htmlToText(p.content) + '\n';
    if (p.tags)    prompt += '   Tags: ' + p.tags + '\n';
    if (kws.length) prompt += '   Bestehende Keywords: ' + kws.join(', ') + '\n';
    prompt += '\n';
  });

  prompt += '─'.repeat(60) + '\n\n';
  prompt += '📤 AUFGABE:\n';
  prompt += '• Meta-Description: 140–160 Zeichen in der Post-Sprache\n';
  prompt += '• Meta-Keywords: 6–10 Keywords\n';
  prompt += '  → BEVORZUGE Longtail-Phrasen (2–4 Wörter)! z.B. "brawl stars tipps anfänger", "wordle strategie deutsch täglich"\n';
  prompt += '  → Stopwords-Einzelwörter vermeiden, aber in Phrasen-Kombination erlaubt\n\n';
  prompt += '⚠️ Antworte NUR mit einem JSON-Array (kein Text, keine Backticks):\n\n';
  prompt += '[\n  {\n    "id": ' + posts[0].id + ',\n    "meta_description": "…",\n    "meta_keywords": ["longtail phrase", "weiteres longtail", "einzelwort"]\n  }';
  if (posts.length > 1) prompt += ',\n  ... (' + (posts.length - 1) + ' weitere)';
  prompt += '\n]';

  var ta = document.getElementById('ai-prompt-text');
  if (ta) ta.value = prompt;
  var wrap = document.getElementById('ai-prompt-wrap');
  if (wrap) wrap.style.display = 'block';
  var cpBtn = document.getElementById('ai-copy-btn');
  if (cpBtn) cpBtn.style.display = '';
}

function aiCopyPrompt() {
  var ta = document.getElementById('ai-prompt-text');
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(function() {
    var btn = document.getElementById('ai-copy-btn');
    if (btn) { btn.textContent='✓ Kopiert!'; btn.style.color='#34d399'; setTimeout(function(){ btn.textContent='📋 Kopieren'; btn.style.color=''; }, 2000); }
  });
}

function aiParseResponse() {
  var raw      = (document.getElementById('ai-response-text')||{}).value || '';
  var errEl    = document.getElementById('ai-error-box');
  var prevEl   = document.getElementById('ai-preview-box');
  var listEl   = document.getElementById('ai-preview-list');
  var applyBtn = document.getElementById('ai-apply-btn');
  _aiParsed = [];

  var clean = raw.trim().replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'').trim();
  if (!clean) { if(errEl) errEl.style.display='none'; if(prevEl) prevEl.style.display='none'; if(applyBtn) applyBtn.disabled=true; return; }

  try {
    var data = JSON.parse(clean);
    if (!Array.isArray(data)) throw new Error('Kein Array');
    data = data.filter(function(d){ return d && d.id && (d.meta_description || (d.meta_keywords && d.meta_keywords.length)); });
    if (!data.length) throw new Error('Keine gültigen Einträge');
    _aiParsed = data;

    if (listEl) {
      listEl.innerHTML = data.map(function(d) {
        var kws = _parseKwField(d.meta_keywords);
        var longtails = kws.filter(function(k){ return k.indexOf(' ') >= 0; }).length;
        return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(52,211,153,.1)">' +
          '<span style="font-weight:700;color:var(--text1)">ID ' + d.id + '</span>' +
          (longtails ? ' <span style="font-size:10px;color:#fbbf24">🏆 ' + longtails + ' Longtail</span>' : '') +
          (d.meta_description ? '<div style="color:var(--text2);font-size:11px;margin-top:3px">' + esc(d.meta_description.slice(0,100)) + (d.meta_description.length>100?'…':'') + '</div>' : '') +
          '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">' +
          kws.map(function(k){
            var lt = k.indexOf(' ') >= 0;
            return '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:' + (lt?'rgba(251,191,36,.15)':'rgba(139,92,246,.15)') + ';color:' + (lt?'#fbbf24':'#c084fc') + '">' + esc(k) + '</span>';
          }).join('') +
          '</div></div>';
      }).join('');
    }
    if (prevEl)   prevEl.style.display = 'block';
    if (errEl)    errEl.style.display  = 'none';
    if (applyBtn) applyBtn.disabled    = false;
  } catch(e) {
    if (errEl)    { errEl.style.display='block'; errEl.textContent='✕ JSON-Fehler: ' + e.message; }
    if (prevEl)   prevEl.style.display  = 'none';
    if (applyBtn) applyBtn.disabled     = true;
    _aiParsed = [];
  }
}

async function aiApplyAll() {
  if (!_aiParsed.length) return;
  var statusEl = document.getElementById('ai-apply-status');
  var btn      = document.getElementById('ai-apply-btn');
  btn.disabled = true;
  statusEl.textContent = 'Speichere…'; statusEl.style.color = 'var(--text3)';

  var ok = 0; var failed = 0;
  for (var i = 0; i < _aiParsed.length; i++) {
    var d   = _aiParsed[i];
    var kws = _parseKwField(d.meta_keywords);
    var body = {};
    if (d.meta_description) body.meta_description = d.meta_description;
    if (kws.length)          body.meta_keywords    = kws;

    var res = await api('/api/blog/' + d.id, { method: 'PATCH', body: body }).catch(function(){ return null; });
    if (res && res.success !== false) {
      ok++;
      var post = _seoAllPosts.find(function(p){ return p.id === d.id; });
      if (post) { if(d.meta_description) post.meta_description=d.meta_description; if(kws.length) post.meta_keywords=kws; }
      var aiPost = _aiAllPosts.find(function(p){ return p.id === d.id; });
      if (aiPost) { if(d.meta_description) aiPost.meta_description=d.meta_description; if(kws.length) aiPost.meta_keywords=kws; }
    } else { failed++; }
    statusEl.textContent = ok + '/' + _aiParsed.length + ' gespeichert…';
  }

  if (failed === 0) {
    statusEl.textContent = '✓ ' + ok + ' Posts aktualisiert!'; statusEl.style.color = '#34d399';
    aiClearResponse(); seoApplyFilter(); seoRenderPostsTab(); aiApplyPostFilter();
    setTimeout(function(){ statusEl.textContent=''; btn.disabled=false; }, 3000);
  } else {
    statusEl.textContent = '⚠ ' + ok + ' ok, ' + failed + ' Fehler'; statusEl.style.color = '#fbbf24';
    btn.disabled = false;
  }
}

function aiClearResponse() {
  var ta = document.getElementById('ai-response-text');
  if (ta) ta.value = '';
  var prevEl = document.getElementById('ai-preview-box');
  var errEl  = document.getElementById('ai-error-box');
  if (prevEl) prevEl.style.display = 'none';
  if (errEl)  errEl.style.display  = 'none';
  var applyBtn = document.getElementById('ai-apply-btn');
  if (applyBtn) applyBtn.disabled = true;
  _aiParsed = [];
}

// ─────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────
function seoShowToast(msg, color) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:9px;font-size:12px;font-weight:700;background:rgba(0,0,0,.85);border:1px solid ' + (color||'var(--border)') + ';color:' + (color||'var(--text1)') + ';box-shadow:0 8px 24px rgba(0,0,0,.4)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2500);
}
