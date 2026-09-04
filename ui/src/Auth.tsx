import { useState } from 'react'
import { supabase } from './client'

export default function Auth() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')

  async function submit() {
    setNotice('')
    if (mode === 'signup') {
      if (!name.trim()) {
        setNotice('name is required')
        return
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: window.location.origin + '/',
        },
      })
      setNotice(error ? error.message : 'check your email to confirm, then log in')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setNotice(error.message)
    }
  }

  return (
    <div className="auth">
      {mode === 'signup' && (
        <input
          className="field"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <input
        className="field"
        placeholder="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="field"
        placeholder="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <div className="auth-actions">
        <button className="button" onClick={submit}>
          {mode === 'login' ? 'log in' : 'sign up'}
        </button>
        <button
          className="linkish"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setNotice('')
          }}
        >
          {mode === 'login' ? 'create an account' : 'have an account? log in'}
        </button>
      </div>
      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}
