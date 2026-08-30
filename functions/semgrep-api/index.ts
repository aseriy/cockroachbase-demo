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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function embed(text: string): Promise<string> {
  const embedding = await session.run(text, { mean_pool: true, normalize: true })
  return `[${Array.from(embedding as Float32Array).join(',')}]`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  let op: unknown
  let text: unknown
  try {
    ;({ op, text } = await req.json())
  } catch {
    text = undefined
  }
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text required' }, 400)
  }
  const input = text.trim()

  const vector = await embed(input)

  const conn = await pool.connect()
  try {
    if (op === 'search') {
      const result = await conn.queryObject`
        select * from search_messages(${vector}::vector)
      `
      // the driver hands float8 over as a string
      const rows = (result.rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        distance: Number(r.distance),
      }))
      return json(rows)
    }

    const result = await conn.queryObject`
      insert into messages (body, body_vector)
      values (${input}, ${vector}::vector)
      returning id, body, created_at
    `
    return json(result.rows[0])
  } finally {
    conn.release()
  }
})
