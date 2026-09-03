/**
 * Service worker registration.
 *
 * `public/sw.js` shipped with the app but NOTHING ever registered it, so:
 *   - the PWA was never installable,
 *   - offline fallback never worked,
 *   - `navigator.serviceWorker.ready` (awaited by the push hook) would have hung
 *     forever, and web push could not function at all.
 *
 * Registration is gated to production builds by default: a caching SW in front
 * of the Vite dev server serves stale modules and breaks HMR. Set
 * VITE_ENABLE_SW=true in frontend/.env to opt in during development.
 */
const SW_URL = '/sw.js'

export const swSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator

export const swEnabled = () =>
  import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true'

// Memoised so repeated calls (main.jsx + the push hook) don't double-register.
let registrationPromise = null

/** Register the SW. Resolves to the registration, or null if unavailable. */
export async function registerServiceWorker() {
  if (!swSupported() || !swEnabled()) return null

  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then(reg => {
        // Pick up a new SW without waiting for all tabs to close.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[sw] update available — reload to apply')
            }
          })
        })
        return reg
      })
      .catch(err => {
        console.warn('[sw] registration failed:', err.message)
        registrationPromise = null // allow a later retry
        return null
      })
  }

  return registrationPromise
}

/** Look up an existing registration without creating one. */
export async function getSWRegistration() {
  if (!swSupported()) return null
  try {
    return await navigator.serviceWorker.getRegistration(SW_URL)
  } catch {
    return null
  }
}

export { SW_URL }
