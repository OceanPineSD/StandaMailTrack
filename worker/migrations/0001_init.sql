-- Times are epoch milliseconds.
CREATE TABLE emails (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL DEFAULT '',
  recipients      TEXT NOT NULL DEFAULT '[]', -- JSON array of addresses
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER NOT NULL,
  thread_id       TEXT,
  message_id      TEXT
);
CREATE INDEX idx_emails_thread ON emails(thread_id);

CREATE TABLE links (
  email_id TEXT NOT NULL REFERENCES emails(id),
  idx      INTEGER NOT NULL,
  url      TEXT NOT NULL,
  PRIMARY KEY (email_id, idx)
);

CREATE TABLE opens (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id  TEXT NOT NULL REFERENCES emails(id),
  at        INTEGER NOT NULL,
  via_proxy INTEGER NOT NULL DEFAULT 0,
  city      TEXT,
  region    TEXT,
  country   TEXT,
  ua        TEXT
);
CREATE INDEX idx_opens_email_at ON opens(email_id, at);

CREATE TABLE clicks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL REFERENCES emails(id),
  link_idx INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  city     TEXT,
  region   TEXT,
  country  TEXT,
  ua       TEXT
);
CREATE INDEX idx_clicks_email_at ON clicks(email_id, at);

-- The sender viewing their own email (posted by the extension).
CREATE TABLE self_views (
  email_id TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX idx_self_views_email_at ON self_views(email_id, at);

-- Opens that count: outside the 15s post-send grace window and not within 60s of a self view.
-- Evaluated at read time so a self view posted after the pixel hit still suppresses it.
CREATE VIEW counted_opens AS
SELECT o.*
FROM opens o
JOIN emails e ON e.id = o.email_id
WHERE o.at >= e.sent_at + 15000
  AND NOT EXISTS (
    SELECT 1 FROM self_views s
    WHERE s.email_id = o.email_id AND s.at BETWEEN o.at - 60000 AND o.at + 60000
  );
