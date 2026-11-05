import { useEffect, useState } from 'react'
import { API_BASE, HEADERS } from './client'

type Bar = { ts: string; close: number }

const W = 1000
const H = 300

export default function Chart({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Bar[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    async function load() {
      const res = await fetch(`${API_BASE}/rest/v1/rpc/ticker_price_5m`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sym: symbol }),
      })
      if (stale) return
      if (res.ok) setBars(await res.json())
      else setError(`chart ${res.status}`)
    }
    setBars([])
    setError('')
    load()
    return () => {
      stale = true
    }
  }, [symbol])

  const hist = bars.map((b) => b.close)
  const first = hist[0] ?? null
  const last = hist.length ? hist[hist.length - 1] : null
  const diff = first !== null && last !== null ? last - first : null
  const up = diff === null || diff >= 0
  const dir = diff === null ? '' : up ? 'up' : 'dn'
  const min = Math.min(...hist)
  const max = Math.max(...hist)
  const r = max - min || 1
  const pts = hist
    .map((v, i) => `${((i / (hist.length - 1)) * W).toFixed(1)},${(H - ((v - min) / r) * H).toFixed(1)}`)
    .join(' ')
  const col = up ? 'var(--mica-app-success, #1F6F4C)' : 'var(--mica-app-error, #C5163D)'

  return (
    <div className="chart">
      <div className="charthead">
        <span className="sym">{symbol}</span>
        <span className={`px ${dir}`}>{last !== null ? last.toFixed(2) : ''}</span>
        <span className={`chg ${dir}`}>
          {diff !== null && first ? `${up ? '+' : ''}${((diff / first) * 100).toFixed(2)}%` : ''}
        </span>
      </div>
      {error && (
        <div className="err" style={{ display: 'block' }}>
          {error}
        </div>
      )}
      {hist.length >= 2 && (
        <svg className="chartsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" fill="none">
          <polyline points={pts} stroke={col} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  )
}
