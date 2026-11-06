import { useEffect, useState } from 'react'
import { supabase } from './client'
import Chip from './Chip'

const DEFAULT_USER = '00000000-0000-0000-0000-000000000000'

export default function Watchlist({
  selected,
  onSelect,
  onCount,
}: {
  selected: Set<string>
  onSelect: (symbols: Set<string>) => void
  onCount: (n: number) => void
}) {
  const [symbols, setSymbols] = useState<string[]>([])

  async function load() {
    const { data, error } = await supabase
      .from('ticker_watchlist')
      .select('symbol')
      .eq('user_id', DEFAULT_USER)
      .order('symbol')
    if (error) return
    const list = (data as { symbol: string }[]).map((r) => r.symbol)
    setSymbols(list)
    onCount(list.length)
    if (list.length && selected.size === 0) onSelect(new Set([list[0]]))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <aside id="rail">
      <div className="railhead">Watchlist</div>
      {symbols.map((s) => (
        <Chip key={s} symbol={s} selected={selected.has(s)} onSelect={(sym) => onSelect(new Set([sym]))} />
      ))}
    </aside>
  )
}
