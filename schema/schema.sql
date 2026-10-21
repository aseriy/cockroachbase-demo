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
REVOKE INSERT, UPDATE, DELETE ON messages FROM anon, authenticated, service_role;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_read ON messages;
CREATE POLICY messages_read ON messages FOR SELECT TO anon, authenticated USING (true);

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
