import { Router } from "express";
import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { requireAdmin, requireRole } from "../middlewares/auth";
import { uploadsDir } from "../config/multer";
import { sanitizeFolder } from "../utils/url";

export const projectsRouter = Router();

// ─── Public: get active group project ─────────────────────────────────────────
projectsRouter.get("/api/projects/active", async (req, res) => {
  try {
    const type = req.query.type === "file" ? "file" : "group";
    const settingKey = type === "file" ? "active_file_project_id" : "active_group_project_id";
    let idStr = await storage.getSetting(settingKey);
    if (!idStr) idStr = await storage.getSetting("active_project_id");
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

// ─── Admin: list all projects ─────────────────────────────────────────────────
projectsRouter.get("/api/admin/projects", requireRole("viewer", "editor", "downloader"), async (_req, res) => {
  try {
    const list = await storage.getProjects();
    const activeGroupIdStr = await storage.getSetting("active_group_project_id") || await storage.getSetting("active_project_id");
    const activeFileIdStr = await storage.getSetting("active_file_project_id") || await storage.getSetting("active_project_id");
    res.json({
      projects: list,
      activeProjectId: activeGroupIdStr ? parseInt(activeGroupIdStr) : null,
      activeGroupProjectId: activeGroupIdStr ? parseInt(activeGroupIdStr) : null,
      activeFileProjectId: activeFileIdStr ? parseInt(activeFileIdStr) : null,
    });
  } catch {
    res.status(500).json({ message: "Failed to load projects" });
  }
});

// ─── Admin: create project ────────────────────────────────────────────────────
projectsRouter.post("/api/admin/projects", requireAdmin, async (req, res) => {
  try {
    const { name, deadline } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Project name is required." });
    const trimmed = name.trim();

    let deadlineDate: Date | null = null;
    if (deadline && String(deadline).trim()) {
      const d = new Date(deadline);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid deadline." });
      deadlineDate = d;
    }

    const folderName = `${Date.now()}_${sanitizeFolder(trimmed)}`;
    const project = await storage.createProject(trimmed, folderName, deadlineDate);
    const dir = path.join(uploadsDir, folderName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const projectType = req.body.projectType || "both";
    if (projectType === "group" || projectType === "both") {
      await storage.setSetting("active_group_project_id", String(project.id));
    }
    if (projectType === "file" || projectType === "both") {
      await storage.setSetting("active_file_project_id", String(project.id));
    }
    res.status(201).json(project);
  } catch (err: any) {
    console.error("Create project error:", err);
    res.status(500).json({ message: err.message || "Failed to create project" });
  }
});

// ─── Admin: update project deadline ──────────────────────────────────────────
projectsRouter.patch("/api/admin/projects/:id/deadline", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
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

// ─── Admin: finalize project ──────────────────────────────────────────────────
projectsRouter.post("/api/admin/projects/:id/finalize", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const proj = await storage.getProjectById(id);
    if (!proj) return res.status(404).json({ message: "Project not found" });
    await storage.finalizeProject(id);
    const activeGroupIdStr = await storage.getSetting("active_group_project_id");
    if (activeGroupIdStr && parseInt(activeGroupIdStr) === id) await storage.setSetting("active_group_project_id", "");
    const activeFileIdStr = await storage.getSetting("active_file_project_id");
    if (activeFileIdStr && parseInt(activeFileIdStr) === id) await storage.setSetting("active_file_project_id", "");
    res.json({ message: "Project finalized" });
  } catch (err: any) {
    console.error("Finalize error:", err);
    res.status(500).json({ message: err.message || "Failed to finalize" });
  }
});

// ─── Admin: delete project ────────────────────────────────────────────────────
projectsRouter.delete("/api/admin/projects/:id", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const proj = await storage.getProjectById(id);
    if (!proj) return res.status(404).json({ message: "Not found" });

    // Delete associated file submissions and their disk files
    const subs = await storage.getFileSubmissions();
    for (const s of subs) {
      if (s.projectId !== id) continue;
      try { if (s.filePath && fs.existsSync(s.filePath)) fs.unlinkSync(s.filePath); } catch {}
      try { if (s.file2Path && fs.existsSync(s.file2Path)) fs.unlinkSync(s.file2Path); } catch {}
      await storage.deleteFileSubmission(s.id);
    }

    // Remove project folder
    try {
      const dir = path.join(uploadsDir, proj.folderName);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}

    await storage.deleteProject(id);
    const activeGroupIdStr = await storage.getSetting("active_group_project_id");
    if (activeGroupIdStr && parseInt(activeGroupIdStr) === id) await storage.setSetting("active_group_project_id", "");
    const activeFileIdStr = await storage.getSetting("active_file_project_id");
    if (activeFileIdStr && parseInt(activeFileIdStr) === id) await storage.setSetting("active_file_project_id", "");
    res.json({ message: "Project deleted" });
  } catch (err: any) {
    console.error("Delete project error:", err);
    res.status(500).json({ message: err.message || "Failed to delete" });
  }
});
