// =============================================
// WebControl HQ - Cloudflare Worker API
// =============================================

// ── Auth ─────────────────────────────────────────────────────────
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

async function generateToken(secret) {
  const raw = secret + ':' + Date.now() + ':' + Math.random();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyAuth(request, env) {
  const token = request.headers.get('X-Auth-Token');
  if (!token) return false;
  // Token format: HMAC(password+timestamp)
  // Simple approach: store valid tokens in KV or validate with password hash
  // We use a stateless approach: token = SHA256(PASSWORD + DATE_HOUR)
  // Valid for current and previous hour (handles hour boundary)
  const pass = env.DASHBOARD_PASSWORD || 'changeme';
  const now = Date.now();
  for (const offset of [0, -1, -2]) {
    const hourSlot = Math.floor((now + offset * 3600000) / 3600000).toString();
    const expected = await sha256(pass + ':' + hourSlot);
    if (token === expected) return true;
  }
  return false;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Site-Id, X-Auth-Token',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL DEFAULT 'wordify',
      date TEXT NOT NULL,
      language TEXT NOT NULL,
      word TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, language)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL DEFAULT 'wordify',
      name TEXT,
      message TEXT NOT NULL,
      language TEXT DEFAULT 'de',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const segments = path.split('/').filter(Boolean);

  // ── Login endpoint (no auth required) ────────────────────
  if (request.method === 'POST' && path === '/api/login') {
    const body = await request.json().catch(() => ({}));
    const pass = env.DASHBOARD_PASSWORD || 'changeme';
    if (!body.password || body.password !== pass) {
      return json({ error: 'Falsches Passwort' }, 401);
    }
    // Generate stateless token: SHA256(password + current hour slot)
    const hourSlot = Math.floor(Date.now() / 3600000).toString();
    const token = await sha256(pass + ':' + hourSlot);
    return json({ token, expires_in: 3600 });
  }

  // ── Public endpoints (no auth) ───────────────────────────
  // POST /api/words - public word requests from game sites (no login needed)
  if (request.method === 'POST' && path === '/api/words') {
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const { word, language, requester_email } = body;
    // requested_at from client is informational only; DB uses created_at (auto timestamp)
    if (!word) return err('Missing word');
    await db.prepare('INSERT INTO word_requests (word, language, requester_email) VALUES (?,?,?)')
      .bind(word, language || 'de', requester_email || null).run();
    // Fire notification
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind('wordify', 'info', `Wort-Anfrage: ${word}`, `Sprache: ${language || 'de'}`).run();
    return json({ success: true });
  }

  // ── GET /api/daily-word ── public (Wordify fetches today’s word) ───
  if (request.method === 'GET' && path === '/api/daily-word') {
    const db = env.DB;
    await ensureTables(db);
    const lang = url.searchParams.get('lang') || 'de';
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const row = await db.prepare('SELECT word FROM daily_words WHERE date=? AND language=?')
      .bind(date, lang).first();
    return json({ word: row ? row.word.toUpperCase() : null, date, lang });
  }

  // ── POST /api/contact ── public (Wordify contact form) ─────────
  if (request.method === 'POST' && path === '/api/contact') {
    const db = env.DB;
    await ensureTables(db);
    const body = await request.json().catch(() => ({}));
    const { name, message, language } = body;
    if (!message || message.trim().length < 5)  return err('Nachricht zu kurz (min. 5 Zeichen)');
    if (message.length > 1000) return err('Nachricht zu lang (max 1000 Zeichen)');
    await db.prepare('INSERT INTO contact_messages (name, message, language) VALUES (?,?,?)')
      .bind((name || 'Anonym').slice(0, 60), message.trim(), language || 'de').run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind('wordify', 'info', `Nachricht: ${(name || 'Anonym').slice(0, 30)}`, message.trim().slice(0, 80)).run();
    return json({ success: true });
  }

  // ── Public: FrameTrain users submit support tickets ──────────
  if (request.method === 'POST' && path === '/api/support/submit') {
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const { user_id, name, email, subject, message } = body;
    if (!subject || !message) return err('Betreff und Nachricht erforderlich');
    const tokenRaw = `${email || user_id || 'anon'}:${Date.now()}:${Math.random()}`;
    const user_token = await sha256(tokenRaw);
    const result = await db.prepare(
      'INSERT INTO support_tickets (site_id, name, email, subject, message, priority, user_token, user_id) VALUES (?,?,?,?,?,?,?,?)'
    ).bind('frametrain', name || null, email || null, subject, message, 'normal', user_token, user_id || null).run();
    const ticketId = result.meta.last_row_id;
    await db.prepare('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)')
      .bind(ticketId, 'user', message).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind('frametrain', 'info', `🎫 Neues Ticket: ${subject}`, `Von: ${name || email || 'Anonym'} – ${message.slice(0, 80)}`).run();
    return json({ success: true, ticket_id: ticketId, user_token });
  }

  // ── Public: get ticket thread by user_token ──────────────────
  if (request.method === 'GET' && segments[1] === 'support' && segments[2] && segments[3] === 'thread') {
    const db = env.DB;
    const ticketId = segments[2];
    const token = url.searchParams.get('token');
    if (!token) return err('Token required', 401);
    const ticket = await db.prepare('SELECT id, subject, status, created_at, updated_at FROM support_tickets WHERE id=? AND user_token=?').bind(ticketId, token).first();
    if (!ticket) return err('Ticket not found', 404);
    const messages = await db.prepare('SELECT id, sender, message, created_at FROM support_messages WHERE ticket_id=? ORDER BY created_at ASC').bind(ticketId).all();
    return json({ ticket, messages: messages.results });
  }

  // ── Public: user sends follow-up message ─────────────────────
  if (request.method === 'POST' && segments[1] === 'support' && segments[2] && segments[3] === 'reply') {
    const db = env.DB;
    const ticketId = segments[2];
    const body = await request.json().catch(() => ({}));
    const { token, message } = body;
    if (!token || !message) return err('Token und Nachricht erforderlich');
    const ticket = await db.prepare('SELECT id FROM support_tickets WHERE id=? AND user_token=?').bind(ticketId, token).first();
    if (!ticket) return err('Ticket not found', 404);
    await db.prepare('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)').bind(ticketId, 'user', message).run();
    await db.prepare("UPDATE support_tickets SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind('frametrain', 'info', `💬 Antwort auf Ticket #${ticketId}`, message.slice(0, 80)).run();
    return json({ success: true });
  }

  // ── Public: published changelog for frametrain website ───────
  if (request.method === 'GET' && path === '/api/changelog/published') {
    const db = env.DB;
    const siteId = url.searchParams.get('site_id') || 'frametrain';
    const result = await db.prepare(
      'SELECT * FROM changelog_entries WHERE site_id=? AND published=1 ORDER BY created_at DESC'
    ).bind(siteId).all();
    return json(result.results);
  }

  // ── Auth guard (all other /api routes) ────────────────────
  const authed = await verifyAuth(request, env);
  if (!authed) {
    return json({ error: 'Nicht authentifiziert' }, 401);
  }

  const db = env.DB;

  // ── GET /api/overview ──────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/overview') {
    const sites = await db.prepare('SELECT * FROM sites').all();
    const unread = await db.prepare("SELECT site_id, COUNT(*) as c FROM notifications WHERE read=0 GROUP BY site_id").all();
    const openTickets = await db.prepare("SELECT site_id, COUNT(*) as c FROM support_tickets WHERE status='open' GROUP BY site_id").all();
    const recentErrors = await db.prepare("SELECT site_id, COUNT(*) as c FROM error_logs WHERE resolved=0 GROUP BY site_id").all();
    const recentNotifs = await db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20").all();

    const unreadMap = Object.fromEntries(unread.results.map(r => [r.site_id, r.c]));
    const ticketMap = Object.fromEntries(openTickets.results.map(r => [r.site_id, r.c]));
    const errorMap = Object.fromEntries(recentErrors.results.map(r => [r.site_id, r.c]));

    return json({
      sites: sites.results.map(s => ({
        ...s,
        unread_notifications: unreadMap[s.id] || 0,
        open_tickets: ticketMap[s.id] || 0,
        unresolved_errors: errorMap[s.id] || 0,
      })),
      recent_notifications: recentNotifs.results,
    });
  }

  // ── GET /api/notifications ────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/notifications') {
    const limit = url.searchParams.get('limit') || 50;
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM notifications';
    let params = [];
    if (siteId) { q += ' WHERE site_id = ?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/notifications ───────────────────────────────────────
  if (request.method === 'POST' && path === '/api/notifications') {
    const body = await request.json();
    const { site_id, type, title, message } = body;
    if (!site_id || !type || !title) return err('Missing fields');
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(site_id, type, title, message || null).run();
    return json({ success: true });
  }

  // ── PATCH /api/notifications/:id/read ────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'notifications' && segments[3] === 'read') {
    const id = segments[2];
    await db.prepare('UPDATE notifications SET read=1 WHERE id=?').bind(id).run();
    return json({ success: true });
  }

  // ── POST /api/notifications/read-all ──────────────────────────────
  if (request.method === 'POST' && path === '/api/notifications/read-all') {
    const body = await request.json().catch(() => ({}));
    if (body.site_id) {
      await db.prepare('UPDATE notifications SET read=1 WHERE site_id=?').bind(body.site_id).run();
    } else {
      await db.prepare('UPDATE notifications SET read=1').run();
    }
    return json({ success: true });
  }

  // ── GET /api/support ─────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/support') {
    const siteId = url.searchParams.get('site_id');
    const status = url.searchParams.get('status');
    let q = 'SELECT * FROM support_tickets WHERE 1=1';
    let params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    if (status) { q += ' AND status=?'; params.push(status); }
    q += ' ORDER BY created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/support ────────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/support') {
    const body = await request.json();
    const { site_id, name, email, subject, message, priority } = body;
    if (!site_id || !subject || !message) return err('Missing required fields');
    const result = await db.prepare(
      'INSERT INTO support_tickets (site_id, name, email, subject, message, priority) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, name || null, email || null, subject, message, priority || 'normal').run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(site_id, 'info', 'New Support Ticket', subject).run();
    return json({ success: true, id: result.meta.last_row_id });
  }

  // ── GET /api/support/:id/messages (manager reads chat) ────────────
  if (request.method === 'GET' && segments[1] === 'support' && segments[2] && segments[3] === 'messages') {
    const ticketId = segments[2];
    const messages = await db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY created_at ASC').bind(ticketId).all();
    await db.prepare('UPDATE support_messages SET read_by_admin=1 WHERE ticket_id=? AND read_by_admin=0').bind(ticketId).run();
    return json(messages.results);
  }

  // ── POST /api/support/:id/messages (manager sends reply) ──────────
  if (request.method === 'POST' && segments[1] === 'support' && segments[2] && segments[3] === 'messages') {
    const ticketId = segments[2];
    const body = await request.json().catch(() => ({}));
    const { message } = body;
    if (!message) return err('Nachricht erforderlich');
    await db.prepare('INSERT INTO support_messages (ticket_id, sender, message, read_by_admin) VALUES (?,?,?,1)').bind(ticketId, 'admin', message).run();
    await db.prepare("UPDATE support_tickets SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
    return json({ success: true });
  }

  // ── PATCH /api/support/:id ────────────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'support' && segments[2] && !segments[3]) {
    const id = segments[2];
    const body = await request.json();
    const { status, reply, priority } = body;
    const updates = [];
    const params = [];
    if (status) { updates.push('status=?'); params.push(status); }
    if (reply !== undefined) { updates.push('reply=?'); params.push(reply); }
    if (priority) { updates.push('priority=?'); params.push(priority); }
    updates.push('updated_at=CURRENT_TIMESTAMP');
    if (updates.length === 1) return err('Nothing to update');
    await db.prepare(`UPDATE support_tickets SET ${updates.join(',')} WHERE id=?`).bind(...params, id).run();
    return json({ success: true });
  }

  // ── GET /api/changelog ────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/changelog') {
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM changelog_entries WHERE 1=1';
    const params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/changelog ───────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/changelog') {
    const body = await request.json();
    const { site_id, version, title, description, type, published } = body;
    if (!site_id || !version || !title) return err('Missing fields');
    await db.prepare(
      'INSERT INTO changelog_entries (site_id, version, title, description, type, published) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, version, title, description || null, type || 'feature', published ? 1 : 0).run();
    return json({ success: true });
  }

  // ── DELETE /api/changelog/:id ─────────────────────────────────────
  // ── PATCH /api/changelog/:id (toggle published) ──────────────────
  if (request.method === 'PATCH' && segments[1] === 'changelog' && segments[2]) {
    const body = await request.json().catch(() => ({}));
    if (body.published !== undefined) {
      await db.prepare('UPDATE changelog_entries SET published=? WHERE id=?').bind(body.published ? 1 : 0, segments[2]).run();
    }
    return json({ success: true });
  }

  if (request.method === 'DELETE' && segments[1] === 'changelog' && segments[2]) {
    await db.prepare('DELETE FROM changelog_entries WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/blog ─────────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/blog') {
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM blog_posts WHERE 1=1';
    const params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/blog ────────────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/blog') {
    const body = await request.json();
    const { site_id, title, slug, content, excerpt, status } = body;
    if (!site_id || !title) return err('Missing fields');
    const finalSlug = slug || title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    await db.prepare(
      'INSERT INTO blog_posts (site_id, title, slug, content, excerpt, status) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, title, finalSlug, content || null, excerpt || null, status || 'draft').run();
    return json({ success: true });
  }

  // ── GET /api/words ────────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/words') {
    const status = url.searchParams.get('status');
    let q = 'SELECT * FROM word_requests WHERE 1=1';
    const params = [];
    if (status) { q += ' AND status=?'; params.push(status); }
    q += ' ORDER BY created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── PATCH /api/words/:id ──────────────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'words' && segments[2]) {
    const body = await request.json();
    const { status, note } = body;
    await db.prepare('UPDATE word_requests SET status=?, note=? WHERE id=?')
      .bind(status, note || null, segments[2]).run();
    return json({ success: true });
  }

  // ── POST /api/words ───────────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/words') {
    const body = await request.json();
    const { word, language, requester_email } = body;
    if (!word) return err('Missing word');
    await db.prepare('INSERT INTO word_requests (word, language, requester_email) VALUES (?,?,?)')
      .bind(word, language || 'de', requester_email || null).run();
    return json({ success: true });
  }

  // ── GET /api/suggestions ──────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/suggestions') {
    const status = url.searchParams.get('status');
    let q = 'SELECT * FROM suggestions WHERE 1=1';
    const params = [];
    if (status) { q += ' AND status=?'; params.push(status); }
    q += ' ORDER BY upvotes DESC, created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── PATCH /api/suggestions/:id ────────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'suggestions' && segments[2]) {
    const body = await request.json();
    const { status, note } = body;
    await db.prepare('UPDATE suggestions SET status=?, note=? WHERE id=?')
      .bind(status, note || null, segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/errors ───────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/errors') {
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM error_logs WHERE 1=1';
    const params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC LIMIT 100';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/errors ──────────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/errors') {
    const body = await request.json();
    const { site_id, error_type, message, stack, path: ePath, status_code } = body;
    if (!site_id || !error_type || !message) return err('Missing fields');
    await db.prepare(
      'INSERT INTO error_logs (site_id, error_type, message, stack, path, status_code) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, error_type, message, stack || null, ePath || null, status_code || null).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(site_id, 'error', `Error: ${error_type}`, message).run();
    return json({ success: true });
  }

  // ── PATCH /api/errors/:id/resolve ─────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'errors' && segments[3] === 'resolve') {
    await db.prepare('UPDATE error_logs SET resolved=1 WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/analytics ────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/analytics') {
    const siteId = url.searchParams.get('site_id');
    const days = parseInt(url.searchParams.get('days') || '7');

    // Event counts by type
    let q1 = `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE created_at >= datetime('now', '-${days} days')`;
    const params1 = [];
    if (siteId) { q1 += ' AND site_id=?'; params1.push(siteId); }
    q1 += ' GROUP BY event_type';

    // Daily pageviews
    let q2 = `SELECT date(created_at) as day, COUNT(*) as views FROM analytics_events WHERE event_type='pageview' AND created_at >= datetime('now', '-${days} days')`;
    const params2 = [];
    if (siteId) { q2 += ' AND site_id=?'; params2.push(siteId); }
    q2 += ' GROUP BY day ORDER BY day';

    const [byType, byDay] = await Promise.all([
      db.prepare(q1).bind(...params1).all(),
      db.prepare(q2).bind(...params2).all(),
    ]);

    return json({ by_type: byType.results, by_day: byDay.results });
  }

  // ── POST /api/analytics ───────────────────────────────────────────
  if (request.method === 'POST' && path === '/api/analytics') {
    const body = await request.json();
    const { site_id, event_type, path: ePath, referrer, country } = body;
    if (!site_id || !event_type) return err('Missing fields');
    const ua = request.headers.get('user-agent') || null;
    await db.prepare(
      'INSERT INTO analytics_events (site_id, event_type, path, referrer, user_agent, country) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, event_type, ePath || null, referrer || null, ua, country || null).run();
    return json({ success: true });
  }

  // ── GET /api/daily-words ── dashboard list ───────────────────────
  if (request.method === 'GET' && path === '/api/daily-words') {
    await ensureTables(db);
    const lang = url.searchParams.get('lang');
    let q = 'SELECT * FROM daily_words WHERE 1=1';
    const params = [];
    if (lang) { q += ' AND language=?'; params.push(lang); }
    q += ' ORDER BY date DESC, language ASC LIMIT 200';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── POST /api/daily-words ── create or replace ────────────────────
  if (request.method === 'POST' && path === '/api/daily-words') {
    const body = await request.json().catch(() => ({}));
    const { date, language, word } = body;
    if (!date || !language || !word) return err('Missing date, language or word');
    await db.prepare(
      'INSERT INTO daily_words (date, language, word) VALUES (?,?,?) ON CONFLICT(date,language) DO UPDATE SET word=excluded.word'
    ).bind(date, language, word.toUpperCase().trim()).run();
    return json({ success: true });
  }

  // ── DELETE /api/daily-words/:id ────────────────────────────
  if (request.method === 'DELETE' && segments[1] === 'daily-words' && segments[2]) {
    await db.prepare('DELETE FROM daily_words WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/contact ── dashboard messages list ──────────────────
  if (request.method === 'GET' && path === '/api/contact') {
    await ensureTables(db);
    const result = await db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200').all();
    return json(result.results);
  }

  // ── PATCH /api/contact/:id/read ────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'contact' && segments[3] === 'read') {
    await db.prepare('UPDATE contact_messages SET read=1 WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/stats ────────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/stats') {
    const tickets = await db.prepare("SELECT status, COUNT(*) as c FROM support_tickets GROUP BY status").all();
    const errors = await db.prepare("SELECT resolved, COUNT(*) as c FROM error_logs GROUP BY resolved").all();
    const words = await db.prepare("SELECT status, COUNT(*) as c FROM word_requests GROUP BY status").all();
    const notifs = await db.prepare("SELECT read, COUNT(*) as c FROM notifications GROUP BY read").all();
    return json({ tickets: tickets.results, errors: errors.results, words: words.results, notifs: notifs.results });
  }

  return err('Not found', 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
