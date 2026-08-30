import { useEffect, useState } from 'react'

// When served by the stack, the placeholder below is replaced with the real
// anon key at request time; URLs are relative because the page shares its
// origin with the APIs. `npm run dev` falls back to the VITE_ variables.
const INJECTED_KEY = '__SUPABASE_ANON_KEY__'
export const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const ANON = INJECTED_KEY.startsWith('__')
  ? ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '')
  : INJECTED_KEY

export const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}` }

type Message = { id: string; body: string; created_at: string }

export default function Feed() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')

  async function load() {
    const res = await fetch(
      `${API_BASE}/rest/v1/messages?select=id,body,created_at&order=created_at.desc&limit=50`,
      { headers: HEADERS },
    )
    if (res.ok) setMessages(await res.json())
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await fetch(`${API_BASE}/functions/v1/semgrep-api`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    load()
  }

  return (
    <>
      <div className="feed">
        {messages.map((m) => (
          <div className="message" key={m.id}>
            <span className="time">{new Date(m.created_at).toLocaleTimeString()}</span>
            <span className="body">{m.body}</span>
          </div>
        ))}
      </div>
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
    </>
  )
}
