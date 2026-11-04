import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './client'
import Auth from './Auth'
import Watchlist from './Watchlist'
import Feed from './Feed'
import Article from './Article'

// The raw Yahoo item stored in yahoo_news.publication, the keys the page reads.
export type Publication = {
  title: string
  publisher: string
  providerPublishTime: number
  relatedTickers?: string[]
  link: string
}
export type Story = { id: string; publication: Publication }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [article, setArticle] = useState<Story | null>(null)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [bound, setBound] = useState<'topk' | 'distance'>('topk')
  const [topK, setTopK] = useState(20)
  const [maxDistance, setMaxDistance] = useState(0.215)
  const [tickers, setTickers] = useState(0)
  const [stories, setStories] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) setShowAuth(false)
  }, [session])

  function select(symbols: Set<string>) {
    setSelected(symbols)
    setArticle(null)
  }

  function search(text: string) {
    setQuery(text)
    setSubmitted(text.trim())
    setArticle(null)
  }

  function clearSearch() {
    setQuery('')
    setSubmitted('')
  }

  const who = session
    ? ((session.user.user_metadata?.display_name as string | undefined) ?? session.user.email)
    : null

  return (
    <div id="app">
      <header>
        <div className="brand">Watchlist</div>
        <div className="searchwrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            id="q"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Ask the watchlist — e.g. “who is having supply problems”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search(query)
              if (e.key === 'Escape') clearSearch()
            }}
          />
          {query && (
            <button id="clearq" title="Clear" style={{ display: 'block' }} onClick={clearSearch}>
              &times;
            </button>
          )}
        </div>
        <div className="searchopts">
          <label>top-k</label>
          <input
            type="number"
            min={1}
            step={1}
            value={topK}
            disabled={bound !== 'topk'}
            onChange={(e) => setTopK(Number(e.target.value))}
          />
          <button
            className="switch"
            role="switch"
            aria-checked={bound === 'distance'}
            title={bound === 'topk' ? 'Bound by top-k' : 'Bound by distance'}
            onClick={() => setBound(bound === 'topk' ? 'distance' : 'topk')}
          />
          <input
            type="number"
            min={0}
            max={1}
            step={0.005}
            value={maxDistance}
            disabled={bound !== 'distance'}
            onChange={(e) => setMaxDistance(Number(e.target.value))}
          />
          <label>distance</label>
        </div>
        <div className="hint">
          <b>{tickers}</b> tickers · <b>{stories}</b> stories
          {session ? (
            <>
              {' '}· <b>{who}</b>
              <button onClick={() => supabase.auth.signOut()}>sign out</button>
            </>
          ) : (
            <button onClick={() => setShowAuth(!showAuth)}>sign in</button>
          )}
        </div>
      </header>
      {showAuth && !session && (
        <div className="authpanel">
          <Auth />
        </div>
      )}
      <main>
        <Watchlist selected={selected} onSelect={select} onCount={setTickers} stories={stories} />
        <section id="center">
          {article ? (
            <Article story={article} searching={submitted !== ''} onBack={() => setArticle(null)} />
          ) : (
            <Feed
              selected={selected}
              query={submitted}
              bound={bound}
              boundValue={bound === 'topk' ? topK : maxDistance}
              onOpen={setArticle}
              onTag={(s) => select(new Set([s]))}
              onSuggest={search}
              onCount={setStories}
            />
          )}
        </section>
      </main>
      <footer>
        <span>Made with CockroachBase</span>
        <span className="dot">·</span>
        <span>Running on CockroachDB</span>
        <span className="dot">·</span>
        <span>Data from Yahoo Finance</span>
        <span className="dot">·</span>
        <a href="https://elbstream.com" target="_blank" rel="noreferrer">
          Logos provided by Elbstream
        </a>
      </footer>
    </div>
  )
}
