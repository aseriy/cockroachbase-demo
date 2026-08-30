CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  body_vector VECTOR(384),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages OWNER TO postgres;
GRANT SELECT ON messages TO anon, authenticated, service_role;
