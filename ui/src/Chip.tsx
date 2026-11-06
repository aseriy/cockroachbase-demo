import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './client'

const BUCKET = 300
const RESTART_SECONDS = 5
const RELOAD_SECONDS = 60

type Point = { ts: number; close: number }
type Session = { ts: string; close: number; prev_close: number | null; session_end: string | null; next_open: string | null }
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

export default function Chip({
  symbol,
  selected,
  onSelect,
}: {
  symbol: string
  selected: boolean
  onSelect: (symbol: string) => void
}) {
  const [name, setName] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [prevClose, setPrevClose] = useState<number | null>(null)
  const [hist, setHist] = useState<Point[]>([])
  const [flash, setFlash] = useState<Flash | null>(null)
  const histRef = useRef(hist)
  histRef.current = hist
  const logoRef = useRef(logo)
  logoRef.current = logo
  const sessionEndRef = useRef<number | null>(null)
  const nextOpenRef = useRef<number | null>(null)
  const reloadingRef = useRef(false)

  async function load() {
    const { data: row } = await supabase.from('ticker').select('name,logo').eq('symbol', symbol).single()
    if (row) {
      setName(row.name)
      setLogo(row.logo)
    }
    const { data: cutoff, error: cutoffError } = await supabase.rpc('ticker_price_latest_mvcc_timestamp', { sym: symbol })
    if (cutoffError || cutoff === null) return
    const { data: rows, error } = await supabase.rpc('ticker_price_session', { sym: symbol, cutoff })
    if (error) return
    const session = rows as Session[]
    setHist(session.map((r) => ({ ts: Date.parse(r.ts) / 1000, close: r.close })))
    setPrevClose(session[0]?.prev_close ?? null)
    sessionEndRef.current = session[0]?.session_end ? Date.parse(session[0].session_end) / 1000 : null
    nextOpenRef.current = session[0]?.next_open ? Date.parse(session[0].next_open) / 1000 : null
  }

  // One channel per chip: every bar written to ticker_price for this symbol, as it lands.
  // A lost channel is torn down and re-subscribed after RESTART_SECONDS; while it is down the
  // session is reloaded every RELOAD_SECONDS.
  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let reloadTimer: ReturnType<typeof setInterval> | null = null
    let gen = 0

    function teardown() {
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
    }

    function subscribe() {
      const mine = ++gen
      channel = supabase
        .channel(`ticker_price:${symbol}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ticker_price' }, (payload) => {
          const bar = payload.new as { symbol: string; ts: string; close: number }
          if (bar.symbol !== symbol) return
          const t = Date.parse(bar.ts) / 1000
          if (nextOpenRef.current !== null && t >= nextOpenRef.current) {
            if (!reloadingRef.current) {
              reloadingRef.current = true
              load().finally(() => {
                reloadingRef.current = false
              })
            }
            return
          }
          if (sessionEndRef.current !== null && t >= sessionEndRef.current) return
          const bucket = Math.floor(t / BUCKET) * BUCKET
          const last = histRef.current[histRef.current.length - 1]
          const cls = last && bar.close < last.close ? 'flash-dn' : 'flash-up'
          setHist((prev) => {
            const tail = prev[prev.length - 1]
            if (tail && tail.ts === bucket) return [...prev.slice(0, -1), { ts: bucket, close: bar.close }]
            return [...prev, { ts: bucket, close: bar.close }]
          })
          setFlash((prev) => ({ cls, n: (prev?.n ?? 0) + 1 }))
          if (logoRef.current === null) {
            supabase
              .from('ticker')
              .select('logo')
              .eq('symbol', symbol)
              .then(({ data: rows }) => {
                const late = rows?.[0]?.logo ?? null
                if (late !== null) setLogo(late)
              })
          }
        })
        .subscribe((status) => {
          if (mine !== gen) return
          if (status === 'SUBSCRIBED') {
            if (reloadTimer) {
              clearInterval(reloadTimer)
              reloadTimer = null
            }
            load()
            return
          }
          if (!reloadTimer) {
            load()
            reloadTimer = setInterval(load, RELOAD_SECONDS * 1000)
          }
          gen++
          teardown()
          restartTimer = setTimeout(subscribe, RESTART_SECONDS * 1000)
        })
    }

    subscribe()
    return () => {
      gen++
      if (restartTimer) clearTimeout(restartTimer)
      if (reloadTimer) clearInterval(reloadTimer)
      teardown()
    }
  }, [symbol])

  const px = hist.length ? hist[hist.length - 1].close : null
  const diff = px !== null && prevClose !== null ? px - prevClose : null
  const up = diff === null || diff >= 0
  const dir = diff === null ? '' : up ? 'up' : 'dn'

  return (
    <div key={flash?.n ?? 0} className={`row ${selected ? 'sel' : ''} ${flash?.cls ?? ''}`} onClick={() => onSelect(symbol)}>
      {logo && logo !== '-' ? (
        <img className="thumb" alt="" src={`data:image/svg+xml,${encodeURIComponent(logo)}`} />
      ) : (
        <div className="thumb" style={{ background: `var(--mica-app-series-${hue(symbol)}, #502482)` }}>
          {symbol.slice(0, 4)}
        </div>
      )}
      <div className="rowl">
        <div className="sym">{symbol}</div>
        <div className="co">{name ?? ''}</div>
      </div>
      <Sparkline hist={hist.map((p) => p.close)} up={up} />
      <div className="rowr">
        <div className={`px ${dir}`}>{px !== null ? px.toFixed(2) : ''}</div>
        <div className={`chg ${dir}`}>
          {diff !== null && prevClose ? `${up ? '+' : ''}${((diff / prevClose) * 100).toFixed(2)}%` : ''}
        </div>
      </div>
    </div>
  )
}
