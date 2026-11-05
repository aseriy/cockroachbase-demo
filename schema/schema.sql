CREATE TABLE IF NOT EXISTS exchange (
  code char(3) PRIMARY KEY,
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
  ('FRA', 'Börse Frankfurt',             '08:00', '22:00', 'Europe/Berlin')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE exchange ALTER COLUMN open SET DEFAULT '00:00';
ALTER TABLE exchange ALTER COLUMN close SET DEFAULT '23:59';

CREATE TABLE IF NOT EXISTS ticker (
  symbol varchar(21) PRIMARY KEY,
  exchange char(3) REFERENCES exchange(code),
  name text,
  info jsonb,
  logo STRING,
  active boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ticker_logo_missing_idx ON ticker (symbol) WHERE logo IS NULL;
ALTER TABLE ticker OWNER TO postgres;
GRANT SELECT ON ticker TO anon, authenticated, service_role;
GRANT UPDATE ON ticker TO service_role;

DROP FUNCTION IF EXISTS ticker_latest_mvcc_timestamp;
CREATE OR REPLACE FUNCTION ticker_latest_mvcc_timestamp()
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT max(crdb_internal_mvcc_timestamp)::TEXT
  FROM ticker
$$;
GRANT EXECUTE ON FUNCTION ticker_latest_mvcc_timestamp TO anon, authenticated, service_role;


CREATE TABLE IF NOT EXISTS ticker_price (
  symbol varchar(21) NOT NULL REFERENCES ticker(symbol),
  ts timestamptz NOT NULL,
  open float8 NOT NULL,
  high float8 NOT NULL,
  low float8 NOT NULL,
  close float8 NOT NULL,
  volume int8 NOT NULL,
  PRIMARY KEY (symbol, ts) USING HASH
);
ALTER TABLE ticker_price OWNER TO postgres;
GRANT SELECT ON ticker_price TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON ticker_price TO service_role;

CREATE TABLE IF NOT EXISTS yahoo_news (
  id uuid PRIMARY KEY,
  publication jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted boolean NOT NULL DEFAULT false,
  llama_index jsonb
);
ALTER TABLE yahoo_news OWNER TO postgres;
GRANT SELECT ON yahoo_news TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON yahoo_news TO service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('yahoo-news', 'yahoo-news', false) ON CONFLICT (id) DO NOTHING;

DROP FUNCTION IF EXISTS yahoo_news_latest_mvcc_timestamp;
CREATE OR REPLACE FUNCTION yahoo_news_latest_mvcc_timestamp()
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT max(crdb_internal_mvcc_timestamp)::TEXT
  FROM yahoo_news
$$;
GRANT EXECUTE ON FUNCTION yahoo_news_latest_mvcc_timestamp TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS yahoo_news_index (
  text_id uuid PRIMARY KEY,
  doc_id uuid NOT NULL REFERENCES yahoo_news(id),
  start_char_idx int8 NOT NULL,
  end_char_idx int8 NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  VECTOR INDEX yahoo_news_index_embedding_idx (embedding vector_cosine_ops)
);
ALTER TABLE yahoo_news_index OWNER TO postgres;
GRANT SELECT ON yahoo_news_index TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON yahoo_news_index TO service_role;

CREATE TABLE IF NOT EXISTS ticker_news (
    news_id UUID NOT NULL,
    symbol VARCHAR(21) NULL,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT ticker_news_pkey PRIMARY KEY (id ASC),
    CONSTRAINT ticker_news_news_id_fkey FOREIGN KEY (news_id) REFERENCES public.yahoo_news(id),
    CONSTRAINT ticker_news_symbol_fkey FOREIGN KEY (symbol) REFERENCES public.ticker(symbol),
    INDEX ticker_news_symbol_idx (symbol ASC),
    UNIQUE INDEX ticker_news_news_id_symbol_key (news_id ASC, symbol ASC)
);
ALTER TABLE ticker_news OWNER TO postgres;
GRANT SELECT ON ticker_news TO anon, authenticated, service_role;
GRANT INSERT, DELETE ON ticker_news TO service_role;

CREATE TABLE IF NOT EXISTS ticker_unresolved (
    symbol text PRIMARY KEY
);
ALTER TABLE ticker_unresolved OWNER TO postgres;
GRANT SELECT ON ticker_unresolved TO anon, authenticated, service_role;
GRANT INSERT ON ticker_unresolved TO service_role;


DROP FUNCTION IF EXISTS yahoo_news_search;
CREATE OR REPLACE FUNCTION yahoo_news_search(query_vector VECTOR(1536), max_docs INT8, max_distance FLOAT8, chunk_factor INT8)
RETURNS TABLE(id uuid, publication jsonb, distance float8)
LANGUAGE sql STABLE AS $$
  SELECT n.id, n.publication, c.distance
  FROM (
    SELECT doc_id, min(chunk_distance) AS distance
    FROM (
      SELECT doc_id, (embedding <=> query_vector)::float8 AS chunk_distance
      FROM yahoo_news_index
      ORDER BY embedding <=> query_vector
      LIMIT max_docs * chunk_factor
    ) AS nearest
    GROUP BY doc_id
  ) AS c
  JOIN yahoo_news n ON n.id = c.doc_id
  WHERE c.distance <= max_distance
  ORDER BY c.distance
  LIMIT max_docs
$$;
GRANT EXECUTE ON FUNCTION yahoo_news_search TO anon, authenticated, service_role;


DROP FUNCTION IF EXISTS ticker_price_5m;
CREATE OR REPLACE FUNCTION ticker_price_5m(sym VARCHAR(21))                                                                        
RETURNS TABLE(ts timestamptz, close float8)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  zone TEXT;
  first_day DATE;
BEGIN
  SELECT e.tz INTO zone
  FROM ticker t JOIN exchange e ON e.code = t.exchange
  WHERE t.symbol = sym;

  SELECT min(d) INTO first_day
  FROM (
    SELECT DISTINCT (p.ts AT TIME ZONE zone)::date AS d
    FROM ticker_price p
    WHERE p.symbol = sym
    ORDER BY d DESC
    LIMIT 5
  ) AS days;

  RETURN QUERY
    SELECT bucket AS ts, last_close AS close
    FROM (
      SELECT DISTINCT ON (bucket) bucket, p.close AS last_close
      FROM (
        SELECT to_timestamp(floor(extract(epoch FROM q.ts) / 300) * 300) AS bucket, q.ts, q.close
        FROM ticker_price q
        WHERE q.symbol = sym
          AND (q.ts AT TIME ZONE zone)::date >= first_day
      ) AS p
      ORDER BY bucket, p.ts DESC
    ) AS last_in_bucket
    ORDER BY bucket;
END
$$;
GRANT EXECUTE ON FUNCTION ticker_price_5m TO anon, authenticated, service_role;
