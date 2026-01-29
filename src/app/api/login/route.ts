import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { hashPassword, findUserByEmail, verifyPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await hashPassword(password);

    // Try Supabase first if configured
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        // Find user by email and password
        const { data: user, error } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, institution_id, university, country_of_origin')
          .eq('email', normalizedEmail)
          .eq('password_hash', passwordHash)
          .single();

        if (!error && user) {
          return NextResponse.json({
            success: true,
            userId: user.id,
            profile: {
              firstName: user.first_name,
              lastName: user.last_name,
              email: user.email,
              institutionId: user.institution_id,
              university: user.university,
              countryOfOrigin: user.country_of_origin,
            },
            message: 'Login successful',
          });
        }
      } catch (dbError) {
        console.error('Database error during login:', dbError);
        // Fall through to local store
      }
    }

    // Fallback: Check local store
    const localUser = findUserByEmail(normalizedEmail);

    if (localUser) {
      const passwordMatch = await verifyPassword(password, localUser.password_hash);

      if (passwordMatch) {
        return NextResponse.json({
          success: true,
          userId: localUser.id,
          profile: {
            firstName: localUser.first_name,
            lastName: localUser.last_name,
            email: localUser.email,
            institutionId: (localUser.profile as Record<string, unknown>).institution_id,
            university: (localUser.profile as Record<string, unknown>).university,
            countryOfOrigin: (localUser.profile as Record<string, unknown>).country_of_origin,
          },
          message: 'Login successful',
        });
      }
    }

    // No user found or password incorrect
    return NextResponse.json(
      { success: false, message: 'Invalid email or password' },
      { status: 401 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: 'Something went wrong' },
      { status: 500 }
    );
  }
}
