import { Router } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const settingsRouter = Router();

// ─── Public: read a single setting ───────────────────────────────────────────
settingsRouter.get("/api/settings/:key", async (req, res) => {
  try {
    const value = await storage.getSetting(req.params.key);
    res.json({ value });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch setting" });
  }
});

// ─── Admin: upsert a setting ──────────────────────────────────────────────────
settingsRouter.post("/api/admin/settings", requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    await storage.setSetting(key, value);
    res.json({ message: "Setting updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update setting" });
  }
});

// ─── Admin: change admin password ────────────────────────────────────────────
settingsRouter.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const storedPassword = (await storage.getSetting("admin_password")) || "game@420";
    if (oldPassword !== storedPassword) return res.status(400).json({ message: "Incorrect old password" });
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ message: "New password must be at least 4 characters" });
    if (newPassword !== confirmPassword) return res.status(400).json({ message: "Passwords do not match" });
    await storage.setSetting("admin_password", newPassword);
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update password" });
  }
});
