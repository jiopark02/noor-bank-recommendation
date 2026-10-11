import { Resend } from "resend";
import { toLogSafeError } from "@/lib/logSafeError";
import { sanitizeNameField } from "@/lib/validation";

let resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM_EMAIL = process.env.SMTP_FROM || "hello@noor.financial";
const FROM_NAME = process.env.SMTP_FROM_NAME || "NOOR";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://noor.financial";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: EmailOptions): Promise<boolean> {
  let client: Resend | null;
  try {
    client = getResendClient();
  } catch (error) {
    // Construction failure. The error's message can carry the API key verbatim
    // (Headers rejects an invalid Authorization value by quoting it), so only a
    // fixed phrase and the error name are logged — never the message. A failed
    // construction is not cached, so the next call tries again.
    console.error(
      `Failed to send email: mail client construction failed name=${
        toLogSafeError(error).name ?? "none"
      }`
    );
    return false;
  }
  if (!client) {
    console.error("Failed to send email: RESEND_API_KEY is not configured");
    return false;
  }

  try {
    const { error } = await client.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ""),
    });
    if (error) throw error;
    console.log("Email sent successfully");
    return true;
  } catch (error) {
    console.error("Failed to send email:", toLogSafeError(error));
    return false;
  }
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * The five characters that can change the meaning of HTML text or of a quoted
 * attribute. The quotes are written as escapes: serverLogEmailProbe.test.ts
 * reads this file with a masker that does not understand regex literals, and a
 * literal quote inside one would confuse it.
 */
const HTML_SPECIAL_PATTERN = /[&<>\u0022\u0027]/g;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Encodes a value for an HTML text node or a quoted attribute. */
function escapeHtml(value: string): string {
  return value.replace(HTML_SPECIAL_PATTERN, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Bidi embeddings and overrides (U+202A-U+202E) and isolates (U+2066-U+2069).
 * One of these in a name can reverse how the rest of the greeting line is
 * displayed. ZWJ and ZWNJ are left alone: they belong in emoji sequences and in
 * Persian names. Escapes only — no invisible character may appear literally.
 */
const BIDI_CONTROL_PATTERN = /[\u202A-\u202E\u2066-\u2069]/g;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * The welcome greeting's name as plain text, before any HTML encoding.
 * sanitizeNameField replaces control characters (CR and LF included), collapses
 * whitespace and caps the length; it does so here at render time whatever the
 * caller already did, so the stored value is untouched. Its cap counts UTF-16
 * code units and can end on the high half of a surrogate pair, which is dropped.
 * Bidi controls are removed first, so the whitespace they separated is
 * collapsed with the rest. Empty means "use the default greeting".
 */
function welcomeName(firstName: string | undefined): string {
  let name = sanitizeNameField(
    typeof firstName === "string" ? firstName.replace(BIDI_CONTROL_PATTERN, "") : firstName
  );
  if (name.length > 0 && isHighSurrogate(name.charCodeAt(name.length - 1))) {
    name = name.slice(0, -1).trim();
  }
  return name;
}

/**
 * Subject, HTML and plain-text parts of the welcome email. The name goes into
 * the HTML only through escapeHtml, so markup in it is shown as text. The
 * plain-text part is written out rather than derived from the HTML, so it
 * carries the name as typed instead of its HTML entities.
 */
export function buildWelcomeEmail(firstName?: string): BuiltEmail {
  const name = welcomeName(firstName) || "there";
  const htmlName = escapeHtml(name);
  const dashboardLink = `${APP_URL}/dashboard`;
  const year = new Date().getFullYear();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to NOOR</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.3em; color: #000000;">NOOR</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600; color: #000000;">Welcome to NOOR, ${htmlName}!</h2>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
                We're excited to have you here. NOOR is designed to help international students navigate banking, housing, and financial life in their new country.
              </p>

              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.6; color: #666666;">
                Here's what you can do with NOOR:
              </p>

              <ul style="margin: 0 0 30px; padding-left: 20px; font-size: 15px; line-height: 1.8; color: #666666;">
                <li>Get personalized bank recommendations</li>
                <li>Find student housing near your campus</li>
                <li>Discover scholarships and financial aid</li>
                <li>Track your spending and set budgets</li>
                <li>Learn visa regulations and work rules</li>
              </ul>

              <!-- Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="${dashboardLink}" style="display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; border-radius: 8px;">
                      Go to Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0; font-size: 15px; line-height: 1.6; color: #666666;">
                If you have any questions, just reply to this email. We're here to help!
              </p>

              <p style="margin: 20px 0 0; font-size: 15px; line-height: 1.6; color: #666666;">
                Best,<br>
                The NOOR Team
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #f0f0f0;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                &copy; ${new Date().getFullYear()} NOOR. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = [
    `Welcome to NOOR, ${name}!`,
    "",
    "We're excited to have you here. NOOR is designed to help international students navigate banking, housing, and financial life in their new country.",
    "",
    "Here's what you can do with NOOR:",
    "",
    "- Get personalized bank recommendations",
    "- Find student housing near your campus",
    "- Discover scholarships and financial aid",
    "- Track your spending and set budgets",
    "- Learn visa regulations and work rules",
    "",
    `Go to Dashboard: ${dashboardLink}`,
    "",
    "If you have any questions, just reply to this email. We're here to help!",
    "",
    "Best,",
    "The NOOR Team",
    "",
    `\u00A9 ${year} NOOR. All rights reserved.`,
  ].join("\n");

  return { subject: "Welcome to NOOR!", html, text };
}

// Welcome Email
export async function sendWelcomeEmail(
  email: string,
  firstName?: string
): Promise<boolean> {
  const { subject, html, text } = buildWelcomeEmail(firstName);
  return sendEmail({ to: email, subject, html, text });
}

// Waitlist Confirmation Email. It takes no name: the waitlist route is
// unauthenticated, so anything it accepted would be written by whoever calls it
// into a mail sent from our domain. The greeting is always the default.
export async function sendWaitlistConfirmationEmail(
  email: string
): Promise<boolean> {
  const greeting = "Hi there";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're on the Noor waitlist</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.3em; color: #000000;">NOOR</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600; color: #000000;">You're on the list.</h2>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
                ${greeting},
              </p>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
                Thanks for signing up. We're rolling out access carefully so every new user gets the best experience possible.
              </p>
              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.6; color: #666666;">
                When it's your turn, we'll send an invite so you can start chatting with noor — your AI money coach. Set savings goals, get plain-language guidance on your spending, and earn rewards when you hit your targets. No lectures, no judgment.
              </p>
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #999999;">
                No spam — we'll only reach out when it matters.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #f0f0f0;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                &copy; ${new Date().getFullYear()} NOOR. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: "You're on the Noor waitlist",
    html,
  });
}
