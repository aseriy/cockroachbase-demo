import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { API_BASE, authHeaders } from './client'

type Hit = { id: string; body: string; author: string | null; created_at: string; distance: number }

export default function Search({ session }: { session: Session }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  // While a query is active, keep the results fresh as messages arrive.
  useEffect(() => {
    if (!active) {
      setHits([])
      return
    }
    let stale = false
    async function fetchHits() {
      const res = await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
        method: 'POST',
        headers: { ...authHeaders(session.access_token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'search', text: active }),
      })
      if (res.ok) {
        const rows = await res.json()
        if (!stale) setHits(rows)
      }
    }
    fetchHits()
    const timer = setInterval(fetchHits, 2000)
    return () => {
      stale = true
      clearInterval(timer)
    }
  }, [active])

  return (
    <>
      <input
        className="composer"
        placeholder="search by meaning…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!e.target.value.trim()) setActive('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setActive(query.trim())
        }}
      />
      <div className="results">
        {hits.map((h) => (
          <div className="result" key={h.id}>
            <span className="meta">
              <span>{h.distance.toFixed(3)}</span>
              {h.author && <span className="author">{h.author}</span>}
            </span>
            <span className="body">{h.body}</span>
          </div>
        ))}
      </div>
    </>
  )
}
