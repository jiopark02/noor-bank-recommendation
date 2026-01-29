'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createSession } from '@/lib/validation';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      if (!supabase) {
        setError('Authentication service unavailable');
        return;
      }

      try {
        // Get the session from the URL hash
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Session error:', sessionError);
          setError(sessionError.message);
          return;
        }

        if (session?.user) {
          // Save user info to localStorage
          const user = session.user;
          const profile = {
            id: user.id,
            email: user.email,
            firstName: user.user_metadata?.full_name?.split(' ')[0] || user.user_metadata?.name?.split(' ')[0] || '',
            lastName: user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '',
            avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
          };

          localStorage.setItem('noor_user_id', user.id);
          localStorage.setItem('noor_user_profile', JSON.stringify(profile));

          // Create session (keep signed in by default for OAuth)
          createSession(true);

          // Check if user has completed onboarding
          const existingProfile = localStorage.getItem('noor_onboarding_completed');

          if (existingProfile) {
            router.push('/');
          } else {
            // New user - go to survey to complete profile
            router.push('/survey');
          }
        } else {
          setError('No session found. Please try again.');
        }
      } catch (err) {
        console.error('Callback error:', err);
        setError('Authentication failed. Please try again.');
      }
    };

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-12 h-12 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-black mb-2">Authentication Failed</h1>
          <p className="text-gray-500 mb-6">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="w-full py-3 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="w-12 h-12 mx-auto mb-6">
          <svg className="animate-spin w-12 h-12 text-black" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-black mb-2">Signing you in...</h1>
        <p className="text-gray-500">Please wait while we complete your authentication.</p>
      </div>
    </div>
  );
}
