import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts'

const dbUrl = new URL(Deno.env.get('SUPABASE_DB_URL')!)

const pool = new Pool(
  {
    tls: { caCertificates: [Deno.env.get('SUPABASE_DB_SSL_ROOT_CERT')!] },
    database: dbUrl.pathname.slice(1),
    hostname: dbUrl.hostname,
    user: dbUrl.username,
    port: Number(dbUrl.port || '5432'),
    password: Deno.env.get('DB_PASSWORD'),
  },
  1,
)

const session = new Supabase.ai.Session('gte-small')

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let text: unknown
  try {
    ;({ text } = await req.json())
  } catch {
    text = undefined
  }
  if (typeof text !== 'string' || !text.trim()) {
    return new Response(JSON.stringify({ error: 'text required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const body = text.trim()

  const embedding = await session.run(body, { mean_pool: true, normalize: true })
  const vector = `[${Array.from(embedding as Float32Array).join(',')}]`

  const conn = await pool.connect()
  try {
    const result = await conn.queryObject`
      insert into messages (body, body_vector)
      values (${body}, ${vector}::vector)
      returning id, body, created_at
    `
    return new Response(JSON.stringify(result.rows[0]), {
      headers: { 'Content-Type': 'application/json' },
    })
  } finally {
    conn.release()
  }
})
