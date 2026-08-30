import { useState } from 'react'
import { API_BASE, HEADERS } from './Feed'

type Hit = { id: string; body: string; created_at: string; distance: number }

export default function Search() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  async function run() {
    const text = query.trim()
    if (!text) {
      setHits([])
      return
    }
    const res = await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'search', text }),
    })
    if (res.ok) setHits(await res.json())
  }

  return (
    <>
      <input
        className="composer"
        placeholder="search by meaning…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run()
        }}
      />
      <div className="results">
        {hits.map((h) => (
          <div className="result" key={h.id}>
            <span className="distance">{h.distance.toFixed(3)}</span>
            <span className="body">{h.body}</span>
          </div>
        ))}
      </div>
    </>
  )
}
