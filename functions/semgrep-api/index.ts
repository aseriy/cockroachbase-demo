import { withSupabase } from 'npm:@supabase/server@1'
import OpenAI from 'https://deno.land/x/openai@v4.24.0/mod.ts'
import { parse as parseYaml } from 'https://deno.land/std@0.224.0/yaml/parse.ts'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })

// Nearest chunks fetched per requested article; the corpus averages 1.61 chunks per article.
const CHUNK_FACTOR = 2

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function embed(text: string): Promise<string> {
  const result = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: text })
  return `[${result.data[0].embedding.join(',')}]`
}

// <id>.md is YAML front matter between `---` lines, then the Markdown body.
function splitFrontMatter(text: string): { front_matter: unknown; body: string } {
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n\n', 4)
    if (end >= 0) {
      return { front_matter: parseYaml(text.slice(4, end)), body: text.slice(end + '\n---\n\n'.length) }
    }
  }
  return { front_matter: {}, body: text }
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405)
    }

    let op: unknown
    let id: unknown
    let text: unknown
    let max_docs: unknown
    let max_distance: unknown
    try {
      ;({ op, id, text, max_docs, max_distance } = await req.json())
    } catch {
      op = undefined
    }

    if (op === 'article') {
      if (typeof id !== 'string' || !id.trim()) {
        return json({ error: 'id required' }, 400)
      }
      const { data, error } = await ctx.supabaseAdmin.storage.from('yahoo-news').download(`${id}.md`)
      if (error) {
        return json({ error: `storage ${error.status ?? 500}` }, error.status ?? 500)
      }
      return json(splitFrontMatter(await data.text()))
    }

    if (op === 'search') {
      if (typeof text !== 'string' || !text.trim()) {
        return json({ error: 'text required' }, 400)
      }
      const docs = max_docs ?? 50
      const distance = max_distance ?? 1.0
      if (typeof docs !== 'number' || typeof distance !== 'number') {
        return json({ error: 'max_docs and max_distance must be numbers' }, 400)
      }
      const query_vector = await embed(text.trim())
      const { data, error } = await ctx.supabaseAdmin.rpc('yahoo_news_search', {
        query_vector,
        max_docs: docs,
        max_distance: distance,
        chunk_factor: CHUNK_FACTOR,
      })
      if (error) {
        return json({ error: error.message }, 500)
      }
      return json(data)
    }

    return json({ error: 'unknown op' }, 400)
  }),
}
