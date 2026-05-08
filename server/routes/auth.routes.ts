/**
 * Admin authentication routes.
 * Handles credential check, OTP 2FA, magic-link, and Replit OIDC auth.
 */
import { Router } from "express";
import { checkCredentials, isAdminPassword } from "../middlewares/auth";
import { issueAdminOtp, verifyAdminOtp, issueAdminMagicLink, verifyMagicLink } from "../services/auth.service";

export const authRouter = Router();

// ─── Credential check (step 1 of admin login) ───────────────────────────────
authRouter.post("/api/auth/check", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    let username = "";
    let password = "";
    if (authHeader.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.split(" ")[1], "base64").toString();
      const i = decoded.indexOf(":");
      if (i !== -1) { username = decoded.slice(0, i); password = decoded.slice(i + 1); }
    }

    // Already-authenticated session token
    if (username === "__session__") {
      const { storage } = await import("../storage");
      const session = await storage.findValidSession(password);
      if (session) return res.json({ role: "admin" });
      return res.status(401).json({ message: "Session expired" });
    }

    // Admin password → trigger 2FA
    if (await isAdminPassword(username, password)) {
      try {
        const { maskedEmail } = await issueAdminOtp();
        return res.json({ otpRequired: true, email: maskedEmail });
      } catch (err: any) {
        console.error("OTP send failed:", err);
        return res.status(500).json({ message: "Could not send verification code. " + (err.message || "") });
      }
    }

    // Staff: single-step basic auth
    const auth = await checkCredentials(req);
    if (auth.valid && !auth.isAdmin) return res.json({ role: (auth as any).role });

    return res.status(401).json({ message: "Invalid credentials" });
  } catch (err: any) {
    console.error("/api/auth/check error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Step 2: verify OTP, mint session ────────────────────────────────────────
authRouter.post("/api/auth/admin/otp/verify", async (req, res) => {
  try {
    const { username, password, code } = req.body || {};
    if (!username || !password || !code) {
      return res.status(400).json({ message: "Username, password and code are required." });
    }
    if (!(await isAdminPassword(String(username), String(password)))) {
      return res.status(401).json({ message: "Invalid username or password." });
    }
    const sessionAuth = await verifyAdminOtp(String(code));
    if (!sessionAuth) return res.status(401).json({ message: "Invalid or expired verification code." });
    return res.json({ role: "admin", sessionAuth });
  } catch (err: any) {
    console.error("/api/auth/admin/otp/verify error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Resend OTP ────────────────────────────────────────────────────────────
authRouter.post("/api/auth/admin/otp/resend", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password || !(await isAdminPassword(String(username), String(password)))) {
      return res.status(401).json({ message: "Invalid username or password." });
    }
    const { maskedEmail } = await issueAdminOtp();
    res.json({ ok: true, email: maskedEmail });
  } catch (err: any) {
    console.error("OTP resend failed:", err);
    res.status(500).json({ message: err.message || "Resend failed" });
  }
});

// ─── Forgot password → email magic link ───────────────────────────────────
authRouter.post("/api/auth/admin/forgot", async (_req, res) => {
  await issueAdminMagicLink(); // errors logged internally, never surfaced
  res.json({ ok: true, message: "If an admin account exists, a sign-in link has been sent to its email." });
});

// ─── Exchange magic token for session ─────────────────────────────────────
authRouter.post("/api/auth/admin/magic/verify", async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: "Token is required." });
    const sessionAuth = await verifyMagicLink(String(token));
    if (!sessionAuth) return res.status(401).json({ message: "This sign-in link is invalid or has expired." });
    res.json({ role: "admin", sessionAuth });
  } catch (err: any) {
    console.error("/api/auth/admin/magic/verify error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Legacy deprecated endpoint ────────────────────────────────────────────
authRouter.post("/api/admin/forgot-password", (_req, res) => {
  res.status(410).json({ message: "This recovery method has been replaced. Please use the new 'Forgot password?' link on the login screen." });
});
