/**
 * Student ↔ Admin messaging.
 *
 * Students post questions / issues / feedback from their portal; admins read
 * and reply from the admin "Messages" panel. Each message supports a single
 * admin reply (kept simple — no full thread). Unread counts drive a bell
 * badge on both sides.
 */
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";
import { insertStudentMessageSchema } from "@shared/schema";

export const messagesRouter = Router();

// Helper: pull authenticated student account from Bearer token.
async function getStudentFromAuth(req: any) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  return await storage.findStudentSession(token);
}

// Per-student rate-limit: max 5 new messages / 10 minutes — prevents spam
// abuse of the admin inbox without blocking legitimate use.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const recentSends = new Map<number, number[]>();
function checkRate(accountId: number): boolean {
  const now = Date.now();
  const arr = (recentSends.get(accountId) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    recentSends.set(accountId, arr);
    return false;
  }
  arr.push(now);
  recentSends.set(accountId, arr);
  return true;
}

// ─── STUDENT-SIDE ─────────────────────────────────────────────────────────────

messagesRouter.post("/api/student/messages", async (req, res) => {
  try {
    const result = await getStudentFromAuth(req);
    if (!result) return res.status(401).json({ message: "Not authenticated" });

    const parsed = insertStudentMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
    }

    if (!checkRate(result.account.id)) {
      return res.status(429).json({ message: "You've sent too many messages recently. Please wait a few minutes and try again." });
    }

    const msg = await storage.createStudentMessage({
      studentAccountId: result.account.id,
      studentName: result.account.name,
      studentId: result.account.studentId,
      studentEmail: result.account.email,
      category: parsed.data.category,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    res.json(msg);
  } catch (err: any) {
    console.error("create student message error:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

messagesRouter.get("/api/student/messages", async (req, res) => {
  try {
    const result = await getStudentFromAuth(req);
    if (!result) return res.status(401).json({ message: "Not authenticated" });
    const list = await storage.listStudentMessagesByAccount(result.account.id);
    res.json(list);
  } catch (err: any) {
    console.error("list student messages error:", err);
    res.status(500).json({ message: "Failed to load messages" });
  }
});

// Mark all of a student's replied-but-unread messages as read on their side
// (drives the bell-badge clear when they open the Messages tab).
messagesRouter.post("/api/student/messages/mark-read", async (req, res) => {
  try {
    const result = await getStudentFromAuth(req);
    if (!result) return res.status(401).json({ message: "Not authenticated" });
    await storage.markStudentMessagesReadByStudent(result.account.id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("mark-read student messages error:", err);
    res.status(500).json({ message: "Failed to mark read" });
  }
});

// ─── ADMIN-SIDE ───────────────────────────────────────────────────────────────

messagesRouter.get("/api/admin/messages", requireAdmin, async (_req, res) => {
  try {
    const list = await storage.listAllStudentMessages();
    res.json(list);
  } catch (err: any) {
    console.error("admin list messages error:", err);
    res.status(500).json({ message: "Failed to load messages" });
  }
});

const replySchema = z.object({ reply: z.string().trim().min(1, "Reply required").max(4000) });
messagesRouter.post("/api/admin/messages/:id/reply", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid reply" });
    const updated = await storage.replyToStudentMessage(id, parsed.data.reply);
    if (!updated) {
      // Either the row doesn't exist OR it already has a reply (single-shot rule).
      // Disambiguate so the client gets a useful message.
      const all = await storage.listAllStudentMessages();
      const existing = all.find(m => m.id === id);
      if (!existing) return res.status(404).json({ message: "Message not found" });
      return res.status(409).json({ message: "This message has already been replied to." });
    }
    res.json(updated);
  } catch (err: any) {
    console.error("admin reply message error:", err);
    res.status(500).json({ message: "Failed to send reply" });
  }
});

// Mark all unread admin-side messages as read (clears admin bell badge).
messagesRouter.post("/api/admin/messages/mark-all-read", requireAdmin, async (_req, res) => {
  try {
    await storage.markAllStudentMessagesReadByAdmin();
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin mark-all-read error:", err);
    res.status(500).json({ message: "Failed to mark read" });
  }
});

messagesRouter.delete("/api/admin/messages/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    await storage.deleteStudentMessage(id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("admin delete message error:", err);
    res.status(500).json({ message: "Failed to delete" });
  }
});
