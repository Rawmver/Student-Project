import { Router } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const staffRouter = Router();

staffRouter.get("/api/admin/staff", requireAdmin, async (_req, res) => {
  try {
    const staffJson = await storage.getSetting("staff_accounts");
    const staff = staffJson ? JSON.parse(staffJson) : [];
    res.json(staff.map((s: any) => ({ username: s.username, role: s.role })));
  } catch {
    res.status(500).json({ message: "Failed to fetch staff" });
  }
});

staffRouter.post("/api/admin/staff", requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: "Username, password, and role are required" });
    if (!["viewer", "editor", "downloader"].includes(role)) return res.status(400).json({ message: "Role must be viewer, editor, or downloader" });

    const staffJson = await storage.getSetting("staff_accounts");
    const staff: any[] = staffJson ? JSON.parse(staffJson) : [];
    if (staff.find((s: any) => s.username === username)) return res.status(409).json({ message: "Username already exists" });

    staff.push({ username, password, role });
    await storage.setSetting("staff_accounts", JSON.stringify(staff));
    res.status(201).json({ message: "Staff account created", username, role });
  } catch {
    res.status(500).json({ message: "Failed to create staff account" });
  }
});

staffRouter.delete("/api/admin/staff/:username", requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const staffJson = await storage.getSetting("staff_accounts");
    const staff: any[] = staffJson ? JSON.parse(staffJson) : [];
    await storage.setSetting("staff_accounts", JSON.stringify(staff.filter((s: any) => s.username !== username)));
    res.json({ message: "Staff account removed" });
  } catch {
    res.status(500).json({ message: "Failed to remove staff account" });
  }
});
