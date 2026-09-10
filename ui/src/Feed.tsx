import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { API_BASE, HEADERS, authHeaders } from './client'
import Auth from './Auth'

type Message = { id: string; body: string; author: string | null; created_at: string }

export default function Feed({ session }: { session: Session | null }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')

  async function load() {
    const res = await fetch(
      `${API_BASE}/rest/v1/messages?select=id,body,author,created_at&order=created_at.desc&limit=50`,
      { headers: HEADERS },
    )
    if (res.ok) setMessages(await res.json())
  }

  useEffect(() => {
    load()
  }, [])

  async function send() {
    if (!session) return
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
      method: 'POST',
      headers: { ...authHeaders(session.access_token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }

  return (
    <>
      <div className="feed">
        {messages.map((m) => (
          <div className="message" key={m.id}>
            <span className="meta">
              <span className="time">{new Date(m.created_at).toLocaleTimeString()}</span>
              {m.author && <span className="author">{m.author}</span>}
            </span>
            <span className="body">{m.body}</span>
          </div>
        ))}
      </div>
      {session ? (
        <textarea
          className="composer"
          rows={4}
          placeholder="type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
      ) : (
        <Auth />
      )}
    </>
  )
}
