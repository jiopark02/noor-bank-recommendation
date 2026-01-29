import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, addUser, emailExists } from '@/lib/auth';
import { sendWelcomeEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const surveyData = await request.json();

    // Validate required fields
    if (!surveyData.email || !surveyData.password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required' },
        { status: 400 }
      );
    }

    const email = surveyData.email.toLowerCase().trim();

    // Generate a new user ID
    const userId = uuidv4();

    // Hash the password
    const passwordHash = await hashPassword(surveyData.password);

    // Map survey data to database schema
    const userData = {
      id: userId,
      first_name: surveyData.first_name || 'User',
      last_name: surveyData.last_name || '',
      email: email,
      password_hash: passwordHash,
      country_of_origin: surveyData.country_of_origin || null,
      visa_type: surveyData.visa_status,
      university: surveyData.university,
      institution_id: surveyData.institution_id,
      institution_type: surveyData.institution_type,
      has_ssn: surveyData.has_ssn,
      has_itin: surveyData.has_itin,
      has_us_address: surveyData.has_us_address ?? true,
      monthly_income: surveyData.monthly_income || 0,
      expected_monthly_spending: surveyData.monthly_budget ? surveyData.monthly_budget * 0.8 : 0,
      international_transfer_frequency: surveyData.international_transfers,
      avg_transfer_amount: surveyData.avg_transfer_amount || 500,
      needs_zelle: surveyData.needs_zelle,
      prefers_online_banking: surveyData.digital_preference === 'mobile-first',
      needs_nearby_branch: surveyData.campus_proximity === 'very-important',
      campus_side: surveyData.campus_side || null,
      onboarding_completed: true,
      created_at: new Date().toISOString(),
    };

    // Try Supabase first if configured
    if (isSupabaseConfigured()) {
      try {
        const supabase = createServerClient();

        // Check if email already exists
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .single();

        if (existingUser) {
          return NextResponse.json(
            { success: false, message: 'An account with this email already exists' },
            { status: 409 }
          );
        }

        const { data, error } = await supabase
          .from('users')
          .insert(userData)
          .select()
          .single();

        if (error) {
          console.error('Supabase insert error:', error);
          // Fall through to local store
        } else {
          // Also save to local store as backup
          addUser({
            id: data.id,
            email: email,
            password_hash: passwordHash,
            first_name: userData.first_name,
            last_name: userData.last_name,
            profile: userData,
          });

          // Send welcome email (don't await - send in background)
          sendWelcomeEmail(email, userData.first_name).catch(err => {
            console.error('Failed to send welcome email:', err);
          });

          return NextResponse.json({
            success: true,
            userId: data.id,
            profile: {
              firstName: userData.first_name,
              lastName: userData.last_name,
              email: email,
              institutionId: userData.institution_id,
              university: userData.university,
              countryOfOrigin: userData.country_of_origin,
            },
            message: 'Account created successfully',
          });
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        // Fall through to local store
      }
    }

    // Fallback: Use local store for development
    // Check if email already exists in local store
    if (emailExists(email)) {
      return NextResponse.json(
        { success: false, message: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Save to local store
    addUser({
      id: userId,
      email: email,
      password_hash: passwordHash,
      first_name: userData.first_name,
      last_name: userData.last_name,
      profile: userData,
    });

    console.log('User saved to local store:', email);

    // Send welcome email (don't await - send in background)
    sendWelcomeEmail(email, userData.first_name).catch(err => {
      console.error('Failed to send welcome email:', err);
    });

    return NextResponse.json({
      success: true,
      userId: userId,
      profile: {
        firstName: userData.first_name,
        lastName: userData.last_name,
        email: email,
        institutionId: userData.institution_id,
        university: userData.university,
        countryOfOrigin: userData.country_of_origin,
      },
      message: 'Account created successfully',
    });
  } catch (error) {
    console.error('Survey API error:', error);
    return NextResponse.json(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
