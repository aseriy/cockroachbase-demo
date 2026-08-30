import { useEffect, useState } from 'react'
import { API_BASE, HEADERS } from './Feed'

type Hit = { id: string; body: string; created_at: string; distance: number }

export default function Search() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  async function fetchHits(text: string) {
    const res = await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'search', text }),
    })
    if (res.ok) setHits(await res.json())
  }

  // While a query is active, keep the results fresh as messages arrive.
  useEffect(() => {
    if (!active) {
      setHits([])
      return
    }
    fetchHits(active)
    const timer = setInterval(() => fetchHits(active), 2000)
    return () => clearInterval(timer)
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
            <span className="distance">{h.distance.toFixed(3)}</span>
            <span className="body">{h.body}</span>
          </div>
        ))}
      </div>
    </>
  )
}
