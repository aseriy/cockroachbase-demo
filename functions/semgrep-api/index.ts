import { withSupabase } from 'npm:@supabase/server@1'
import OpenAI from 'https://deno.land/x/openai@v4.24.0/mod.ts'
import { parse as parseYaml } from 'https://deno.land/std@0.224.0/yaml/parse.ts'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })

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
    try {
      ;({ op, id } = await req.json())
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

    return json({ error: 'unknown op' }, 400)
  }),
}
