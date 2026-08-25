-- =============================================
-- WebControl HQ - D1 Database Schema
-- =============================================

-- Sites registry
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed sites
INSERT OR IGNORE INTO sites (id, name, url) VALUES
  ('framesphere', 'Frame-Sphere', 'https://frame-sphere.vercel.app'),
  ('frametrain', 'FrameTrain', 'https://frame-train.com'),
  ('wordify', 'Wordify', 'https://wordify.pages.dev'),
  ('flaggues', 'Flaggues', 'https://flaggues.pages.dev'),
  ('spinselector', 'SpinSelector', 'https://spinselector.pages.dev'),
  ('brawlmystery', 'BrawlMystery', 'https://brawlmystery.pages.dev'),
  ('traitora', 'Traitora', 'https://traitora.pages.dev'),
  ('fileflyr', 'FileFlyr', 'https://fileflyr.pages.dev'),
  ('ratelimit', 'Ratelimit API', 'https://ratelimit-api.pages.dev'),
  ('framespell', 'FrameSpell', 'https://framespell.pages.dev');

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'error' | 'info' | 'warning' | 'success'
  title TEXT NOT NULL,
  message TEXT,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- HuggingFace Space Ping-Log (FrameSpell Keepalive)
CREATE TABLE IF NOT EXISTS hf_ping_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,           -- 'ok' | 'error'
  http_code INTEGER,              -- z.B. 200
  response_ms INTEGER,            -- Antwortzeit in ms
  model_loaded INTEGER DEFAULT 0, -- 1 wenn Modell fertig geladen
  error TEXT,                     -- Fehlermeldung falls vorhanden
  triggered_by TEXT DEFAULT 'cron', -- 'cron' | 'manual'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Support Messages (chat threads per ticket)
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender TEXT NOT NULL, -- 'user' | 'admin'
  message TEXT NOT NULL,
  read_by_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open', -- 'open' | 'in_progress' | 'resolved' | 'closed'
  priority TEXT DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
  reply TEXT,
  user_token TEXT,
  user_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Changelog Entries
CREATE TABLE IF NOT EXISTS changelog_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'feature', -- 'feature' | 'fix' | 'improvement' | 'breaking'
  published INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Blog Posts
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT,
  excerpt TEXT,
  status TEXT DEFAULT 'draft', -- 'draft' | 'published'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Word Requests (Wordify)
CREATE TABLE IF NOT EXISTS word_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT DEFAULT 'wordify',
  word TEXT NOT NULL,
  language TEXT DEFAULT 'de',
  requester_email TEXT,
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Suggestions (SpinSelector)
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT DEFAULT 'spinselector',
  suggestion TEXT NOT NULL,
  category TEXT,
  upvotes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'done'
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analytics Events
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'pageview' | 'click' | 'error' | 'api_call'
  path TEXT,
  referrer TEXT,
  user_agent TEXT,
  country TEXT,
  value INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Error Logs
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  status_code INTEGER,
  resolved INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- Daily Words (Wort des Tages - dashboard-managed)
CREATE TABLE IF NOT EXISTS daily_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL DEFAULT 'wordify',
  date TEXT NOT NULL,        -- YYYY-MM-DD
  language TEXT NOT NULL,    -- de, en, es, fr, it
  word TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, language)
);

-- Contact Messages (from game users)
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL DEFAULT 'wordify',
  name TEXT,
  message TEXT NOT NULL,
  language TEXT DEFAULT 'de',
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Site Stats (daily snapshots)
CREATE TABLE IF NOT EXISTS site_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  date TEXT NOT NULL,
  visitors INTEGER DEFAULT 0,
  pageviews INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

-- =============================================
-- AUTO-FIX PIPELINE (FrameTrain Desktop)
-- =============================================

-- App Errors (Desktop-App Fehler-Reports)
-- Wird auch vom Worker per ensureAppErrorsTable() angelegt/migriert.
CREATE TABLE IF NOT EXISTS app_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL DEFAULT 'frametrain',
  error_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  logs TEXT,
  config_snapshot TEXT,
  platform TEXT,
  app_version TEXT,
  resolved INTEGER DEFAULT 0,
  error_group TEXT,                     -- Signatur zum Clustern ähnlicher Fehler
  triage_status TEXT DEFAULT 'new',     -- 'new' | 'fix_ready' | 'merged' | 'rejected' | 'ignored'
  occurrences INTEGER DEFAULT 1,
  screen TEXT,                          -- Screen/Seite in der App, wo der Fehler auftrat
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fix Proposals (Vorschläge der Triage-Automation)
CREATE TABLE IF NOT EXISTS fix_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL DEFAULT 'frametrain',
  kind TEXT NOT NULL DEFAULT 'fix',     -- 'fix' | 'ignore'
  category TEXT,                        -- 'ts-react' | 'training' | 'rust-report' | ...
  title TEXT NOT NULL,
  summary TEXT,
  report_markdown TEXT,                 -- vollständiger Report für dein Review
  test_steps TEXT,                      -- was du manuell prüfen sollst
  root_cause TEXT,
  diff_summary TEXT,
  files_changed TEXT,                   -- JSON-Array
  error_ids TEXT,                       -- JSON-Array verknüpfter app_errors.id
  error_group TEXT,
  branch TEXT,
  base_branch TEXT DEFAULT 'main',
  pr_number INTEGER,
  pr_url TEXT,
  build_status TEXT,                    -- 'passed' | 'failed' | 'skipped'
  risk TEXT DEFAULT 'medium',           -- 'low' | 'medium' | 'high'
  status TEXT NOT NULL DEFAULT 'proposed', -- 'proposed' | 'merged' | 'rejected' | 'error'
  merge_result TEXT,
  reject_reason TEXT,
  created_by TEXT DEFAULT 'automation',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ignore Rules (selbstlernende Ignore-Liste)
CREATE TABLE IF NOT EXISTS ignore_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL DEFAULT 'frametrain',
  match_type TEXT NOT NULL DEFAULT 'error_type', -- 'error_type' | 'message_prefix' | 'group'
  pattern TEXT NOT NULL,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
