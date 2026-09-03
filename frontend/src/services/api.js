import {
  supabase,
  isSupabaseConfigured,
  toAuthEmail,
  isNativePlatform
} from './supabase'

// ══════════════════════════════════════════════════════════════════════════
// Supabase data layer.
//
// This module deliberately keeps the SAME public surface and the SAME response
// shapes as the old axios client:
//
//   * every call resolves to `{ data: ... }`
//   * every failure rejects with an error carrying
//     `err.response.status` and `err.response.data.message`
//
// so none of the components, pages or hooks had to change when the backend
// moved from Express/Mongo to Supabase. If you later want idiomatic Supabase
// calls, unwrap this layer gradually rather than all at once.
//
// Field names are mapped from snake_case (Postgres) to the camelCase the UI
// already used, and `id` is exposed as `_id` for the same reason.
// ══════════════════════════════════════════════════════════════════════════

// ── Error normalisation ────────────────────────────────────────────────────
// Postgres symbolic codes raised by the RPCs -> human-readable copy.
const MESSAGES = {
  NOT_AUTHENTICATED:        'Your session expired. Please sign in again.',
  ADMIN_REQUIRED:           'Admin access required',
  PROFILE_NOT_FOUND:        'Account not found',
  INSUFFICIENT_COINS:       'Not enough coins to spin',
  COIN_NOT_READY:           'Coin not ready yet',
  WHEEL_NOT_CONFIGURED:     'The prize wheel is not configured',
  REFERRAL_CODE_REQUIRED:   'Referral code required',
  INVALID_REFERRAL_CODE:    'Invalid referral code',
  SELF_REFERRAL:            'You cannot use your own referral code',
  REFERRAL_ALREADY_USED:    'You have already used a referral code',
  NOTIFICATION_ID_REQUIRED: 'Invalid notification id',
  NOTIFICATION_NOT_FOUND:   'Notification not found',
  PUSH_TOKEN_REQUIRED:      'Push token required',
  USER_ID_REQUIRED:         'User id required',
  USER_NOT_FOUND:           'User not found',
  INVALID_ADJUSTMENT_TYPE:  'Type must be add or deduct',
  AMOUNT_MUST_BE_POSITIVE:  'Amount must be greater than 0',
  AMOUNT_MUST_BE_INTEGER:   'Amount must be a whole number of coins',
  AMOUNT_TOO_LARGE:         'Amount must not exceed 1,000,000',
  INVALID_RAIN_AMOUNT:      'Amount must be a whole number between 1 and 100',
  INVALID_BONUS_TYPE:       "Type must be 'deposit' or 'referral'",
  INVALID_BONUS_PERCENTAGE: 'Percentage must be between 1 and 500',
  INVALID_BONUS_HOURS:      'Valid hours must be a positive number',
  MESSAGE_TOO_LONG:         'Message must be 500 characters or fewer',
  USERNAME_REQUIRED:        'Username is required'
}

// SQLSTATE -> HTTP status, mirroring what PostgREST would return for a REST
// call. The RPCs raise these codes deliberately so the UI can branch on status.
const STATUS_BY_CODE = {
  '28000': 401, // invalid_authorization_specification
  '42501': 403, // insufficient_privilege
  'P0002': 404, // no_data_found
  '23505': 409, // unique_violation
  '22023': 400  // invalid_parameter_value
}

class ApiError extends Error {
  constructor(status, message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    // Axios-compatible envelope — components read err.response.data.message.
    this.response = { status, data: { message } }
  }
}

const apiError = (status, message, code) => new ApiError(status, message, code)

const notConfigured = () =>
  apiError(
    503,
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
    'NOT_CONFIGURED'
  )

/** Turn a Supabase/PostgrestError into an ApiError. */
const toApiError = (error, fallback = 'Request failed') => {
  if (!error) return apiError(500, fallback)

  const raw    = error.message || fallback
  const code   = error.code || null
  const status = STATUS_BY_CODE[code] || 400

  // Supabase wraps auth failures differently from Postgres errors.
  if (/invalid login credentials/i.test(raw)) {
    // Match the old backend so the login form shows one consistent message and
    // username enumeration stays impossible.
    return apiError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
  }

  return apiError(status, MESSAGES[raw] || raw, code || raw)
}

