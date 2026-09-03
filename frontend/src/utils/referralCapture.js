/**
 * Referral-link capture.
 *
 * Lives outside AuthContext.jsx so that module only exports components/hooks
 * (React Fast Refresh requires that), and so the storage key has a single
 * definition shared by the provider and the consumer hook.
 */

/** Where a pending referral code is parked between landing and login. */
export const REF_STORAGE_KEY = 'ls_pending_ref'

const CODE_PATTERN = /^[A-Z0-9]{4,16}$/

/**
 * Read `?ref=` from the current URL, park it in sessionStorage, and strip it
 * from the address bar.
 *
 * A visitor arrives at `/?ref=ABC123` while logged OUT, so the code has to
 * survive the round-trip through /login. Capturing it here — rather than after
 * authentication — is what makes that work.
 *
 * @returns the normalised code, or null if absent/invalid.
 */
export function captureReferralCode() {
  try {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('ref')

    if (!code) return null

    const cleaned = code.trim().toUpperCase()
    if (!CODE_PATTERN.test(cleaned)) return null

    // Don't overwrite a code captured from an earlier visit in this session.
    if (!sessionStorage.getItem(REF_STORAGE_KEY)) {
      sessionStorage.setItem(REF_STORAGE_KEY, cleaned)
    }

    // Strip ?ref= so a refresh doesn't re-trigger the apply flow and the shared
    // code doesn't linger in the address bar / browser history.
    params.delete('ref')
    const qs = params.toString()
    window.history.replaceState(
      null, '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    )

    return cleaned
  } catch {
    return null
  }
}

export function readPendingReferralCode() {
  try {
    return sessionStorage.getItem(REF_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearPendingReferralCode() {
  try {
    sessionStorage.removeItem(REF_STORAGE_KEY)
  } catch {
    /* private mode / storage disabled */
  }
}
