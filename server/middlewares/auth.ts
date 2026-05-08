import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export type AuthResult =
  | { valid: false }
  | { valid: true; isAdmin: true }
  | { valid: true; isAdmin: false; role: string };

/**
 * Validates an incoming Basic-auth header against admin credentials,
 * admin session tokens, and staff accounts.
 */
export async function checkCredentials(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) return { valid: false };

  const decoded = Buffer.from(authHeader.split(" ")[1], "base64").toString();
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return { valid: false };

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  // Admin session token minted post-2FA / magic-link
  if (username === "__session__") {
    const session = await storage.findValidSession(password);
    return session ? { valid: true, isAdmin: true } : { valid: false };
  }

  // Admin username + password
  const storedUsername = (await storage.getSetting("admin_username")) || "MS";
  const storedPassword = (await storage.getSetting("admin_password")) || "game@420";
  if (username === storedUsername && password === storedPassword) {
    return { valid: true, isAdmin: true };
  }

  // Staff accounts (stored as JSON in settings)
  const staffJson = await storage.getSetting("staff_accounts");
  if (staffJson) {
    try {
      const list: Array<{ username: string; password: string; role: string }> = JSON.parse(staffJson);
      const member = list.find(s => s.username === username && s.password === password);
      if (member) return { valid: true, isAdmin: false, role: member.role };
    } catch {}
  }

  return { valid: false };
}

/**
 * Validates the admin password only (username + password match required).
 * Used during the OTP verify step.
 */
export async function isAdminPassword(username: string, password: string): Promise<boolean> {
  const storedUsername = (await storage.getSetting("admin_username")) || "MS";
  const storedPassword = (await storage.getSetting("admin_password")) || "game@420";
  return username === storedUsername && password === storedPassword;
}

/** Express middleware — passes only admin-authenticated requests. */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await checkCredentials(req);
    if (auth.valid && auth.isAdmin) return next();

    // Fallback: Replit Auth
    if ((req as any).user) {
      const user = await storage.getUserById((req as any).user.id);
      if (user?.role === "admin") return next();
    }

    return res.status(auth.valid ? 403 : 401).json({
      message: auth.valid ? "Admin access required" : "Unauthorized",
    });
  } catch (err) {
    console.error("requireAdmin error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Express middleware factory — passes admin or staff with one of the listed roles.
 * Example: requireRole("editor", "downloader")
 */
export function requireRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = await checkCredentials(req);
      if (!auth.valid) return res.status(401).json({ message: "Unauthorized" });
      if (auth.isAdmin) return next();
      if (!auth.isAdmin && allowedRoles.includes((auth as any).role)) return next();

      // Fallback: Replit Auth
      if ((req as any).user) {
        const user = await storage.getUserById((req as any).user.id);
        if (user?.role === "admin") return next();
      }

      return res.status(403).json({ message: "Insufficient permissions" });
    } catch (err) {
      console.error("requireRole error:", err);
      res.status(500).json({ message: "Server error" });
    }
  };
}

/** Middleware — rejects if the student login feature is disabled. */
export async function requireStudentLoginEnabled(req: Request, res: Response, next: NextFunction) {
  const enabled = await storage.getSetting("student_login_enabled");
  if (enabled !== "true") return res.status(403).json({ message: "Student accounts are not enabled" });
  next();
}