// ── Row mappers ────────────────────────────────────────────────────────────
// Two styles on purpose:
//
//  * `withUnderscoreId` SPREADS the row. Use it for endpoints whose SQL already
//    returns the exact camelCase field names the UI reads (admin_list_users
//    aliases them in SQL). Spreading means a field added later cannot be
//    silently dropped by an out-of-date whitelist — which is exactly how the
//    missing-_id bug below survived review in the first place.
//
//  * explicit whitelists (`mapProfile`, `mapNotification`, `mapActivity`) are
//    kept where the SQL returns snake_case that must be renamed; each was
//    checked field-by-field against every component that reads it.
const withUnderscoreId = (row) => row && { ...row, _id: row.id }

const mapProfile = (row) => row && ({
  // `_id` keeps the existing UI code working; `id` is also exposed so new code
  // can use the idiomatic name.
  _id:          row.id,
  id:           row.id,
  username:     row.username,
  isAdmin:      row.is_admin,
  coins:        row.coins,
  streak:       row.streak,
  referredBy:   row.referred_by ?? null,
  referralCode: row.referral_code,
  totalSpins:   row.total_spins,
  bonusBalance: row.bonus_balance,
  lastLogin:    row.last_login,
  createdAt:    row.created_at
})

const mapNotification = (row) => row && ({
  _id:       row.id,
  id:        row.id,
  userId:    row.user_id,
  title:     row.title,
  message:   row.message,
  type:      row.type,
  read:      row.read,
  createdAt: row.created_at
})

const mapActivity = (row) => row && ({
  _id:         String(row.id),
  id:          row.id,
  userId:      row.user_id,
  username:    row.username,
  type:        row.type,
  description: row.description,
  metadata:    row.metadata,
  createdAt:   row.created_at
})

// ── Core RPC helper ────────────────────────────────────────────────────────
const rpc = async (fn, params = {}) => {
  if (!supabase) throw notConfigured()

  const { data, error } = await supabase.rpc(fn, params)
  if (error) throw toApiError(error, `${fn} failed`)
  return data
}

/** Wrap a value in the axios-style envelope the components expect. */
const envelope = (data) => ({ data })

