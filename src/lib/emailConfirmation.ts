import { escapeHtml, type BuiltEmail } from "@/lib/email";

/**
 * The signup confirmation link and the email that carries it.
 *
 * THE LINK
 * The hashed token rides in the URL fragment, never the query:
 *   <app>/auth/callback#token_hash=<token>&type=signup
 * A fragment is not sent to the server, so it reaches neither the middleware
 * nor a request log, and it is not carried in the Referer of the requests the
 * callback page makes. A query would be in all three. The callback page reads
 * the fragment, verifies only after the user presses a button, and removes
 * the fragment whatever the result.
 *
 * THE EMAIL
 * buildSignupConfirmationEmail takes the link and nothing else, so no value
 * the signup request supplied (a name, say) can reach a mail sent from our
 * domain. The expiry is described without a duration: the token's lifetime
 * is Supabase configuration, not something this file knows.
 */

export function buildConfirmationLink(appUrl: string, hashedToken: string): string {
  if (typeof hashedToken !== "string" || hashedToken.length === 0) {
    throw new Error("buildConfirmationLink: hashed token is required");
  }
  const base = appUrl.replace(/\/+$/, "");
  return (
    base +
    "/auth/callback#token_hash=" +
    encodeURIComponent(hashedToken) +
    "&type=signup"
  );
}

export const CONFIRMATION_EMAIL_SUBJECT = "Confirm your email for NOOR";

export function buildSignupConfirmationEmail(link: string): BuiltEmail {
  const htmlLink = escapeHtml(link);
  const year = new Date().getFullYear();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #f0f0f0;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.3em; color: #000000;">NOOR</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600; color: #000000;">Confirm your email</h2>
              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.6; color: #666666;">
                Confirm this email address to finish creating your NOOR account.
              </p>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="${htmlLink}" style="display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; border-radius: 8px;">
                      Confirm email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 30px 0 0; font-size: 13px; line-height: 1.6; color: #999999;">
                This link expires after a while and works once. If it has expired, you can request a new one from the sign-in page.
              </p>
              <p style="margin: 20px 0 0; font-size: 13px; line-height: 1.6; color: #999999;">
                If you didn't create a NOOR account, you can ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #f0f0f0;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                &copy; ${year} NOOR. All rights reserved.
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
    "Confirm your email",
    "",
    "Confirm this email address to finish creating your NOOR account:",
    "",
    link,
    "",
    "This link expires after a while and works once. If it has expired, you can request a new one from the sign-in page.",
    "",
    "If you didn't create a NOOR account, you can ignore this email.",
    "",
    `© ${year} NOOR. All rights reserved.`,
  ].join("\n");

  return { subject: CONFIRMATION_EMAIL_SUBJECT, html, text };
}
