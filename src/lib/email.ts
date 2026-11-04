import { Resend } from "resend";
import { toLogSafeError } from "@/lib/logSafeError";
// emailConfirmation.ts imports escapeHtml from this file. The cycle is safe:
// each side only calls the other's function declarations, at call time.
import { buildSignupConfirmationEmail } from "@/lib/emailConfirmation";

let resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM_EMAIL = process.env.SMTP_FROM || "hello@noor.financial";
const FROM_NAME = process.env.SMTP_FROM_NAME || "NOOR";

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
export function escapeHtml(value: string): string {
  return value.replace(HTML_SPECIAL_PATTERN, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Signup confirmation email. It takes the recipient and the link only: the
 * builder has no parameter a name or any other request value could reach.
 * The link is built by buildConfirmationLink.
 */
export async function sendSignupConfirmationEmail(
  email: string,
  link: string
): Promise<boolean> {
  const { subject, html, text } = buildSignupConfirmationEmail(link);
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
