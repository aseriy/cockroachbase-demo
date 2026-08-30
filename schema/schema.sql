CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  body_vector VECTOR(384),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages OWNER TO postgres;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author text;
GRANT SELECT ON messages TO anon, authenticated, service_role;

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
