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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Site-Id, X-Auth-Token, CF-Token',
  'Access-Control-Allow-Credentials': 'false',
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

// ── Auto-create suggestions table (top-level, used by public + auth routes) ──
async function ensureSuggestionsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL DEFAULT 'spinselector',
    suggestion TEXT NOT NULL,
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    note TEXT,
    upvotes INTEGER DEFAULT 0,
    ip_hash TEXT,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for (const col of [
    "site_id TEXT NOT NULL DEFAULT 'spinselector'",
    'ip_hash TEXT',
    'read INTEGER DEFAULT 0',
  ]) {
    await db.prepare(`ALTER TABLE suggestions ADD COLUMN ${col}`).run().catch(() => {});
  }
}

// ── Auto-create changelog_entries table ────────────────────────────
async function ensureChangelogTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS changelog_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    version TEXT,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'feature',
    published INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare("ALTER TABLE changelog_entries ADD COLUMN type TEXT DEFAULT 'feature'").run().catch(() => {});
}

// ── Auto-create error_logs table if missing ───────────────────────
async function ensureErrorTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    error_type TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    path TEXT,
    status_code INTEGER,
    resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

// ── Auto-create daily_words + contact_messages tables ────────────
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
    const hourSlot = Math.floor(Date.now() / 3600000).toString();
    const token = await sha256(pass + ':' + hourSlot);
    return json({ token, expires_in: 3600 });
  }

  // ── Public endpoints (no auth) ───────────────────────────

  // POST /api/errors ── error tracking (public, no auth needed)
  if (request.method === 'POST' && path === '/api/errors') {
    const db = env.DB;
    await ensureErrorTable(db);
    const body = await request.json().catch(() => ({}));
    const { site_id, error_type, message, stack, path: ePath } = body;
    if (!site_id || !error_type || !message) return err('Missing fields');
    // Dedup: gleicher Fehler max. 1x pro 10 Minuten speichern
    const dupe = await db.prepare(
      `SELECT id FROM error_logs WHERE site_id=? AND error_type=? AND message=? AND created_at > datetime('now','-10 minutes') LIMIT 1`
    ).bind(site_id, error_type, String(message).slice(0, 500)).first();
    if (dupe) return json({ success: true, skipped: true });
    await db.prepare(
      'INSERT INTO error_logs (site_id, error_type, message, stack, path) VALUES (?,?,?,?,?)'
    ).bind(
      site_id,
      error_type,
      String(message).slice(0, 500),
      stack ? String(stack).slice(0, 2000) : null,
      ePath || null
    ).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(site_id, 'error', `🚨 ${error_type}`, String(message).slice(0, 120)).run();
    return json({ success: true });
  }

  // POST /api/suggestions ── Public: anonymous suggestions with IP cooldown
  if (request.method === 'POST' && path === '/api/suggestions') {
    const db = env.DB;
    await ensureSuggestionsTable(db);
    const body = await request.json().catch(() => ({}));
    const { site_id, suggestion, category } = body;
    if (!suggestion || suggestion.trim().length < 5) return err('Vorschlag zu kurz (min. 5 Zeichen)');
    if (suggestion.length > 500) return err('Vorschlag zu lang (max. 500 Zeichen)');
    const siteId = (site_id || 'spinselector').slice(0, 30);
    // IP-based rate limiting: max 3 suggestions per IP per hour
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const ipHash = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientIp + ':hq-salt-2025'))
    )).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const recentCount = await db.prepare(
      `SELECT COUNT(*) as cnt FROM suggestions WHERE ip_hash=? AND created_at > datetime('now','-1 hour')`
    ).bind(ipHash).first();
    if ((recentCount?.cnt || 0) >= 3) return json({ error: 'Bitte warte eine Stunde bevor du weitere Vorschläge einreichst.' }, 429);
    await db.prepare('INSERT INTO suggestions (site_id, suggestion, category, ip_hash) VALUES (?,?,?,?)')
      .bind(siteId, suggestion.trim().slice(0, 500), (category || '').slice(0, 50), ipHash).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(siteId, 'info', '💡 Neuer Vorschlag', suggestion.trim().slice(0, 100)).run();
    return json({ success: true });
  }

  // POST /api/words ── public word requests from game sites
  if (request.method === 'POST' && path === '/api/words') {
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const { word, language, requester_email } = body;
    if (!word) return err('Missing word');
    await db.prepare('INSERT INTO word_requests (word, language, requester_email) VALUES (?,?,?)')
      .bind(word, language || 'de', requester_email || null).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind('wordify', 'info', `Wort-Anfrage: ${word}`, `Sprache: ${language || 'de'}`).run();
    return json({ success: true });
  }

  // GET /api/daily-word ── public (Wordify fetches today's word)
  if (request.method === 'GET' && path === '/api/daily-word') {
    const db = env.DB;
    await ensureTables(db);
    const lang = url.searchParams.get('lang') || 'de';
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const row = await db.prepare('SELECT word FROM daily_words WHERE date=? AND language=?')
      .bind(date, lang).first();
    return json({ word: row ? row.word.toUpperCase() : null, date, lang });
  }

  // POST /api/contact ── public (multi-site contact form)
  if (request.method === 'POST' && path === '/api/contact') {
    const db = env.DB;
    await ensureTables(db);
    const body = await request.json().catch(() => ({}));
    const { site_id, name, message, language } = body;
    const siteId = (site_id || 'wordify').slice(0, 30);
    if (!message || message.trim().length < 5) return err('Nachricht zu kurz (min. 5 Zeichen)');
    if (message.length > 1000) return err('Nachricht zu lang (max 1000 Zeichen)');
    await db.prepare('INSERT INTO contact_messages (site_id, name, message, language) VALUES (?,?,?,?)')
      .bind(siteId, (name || 'Anonym').slice(0, 60), message.trim(), language || 'de').run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(siteId, 'info', `✉️ Nachricht: ${(name || 'Anonym').slice(0, 30)}`, message.trim().slice(0, 80)).run();
    return json({ success: true });
  }

  // GET /api/changelog/published ── Public: published changelog entries
  if (request.method === 'GET' && path === '/api/changelog/published') {
    const db = env.DB;
    await ensureChangelogTable(db);
    const siteId = url.searchParams.get('site_id') || 'frametrain';
    const result = await db.prepare(
      'SELECT * FROM changelog_entries WHERE site_id=? AND published=1 ORDER BY created_at DESC'
    ).bind(siteId).all();
    return json(result.results);
  }

  // GET /api/blog/published ── Public: published blog posts
  if (request.method === 'GET' && path === '/api/blog/published') {
    const db = env.DB;
    const siteId = url.searchParams.get('site_id') || 'frametrain';
    const result = await db.prepare(
      'SELECT * FROM blog_posts WHERE site_id=? AND status=\'published\' ORDER BY created_at DESC'
    ).bind(siteId).all();
    return json(result.results);
  }

  // POST /api/support/submit ── Public: any site submits support tickets
  if (request.method === 'POST' && path === '/api/support/submit') {
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const { site_id, user_id, name, email, subject, message } = body;
    if (!subject || !message) return err('Betreff und Nachricht erforderlich');
    const siteId = (site_id || 'frametrain').slice(0, 40);
    const tokenRaw = `${email || user_id || 'anon'}:${Date.now()}:${Math.random()}`;
    const user_token = await sha256(tokenRaw);
    const result = await db.prepare(
      'INSERT INTO support_tickets (site_id, name, email, subject, message, priority, user_token, user_id) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(siteId, name || null, email || null, subject, message, 'normal', user_token, user_id || null).run();
    const ticketId = result.meta.last_row_id;
    await db.prepare('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)')
      .bind(ticketId, 'user', message).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
      .bind(siteId, 'info', `🎫 Neues Ticket: ${subject}`, `Von: ${name || email || 'Anonym'} – ${message.slice(0, 80)}`).run();
    return json({ success: true, ticket_id: ticketId, user_token });
  }

  // GET /api/support/:id/thread ── Public: get ticket thread by user_token
  if (request.method === 'GET' && segments[1] === 'support' && segments[2] && segments[3] === 'thread') {
    const db = env.DB;
    const ticketId = segments[2];
    const token = url.searchParams.get('token');
    if (!token) return err('Token required', 401);
    const ticket = await db.prepare('SELECT id, subject, status, created_at, updated_at FROM support_tickets WHERE id=? AND user_token=?').bind(ticketId, token).first();
    if (!ticket) return err('Ticket nicht gefunden oder Token ungültig', 404);
    const messages = await db.prepare('SELECT sender, message, created_at FROM support_messages WHERE ticket_id=? ORDER BY created_at ASC').bind(ticketId).all();
    return json({ ticket, messages: messages.results });
  }

  // POST /api/support/:id/reply ── Public: user replies to ticket
  if (request.method === 'POST' && segments[1] === 'support' && segments[2] && segments[3] === 'reply') {
    const db = env.DB;
    const ticketId = segments[2];
    const body = await request.json().catch(() => ({}));
    const { token, message } = body;
    if (!token || !message) return err('Token und Nachricht erforderlich');
    const ticket = await db.prepare('SELECT id, site_id FROM support_tickets WHERE id=? AND user_token=?').bind(ticketId, token).first();
    if (!ticket) return err('Ticket nicht gefunden oder Token ungültig', 404);
    await db.prepare('INSERT INTO support_messages (ticket_id, sender, message) VALUES (?,?,?)').bind(ticketId, 'user', message).run();
    await db.prepare("UPDATE support_tickets SET status='open', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
    await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)').bind(ticket.site_id, 'info', '💬 Neue Antwort', message.slice(0, 80)).run();
    return json({ success: true });
  }

  // GET /api/ratelimit-stats ── RateLimit DB stats (from RLDB binding)
  if (request.method === 'GET' && path === '/api/ratelimit-stats') {
    const rl = env.RLDB;
    if (!rl) return err('RLDB binding nicht konfiguriert', 503);
    const range = url.searchParams.get('range') || '24h';
    let hoursBack = 24;
    if (range === '7d')  hoursBack = 168;
    if (range === '30d') hoursBack = 720;
    const timeAgo = new Date(Date.now() - hoursBack * 3600000).toISOString();

    const [summary, hourly, topEndpoints, topIps, blockedTrend] = await Promise.all([
      rl.prepare(`
        SELECT
          COUNT(*) as total_requests,
          SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked_requests,
          COUNT(DISTINCT ip_address) as unique_ips
        FROM request_logs WHERE timestamp > ?`).bind(timeAgo).first(),
      rl.prepare(`
        SELECT strftime('%Y-%m-%d %H:00', timestamp) as hour,
          COUNT(*) as requests,
          SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked
        FROM request_logs WHERE timestamp > ?
        GROUP BY hour ORDER BY hour ASC LIMIT 168`).bind(timeAgo).all(),
      rl.prepare(`
        SELECT endpoint, COUNT(*) as count
        FROM request_logs WHERE timestamp > ?
        GROUP BY endpoint ORDER BY count DESC LIMIT 10`).bind(timeAgo).all(),
      rl.prepare(`
        SELECT ip_address, COUNT(*) as count,
          SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked
        FROM request_logs WHERE timestamp > ?
        GROUP BY ip_address ORDER BY count DESC LIMIT 10`).bind(timeAgo).all(),
      rl.prepare(`
        SELECT date(timestamp) as day,
          COUNT(*) as total,
          SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked
        FROM request_logs WHERE timestamp > ?
        GROUP BY day ORDER BY day ASC`).bind(timeAgo).all(),
    ]);

    const allTime = await rl.prepare(
      'SELECT COUNT(*) as total, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) as blocked FROM request_logs'
    ).first();

    return json({
      range,
      summary: summary || { total_requests: 0, blocked_requests: 0, unique_ips: 0 },
      all_time: allTime || { total: 0, blocked: 0 },
      hourly:   hourly.results   || [],
      daily:    blockedTrend.results || [],
      top_endpoints: topEndpoints.results || [],
      top_ips:       topIps.results       || [],
    });
  }

  // ── TODO TASKS ────────────────────────────────────────────────────

  // GET /api/todos
  if (request.method === 'GET' && path === '/api/todos') {
    const db = env.DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS todo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT DEFAULT '',
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER DEFAULT 3,
      due_date TEXT,
      important INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      steps TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`ALTER TABLE todo_tasks ADD COLUMN steps TEXT DEFAULT '[]'`).run().catch(() => {});
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM todo_tasks WHERE 1=1';
    const params = [];
    if (siteId !== null && siteId !== '') { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY done ASC, priority DESC, due_date ASC, sort_order ASC, created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // POST /api/todos
  if (request.method === 'POST' && path === '/api/todos') {
    const db = env.DB;
    await db.prepare(`CREATE TABLE IF NOT EXISTS todo_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT DEFAULT '',
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER DEFAULT 3,
      due_date TEXT,
      important INTEGER DEFAULT 0,
      done INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      steps TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`ALTER TABLE todo_tasks ADD COLUMN steps TEXT DEFAULT '[]'`).run().catch(() => {});
    const body = await request.json().catch(() => ({}));
    const { site_id, title, notes, priority, due_date, important } = body;
    if (!title) return err('Titel erforderlich');
    const r = await db.prepare(
      'INSERT INTO todo_tasks (site_id, title, notes, priority, due_date, important) VALUES (?,?,?,?,?,?)'
    ).bind(site_id || '', title, notes || null, priority || 3, due_date || null, important ? 1 : 0).run();
    return json({ success: true, id: r.meta.last_row_id });
  }

  // PATCH /api/todos/:id
  if (request.method === 'PATCH' && segments[1] === 'todos' && segments[2] && !segments[3]) {
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const sets = []; const params = [];
    if (body.title     !== undefined) { sets.push('title=?');      params.push(body.title); }
    if (body.notes     !== undefined) { sets.push('notes=?');      params.push(body.notes); }
    if (body.priority  !== undefined) { sets.push('priority=?');   params.push(body.priority); }
    if (body.due_date  !== undefined) { sets.push('due_date=?');   params.push(body.due_date); }
    if (body.important !== undefined) { sets.push('important=?');  params.push(body.important ? 1 : 0); }
    if (body.done      !== undefined) { sets.push('done=?');       params.push(body.done ? 1 : 0); }
    if (body.sort_order!== undefined) { sets.push('sort_order=?'); params.push(body.sort_order); }
    if (body.steps     !== undefined) { sets.push('steps=?');      params.push(typeof body.steps === 'string' ? body.steps : JSON.stringify(body.steps)); }
    if (!sets.length) return err('Nothing to update');
    await db.prepare(`UPDATE todo_tasks SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[2]).run();
    if (body.done !== undefined) {
      const task = await db.prepare('SELECT prompt_id FROM todo_tasks WHERE id=?').bind(segments[2]).first().catch(() => null);
      if (task?.prompt_id) {
        await db.prepare('UPDATE todo_prompts SET used=? WHERE id=?').bind(body.done ? 1 : 0, task.prompt_id).run();
      }
    }
    return json({ success: true });
  }

  // DELETE /api/todos/:id
  if (request.method === 'DELETE' && segments[1] === 'todos' && segments[2]) {
    await env.DB.prepare('DELETE FROM todo_tasks WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── PROMPTS ──────────────────────────────────────────────────────

  async function ensurePromptColumns(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS todo_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      tags TEXT DEFAULT '',
      prompt TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      task_id INTEGER,
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const col of ['used INTEGER DEFAULT 0', 'task_id INTEGER', 'archived INTEGER DEFAULT 0']) {
      await db.prepare(`ALTER TABLE todo_prompts ADD COLUMN ${col}`).run().catch(() => {});
    }
    await db.prepare(`ALTER TABLE todo_tasks ADD COLUMN prompt_id INTEGER`).run().catch(() => {});
  }

  // GET /api/prompts
  if (request.method === 'GET' && path === '/api/prompts') {
    const db = env.DB;
    await ensurePromptColumns(db);
    const result = await db.prepare('SELECT * FROM todo_prompts ORDER BY created_at DESC').all();
    return json(result.results);
  }

  // POST /api/prompts
  if (request.method === 'POST' && path === '/api/prompts') {
    const db = env.DB;
    await ensurePromptColumns(db);
    const body = await request.json().catch(() => ({}));
    if (!body.title || !body.prompt) return err('Titel und Prompt erforderlich');
    const existingTaskId = body.task_id ? parseInt(body.task_id) : null;
    const createTask = body.create_task !== false && !existingTaskId; // skip if task_id given or create_task=false
    const r = await db.prepare('INSERT INTO todo_prompts (title, tags, prompt, used, task_id) VALUES (?,?,?,0,?)')
      .bind(body.title, body.tags || '', body.prompt, existingTaskId).run();
    const promptId = r.meta.last_row_id;
    let taskId = existingTaskId;
    if (createTask) {
      const taskR = await db.prepare(
        'INSERT INTO todo_tasks (title, notes, priority, prompt_id) VALUES (?,?,3,?)'
      ).bind(body.title, body.prompt.slice(0, 500), promptId).run();
      taskId = taskR.meta.last_row_id;
      await db.prepare('UPDATE todo_prompts SET task_id=? WHERE id=?').bind(taskId, promptId).run();
    }
    return json({ success: true, id: promptId, task_id: taskId });
  }

  // PATCH /api/prompts/:id
  if (request.method === 'PATCH' && segments[1] === 'prompts' && segments[2]) {
    const db = env.DB;
    await ensurePromptColumns(db);
    const body = await request.json().catch(() => ({}));
    const sets = []; const params = [];
    if (body.title  !== undefined) { sets.push('title=?');  params.push(body.title); }
    if (body.tags   !== undefined) { sets.push('tags=?');   params.push(body.tags); }
    if (body.prompt !== undefined) { sets.push('prompt=?'); params.push(body.prompt); }
    if (body.used     !== undefined) { sets.push('used=?');     params.push(body.used ? 1 : 0); }
    if (body.archived  !== undefined) { sets.push('archived=?');  params.push(body.archived ? 1 : 0); }
    if (body.task_id   !== undefined) { sets.push('task_id=?');   params.push(body.task_id !== null ? body.task_id : null); }
    if (!sets.length) return err('Nothing to update');
    await db.prepare(`UPDATE todo_prompts SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[2]).run();
    if (body.used !== undefined) {
      const prompt = await db.prepare('SELECT task_id FROM todo_prompts WHERE id=?').bind(segments[2]).first();
      if (prompt?.task_id) {
        await db.prepare('UPDATE todo_tasks SET done=? WHERE id=?').bind(body.used ? 1 : 0, prompt.task_id).run();
      }
    }
    return json({ success: true });
  }

  // DELETE /api/prompts/:id
  if (request.method === 'DELETE' && segments[1] === 'prompts' && segments[2]) {
    const db = env.DB;
    const prompt = await db.prepare('SELECT task_id FROM todo_prompts WHERE id=?').bind(segments[2]).first().catch(() => null);
    if (prompt?.task_id) {
      await db.prepare('DELETE FROM todo_tasks WHERE id=? AND prompt_id IS NOT NULL').bind(prompt.task_id).run();
    }
    await db.prepare('DELETE FROM todo_prompts WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
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
    await ensureChangelogTable(db);
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
    await ensureChangelogTable(db);
    const body = await request.json();
    const { site_id, version, title, description, type, published } = body;
    if (!site_id || !title) return err('Missing fields');
    const ver = version || new Date().toISOString().slice(0, 10);
    await db.prepare(
      'INSERT INTO changelog_entries (site_id, version, title, description, type, published) VALUES (?,?,?,?,?,?)'
    ).bind(site_id, ver, title, description || null, type || 'feature', published ? 1 : 0).run();
    return json({ success: true });
  }

  // ── PATCH /api/changelog/:id (toggle published) ──────────────────
  if (request.method === 'PATCH' && segments[1] === 'changelog' && segments[2]) {
    await ensureChangelogTable(db);
    const body = await request.json().catch(() => ({}));
    if (body.published !== undefined) {
      await db.prepare('UPDATE changelog_entries SET published=? WHERE id=?').bind(body.published ? 1 : 0, segments[2]).run();
    }
    return json({ success: true });
  }

  // ── DELETE /api/changelog/:id ─────────────────────────────────────
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

  // ── GET /api/suggestions ──────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/suggestions') {
    await ensureSuggestionsTable(db);
    const status = url.searchParams.get('status');
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM suggestions WHERE 1=1';
    const params = [];
    if (status) { q += ' AND status=?'; params.push(status); }
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY read ASC, created_at DESC';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── PATCH /api/suggestions/:id ────────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'suggestions' && segments[2]) {
    await ensureSuggestionsTable(db);
    const body = await request.json();
    const { status, note, read } = body;
    const sets = []; const params = [];
    if (status !== undefined) { sets.push('status=?'); params.push(status); }
    if (note   !== undefined) { sets.push('note=?');   params.push(note); }
    if (read   !== undefined) { sets.push('read=?');   params.push(read ? 1 : 0); }
    if (!sets.length) return err('Nothing to update');
    await db.prepare(`UPDATE suggestions SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/errors ───────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/errors') {
    await ensureErrorTable(db);
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM error_logs WHERE 1=1';
    const params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC LIMIT 200';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
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

    let q1 = `SELECT event_type, COUNT(*) as count FROM analytics_events WHERE created_at >= datetime('now', '-${days} days')`;
    const params1 = [];
    if (siteId) { q1 += ' AND site_id=?'; params1.push(siteId); }
    q1 += ' GROUP BY event_type';

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

  // ── GET /api/contact ──────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/contact') {
    await ensureTables(db);
    const siteId = url.searchParams.get('site_id');
    let q = 'SELECT * FROM contact_messages WHERE 1=1';
    const params = [];
    if (siteId) { q += ' AND site_id=?'; params.push(siteId); }
    q += ' ORDER BY created_at DESC LIMIT 200';
    const result = await db.prepare(q).bind(...params).all();
    return json(result.results);
  }

  // ── PATCH /api/contact/:id/read ──────────────────────────────────
  if (request.method === 'PATCH' && segments[1] === 'contact' && segments[3] === 'read') {
    await db.prepare('UPDATE contact_messages SET read=1 WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── GET /api/cf-site-analytics ── CF Web Analytics per Site ──────────
  if (request.method === 'GET' && path === '/api/cf-site-analytics') {
    const cfToken = request.headers.get('CF-Token');
    if (!cfToken) return err('CF-Token Header fehlt', 400);

    const accountId = '75ab77c2ccd4045de59e99835480bc53';
    const range  = url.searchParams.get('range') || '7d';
    const days   = range === '30d' ? 30 : 7;
    const now    = new Date();
    const startDt  = new Date(now.getTime() - days * 24 * 3600000).toISOString();
    const endDt    = now.toISOString();
    const startDay = startDt.slice(0, 10);
    const endDay   = endDt.slice(0, 10);
    const cfH = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfToken}` };

    try {
      // 1. Parallel: Zones + Web Analytics Sites
      const [zonesRes, waRes] = await Promise.all([
        fetch(`https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&per_page=50`, { headers: cfH }),
        fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/web-analytics/sites?per_page=100`, { headers: cfH }),
      ]);
      const [zonesJson, waJson] = await Promise.all([zonesRes.json(), waRes.json()]);

      const zones   = zonesJson.result || [];
      const waSites = Array.isArray(waJson.result) ? waJson.result : (waJson.result?.data || []);

      // hostname -> Web Analytics siteTag
      const hostToWaTag = {};
      waSites.forEach(s => {
        const h = s.host || s.hostname || '';
        const t = s.id   || s.site_tag || s.siteTag || '';
        if (h && t) hostToWaTag[h] = t;
      });

      // hostname -> zone ID (fuer Custom Domains)
      const hostToZoneId = {};
      zones.forEach(z => { if (z.name && z.id) hostToZoneId[z.name] = z.id; });

      const result = {}; // hostname -> { by_day: [{day, views}] }

      // 2. RUM Pageviews per Web Analytics Site (parallel)
      await Promise.all(Object.entries(hostToWaTag).map(async ([host, tag]) => {
        const q = JSON.stringify({ query:
          `{viewer{accounts(filter:{accountTag:"${accountId}"}){` +
          `rumPageloadEventsAdaptiveGroups(limit:200 ` +
          `filter:{AND:[{datetime_geq:"${startDt}"},{datetime_leq:"${endDt}"},{siteTag:"${tag}"}]} ` +
          `orderBy:[date_ASC]){sum{visits pageViews}dimensions{date}}}}}` });
        try {
          const r  = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: cfH, body: q });
          const d  = await r.json();
          const gs = d?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups || [];
          if (gs.length > 0) {
            result[host] = {
              by_day: gs
                .map(g => ({ day: g.dimensions?.date || '', views: g.sum?.pageViews || g.sum?.visits || 0 }))
                .filter(x => x.day),
            };
          }
        } catch(_) {}
      }));

      // 3. Zone HTTP Analytics fuer Custom Domains (ueberschreibt RUM wenn vorhanden)
      await Promise.all(Object.entries(hostToZoneId).map(async ([host, zoneId]) => {
        const q = JSON.stringify({ query:
          `{viewer{zones(filter:{zoneTag:"${zoneId}"}){` +
          `httpRequestsAdaptiveGroups(limit:200 ` +
          `filter:{AND:[{date_geq:"${startDay}"},{date_leq:"${endDay}"},{requestSource:"eyeball"}]} ` +
          `orderBy:[date_ASC]){sum{requests pageViews}dimensions{date}}}}}` });
        try {
          const r  = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: cfH, body: q });
          const d  = await r.json();
          const gs = d?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
          if (gs.length > 0) {
            result[host] = {
              by_day: gs
                .map(g => ({ day: g.dimensions?.date || '', views: g.sum?.pageViews || g.sum?.requests || 0 }))
                .filter(x => x.day),
            };
          }
        } catch(_) {}
      }));

      return json(result);
    } catch(e) {
      return err('CF Site Analytics fehlgeschlagen: ' + e.message, 502);
    }
  }

  // ── GET /api/cf-analytics ── Cloudflare GraphQL Proxy ──────────
  if (request.method === 'GET' && path === '/api/cf-analytics') {
    const cfToken = request.headers.get('CF-Token');
    if (!cfToken) return err('CF-Token Header fehlt', 400);
    const accountId = '75ab77c2ccd4045de59e99835480bc53';
    const workerName = 'webcontrol-hq-api';
    const now = new Date();
    const start = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const end = now.toISOString();
    const query = `{viewer{accounts(filter:{accountTag:"${accountId}"}){workersInvocationsAdaptive(limit:1 filter:{scriptName:"${workerName}" datetime_geq:"${start}" datetime_leq:"${end}"}){sum{requests errors subrequests}quantiles{cpuTimeP50 cpuTimeP99}}}}}`;
    try {
      const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfToken}` },
        body: JSON.stringify({ query }),
      });
      const data = await r.json();
      if (data.errors) return err(data.errors[0]?.message || 'CF GraphQL Fehler', 502);
      const inv = data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0];
      if (!inv) return json({ requests: 0, errors: 0, subrequests: 0, cpuP50: 0, cpuP99: 0 });
      return json({
        requests:    inv.sum.requests,
        errors:      inv.sum.errors,
        subrequests: inv.sum.subrequests,
        cpuP50:      inv.quantiles.cpuTimeP50,
        cpuP99:      inv.quantiles.cpuTimeP99,
      });
    } catch(e) {
      return err('CF fetch fehlgeschlagen: ' + e.message, 502);
    }
  }

  // ── GET /api/stats ────────────────────────────────────────────────
  if (request.method === 'GET' && path === '/api/stats') {
    const tickets = await db.prepare("SELECT status, COUNT(*) as c FROM support_tickets GROUP BY status").all();
    const errors = await db.prepare("SELECT resolved, COUNT(*) as c FROM error_logs GROUP BY resolved").all();
    const words = await db.prepare("SELECT status, COUNT(*) as c FROM word_requests GROUP BY status").all();
    const notifs = await db.prepare("SELECT read, COUNT(*) as c FROM notifications GROUP BY read").all();
    return json({ tickets: tickets.results, errors: errors.results, words: words.results, notifs: notifs.results });
  }

  // ── BLOG API ─────────────────────────────────────────────────────
  async function ensureBlogTable(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      title TEXT NOT NULL,
      tags TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      content TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const col of ['tags TEXT DEFAULT \'\'', 'excerpt TEXT DEFAULT \'\'', 'content TEXT DEFAULT \'\'', "lang TEXT DEFAULT 'de'"]) {
      await db.prepare(`ALTER TABLE blog_posts ADD COLUMN ${col}`).run().catch(() => {});
    }
  }

  // GET /api/blog/published – public
  if (request.method === 'GET' && path === '/api/blog/published') {
    await ensureBlogTable(db);
    const siteId = url.searchParams.get('site_id') || '';
    const lang   = url.searchParams.get('lang') || '';
    let q = "SELECT * FROM blog_posts WHERE site_id=? AND status='published'";
    const binds = [siteId];
    if (lang) { q += ' AND lang=?'; binds.push(lang); }
    q += ' ORDER BY created_at DESC';
    const result = await db.prepare(q).bind(...binds).all();
    return json(result.results);
  }

  // GET /api/blog – authenticated
  if (request.method === 'GET' && path === '/api/blog') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    await ensureBlogTable(db);
    const siteId = url.searchParams.get('site_id') || '';
    const result = await db.prepare(
      'SELECT * FROM blog_posts WHERE site_id=? ORDER BY created_at DESC'
    ).bind(siteId).all();
    return json(result.results);
  }

  // POST /api/blog – authenticated
  if (request.method === 'POST' && path === '/api/blog') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    await ensureBlogTable(db);
    const body = await request.json().catch(() => ({}));
    const { site_id, title, tags, excerpt, content, status, lang } = body;
    if (!site_id || !title) return err('site_id und title erforderlich');
    const r = await db.prepare(
      'INSERT INTO blog_posts (site_id, title, tags, excerpt, content, status, lang) VALUES (?,?,?,?,?,?,?)'
    ).bind(site_id, title, tags || '', excerpt || '', content || '', status || 'draft', lang || 'de').run();
    if (status === 'published') {
      await db.prepare('INSERT INTO notifications (site_id, type, title, message) VALUES (?,?,?,?)')
        .bind(site_id, 'info', `📝 Blog: ${title}`, 'Neuer Artikel veröffentlicht auf /blog').run();
    }
    return json({ success: true, id: r.meta.last_row_id });
  }

  // PATCH /api/blog/:id – authenticated
  if (request.method === 'PATCH' && segments[1] === 'blog' && segments[2] && !segments[3]) {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    await ensureBlogTable(db);
    const body = await request.json().catch(() => ({}));
    const sets = []; const params = [];
    if (body.title   !== undefined) { sets.push('title=?');   params.push(body.title); }
    if (body.tags    !== undefined) { sets.push('tags=?');    params.push(body.tags); }
    if (body.excerpt !== undefined) { sets.push('excerpt=?'); params.push(body.excerpt); }
    if (body.content !== undefined) { sets.push('content=?'); params.push(body.content); }
    if (body.status  !== undefined) { sets.push('status=?');  params.push(body.status); }
    if (body.lang    !== undefined) { sets.push('lang=?');    params.push(body.lang); }
    if (!sets.length) return err('Nothing to update');
    await db.prepare(`UPDATE blog_posts SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[2]).run();
    return json({ success: true });
  }

  // DELETE /api/blog/:id – authenticated
  if (request.method === 'DELETE' && segments[1] === 'blog' && segments[2] && !segments[3]) {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    await db.prepare('DELETE FROM blog_posts WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── VAULT ─────────────────────────────────────────────────────────────
  // All secret values are AES-GCM encrypted client-side before storage.
  // The worker only handles opaque blobs – it cannot decrypt anything.

  async function ensureVaultTable(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS vault_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      site_id TEXT DEFAULT '',
      category TEXT DEFAULT 'other',
      username TEXT DEFAULT '',
      encrypted_value TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const col of ['username TEXT DEFAULT \'\'', 'notes TEXT DEFAULT \'\'']) {
      await db.prepare(`ALTER TABLE vault_entries ADD COLUMN ${col}`).run().catch(() => {});
    }
  }

  // GET /api/vault
  if (request.method === 'GET' && path === '/api/vault') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const db = env.DB;
    await ensureVaultTable(db);
    const res = await db.prepare('SELECT * FROM vault_entries ORDER BY site_id ASC, label ASC').all();
    return json(res.results);
  }

  // POST /api/vault
  if (request.method === 'POST' && path === '/api/vault') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const db = env.DB;
    await ensureVaultTable(db);
    const body = await request.json().catch(() => ({}));
    if (!body.label || !body.encrypted_value) return err('label und encrypted_value erforderlich');
    const r = await db.prepare(
      'INSERT INTO vault_entries (label, site_id, category, username, encrypted_value, notes) VALUES (?,?,?,?,?,?)'
    ).bind(
      body.label, body.site_id || '', body.category || 'other',
      body.username || '', body.encrypted_value, body.notes || ''
    ).run();
    return json({ success: true, id: r.meta.last_row_id });
  }

  // PATCH /api/vault/:id
  if (request.method === 'PATCH' && segments[1] === 'vault' && segments[2] && !segments[3]) {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const db = env.DB;
    const body = await request.json().catch(() => ({}));
    const sets = ['updated_at=CURRENT_TIMESTAMP']; const params = [];
    if (body.label           !== undefined) { sets.push('label=?');           params.push(body.label); }
    if (body.site_id         !== undefined) { sets.push('site_id=?');         params.push(body.site_id); }
    if (body.category        !== undefined) { sets.push('category=?');        params.push(body.category); }
    if (body.username        !== undefined) { sets.push('username=?');        params.push(body.username); }
    if (body.encrypted_value !== undefined) { sets.push('encrypted_value=?'); params.push(body.encrypted_value); }
    if (body.notes           !== undefined) { sets.push('notes=?');           params.push(body.notes); }
    if (params.length === 0) return err('Nothing to update');
    await db.prepare(`UPDATE vault_entries SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[2]).run();
    return json({ success: true });
  }

  // DELETE /api/vault/:id
  if (request.method === 'DELETE' && segments[1] === 'vault' && segments[2] && !segments[3]) {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const db = env.DB;
    await db.prepare('DELETE FROM vault_entries WHERE id=?').bind(segments[2]).run();
    return json({ success: true });
  }

  // ── PINBOARD ───────────────────────────────────────────────────────

  async function ensurePinboardTables(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS pinboard_boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      icon TEXT DEFAULT 'layout-grid',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS pinboard_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      type TEXT DEFAULT 'idea',
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      color TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      sub_items TEXT DEFAULT '[]',
      todo_task_id INTEGER,
      pinned INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    for (const col of ['color TEXT DEFAULT \'\'', 'pinned INTEGER DEFAULT 0', 'sort_order INTEGER DEFAULT 0']) {
      await db.prepare(`ALTER TABLE pinboard_pins ADD COLUMN ${col}`).run().catch(() => {});
    }
  }

  // GET /api/pinboard/boards
  if (request.method === 'GET' && path === '/api/pinboard/boards') {
    await ensurePinboardTables(env.DB);
    const res = await env.DB.prepare('SELECT * FROM pinboard_boards ORDER BY sort_order ASC, created_at ASC').all();
    return json(res.results);
  }

  // POST /api/pinboard/boards
  if (request.method === 'POST' && path === '/api/pinboard/boards') {
    await ensurePinboardTables(env.DB);
    const body = await request.json().catch(() => ({}));
    if (!body.title) return err('Titel erforderlich');
    const r = await env.DB.prepare(
      'INSERT INTO pinboard_boards (title, color, icon, sort_order) VALUES (?,?,?,?)'
    ).bind(body.title, body.color || '#3b82f6', body.icon || 'layout-grid', body.sort_order || 0).run();
    return json({ success: true, id: r.meta.last_row_id });
  }

  // PATCH /api/pinboard/boards/:id
  if (request.method === 'PATCH' && segments[1] === 'pinboard' && segments[2] === 'boards' && segments[3]) {
    await ensurePinboardTables(env.DB);
    const body = await request.json().catch(() => ({}));
    const sets = []; const params = [];
    if (body.title      !== undefined) { sets.push('title=?');      params.push(body.title); }
    if (body.color      !== undefined) { sets.push('color=?');      params.push(body.color); }
    if (body.icon       !== undefined) { sets.push('icon=?');       params.push(body.icon); }
    if (body.sort_order !== undefined) { sets.push('sort_order=?'); params.push(body.sort_order); }
    if (!sets.length) return err('Nothing to update');
    await env.DB.prepare(`UPDATE pinboard_boards SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[3]).run();
    return json({ success: true });
  }

  // DELETE /api/pinboard/boards/:id
  if (request.method === 'DELETE' && segments[1] === 'pinboard' && segments[2] === 'boards' && segments[3]) {
    await env.DB.prepare('DELETE FROM pinboard_pins WHERE board_id=?').bind(segments[3]).run();
    await env.DB.prepare('DELETE FROM pinboard_boards WHERE id=?').bind(segments[3]).run();
    return json({ success: true });
  }

  // GET /api/pinboard/pins?board_id=
  if (request.method === 'GET' && path === '/api/pinboard/pins') {
    await ensurePinboardTables(env.DB);
    const boardId = url.searchParams.get('board_id');
    let q = 'SELECT * FROM pinboard_pins WHERE 1=1';
    const params = [];
    if (boardId) { q += ' AND board_id=?'; params.push(boardId); }
    q += ' ORDER BY pinned DESC, sort_order ASC, created_at DESC';
    const res = await env.DB.prepare(q).bind(...params).all();
    return json(res.results);
  }

  // POST /api/pinboard/pins
  if (request.method === 'POST' && path === '/api/pinboard/pins') {
    await ensurePinboardTables(env.DB);
    const body = await request.json().catch(() => ({}));
    if (!body.title || !body.board_id) return err('Titel und Board erforderlich');
    // Optional: create linked todo
    let todoTaskId = body.todo_task_id || null;
    if (body.create_todo && !todoTaskId) {
      const tr = await env.DB.prepare(
        'INSERT INTO todo_tasks (title, notes, priority) VALUES (?,?,3)'
      ).bind(body.title, body.content || null).run();
      todoTaskId = tr.meta.last_row_id;
    }
    const r = await env.DB.prepare(
      'INSERT INTO pinboard_pins (board_id, type, title, content, color, tags, sub_items, todo_task_id, pinned, sort_order) VALUES (?,?,?,?,?,?,?,?,0,0)'
    ).bind(
      body.board_id, body.type || 'idea', body.title,
      body.content || '', body.color || '',
      body.tags || '', body.sub_items ? JSON.stringify(body.sub_items) : '[]',
      todoTaskId
    ).run();
    return json({ success: true, id: r.meta.last_row_id, todo_task_id: todoTaskId });
  }

  // PATCH /api/pinboard/pins/:id
  if (request.method === 'PATCH' && segments[1] === 'pinboard' && segments[2] === 'pins' && segments[3]) {
    const body = await request.json().catch(() => ({}));
    const sets = []; const params = [];
    if (body.title        !== undefined) { sets.push('title=?');        params.push(body.title); }
    if (body.content      !== undefined) { sets.push('content=?');      params.push(body.content); }
    if (body.type         !== undefined) { sets.push('type=?');         params.push(body.type); }
    if (body.color        !== undefined) { sets.push('color=?');        params.push(body.color); }
    if (body.tags         !== undefined) { sets.push('tags=?');         params.push(body.tags); }
    if (body.sub_items    !== undefined) { sets.push('sub_items=?');    params.push(typeof body.sub_items === 'string' ? body.sub_items : JSON.stringify(body.sub_items)); }
    if (body.todo_task_id !== undefined) { sets.push('todo_task_id=?'); params.push(body.todo_task_id); }
    if (body.pinned       !== undefined) { sets.push('pinned=?');       params.push(body.pinned ? 1 : 0); }
    if (body.sort_order   !== undefined) { sets.push('sort_order=?');   params.push(body.sort_order); }
    if (body.board_id     !== undefined) { sets.push('board_id=?');     params.push(body.board_id); }
    if (!sets.length) return err('Nothing to update');
    await env.DB.prepare(`UPDATE pinboard_pins SET ${sets.join(',')} WHERE id=?`).bind(...params, segments[3]).run();
    return json({ success: true });
  }

  // DELETE /api/pinboard/pins/:id
  if (request.method === 'DELETE' && segments[1] === 'pinboard' && segments[2] === 'pins' && segments[3]) {
    await env.DB.prepare('DELETE FROM pinboard_pins WHERE id=?').bind(segments[3]).run();
    return json({ success: true });
  }

  // ── DB EXPLORER ───────────────────────────────────────────────────
  const EXPLORER_TABLES = [
    'todo_tasks', 'todo_prompts', 'notifications', 'support_tickets',
    'support_messages', 'error_logs', 'suggestions', 'changelog_entries',
    'blog_posts', 'analytics_events', 'daily_words', 'contact_messages',
    'word_requests', 'sites',
  ];

  // GET /api/db/tables
  if (request.method === 'GET' && path === '/api/db/tables') {
    const tableInfos = await Promise.all(EXPLORER_TABLES.map(async t => {
      try {
        const count  = await db.prepare(`SELECT COUNT(*) as c FROM ${t}`).first().catch(() => ({ c: 0 }));
        const schema = await db.prepare(`PRAGMA table_info(${t})`).all().catch(() => ({ results: [] }));
        return { name: t, count: count?.c ?? 0, columns: schema.results.map(c => ({ name: c.name, type: c.type, pk: c.pk, notnull: c.notnull, dflt_value: c.dflt_value })) };
      } catch(e) { return null; }
    }));
    return json(tableInfos.filter(Boolean));
  }

  // GET /api/db/:table
  if (request.method === 'GET' && segments[1] === 'db' && segments[2] && !segments[3]) {
    const table = segments[2];
    if (!EXPLORER_TABLES.includes(table)) return err('Table not allowed', 403);
    const limit    = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 500);
    const offset   = parseInt(url.searchParams.get('offset')  || '0');
    const orderBy  = url.searchParams.get('order_by')  || 'id';
    const orderDir = url.searchParams.get('order_dir') === 'asc' ? 'ASC' : 'DESC';
    const search    = url.searchParams.get('search')    || '';
    const filterCol = url.searchParams.get('filter_col') || '';
    const filterVal = url.searchParams.get('filter_val') || '';
    const schema = await db.prepare(`PRAGMA table_info(${table})`).all();
    const cols   = schema.results.map(c => c.name);
    let where = '1=1';
    const params = [];
    if (filterCol && cols.includes(filterCol) && filterVal !== '') {
      where += ` AND ${filterCol}=?`; params.push(filterVal);
    } else if (search) {
      const textCols = schema.results
        .filter(c => (c.type||'').toUpperCase().includes('TEXT') || ['title','message','name','email','subject','suggestion','word','prompt','description','content'].includes(c.name))
        .map(c => c.name);
      if (textCols.length) {
        where += ` AND (${textCols.map(c => `${c} LIKE ?`).join(' OR ')})`;
        textCols.forEach(() => params.push(`%${search}%`));
      }
    }
    const validOrder = cols.includes(orderBy) ? orderBy : (cols.includes('id') ? 'id' : cols[0]);
    const [rows, cnt] = await Promise.all([
      db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${validOrder} ${orderDir} LIMIT ? OFFSET ?`)
        .bind(...params, limit, offset).all(),
      db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${where}`).bind(...params).first(),
    ]);
    return json({ rows: rows.results, total: cnt?.c ?? 0, columns: schema.results, limit, offset });
  }

  // POST /api/db/:table (insert row)
  if (request.method === 'POST' && segments[1] === 'db' && segments[2] && !segments[3]) {
    const table = segments[2];
    if (!EXPLORER_TABLES.includes(table)) return err('Table not allowed', 403);
    const body   = await request.json().catch(() => ({}));
    const schema = await db.prepare(`PRAGMA table_info(${table})`).all();
    const cols   = schema.results.filter(c => !c.pk).map(c => c.name);
    const ins    = cols.filter(c => body[c] !== undefined && body[c] !== '');
    if (!ins.length) return err('No valid fields provided');
    const r = await db.prepare(
      `INSERT INTO ${table} (${ins.join(',')}) VALUES (${ins.map(() => '?').join(',')})`
    ).bind(...ins.map(c => body[c])).run();
    return json({ success: true, id: r.meta.last_row_id });
  }

  // PATCH /api/db/:table/:id (update row)
  if (request.method === 'PATCH' && segments[1] === 'db' && segments[2] && segments[3] && !segments[4]) {
    const table = segments[2];
    if (!EXPLORER_TABLES.includes(table)) return err('Table not allowed', 403);
    const body   = await request.json().catch(() => ({}));
    const schema = await db.prepare(`PRAGMA table_info(${table})`).all();
    const cols   = schema.results.filter(c => !c.pk).map(c => c.name);
    const upd    = cols.filter(c => body[c] !== undefined);
    if (!upd.length) return err('Nothing to update');
    await db.prepare(
      `UPDATE ${table} SET ${upd.map(c => `${c}=?`).join(',')} WHERE id=?`
    ).bind(...upd.map(c => body[c] === '' ? null : body[c]), segments[3]).run();
    return json({ success: true });
  }

  // DELETE /api/db/:table/:id
  if (request.method === 'DELETE' && segments[1] === 'db' && segments[2] && segments[3]) {
    const table = segments[2];
    if (!EXPLORER_TABLES.includes(table)) return err('Table not allowed', 403);
    await db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(segments[3]).run();
    return json({ success: true });
  }

  // ── RLDB EXPLORER (ratelimit-db) ─────────────────────────────────
  // Discover tables dynamically from sqlite_master
  async function d1Explorer(d1db, segments, url, method, request) {
    if (method === 'GET' && segments[0] === 'tables') {
      // List all tables
      const tables = await d1db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
      ).all();
      const infos = await Promise.all(tables.results.map(async t => {
        const count  = await d1db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).first().catch(() => ({ c: 0 }));
        const schema = await d1db.prepare(`PRAGMA table_info("${t.name}")`).all().catch(() => ({ results: [] }));
        return {
          name: t.name,
          count: count?.c ?? 0,
          columns: schema.results.map(c => ({ name: c.name, type: c.type, pk: c.pk, notnull: c.notnull, dflt_value: c.dflt_value }))
        };
      }));
      return json(infos);
    }
    if (method === 'GET' && segments[0] && segments[0] !== 'tables' && !segments[1]) {
      const table = segments[0];
      // Validate table exists
      const exists = await d1db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).first();
      if (!exists) return err('Table not found', 404);
      const limit    = Math.min(parseInt(url.searchParams.get('limit')  || '100'), 500);
      const offset   = parseInt(url.searchParams.get('offset')  || '0');
      const orderBy  = url.searchParams.get('order_by')  || 'id';
      const orderDir = url.searchParams.get('order_dir') === 'asc' ? 'ASC' : 'DESC';
      const search    = url.searchParams.get('search')    || '';
      const filterCol = url.searchParams.get('filter_col') || '';
      const filterVal = url.searchParams.get('filter_val') || '';
      const schema = await d1db.prepare(`PRAGMA table_info("${table}")`).all();
      const cols   = schema.results.map(c => c.name);
      let where = '1=1';
      const params = [];
      if (filterCol && cols.includes(filterCol) && filterVal !== '') {
        where += ` AND \"${filterCol}\"=?`; params.push(filterVal);
      } else if (search) {
        const textCols = schema.results
          .filter(c => (c.type||'').toUpperCase().includes('TEXT') || ['title','message','name','email','subject','suggestion','word','prompt','description','content','ip_address','endpoint','path','correction','input','output','error'].includes(c.name))
          .map(c => c.name);
        if (textCols.length) {
          where += ` AND (${textCols.map(c => `\"${c}\" LIKE ?`).join(' OR ')})`;
          textCols.forEach(() => params.push(`%${search}%`));
        }
      }
      const validOrder = cols.includes(orderBy) ? `\"${orderBy}\"` : (cols.includes('id') ? '"id"' : `\"${cols[0]}\"`);
      const [rows, cnt] = await Promise.all([
        d1db.prepare(`SELECT * FROM \"${table}\" WHERE ${where} ORDER BY ${validOrder} ${orderDir} LIMIT ? OFFSET ?`)
          .bind(...params, limit, offset).all(),
        d1db.prepare(`SELECT COUNT(*) as c FROM \"${table}\" WHERE ${where}`).bind(...params).first(),
      ]);
      return json({ rows: rows.results, total: cnt?.c ?? 0, columns: schema.results, limit, offset });
    }
    if (method === 'POST' && segments[0] && !segments[1]) {
      const table = segments[0];
      const exists = await d1db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).first();
      if (!exists) return err('Table not found', 404);
      const body   = await request.json().catch(() => ({}));
      const schema = await d1db.prepare(`PRAGMA table_info(\"${table}\")`).all();
      const cols   = schema.results.filter(c => !c.pk).map(c => c.name);
      const ins    = cols.filter(c => body[c] !== undefined && body[c] !== '');
      if (!ins.length) return err('No valid fields');
      const r = await d1db.prepare(
        `INSERT INTO \"${table}\" (${ins.map(c=>`\"${c}\"`).join(',')}) VALUES (${ins.map(()=>'?').join(',')})`
      ).bind(...ins.map(c => body[c])).run();
      return json({ success: true, id: r.meta.last_row_id });
    }
    if (method === 'PATCH' && segments[0] && segments[1]) {
      const table = segments[0];
      const exists = await d1db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).first();
      if (!exists) return err('Table not found', 404);
      const body   = await request.json().catch(() => ({}));
      const schema = await d1db.prepare(`PRAGMA table_info(\"${table}\")`).all();
      const cols   = schema.results.filter(c => !c.pk).map(c => c.name);
      const upd    = cols.filter(c => body[c] !== undefined);
      if (!upd.length) return err('Nothing to update');
      await d1db.prepare(
        `UPDATE \"${table}\" SET ${upd.map(c=>`\"${c}\"=?`).join(',')} WHERE id=?`
      ).bind(...upd.map(c => body[c] === '' ? null : body[c]), segments[1]).run();
      return json({ success: true });
    }
    if (method === 'DELETE' && segments[0] && segments[1]) {
      const table = segments[0];
      const exists = await d1db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(table).first();
      if (!exists) return err('Table not found', 404);
      await d1db.prepare(`DELETE FROM \"${table}\" WHERE id=?`).bind(segments[1]).run();
      return json({ success: true });
    }
    return err('Not found', 404);
  }

  // ── SUPABASE PROXY ───────────────────────────────────────────────
  // Browser → Worker → Supabase REST API
  // Keys stored as Wrangler secrets: SUPABASE_FT_KEY, SUPABASE_FS_KEY
  // Set via: npx wrangler secret put SUPABASE_FT_KEY
  //          npx wrangler secret put SUPABASE_FS_KEY
  if (segments[1] === 'supabase') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);

    const SB_DBS = {
      frametrain:  { ref: 'pmilxbuzfghbphjjaiar', keyEnv: 'SUPABASE_FT_KEY' },
      framesphere: { ref: 'pvvxqiervpdopjzszrzj', keyEnv: 'SUPABASE_FS_KEY' },
    };

    const dbSlug = segments[2];
    const sbCfg  = SB_DBS[dbSlug];
    if (!sbCfg) return err('Unbekannte Supabase-Datenbank', 404);

    const sbKey = env[sbCfg.keyEnv];
    if (!sbKey) return err(`Secret ${sbCfg.keyEnv} nicht konfiguriert. Bitte: npx wrangler secret put ${sbCfg.keyEnv}`, 503);

    const sbBase = `https://${sbCfg.ref}.supabase.co`;
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };

    // GET /api/supabase/:db/tables  →  list all tables + counts + schema
    if (request.method === 'GET' && segments[3] === 'tables') {
      // Fetch OpenAPI spec from Supabase
      const specR = await fetch(`${sbBase}/rest/v1/`, { headers: sbHeaders });
      if (!specR.ok) return err(`Supabase spec error ${specR.status}`, 502);
      const spec   = await specR.json();
      const tableNames = Object.keys(spec.paths || {})
        .map(p => p.replace(/^\//, ''))
        .filter(n => n && !n.includes('{') && !n.startsWith('rpc/'));

      const infos = await Promise.all(tableNames.map(async name => {
        try {
          const cr = await fetch(`${sbBase}/rest/v1/${name}?select=*&limit=0`, {
            headers: { ...sbHeaders, Prefer: 'count=exact' }
          });
          const range = cr.headers.get('Content-Range') || '';
          const total = parseInt((range.split('/')[1] || '0'), 10);
          // Build columns from OpenAPI definition
          const def  = spec.definitions?.[name];
          const columns = def?.properties
            ? Object.entries(def.properties).map(([k, v]) => ({
                name: k,
                type: v.format || v.type || 'any',
                pk:   (def['x-pk'] || []).includes(k) || k === 'id',
                notnull: false
              }))
            : [];
          return { name, count: isNaN(total) ? 0 : total, columns };
        } catch { return { name, count: 0, columns: [] }; }
      }));
      return json(infos);
    }

    // GET /api/supabase/:db/:table?limit=&offset=&order_by=&order_dir=&search=&filter_col=&filter_val=
    if (request.method === 'GET' && segments[3] && !segments[4]) {
      const table     = segments[3];
      const limit     = Math.min(parseInt(url.searchParams.get('limit')   || '100'), 500);
      const offset    = parseInt(url.searchParams.get('offset')   || '0');
      const orderBy   = url.searchParams.get('order_by')  || 'id';
      const orderDir  = url.searchParams.get('order_dir') === 'asc' ? 'asc' : 'desc';
      const search    = url.searchParams.get('search')    || '';
      const filterCol = url.searchParams.get('filter_col') || '';
      const filterVal = url.searchParams.get('filter_val') || '';

      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('limit',  limit);
      params.set('offset', offset);
      params.set('order',  `${orderBy}.${orderDir}`);
      if (filterCol && filterVal) {
        params.set(filterCol, `eq.${filterVal}`);
      } else if (search) {
        // Use textSearch on common text columns
        const textCols = ['title','name','message','content','email','description','subject','body','text','label','notes'];
        params.set(textCols[0], `ilike.*${search}*`); // best-effort, single column
      }

      const r = await fetch(`${sbBase}/rest/v1/${table}?${params}`, {
        headers: { ...sbHeaders, Prefer: 'count=exact' }
      });
      if (!r.ok) return err(`Supabase ${r.status}: ${(await r.text()).slice(0,100)}`, 502);
      const rows  = await r.json();
      const range = r.headers.get('Content-Range') || '';
      const total = parseInt((range.split('/')[1] || String(rows.length)), 10);
      // Build schema from first row
      const columns = rows.length
        ? Object.keys(rows[0]).map(k => ({ name: k, type: 'any', pk: k === 'id', notnull: false }))
        : [];
      return json({ rows, total: isNaN(total) ? rows.length : total, columns, limit, offset });
    }

    // POST /api/supabase/:db/:table  (insert)
    if (request.method === 'POST' && segments[3] && !segments[4]) {
      const table = segments[3];
      const body  = await request.json().catch(() => ({}));
      const r = await fetch(`${sbBase}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return err(`Supabase ${r.status}: ${(await r.text()).slice(0,100)}`, 502);
      return json({ success: true });
    }

    // PATCH /api/supabase/:db/:table/:id  (update)
    if (request.method === 'PATCH' && segments[3] && segments[4]) {
      const table = segments[3];
      const id    = segments[4];
      const body  = await request.json().catch(() => ({}));
      const r = await fetch(`${sbBase}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return err(`Supabase ${r.status}: ${(await r.text()).slice(0,100)}`, 502);
      return json({ success: true });
    }

    // DELETE /api/supabase/:db/:table/:id  (delete)
    if (request.method === 'DELETE' && segments[3] && segments[4]) {
      const table = segments[3];
      const id    = segments[4];
      const r = await fetch(`${sbBase}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
      });
      if (!r.ok) return err(`Supabase ${r.status}: ${(await r.text()).slice(0,100)}`, 502);
      return json({ success: true });
    }

    return err('Supabase route nicht gefunden', 404);
  }

  // Route RLDB requests
  if (segments[1] === 'rldb') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const rl = env.RLDB;
    if (!rl) return err('RLDB binding nicht konfiguriert', 503);
    return d1Explorer(rl, segments.slice(2), url, request.method, request);
  }

  // Route RSDB requests
  if (segments[1] === 'rsdb') {
    if (!await verifyAuth(request, env)) return err('Unauthorized', 401);
    const rs = env.RSDB;
    if (!rs) return err('RSDB binding nicht konfiguriert', 503);
    return d1Explorer(rs, segments.slice(2), url, request.method, request);
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
