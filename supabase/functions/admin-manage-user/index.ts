// ══════════════════════════════════════════════════════════════════════════
// admin-manage-user — Supabase Edge Function
//
// Replaces POST /api/admin/users/create and /users/:id/reset-password.
//
// WHY THIS ISN'T A POSTGRES FUNCTION: provisioning and resetting a credential
// lives in Supabase Auth (GoTrue), not in your database. SQL cannot create an
// auth.users row with a password, so these two operations need the Admin API,
// which requires the service_role key — and that key must NEVER reach a
// browser or the APK. Hence an Edge Function.
//
// USERNAME → EMAIL: Supabase Auth is email-based but this app logs in with a
// username. We synthesise a deterministic address under a reserved domain that
// cannot receive mail. The user never sees it. The frontend applies the same
// transform (see src/services/supabase.js :: toAuthEmail) — keep the two in
// sync or logins will silently fail.
//
// Deploy:
//   supabase functions deploy admin-manage-user
//   # do NOT pass --no-verify-jwt: we want Supabase to reject anonymous calls
// ══════════════════════════════════════════════════════════════════════════

// `npm:` rather than an esm.sh URL: this function holds the service_role key,
// so the dependency should resolve through Deno's npm registry integration
// (integrity-checked) instead of a third-party CDN.
import { createClient } from 'npm:@supabase/supabase-js@2'

