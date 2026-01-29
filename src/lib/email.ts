import nodemailer from 'nodemailer';

// SMTP configuration using environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'hello@noor.financial',
    pass: process.env.SMTP_PASSWORD,
  },
});

const FROM_EMAIL = process.env.SMTP_FROM || 'hello@noor.financial';
const FROM_NAME = process.env.SMTP_FROM_NAME || 'NOOR';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://noor.financial';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail({ to, subject, html, text }: EmailOptions): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

// Password Reset Email
export async function sendPasswordResetEmail(email: string, resetToken: string, firstName?: string): Promise<boolean> {
  const resetLink = `${APP_URL}/forgot-password?token=${resetToken}`;
  const name = firstName || 'there';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
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
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600; color: #000000;">Reset your password</h2>
              <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #666666;">
                Hi ${name},
              </p>
              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.6; color: #666666;">
                We received a request to reset your password. Click the button below to create a new password.
              </p>

              <!-- Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 500; border-radius: 8px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 0; font-size: 13px; line-height: 1.6; color: #999999;">
                This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
              </p>

              <p style="margin: 20px 0 0; font-size: 13px; line-height: 1.6; color: #999999;">
                Or copy and paste this link in your browser:<br>
                <a href="${resetLink}" style="color: #666666; word-break: break-all;">${resetLink}</a>
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
    subject: 'Reset your NOOR password',
    html,
  });
}

// Welcome Email
export async function sendWelcomeEmail(email: string, firstName?: string): Promise<boolean> {
  const name = firstName || 'there';
  const dashboardLink = `${APP_URL}/dashboard`;

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
              <h2 style="margin: 0 0 20px; font-size: 20px; font-weight: 600; color: #000000;">Welcome to NOOR, ${name}!</h2>
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

  return sendEmail({
    to: email,
    subject: 'Welcome to NOOR!',
    html,
  });
}
