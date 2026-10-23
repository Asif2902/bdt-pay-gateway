/**
 * Standalone admin login page — uses a separate password JWT,
 * completely independent of the Supabase merchant auth flow.
 *
 * On success, stores the token in sessionStorage (cleared when tab closes)
 * and navigates to /admin.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

export const ADMIN_TOKEN_KEY = 'admin_jwt';

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  // If already logged in, skip straight to admin
  useEffect(() => {
    if (getAdminToken()) {
      void navigate('/admin', { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });

      const json = await res.json() as { success: boolean; data?: { token: string }; error?: string };

      if (!res.ok || !json.success) {
        toast.error(json.error ?? 'Login failed');
        return;
      }

      if (json.data?.token) {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, json.data.token);
      }

      void navigate('/admin', { replace: true });
    } catch {
      toast.error('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-dvh bg-slate-50 flex items-center justify-center px-4"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center mb-4 shadow-lg">
            <span className="text-white text-xl font-bold font-mono">৳</span>
          </div>
          <h1
            className="text-2xl font-bold text-slate-900"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Admin Portal
          </h1>
          <p className="text-sm text-slate-500 mt-1">BDT Pay Gateway</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-600">Enter admin password</span>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                autoComplete="current-password"
                className="w-full px-4 py-3 pr-12 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-slate-50"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          This portal is for operators only.
        </p>
      </div>
    </div>
  );
}