// ── Session helpers ────────────────────────────────────────────────────────
/** Current access token, or null. Async because Supabase reads the session. */
export const getAccessToken = async () => {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
export const authAPI = {
  /**
   * The old API took a `remember` flag that chose between localStorage and
   * sessionStorage for the JWT. Supabase persists the session under a single
   * storage key (see services/supabase.js), so the flag is a no-op now.
   * The third argument is still accepted positionally — AuthContext passes it —
   * it is simply not declared, which keeps ESLint honest about unused params.
   */
  login: async (username, password) => {
    if (!supabase) throw notConfigured()

    if (!username || !password) {
      throw apiError(400, 'Username and password required')
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email:    toAuthEmail(username),
      password: String(password)
    })
    if (error) throw toApiError(error, 'Invalid credentials')

    // Best-effort: record the login for activity/DAU metrics. A failure here
    // must not block sign-in.
    try { await rpc('record_login') } catch { /* non-fatal */ }

    const profile = await authAPI.profile()
    return envelope({
      // The old API returned a JWT; Supabase manages tokens internally, so
      // expose the access token for parity with anything that still reads it.
      token: data.session?.access_token ?? null,
      user:  profile.data
    })
  },

  profile: async () => {
    if (!supabase) throw notConfigured()

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw apiError(401, 'No token provided')

    const { data: row, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()

    if (error) throw toApiError(error, 'Failed to load profile')
    if (!row)  throw apiError(404, 'Account not found', 'PROFILE_NOT_FOUND')

    return envelope(mapProfile(row))
  },

  logout: async () => {
    if (!supabase) return envelope({ message: 'Logged out' })
    const { error } = await supabase.auth.signOut()
    if (error) throw toApiError(error, 'Logout failed')
    return envelope({ message: 'Logged out' })
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GAME
// ══════════════════════════════════════════════════════════════════════════
export const gameAPI = {
  // spin_wheel() already returns { result, newBalance, bonusBalance } with the
  // exact field names the wheel component expects.
  spin:      async () => envelope(await rpc('spin_wheel')),
  coinStatus: async () => envelope(await rpc('coin_status')),
  claimCoin: async () => envelope(await rpc('claim_coin')),

  getNotifications: async () => {
    if (!supabase) throw notConfigured()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw apiError(401, 'No token provided')

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw toApiError(error, 'Failed to load notifications')
    return envelope((data || []).map(mapNotification))
  },

  markNotificationRead: async (id) => {
    await rpc('mark_notification_read', { p_id: id })
    return envelope({ ok: true })
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ADMIN
//
// createUser / resetPassword / setAdmin go to the `admin-manage-user` Edge
// Function because provisioning credentials requires the service_role key,
// which must never ship inside the app bundle.
// ══════════════════════════════════════════════════════════════════════════
const invokeAdmin = async (payload) => {
  if (!supabase) throw notConfigured()

  const { data, error } = await supabase.functions.invoke('admin-manage-user', {
    body: payload
  })

  if (error) {
    // FunctionsHttpError carries the raw Response on `.context`.
    let status  = 500
    let message = error.message || 'Admin action failed'
    try {
      const body = await error.context?.json?.()
      if (body?.message) message = body.message
      if (error.context?.status) status = error.context.status
    } catch { /* body wasn't JSON; keep the defaults */ }
    throw apiError(status, message)
  }

  return data
}

export const adminAPI = {
  getStats:     async ()          => envelope(await rpc('admin_stats')),
  getMetrics:   async (range='7d')=> envelope(await rpc('admin_metrics', { p_range: range })),

  // admin_list_users aliases every column to camelCase in SQL but returns `id`,
  // while UserManagement reads `user._id` for its React keys AND as the argument
  // to adjustPoints/resetPassword. Unmapped, every row key was `undefined` and
  // both admin actions would have fired with an undefined user id.
  getUsers:     async ()          => envelope(
    (await rpc('admin_list_users')).map(withUnderscoreId)
  ),

  getActivities: async (limit)    => envelope(
    (await rpc('admin_activities', { p_limit: limit ?? 20 })).map(mapActivity)
  ),

  adjustPoints: async (userId, amount, type) => envelope(
    await rpc('admin_adjust_points', {
      p_user_id: userId,
      p_amount:  Number(amount),
      p_type:    type
    })
  ),

  makeItRain: async (amount) => envelope(
    await rpc('admin_make_it_rain', { p_amount: Number(amount) })
  ),

  launchBonus: async ({ type, percentage, validHours, message }) => envelope(
    await rpc('admin_launch_bonus', {
      p_type:        type,
      p_percentage:  Number(percentage),
      p_valid_hours: Number(validHours),
      p_message:     message ?? null
    })
  ),

  createUser: async (username, password) => envelope(
    await invokeAdmin({ action: 'create', username, password })
  ),

  resetPassword: async (userId, password) => envelope(
    await invokeAdmin({ action: 'reset-password', userId, password })
  ),

  setAdmin: async (userId, isAdmin) => envelope(
    await invokeAdmin({ action: 'set-admin', userId, isAdmin })
  )
}

// ══════════════════════════════════════════════════════════════════════════
// REFERRAL
// ══════════════════════════════════════════════════════════════════════════
export const referralAPI = {
  getStats:  async ()      => envelope(await rpc('referral_stats')),
  applyCode: async (code)  => envelope(await rpc('apply_referral', { p_code: code }))
}

// ══════════════════════════════════════════════════════════════════════════
// PUSH
//
// On Android (Capacitor) push is FCM: the native plugin returns a registration
// token which we store on the profile, and an Edge Function or the Postgres
// trigger fans out via the FCM HTTP API.
//
// In a plain BROWSER there is no VAPID endpoint any more — Supabase does not
// proxy web-push — so `status()` reports enabled:false and the permission
// banner stays hidden rather than offering something that cannot work.
// ══════════════════════════════════════════════════════════════════════════
export const pushAPI = {
  status: async () => envelope({
    enabled:   isNativePlatform(),
    platform:  isNativePlatform() ? 'fcm' : 'none',
    publicKey: null
  }),

  // Kept for signature compatibility; FCM needs no VAPID key.
  vapidKey: async () => {
    throw apiError(503, 'Push uses FCM on this platform; no VAPID key applies')
  },

  /** @param fcmToken native FCM token; @param webSubscription legacy browser sub */
  subscribe: async (fcmToken, webSubscription = null) => envelope(
    await rpc('set_push_token', {
      p_fcm_token:      fcmToken ?? null,
      p_web_subscription: webSubscription
    })
  ),

  unsubscribe: async () => envelope(await rpc('clear_push_token'))
}

export { isSupabaseConfigured }
