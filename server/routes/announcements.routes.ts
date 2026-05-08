import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const announcementsRouter = Router();

const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required").max(2000),
  priority: z.enum(["info", "warning", "important"]).default("info"),
});

announcementsRouter.get("/api/announcements", async (_req, res) => {
  try {
    const list = await storage.getAnnouncements();
    res.json(list);
  } catch {
    res.status(500).json({ message: "Failed to load announcements" });
  }
});

announcementsRouter.post("/api/admin/announcements", requireAdmin, async (req, res) => {
  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0].message });
  }
  try {
    const ann = await storage.createAnnouncement(
      parsed.data.title,
      parsed.data.content,
      parsed.data.priority,
    );
    res.status(201).json(ann);
  } catch {
    res.status(500).json({ message: "Failed to create announcement" });
  }
});

announcementsRouter.delete("/api/admin/announcements/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  try {
    await storage.deleteAnnouncement(id);
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete announcement" });
  }
});
