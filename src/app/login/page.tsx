'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (result.success) {
        localStorage.setItem('noor_user_id', result.userId);
        router.push('/');
      } else {
        setError(result.message || 'Invalid email or password');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-8 pb-12">
        <div className="max-w-sm w-full">
          {/* Logo */}
          <div className="text-center mb-12">
            <h1
              className="text-2xl tracking-[0.35em] font-semibold"
              style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', Inter, sans-serif" }}
            >NOOR</h1>
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-3xl font-semibold tracking-tight mb-2">Welcome back.</h2>
            <p className="text-gray-500">Sign in to your account</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400"
            />

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-black text-white text-center font-medium rounded-xl transition-all duration-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 text-center space-y-3">
            <Link href="/forgot-password" className="text-sm text-gray-500 hover:text-black transition-colors">
              Forgot password?
            </Link>
            <p className="text-sm text-gray-500">
              Don't have an account?{' '}
              <Link href="/survey" className="text-black font-medium hover:opacity-70 transition-opacity">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
