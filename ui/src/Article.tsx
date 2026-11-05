import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './client'
import type { Story } from './App'

// The YAML front matter written ahead of the Markdown in <id>.md, the keys the page reads.
type FrontMatter = { title?: string; author?: string; date?: string; 'source-hostname'?: string }
type Doc = { front_matter: FrontMatter; body: string }

export default function Article({ story }: { story: Story }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    async function load() {
      const { data, error } = await supabase.functions.invoke('semgrep-api', { body: { op: 'article', id: story.id } })
      if (stale) return
      if (error) setError(`article ${error instanceof FunctionsHttpError ? error.context.status : error.message}`)
      else setDoc(data as Doc)
    }
    load()
    return () => {
      stale = true
    }
  }, [story.id])

  const p = story.publication
  const fm = doc?.front_matter ?? {}
  const amet = [fm.author, fm['source-hostname'], fm.date].filter((x): x is string => Boolean(x))

  return (
    <article>
      <div className="meta">
        {(p.relatedTickers ?? []).map((t) => (
          <span className="tick" key={t}>
            {t}
          </span>
        ))}
      </div>
      <h1>{fm.title ?? p.title}</h1>
      <div className="amet">
        {amet.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="dot">· </span>}
            {part}
          </span>
        ))}
      </div>
      {error && (
        <div className="err" style={{ display: 'block' }}>
          {error}
        </div>
      )}
      {doc && (
        <div className="abody">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
          >
            {doc.body}
          </ReactMarkdown>
        </div>
      )}
      <div className="srcline">
        Indexed from{' '}
        <a href={p.link} target="_blank" rel="noreferrer">
          {p.publisher}
        </a>
      </div>
    </article>
  )
}
