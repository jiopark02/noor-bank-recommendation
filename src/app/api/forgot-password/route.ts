import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { findUserByEmail } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/email';
import { randomBytes } from 'crypto';

// Generate a secure random token
function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user: { id: string; first_name?: string; email: string } | null = null;

    // Try to find user in Supabase first
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        const { data } = await supabase
          .from('users')
          .select('id, first_name, email')
          .eq('email', normalizedEmail)
          .single();

        if (data) {
          user = data;
        }
      } catch (error) {
        console.error('Supabase lookup error:', error);
      }
    }

    // Fallback to local store
    if (!user) {
      const localUser = findUserByEmail(normalizedEmail);
      if (localUser) {
        user = {
          id: localUser.id,
          first_name: localUser.first_name,
          email: localUser.email,
        };
      }
    }

    // Always return success for security (don't reveal if email exists)
    if (!user) {
      // Still return success to prevent email enumeration
      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.',
      });
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store token in Supabase
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        // Delete any existing tokens for this user
        await supabase
          .from('password_reset_tokens')
          .delete()
          .eq('user_id', user.id);

        // Insert new token
        const { error } = await supabase
          .from('password_reset_tokens')
          .insert({
            user_id: user.id,
            token: resetToken,
            expires_at: expiresAt.toISOString(),
          });

        if (error) {
          console.error('Error storing reset token:', error);
          // Continue anyway - we can still try to send the email
        }
      } catch (error) {
        console.error('Database error storing token:', error);
      }
    }

    // Send password reset email
    const emailSent = await sendPasswordResetEmail(
      user.email,
      resetToken,
      user.first_name
    );

    if (!emailSent) {
      console.error('Failed to send password reset email to:', user.email);
      // Still return success for security
    }

    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
