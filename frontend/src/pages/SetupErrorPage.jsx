import { AlertTriangle, Terminal, KeyRound, ExternalLink } from 'lucide-react'

/**
 * Rendered INSTEAD of the whole app when the Supabase env vars are missing.
 *
 * Without this the user would land on a login form where every attempt fails
 * with an opaque 503 — indistinguishable from "wrong password". The migration
 * from Express to Supabase made two environment variables mandatory, and this
 * page says exactly which ones and where to get them.
 *
 * Shows only in development/local builds. A production deploy that reaches this
 * screen means the CI secrets were never set (the workflow fails the build
 * first, so it should not happen).
 */
export default function SetupErrorPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-amber-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start gap-3 mb-6">
          <AlertTriangle className="w-7 h-7 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              Lisa Sweeps is not connected to Supabase yet
            </h1>
            <p className="text-slate-400 mt-1 text-sm sm:text-base">
              The app talks directly to Supabase from the browser now — there is no
              Express server to start. Two public environment variables are required.
            </p>
          </div>
        </div>

        <ol className="space-y-4 text-sm">
          <li className="bg-slate-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white font-semibold mb-2">
              <KeyRound className="w-4 h-4 text-amber-400" />
              1. Copy the env template
            </div>
            <pre className="text-emerald-300 font-mono text-xs overflow-x-auto">
              cd frontend{'\n'}cp .env.example .env
            </pre>
          </li>

          <li className="bg-slate-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white font-semibold mb-2">
              <ExternalLink className="w-4 h-4 text-amber-400" />
              2. Fill in your project credentials
            </div>
            <p className="text-slate-400 mb-2">
              Supabase dashboard → your project →{' '}
              <span className="text-slate-200">Project Settings → API</span>
            </p>
            <pre className="text-emerald-300 font-mono text-xs overflow-x-auto">
              VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
            </pre>
            <p className="text-slate-500 mt-2 text-xs">
              Both are safe to expose — the anon key is protected by Row Level
              Security. Never put the <code className="text-slate-400">service_role</code>{' '}
              key here; it belongs only in Supabase Edge Function secrets.
            </p>
          </li>

          <li className="bg-slate-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white font-semibold mb-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              3. Apply the database schema, then restart
            </div>
            <pre className="text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
              supabase link --project-ref YOUR-PROJECT-REF{'\n'}supabase db push{'\n'}supabase functions deploy{'\n'}{'\n'}npm run dev
            </pre>
          </li>
        </ol>

        <p className="text-slate-500 text-xs mt-6">
          Full walkthrough, including creating the first admin account and building
          the Android APK, is in <code className="text-slate-400">DEPLOYMENT.md</code>.
        </p>
      </div>
    </div>
  )
}
