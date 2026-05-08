/**
 * Admin authentication service.
 * Owns the OTP, magic-link, and session-token lifecycle.
 */
import { storage } from "../storage";
import { sendOtpEmail, sendMagicLinkEmail } from "../email";
import { gen6DigitOtp, genUrlSafeToken } from "../utils/crypto";
import { getTrustedBaseUrl } from "../utils/url";

export const ADMIN_EMAIL_DEFAULT = "msy37994@gmail.com";

export async function getAdminEmail(): Promise<string> {
  return (await storage.getSetting("admin_email")) || ADMIN_EMAIL_DEFAULT;
}

/**
 * Issue a 6-digit OTP, persist its hash, and email it to the admin.
 * Returns the masked email address for the client to display.
 */
export async function issueAdminOtp(): Promise<{ maskedEmail: string }> {
  const code = gen6DigitOtp();
  await storage.createAuthCode(code, "otp", 10 * 60); // 10 min TTL
  const email = await getAdminEmail();
  await sendOtpEmail(email, code);
  const maskedEmail = email.replace(/(^.).+(@.+$)/, "$1****$2");
  return { maskedEmail };
}

/**
 * Verify the submitted OTP. Returns a session-auth Basic-auth string on
 * success, or null if the code is wrong / expired.
 */
export async function verifyAdminOtp(code: string): Promise<string | null> {
  const otp = await storage.redeemAuthCode(code.trim(), "otp");
  if (!otp) return null;
  return mintAdminSession();
}

/**
 * Issue a magic-link sign-in email. Always succeeds silently so callers
 * cannot enumerate whether an admin account exists.
 */
export async function issueAdminMagicLink(): Promise<void> {
  try {
    const token = genUrlSafeToken(24);
    await storage.createAuthCode(token, "magic", 15 * 60); // 15 min TTL
    const email = await getAdminEmail();
    const link = `${getTrustedBaseUrl()}/admin?magic=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail(email, link);
  } catch (err) {
    console.error("Magic-link issue failed:", err);
  }
}

/**
 * Exchange a magic-link token for a session. Returns session-auth string on
 * success, null if invalid/expired.
 */
export async function verifyMagicLink(token: string): Promise<string | null> {
  const row = await storage.redeemAuthCode(token, "magic");
  if (!row) return null;
  return mintAdminSession();
}

/**
 * Create a 7-day admin session token.
 * Returns the Base64 string the client stores in localStorage as admin_auth.
 */
export async function mintAdminSession(): Promise<string> {
  storage.cleanupExpiredAuthCodes().catch(() => {});
  const token = genUrlSafeToken(24);
  await storage.createAuthCode(token, "session", 7 * 24 * 60 * 60);
  return Buffer.from(`__session__:${token}`).toString("base64");
}
