import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { sendWaitlistConfirmationEmail } from '@/lib/email';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { email?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const rawEmail = body.email?.trim();
  const rawName = body.name?.trim() || null;

  if (!rawEmail) {
    return NextResponse.json({ message: 'Email is required' }, { status: 400 });
  }

  const email = rawEmail.toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ message: 'Please enter a valid email address' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const emailSent = await sendWaitlistConfirmationEmail(email, rawName ?? undefined);

  if (!emailSent) {
    return NextResponse.json({ message: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  const { error } = await supabase.from('waitlist_signups').insert({
    email,
    name: rawName,
    source: 'waitlist_page',
    ip_address: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
    user_agent: request.headers.get('user-agent') ?? null,
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ message: 'already_registered' }, { status: 409 });
    }
    console.error('Waitlist insert error:', error);
    return NextResponse.json({ message: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
