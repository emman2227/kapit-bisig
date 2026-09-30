/**
 * Mailer Utility — Nodemailer transporter
 *
 * Reads SMTP settings exclusively from environment variables.
 * NEVER log SMTP_PASS or the OTP value.
 *
 * Usage:
 *   import { sendResetOtpEmail } from '../utils/mailer';
 *   await sendResetOtpEmail('user@example.com', '123456');
 */

import nodemailer, { Transporter } from 'nodemailer';

/* ------------------------------------------------------------------ */
/*  Lazy-initialised transporter                                       */
/* ------------------------------------------------------------------ */

let _transporter: Transporter | null = null;
let _resetOtpSenderForTests: ((to: string, otp: string) => Promise<void>) | null = null;

export function setResetOtpSenderForTests(sender: ((to: string, otp: string) => Promise<void>) | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test mailer override is only available in test mode.');
  _resetOtpSenderForTests = sender;
}

export function isMailerConfigured(): boolean {
  if (process.env.BREVO_API_KEY?.trim()) return true;
  return Boolean(
    process.env.SMTP_HOST?.trim()
    && process.env.SMTP_USER?.trim()
    && process.env.SMTP_PASS?.trim(),
  );
}

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false'; // default true
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP configuration incomplete. Set BREVO_API_KEY or SMTP_HOST, SMTP_USER, and SMTP_PASS in your environment.',
    );
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return _transporter;
}

/* ------------------------------------------------------------------ */
/*  App-level names / settings                                         */
/* ------------------------------------------------------------------ */

const APP_NAME = process.env.APP_NAME || 'KapitBisig';

function getFromAddress(): string {
  const senderEmail = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || '';
  return `"${APP_NAME}" <${senderEmail}>`;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmail({ to, subject, html, text }: SendEmailOptions): Promise<void> {
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();

  // 1. HTTPS API (bypasses cloud outbound SMTP port 587/465 blocks, e.g. Render Free Tier)
  if (brevoApiKey) {
    const senderEmail = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'kapitbisig2026@gmail.com';
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: APP_NAME, email: senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Brevo API error (${res.status}): ${errBody || res.statusText}`);
    }
    return;
  }

  // 2. Standard Nodemailer SMTP
  const transporter = getTransporter();
  const from = getFromAddress();
  await transporter.sendMail({ from, to, subject, html, text });
}

/* ------------------------------------------------------------------ */
/*  Send password-reset OTP email                                      */
/* ------------------------------------------------------------------ */

/**
 * Send a password-reset OTP to the given email address.
 * The OTP is included in the email body; it is NOT logged.
 */
export async function sendResetOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  if (_resetOtpSenderForTests) return _resetOtpSenderForTests(to, otp);

  const subject = `${APP_NAME} Password Reset OTP`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #0F533A; margin-bottom: 8px;">${APP_NAME}</h2>
      <p style="color: #374151; font-size: 14px;">You requested a password reset. Use the OTP below to verify your identity:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0F533A; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; border: 2px dashed #0F533A;">
          ${otp}
        </span>
      </div>

      <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  `;

  const text = [
    `${APP_NAME} — Password Reset OTP`,
    '',
    `Your OTP code: ${otp}`,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}

/* ------------------------------------------------------------------ */
/*  Send login-verification OTP email                                  */
/* ------------------------------------------------------------------ */

/**
 * Send a login-verification OTP to the given email address.
 * The OTP is included in the email body; it is NOT logged.
 */
export async function sendLoginVerifyOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const subject = `${APP_NAME} Login Verification Code`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #0F533A; margin-bottom: 8px;">${APP_NAME}</h2>
      <p style="color: #374151; font-size: 14px;">A login attempt was made with your account. Enter the code below to verify your identity:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0F533A; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; border: 2px dashed #0F533A;">
          ${otp}
        </span>
      </div>

      <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not attempt to log in, please secure your account immediately.</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  `;

  const text = [
    `${APP_NAME} — Login Verification Code`,
    '',
    `Your verification code: ${otp}`,
    '',
    'This code expires in 10 minutes.',
    'If you did not attempt to log in, please secure your account immediately.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}

/* ------------------------------------------------------------------ */
/*  Send password-change verification OTP email                        */
/* ------------------------------------------------------------------ */

/**
 * Send a password-change verification OTP to the given email address.
 * The OTP is included in the email body; it is NOT logged.
 */
export async function sendPasswordChangeOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  const subject = `${APP_NAME} Password Change Verification Code`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #0F533A; margin-bottom: 8px;">${APP_NAME}</h2>
      <p style="color: #374151; font-size: 14px;">You requested to change your account password. Use the code below to confirm this action:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0F533A; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; border: 2px dashed #0F533A;">
          ${otp}
        </span>
      </div>

      <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not request a password change, please secure your account immediately.</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  `;

  const text = [
    `${APP_NAME} — Password Change Verification Code`,
    '',
    `Your verification code: ${otp}`,
    '',
    'This code expires in 10 minutes.',
    'If you did not request a password change, please secure your account immediately.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}
/* ------------------------------------------------------------------ */

/**
 * Send a first-login OTP to newly created staff users.
 * The OTP is included in the email body; it is NOT logged.
 */
export async function sendFirstLoginOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  const subject = `${APP_NAME} First Login OTP`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #0F533A; margin-bottom: 8px;">${APP_NAME}</h2>
      <p style="color: #374151; font-size: 14px;">Your staff account has been created. Use this one-time code to sign in and set your password:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0F533A; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; border: 2px dashed #0F533A;">
          ${otp}
        </span>
      </div>

      <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
      <p style="color: #6b7280; font-size: 13px;">If you were not expecting this email, contact your administrator.</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  `;

  const text = [
    `${APP_NAME} - First Login OTP`,
    '',
    `Your one-time code: ${otp}`,
    '',
    'This code expires in 10 minutes and can only be used once.',
    'If you were not expecting this email, contact your administrator.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}

/* ------------------------------------------------------------------ */
/*  Send profile-update OTP email                                      */
/* ------------------------------------------------------------------ */

/**
 * Send a profile update verification OTP to the given email address.
 * The OTP is included in the email body; it is NOT logged.
 */
export async function sendProfileUpdateOtpEmail(
  to: string,
  otp: string,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const subject = `${APP_NAME} Profile Verification Code`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #0F533A; margin-bottom: 8px;">${APP_NAME}</h2>
      <p style="color: #374151; font-size: 14px;">You requested to update your email address. Enter the verification code below to verify your email:</p>

      <div style="text-align: center; margin: 24px 0;">
        <span style="display: inline-block; font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #0F533A; background: #f0fdf4; padding: 16px 32px; border-radius: 8px; border: 2px dashed #0F533A;">
          ${otp}
        </span>
      </div>

      <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>.</p>
      <p style="color: #6b7280; font-size: 13px;">If you did not request this change, please check your account immediately.</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
    </div>
  `;

  const text = [
    `${APP_NAME} — Profile Verification Code`,
    '',
    `Your verification code: ${otp}`,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this change, please check your account immediately.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}

