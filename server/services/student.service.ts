/**
 * Student authentication service.
 * Handles registration, login, email verification, and session management.
 */
import { storage } from "../storage";
import { sendStudentVerificationEmail } from "../email";
import { hashPassword, verifyPassword, genUrlSafeToken, hashVerificationToken } from "../utils/crypto";
import { getTrustedBaseUrl } from "../utils/url";

/** Generate a new student session token (32 bytes URL-safe). */
export function genStudentToken(): string {
  return genUrlSafeToken(32);
}

export type RegisterResult =
  | { ok: true; email: string }
  | { ok: false; status: number; message: string };

/**
 * Register a new student account.
 * - Blocks if a verified account owns the student ID or email.
 * - Silently replaces any pending unverified registration with the same identifiers.
 * - Sends a verification email (non-blocking; continues even if email fails).
 */
export async function registerStudent(
  name: string,
  studentId: string,
  email: string,
  password: string,
  semester?: string,
): Promise<RegisterResult> {
  const sid = studentId.trim().toUpperCase();
  const em = email.trim().toLowerCase();
  const nm = name.trim();

  const [existingById, existingByEmail] = await Promise.all([
    storage.getStudentByStudentId(sid, true),
    storage.getStudentByEmail(em, true),
  ]);
  if (existingById) return { ok: false, status: 409, message: "This Student ID is already registered and verified. Please sign in." };
  if (existingByEmail) return { ok: false, status: 409, message: "This email address is already registered and verified. Please sign in." };

  await storage.deleteUnverifiedStudentsByIdentifiers(sid, em);

  const passwordHash = await hashPassword(password);
  const rawToken = genStudentToken();
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await storage.createStudentAccount(nm, sid, em, passwordHash, tokenHash, expiresAt, semester);

  const verifyUrl = `${getTrustedBaseUrl()}/student-verify?token=${encodeURIComponent(rawToken)}`;
  sendStudentVerificationEmail(em, nm, verifyUrl).catch(err =>
    console.error("Verification email send failed:", err)
  );

  return { ok: true, email: em };
}

export type VerifyResult =
  | { ok: true; token: string; account: { id: number; name: string; studentId: string; email: string; semester: string | null } }
  | { ok: false; status: number; message: string };

/** Verify the email token, activate the account, and issue a session. */
export async function verifyStudentEmail(rawToken: string): Promise<VerifyResult> {
  const tokenHash = hashVerificationToken(rawToken);
  const account = await storage.getStudentByVerificationToken(tokenHash);
  if (!account) return { ok: false, status: 400, message: "This verification link is invalid or has expired. Please register again." };

  await storage.verifyStudentAccount(account.id);
  const sessionToken = genStudentToken();
  await storage.createStudentSession(account.id, sessionToken);

  return {
    ok: true,
    token: sessionToken,
    account: { id: account.id, name: account.name, studentId: account.studentId, email: account.email, semester: account.semester ?? null },
  };
}

export type LoginResult =
  | { ok: true; token: string; account: { id: number; name: string; studentId: string; email: string; semester: string | null } }
  | { ok: false; status: number; message: string; code?: string };

/** Log a student in by student ID + password. */
export async function loginStudent(studentId: string, password: string): Promise<LoginResult> {
  const account = await storage.getStudentByStudentId(studentId.trim().toUpperCase());
  if (!account) return { ok: false, status: 401, message: "Invalid student ID or password" };

  const valid = await verifyPassword(password, account.passwordHash);
  if (!valid) return { ok: false, status: 401, message: "Invalid student ID or password" };

  if (!account.isVerified) {
    return { ok: false, status: 403, message: "Your email is not verified yet. Please check your inbox and click the verification link.", code: "UNVERIFIED" };
  }

  const rawToken = genStudentToken();
  await storage.createStudentSession(account.id, rawToken);
  return {
    ok: true,
    token: rawToken,
    account: { id: account.id, name: account.name, studentId: account.studentId, email: account.email, semester: account.semester ?? null },
  };
}