const AUTH_EMAIL_DOMAIN = 'auth.lisasweeps.internal'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const toAuthEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ message: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY')
      return json({ message: 'Function is not configured' }, 500)
    }

    // ── Authenticate the CALLER with the anon-scoped client ────────────────
    // Never use the service-role client to inspect an incoming token: it
    // bypasses verification.
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ message: 'No token provided' }, 401)
    }

    const presented = authHeader.replace(/^bearer\s+/i, '').trim()

    // ═══════════════════════════════════════════════════════════════════════
    // BOOTSTRAP: create the FIRST admin of a brand-new project.
    //
    // Every other action in this function requires an admin caller — which a
    // fresh database does not have. Without this hatch the only way in is hand-
    // editing SQL in the dashboard. It is gated on four independent conditions,
    // all of which must hold:
    //
    //   1. BOOTSTRAP_ADMIN_USERNAME is set as a function secret
    //   2. the caller presents the service_role key EXACTLY (not a user JWT, so
    //      an attacker cannot reach it from the browser or the APK)
    //   3. the requested username matches that secret exactly
    //   4. the profiles table currently contains ZERO admins
    //
    // Condition 4 is what makes it self-closing: the moment one admin exists
    // the hatch is inert, even if the secret is left set. Unset it afterwards
    // anyway:  supabase secrets unset BOOTSTRAP_ADMIN_USERNAME
    //
    //   supabase secrets set BOOTSTRAP_ADMIN_USERNAME=yourname
    //   curl -X POST "$SUPABASE_URL/functions/v1/admin-manage-user" \
    //     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    //     -H "Content-Type: application/json" \
    //     -d '{"action":"bootstrap-admin","username":"yourname","password":"..."}'
    // ═══════════════════════════════════════════════════════════════════════
    const bootstrapName = (Deno.env.get('BOOTSTRAP_ADMIN_USERNAME') ?? '')
      .trim().toLowerCase()

    if (bootstrapName && presented === serviceKey) {
      const body = await req.json().catch(() => ({}))

      if (body?.action === 'bootstrap-admin') {
        const username = String(body?.username ?? '').trim().toLowerCase()
        const password = String(body?.password ?? '')

        if (username !== bootstrapName) {
          // Do not reveal the expected username; just refuse.
          return json({ message: 'Username does not match BOOTSTRAP_ADMIN_USERNAME' }, 403)
        }
        if (password.length < 8) {
          return json({ message: 'Password must be at least 8 characters' }, 400)
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })

        const { count: adminCount } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true)

        if ((adminCount ?? 0) > 0) {
          return json({
            message: 'An admin already exists — bootstrap is closed. Sign in and use set-admin instead.',
          }, 403)
        }

        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .eq('username', username)
          .maybeSingle()
        if (existing) {
          return json({ message: 'Username already taken' }, 400)
        }

        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email: toAuthEmail(username),
            password,
            email_confirm: true,
            user_metadata: { username },
          })
        if (createError) {
          return json({ message: createError.message ?? 'Failed to create user' }, 500)
        }

        // The handle_new_user trigger created the profile row; promote it.
        const { error: promoteError } = await admin
          .from('profiles')
          .update({ is_admin: true })
          .eq('id', created.user.id)
        if (promoteError) {
          return json({ message: promoteError.message }, 500)
        }

        await admin.from('activities').insert({
          user_id: created.user.id,
          username,
          type: 'admin',
          description: `bootstrapped first admin account: ${username}`,
          metadata: { action: 'bootstrap-admin' },
        })

        console.warn(
          '[admin-manage-user] bootstrap used. Run: supabase secrets unset BOOTSTRAP_ADMIN_USERNAME',
        )
        return json({
          message: 'First admin created. Unset BOOTSTRAP_ADMIN_USERNAME now.',
          user: { id: created.user.id, username, isAdmin: true },
        })
      }
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: authData, error: authError } = await userClient.auth.getUser(
      authHeader.replace(/^bearer\s+/i, ''),
    )
    if (authError || !authData?.user) {
      return json({ message: 'Invalid or expired token' }, 401)
    }

    // ── Authorise: caller must be an admin ─────────────────────────────────
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('id, username, is_admin')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (callerError) {
      console.error('admin lookup failed:', callerError.message)
      return json({ message: 'Authorisation check failed' }, 500)
    }
    if (!caller?.is_admin) {
      return json({ message: 'Admin access required' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    // ─────────────────────────────────────────────────────────────────────
    // CREATE USER
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'create') {
      const username = String(body?.username ?? '').trim().toLowerCase()
      const password = String(body?.password ?? '')

      if (username.length < 3 || username.length > 24) {
        return json({ message: 'Username must be 3-24 characters' }, 400)
      }
      if (!/^[a-z0-9_.-]+$/.test(username)) {
        return json(
          { message: 'Username may only contain letters, numbers, dot, dash, underscore' },
          400,
        )
      }
      if (password.length < 8) {
        return json({ message: 'Password must be at least 8 characters' }, 400)
      }

      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle()

      if (existing) {
        return json({ message: 'Username already taken' }, 400)
      }

      const email = toAuthEmail(username)

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // no mailbox exists at the synthetic domain
          user_metadata: { username },
        })

      if (createError) {
        // The handle_new_user trigger creates the profile row; a duplicate
        // username surfaces here as an auth-level conflict.
        const msg = createError.message ?? 'Failed to create user'
        const status = /already|exists|registered/i.test(msg) ? 400 : 500
        return json({ message: msg }, status)
      }

      // Belt and braces: the trigger should have created the profile already.
      await admin.from('profiles').upsert(
        { id: created.user.id, username },
        { onConflict: 'id', ignoreDuplicates: true },
      )

      await admin.from('activities').insert({
        user_id: caller.id,
        username: caller.username,
        type: 'admin',
        description: `created new user account: ${username}`,
        metadata: { action: 'create-user', targetUser: created.user.id },
      })

      return json({
        message: 'User created successfully',
        user: { id: created.user.id, username },
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // RESET PASSWORD
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'reset-password') {
      const userId = String(body?.userId ?? '')
      const password = String(body?.password ?? '')

      if (!userId) return json({ message: 'userId is required' }, 400)
      if (password.length < 8) {
        return json({ message: 'Password must be at least 8 characters' }, 400)
      }

      const { data: target } = await admin
        .from('profiles')
        .select('id, username')
        .eq('id', userId)
        .maybeSingle()

      if (!target) return json({ message: 'User not found' }, 404)

      const { error: updateError } = await admin.auth.admin.updateUserById(
        userId,
        { password },
      )
      if (updateError) {
        return json({ message: updateError.message ?? 'Failed to reset password' }, 500)
      }

      await admin.from('activities').insert({
        user_id: caller.id,
        username: caller.username,
        type: 'admin',
        description: `reset password for user: ${target.username}`,
        metadata: { action: 'reset-password', targetUser: userId },
      })

      return json({ message: 'Password reset successfully' })
    }

    // ─────────────────────────────────────────────────────────────────────
    // PROMOTE / DEMOTE ADMIN
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'set-admin') {
      const userId = String(body?.userId ?? '')
      const isAdmin = Boolean(body?.isAdmin)
      if (!userId) return json({ message: 'userId is required' }, 400)

      // Refuse to let the last admin demote themselves and lock everyone out.
      if (!isAdmin && userId === caller.id) {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_admin', true)
        if ((count ?? 0) <= 1) {
          return json({ message: 'Cannot demote the only admin' }, 400)
        }
      }

      const { error } = await admin
        .from('profiles')
        .update({ is_admin: isAdmin })
        .eq('id', userId)
      if (error) return json({ message: error.message }, 500)

      await admin.from('activities').insert({
        user_id: caller.id,
        username: caller.username,
        type: 'admin',
        description: `${isAdmin ? 'granted' : 'revoked'} admin for user ${userId}`,
        metadata: { action: 'set-admin', targetUser: userId, isAdmin },
      })

      return json({ message: 'Admin flag updated', isAdmin })
    }

    return json({ message: 'Unknown action' }, 400)
  } catch (err) {
    console.error('admin-manage-user error:', (err as Error)?.message ?? err)
    return json({ message: 'Internal error' }, 500)
  }
})
