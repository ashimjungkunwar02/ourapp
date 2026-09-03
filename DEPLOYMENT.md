# Lisa Sweeps — Supabase + Cloudflare + Android deployment

This is the operational runbook for the migrated stack. Nothing here was
executable from the build sandbox (no network access to supabase.com,
cloudflare.com, dl.google.com, and no Postgres/JDK/Android SDK locally), so
every step below is written to be run by you, in order.

---

## 1. What the architecture is now

| Concern | Before | After |
|---|---|---|
| Database | MongoDB Atlas | **Supabase Postgres** |
| API | Express REST (`/api/*`) | **Postgres RPC functions** called directly from the browser |
| Auth | JWT signed by Express | **Supabase Auth** (GoTrue) |
| Realtime | Socket.io | **Supabase Realtime** (`live_events` table) |
| Authorization | Express middleware | **Row Level Security** policies |
| Admin user provisioning | Express + service secret | **Edge Function** `admin-manage-user` |
| Web hosting | Express serves `dist/` | **Cloudflare Pages** (static) |
| Push | `web-push` + VAPID | **FCM** via Capacitor + Edge Function `send-push` |
| Android app | none | **Capacitor 8** wrapper → APK |

`backend/` (the Express/Mongo implementation) is still in the repo as a
rollback path. Delete it once you have verified the Supabase deployment — see
[§8](#8-retiring-the-express-backend).

**There is no server process to run any more.** `npm run dev` in `frontend/` is
the whole app.

---

## 2. Supabase: create the project and apply the schema

### 2.1 Install and link

```bash
npm i -g supabase
cd ourapp
supabase login                     # opens a browser
supabase projects create lisa-sweeps --db-password '<strong-password>'
# note the project ref, e.g. abcdefghijklmnop
supabase link --project-ref <your-project-ref>
```

Store the DB password in your password manager. You will need it for
`psql`-style access and for the connection string in the dashboard.

### 2.2 Apply all six migrations

```bash
supabase db push
```

This applies, in order:

| File | Contents |
|---|---|
| `20260903000100_schema.sql` | 6 tables, `handle_new_user` trigger, normalization/`updated_at` triggers |
| `20260903000200_rls.sql` | RLS on every table + `is_admin()` / `current_username()` helpers |
| `20260903000300_game_functions.sql` | `spin_wheel`, `coin_status`, `claim_coin`, `apply_referral`, `referral_stats`, `mark_notification_read`, `record_login`, push-token setters |
| `20260903000400_admin_functions.sql` | `admin_stats`, `admin_list_users`, `admin_adjust_points`, `admin_make_it_rain`, `admin_launch_bonus`, `admin_activities`, `admin_metrics` |
| `20260903000500_realtime.sql` | `supabase_realtime` publication + `prune_live_events` |
| `20260903000600_seed.sql` | 13 wheel outcomes + `get_wheel_outcomes()` |

**If a migration fails**, `supabase db push` stops and tells you which one.
Fix, then re-run — every migration is written to be idempotent
(`create or replace`, `if not exists`, `on conflict do nothing`), so re-applying
is safe.

### 2.3 Verify the schema landed

```bash
supabase db remote exec --file - <<'SQL'
select count(*) as functions from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';
select count(*) as tables from information_schema.tables
 where table_schema = 'public';
select count(*) as wheel_outcomes from public.wheel_outcomes;
SQL
```

Expect roughly 29 functions, 6 tables, 13 wheel outcomes.

### 2.4 Schedule the live-events cleanup (optional but recommended)

`live_events` grows one row per admin broadcast. Prune it with pg_cron
(dashboard → Database → Extensions → enable `pg_cron`):

```sql
select cron.schedule(
  'prune-live-events',
  '0 4 * * *',
  $$select public.prune_live_events(3)$$   -- keep 3 days
);
```

---

## 3. Deploy the Edge Functions

```bash
supabase functions deploy admin-manage-user
supabase functions deploy send-push
```

Do **not** pass `--no-verify-jwt` — both functions rely on Supabase rejecting
calls that carry no valid project JWT, and each then performs its own
authorization check on top.

### 3.1 Secrets

```bash
# Push delivery. See §6 for where this file comes from.
supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — never set them yourself.

### 3.2 Create the FIRST admin (bootstrap)

Every admin action requires an admin caller, so a fresh database has no way to
create one. `admin-manage-user` has a self-closing hatch for exactly this:

```bash
supabase secrets set BOOTSTRAP_ADMIN_USERNAME=lisa

export SUPABASE_URL="https://<your-project-ref>.supabase.co"
export SERVICE_ROLE_KEY="<from dashboard → Project Settings → API>"

curl -X POST "$SUPABASE_URL/functions/v1/admin-manage-user" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"bootstrap-admin","username":"lisa","password":"<min-8-chars>"}'
```

Then close the hatch:

```bash
supabase secrets unset BOOTSTRAP_ADMIN_USERNAME
```

The hatch fires only when **all four** hold: the secret is set, the caller
presents the service-role key exactly, the username matches the secret, and the
`profiles` table contains zero admins. The fourth condition makes it inert the
instant it succeeds, even if you forget to unset the secret.

**Alternative** (no curl): dashboard → Authentication → Users → *Add user* →
email `lisa@auth.lisasweeps.internal`, set a password, tick *Auto Confirm*.
Then in the SQL editor:

```sql
update public.profiles set is_admin = true where username = 'lisa';
```

> The synthetic email domain `auth.lisasweeps.internal` is how a
> username-based login maps onto Supabase's email-based auth. It is defined in
> exactly two places that **must stay in sync**:
> `supabase/functions/admin-manage-user/index.ts` (`AUTH_EMAIL_DOMAIN`) and
> `frontend/src/services/supabase.js` (`AUTH_EMAIL_DOMAIN`).

---

## 4. Cloudflare Pages

### 4.1 Frontend environment

```bash
cd frontend
cp .env.example .env
```

Fill in from dashboard → Project Settings → API:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Both are **public by design**. The anon key is not a secret — Row Level
Security is what protects your data. Never put the `service_role` key in the
frontend; the CI workflows actively fail the build if they find one.

Confirm the app runs locally before deploying:

```bash
npm run dev
```

You should reach the login screen (not the amber "not connected to Supabase"
setup page) and be able to sign in as the bootstrap admin.

### 4.2 Deploy — option A: GitHub Actions (recommended)

Add these repo secrets (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Edit Cloudflare Pages* template |
| `CLOUDFLARE_ACCOUNT_ID` | 32-hex id in the dashboard URL after selecting your account |
| `VITE_SUPABASE_URL` | as above |
| `VITE_SUPABASE_ANON_KEY` | as above |

Then push to `main`. `.github/workflows/deploy-cloudflare.yml` builds and
publishes, and fails loudly if the Supabase secrets are missing or if
`_redirects` / `_headers` did not make it into `dist/`.

### 4.3 Deploy — option B: Wrangler by hand

```bash
npm i -g wrangler
wrangler login
cd frontend && npm run build
wrangler pages deploy dist --project-name=lisa-sweeps
```

### 4.4 What `public/_redirects` and `public/_headers` do

* `_redirects` → `/* /index.html 200`. Without it, a refresh or a shared link
  on `/referral`, `/contact` or `/admin` 404s, because react-router routes have
  no corresponding file. Static assets are matched first, so they are unaffected.
* `_headers` replaces the Express `helmet` middleware, which no longer runs
  anywhere: CSP, `X-Frame-Options`, `nosniff`, HSTS, `Permissions-Policy`, plus
  `immutable` caching for Vite's hashed `/assets/*` and `no-store` for `sw.js`.

  The CSP uses `connect-src 'self' https: wss:` so it works against any Supabase
  project without committing your project ref. **Tighten it after your first
  successful deploy:**

  ```
  connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
  ```

  Then verify in DevTools → Console that no request is blocked.

---

## 5. Android APK

### 5.1 Build via GitHub Actions (no local toolchain needed)

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/android-apk.yml` installs Node 22, JDK 21 and the Android
SDK, builds the web bundle, runs `cap sync`, and runs `gradlew assembleRelease`.
The APK is attached to a GitHub Release with its SHA-256.

Add these secrets for a *signed, installable* release build:

| Secret | Notes |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | |
| `ANDROID_KEY_ALIAS` | |
| `ANDROID_KEY_PASSWORD` | |
| `GOOGLE_SERVICES_JSON` | optional — see §6 |

Generate the keystore once and **back it up**. Losing it means you can never
publish an update under the same application id:

```bash
keytool -genkeypair -v \
  -keystore lisa-sweeps-release.keystore \
  -alias lisa-sweeps -keyalg RSA -keysize 2048 -validity 10000
```

Without the keystore secrets the workflow still succeeds but logs a warning and
produces an **unsigned** release APK, which Android will refuse to install.

For a quick test build instead: Actions → *Android APK* → Run workflow →
variant `debug`. Debug APKs are signed with the runner's auto-generated debug
key and install normally (after allowing "unknown sources").

### 5.2 Build locally

Requires JDK 17+ and the Android SDK (Android Studio is the easy route).

```bash
cd frontend
npm install
npm run android:apk            # debug APK
npm run android:apk:release    # release APK (needs android/keystore.properties)
npm run android:open           # open in Android Studio
```

Output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

For local release signing, copy `android/keystore.properties.example` to
`android/keystore.properties`. Note that Gradle resolves `storeFile` relative to
`frontend/android/app/`, so **use an absolute path** to avoid confusion.

### 5.3 Install on a device

```bash
adb install -r app-debug.apk
```

Or transfer the APK and open it; Android will ask to allow installs from that
source.

### 5.4 App identity

`frontend/capacitor.config.json` sets `appId: com.lisasweeps.app` and
`appName: Lisa Sweeps`. The launcher icon is still Capacitor's default —
replace it before shipping:

```bash
npm i -D @capacitor/assets
# put icon.png (1024x1024) and splash.png (2732x2732) in assets/
npx capacitor-assets generate --android
```

---

## 6. Push notifications (FCM)

Push works **only in the Android app**. On the website there is no delivery
path any more: Supabase does not proxy web-push, so `pushAPI.status()` reports
`enabled: false` in a browser and the permission banner stays hidden rather
than collecting a subscription that could never be delivered.

1. [Firebase Console](https://console.firebase.google.com) → Add project.
2. Add an **Android** app with package name **exactly** `com.lisasweeps.app`.
   A mismatch produces `SENDER_ID_MISMATCH` and no token is ever issued.
3. Download `google-services.json` → save as
   `frontend/android/app/google-services.json`.
   It is gitignored; CI reads it from the `GOOGLE_SERVICES_JSON` secret.
   See `android/app/google-services.json.example` for the shape and the full
   checklist.
4. Project settings → Service accounts → **Generate new private key** →
   `supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"`
5. Rebuild the APK.

`POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK` and the exact-alarm permissions are
already declared in `AndroidManifest.xml`. Android 13+ prompts at runtime when
the user taps the in-app banner.

### Wiring delivery to notifications

`send-push` reads FCM tokens from `profiles` and posts to the FCM v1 API in
batches of 500. It rejects the anon key outright — only the service-role key
can fan out.

Nothing calls it automatically yet. The recommended trigger is a **Database
Webhook** (Project Settings → Database → Webhooks) on `notifications` INSERT,
pointing at `send-push` with the service-role key in the Authorization header.
That makes every notification your SQL functions write become a real device
push, with no client involvement and nothing a user can spoof.

Test it directly:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-push" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"all","title":"Lisa Sweeps","body":"Coins are raining!"}'
```

The hourly "your coin is ready" reminder does **not** need FCM — it is scheduled
on-device with `@capacitor/local-notifications`, so it fires even offline.

---

## 7. Verification checklist

### 7.1 First: run the automated smoke test

Before clicking through anything, paste **`supabase/verify.sql`** into
dashboard → SQL Editor → Run. It executes 59 checks against the functions you
just deployed and prints a PASS/FAIL table plus a one-line verdict.

It works by creating one throwaway `_smoketest` user and setting
`request.jwt.claims` directly, so it exercises `spin_wheel`, `claim_coin`,
`apply_referral` and the whole admin surface exactly as a logged-in player and
then an admin would — no browser, no GoTrue password. It deletes the test user
and its activity rows afterwards, so it leaves nothing behind and is safe to
re-run.

It deliberately does **not** execute `admin_make_it_rain` or
`admin_launch_bonus`, because both credit every user by design and would hand
real coins to your bootstrap admin. Their admin-only gate is tested instead;
do the live rain check manually in step 7.2 below.

What it covers: migrations landed · RLS on all 6 tables · `live_events` in the
Realtime publication · 13 seeded wheel outcomes · the `handle_new_user` trigger
· first coin claim credits exactly 1 · an early second claim raises
`COIN_NOT_READY` · a spin costs exactly 1 coin and increments `total_spins` ·
the drawn prize is a real row · `newBalance` matches the stored balance ·
self-referral and unknown-code rejection · non-admin gets `42501` · RLS hides
other users' profiles · `admin_metrics` honours both 7d and 30d ranges ·
`admin_list_users` leaks no password column · every input-validation guard ·
anonymous calls get `28000`.

If anything FAILS, the `detail` column holds the Postgres error text — send
that line back.

### 7.2 Then: click through the UI

Run through this once after deploying. Each line is a distinct subsystem.

- [ ] `npm run dev` → login page renders (not the amber setup page)
- [ ] Sign in as the bootstrap admin
- [ ] Spin the wheel → prize awarded, balance decreases by 1, `total_spins` +1
- [ ] Spin again immediately → "Not enough coins" (not a silent success)
- [ ] Coin timer counts down; claim at 0 → balance +1, streak advances
- [ ] Day boundary: `utc_day_start()` means streaks reset at **00:00 UTC**, not
      server-local time. This is a deliberate change from the Express version.
- [ ] Referral: copy link, open in a second browser, apply code → both balances
      credited exactly once (second apply → "already used")
- [ ] Notifications appear and can be marked read
- [ ] Admin → Make it Rain → a **second** browser sees the rain animation
      live (Supabase Realtime, no reload)
- [ ] Admin → Launch Bonus → live bonus banner appears in the other session
- [ ] Admin → Users: list has no password/token columns; adjust points works
- [ ] Admin → Metrics: DAU / spins / bonus charts have one point per day for the
      selected range
- [ ] Deploy to Pages → hard-refresh `/referral` → renders, not 404
- [ ] DevTools → Network → `_headers` present: `content-security-policy`,
      `x-frame-options: DENY`, and no blocked requests in Console
- [ ] Build APK, install, sign in, spin — same behaviour as the web app
- [ ] APK: tap the notification banner → permission dialog → push received
- [ ] Sign out → session cleared → protected routes redirect to `/login`

---

## 8. Retiring the Express backend

`backend/` is dead code once the above checklist passes. It is kept only so you
can diff behaviour or roll back while you verify.

To remove it:

```bash
git rm -r backend
```

Then also delete the now-unused artifacts:

* `frontend/public/sw.js`'s legacy `/api/` cache bypass (harmless, but dead)
* any `VITE_API_URL` / `VITE_SOCKET_URL` / `VITE_VAPID_PUBLIC_KEY` still in a
  local `.env` — the code no longer reads them

**Before you delete it**, if you are migrating real player data off MongoDB,
export it first: balances, streaks, referral relationships and notification
history live only in Mongo. The Postgres schema mirrors the Mongo collections
field-for-field (see the header comment in `20260903000100_schema.sql`), so a
one-off `mongodump` → CSV → `copy` script is straightforward. Ask if you want
that written.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Amber "not connected to Supabase" page | `VITE_*` vars missing | §4.1; restart the dev server — Vite reads `.env` only at startup |
| Login always says "Invalid credentials" | Username/email domain mismatch | Compare `AUTH_EMAIL_DOMAIN` in the Edge Function and `supabase.js` |
| Login works in web but not in the APK | Bundle built before `.env` was set | `npm run build:android` again; env is baked in at build time |
| `relation "public.profiles" does not exist` | Migrations not applied | `supabase db push` |
| RPC returns `ADMIN_REQUIRED` for an admin | `is_admin` not set | §3.2, or `update profiles set is_admin = true where username = '...'` |
| Realtime events never arrive | Publication missing | Re-run `20260903000500_realtime.sql`; check the client is signed in (anon has no read access to `live_events`) |
| Push permission dialog never appears | Missing `google-services.json` | §6; rebuild the APK after adding it |
| `SENDER_ID_MISMATCH` in logcat | Firebase package name ≠ `com.lisasweeps.app` | Re-register the app in Firebase with the exact id |
| Release APK won't install | Unsigned | Add the `ANDROID_KEYSTORE_*` secrets, or use the debug variant |
| Pages deep link 404s | `_redirects` missing from `dist/` | It lives in `frontend/public/`; the CI job verifies it |
| Deploy blocked by CSP in Console | `connect-src` too narrow | Add your Supabase host and its `wss://` counterpart |

---

## 10. Files added or changed by this migration

**New — database**
```
supabase/config.toml
supabase/migrations/20260903000100_schema.sql
supabase/migrations/20260903000200_rls.sql
supabase/migrations/20260903000300_game_functions.sql
supabase/migrations/20260903000400_admin_functions.sql
supabase/migrations/20260903000500_realtime.sql
supabase/migrations/20260903000600_seed.sql
supabase/functions/admin-manage-user/index.ts
supabase/functions/send-push/index.ts
supabase/verify.sql                    <- post-deploy smoke test, run this first
```

**New — hosting & app**
```
.github/workflows/deploy-cloudflare.yml
.github/workflows/android-apk.yml
frontend/capacitor.config.json
frontend/android/                      (Capacitor project; web assets gitignored)
frontend/android/app/google-services.json.example
frontend/android/keystore.properties.example
frontend/public/_redirects
frontend/public/_headers
frontend/src/services/supabase.js
frontend/src/pages/SetupErrorPage.jsx
```

**Rewritten**
```
frontend/src/services/api.js           same exports, now RPC-backed
frontend/src/context/AuthContext.jsx   Supabase Auth + session listener
frontend/src/hooks/useSocket.js        Supabase Realtime channel
frontend/src/hooks/usePushNotifications.js  FCM on native, honest no-op on web
frontend/src/router/index.jsx          setup guard
frontend/vite.config.js                dead Express proxy removed
frontend/.env.example                  Supabase variables
```

**No component, page or layout file changed.** `api.js` still returns
`{ data: ... }` and still rejects with `err.response.data.message`, and it maps
Postgres `id` → `_id`, which is exactly the contract every component was
already written against.

**Removed from `frontend/package.json`**: `axios`, `socket.io-client`.
**Added**: `@supabase/supabase-js`, `@capacitor/*`.
