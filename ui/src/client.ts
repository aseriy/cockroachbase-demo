import { createClient } from '@supabase/supabase-js'

// When served by the stack, the placeholders below are replaced with the real
// anon key and gateway URL at container start. `npm run dev` falls back to
// the VITE_ variables.
const INJECTED_KEY = '__SUPABASE_ANON_KEY__'
const INJECTED_URL = '__SUPABASE_URL__'

const API_BASE = INJECTED_URL.startsWith('__')
  ? ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '')
  : INJECTED_URL

const ANON = INJECTED_KEY.startsWith('__')
  ? ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '')
  : INJECTED_KEY

export const supabase = createClient(API_BASE || window.location.origin, ANON)
