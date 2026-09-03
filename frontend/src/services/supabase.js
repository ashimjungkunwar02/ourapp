import { createClient } from '@supabase/supabase-js'

// ── Configuration ──────────────────────────────────────────────────────────
// Set these in frontend/.env (see .env.example). The anon key is PUBLIC by
// design — every row it can reach is governed by RLS. Never put the
// service_role key here; it lives only in the Edge Function environment.
const SUPABASE_URL      = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

if (!isSupabaseConfigured) {
  // Loud, but non-fatal: the module still loads so the app can render a clear
  // "not configured" screen instead of white-screening on a null client.
  console.error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
    'Add them to frontend/.env — see frontend/.env.example.'
  )
}

// ── Username → email ───────────────────────────────────────────────────────
// Supabase Auth is email-based; this app logs in with a username. We derive a
// deterministic address under a reserved domain that cannot receive mail, so
// the user never sees it.
//
// MUST match AUTH_EMAIL_DOMAIN in supabase/functions/admin-manage-user/index.ts.
// If the two disagree, admin-created accounts cannot sign in.
export const AUTH_EMAIL_DOMAIN = 'auth.lisasweeps.internal'

export const toAuthEmail = (username) =>
  `${String(username ?? '').trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`

export const fromAuthEmail = (email) =>
  typeof email === 'string' && email.endsWith(`@${AUTH_EMAIL_DOMAIN}`)
    ? email.slice(0, -(AUTH_EMAIL_DOMAIN.length + 1))
    : email

// ── Platform detection ─────────────────────────────────────────────────────
// Inside the Capacitor APK the protocol is capacitor:// or https://localhost
// and the native bridge is present. Push, haptics and the splash screen all
// take a different code path there.
export const isNativePlatform = () =>
  typeof window !== 'undefined' &&
  Boolean(window.Capacitor?.isNativePlatform?.())

export const isAndroid = () =>
  typeof window !== 'undefined' &&
  window.Capacitor?.getPlatform?.() === 'android'

// ── Client ─────────────────────────────────────────────────────────────────
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Persist the session so a reopened app stays signed in. This replaces
        // the manual localStorage/sessionStorage 'ls_token' handling, and the
        // "remember me" toggle is honoured by setSessionStorage() below.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ls_supabase_auth'
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    })
  : null

/**
 * Switch Supabase's auth persistence between localStorage ("remember me") and
 * sessionStorage. Supabase only offers a single storage backend, so we swap the
 * key location by re-creating the client — call this before signing in.
 */
export const createClientWithStorage = (remember) => {
  if (!isSupabaseConfigured) return null
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: remember,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'ls_supabase_auth',
      // When remember === false, keep the token in memory + sessionStorage so
      // closing the tab signs the user out.
      storage: remember ? undefined : window.sessionStorage
    }
  })
}

export { SUPABASE_URL }
