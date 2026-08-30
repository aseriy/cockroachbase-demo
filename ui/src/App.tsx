import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './client'
import TopBar from './TopBar'
import Feed from './Feed'
import Search from './Search'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <div className="shell">
      <TopBar session={session} />
      <div className="app">
        <div className="pane left">
          <div className="pane-title">messages</div>
          <Feed session={session} />
        </div>
        <div className="pane right">
          <div className="pane-title">search</div>
          {session ? <Search session={session} /> : null}
        </div>
      </div>
    </div>
  )
}
