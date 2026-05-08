/**
 * Group service — all business logic around creating and updating groups.
 * Routes call these functions; they should contain zero Express req/res references.
 */
import crypto from "crypto";
import { storage } from "../storage";
import type { CreateGroupRequest } from "@shared/schema";

export type GroupCreationContext = {
  isAdmin: boolean;
  isStaffOverride: boolean;
  projectIdParam?: string;
};

export type ProjectResolutionResult =
  | { ok: true; projectId: number | null }
  | { ok: false; status: number; message: string };

/**
 * Resolve which project a new group submission should be scoped to.
 * Respects admin overrides, active project pointer, deadline, and finalized status.
 */
export async function resolveTargetProject(ctx: GroupCreationContext): Promise<ProjectResolutionResult> {
  const { isAdmin, isStaffOverride, projectIdParam } = ctx;
  const queryProjectId = projectIdParam && projectIdParam !== "none" ? parseInt(projectIdParam) : undefined;
  const wantsNoProject = projectIdParam === "none";
  const activeIdStr = await storage.getSetting("active_group_project_id") || await storage.getSetting("active_project_id");
  const activeId = activeIdStr ? parseInt(activeIdStr) : NaN;

  if (isStaffOverride && wantsNoProject) return { ok: true, projectId: null };

  if (isStaffOverride && queryProjectId && !isNaN(queryProjectId)) {
    const p = await storage.getProjectById(queryProjectId);
    if (!p) return { ok: false, status: 404, message: "Project not found" };
    return { ok: true, projectId: p.id };
  }

  if (!isNaN(activeId)) {
    const p = await storage.getProjectById(activeId);
    if (!p) {
      if (!isAdmin) return { ok: false, status: 403, message: "Group submissions are not currently accepted. Please ask the admin to start a project." };
      return { ok: true, projectId: null };
    }
    if (!isAdmin && p.status === "finalized") {
      return { ok: false, status: 403, message: "This project has been closed and is no longer accepting group submissions." };
    }
    return { ok: true, projectId: p.id };
  }

  if (!isAdmin) return { ok: false, status: 403, message: "Group submissions are not currently accepted. Please ask the admin to start a project." };
  return { ok: true, projectId: null };
}

/** Check whether the current time exceeds the effective deadline for a project. */
export async function isDeadlineExceeded(projectId: number | null): Promise<boolean> {
  let deadline: Date | null = null;
  if (projectId != null) {
    const proj = await storage.getProjectById(projectId);
    if (proj?.deadline) deadline = new Date(proj.deadline);
  }
  if (!deadline) {
    const s = await storage.getSetting("submission_deadline");
    if (s) deadline = new Date(s);
  }
  return !!deadline && new Date() > deadline;
}

/**
 * Validate and normalise a group payload against current admin settings.
 * Returns an error message string if invalid, or null if valid.
 */
export async function validateGroupPayload(
  input: CreateGroupRequest,
  isAdmin: boolean
): Promise<string | null> {
  const requireLeader = (await storage.getSetting("group_require_leader")) !== "false";
  const requireTopic = (await storage.getSetting("group_require_topic")) !== "false";
  const requiredMembersStr = (await storage.getSetting("required_members")) || "6";
  const requiredMembers = parseInt(requiredMembersStr);

  // Normalize all student IDs to UPPERCASE so lookups & duplicate-detection
  // are case-insensitive and storage stays consistent ("bus-24f-123" === "BUS-24F-123").
  if (input.leader?.studentId) input.leader.studentId = input.leader.studentId.trim().toUpperCase();
  input.members = input.members.map(m => ({ ...m, studentId: m.studentId ? m.studentId.trim().toUpperCase() : m.studentId }));

  if (!requireLeader) {
    input.leader = undefined;
  } else if (!input.leader?.name?.trim() || !input.leader?.studentId?.trim()) {
    return "Group leader name and student ID are required.";
  }

  if (!isAdmin && input.members.length !== requiredMembers) {
    return `Each group must have exactly ${requiredMembers} members.`;
  }

  if (!requireTopic) {
    if (input.leader) input.leader.topicId = null as any;
    input.members = input.members.map(m => ({ ...m, topicId: null as any }));
  } else {
    const topicsInGroup = [input.leader?.topicId, ...input.members.map(m => m.topicId)].filter(Boolean);
    if (!isAdmin && new Set(topicsInGroup).size !== topicsInGroup.length) {
      return "Each member in the group must select a unique topic.";
    }
  }

  return null;
}

/** Collect all student IDs from a group payload (leader + members). */
export function collectStudentIds(input: CreateGroupRequest): string[] {
  return [input.leader?.studentId, ...input.members.map(m => m.studentId)].filter((id): id is string => !!id);
}

/** Check for duplicate student IDs across the project. Returns the first duplicate or null. */
export async function findDuplicateStudentId(
  ids: string[],
  projectId: number | null,
  excludeGroupId?: number
): Promise<string | null> {
  for (const id of ids) {
    const exists = await storage.checkDuplicateStudentId(id, projectId, excludeGroupId);
    if (exists) return id;
  }
  return null;
}

/** Mint a per-group edit token (32 hex chars = 128 bits entropy). */
export function mintEditToken(): string {
  return crypto.randomBytes(16).toString("hex");
}
