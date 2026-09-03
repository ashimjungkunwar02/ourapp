// ══════════════════════════════════════════════════════════════════════════
// send-push — Firebase Cloud Messaging fan-out for the Android app.
//
// Supabase has no server-side push service, so delivery to devices needs FCM.
// This function reads the FCM tokens stored on `profiles` and posts to the
// FCM v1 HTTP API.
//
// Auth signing is done with the WebCrypto API rather than `google-auth-library`
// so the function has ZERO npm dependencies: fewer cold-start milliseconds and
// no supply-chain surface inside a function that holds a service-account key.
//
// ── Setup ─────────────────────────────────────────────────────────────────
//   supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
//
// The JSON comes from Firebase Console -> Project settings -> Service accounts
// -> Generate new private key. It is a long-lived credential; treat it like a
// password and never commit it.
//
// ── Invocation ────────────────────────────────────────────────────────────
// Requires the service_role key (it reads every user's token). Two ways to call:
//
//   1. Database Webhook (recommended, fully server-side):
//        Project Settings -> Database -> Webhooks -> create a hook on
//        `notifications` INSERT pointing at this function, with the
//        service_role key in the Authorization header. Every notification the
//        SQL layer writes then becomes a real device push, with no client
//        involvement and nothing for a user to spoof.
//
//   2. Manually, for testing:
//        curl -X POST "$SUPABASE_URL/functions/v1/send-push" \
//          -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
//          -H "Content-Type: application/json" \
//          -d '{"to":"all","title":"Lisa Sweeps","body":"Coins are raining!"}'
//
// The anon key is deliberately REJECTED: a client must never be able to send an
// arbitrary notification to every user.
// ══════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
// FCM v1 accepts up to 500 registration tokens per batch request.
const BATCH_SIZE = 500

// ── Helpers ────────────────────────────────────────────────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':  'application/json',
      // Called cross-origin from a Database Webhook and from curl.
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlStr = (s: string): string =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Strip PEM armour and decode the DER payload. */
const pemToBytes = (pem: string): Uint8Array => {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  const bin  = atob(body)
  const out  = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── OAuth2: sign a JWT with the service account, exchange it for a token ───
// The result is valid for an hour, so cache it and only re-sign near expiry.
// Edge Function instances are short-lived, but a single fan-out may span
// several batches and this avoids one extra round-trip per batch.
let tokenCache: { token: string; expiresAt: number } | null = null

const getAccessToken = async (sa: {
  client_email: string
  private_key:  string
  token_uri?:   string
}): Promise<string> => {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(sa.private_key) as unknown as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now  = Math.floor(Date.now() / 1000)
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64urlStr(JSON.stringify({
    iss:   sa.client_email,
    scope: FCM_SCOPE,
    aud:   sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat:   now,
    // 55 minutes — Google rejects anything over 60.
    exp:   now + 3300,
  }))

  const signingInput = `${head}.${claims}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`

  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth token exchange failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return tokenCache.token
}

// ── Send ───────────────────────────────────────────────────────────────────
const sendBatch = async (
  projectId: string,
  accessToken: string,
  tokens: string[],
  message: { title: string; body: string; data?: Record<string, string> },
) => {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          // `token` (array) sends one request to many devices. `notification`
          // makes Android show it in the tray even when the app is killed;
          // `data` is what the JS layer receives in the foreground.
          token:        tokens,
          notification: { title: message.title, body: message.body },
          data:         message.data ?? {},
          android: {
            priority: 'high',
            notification: {
              // Distinct channel so users can mute rain spam separately from
              // account notices without losing everything.
              channel_id: 'lisa_sweeps_alerts',
              sound:      'default',
            },
          },
        },
      }),
    },
  )

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`FCM send failed (${res.status}): ${text.slice(0, 500)}`)
  }
  return text
}

// ── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const url       = new URL(req.url)
    const supaUrl   = Deno.env.get('SUPABASE_URL') ?? url.origin
    // Only the service_role key may fan out. Reject anon/authenticated callers
    // outright — otherwise any signed-in user could push to everyone.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) {
      return json({ error: 'Function is missing SUPABASE_SERVICE_ROLE_KEY' }, 500)
    }

    const authHeader = req.headers.get('authorization') ?? ''
    const presented  = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!presented || presented === 'anonymous' || presented !== serviceKey) {
      // Deliberately vague: do not reveal whether the presented key was a valid
      // anon token or garbage.
      return json({ error: 'Forbidden' }, 403)
    }

    const fcmJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
    if (!fcmJson) {
      return json({
        error: 'FCM_SERVICE_ACCOUNT_JSON is not set. See supabase/functions/send-push/index.ts header.',
      }, 503)
    }

    const sa = JSON.parse(fcmJson) as {
      client_email: string
      private_key:  string
      project_id:   string
      token_uri?:   string
    }
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      return json({ error: 'FCM_SERVICE_ACCOUNT_JSON is malformed' }, 500)
    }

    const body = await req.json().catch(() => ({})) as {
      to?:    'all' | string | string[]
      title?: string
      body?:  string
      data?:  Record<string, string>
    }

    const title = (body.title ?? '').toString().trim()
    const text  = (body.body  ?? '').toString().trim()
    if (!title || !text) {
      return json({ error: 'Both "title" and "body" are required' }, 400)
    }
    if (title.length > 65 || text.length > 240) {
      // Android truncates beyond roughly these lengths; reject rather than ship
      // a silently clipped message.
      return json({ error: 'title must be <= 65 chars and body <= 240 chars' }, 400)
    }

    const admin = createClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Resolve the recipient set to a list of FCM tokens.
    let query = admin
      .from('profiles')
      .select('id, fcm_token')
      .not('fcm_token', 'is', null)

    const to = body.to ?? 'all'
    if (to !== 'all') {
      const ids = Array.isArray(to) ? to : [to]
      if (ids.length === 0) return json({ error: 'Empty recipient list' }, 400)
      query = query.in('id', ids)
    }

    const { data: rows, error } = await query
    if (error) {
      return json({ error: `Token lookup failed: ${error.message}` }, 500)
    }

    const tokens = (rows ?? [])
      .map((r: { fcm_token: string | null }) => r.fcm_token)
      .filter((t: string | null): t is string => Boolean(t && t.trim()))

    if (tokens.length === 0) {
      return json({ sent: 0, recipients: 0, message: 'No devices are registered for push' })
    }

    const accessToken = await getAccessToken(sa)

    // Send in batches of 500 and collect per-batch failures so one bad batch
    // does not abort the whole fan-out.
    let sent = 0
    const failures: Array<{ batch: number; error: string }> = []

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE)
      try {
        await sendBatch(sa.project_id, accessToken, batch, { title, body: text, data: body.data })
        sent += batch.length
      } catch (err) {
        failures.push({ batch: i / BATCH_SIZE, error: (err as Error).message })
      }
    }

    // FCM reports dead tokens per-message, not per-batch, so a batch-level
    // failure here means the whole batch was rejected (quota, auth, payload).
    // Individual UNREGISTERED tokens are reported as a successful batch by the
    // v1 API; cleaning those up is the job of the webhook that records delivery.
    return json({
      sent,
      recipients: tokens.length,
      batches:    Math.ceil(tokens.length / BATCH_SIZE),
      failures,
      ok:         failures.length === 0,
    }, failures.length === 0 ? 200 : 207)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Do not leak stack traces or secret fragments to the caller.
    console.error('[send-push]', message)
    return json({ error: message.slice(0, 300) }, 500)
  }
})
