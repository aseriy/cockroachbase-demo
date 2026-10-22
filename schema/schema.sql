CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  body_vector VECTOR(384),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages OWNER TO postgres;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author text;
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);
GRANT SELECT ON messages TO anon, authenticated, service_role;
-- ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS messages_read ON messages;
-- CREATE POLICY messages_read ON messages FOR SELECT TO anon, authenticated USING (true);

DROP FUNCTION IF EXISTS search_messages;
CREATE OR REPLACE FUNCTION search_messages(query_vector VECTOR(384))
RETURNS TABLE(id uuid, body text, author text, created_at timestamptz, distance float8)
LANGUAGE sql STABLE AS $$
  SELECT id, body, author, created_at, (body_vector <=> query_vector)::float8 AS distance
  FROM messages
  WHERE body_vector IS NOT NULL
  ORDER BY body_vector <=> query_vector
  LIMIT 20
$$;
GRANT EXECUTE ON FUNCTION search_messages TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS exchange (
  code text PRIMARY KEY,
  name text,
  open time NOT NULL,
  close time NOT NULL,
  tz text NOT NULL
);
ALTER TABLE exchange OWNER TO postgres;
GRANT SELECT ON exchange TO anon, authenticated, service_role;
INSERT INTO exchange (code, name, open, close, tz) VALUES
  ('NYQ', 'New York Stock Exchange',     '09:30', '16:00', 'America/New_York'),
  ('NMS', 'Nasdaq Global Select Market', '09:30', '16:00', 'America/New_York'),
  ('NGM', 'Nasdaq Global Market',        '09:30', '16:00', 'America/New_York'),
  ('NCM', 'Nasdaq Capital Market',       '09:30', '16:00', 'America/New_York'),
  ('JPX', 'Tokyo Stock Exchange',        '09:00', '15:30', 'Asia/Tokyo'),
  ('PAR', 'Euronext Paris',              '09:00', '17:35', 'Europe/Paris'),
  ('GER', 'XETRA',                       '09:00', '17:30', 'Europe/Berlin'),
  ('FRA', 'Börse Frankfurt',             '08:00', '22:00', 'Europe/Berlin');

CREATE TABLE IF NOT EXISTS ticker (
  symbol text PRIMARY KEY,
  exchange text NOT NULL REFERENCES exchange(code),
  name text,
  profile jsonb,
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE ticker OWNER TO postgres;
GRANT SELECT ON ticker TO anon, authenticated, service_role;
