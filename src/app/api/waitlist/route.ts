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

  // Persist the lead first. A saved row is the primary outcome; the confirmation
  // email is best-effort. If email were sent first (as it used to be), a mail
  // failure would 500 before the insert and the lead would be lost with no
  // record of who signed up.
  const { error } = await supabase.from('waitlist_signups').insert({
    email,
    name: rawName,
    source: 'waitlist_page',
  });

  if (error) {
    // Duplicate email (UNIQUE violation). Return 409 and do NOT send a
    // confirmation email — the address is already registered.
    if (error.code === '23505') {
      return NextResponse.json({ message: 'already_registered' }, { status: 409 });
    }
    console.error('Waitlist insert error:', error);
    return NextResponse.json({ message: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  // Lead is saved. Send the confirmation email best-effort: we MUST await it
  // (Vercel freezes the function once the response returns, so an un-awaited
  // send never fires), but a send failure must not fail the request. The user
  // gets 200 either way because the lead really was persisted.
  // sendWaitlistConfirmationEmail can signal failure by returning false rather
  // than throwing, so we check both the thrown case and the return value.
  try {
    const emailSent = await sendWaitlistConfirmationEmail(email, rawName ?? undefined);
    if (!emailSent) {
      console.error('Waitlist confirmation email failed to send (returned false) for:', email);
    }
  } catch (emailError) {
    console.error('Waitlist confirmation email threw for:', email, emailError);
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
