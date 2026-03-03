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
  ('frametrain', 'FrameTrain', 'https://frame-train.vercel.app'),
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
