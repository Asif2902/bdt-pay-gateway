/**
 * Auth context — email+password JWT stored in localStorage.
 * No Supabase dependency.
 */

import { useState, useEffect, createContext, useContext } from 'react';
import { authApi, merchantApi } from '@/lib/api';
import type { Merchant } from '@/types';

interface User { id: string; email: string; role: string; }

interface AuthContextValue {
  user: User | null;
  merchant: Merchant | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => void;
  refreshMerchant: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthContext.Provider');
  return ctx;
}

export function useAuthProvider(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMerchant() {
    try {
      const data = await merchantApi.get();
      setMerchant(data);
    } catch {
      setMerchant(null);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(({ user: u }) => {
        setUser(u);
        return loadMerchant();
      })
      .catch(() => { localStorage.removeItem('auth_token'); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string) {
    const { token, user: u } = await authApi.login(email, password);
    localStorage.setItem('auth_token', token);
    setUser(u);
    await loadMerchant();
  }

  async function signUp(email: string, password: string, fullName?: string) {
    const { token, user: u } = await authApi.register(email, password, fullName);
    localStorage.setItem('auth_token', token);
    setUser(u);
  }

  function signOut() {
    localStorage.removeItem('auth_token');
    setUser(null);
    setMerchant(null);
  }

  async function refreshMerchant() {
    await loadMerchant();
  }

  return { user, merchant, loading, signIn, signUp, signOut, refreshMerchant };
}
