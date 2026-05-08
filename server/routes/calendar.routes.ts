/**
 * Calendar events routes.
 * Public read (students) + admin CRUD with optional file attachment.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const calendarRouter = Router();

// ── Upload dir ─────────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.resolve("uploads", "calendar-events");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Validation ─────────────────────────────────────────────────────────────────
const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  eventType: z.enum(["assignment", "exam", "activity", "holiday", "other"]).default("other"),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  semester: z.string().optional().default("all"),
});

// ── Public: get events (filtered by semester when provided) ─────────────────────
calendarRouter.get("/api/calendar/events", async (req, res) => {
  try {
    const semester = req.query.semester ? String(req.query.semester) : undefined;
    const events = await storage.getCalendarEvents(semester);
    res.json(events);
  } catch {
    res.status(500).json({ message: "Failed to load calendar events" });
  }
});

// ── Public: download attachment ─────────────────────────────────────────────────
calendarRouter.get("/api/calendar/events/:id/file", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  try {
    const event = await storage.getCalendarEventById(id);
    if (!event || !event.filePath) return res.status(404).json({ message: "File not found" });
    res.download(event.filePath, event.fileName || "attachment");
  } catch {
    res.status(500).json({ message: "Download failed" });
  }
});

// ── Admin: create event ─────────────────────────────────────────────────────────
calendarRouter.post("/api/admin/calendar/events", requireAdmin, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
  try {
    const event = await storage.createCalendarEvent(parsed.data);
    res.status(201).json(event);
  } catch {
    res.status(500).json({ message: "Failed to create event" });
  }
});

// ── Admin: update event ─────────────────────────────────────────────────────────
calendarRouter.put("/api/admin/calendar/events/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  const parsed = eventSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
  try {
    const updated = await storage.updateCalendarEvent(id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Event not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ message: "Failed to update event" });
  }
});

// ── Admin: attach file to event ─────────────────────────────────────────────────
calendarRouter.post("/api/admin/calendar/events/:id/upload", requireAdmin, upload.single("file"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  try {
    // Remove old file if exists
    const existing = await storage.getCalendarEventById(id);
    if (existing?.filePath) {
      try { fs.unlinkSync(existing.filePath); } catch {}
    }
    const updated = await storage.updateCalendarEvent(id, {
      filePath: req.file.path,
      fileName: req.file.originalname,
      fileMimeType: req.file.mimetype,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ message: "Upload failed" });
  }
});

// ── Admin: remove attachment ────────────────────────────────────────────────────
calendarRouter.delete("/api/admin/calendar/events/:id/file", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  try {
    const event = await storage.getCalendarEventById(id);
    if (event?.filePath) {
      try { fs.unlinkSync(event.filePath); } catch {}
    }
    const updated = await storage.updateCalendarEvent(id, { filePath: null, fileName: null, fileMimeType: null });
    res.json(updated);
  } catch {
    res.status(500).json({ message: "Failed to remove file" });
  }
});

// ── Admin: delete event ─────────────────────────────────────────────────────────
calendarRouter.delete("/api/admin/calendar/events/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  try {
    const event = await storage.getCalendarEventById(id);
    if (event?.filePath) { try { fs.unlinkSync(event.filePath); } catch {} }
    await storage.deleteCalendarEvent(id);
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete event" });
  }
});
