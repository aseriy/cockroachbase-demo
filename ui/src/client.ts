import { createClient } from '@supabase/supabase-js'

// When served by the stack, the placeholder below is replaced with the real
// anon key at request time; URLs are relative because the page shares its
// origin with the APIs. `npm run dev` falls back to the VITE_ variables.
const INJECTED_KEY = '__SUPABASE_ANON_KEY__'

export const API_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

export const ANON = INJECTED_KEY.startsWith('__')
  ? ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '')
  : INJECTED_KEY

export const supabase = createClient(API_BASE || window.location.origin, ANON)

// Anonymous headers — feed reads and stats.
export const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}` }

// User headers — adds and searches.
export function authHeaders(accessToken: string) {
  return { apikey: ANON, Authorization: `Bearer ${accessToken}` }
}
