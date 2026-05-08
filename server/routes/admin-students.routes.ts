import { Router } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middlewares/auth";

export const adminStudentsRouter = Router();

adminStudentsRouter.get("/api/admin/students", requireAdmin, async (_req, res) => {
  try {
    const accounts = await storage.getAllStudentAccounts();
    res.json(accounts.map(a => ({
      id: a.id, name: a.name, studentId: a.studentId,
      email: a.email, isVerified: a.isVerified, createdAt: a.createdAt,
    })));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to fetch students" });
  }
});

adminStudentsRouter.post("/api/admin/students/:id/verify", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    await storage.verifyStudentAccount(id);
    res.json({ message: "Student verified successfully" });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to verify student" });
  }
});

adminStudentsRouter.delete("/api/admin/students/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    await storage.deleteStudentAccount(id);
    res.json({ message: "Student deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to delete student" });
  }
});
