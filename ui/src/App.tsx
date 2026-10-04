import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './client'
import TopBar from './TopBar'
import Feed from './Feed'
import Search from './Search'

export type Message = { id: string; body: string; author: string | null; created_at: string }

type Live = { latest: Message | null; count: number }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [live, setLive] = useState<Live>({ latest: null, count: 0 })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // One channel, one subscription: every INSERT on public.messages, as it is written.
  useEffect(() => {
    const channel = supabase
      .channel('semgrep')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as Message
        setLive((prev) => ({ latest: row, count: prev.count + 1 }))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="shell">
      <TopBar session={session} inserted={live.count} />
      <div className="app">
        <div className="pane left">
          <div className="pane-title">messages</div>
          <Feed session={session} latest={live.latest} />
        </div>
        <div className="pane right">
          <div className="pane-title">search</div>
          {session ? <Search session={session} /> : null}
        </div>
      </div>
    </div>
  )
}
