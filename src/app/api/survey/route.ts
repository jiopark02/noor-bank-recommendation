import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// Simple hash function for password (in production, use bcrypt)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'noor_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: NextRequest) {
  try {
    const surveyData = await request.json();
    const supabase = createServerClient();

    // Generate a new user ID
    const userId = uuidv4();

    // Hash the password
    const passwordHash = surveyData.password
      ? await hashPassword(surveyData.password)
      : await hashPassword('default_' + userId.slice(0, 8));

    // Map survey data to database schema
    const userData = {
      id: userId,
      first_name: surveyData.first_name || 'User',
      last_name: surveyData.last_name || '',
      email: surveyData.email || `user_${userId.slice(0, 8)}@noor.app`,
      password_hash: passwordHash,
      country_of_origin: surveyData.country_of_origin || null,
      visa_type: surveyData.visa_status,
      university: surveyData.university,
      has_ssn: surveyData.has_ssn,
      has_itin: surveyData.has_itin,
      has_us_address: surveyData.has_us_address ?? true,
      monthly_income: surveyData.monthly_income || 0,
      expected_monthly_spending: surveyData.monthly_budget * 0.8,
      international_transfer_frequency: surveyData.international_transfers,
      avg_transfer_amount: surveyData.avg_transfer_amount || 500,
      needs_zelle: surveyData.needs_zelle,
      prefers_online_banking: surveyData.digital_preference === 'mobile-first',
      needs_nearby_branch: surveyData.campus_proximity === 'very-important',
      campus_side: surveyData.campus_side || null,
      onboarding_completed: true,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('users')
      .insert(userData)
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      // For development: return a mock user ID even if DB fails
      return NextResponse.json({
        success: true,
        userId: userId,
        message: 'Survey completed (dev mode)',
      });
    }

    return NextResponse.json({
      success: true,
      userId: data.id,
      message: 'Survey completed successfully',
    });
  } catch (error) {
    console.error('Survey API error:', error);
    // For development: return a mock user ID even on error
    const mockUserId = uuidv4();
    return NextResponse.json({
      success: true,
      userId: mockUserId,
      message: 'Survey completed (dev mode)',
    });
  }
}
