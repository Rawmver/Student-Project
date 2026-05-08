/**
 * Multi-provider email router.
 *
 * The admin selects the active provider via the `EMAIL_PROVIDER` credential
 * in the admin panel. Currently supported: "resend" (default), "sendgrid",
 * "mailgun" — all HTTP-based, no SDK required so package.json stays clean.
 *
 * All public functions (sendOtpEmail, sendMagicLinkEmail, sendStudentVerificationEmail)
 * delegate to `sendEmail()`, which dispatches based on the active provider.
 * Switching providers in the panel takes effect on the next call.
 */
import { getCred } from "./lib/credentials";

type Provider = "resend" | "sendgrid" | "mailgun";

function activeProvider(): Provider {
  const v = (getCred("EMAIL_PROVIDER") || "resend").toLowerCase();
  if (v === "sendgrid" || v === "mailgun") return v;
  return "resend";
}

function defaultFrom(): string {
  return getCred("EMAIL_FROM") || "Student Group Portal <onboarding@resend.dev>";
}

async function sendViaResend(to: string, subject: string, html: string) {
  const apiKey = getCred("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const from = getCred("RESEND_FROM") || defaultFrom();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json().catch(() => ({}));
}

async function sendViaSendgrid(to: string, subject: string, html: string) {
  const apiKey = getCred("SENDGRID_API_KEY");
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured.");
  const from = getCred("EMAIL_FROM");
  if (!from) throw new Error("EMAIL_FROM must be set when using SendGrid.");
  // SendGrid expects a bare email address in the from.email field — strip any
  // "Name <email>" formatting if present.
  const fromEmail = from.match(/<([^>]+)>/)?.[1] || from;
  const fromName = from.match(/^([^<]+)</)?.[1].trim() || undefined;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
      content: [{ type: "text/html", value: html }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid send failed (${res.status}): ${await res.text().catch(() => "")}`);
  return { provider: "sendgrid", status: res.status };
}

async function sendViaMailgun(to: string, subject: string, html: string) {
  const apiKey = getCred("MAILGUN_API_KEY");
  const domain = getCred("MAILGUN_DOMAIN");
  if (!apiKey) throw new Error("MAILGUN_API_KEY is not configured.");
  if (!domain) throw new Error("MAILGUN_DOMAIN is not configured.");
  const from = getCred("EMAIL_FROM") || `Student Group Portal <postmaster@${domain}>`;
  const auth = Buffer.from(`api:${apiKey}`).toString("base64");
  const body = new URLSearchParams({ from, to, subject, html });
  const res = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Mailgun send failed (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json().catch(() => ({}));
}

/** Generic dispatcher used by all the templated email helpers below. */
export async function sendEmail(to: string, subject: string, html: string) {
  const provider = activeProvider();
  switch (provider) {
    case "sendgrid": return sendViaSendgrid(to, subject, html);
    case "mailgun":  return sendViaMailgun(to, subject, html);
    case "resend":
    default:         return sendViaResend(to, subject, html);
  }
}

/** Reports which provider would be used right now (for the test endpoint). */
export function getActiveEmailProvider(): Provider { return activeProvider(); }

export async function sendOtpEmail(to: string, code: string) {
  const subject = `Your admin login code: ${code}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#6d28d9;margin:0 0 8px">Admin login verification</h2>
      <p style="color:#444;line-height:1.5">Use the code below to finish signing in to the Student Group Portal admin dashboard.</p>
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:18px;text-align:center;margin:16px 0">
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#5b21b6;font-family:'Courier New',monospace">${code}</div>
      </div>
      <p style="color:#666;font-size:13px">This code expires in <b>10 minutes</b>. If you did not request it, you can safely ignore this email.</p>
    </div>`;
  return sendEmail(to, subject, html);
}

export async function sendStudentVerificationEmail(to: string, name: string, verifyUrl: string) {
  const firstName = name.split(" ")[0];
  const subject = "Verify your Student Portal account";
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px">
      <div style="background:linear-gradient(135deg,#6d28d9,#4f46e5);border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
        <span style="font-size:32px">🎓</span>
        <h2 style="color:#fff;margin:8px 0 0;font-size:20px">Student Portal</h2>
      </div>
      <h3 style="color:#1e1b4b;margin:0 0 8px">Hi ${firstName}, welcome! 👋</h3>
      <p style="color:#444;line-height:1.6">You're almost ready. Just click the button below to verify your email address and activate your account.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${verifyUrl}" style="background:linear-gradient(135deg,#6d28d9,#4f46e5);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">
          ✅ Verify My Account
        </a>
      </p>
      <p style="color:#666;font-size:13px;word-break:break-all">Or paste this URL:<br/><a href="${verifyUrl}" style="color:#6d28d9">${verifyUrl}</a></p>
      <p style="color:#666;font-size:13px;margin-top:18px">This link expires in <b>24 hours</b>. If you did not register, you can safely ignore this email.</p>
    </div>`;
  return sendEmail(to, subject, html);
}

export async function sendMagicLinkEmail(to: string, link: string) {
  const subject = "Reset access to your admin account";
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#6d28d9;margin:0 0 8px">Forgot your admin password?</h2>
      <p style="color:#444;line-height:1.5">Click the secure link below to log in to the Student Group Portal admin dashboard without a password. The link can only be used once.</p>
      <p style="text-align:center;margin:22px 0">
        <a href="${link}" style="background:#6d28d9;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Sign in to admin</a>
      </p>
      <p style="color:#666;font-size:13px;word-break:break-all">Or paste this URL into your browser:<br/><a href="${link}">${link}</a></p>
      <p style="color:#666;font-size:13px;margin-top:18px">This link expires in <b>15 minutes</b>. If you did not request it, you can safely ignore this email.</p>
    </div>`;
  return sendEmail(to, subject, html);
}
