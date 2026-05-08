import { Express } from "express";
import { Server } from "http";
import { setupAuth } from "./replit_integrations/auth";
import { z } from "zod";
import ExcelJS from "exceljs";
import multer from "multer";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import { storage } from "./storage";
import { createGroupRequestSchema } from "@shared/schema";
import { sendOtpEmail, sendMagicLinkEmail, sendStudentVerificationEmail } from "./email";
import crypto from "crypto";
import OpenAI from "openai";

// =============================
// 2FA / MAGIC-LINK HELPERS
// =============================
const ADMIN_EMAIL_DEFAULT = "msy37994@gmail.com";

async function getAdminEmail(): Promise<string> {
  return (await storage.getSetting("admin_email")) || ADMIN_EMAIL_DEFAULT;
}

function gen6DigitOtp(): string {
  // 6-digit zero-padded numeric code
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function genUrlSafeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

// Build the URL used inside emailed magic links. We DO NOT trust
// X-Forwarded-Host / Host headers here, because an attacker could trigger the
// forgot-password flow with a forged Host header and receive a magic-link
// email pointing at their own domain (token exfiltration).
//
// Resolution order:
//   1) APP_BASE_URL  (explicit override, e.g. https://my-app.example.com)
//   2) https://${REPLIT_DEPLOYMENT_DOMAIN}        — set on published deployments
//   3) https://${REPLIT_DOMAINS.split(",")[0]}    — set in Replit dev/preview
//   4) http://localhost:5000                       — local fallback
function getTrustedBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  if (process.env.REPLIT_DEPLOYMENT_DOMAIN) return `https://${process.env.REPLIT_DEPLOYMENT_DOMAIN}`;
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return "http://localhost:5000";
}

// =============================
// MULTER CONFIG (dynamic per request)
// =============================
const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIMES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

function sanitizeFolder(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "project";
}

async function buildUploader(): Promise<multer.Multer> {
  const sizeStr = await storage.getSetting("file_submission_max_size_mb");
  const sizeMb = Math.max(1, Math.min(100, parseInt(sizeStr || "5") || 5));
  const activeIdStr = await storage.getSetting("active_project_id");
  let destDir = uploadsDir;
  if (activeIdStr) {
    const proj = await storage.getProjectById(parseInt(activeIdStr));
    if (proj) {
      destDir = path.join(uploadsDir, proj.folderName);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    }
  }
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => {
        const safe = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, safe);
      },
    }),
    limits: { fileSize: sizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Only PDF and PowerPoint files are allowed.") as any, false);
    },
  });
}

// Legacy single-file uploader fallback (for any other endpoints)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const safe = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF and PowerPoint files are allowed.") as any, false);
  },
});

// =============================
// ADMIN UPLOADER — NO RESTRICTIONS (any size, any type)
// Destination is chosen by ?projectId= or active project, falling back to uploads/.
// =============================
async function buildAdminUploader(projectIdOverride?: number): Promise<multer.Multer> {
  let destDir = uploadsDir;
  let chosenProjectId: number | null = null;
  if (projectIdOverride && !isNaN(projectIdOverride)) {
    chosenProjectId = projectIdOverride;
  } else {
    const activeIdStr = await storage.getSetting("active_project_id");
    if (activeIdStr) chosenProjectId = parseInt(activeIdStr);
  }
  if (chosenProjectId) {
    const proj = await storage.getProjectById(chosenProjectId);
    if (proj) {
      destDir = path.join(uploadsDir, proj.folderName);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    }
  }
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => {
        const safe = Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, safe);
      },
    }),
    // No size limit, no fileFilter — admin can upload anything.
  });
}

// =============================
// AUTH HELPERS
// =============================

type AuthResult =
  | { valid: false }
  | { valid: true; isAdmin: true }
  | { valid: true; isAdmin: false; role: string };

async function checkCredentials(req: any): Promise<AuthResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) return { valid: false };

  const decoded = Buffer.from(authHeader.split(" ")[1], "base64").toString();
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return { valid: false };

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  // Special case: admin session token issued post-2FA / magic-link.
  // The client stores Basic("__session__:<token>") in `admin_auth`.
  if (username === "__session__") {
    const session = await storage.findValidSession(password);
    if (session) return { valid: true, isAdmin: true };
    return { valid: false };
  }

  // Check admin
  const storedUsername = (await storage.getSetting("admin_username")) || "MS";
  const storedPassword = (await storage.getSetting("admin_password")) || "game@420";
  if (username === storedUsername && password === storedPassword) {
    return { valid: true, isAdmin: true };
  }

  // Check staff
  const staffJson = await storage.getSetting("staff_accounts");
  if (staffJson) {
    try {
      const staffList: Array<{ username: string; password: string; role: string }> = JSON.parse(staffJson);
      const staffMember = staffList.find(s => s.username === username && s.password === password);
      if (staffMember) {
        return { valid: true, isAdmin: false, role: staffMember.role };
      }
    } catch {}
  }

  return { valid: false };
}

// Validate the admin password ONLY (used during the OTP-verify step where the
// client re-sends the credentials together with the OTP code).
async function isAdminPassword(username: string, password: string): Promise<boolean> {
  const storedUsername = (await storage.getSetting("admin_username")) || "MS";
  const storedPassword = (await storage.getSetting("admin_password")) || "game@420";
  return username === storedUsername && password === storedPassword;
}

// Mint a long-lived (7d) admin session token and return the basic-auth string
// the client should store in localStorage as `admin_auth`. The raw token is
// returned to the client and only its SHA-256 hash is persisted.
async function mintAdminSession(): Promise<string> {
  // Best-effort cleanup of expired rows.
  storage.cleanupExpiredAuthCodes().catch(() => {});
  const token = genUrlSafeToken(24);
  await storage.createAuthCode(token, "session", 7 * 24 * 60 * 60);
  return Buffer.from(`__session__:${token}`).toString("base64");
}

