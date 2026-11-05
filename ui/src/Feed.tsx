import { useEffect, useState } from 'react'
import { supabase } from './client'
import type { Story } from './App'

const STORIES = 10

export function fmtDate(seconds: number) {
  const dt = new Date(seconds * 1000)
  const days = Math.round((Date.now() - dt.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const SUGGESTIONS = ['supply problems', 'who beat on margin', 'cheap on valuation', 'AI spending']

export default function Feed({
  selected,
  query,
  bound,
  boundValue,
  onOpen,
  onTag,
  onSuggest,
  onCount,
}: {
  selected: Set<string>
  query: string
  bound: 'topk' | 'distance'
  boundValue: number
  onOpen: (story: Story | null) => void
  onTag: (symbol: string) => void
  onSuggest: (text: string) => void
  onCount: (n: number) => void
}) {
  const [stories, setStories] = useState<Story[]>([])
  const symbols = [...selected].sort()
  const scope = symbols.join(',')

  useEffect(() => {
    let stale = false
    async function load() {
      const { data, error } = query
        ? await supabase.functions.invoke('semgrep-api', {
            body: { op: 'search', text: query, [bound === 'topk' ? 'max_docs' : 'max_distance']: boundValue },
          })
        : await supabase
            .from('yahoo_news')
            .select('id,publication,ticker_news!inner(symbol)')
            .in('ticker_news.symbol', symbols)
            .limit(STORIES)
      if (error || stale) return
      const rows = data as Story[]
      setStories(rows)
      onCount(rows.length)
      onOpen(rows[0] ?? null)
    }
    load()
    return () => {
      stale = true
    }
  }, [scope, query, bound, boundValue])

  return (
    <>
      <div className="feedhead">
        <h1>{query ? 'Results' : 'Latest'}</h1>
        <span className="sub">
          {stories.length} {stories.length === 1 ? 'story' : 'stories'} {query ? 'ranked by meaning' : 'newest first'}
        </span>
      </div>
      {stories.length === 0 && query ? (
        <div className="empty">
          <h3>Nothing matched</h3>
          <div>
            No stories for <b>{query}</b>. Try a broader idea — the index matches on meaning, not exact words.
          </div>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button className="chip" key={s} onClick={() => onSuggest(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : stories.length === 0 ? (
        <div className="empty">
          <h3>Nothing here</h3>
          <div>No stories for <b>{scope}</b>.</div>
        </div>
      ) : (
        <div className="feed">
          {stories.map((story) => {
            const p = story.publication
            return (
              <div className="card" key={story.id} onClick={() => onOpen(story)}>
                <div className="cardbody">
                  <div className="meta">
                    {(p.relatedTickers ?? []).map((t) => (
                      <span
                        className="tick"
                        key={t}
                        onClick={(e) => {
                          e.stopPropagation()
                          onTag(t)
                        }}
                      >
                        {t}
                      </span>
                    ))}
                    <span>{p.publisher}</span>
                    <span className="dot">·</span>
                    <span>{fmtDate(p.providerPublishTime)}</span>
                  </div>
                  <h2>{p.title}</h2>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
