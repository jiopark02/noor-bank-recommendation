import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { password, token } = await request.json();

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Reset token is required' },
        { status: 400 }
      );
    }

    // Hash the new password
    const passwordHash = await hashPassword(password);

    // Verify token and get user
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        // Find the token and check if it's valid
        const { data: tokenData, error: tokenError } = await supabase
          .from('password_reset_tokens')
          .select('user_id, expires_at')
          .eq('token', token)
          .single();

        if (tokenError || !tokenData) {
          return NextResponse.json(
            { error: 'Invalid or expired reset link' },
            { status: 400 }
          );
        }

        // Check if token has expired
        const expiresAt = new Date(tokenData.expires_at);
        if (expiresAt < new Date()) {
          // Delete the expired token
          await supabase
            .from('password_reset_tokens')
            .delete()
            .eq('token', token);

          return NextResponse.json(
            { error: 'Reset link has expired. Please request a new one.' },
            { status: 400 }
          );
        }

        // Update the user's password
        const { error: updateError } = await supabase
          .from('users')
          .update({ password_hash: passwordHash })
          .eq('id', tokenData.user_id);

        if (updateError) {
          console.error('Password update error:', updateError);
          return NextResponse.json(
            { error: 'Failed to update password' },
            { status: 500 }
          );
        }

        // Delete the used token
        await supabase
          .from('password_reset_tokens')
          .delete()
          .eq('token', token);

        return NextResponse.json({
          success: true,
          message: 'Password updated successfully',
        });
      } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json(
          { error: 'Failed to reset password' },
          { status: 500 }
        );
      }
    }

    // If Supabase is not configured, return error
    return NextResponse.json(
      { error: 'Password reset is not available' },
      { status: 500 }
    );
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
