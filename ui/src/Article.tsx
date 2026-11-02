import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_BASE, HEADERS } from './client'
import type { Story } from './App'

// The YAML front matter written ahead of the Markdown in <id>.md, the keys the page reads.
type FrontMatter = { title?: string; author?: string; date?: string; 'source-hostname'?: string }
type Doc = { front_matter: FrontMatter; body: string }

export default function Article({ story, onBack }: { story: Story; onBack: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    async function load() {
      const res = await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'article', id: story.id }),
      })
      if (stale) return
      if (res.ok) setDoc(await res.json())
      else setError(`article ${res.status}`)
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
      <button className="back" onClick={onBack}>
        &larr; Back to feed
      </button>
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
