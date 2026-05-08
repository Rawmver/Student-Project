/**
 * Group routes — student submission, re-edit, and admin management.
 */
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { createGroupRequestSchema } from "@shared/schema";
import { checkCredentials, requireRole } from "../middlewares/auth";
import {
  resolveTargetProject,
  validateGroupPayload,
  collectStudentIds,
  findDuplicateStudentId,
  mintEditToken,
  isDeadlineExceeded,
} from "../services/group.service";

export const groupsRouter = Router();

// ─── Create group (public / admin) ───────────────────────────────────────────
groupsRouter.post("/api/groups", async (req, res) => {
  try {
    const input = createGroupRequestSchema.parse(req.body);
    const auth = await checkCredentials(req);
    const isAdmin = auth.valid && auth.isAdmin;
    const isStaffOverride = isAdmin || (auth.valid && !auth.isAdmin && (auth as any).role === "editor");

    const projectResult = await resolveTargetProject({
      isAdmin,
      isStaffOverride,
      projectIdParam: req.query.projectId != null ? String(req.query.projectId) : undefined,
    });
    if (!projectResult.ok) return res.status(projectResult.status).json({ message: projectResult.message });
    const { projectId: targetProjectId } = projectResult;

    const validationError = await validateGroupPayload(input, isAdmin);
    if (validationError) return res.status(400).json({ message: validationError });

    if (!isAdmin && await isDeadlineExceeded(targetProjectId)) {
      return res.status(403).json({ message: "Submission deadline has passed." });
    }

    const allIds = collectStudentIds(input);
    if (new Set(allIds).size !== allIds.length) {
      return res.status(400).json({ message: "Duplicate student IDs found" });
    }
    const dupId = await findDuplicateStudentId(allIds, targetProjectId);
    if (dupId) return res.status(409).json({ message: `Student ID ${dupId} is already registered in this project` });

    const editToken = mintEditToken();
    const group = await storage.createGroup(input, targetProjectId, editToken);
    res.status(201).json({ id: group.id, message: "Group submitted successfully", editToken, createdAt: group.createdAt });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Get group for re-edit (token-gated) ─────────────────────────────────────
groupsRouter.get("/api/groups/:id/edit", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const token = String(req.query.token || "");
    if (isNaN(id) || !token) return res.status(400).json({ message: "Missing id or token" });
    const group = await storage.getGroupByIdAndToken(id, token);
    if (!group) return res.status(404).json({ message: "Group not found or token invalid" });
    const deadline = group.project?.deadline
      ? new Date(group.project.deadline)
      : await storage.getSetting("submission_deadline").then(s => (s ? new Date(s) : null));
    res.json({
      id: group.id,
      projectId: group.projectId,
      createdAt: group.createdAt,
      deadline: deadline ? deadline.toISOString() : null,
      canEdit: !deadline || new Date() <= deadline,
      members: group.members.map(m => ({ name: m.name, studentId: m.studentId, role: m.role, topicId: m.topicId })),
    });
  } catch (err) {
    console.error("Get editable group error:", err);
    res.status(500).json({ message: "Failed to load group" });
  }
});

// ─── Update group (token-gated, public re-edit) ───────────────────────────────
groupsRouter.put("/api/groups/:id/edit", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid group id" });
    const token = String(req.body?.editToken || "");
    if (!token) return res.status(401).json({ message: "Missing edit token" });

    const existing = await storage.getGroupByIdAndToken(id, token);
    if (!existing) return res.status(404).json({ message: "Group not found or token invalid" });

    let effectiveDeadline: Date | null = null;
    if (existing.project?.deadline) effectiveDeadline = new Date(existing.project.deadline);
    if (!effectiveDeadline) {
      const s = await storage.getSetting("submission_deadline");
      if (s) effectiveDeadline = new Date(s);
    }
    if (effectiveDeadline && new Date() > effectiveDeadline) {
      return res.status(403).json({ message: "Deadline has passed — group can no longer be edited." });
    }

    const input = createGroupRequestSchema.parse(req.body.payload ?? req.body);
    const validationError = await validateGroupPayload(input, false);
    if (validationError) return res.status(400).json({ message: validationError });

    const allIds = collectStudentIds(input);
    if (new Set(allIds).size !== allIds.length) {
      return res.status(400).json({ message: "Duplicate student IDs found" });
    }
    const existingIds = new Set(existing.members.map(m => m.studentId));
    for (const sid of allIds) {
      if (existingIds.has(sid)) continue;
      const dup = await storage.checkDuplicateStudentId(sid, existing.projectId ?? null);
      if (dup) return res.status(409).json({ message: `Student ID ${sid} is already registered in this project` });
    }

    await storage.updateGroup(id, input);
    res.json({ message: "Group updated successfully" });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("Edit group error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── Update group (admin/editor) ─────────────────────────────────────────────
groupsRouter.put("/api/groups/:id", requireRole("editor"), async (req, res) => {
  try {
    const groupId = parseInt(String(req.params.id));
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
    const allIds = collectStudentIds(input);
    if (!isAdmin && new Set(allIds).size !== allIds.length) {
      return res.status(400).json({ message: "Duplicate student IDs inside group" });
    }
    if (!isAdmin) {
      const groupProjectId = (existingGroup as any).projectId ?? null;
      const dupId = await findDuplicateStudentId(allIds, groupProjectId, groupId);
      if (dupId) return res.status(409).json({ message: `Student ID ${dupId} already exists in this project` });
    }

    await storage.updateGroup(groupId, input);
    res.json({ message: "Group updated successfully" });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── List groups ──────────────────────────────────────────────────────────────
function parseProjectFilter(raw: any): number | null | "all" {
  if (raw === undefined || raw === null || raw === "") return "all";
  if (raw === "all") return "all";
  if (raw === "none" || raw === "null") return null;
  const n = parseInt(String(raw));
  return isNaN(n) ? "all" : n;
}

groupsRouter.get("/api/groups", requireRole("viewer", "editor", "downloader"), async (req, res) => {
  try {
    res.json(await storage.getGroups(parseProjectFilter(req.query.projectId)));
  } catch {
    res.status(500).json({ message: "Failed to fetch groups" });
  }
});

groupsRouter.get("/api/stats", requireRole("viewer", "editor", "downloader"), async (req, res) => {
  try {
    res.json(await storage.getStats(parseProjectFilter(req.query.projectId)));
  } catch {
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// ─── Delete group ─────────────────────────────────────────────────────────────
groupsRouter.delete("/api/admin/groups/:id", requireRole("editor"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid group id" });
    await storage.deleteGroup(id);
    res.json({ message: "Group deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete group" });
  }
});
