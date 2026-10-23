import { useState, useEffect, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { merchantApi } from '@/lib/api';
import type { Profile, Merchant } from '@/types';
import type { User } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  merchant: Merchant | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshMerchant: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  merchant: null,
  loading: true,
  signOut: async () => {},
  refreshMerchant: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextValue {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(u: User) {
    try {
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .single();
      setProfile((result.data as Profile | null) ?? null);
    } catch {
      setProfile(null);
    }
  }

  async function loadMerchant() {
    try {
      const data = await merchantApi.getOwn();
      setMerchant(data);
    } catch {
      setMerchant(null);
    }
  }

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        void Promise.all([loadProfile(u), loadMerchant()]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        void loadProfile(u);
        void loadMerchant();
      } else {
        setProfile(null);
        setMerchant(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return {
    user,
    profile,
    merchant,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setMerchant(null);
    },
    refreshMerchant: loadMerchant,
  };
}
