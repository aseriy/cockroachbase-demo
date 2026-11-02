import { useEffect, useRef, useState } from 'react'
import { API_BASE, HEADERS, supabase } from './client'

const POINTS = 30

type Bar = { ts: string; close: number }
type Row = {
  symbol: string
  name: string | null
  info: { regularMarketPreviousClose?: number } | null
  logo: string | null
  ticker_price: Bar[]
}
type Series = { px: number | null; prev: number | null; hist: number[]; logo: string | null }
type Flash = { cls: 'flash-up' | 'flash-dn'; n: number }

function hue(sym: string) {
  let h = 0
  for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 8
  return h + 1
}

function Sparkline({ hist, up }: { hist: number[]; up: boolean }) {
  if (hist.length < 2) return <svg className="spark" width="46" height="16" />
  const w = 46
  const h = 16
  const min = Math.min(...hist)
  const max = Math.max(...hist)
  const r = max - min || 1
  const pts = hist
    .map((v, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - ((v - min) / r) * h).toFixed(1)}`)
    .join(' ')
  const col = up ? 'var(--mica-app-success, #1F6F4C)' : 'var(--mica-app-error, #C5163D)'
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline points={pts} stroke={col} strokeWidth="1.3" strokeLinejoin="round" opacity=".85" />
    </svg>
  )
}

export default function Watchlist({
  selected,
  onSelect,
  onCount,
  stories,
}: {
  selected: Set<string>
  onSelect: (symbols: Set<string>) => void
  onCount: (n: number) => void
  stories: number
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [series, setSeries] = useState<Record<string, Series>>({})
  const [flash, setFlash] = useState<Record<string, Flash>>({})
  const seriesRef = useRef(series)
  seriesRef.current = series

  async function load() {
    const res = await fetch(
      `${API_BASE}/rest/v1/ticker?select=symbol,name,info,logo,ticker_price(ts,close)&active=eq.true&order=symbol&ticker_price.order=ts.desc&ticker_price.limit=${POINTS}`,
      { headers: HEADERS },
    )
    if (!res.ok) return
    const data: Row[] = await res.json()
    const next: Record<string, Series> = {}
    for (const row of data) {
      const hist = row.ticker_price.map((b) => b.close).reverse()
      next[row.symbol] = {
        px: hist.length ? hist[hist.length - 1] : null,
        prev: row.info?.regularMarketPreviousClose ?? null,
        hist,
        logo: row.logo,
      }
    }
    setRows(data)
    setSeries(next)
    onCount(data.length)
  }

  useEffect(() => {
    load()
  }, [])

  // One channel: every 1m bar written to ticker_price, as it lands.
  useEffect(() => {
    const channel = supabase
      .channel('ticker_price')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticker_price' }, (payload) => {
        const bar = payload.new as { symbol: string; close: number }
        const cur = seriesRef.current[bar.symbol]
        if (!cur) return
        const cls = cur.px !== null && bar.close < cur.px ? 'flash-dn' : 'flash-up'
        setSeries((prev) => ({
          ...prev,
          [bar.symbol]: { ...cur, px: bar.close, hist: [...cur.hist, bar.close].slice(-POINTS) },
        }))
        setFlash((prev) => ({ ...prev, [bar.symbol]: { cls, n: (prev[bar.symbol]?.n ?? 0) + 1 } }))
        if (cur.logo === null) {
          fetch(`${API_BASE}/rest/v1/ticker?select=logo&symbol=eq.${encodeURIComponent(bar.symbol)}`, { headers: HEADERS })
            .then((res) => (res.ok ? res.json() : []))
            .then((rows: { logo: string | null }[]) => {
              const logo = rows[0]?.logo ?? null
              if (logo !== null) setSeries((prev) => ({ ...prev, [bar.symbol]: { ...prev[bar.symbol], logo } }))
            })
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function toggle(symbol: string) {
    onSelect(new Set([symbol]))
  }

  return (
    <aside id="rail">
      <div className="railhead">Watchlist</div>
      <div className={`row allrow ${selected.size === 0 ? 'sel' : ''}`} onClick={() => onSelect(new Set())}>
        <div className="rowl">
          <div className="sym">All tickers</div>
          <div className="co">{rows.length} tracked</div>
        </div>
        <div className="rowr">
          <div className="count">{stories} stories</div>
        </div>
      </div>
      {rows.map((row) => {
        const s = series[row.symbol]
        const f = flash[row.symbol]
        const px = s?.px ?? null
        const prev = s?.prev ?? null
        const diff = px !== null && prev !== null ? px - prev : null
        const up = diff === null || diff >= 0
        const dir = diff === null ? '' : up ? 'up' : 'dn'
        return (
          <div
            key={`${row.symbol}-${f?.n ?? 0}`}
            className={`row ${selected.has(row.symbol) ? 'sel' : ''} ${f?.cls ?? ''}`}
            onClick={() => toggle(row.symbol)}
          >
            {s?.logo && s.logo !== '-' ? (
              <img className="thumb" alt="" src={`data:image/svg+xml,${encodeURIComponent(s.logo)}`} />
            ) : (
              <div className="thumb" style={{ background: `var(--mica-app-series-${hue(row.symbol)}, #502482)` }}>
                {row.symbol.slice(0, 4)}
              </div>
            )}
            <div className="rowl">
              <div className="sym">{row.symbol}</div>
              <div className="co">{row.name ?? ''}</div>
            </div>
            <Sparkline hist={s?.hist ?? []} up={up} />
            <div className="rowr">
              <div className={`px ${dir}`}>{px !== null ? px.toFixed(2) : ''}</div>
              <div className={`chg ${dir}`}>
                {diff !== null && prev ? `${up ? '+' : ''}${((diff / prev) * 100).toFixed(2)}%` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </aside>
  )
}
