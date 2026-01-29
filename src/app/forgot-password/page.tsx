'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  validateEmail,
  validatePassword,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
  ERROR_MESSAGES,
} from '@/lib/validation';

type Step = 'email' | 'sent' | 'reset' | 'success';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Check for reset token in URL
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setResetToken(token);
      setStep('reset');
    }
  }, [searchParams]);

  // Countdown for resend
  useEffect(() => {
    if (step === 'sent' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCanResend(true);
    }
  }, [step, countdown]);

  // Password validation
  const passwordValidation = useMemo(() => {
    return validatePassword(newPassword);
  }, [newPassword]);

  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validate email
    const validation = validateEmail(email);
    if (!validation.isValid) {
      setEmailError(validation.error);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setStep('sent');
      setCountdown(60);
      setCanResend(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.SERVER_ERROR);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend || !email) return;
    setIsLoading(true);
    setCanResend(false);
    setCountdown(60);

    try {
      const response = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to resend email');
      }

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.SERVER_ERROR);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validate password
    if (!passwordValidation.isValid) {
      setError('Password does not meet requirements');
      setIsLoading(false);
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords don't match");
      setIsLoading(false);
      return;
    }

    if (!resetToken) {
      setError('Invalid or expired reset link. Please request a new one.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetToken,
          password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.SERVER_ERROR);
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

          <AnimatePresence mode="wait">
            {/* Step 1: Enter Email */}
            {step === 'email' && (
              <motion.div
                key="email"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-semibold tracking-tight mb-2">Forgot password?</h2>
                  <p className="text-gray-500 text-sm">
                    No worries. Enter your email and we'll send you a reset link.
                  </p>
                </div>

                <form onSubmit={handleSendResetLink} className="space-y-4">
                  <div className="space-y-1">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setEmailError(null);
                      }}
                      placeholder="Email"
                      required
                      className={`w-full px-4 py-3.5 border rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400 ${
                        emailError ? 'border-red-300 bg-red-50' : 'border-gray-200'
                      }`}
                    />
                    {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-3 bg-red-50 border border-red-200 rounded-xl"
                    >
                      <p className="text-red-600 text-sm text-center">{error}</p>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !email}
                    className="w-full py-4 bg-black text-white font-medium rounded-xl transition-all duration-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>

                <Link
                  href="/login"
                  className="flex items-center justify-center gap-2 mt-6 text-sm text-gray-500 hover:text-black transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to sign in
                </Link>
              </motion.div>
            )}

            {/* Step 2: Email Sent */}
            {step === 'sent' && (
              <motion.div
                key="sent"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center"
              >
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>

                <h2 className="text-2xl font-semibold tracking-tight mb-2">Check your email</h2>
                <p className="text-gray-500 text-sm mb-6">
                  We've sent a password reset link to<br />
                  <span className="text-black font-medium">{email}</span>
                </p>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                  <p className="text-sm text-amber-800">
                    The link will expire in <strong>1 hour</strong>. Check your spam folder if you don't see it.
                  </p>
                </div>

                <button
                  onClick={handleResend}
                  disabled={!canResend || isLoading}
                  className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${
                    canResend
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? (
                    'Sending...'
                  ) : canResend ? (
                    'Resend Email'
                  ) : (
                    `Resend in ${countdown}s`
                  )}
                </button>

                <Link
                  href="/login"
                  className="flex items-center justify-center gap-2 mt-6 text-sm text-gray-500 hover:text-black transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to sign in
                </Link>
              </motion.div>
            )}

            {/* Step 3: Reset Password */}
            {step === 'reset' && (
              <motion.div
                key="reset"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-semibold tracking-tight mb-2">Set new password</h2>
                  <p className="text-gray-500 text-sm">
                    Your new password must meet all requirements below.
                  </p>
                </div>

                <form onSubmit={handleResetPassword} className="space-y-4">
                  {/* New Password */}
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password"
                        required
                        className="w-full px-4 py-3.5 pr-12 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {newPassword && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ backgroundColor: getPasswordStrengthColor(passwordValidation.strength) }}
                              initial={{ width: 0 }}
                              animate={{ width: `${passwordValidation.score}%` }}
                            />
                          </div>
                          <span
                            className="text-xs font-medium"
                            style={{ color: getPasswordStrengthColor(passwordValidation.strength) }}
                          >
                            {getPasswordStrengthLabel(passwordValidation.strength)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          {[
                            { key: 'minLength', label: '8+ characters' },
                            { key: 'hasUppercase', label: 'Uppercase' },
                            { key: 'hasLowercase', label: 'Lowercase' },
                            { key: 'hasNumber', label: 'Number' },
                            { key: 'hasSpecial', label: 'Special char' },
                          ].map(item => (
                            <div
                              key={item.key}
                              className={`flex items-center gap-1 ${
                                passwordValidation.checks[item.key as keyof typeof passwordValidation.checks]
                                  ? 'text-emerald-600'
                                  : 'text-gray-400'
                              }`}
                            >
                              {passwordValidation.checks[item.key as keyof typeof passwordValidation.checks] ? (
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                                </svg>
                              )}
                              {item.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black"
                    />
                    {confirmPassword && (
                      <div className={`flex items-center gap-1 text-xs ${passwordsMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                        {passwordsMatch ? (
                          <>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Passwords match
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                            Passwords don't match
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-3 bg-red-50 border border-red-200 rounded-xl"
                    >
                      <p className="text-red-600 text-sm text-center">{error}</p>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !passwordValidation.isValid || !passwordsMatch}
                    className="w-full py-4 bg-black text-white font-medium rounded-xl transition-all duration-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Updating...
                      </span>
                    ) : (
                      'Update Password'
                    )}
                  </button>
                </form>
              </motion.div>
            )}

            {/* Step 4: Success */}
            {step === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="text-center"
              >
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <h2 className="text-2xl font-semibold tracking-tight mb-2">Password updated</h2>
                <p className="text-gray-500 text-sm mb-8">
                  Your password has been changed successfully. You can now sign in with your new password.
                </p>

                <Link
                  href="/login"
                  className="block w-full py-4 bg-black text-white font-medium rounded-xl text-center transition-all duration-300 hover:bg-gray-800"
                >
                  Sign In
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-gray-300">
          Your data stays private. Always.
        </p>
      </footer>
    </div>
  );
}
