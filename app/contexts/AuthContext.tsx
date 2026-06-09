"use client";

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthResult {
  success: boolean;
  error?: string;
  needsConfirmation?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!isMounted) {
          return;
        }

        if (error) {
          setUser(null);
        } else {
          setUser(data.session?.user ?? null);
        }
      } catch {
        if (!isMounted) {
          return;
        }
        setUser(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        setUser(data.user);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/api/auth/callback`,
        },
      })

      if (error) {
        return { success: false, error: error.message }
      }

      if (data.url) {
        window.location.assign(data.url)
      }

      return { success: true }
    } catch {
      return { success: false, error: 'An unexpected error occurred' }
    }
  }

  const signUpWithEmail = async (email: string, password: string, displayName: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
          data: {
            display_name: displayName,
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        return { success: true, needsConfirmation: true };
      }

      if (data.user && data.session) {
        setUser(data.user);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = async () => {
    // Clear sessionStorage wallet data first
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('ownerAddress');
      sessionStorage.removeItem('walletKey');
      sessionStorage.removeItem('ownerKey');
    }
    
    const { error } = await supabase.auth.signOut();
    if (error) {
      return;
    }
    setUser(null);
  };

  const value = {
    user,
    isLoading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 