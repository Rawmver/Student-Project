import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

// Import auth models to ensure they are available
export * from "./models/auth";

// Import chat models for AI integration
export * from "./models/chat";

// === TABLE DEFINITIONS ===

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
});

export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"), // Null for legacy groups (created before project scoping)
  // Random per-group token returned to the student on submit. The student
  // stores it in localStorage and presents it back to re-edit their group
  // before the deadline (no admin login required). Null on legacy rows.
  editToken: text("edit_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  topicId: integer("topic_id"),
  name: text("name").notNull(),
  studentId: text("student_id").notNull(), // Uniqueness now enforced per-project in app logic
  role: text("role", { enum: ["leader", "member"] }).notNull(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

// Single table for all short-lived auth artifacts:
//   purpose = "otp"     → 6-digit code emailed during admin 2FA login
//   purpose = "magic"   → long random token for "forgot password" magic link
//   purpose = "session" → long random token issued after successful 2FA / magic
//                         and used as the admin's bearer credential.
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  purpose: text("purpose", { enum: ["otp", "magic", "session"] }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuthCode = typeof authCodes.$inferSelect;

// === RELATIONS ===

export const topicsRelations = relations(topics, ({ many }) => ({
  members: many(members),
}));

export const groupsRelations = relations(groups, ({ many, one }) => ({
  members: many(members),
  project: one(projects, {
    fields: [groups.projectId],
    references: [projects.id],
  }),
}));

export const membersRelations = relations(members, ({ one }) => ({
  group: one(groups, {
    fields: [members.groupId],
    references: [groups.id],
  }),
  topic: one(topics, {
    fields: [members.topicId],
    references: [topics.id],
  }),
}));

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  folderName: text("folder_name").notNull(),
  status: text("status", { enum: ["active", "finalized"] }).notNull().default("active"),
  // Per-project submission deadline. Drives the countdown timer and the
  // server-side cutoff for both group and file submissions when set.
  // Null = no deadline; the legacy global `submission_deadline` setting is
  // used as a fallback for backward compatibility.
  deadline: timestamp("deadline"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// === STUDENT ACCOUNTS ===
// Opt-in registration for students. Enabled/disabled by admin toggle.
export const studentAccounts = pgTable("student_accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  studentId: text("student_id").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  semester: text("semester"),                   // e.g. "1"–"8", null = not set
  isVerified: boolean("is_verified").notNull().default(false),
  // SHA-256 hash of the raw token sent via email. Null once verified/expired.
  verificationToken: text("verification_token"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const studentSessions = pgTable("student_sessions", {
  id: serial("id").primaryKey(),
  studentAccountId: integer("student_account_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StudentAccount = typeof studentAccounts.$inferSelect;
export type StudentSession = typeof studentSessions.$inferSelect;

// === STUDENT CLOUD STORAGE ===
// Personal file/folder workspace for logged-in students.
export const studentFolders = pgTable("student_folders", {
  id: serial("id").primaryKey(),
  studentAccountId: integer("student_account_id").notNull().references(() => studentAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const studentFiles = pgTable("student_files", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id").references(() => studentFolders.id, { onDelete: "cascade" }),
  studentAccountId: integer("student_account_id").notNull().references(() => studentAccounts.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  submittedToProjectId: integer("submitted_to_project_id"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StudentFolder = typeof studentFolders.$inferSelect;
export type StudentFile = typeof studentFiles.$inferSelect;

// === ANNOUNCEMENTS ===
// Admin-posted notices shown on the student portal.
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  priority: text("priority", { enum: ["info", "warning", "important"] }).notNull().default("info"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Announcement = typeof announcements.$inferSelect;

// === CALENDAR EVENTS ===
// Admin-created events shown on the student portal calendar tab.
export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  eventType: text("event_type", { enum: ["assignment", "exam", "activity", "holiday", "other"] }).notNull().default("other"),
  eventDate: text("event_date").notNull(), // YYYY-MM-DD
  startTime: text("start_time"),           // HH:MM optional
  endTime: text("end_time"),               // HH:MM optional
  semester: text("semester").notNull().default("all"), // "all" or specific semester number
  filePath: text("file_path"),             // optional attachment
  fileName: text("file_name"),
  fileMimeType: text("file_mime_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type CalendarEvent = typeof calendarEvents.$inferSelect;

// === PUSH SUBSCRIPTIONS ===
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  studentAccountId: integer("student_account_id").notNull().references(() => studentAccounts.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// === STUDENT ↔ ADMIN MESSAGING ===
// Lets a logged-in student send a question / issue / feedback to the admin
// inbox. Admin can reply once; the reply becomes visible in the student's
// "Messages" tab and unread counts drive bell-badges on both sides.
export const studentMessages = pgTable("student_messages", {
  id: serial("id").primaryKey(),
  studentAccountId: integer("student_account_id").notNull().references(() => studentAccounts.id, { onDelete: "cascade" }),
  // Cached at send-time so the admin inbox renders cleanly even if the
  // student account is later renamed or deleted (FK cascade still wipes the row).
  studentName: text("student_name").notNull(),
  studentId: text("student_id").notNull(),
  studentEmail: text("student_email").notNull(),
  category: text("category", { enum: ["question", "issue", "feedback"] }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // Admin's single-shot reply. Null until answered.
  adminReply: text("admin_reply"),
  // True once the admin has opened/seen the message (drives admin-side unread badge).
  isReadByAdmin: boolean("is_read_by_admin").notNull().default(false),
  // False once admin replies, until student opens the messages tab (drives student-side badge).
  isReadByStudent: boolean("is_read_by_student").notNull().default(true),
  status: text("status", { enum: ["open", "replied", "closed"] }).notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  repliedAt: timestamp("replied_at"),
});

export const insertStudentMessageSchema = createInsertSchema(studentMessages).omit({
  id: true,
  studentAccountId: true,
  studentName: true,
  studentId: true,
  studentEmail: true,
  adminReply: true,
  isReadByAdmin: true,
  isReadByStudent: true,
  status: true,
  createdAt: true,
  repliedAt: true,
}).extend({
  subject: z.string().trim().min(2, "Subject must be at least 2 characters").max(200),
  body: z.string().trim().min(5, "Message must be at least 5 characters").max(4000),
  category: z.enum(["question", "issue", "feedback"]),
});
export type InsertStudentMessage = z.infer<typeof insertStudentMessageSchema>;
export type StudentMessage = typeof studentMessages.$inferSelect;

export const fileSubmissions = pgTable("file_submissions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  studentName: text("student_name").notNull(),
  studentId: text("student_id").notNull(),
  subject: text("subject").notNull().default(""),
  groupLeader: text("group_leader").notNull().default(""),
  topic: text("topic").notNull().default(""),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  file2Name: text("file2_name"),
  file2Path: text("file2_path"),
  file2Size: integer("file2_size"),
  file2MimeType: text("file2_mime_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fileSubmissionsRelations = relations(fileSubmissions, ({ one }) => ({
  project: one(projects, {
    fields: [fileSubmissions.projectId],
    references: [projects.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  submissions: many(fileSubmissions),
}));

export type Project = typeof projects.$inferSelect;
export type FileSubmission = typeof fileSubmissions.$inferSelect;
export type FileSubmissionWithProject = FileSubmission & { project: Project | null };

// === BASE SCHEMAS ===

export const insertGroupSchema = createInsertSchema(groups).omit({ 
  id: true, 
  createdAt: true 
});

export const insertMemberSchema = createInsertSchema(members).omit({ 
  id: true, 
  groupId: true 
});

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  role: text("role", { enum: ["student", "admin"] }).notNull().default("student"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === EXPLICIT API CONTRACT TYPES ===

// Base types
export type Group = typeof groups.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type User = typeof users.$inferSelect;

// Request types
export const createGroupRequestSchema = z.object({
  leader: insertMemberSchema.extend({ role: z.literal("leader") }).optional(),
  members: z.array(insertMemberSchema.extend({ role: z.literal("member") })),
});

export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

// Response types
export type MemberWithTopic = Member & { topic: Topic | null };
export type GroupWithMembers = Group & {
  members: MemberWithTopic[];
  project?: Project | null;
  // 1-based serial within a project (computed at read time, oldest = 1).
  projectSerial?: number;
};
export type StatsResponse = {
  totalGroups: number;
  totalStudents: number;
};