const requireAdmin = async (req: any, res: any, next: any) => {
  try {
    const auth = await checkCredentials(req);
    if (auth.valid && auth.isAdmin) return next();

    // Fallback: Replit Auth
    if (req.user) {
      const user = await storage.getUserById(req.user.id);
      if (user && user.role === "admin") return next();
    }

    return res.status(auth.valid ? 403 : 401).json({ message: auth.valid ? "Admin access required" : "Unauthorized" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

function requireRole(...allowedRoles: string[]) {
  return async (req: any, res: any, next: any) => {
    try {
      const auth = await checkCredentials(req);
      if (!auth.valid) return res.status(401).json({ message: "Unauthorized" });
      if (auth.isAdmin) return next();
      if (!auth.isAdmin && allowedRoles.includes(auth.role)) return next();

      // Fallback: Replit Auth
      if (req.user) {
        const user = await storage.getUserById(req.user.id);
        if (user && user.role === "admin") return next();
      }

      return res.status(403).json({ message: "Insufficient permissions" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  };
}

// =============================
// ROUTES
// =============================
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await setupAuth(app);

  // =============================
  // AUTH CHECK ENDPOINT
  // =============================
  app.post("/api/auth/check", async (req, res) => {
    try {
      const authHeader = req.headers.authorization || "";
      let username = "";
      let password = "";
      if (authHeader.startsWith("Basic ")) {
        const decoded = Buffer.from(authHeader.split(" ")[1], "base64").toString();
        const i = decoded.indexOf(":");
        if (i !== -1) { username = decoded.slice(0, i); password = decoded.slice(i + 1); }
      }

      // 1) Already-authenticated session token (re-validate on page reload)
      if (username === "__session__") {
        const session = await storage.findValidSession(password);
        if (session) return res.json({ role: "admin" });
        return res.status(401).json({ message: "Session expired" });
      }

      // 2) Admin password → trigger 2FA, do NOT grant access yet.
      if (await isAdminPassword(username, password)) {
        try {
          const code = gen6DigitOtp();
          await storage.createAuthCode(code, "otp", 10 * 60); // 10 min
          const email = await getAdminEmail();
          await sendOtpEmail(email, code);
          // Mask the email a little for the response.
          const masked = email.replace(/(^.).+(@.+$)/, "$1****$2");
          return res.json({ otpRequired: true, email: masked });
        } catch (err: any) {
          console.error("OTP send failed:", err);
          return res.status(500).json({ message: "Could not send verification code. " + (err.message || "") });
        }
      }

      // 3) Staff: legacy single-step basic auth (no 2FA).
      const auth = await checkCredentials(req);
      if (auth.valid && !auth.isAdmin) return res.json({ role: (auth as any).role });

      return res.status(401).json({ message: "Invalid credentials" });
    } catch (err: any) {
      console.error("/api/auth/check error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Step 2 of admin login: verify the emailed OTP, mint a session token.
  app.post("/api/auth/admin/otp/verify", async (req, res) => {
    try {
      const { username, password, code } = req.body || {};
      if (!username || !password || !code) {
        return res.status(400).json({ message: "Username, password and code are required." });
      }
      if (!(await isAdminPassword(String(username), String(password)))) {
        return res.status(401).json({ message: "Invalid username or password." });
      }
      // Atomic single-use redemption: only one concurrent request can succeed.
      const otp = await storage.redeemAuthCode(String(code).trim(), "otp");
      if (!otp) return res.status(401).json({ message: "Invalid or expired verification code." });
      const sessionAuth = await mintAdminSession();
      return res.json({ role: "admin", sessionAuth });
    } catch (err: any) {
      console.error("/api/auth/admin/otp/verify error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Resend the OTP for an in-progress admin login.
  app.post("/api/auth/admin/otp/resend", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password || !(await isAdminPassword(String(username), String(password)))) {
        return res.status(401).json({ message: "Invalid username or password." });
      }
      const code = gen6DigitOtp();
      await storage.createAuthCode(code, "otp", 10 * 60);
      const email = await getAdminEmail();
      await sendOtpEmail(email, code);
      const masked = email.replace(/(^.).+(@.+$)/, "$1****$2");
      res.json({ ok: true, email: masked });
    } catch (err: any) {
      console.error("OTP resend failed:", err);
      res.status(500).json({ message: err.message || "Resend failed" });
    }
  });

  // "Forgot password" → email a magic-link sign-in URL. Always returns 200 to
  // prevent enumeration / probing; internal errors are logged.
  app.post("/api/auth/admin/forgot", async (_req, res) => {
    try {
      const token = genUrlSafeToken(24);
      await storage.createAuthCode(token, "magic", 15 * 60); // 15 min
      const email = await getAdminEmail();
      // IMPORTANT: trusted base URL only — never request headers.
      const link = `${getTrustedBaseUrl()}/admin?magic=${encodeURIComponent(token)}`;
      try {
        await sendMagicLinkEmail(email, link);
      } catch (err: any) {
        console.error("Magic-link send failed:", err);
      }
    } catch (err: any) {
      console.error("/api/auth/admin/forgot error:", err);
    }
    // Generic, non-enumerating response.
    res.json({ ok: true, message: "If an admin account exists, a sign-in link has been sent to its email." });
  });

  // Exchange a magic-link token for an admin session (atomic, single-use).
  app.post("/api/auth/admin/magic/verify", async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token) return res.status(400).json({ message: "Token is required." });
      const row = await storage.redeemAuthCode(String(token), "magic");
      if (!row) return res.status(401).json({ message: "This sign-in link is invalid or has expired." });
      const sessionAuth = await mintAdminSession();
      res.json({ role: "admin", sessionAuth });
    } catch (err: any) {
      console.error("/api/auth/admin/magic/verify error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // =============================
  // CREATE GROUP
  // =============================
  app.post("/api/groups", async (req, res) => {
    try {
      const input = createGroupRequestSchema.parse(req.body);
      const requiredMembersStr = (await storage.getSetting("required_members")) || "6";
      const requiredMembers = parseInt(requiredMembersStr);
      const requireLeader = (await storage.getSetting("group_require_leader")) !== "false";
      const requireTopic = (await storage.getSetting("group_require_topic")) !== "false";

      const auth = await checkCredentials(req);
      const isAdmin = auth.valid && auth.isAdmin;
      // Admins AND editors are trusted staff that can target any project via
      // ?projectId= (or explicitly ?projectId=none for a no-project group).
      const isStaffOverride =
        isAdmin || (auth.valid && !auth.isAdmin && (auth as any).role === "editor");

      // Resolve target project. Students always submit into the active project.
      // Trusted staff can override via ?projectId= query.
      const projectIdParam = req.query.projectId != null ? String(req.query.projectId) : undefined;
      const queryProjectId = projectIdParam && projectIdParam !== "none" ? parseInt(projectIdParam) : undefined;
      const wantsNoProject = projectIdParam === "none";
      let targetProjectId: number | null = null;
      const activeIdStr = await storage.getSetting("active_project_id");
      const activeId = activeIdStr ? parseInt(activeIdStr) : NaN;

      if (isStaffOverride && wantsNoProject) {
        targetProjectId = null;
      } else if (isStaffOverride && queryProjectId && !isNaN(queryProjectId)) {
        const p = await storage.getProjectById(queryProjectId);
        if (!p) return res.status(404).json({ message: "Project not found" });
        targetProjectId = p.id;
      } else if (!isNaN(activeId)) {
        const p = await storage.getProjectById(activeId);
        if (!p) {
          // Active id points at a missing project — treat as no active project
          if (!isAdmin) return res.status(403).json({ message: "Group submissions are not currently accepted. Please ask the admin to start a project." });
          targetProjectId = null;
        } else {
          if (!isAdmin && p.status === "finalized") {
            return res.status(403).json({ message: "This project has been closed and is no longer accepting group submissions." });
          }
          targetProjectId = p.id;
        }
      } else {
        // No active project at all
        if (!isAdmin) return res.status(403).json({ message: "Group submissions are not currently accepted. Please ask the admin to start a project." });
        targetProjectId = null;
      }

      // If leader is not required, drop any submitted leader so it isn't stored
      if (!requireLeader) {
        input.leader = undefined;
      } else if (!input.leader || !input.leader.name?.trim() || !input.leader.studentId?.trim()) {
        return res.status(400).json({ message: "Group leader name and student ID are required." });
      }

      if (!isAdmin && input.members.length !== requiredMembers) {
        return res.status(400).json({ message: `Each group must have exactly ${requiredMembers} members.` });
      }

      // Deadline gating. Prefer the project's own deadline (set when the
      // admin starts the project cycle); fall back to the legacy global
      // `submission_deadline` setting for backward compatibility.
      if (!isAdmin) {
        let effectiveDeadline: Date | null = null;
        if (targetProjectId != null) {
          const proj = await storage.getProjectById(targetProjectId);
          if (proj?.deadline) effectiveDeadline = new Date(proj.deadline);
        }
        if (!effectiveDeadline) {
          const deadlineStr = await storage.getSetting("submission_deadline");
          if (deadlineStr) effectiveDeadline = new Date(deadlineStr);
        }
        if (effectiveDeadline && new Date() > effectiveDeadline) {
          return res.status(403).json({ message: "Submission deadline has passed." });
        }
      }

      // Strip topicId from all members when topic is not required
      if (!requireTopic) {
        if (input.leader) input.leader.topicId = null as any;
        input.members = input.members.map(m => ({ ...m, topicId: null as any }));
      } else {
        const topicsInGroup = [input.leader?.topicId, ...input.members.map(m => m.topicId)].filter(Boolean);
        if (!isAdmin && new Set(topicsInGroup).size !== topicsInGroup.length) {
          return res.status(400).json({ message: "Each member in the group must select a unique topic." });
        }
      }

      const allIds = [input.leader?.studentId, ...input.members.map(m => m.studentId)].filter((id): id is string => !!id);
      // Duplicate-ID rules apply equally to students and admins. Admins
      // creating groups via the dashboard "Create Group" dialog still need
      // to honor uniqueness; otherwise the dashboard's "unique within
      // project" guarantee silently breaks.
      if (new Set(allIds).size !== allIds.length) {
        return res.status(400).json({ message: "Duplicate student IDs found" });
      }
      for (const id of allIds) {
        const exists = await storage.checkDuplicateStudentId(id, targetProjectId);
        if (exists) {
          return res.status(409).json({ message: `Student ID ${id} is already registered in this project` });
        }
      }

      // Mint a per-group edit token so the student can re-edit their
      // submission until the deadline without needing to authenticate.
      // 32 hex chars = 128 bits of entropy.
      const editToken = crypto.randomBytes(16).toString("hex");
      const group = await storage.createGroup(input, targetProjectId, editToken);
      res.status(201).json({
        id: group.id,
        message: "Group submitted successfully",
        editToken,
        createdAt: group.createdAt,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // =============================
  // PUBLIC: STUDENT RE-EDIT GROUP (token-gated)
  // =============================
  // A student can update their own submitted group ONLY if:
  //   1. They present the editToken returned at submit time, AND
  //   2. The project's deadline (or fallback global deadline) hasn't passed.
  // GET fetches the current group payload (to pre-fill the form).
  app.get("/api/groups/:id/edit", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const token = String(req.query.token || "");
      if (isNaN(id) || !token) return res.status(400).json({ message: "Missing id or token" });
      const group = await storage.getGroupByIdAndToken(id, token);
      if (!group) return res.status(404).json({ message: "Group not found or token invalid" });
      const deadline = group.project?.deadline
        ? new Date(group.project.deadline)
        : (await storage.getSetting("submission_deadline").then(s => s ? new Date(s) : null));
      res.json({
        id: group.id,
        projectId: group.projectId,
        createdAt: group.createdAt,
        deadline: deadline ? deadline.toISOString() : null,
        canEdit: !deadline || new Date() <= deadline,
        members: group.members.map(m => ({
          name: m.name,
          studentId: m.studentId,
          role: m.role,
          topicId: m.topicId,
        })),
      });
    } catch (err) {
      console.error("Get editable group error:", err);
      res.status(500).json({ message: "Failed to load group" });
    }
  });

  app.put("/api/groups/:id/edit", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid group id" });
      const token = String(req.body?.editToken || "");
      if (!token) return res.status(401).json({ message: "Missing edit token" });

      const existing = await storage.getGroupByIdAndToken(id, token);
      if (!existing) return res.status(404).json({ message: "Group not found or token invalid" });

      // Deadline check (project-scoped first, then global setting).
      let effectiveDeadline: Date | null = null;
      if (existing.project?.deadline) effectiveDeadline = new Date(existing.project.deadline);
      if (!effectiveDeadline) {
        const deadlineStr = await storage.getSetting("submission_deadline");
        if (deadlineStr) effectiveDeadline = new Date(deadlineStr);
      }
      if (effectiveDeadline && new Date() > effectiveDeadline) {
        return res.status(403).json({ message: "Deadline has passed — group can no longer be edited." });
      }

      const input = createGroupRequestSchema.parse(req.body.payload ?? req.body);

      // Re-validate config against the same rules as create.
      const requireLeader = (await storage.getSetting("group_require_leader")) !== "false";
      const requireTopic = (await storage.getSetting("group_require_topic")) !== "false";
      const requiredMembersStr = (await storage.getSetting("required_members")) || "6";
      const requiredMembers = parseInt(requiredMembersStr);

      if (!requireLeader) {
        input.leader = undefined;
      } else if (!input.leader || !input.leader.name?.trim() || !input.leader.studentId?.trim()) {
        return res.status(400).json({ message: "Group leader name and student ID are required." });
      }
      if (input.members.length !== requiredMembers) {
        return res.status(400).json({ message: `Each group must have exactly ${requiredMembers} members.` });
      }
      if (!requireTopic) {
        if (input.leader) input.leader.topicId = null as any;
        input.members = input.members.map(m => ({ ...m, topicId: null as any }));
      } else {
        const topicsInGroup = [input.leader?.topicId, ...input.members.map(m => m.topicId)].filter(Boolean);
        if (new Set(topicsInGroup).size !== topicsInGroup.length) {
          return res.status(400).json({ message: "Each member in the group must select a unique topic." });
        }
      }

      const allIds = [input.leader?.studentId, ...input.members.map(m => m.studentId)].filter((id): id is string => !!id);
      if (new Set(allIds).size !== allIds.length) {
        return res.status(400).json({ message: "Duplicate student IDs found" });
      }

      // Cross-group dup check inside the same project, ignoring the existing
      // members on this very group (since we're about to replace them).
      const existingIds = new Set(existing.members.map(m => m.studentId));
      for (const sid of allIds) {
        if (existingIds.has(sid)) continue;
        const dup = await storage.checkDuplicateStudentId(sid, existing.projectId ?? null);
        if (dup) {
          return res.status(409).json({ message: `Student ID ${sid} is already registered in this project` });
        }
      }

      await storage.updateGroup(id, input);
      res.json({ message: "Group updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Edit group error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // =============================
  // UPDATE GROUP (admin or editor)
  // =============================
  app.put("/api/groups/:id", requireRole("editor"), async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid group id" });

      const input = createGroupRequestSchema.parse(req.body);
      const existingGroup = await storage.getGroupById(groupId);
      if (!existingGroup) return res.status(404).json({ message: "Group not found" });

      const auth = await checkCredentials(req);
      const isAdmin = auth.valid && auth.isAdmin;

      const topicsInGroup = [input.leader?.topicId, ...input.members.map(m => m.topicId)].filter(Boolean);
      if (!isAdmin && new Set(topicsInGroup).size !== topicsInGroup.length) {
        return res.status(400).json({ message: "Duplicate topics inside group" });
      }

      const allIds = [input.leader?.studentId, ...input.members.map(m => m.studentId)].filter((id): id is string => !!id);
      if (!isAdmin && new Set(allIds).size !== allIds.length) {
        return res.status(400).json({ message: "Duplicate student IDs inside group" });
      }

      if (!isAdmin) {
        const groupProjectId = (existingGroup as any).projectId ?? null;
        for (const id of allIds) {
          const exists = await storage.checkDuplicateStudentId(id, groupProjectId, groupId);
          if (exists) return res.status(409).json({ message: `Student ID ${id} already exists in this project` });
        }
      }

      await storage.updateGroup(groupId, input);
      res.json({ message: "Group updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // =============================
  // PUBLIC TOPICS
  // =============================
  app.get("/api/topics", async (_req, res) => {
    try {
      res.json(await storage.getTopics());
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch topics" });
    }
  });

  app.post("/api/admin/topics", requireAdmin, async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      const topic = await storage.createTopic(name, description);
      res.status(201).json(topic);
    } catch (err) {
      res.status(500).json({ message: "Failed to create topic" });
    }
  });

  app.put("/api/admin/topics/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description } = req.body;
      const topic = await storage.updateTopic(id, name, description);
      res.json(topic);
    } catch (err) {
      res.status(500).json({ message: "Failed to update topic" });
    }
  });

  app.delete("/api/admin/topics/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTopic(id);
      res.json({ message: "Topic deleted" });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete topic" });
    }
  });

  // =============================
  // PUBLIC: ACTIVE PROJECT
  // =============================
  // Used by the student form to know which project is open and gate submissions.
  app.get("/api/projects/active", async (_req, res) => {
    try {
      const idStr = await storage.getSetting("active_project_id");
      if (!idStr) return res.json(null);
      const project = await storage.getProjectById(parseInt(idStr));
      if (!project) return res.json(null);
      res.json({
        id: project.id,
        name: project.name,
        status: project.status,
        deadline: project.deadline ? project.deadline.toISOString() : null,
      });
    } catch {
      res.json(null);
    }
  });

  // =============================
  // PUBLIC SETTINGS
  // =============================
  app.get("/api/settings/:key", async (req, res) => {
    try {
      const value = await storage.getSetting(req.params.key);
      res.json({ value });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch setting" });
    }
  });

  // =============================
  // STUDENT AUTH
  // =============================

  // Password hashing with scrypt
  async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = await new Promise<Buffer>((resolve, reject) =>
      crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key))
    );
    return `scrypt:${salt}:${hash.toString("hex")}`;
  }

  async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const [, salt, storedHash] = parts;
    const hash = await new Promise<Buffer>((resolve, reject) =>
      crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key))
    );
    return crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), hash);
  }

  function genStudentToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  // Middleware to check student login is enabled
  async function requireStudentLoginEnabled(req: any, res: any, next: any) {
    const enabled = await storage.getSetting("student_login_enabled");
    if (enabled !== "true") return res.status(403).json({ message: "Student accounts are not enabled" });
    next();
  }

  function hashVerificationToken(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  app.post("/api/student/register", requireStudentLoginEnabled, async (req, res) => {
    try {
      const { name, studentId, email, password } = req.body;
      if (!name || !studentId || !email || !password) {
        return res.status(400).json({ message: "Name, student ID, email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const sid = studentId.trim();
      const em = email.trim().toLowerCase();
      const nm = name.trim();

      // Block if a VERIFIED account already owns this student ID or email
      const [existingById, existingByEmail] = await Promise.all([
        storage.getStudentByStudentId(sid, true),
        storage.getStudentByEmail(em, true),
      ]);
      if (existingById) return res.status(409).json({ message: "This Student ID is already registered and verified. Please sign in." });
      if (existingByEmail) return res.status(409).json({ message: "This email address is already registered and verified. Please sign in." });

      // Delete any pending unverified records with the same identifiers (allow re-registration)
      await storage.deleteUnverifiedStudentsByIdentifiers(sid, em);

      const passwordHash = await hashPassword(password);
      const rawToken = genStudentToken();
      const tokenHash = hashVerificationToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const account = await storage.createStudentAccount(nm, sid, em, passwordHash, tokenHash, expiresAt);

      const verifyUrl = `${getTrustedBaseUrl()}/student-verify?token=${encodeURIComponent(rawToken)}`;
      try {
        await sendStudentVerificationEmail(em, nm, verifyUrl);
      } catch (emailErr) {
        console.error("Failed to send verification email:", emailErr);
        // Continue — don't block registration if email fails
      }

      res.json({ message: "Registration successful! Please check your email and click the verification link to activate your account.", email: em });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Registration failed" });
    }
  });

  app.get("/api/student/verify", async (req, res) => {
    try {
      const raw = String(req.query.token || "");
      if (!raw) return res.status(400).json({ message: "Missing verification token" });

      const tokenHash = hashVerificationToken(raw);
      const account = await storage.getStudentByVerificationToken(tokenHash);
      if (!account) return res.status(400).json({ message: "This verification link is invalid or has expired. Please register again." });

      await storage.verifyStudentAccount(account.id);

      const sessionToken = genStudentToken();
      await storage.createStudentSession(account.id, sessionToken);

      res.json({ token: sessionToken, account: { id: account.id, name: account.name, studentId: account.studentId, email: account.email } });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Verification failed" });
    }
  });

  app.post("/api/student/login", requireStudentLoginEnabled, async (req, res) => {
    try {
      const { studentId, password } = req.body;
      if (!studentId || !password) return res.status(400).json({ message: "Student ID and password are required" });
      const account = await storage.getStudentByStudentId(studentId.trim());
      if (!account) return res.status(401).json({ message: "Invalid student ID or password" });
      const valid = await verifyPassword(password, account.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid student ID or password" });
      if (!account.isVerified) {
        return res.status(403).json({ message: "Your email is not verified yet. Please check your inbox and click the verification link.", code: "UNVERIFIED" });
      }
      const rawToken = genStudentToken();
      await storage.createStudentSession(account.id, rawToken);
      res.json({ token: rawToken, account: { id: account.id, name: account.name, studentId: account.studentId, email: account.email } });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Login failed" });
    }
  });

  app.get("/api/student/me", async (req, res) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!token) return res.status(401).json({ message: "Not authenticated" });
      const result = await storage.findStudentSession(token);
      if (!result) return res.status(401).json({ message: "Session expired or invalid" });
      const { account } = result;
      res.json({ id: account.id, name: account.name, studentId: account.studentId, email: account.email });
    } catch (err) {
      res.status(500).json({ message: "Failed to get profile" });
    }
  });

  app.post("/api/student/logout", async (req, res) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token) await storage.deleteStudentSession(token);
      res.json({ message: "Logged out" });
    } catch (err) {
      res.status(500).json({ message: "Logout failed" });
    }
  });

  // =============================
  // ADMIN SETTINGS
  // =============================
  app.post("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      const { key, value } = req.body;
      await storage.setSetting(key, value);
      res.json({ message: "Setting updated" });
    } catch (err) {
      res.status(500).json({ message: "Failed to update setting" });
    }
  });

  app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
    try {
      const { oldPassword, newPassword, confirmPassword } = req.body;
      const storedPassword = (await storage.getSetting("admin_password")) || "game@420";

      if (oldPassword !== storedPassword) {
        return res.status(400).json({ message: "Incorrect old password" });
      }
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ message: "New password must be at least 4 characters" });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
      }

      await storage.setSetting("admin_password", newPassword);
      res.json({ message: "Password updated successfully" });
    } catch (err) {
      res.status(500).json({ message: "Failed to update password" });
    }
  });

  // =============================
  // STAFF MANAGEMENT
  // =============================
  app.get("/api/admin/staff", requireAdmin, async (_req, res) => {
    try {
      const staffJson = await storage.getSetting("staff_accounts");
      const staff = staffJson ? JSON.parse(staffJson) : [];
      // Never expose passwords in response
      res.json(staff.map((s: any) => ({ username: s.username, role: s.role })));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch staff" });
    }
  });

  app.post("/api/admin/staff", requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password || !role) {
        return res.status(400).json({ message: "Username, password, and role are required" });
      }
      if (!["viewer", "editor", "downloader"].includes(role)) {
        return res.status(400).json({ message: "Role must be viewer, editor, or downloader" });
      }

      const staffJson = await storage.getSetting("staff_accounts");
      const staff: any[] = staffJson ? JSON.parse(staffJson) : [];

      if (staff.find((s: any) => s.username === username)) {
        return res.status(409).json({ message: "Username already exists" });
      }

      staff.push({ username, password, role });
      await storage.setSetting("staff_accounts", JSON.stringify(staff));
      res.status(201).json({ message: "Staff account created", username, role });
    } catch (err) {
      res.status(500).json({ message: "Failed to create staff account" });
    }
  });

  app.delete("/api/admin/staff/:username", requireAdmin, async (req, res) => {
    try {
      const { username } = req.params;
      const staffJson = await storage.getSetting("staff_accounts");
      const staff: any[] = staffJson ? JSON.parse(staffJson) : [];
      const updated = staff.filter((s: any) => s.username !== username);
      await storage.setSetting("staff_accounts", JSON.stringify(updated));
      res.json({ message: "Staff account removed" });
    } catch (err) {
      res.status(500).json({ message: "Failed to remove staff account" });
    }
  });

  // =============================
  // GROUPS & STATS (admin or viewer/editor/downloader)
  // =============================
  function parseProjectFilter(raw: any): number | null | "all" {
    if (raw === undefined || raw === null || raw === "") return "all";
    if (raw === "all") return "all";
    if (raw === "none" || raw === "null") return null;
    const n = parseInt(String(raw));
    return isNaN(n) ? "all" : n;
  }

  app.get("/api/groups", requireRole("viewer", "editor", "downloader"), async (req, res) => {
    try {
      const filter = parseProjectFilter(req.query.projectId);
      res.json(await storage.getGroups(filter));
    } catch {
      res.status(500).json({ message: "Failed to fetch groups" });
    }
  });

  app.get("/api/stats", requireRole("viewer", "editor", "downloader"), async (req, res) => {
    try {
      const filter = parseProjectFilter(req.query.projectId);
      res.json(await storage.getStats(filter));
    } catch {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/export/excel", requireRole("downloader", "editor"), async (req, res) => {
    try {
      const filter = parseProjectFilter(req.query.projectId);
      const groups = await storage.getGroups(filter);
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Submissions");

      worksheet.columns = [
        { header: "Project", key: "project", width: 25 },
        { header: "Group #", key: "groupSerial", width: 10 },
        { header: "Submission Date", key: "createdAt", width: 20 },
        { header: "Role", key: "role", width: 10 },
        { header: "Student Name", key: "name", width: 25 },
        { header: "Student ID", key: "studentId", width: 15 },
        { header: "Topic", key: "topic", width: 30 },
      ];

      groups.forEach((group: any) => {
        const serial = group.projectSerial
          ? String(group.projectSerial).padStart(2, "0")
          : String(group.id);
        group.members.forEach((member: any) => {
          worksheet.addRow({
            project: group.project?.name || "(no project)",
            groupSerial: serial,
            createdAt: group.createdAt ? new Date(group.createdAt).toLocaleString() : "N/A",
            role: member.role,
            name: member.name,
            studentId: member.studentId,
            topic: member.topic?.name || "N/A",
          });
        });
      });

      // Filename reflects the filter for clarity
      let fileLabel = "submissions";
      if (typeof filter === "number") {
        const proj = await storage.getProjectById(filter);
        if (proj) fileLabel = `submissions-${proj.folderName}`;
      } else if (filter === null) {
        fileLabel = "submissions-no-project";
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=${fileLabel}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Excel export error:", err);
      res.status(500).json({ message: "Excel export failed" });
    }
  });

  app.delete("/api/admin/groups/:id", requireRole("editor"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid group id" });
      await storage.deleteGroup(id);
      res.json({ message: "Group deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete group" });
    }
  });

  // =============================
  // FILE SUBMISSION (public, check enabled)
  // =============================
  // Public: settings the student form needs (combined to reduce roundtrips)
  app.get("/api/file-submit/config", async (_req, res) => {
    try {
      const [enabled, maxSize, requireLeader, requireTopic, activeIdStr, title, subject, projTitle, deadline] =
        await Promise.all([
          storage.getSetting("file_submission_enabled"),
          storage.getSetting("file_submission_max_size_mb"),
          storage.getSetting("file_submission_require_leader"),
          storage.getSetting("file_submission_require_topic"),
          storage.getSetting("active_project_id"),
          storage.getSetting("file_submission_title"),
          storage.getSetting("file_submission_subject_label"),
          storage.getSetting("file_submission_project_title"),
          storage.getSetting("file_submission_deadline"),
        ]);
      let activeProject = null;
      if (activeIdStr) {
        const proj = await storage.getProjectById(parseInt(activeIdStr));
        if (proj && proj.status === "active") activeProject = proj;
      }
      res.json({
        enabled: enabled === "true",
        maxSizeMb: parseInt(maxSize || "5") || 5,
        requireLeader: requireLeader === "true",
        requireTopic: requireTopic === "true",
        activeProject,
        pageTitle: title || "",
        subjectHeading: subject || "",
        projectTitle: projTitle || "",
        deadline: deadline || "",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to load config" });
    }
  });

  app.post("/api/file-submit", async (req: any, res) => {
    let uploader: multer.Multer;
    try {
      uploader = await buildUploader();
    } catch (err) {
      return res.status(500).json({ message: "Upload init failed" });
    }
    uploader.array("files", 2)(req, res, async (uploadErr: any) => {
      const cleanup = () => {
        if (Array.isArray(req.files)) {
          for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
        }
      };
      try {
        if (uploadErr) {
          if (uploadErr.code === "LIMIT_FILE_SIZE") {
            const sizeStr = await storage.getSetting("file_submission_max_size_mb");
            return res.status(400).json({ message: `File must be smaller than ${sizeStr || 5} MB.` });
          }
          return res.status(400).json({ message: uploadErr.message || "Upload failed." });
        }

        const enabled = await storage.getSetting("file_submission_enabled");
        if (enabled !== "true") { cleanup(); return res.status(403).json({ message: "File submissions are currently disabled." }); }

        const deadlineStr = await storage.getSetting("file_submission_deadline");
        if (deadlineStr) {
          const deadline = new Date(deadlineStr);
          if (!isNaN(deadline.getTime()) && new Date() > deadline) {
            cleanup();
            return res.status(403).json({ message: "The file submission deadline has passed. No more submissions are accepted." });
          }
        }

        // Active project gate
        const activeIdStr = await storage.getSetting("active_project_id");
        let activeProject = null;
        if (activeIdStr) {
          const proj = await storage.getProjectById(parseInt(activeIdStr));
          if (proj && proj.status === "active") activeProject = proj;
        }
        if (!activeProject) {
          cleanup();
          return res.status(403).json({ message: "There is no active project accepting submissions right now." });
        }

        const requireLeader = (await storage.getSetting("file_submission_require_leader")) === "true";
        const requireTopic = (await storage.getSetting("file_submission_require_topic")) === "true";

        const { studentName, studentId, subject, groupLeader, topic } = req.body;
        if (!studentName?.trim()) { cleanup(); return res.status(400).json({ message: "Student name is required." }); }
        if (!studentId?.trim()) { cleanup(); return res.status(400).json({ message: "Student ID is required." }); }
        if (requireLeader && !groupLeader?.trim()) { cleanup(); return res.status(400).json({ message: "Group leader is required." }); }
        if (requireTopic && !topic?.trim()) { cleanup(); return res.status(400).json({ message: "Project topic is required." }); }

        const files = (req.files as Express.Multer.File[]) || [];
        if (files.length === 0) { cleanup(); return res.status(400).json({ message: "At least one file is required." }); }
        if (files.length > 2) { cleanup(); return res.status(400).json({ message: "You can upload at most 2 files." }); }

        await storage.createFileSubmission({
          projectId: activeProject.id,
          studentName: studentName.trim(),
          studentId: studentId.trim(),
          subject: (subject || "").trim(),
          groupLeader: (groupLeader || "").trim(),
          topic: (topic || "").trim(),
          fileName: files[0].originalname,
          filePath: files[0].path,
          fileSize: files[0].size,
          mimeType: files[0].mimetype,
          file2Name: files[1]?.originalname || null,
          file2Path: files[1]?.path || null,
          file2Size: files[1]?.size || null,
          file2MimeType: files[1]?.mimetype || null,
        });

        res.status(201).json({ message: "File submitted successfully." });
      } catch (err: any) {
        console.error("File submit error:", err);
        cleanup();
        res.status(500).json({ message: err.message || "Upload failed." });
      }
    });
  });

  // =============================
  // ADMIN/STAFF FILE SUBMISSION (no restrictions)
  // - Any file type, any size
  // - Bypasses enabled toggle, deadline, required-field toggles
  // - Optional projectId in body (defaults to active project; falls back to none)
  // =============================
  app.post("/api/admin/file-submit", requireRole("editor"), async (req: any, res) => {
    // Read projectId early from query so we know the destination folder.
    const queryProjectId = req.query.projectId ? parseInt(String(req.query.projectId)) : undefined;
    let uploader: multer.Multer;
    try {
      uploader = await buildAdminUploader(queryProjectId);
    } catch (err) {
      return res.status(500).json({ message: "Upload init failed" });
    }
    uploader.array("files", 2)(req, res, async (uploadErr: any) => {
      const cleanup = () => {
        if (Array.isArray(req.files)) {
          for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} }
        }
      };
      try {
        if (uploadErr) {
          return res.status(400).json({ message: uploadErr.message || "Upload failed." });
        }

        const { studentName, studentId, subject, groupLeader, topic, projectId: bodyProjectId } = req.body;
        if (!studentName?.trim()) { cleanup(); return res.status(400).json({ message: "Student name is required." }); }
        if (!studentId?.trim()) { cleanup(); return res.status(400).json({ message: "Student ID is required." }); }

        // Resolve target project: explicit body/query > active > none.
        let targetProjectId: number | null = null;
        const explicit = bodyProjectId ? parseInt(String(bodyProjectId)) : queryProjectId;
        if (explicit && !isNaN(explicit)) {
          const p = await storage.getProjectById(explicit);
          if (p) targetProjectId = p.id;
        } else {
          const activeIdStr = await storage.getSetting("active_project_id");
          if (activeIdStr) {
            const p = await storage.getProjectById(parseInt(activeIdStr));
            if (p) targetProjectId = p.id;
          }
        }

        const files = (req.files as Express.Multer.File[]) || [];
        if (files.length === 0) { cleanup(); return res.status(400).json({ message: "At least one file is required." }); }
        if (files.length > 2) { cleanup(); return res.status(400).json({ message: "You can upload at most 2 files." }); }

        await storage.createFileSubmission({
          projectId: targetProjectId,
          studentName: studentName.trim(),
          studentId: studentId.trim(),
          subject: (subject || "").trim(),
          groupLeader: (groupLeader || "").trim(),
          topic: (topic || "").trim(),
          fileName: files[0].originalname,
          filePath: files[0].path,
          fileSize: files[0].size,
          mimeType: files[0].mimetype,
          file2Name: files[1]?.originalname || null,
          file2Path: files[1]?.path || null,
          file2Size: files[1]?.size || null,
          file2MimeType: files[1]?.mimetype || null,
        });

        res.status(201).json({ message: "File uploaded successfully." });
      } catch (err: any) {
        console.error("Admin file submit error:", err);
        cleanup();
        res.status(500).json({ message: err.message || "Upload failed." });
      }
    });
  });

  // =============================
  // PROJECT MANAGEMENT
  // =============================
  app.get("/api/admin/projects", requireRole("viewer", "editor", "downloader"), async (_req, res) => {
    try {
      const list = await storage.getProjects();
      const activeIdStr = await storage.getSetting("active_project_id");
      res.json({ projects: list, activeProjectId: activeIdStr ? parseInt(activeIdStr) : null });
    } catch {
      res.status(500).json({ message: "Failed to load projects" });
    }
  });

  app.post("/api/admin/projects", requireAdmin, async (req: any, res) => {
    try {
      const { name, deadline } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Project name is required." });
      const trimmed = name.trim();

      // Optional deadline: accepts ISO string or "YYYY-MM-DDTHH:mm" from
      // <input type="datetime-local">. Empty / missing → no deadline.
      let deadlineDate: Date | null = null;
      if (deadline && String(deadline).trim()) {
        const d = new Date(deadline);
        if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid deadline." });
        deadlineDate = d;
      }

      const folderName = `${Date.now()}_${sanitizeFolder(trimmed)}`;
      const project = await storage.createProject(trimmed, folderName, deadlineDate);
      // Create the folder on disk
      const dir = path.join(uploadsDir, folderName);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Set as active project
      await storage.setSetting("active_project_id", String(project.id));
      res.status(201).json(project);
    } catch (err: any) {
      console.error("Create project error:", err);
      res.status(500).json({ message: err.message || "Failed to create project" });
    }
  });

  // Update an existing project's deadline (admin can extend / shorten / clear).
  app.patch("/api/admin/projects/:id/deadline", requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project id" });
      const { deadline } = req.body;
      let deadlineDate: Date | null = null;
      if (deadline && String(deadline).trim()) {
        const d = new Date(deadline);
        if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid deadline." });
        deadlineDate = d;
      }
      await storage.updateProjectDeadline(id, deadlineDate);
      res.json({ message: "Deadline updated", deadline: deadlineDate?.toISOString() ?? null });
    } catch (err: any) {
      console.error("Update deadline error:", err);
      res.status(500).json({ message: err.message || "Failed to update deadline" });
    }
  });

  app.post("/api/admin/projects/:id/finalize", requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const proj = await storage.getProjectById(id);
      if (!proj) return res.status(404).json({ message: "Project not found" });
      await storage.finalizeProject(id);
      // Clear active project pointer if this was the active one
      const activeIdStr = await storage.getSetting("active_project_id");
      if (activeIdStr && parseInt(activeIdStr) === id) {
        await storage.setSetting("active_project_id", "");
      }
      res.json({ message: "Project finalized" });
    } catch (err: any) {
      console.error("Finalize error:", err);
      res.status(500).json({ message: err.message || "Failed to finalize" });
    }
  });

  app.delete("/api/admin/projects/:id", requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const proj = await storage.getProjectById(id);
      if (!proj) return res.status(404).json({ message: "Not found" });
      // Delete all submissions of that project (and their files on disk)
      const subs = await storage.getFileSubmissions();
      for (const s of subs) {
        if (s.projectId === id) {
          try { if (s.filePath && fs.existsSync(s.filePath)) fs.unlinkSync(s.filePath); } catch {}
          try { if (s.file2Path && fs.existsSync(s.file2Path)) fs.unlinkSync(s.file2Path); } catch {}
          await storage.deleteFileSubmission(s.id);
        }
      }
      // Remove folder
      try {
        const dir = path.join(uploadsDir, proj.folderName);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      await storage.deleteProject(id);
      const activeIdStr = await storage.getSetting("active_project_id");
      if (activeIdStr && parseInt(activeIdStr) === id) {
        await storage.setSetting("active_project_id", "");
      }
      res.json({ message: "Project deleted" });
    } catch (err: any) {
      console.error("Delete project error:", err);
      res.status(500).json({ message: err.message || "Failed to delete" });
    }
  });

  // The legacy "security question" forgot-password flow has been replaced by
  // the magic-link flow above (POST /api/auth/admin/forgot). Kept as a 410 for
  // a short time so any stale clients show a clear message instead of failing
  // silently.
  app.post("/api/admin/forgot-password", (_req, res) => {
    res.status(410).json({
      message: "This recovery method has been replaced. Please use the new 'Forgot password?' link on the login screen.",
    });
  });

  // =============================
  // ADMIN FILE SUBMISSION MANAGEMENT
  // =============================
  app.get("/api/admin/file-submissions", requireRole("viewer", "editor", "downloader"), async (_req, res) => {
    try {
      res.json(await storage.getFileSubmissions());
    } catch {
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  // ZIP EXPORT must come BEFORE :id route
  app.get("/api/admin/file-submissions/export-zip", requireRole("downloader", "editor"), async (req, res) => {
    try {
      const projectIdQ = req.query.projectId ? parseInt(String(req.query.projectId)) : null;
      const all = await storage.getFileSubmissions();
      const submissions = projectIdQ ? all.filter(s => s.projectId === projectIdQ) : all;

      let zipName = "file-submissions-export.zip";
      if (projectIdQ) {
        const proj = await storage.getProjectById(projectIdQ);
        if (proj) zipName = `${sanitizeFolder(proj.name)}-submissions.zip`;
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err) => { throw err; });
      archive.pipe(res);

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("File Submissions");
      ws.columns = [
        { header: "#", key: "num", width: 6 },
        { header: "Project", key: "project", width: 24 },
        { header: "Student Name", key: "studentName", width: 28 },
        { header: "Student ID", key: "studentId", width: 18 },
        { header: "Group Leader", key: "groupLeader", width: 24 },
        { header: "Topic", key: "topic", width: 26 },
        { header: "Subject", key: "subject", width: 24 },
        { header: "File 1", key: "fileName", width: 32 },
        { header: "File 1 Size", key: "fileSize", width: 12 },
        { header: "File 2", key: "file2Name", width: 32 },
        { header: "File 2 Size", key: "file2Size", width: 12 },
        { header: "Submitted At", key: "createdAt", width: 22 },
      ];
      ws.getRow(1).font = { bold: true };

      submissions.forEach((sub: any, idx) => {
        ws.addRow({
          num: idx + 1,
          project: sub.project?.name || "(no project)",
          studentName: sub.studentName,
          studentId: sub.studentId,
          groupLeader: sub.groupLeader || "",
          topic: sub.topic || "",
          subject: sub.subject || "",
          fileName: sub.fileName,
          fileSize: `${(sub.fileSize / 1024).toFixed(1)} KB`,
          file2Name: sub.file2Name || "",
          file2Size: sub.file2Size ? `${(sub.file2Size / 1024).toFixed(1)} KB` : "",
          createdAt: new Date(sub.createdAt).toLocaleString(),
        });
      });

      const excelBuffer = await workbook.xlsx.writeBuffer();
      archive.append(Buffer.from(excelBuffer), { name: "summary.xlsx" });

      const cleanName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");

      for (const sub of submissions as any[]) {
        const projectFolder = sub.project ? cleanName(sub.project.name) : "_no_project";
        const baseLabel = `${cleanName(sub.studentName)}_${cleanName(sub.studentId)}`;
        if (sub.filePath && fs.existsSync(sub.filePath)) {
          const ext1 = path.extname(sub.fileName) || ".pdf";
          archive.file(sub.filePath, { name: `${projectFolder}/${baseLabel}${ext1}` });
        }
        if (sub.file2Path && fs.existsSync(sub.file2Path)) {
          const ext2 = path.extname(sub.file2Name || "") || ".pdf";
          archive.file(sub.file2Path, { name: `${projectFolder}/${baseLabel}_2${ext2}` });
        }
      }

      await archive.finalize();
    } catch (err) {
      console.error("ZIP export error:", err);
      if (!res.headersSent) res.status(500).json({ message: "ZIP export failed" });
    }
  });

  app.get("/api/admin/file-submissions/:id/download", requireRole("downloader", "editor"), async (req, res) => {
    try {
      const fileNum = req.query.file === "2" ? 2 : 1;
      const submissions = await storage.getFileSubmissions();
      const sub = submissions.find(s => s.id === parseInt(req.params.id));
      if (!sub) return res.status(404).json({ message: "Not found" });
      const fp = fileNum === 2 ? sub.file2Path : sub.filePath;
      const fn = fileNum === 2 ? sub.file2Name : sub.fileName;
      if (!fp || !fn) return res.status(404).json({ message: "File not present" });
      if (!fs.existsSync(fp)) return res.status(404).json({ message: "File missing from server" });
      res.download(fp, fn);
    } catch {
      res.status(500).json({ message: "Download failed" });
    }
  });

  app.delete("/api/admin/file-submissions/:id", requireRole("editor"), async (req, res) => {
    try {
      const submissions = await storage.getFileSubmissions();
      const sub = submissions.find(s => s.id === parseInt(req.params.id));
      if (!sub) return res.status(404).json({ message: "Not found" });
      try { if (sub.filePath && fs.existsSync(sub.filePath)) fs.unlinkSync(sub.filePath); } catch {}
      try { if (sub.file2Path && fs.existsSync(sub.file2Path)) fs.unlinkSync(sub.file2Path); } catch {}
      await storage.deleteFileSubmission(sub.id);
      res.json({ message: "Deleted" });
    } catch {
      res.status(500).json({ message: "Delete failed" });
    }
  });

  // =============================
  // AI CHAT (OpenAI function calling)
  // =============================
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const adminAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_dashboard_stats",
        description: "Get current dashboard statistics: total groups and total students registered.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "list_groups",
        description: "List all registered groups with their members.",
        parameters: {
          type: "object",
          properties: {
            project_id: { type: "number", description: "Optional project ID to filter groups by project." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_group",
        description: "Delete a group by its ID. Use only when explicitly asked.",
        parameters: {
          type: "object",
          properties: {
            group_id: { type: "number", description: "The ID of the group to delete." },
          },
          required: ["group_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_topics",
        description: "List all available project topics.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "add_topic",
        description: "Add a new topic that students can choose for their group.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The topic name to add." },
            description: { type: "string", description: "Optional description for the topic." },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_topic",
        description: "Delete a topic by its ID.",
        parameters: {
          type: "object",
          properties: {
            topic_id: { type: "number", description: "The ID of the topic to delete." },
          },
          required: ["topic_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_required_members",
        description: "Set the number of members required per group.",
        parameters: {
          type: "object",
          properties: {
            count: { type: "number", description: "Number of members required (e.g. 2, 5, 6)." },
          },
          required: ["count"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_project_name",
        description: "Update the project/portal display name shown to students.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The new project name." },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_deadline",
        description: "Set the submission deadline. You can set it as hours from now or as a specific ISO date string.",
        parameters: {
          type: "object",
          properties: {
            hours_from_now: { type: "number", description: "Set deadline N hours from now. Use this or iso_datetime." },
            iso_datetime: { type: "string", description: "Set deadline to a specific ISO datetime string. Use this or hours_from_now." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_rules",
        description: "Update the submission rules text shown to students in the rules modal.",
        parameters: {
          type: "object",
          properties: {
            rules_text: { type: "string", description: "The full rules text to set." },
          },
          required: ["rules_text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "toggle_require_leader",
        description: "Enable or disable the group leader requirement.",
        parameters: {
          type: "object",
          properties: {
            enabled: { type: "boolean", description: "True to require a group leader, false to disable." },
          },
          required: ["enabled"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "toggle_require_topic",
        description: "Enable or disable the topic selection requirement for groups.",
        parameters: {
          type: "object",
          properties: {
            enabled: { type: "boolean", description: "True to require topic selection, false to disable." },
          },
          required: ["enabled"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_projects",
        description: "List all project cycles with their status and deadlines.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "create_project",
        description: "Create a new project cycle (submission period) and make it active.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The name for the new project cycle." },
            deadline_hours: { type: "number", description: "Optional: deadline in hours from now." },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finalize_project",
        description: "Finalize (close) a project cycle so no more submissions are accepted.",
        parameters: {
          type: "object",
          properties: {
            project_id: { type: "number", description: "The ID of the project to finalize." },
          },
          required: ["project_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_current_settings",
        description: "Get all current admin settings: required members, project name, deadline, rules, require leader, require topic.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  async function executeAdminTool(name: string, args: any): Promise<string> {
    switch (name) {
      case "get_dashboard_stats": {
        const s = await storage.getStats();
        return JSON.stringify(s);
      }
      case "list_groups": {
        const groups = await storage.getGroups(args.project_id ?? "all");
        const summary = groups.map(g => ({
          id: g.id,
          projectId: g.projectId,
          members: g.members.map(m => ({ name: m.name, studentId: m.studentId, role: m.role })),
          createdAt: g.createdAt,
        }));
        return JSON.stringify(summary);
      }
      case "delete_group": {
        await storage.deleteGroup(args.group_id);
        return `Group ${args.group_id} deleted successfully.`;
      }
      case "list_topics": {
        const topics = await storage.getTopics();
        return JSON.stringify(topics);
      }
      case "add_topic": {
        const topic = await storage.createTopic(args.name, args.description);
        return `Topic "${args.name}" added with ID ${topic.id}.`;
      }
      case "delete_topic": {
        await storage.deleteTopic(args.topic_id);
        return `Topic ${args.topic_id} deleted.`;
      }
      case "set_required_members": {
        await storage.setSetting("required_members", String(args.count));
        return `Required members set to ${args.count}.`;
      }
      case "set_project_name": {
        await storage.setSetting("project_name", args.name);
        return `Project name updated to "${args.name}".`;
      }
      case "set_deadline": {
        let date: Date;
        if (args.hours_from_now != null) {
          date = new Date();
          date.setHours(date.getHours() + args.hours_from_now);
        } else if (args.iso_datetime) {
          date = new Date(args.iso_datetime);
        } else {
          return "Error: Provide either hours_from_now or iso_datetime.";
        }
        await storage.setSetting("submission_deadline", date.toISOString());
        return `Deadline set to ${date.toLocaleString()}.`;
      }
      case "update_rules": {
        await storage.setSetting("rules", args.rules_text);
        return "Rules updated successfully.";
      }
      case "toggle_require_leader": {
        await storage.setSetting("group_require_leader", args.enabled ? "true" : "false");
        return `Group leader requirement ${args.enabled ? "enabled" : "disabled"}.`;
      }
      case "toggle_require_topic": {
        await storage.setSetting("group_require_topic", args.enabled ? "true" : "false");
        return `Topic requirement ${args.enabled ? "enabled" : "disabled"}.`;
      }
      case "list_projects": {
        const projects = await storage.getProjects();
        return JSON.stringify(projects);
      }
      case "create_project": {
        let deadline: Date | undefined;
        if (args.deadline_hours) {
          deadline = new Date();
          deadline.setHours(deadline.getHours() + args.deadline_hours);
        }
        const folderName = args.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const project = await storage.createProject(args.name, folderName, deadline ?? null);
        await storage.setSetting("active_project_id", String(project.id));
        return `Project "${args.name}" created with ID ${project.id} and set as active.`;
      }
      case "finalize_project": {
        await storage.finalizeProject(args.project_id);
        return `Project ${args.project_id} finalized.`;
      }
      case "get_current_settings": {
        const [members, projectName, deadline, rules, requireLeader, requireTopic] = await Promise.all([
          storage.getSetting("required_members"),
          storage.getSetting("project_name"),
          storage.getSetting("submission_deadline"),
          storage.getSetting("rules"),
          storage.getSetting("group_require_leader"),
          storage.getSetting("group_require_topic"),
        ]);
        return JSON.stringify({ required_members: members || "6", project_name: projectName || "Student Group Portal", deadline: deadline || "none", rules: rules || "none", require_leader: requireLeader !== "false", require_topic: requireTopic !== "false" });
      }
      default:
        return `Unknown function: ${name}`;
    }
  }

  app.post("/api/admin/ai-chat", requireAdmin, async (req, res) => {
    try {
      const { messages } = req.body as { messages: Array<{ role: string; content: string }> };
      if (!messages?.length) return res.status(400).json({ message: "Messages are required" });

      const systemPrompt = `You are an autonomous AI admin assistant for a Student Group Dashboard System. You help the admin manage their student group submission portal.

You have full access to all admin operations through your tools. When the admin asks you to do something, use the appropriate tools to perform the action immediately — don't just describe what you would do.

Current capabilities:
- View stats, groups, topics, settings, projects
- Add/delete topics and groups  
- Set required members per group, project name, submission deadline, rules
- Toggle group leader and topic requirements
- Create new project cycles and finalize existing ones

Be concise in your responses. After performing actions, confirm what was done. If asked to do multiple things, do them all. If something needs clarification, ask briefly.

Always be helpful and decisive — this is an admin panel, so be action-oriented.`;

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const actionsPerformed: Array<{ tool: string; result: string }> = [];

      // Agentic loop — keep calling until no more tool calls
      let loopMessages = [...chatMessages];
      let iterations = 0;
      const MAX_ITER = 10;

      while (iterations < MAX_ITER) {
        iterations++;
        const response = await openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: loopMessages,
          tools: adminAiTools,
          tool_choice: "auto",
        });

        const choice = response.choices[0];
        const assistantMessage = choice.message;
        loopMessages.push(assistantMessage as any);

        if (!assistantMessage.tool_calls?.length) {
          return res.json({
            reply: assistantMessage.content || "Done.",
            actions: actionsPerformed,
          });
        }

        // Execute all tool calls
        for (const toolCall of assistantMessage.tool_calls) {
          const fn = (toolCall as any).function;
          const args = JSON.parse(fn.arguments || "{}");
          const result = await executeAdminTool(fn.name, args);
          actionsPerformed.push({ tool: fn.name, result });
          loopMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          } as any);
        }
      }

      return res.json({ reply: "Actions completed.", actions: actionsPerformed });
    } catch (err: any) {
      console.error("AI chat error:", err);
      res.status(500).json({ message: err?.message || "AI request failed" });
    }
  });

  // Keep old endpoint for backwards compatibility
  app.post("/api/admin/ai-execute", requireAdmin, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ message: "Prompt is required" });
    req.body.messages = [{ role: "user", content: prompt }];
    // Forward to new handler inline
    try {
      const messages = [{ role: "user", content: prompt }];
      const systemPrompt = "You are an admin assistant. Perform the requested action using your tools.";
      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: chatMessages,
        tools: adminAiTools,
        tool_choice: "auto",
      });
      const choice = response.choices[0];
      const assistantMessage = choice.message;
      if (assistantMessage.tool_calls?.length) {
        const loopMessages: any[] = [...chatMessages, assistantMessage];
        for (const toolCall of assistantMessage.tool_calls) {
          const fn = (toolCall as any).function;
          const args = JSON.parse(fn.arguments || "{}");
          const result = await executeAdminTool(fn.name, args);
          loopMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        }
        const final = await openai.chat.completions.create({ model: "gpt-5-mini", messages: loopMessages, tools: adminAiTools });
        return res.json({ message: final.choices[0]?.message?.content || "Done." });
      }
      return res.json({ message: assistantMessage.content || "Done." });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "AI request failed" });
    }
  });

  // =============================
  // ADMIN: STUDENT ACCOUNT MANAGEMENT
  // =============================
  app.get("/api/admin/students", requireAdmin, async (_req, res) => {
    try {
      const accounts = await storage.getAllStudentAccounts();
      res.json(accounts.map(a => ({
        id: a.id,
        name: a.name,
        studentId: a.studentId,
        email: a.email,
        isVerified: a.isVerified,
        createdAt: a.createdAt,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch students" });
    }
  });

  app.post("/api/admin/students/:id/verify", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.verifyStudentAccount(id);
      res.json({ message: "Student verified successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to verify student" });
    }
  });

  app.delete("/api/admin/students/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.deleteStudentAccount(id);
      res.json({ message: "Student deleted successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete student" });
    }
  });

  return httpServer;
}
