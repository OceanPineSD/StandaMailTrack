-- Instance settings for the email digest. Values are set through PUT /api/settings after deploy.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('digest_enabled', '0'),
  ('digest_every_days', '1'),
  ('digest_to', ''),
  ('digest_from', 'StandaMailTrack <onboarding@resend.dev>'),
  ('last_digest_at', '0');
