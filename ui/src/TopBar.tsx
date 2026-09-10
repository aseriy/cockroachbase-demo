import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { API_BASE, HEADERS, supabase } from './client'

type Stats = { messages: number; online: number }

export default function TopBar({ session }: { session: Session | null }) {
  const [stats, setStats] = useState<Stats | null>(null)

  async function load() {
    const res = await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'stats' }),
    })
    if (res.ok) setStats(await res.json())
  }

  useEffect(() => {
    load()
  }, [])

  const who = session
    ? ((session.user.user_metadata?.display_name as string | undefined) ?? session.user.email)
    : 'not signed in'

  return (
    <div className="topbar">
      <div>
        <span className="who">{who}</span>
        {session && (
          <button className="linkish" onClick={() => supabase.auth.signOut()}>
            sign out
          </button>
        )}
      </div>
      <div className="counts">
        {stats ? `${stats.online} signed in · ${stats.messages} messages` : ''}
      </div>
    </div>
  )
}
