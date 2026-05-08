import { db } from "./db";
import {
  groups,
  members,
  topics,
  users,
  settings,
  fileSubmissions,
  projects,
  authCodes,
  studentAccounts,
  studentSessions,
  studentFolders,
  studentFiles,
  announcements,
  calendarEvents,
  pushSubscriptions,
  type Group,
  type Member,
  type Topic,
  type CreateGroupRequest,
  type User,
  type GroupWithMembers,
  type FileSubmission,
  type Project,
  type FileSubmissionWithProject,
  type AuthCode,
  type StudentAccount,
  type StudentSession,
  type StudentFolder,
  type StudentFile,
  type PushSubscription as PushSub,
  type Announcement,
  type CalendarEvent,
  studentMessages,
  type StudentMessage,
} from "@shared/schema";
import fs from "fs";

import { eq, sql, and, gt, lt, or } from "drizzle-orm";
import crypto from "crypto";

// All auth_codes.code values are stored as SHA-256 hex digests.
// Raw codes/tokens (6-digit OTP or 24-byte URL-safe token) are hashed on
// insert and on lookup. They are never persisted in plaintext.
function hashAuthCode(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export interface IStorage {

  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: any): Promise<User>;

  // Groups (project-scoped)
  createGroup(groupData: CreateGroupRequest, projectId?: number | null, editToken?: string | null): Promise<Group>;
  // Resolve a group strictly by its (id, editToken) pair — used by the
  // student-facing "re-edit my submission" flow.
  getGroupByIdAndToken(id: number, editToken: string): Promise<GroupWithMembers | undefined>;
  updateGroup(groupId: number, data: CreateGroupRequest): Promise<void>;
  getGroupById(id: number): Promise<GroupWithMembers | undefined>;
  getGroups(projectId?: number | null | "all"): Promise<GroupWithMembers[]>;
  deleteGroup(id: number): Promise<void>;

  // Topics
  getTopics(): Promise<Topic[]>;
  createTopic(name: string, description?: string): Promise<Topic>;
  updateTopic(id: number, name: string, description?: string): Promise<Topic>;
  deleteTopic(id: number): Promise<void>;
  isTopicTaken(topicId: number, projectId?: number | null): Promise<boolean>;
  isTopicAllowedForClass(topicId: number): Promise<boolean>;
  getTakenTopicIds(projectId?: number | null): Promise<number[]>;

  // Validation (project-scoped)
  checkDuplicateStudentId(studentId: string, projectId: number | null, excludeGroupId?: number): Promise<boolean>;

  // Settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;

  getStats(): Promise<{ totalGroups: number; totalStudents: number }>;

  // Projects
  createProject(name: string, folderName: string, deadline?: Date | null): Promise<Project>;
  getProjects(): Promise<Project[]>;
  getProjectById(id: number): Promise<Project | undefined>;
  finalizeProject(id: number): Promise<void>;
  deleteProject(id: number): Promise<void>;
  updateProjectDeadline(id: number, deadline: Date | null): Promise<void>;

  // Auth codes (OTP, magic link, session token).
  createAuthCode(rawCode: string, purpose: "otp" | "magic" | "session", ttlSeconds: number): Promise<AuthCode>;
  redeemAuthCode(rawCode: string, purpose: "otp" | "magic"): Promise<AuthCode | undefined>;
  findValidSession(rawToken: string): Promise<AuthCode | undefined>;
  cleanupExpiredAuthCodes(): Promise<void>;

  // Student accounts
  getStudentByStudentId(studentId: string, verifiedOnly?: boolean): Promise<StudentAccount | undefined>;
  getStudentByEmail(email: string, verifiedOnly?: boolean): Promise<StudentAccount | undefined>;
  getStudentById(id: number): Promise<StudentAccount | undefined>;
  getStudentByVerificationToken(tokenHash: string): Promise<StudentAccount | undefined>;
  deleteUnverifiedStudentsByIdentifiers(studentId: string, email: string): Promise<void>;
  createStudentAccount(name: string, studentId: string, email: string, passwordHash: string, verificationToken: string, verificationTokenExpiresAt: Date, semester?: string): Promise<StudentAccount>;
  verifyStudentAccount(id: number): Promise<void>;
  createStudentSession(studentAccountId: number, rawToken: string, ttlDays?: number): Promise<StudentSession>;
  findStudentSession(rawToken: string): Promise<{ session: StudentSession; account: StudentAccount } | undefined>;
  deleteStudentSession(rawToken: string): Promise<void>;
  getAllStudentAccounts(): Promise<StudentAccount[]>;
  deleteStudentAccount(id: number): Promise<void>;

  // Student ↔ admin messages
  createStudentMessage(input: {
    studentAccountId: number;
    studentName: string;
    studentId: string;
    studentEmail: string;
    category: "question" | "issue" | "feedback";
    subject: string;
    body: string;
  }): Promise<StudentMessage>;
  listStudentMessagesByAccount(studentAccountId: number): Promise<StudentMessage[]>;
  listAllStudentMessages(): Promise<StudentMessage[]>;
  replyToStudentMessage(id: number, reply: string): Promise<StudentMessage | undefined>;
  markAllStudentMessagesReadByAdmin(): Promise<void>;
  markStudentMessagesReadByStudent(studentAccountId: number): Promise<void>;
  deleteStudentMessage(id: number): Promise<void>;

  // Announcements
  getAnnouncements(): Promise<Announcement[]>;
  createAnnouncement(title: string, content: string, priority: string): Promise<Announcement>;
  deleteAnnouncement(id: number): Promise<void>;

  // Student group lookup
  getGroupByStudentIdAndProject(studentId: string, projectId: number): Promise<GroupWithMembers | undefined>;
  getAllGroupsByStudentId(studentId: string): Promise<GroupWithMembers[]>;

  // Student cloud storage
  getStudentFolders(accountId: number): Promise<(StudentFolder & { fileCount: number })[]>;
  createStudentFolder(accountId: number, name: string): Promise<StudentFolder>;
  deleteStudentFolder(id: number, accountId: number): Promise<void>;
  getFilesInFolder(folderId: number | null, accountId: number): Promise<StudentFile[]>;
  createStudentFile(accountId: number, folderId: number | null, originalName: string, storedPath: string, mimeType: string, size: number): Promise<StudentFile>;
  deleteStudentFile(id: number, accountId: number): Promise<StudentFile | undefined>;
  getStudentFile(id: number, accountId: number): Promise<StudentFile | undefined>;
  submitStudentFile(id: number, accountId: number, projectId: number): Promise<StudentFile | undefined>;

  // Calendar events
  getCalendarEvents(semester?: string): Promise<CalendarEvent[]>;
  getCalendarEventById(id: number): Promise<CalendarEvent | undefined>;
  createCalendarEvent(data: { title: string; description?: string | null; eventType: string; eventDate: string; startTime?: string | null; endTime?: string | null; semester?: string }): Promise<CalendarEvent>;
  updateCalendarEvent(id: number, data: Partial<{ title: string; description: string | null; eventType: string; eventDate: string; startTime: string | null; endTime: string | null; semester: string; filePath: string | null; fileName: string | null; fileMimeType: string | null }>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: number): Promise<void>;

  // Push subscriptions
  savePushSubscription(studentAccountId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSub>;
  getPushSubscriptionsByStudent(studentAccountId: number): Promise<PushSub[]>;
  deletePushSubscription(endpoint: string): Promise<void>;
  deletePushSubscriptionOwned(endpoint: string, studentAccountId: number): Promise<void>;
  getAllPushSubscriptionsForSemester(semester: string): Promise<(PushSub & { semester: string | null })[]>;
}

export class DatabaseStorage implements IStorage {

  // =============================
  // USERS
  // =============================

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserById(id: string) {
    return this.getUser(id);
  }

  async getUserByEmail(email: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    return user;
  }

  async createUser(user: any): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // =============================
  // GROUPS
  // =============================

  async createGroup(groupData: CreateGroupRequest, projectId: number | null = null, editToken: string | null = null): Promise<Group> {
    return await db.transaction(async (tx) => {

      // Reuse the smallest available ID (so deleted slots get refilled).
      const existing = await tx.select({ id: groups.id }).from(groups);
      const usedIds = new Set(existing.map(r => r.id));
      let nextId = 1;
      while (usedIds.has(nextId)) nextId++;

      const [newGroup] = await tx
        .insert(groups)
        .values({ id: nextId, projectId, editToken })
        .returning();

      // Keep the serial sequence in sync with the highest existing id so
      // future plain inserts (without explicit id) won't collide.
      await tx.execute(
        sql`SELECT setval('groups_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${groups}), 1))`
      );

      const membersToInsert = [
        ...(groupData.leader ? [{ ...groupData.leader, groupId: newGroup.id }] : []),
        ...groupData.members.map((m: any) => ({
          ...m,
          groupId: newGroup.id,
        }))
      ];

      if (membersToInsert.length > 0) {
        await tx.insert(members).values(membersToInsert);
      }

      return newGroup;
    });
  }

  async updateGroup(groupId: number, data: CreateGroupRequest): Promise<void> {
    await db.transaction(async (tx) => {
      // Remove old members
      await tx.delete(members).where(eq(members.groupId, groupId));

      // Insert new members
      const membersToInsert = [
        ...(data.leader ? [{ ...data.leader, groupId }] : []),
        ...data.members.map((m: any) => ({ ...m, groupId }))
      ];
      if (membersToInsert.length > 0) {
        await tx.insert(members).values(membersToInsert);
      }
    });
  }

  async getGroupById(id: number): Promise<GroupWithMembers | undefined> {
    const [group] = await db.query.groups.findMany({
      where: eq(groups.id, id),
      with: {
        members: { with: { topic: true } },
        project: true,
      }
    });
    if (!group) return undefined;

    // Compute the project-relative serial for this single group by counting
    // siblings in the same project bucket (createdAt ASC, id ASC tie-break).
    const siblings = await db.query.groups.findMany({
      where: group.projectId == null
        ? sql`${groups.projectId} IS NULL`
        : eq(groups.projectId, group.projectId),
      columns: { id: true, createdAt: true },
    });
    const ascending = [...siblings].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.id - b.id;
    });
    const idx = ascending.findIndex(s => s.id === group.id);
    (group as any).projectSerial = idx >= 0 ? idx + 1 : undefined;

    return group as any;
  }

  async getGroups(projectId: number | null | "all" = "all"): Promise<GroupWithMembers[]> {
    const where =
      projectId === "all" ? undefined :
      projectId === null ? sql`${groups.projectId} IS NULL` :
      eq(groups.projectId, projectId);

    const results = await db.query.groups.findMany({
      where,
      with: {
        members: { with: { topic: true } },
        project: true,
      },
      orderBy: (groups, { desc }) => [desc(groups.createdAt)]
    });

    // Compute per-project serial numbers: oldest in a project = #1.
    // Groups without a project share a "no-project" bucket.
    const byProject = new Map<string, GroupWithMembers[]>();
    for (const g of results as GroupWithMembers[]) {
      const key = g.projectId == null ? "none" : String(g.projectId);
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(g);
    }
    for (const list of Array.from(byProject.values())) {
      // Sort ascending by createdAt (with id tie-breaker) to assign serials,
      // then write back. Stable, deterministic ordering.
      const ascending = [...list].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return a.id - b.id;
      });
      ascending.forEach((g, i) => { g.projectSerial = i + 1; });
    }
    return results as GroupWithMembers[];
  }

  async deleteGroup(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(members)
        .where(eq(members.groupId, id));

      await tx
        .delete(groups)
        .where(eq(groups.id, id));
    });
  }

  // =============================
  // TOPICS
  // =============================

  async getTopics(): Promise<Topic[]> {
    return await db.select().from(topics);
  }

  // ⭐ Class topic pool validation
  async isTopicAllowedForClass(topicId: number): Promise<boolean> {
    const result = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1);

    return result.length > 0;
  }

  async isTopicTaken(topicId: number, projectId: number | null = null): Promise<boolean> {
    // A topic is "taken" only within the same project scope. Different projects can reuse topics.
    const projectClause =
      projectId === null ? sql`${groups.projectId} IS NULL` : eq(groups.projectId, projectId);

    const result = await db
      .select({ id: members.id })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id))
      .where(and(eq(members.topicId, topicId), projectClause))
      .limit(1);

    return result.length > 0;
  }

  async getTakenTopicIds(projectId: number | null = null): Promise<number[]> {
    const projectClause =
      projectId === null ? sql`${groups.projectId} IS NULL` : eq(groups.projectId, projectId);

    const results = await db
      .select({ topicId: members.topicId })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id))
      .where(and(sql`${members.topicId} IS NOT NULL`, projectClause));

    return results.map(r => r.topicId as number);
  }

  async createTopic(name: string, description?: string): Promise<Topic> {
    const [topic] = await db
      .insert(topics)
      .values({ name, description })
      .returning();

    return topic;
  }

  async updateTopic(id: number, name: string, description?: string): Promise<Topic> {
    const [topic] = await db
      .update(topics)
      .set({ name, description })
      .where(eq(topics.id, id))
      .returning();

    if (!topic) throw new Error("Topic not found");
    return topic;
  }

  async deleteTopic(id: number): Promise<void> {
    await db.delete(topics).where(eq(topics.id, id));
  }

  // =============================
  // VALIDATION
  // =============================

  async checkDuplicateStudentId(
    studentId: string,
    projectId: number | null,
    excludeGroupId?: number
  ): Promise<boolean> {
    // Duplicates are scoped per project. A student ID may be reused across different projects.
    const projectClause =
      projectId === null ? sql`${groups.projectId} IS NULL` : eq(groups.projectId, projectId);

    const conditions = [eq(members.studentId, studentId), projectClause];
    if (excludeGroupId) conditions.push(sql`${members.groupId} != ${excludeGroupId}`);

    const result = await db
      .select({ id: members.id })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id))
      .where(and(...conditions))
      .limit(1);

    return result.length > 0;
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key));
    return setting?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== undefined) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  async deleteSetting(key: string): Promise<void> {
    await db.delete(settings).where(eq(settings.key, key));
  }

  async getStats(projectId: number | null | "all" = "all"): Promise<{ totalGroups: number; totalStudents: number }> {
    const groupWhere =
      projectId === "all" ? undefined :
      projectId === null ? sql`${groups.projectId} IS NULL` :
      eq(groups.projectId, projectId);

    const groupQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(groups);
    if (groupWhere) groupQuery.where(groupWhere);
    const [groupCount] = await groupQuery;

    const studentQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id));
    if (groupWhere) studentQuery.where(groupWhere);
    const [studentCount] = await studentQuery;

    return {
      totalGroups: Number(groupCount.count),
      totalStudents: Number(studentCount.count),
    };
  }

  // =============================
  // FILE SUBMISSIONS
  // =============================

  async createFileSubmission(data: {
    projectId?: number | null;
    studentName: string;
    studentId: string;
    subject: string;
    groupLeader?: string;
    topic?: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    file2Name?: string | null;
    file2Path?: string | null;
    file2Size?: number | null;
    file2MimeType?: string | null;
  }): Promise<FileSubmission> {
    const [submission] = await db.insert(fileSubmissions).values(data).returning();
    return submission;
  }

  async getFileSubmissions(): Promise<FileSubmissionWithProject[]> {
    const results = await db.query.fileSubmissions.findMany({
      with: { project: true },
      orderBy: (fs, { desc }) => [desc(fs.createdAt)],
    });
    return results as FileSubmissionWithProject[];
  }

  async deleteFileSubmission(id: number): Promise<void> {
    await db.delete(fileSubmissions).where(eq(fileSubmissions.id, id));
  }

  // =============================
  // PROJECTS
  // =============================

  async createProject(name: string, folderName: string, deadline: Date | null = null): Promise<Project> {
    const [project] = await db.insert(projects).values({ name, folderName, status: "active", deadline }).returning();
    return project;
  }

  async updateProjectDeadline(id: number, deadline: Date | null): Promise<void> {
    await db.update(projects).set({ deadline }).where(eq(projects.id, id));
  }

  async getGroupByIdAndToken(id: number, editToken: string): Promise<GroupWithMembers | undefined> {
    const [group] = await db.query.groups.findMany({
      where: and(eq(groups.id, id), eq(groups.editToken, editToken)),
      with: {
        members: { with: { topic: true } },
        project: true,
      },
    });
    return group as any;
  }

  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(sql`${projects.createdAt} desc`);
  }

  async getProjectById(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async finalizeProject(id: number): Promise<void> {
    await db.update(projects).set({ status: "finalized" }).where(eq(projects.id, id));
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // =============================
  // AUTH CODES (OTP / magic / session)
  // =============================

  async createAuthCode(rawCode: string, purpose: "otp" | "magic" | "session", ttlSeconds: number) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const [row] = await db
      .insert(authCodes)
      .values({ code: hashAuthCode(rawCode), purpose, expiresAt })
      .returning();
    return row;
  }

  // Atomic redemption for single-use codes (OTP, magic link). Two concurrent
  // requests cannot both succeed because the UPDATE only matches rows where
  // used=false; the loser sees no returned row.
  async redeemAuthCode(rawCode: string, purpose: "otp" | "magic") {
    const hash = hashAuthCode(rawCode);
    const [row] = await db
      .update(authCodes)
      .set({ used: true })
      .where(
        and(
          eq(authCodes.code, hash),
          eq(authCodes.purpose, purpose),
          eq(authCodes.used, false),
          gt(authCodes.expiresAt, new Date()),
        ),
      )
      .returning();
    return row;
  }

  // Reusable session lookup (does not mark used). Sessions remain valid until
  // they expire (or are revoked elsewhere).
  async findValidSession(rawToken: string) {
    const hash = hashAuthCode(rawToken);
    const [row] = await db
      .select()
      .from(authCodes)
      .where(
        and(
          eq(authCodes.code, hash),
          eq(authCodes.purpose, "session"),
          eq(authCodes.used, false),
          gt(authCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  }

  async cleanupExpiredAuthCodes() {
    await db.delete(authCodes).where(lt(authCodes.expiresAt, new Date()));
  }

  // =============================
  // STUDENT ACCOUNTS
  // =============================

  async getStudentByStudentId(studentId: string, verifiedOnly = false): Promise<StudentAccount | undefined> {
    const conds = [eq(studentAccounts.studentId, studentId)];
    if (verifiedOnly) conds.push(eq(studentAccounts.isVerified, true));
    const [account] = await db.select().from(studentAccounts).where(and(...conds));
    return account;
  }

  async getStudentByEmail(email: string, verifiedOnly = false): Promise<StudentAccount | undefined> {
    const conds = [eq(studentAccounts.email, email)];
    if (verifiedOnly) conds.push(eq(studentAccounts.isVerified, true));
    const [account] = await db.select().from(studentAccounts).where(and(...conds));
    return account;
  }

  async getStudentById(id: number): Promise<StudentAccount | undefined> {
    const [account] = await db.select().from(studentAccounts).where(eq(studentAccounts.id, id));
    return account;
  }

  async getStudentByVerificationToken(tokenHash: string): Promise<StudentAccount | undefined> {
    const now = new Date();
    const [account] = await db
      .select()
      .from(studentAccounts)
      .where(and(
        eq(studentAccounts.verificationToken, tokenHash),
        eq(studentAccounts.isVerified, false),
        sql`${studentAccounts.verificationTokenExpiresAt} > ${now}`,
      ))
      .limit(1);
    return account;
  }

  // Remove any unverified registrations that share the same studentId or email.
  // Called before inserting a new registration so the DB-level unique constraint
  // doesn't block re-registration attempts.
  async deleteUnverifiedStudentsByIdentifiers(studentId: string, email: string): Promise<void> {
    await db.delete(studentAccounts).where(
      and(
        eq(studentAccounts.isVerified, false),
        sql`(${studentAccounts.studentId} = ${studentId} OR ${studentAccounts.email} = ${email})`,
      ),
    );
  }

  async createStudentAccount(
    name: string,
    studentId: string,
    email: string,
    passwordHash: string,
    verificationToken: string,
    verificationTokenExpiresAt: Date,
    semester?: string,
  ): Promise<StudentAccount> {
    const [account] = await db
      .insert(studentAccounts)
      .values({ name, studentId, email, passwordHash, isVerified: false, verificationToken, verificationTokenExpiresAt, semester: semester || null })
      .returning();
    return account;
  }

  async verifyStudentAccount(id: number): Promise<void> {
    await db.update(studentAccounts)
      .set({ isVerified: true, verificationToken: null, verificationTokenExpiresAt: null })
      .where(eq(studentAccounts.id, id));
  }

  async createStudentSession(studentAccountId: number, rawToken: string, ttlDays = 30): Promise<StudentSession> {
    const tokenHash = hashAuthCode(rawToken);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const [session] = await db.insert(studentSessions).values({ studentAccountId, tokenHash, expiresAt }).returning();
    return session;
  }

  async findStudentSession(rawToken: string): Promise<{ session: StudentSession; account: StudentAccount } | undefined> {
    const tokenHash = hashAuthCode(rawToken);
    const [session] = await db
      .select()
      .from(studentSessions)
      .where(and(eq(studentSessions.tokenHash, tokenHash), gt(studentSessions.expiresAt, new Date())))
      .limit(1);
    if (!session) return undefined;
    const account = await this.getStudentById(session.studentAccountId);
    if (!account) return undefined;
    return { session, account };
  }

  async deleteStudentSession(rawToken: string): Promise<void> {
    const tokenHash = hashAuthCode(rawToken);
    await db.delete(studentSessions).where(eq(studentSessions.tokenHash, tokenHash));
  }

  async getAllStudentAccounts(): Promise<StudentAccount[]> {
    return db.select().from(studentAccounts).orderBy(studentAccounts.createdAt);
  }

  async deleteStudentAccount(id: number): Promise<void> {
    await db.delete(studentSessions).where(eq(studentSessions.studentAccountId, id));
    await db.delete(studentAccounts).where(eq(studentAccounts.id, id));
  }

  // =============================
  // ANNOUNCEMENTS
  // =============================

  // =============================
  // STUDENT MESSAGES
  // =============================

  async createStudentMessage(input: {
    studentAccountId: number;
    studentName: string;
    studentId: string;
    studentEmail: string;
    category: "question" | "issue" | "feedback";
    subject: string;
    body: string;
  }): Promise<StudentMessage> {
    const [row] = await db.insert(studentMessages).values({
      studentAccountId: input.studentAccountId,
      studentName: input.studentName,
      studentId: input.studentId,
      studentEmail: input.studentEmail,
      category: input.category,
      subject: input.subject,
      body: input.body,
      isReadByAdmin: false,
      isReadByStudent: true,
      status: "open",
    }).returning();
    return row;
  }

  async listStudentMessagesByAccount(studentAccountId: number): Promise<StudentMessage[]> {
    return db.select().from(studentMessages)
      .where(eq(studentMessages.studentAccountId, studentAccountId))
      .orderBy(sql`${studentMessages.createdAt} desc`);
  }

  async listAllStudentMessages(): Promise<StudentMessage[]> {
    return db.select().from(studentMessages)
      .orderBy(sql`${studentMessages.createdAt} desc`);
  }

  async replyToStudentMessage(id: number, reply: string): Promise<StudentMessage | undefined> {
    // Atomic single-shot guard: only update if no reply has been sent yet.
    // This prevents race conditions where two admins try to reply at the same time.
    const [row] = await db.update(studentMessages)
      .set({
        adminReply: reply,
        repliedAt: new Date(),
        status: "replied",
        isReadByStudent: false,  // student should see a fresh badge
        isReadByAdmin: true,     // admin obviously read it before replying
      })
      .where(and(eq(studentMessages.id, id), sql`${studentMessages.adminReply} IS NULL`))
      .returning();
    return row;
  }

  async markAllStudentMessagesReadByAdmin(): Promise<void> {
    await db.update(studentMessages)
      .set({ isReadByAdmin: true })
      .where(eq(studentMessages.isReadByAdmin, false));
  }

  async markStudentMessagesReadByStudent(studentAccountId: number): Promise<void> {
    await db.update(studentMessages)
      .set({ isReadByStudent: true })
      .where(and(
        eq(studentMessages.studentAccountId, studentAccountId),
        eq(studentMessages.isReadByStudent, false),
      ));
  }

  async deleteStudentMessage(id: number): Promise<void> {
    await db.delete(studentMessages).where(eq(studentMessages.id, id));
  }

  async getAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(announcements.createdAt);
  }

  async createAnnouncement(title: string, content: string, priority: string): Promise<Announcement> {
    const [ann] = await db
      .insert(announcements)
      .values({ title, content, priority: priority as "info" | "warning" | "important" })
      .returning();
    return ann;
  }

  async deleteAnnouncement(id: number): Promise<void> {
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  // =============================
  // STUDENT GROUP LOOKUP
  // =============================

  async getGroupByStudentIdAndProject(studentId: string, projectId: number): Promise<GroupWithMembers | undefined> {
    const rows = await db
      .select({ groupId: members.groupId })
      .from(members)
      .innerJoin(groups, eq(members.groupId, groups.id))
      .where(and(eq(members.studentId, studentId), eq(groups.projectId, projectId)))
      .limit(1);
    if (!rows.length) return undefined;
    return this.getGroupById(rows[0].groupId);
  }

  async getAllGroupsByStudentId(studentId: string): Promise<GroupWithMembers[]> {
    const rows = await db
      .select({ groupId: members.groupId })
      .from(members)
      .where(eq(members.studentId, studentId));
    if (!rows.length) return [];
    const results = await Promise.all(rows.map(r => this.getGroupById(r.groupId)));
    return results.filter(Boolean) as GroupWithMembers[];
  }

  // =============================
  // STUDENT CLOUD STORAGE
  // =============================

  async getStudentFolders(accountId: number): Promise<(StudentFolder & { fileCount: number })[]> {
    const folders = await db.select().from(studentFolders)
      .where(eq(studentFolders.studentAccountId, accountId))
      .orderBy(studentFolders.createdAt);
    const counts = await Promise.all(folders.map(async f => {
      const [row] = await db.select({ count: sql<number>`count(*)::int` })
        .from(studentFiles).where(eq(studentFiles.folderId, f.id));
      return { ...f, fileCount: row?.count ?? 0 };
    }));
    return counts;
  }

  async createStudentFolder(accountId: number, name: string): Promise<StudentFolder> {
    const [folder] = await db.insert(studentFolders).values({ studentAccountId: accountId, name }).returning();
    return folder;
  }

  async deleteStudentFolder(id: number, accountId: number): Promise<void> {
    // Delete files from disk first
    const files = await db.select().from(studentFiles)
      .where(and(eq(studentFiles.folderId, id), eq(studentFiles.studentAccountId, accountId)));
    for (const f of files) {
      try { fs.unlinkSync(f.storedPath); } catch {}
    }
    await db.delete(studentFolders).where(and(eq(studentFolders.id, id), eq(studentFolders.studentAccountId, accountId)));
  }

  async getFilesInFolder(folderId: number | null, accountId: number): Promise<StudentFile[]> {
    if (folderId === null) {
      return db.select().from(studentFiles)
        .where(and(eq(studentFiles.studentAccountId, accountId), sql`${studentFiles.folderId} IS NULL`))
        .orderBy(studentFiles.createdAt);
    }
    return db.select().from(studentFiles)
      .where(and(eq(studentFiles.folderId, folderId), eq(studentFiles.studentAccountId, accountId)))
      .orderBy(studentFiles.createdAt);
  }

  async createStudentFile(accountId: number, folderId: number | null, originalName: string, storedPath: string, mimeType: string, size: number): Promise<StudentFile> {
    const [file] = await db.insert(studentFiles).values({ studentAccountId: accountId, folderId, originalName, storedPath, mimeType, size }).returning();
    return file;
  }

  async deleteStudentFile(id: number, accountId: number): Promise<StudentFile | undefined> {
    const [file] = await db.select().from(studentFiles)
      .where(and(eq(studentFiles.id, id), eq(studentFiles.studentAccountId, accountId)));
    if (!file) return undefined;
    try { fs.unlinkSync(file.storedPath); } catch {}
    await db.delete(studentFiles).where(eq(studentFiles.id, id));
    return file;
  }

  async getStudentFile(id: number, accountId: number): Promise<StudentFile | undefined> {
    const [file] = await db.select().from(studentFiles)
      .where(and(eq(studentFiles.id, id), eq(studentFiles.studentAccountId, accountId)));
    return file;
  }

  async submitStudentFile(id: number, accountId: number, projectId: number): Promise<StudentFile | undefined> {
    const [file] = await db.update(studentFiles)
      .set({ submittedToProjectId: projectId, submittedAt: new Date() })
      .where(and(eq(studentFiles.id, id), eq(studentFiles.studentAccountId, accountId)))
      .returning();
    return file;
  }

  // =============================
  // CALENDAR EVENTS
  // =============================

  async getCalendarEvents(semester?: string): Promise<CalendarEvent[]> {
    if (semester && semester !== "all") {
      return db.select().from(calendarEvents)
        .where(or(eq(calendarEvents.semester, "all"), eq(calendarEvents.semester, semester)))
        .orderBy(calendarEvents.eventDate);
    }
    return db.select().from(calendarEvents).orderBy(calendarEvents.eventDate);
  }

  async getCalendarEventById(id: number): Promise<CalendarEvent | undefined> {
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    return event;
  }

  async createCalendarEvent(data: { title: string; description?: string | null; eventType: string; eventDate: string; startTime?: string | null; endTime?: string | null; semester?: string }): Promise<CalendarEvent> {
    const [event] = await db.insert(calendarEvents).values({
      title: data.title,
      description: data.description ?? null,
      eventType: data.eventType as CalendarEvent["eventType"],
      eventDate: data.eventDate,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      semester: data.semester || "all",
    }).returning();
    return event;
  }

  async updateCalendarEvent(id: number, data: Partial<{ title: string; description: string | null; eventType: string; eventDate: string; startTime: string | null; endTime: string | null; filePath: string | null; fileName: string | null; fileMimeType: string | null }>): Promise<CalendarEvent | undefined> {
    const [event] = await db.update(calendarEvents).set(data as any).where(eq(calendarEvents.id, id)).returning();
    return event;
  }

  async deleteCalendarEvent(id: number): Promise<void> {
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  }

  // =============================
  // PUSH SUBSCRIPTIONS
  // =============================

  async savePushSubscription(studentAccountId: number, endpoint: string, p256dh: string, auth: string): Promise<PushSub> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    const [sub] = await db.insert(pushSubscriptions).values({ studentAccountId, endpoint, p256dh, auth }).returning();
    return sub;
  }

  async getPushSubscriptionsByStudent(studentAccountId: number): Promise<PushSub[]> {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.studentAccountId, studentAccountId));
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async deletePushSubscriptionOwned(endpoint: string, studentAccountId: number): Promise<void> {
    await db.delete(pushSubscriptions).where(
      and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.studentAccountId, studentAccountId))
    );
  }

  async getAllPushSubscriptionsForSemester(semester: string): Promise<(PushSub & { semester: string | null })[]> {
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        studentAccountId: pushSubscriptions.studentAccountId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        createdAt: pushSubscriptions.createdAt,
        semester: studentAccounts.semester,
      })
      .from(pushSubscriptions)
      .innerJoin(studentAccounts, eq(pushSubscriptions.studentAccountId, studentAccounts.id));

    if (semester === "all") return rows;
    return rows.filter(r => r.semester === semester || r.semester === null);
  }
}

export const storage = new DatabaseStorage();