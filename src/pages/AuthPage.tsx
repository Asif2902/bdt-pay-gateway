import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export default function AuthPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) void navigate('/dashboard');
  }, [user, navigate]);

  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-navy-900 mb-4"
               style={{ background: '#0f1a2e' }}>
            <span className="text-2xl font-bold text-white font-mono">৳</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
            BDT Pay Gateway
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Accept USDC payments, receive BDT</p>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#0f1a2e',
                    brandAccent: '#1e3a5f',
                  },
                  radii: {
                    borderRadiusButton: '10px',
                    inputBorderRadius: '10px',
                  },
                },
              },
              className: {
                button: 'font-medium',
                input: 'text-sm',
              },
            }}
            providers={[]}
            redirectTo={window.location.origin + '/dashboard'}
          />
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Payments settle on Arc Mainnet (USDC). BDT payouts are manual.
        </p>
      </div>
    </div>
  );
}
