import crypto from "crypto";

/** Generate a zero-padded 6-digit OTP (numeric). */
export function gen6DigitOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Generate a URL-safe random token. Default 32 bytes = 256 bits entropy. */
export function genUrlSafeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest — used for persisting OTPs, magic tokens, session tokens. */
export function sha256(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Hash a student verification or session token before storage. */
export function hashVerificationToken(raw: string): string {
  return sha256(raw);
}

/** Hash a plain-text password using scrypt (format: `scrypt:salt:hash`). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

/** Constant-time comparison of a plain-text password against a stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, storedHash] = parts;
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
  return crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), hash);
}
