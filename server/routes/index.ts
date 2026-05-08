/**
 * Route registry — assembles all domain routers and sets up Replit OIDC auth.
 * This is the single entry-point imported by server/index.ts.
 */
import { Express } from "express";
import { Server } from "http";
import { setupAuth } from "../replit_integrations/auth";

import { authRouter } from "./auth.routes";
import { groupsRouter } from "./groups.routes";
import { topicsRouter } from "./topics.routes";
import { projectsRouter } from "./projects.routes";
import { settingsRouter } from "./settings.routes";
import { studentsRouter } from "./students.routes";
import { filesRouter } from "./files.routes";
import { staffRouter } from "./staff.routes";
import { adminStudentsRouter } from "./admin-students.routes";
import { aiRouter } from "./ai.routes";
import { announcementsRouter } from "./announcements.routes";
import { studentStorageRouter } from "./student-storage.routes";
import { calendarRouter } from "./calendar.routes";
import { pushRouter } from "./push.routes";
import { credentialsRouter } from "./credentials.routes";
import { libraryRouter } from "./library.routes";
import { studyPlayRouter } from "./study-play.routes";
import { messagesRouter } from "./messages.routes";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Replit OIDC (provides /api/login, /api/logout, /api/auth/user, req.user)
  await setupAuth(app);

  // Mount all domain routers
  app.use(authRouter);
  app.use(groupsRouter);
  app.use(topicsRouter);
  app.use(projectsRouter);
  app.use(settingsRouter);
  app.use(studentsRouter);
  app.use(filesRouter);
  app.use(staffRouter);
  app.use(adminStudentsRouter);
  app.use(aiRouter);
  app.use(announcementsRouter);
  app.use(studentStorageRouter);
  app.use(calendarRouter);
  app.use(pushRouter);
  app.use(credentialsRouter);
  app.use(libraryRouter);
  app.use(studyPlayRouter);
  app.use(messagesRouter);

  return httpServer;
}
