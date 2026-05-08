/**
 * Student cloud storage routes.
 * Students can create folders, upload files, download, delete, and submit to active projects.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { storage } from "../storage";

export const studentStorageRouter = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getStudentAccount(authHeader: string | undefined) {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const result = await storage.findStudentSession(token);
  return result?.account ?? null;
}

// ── Upload directory ──────────────────────────────────────────────────────────
const STUDENT_STORAGE_DIR = path.resolve("uploads", "student-storage");
if (!fs.existsSync(STUDENT_STORAGE_DIR)) fs.mkdirSync(STUDENT_STORAGE_DIR, { recursive: true });

function getStudentDir(accountId: number): string {
  const dir = path.join(STUDENT_STORAGE_DIR, String(accountId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ── Folders ───────────────────────────────────────────────────────────────────

studentStorageRouter.get("/api/student/storage/folders", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const folders = await storage.getStudentFolders(account.id);
  res.json(folders);
});

studentStorageRouter.post("/api/student/storage/folders", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "Folder name is required" });
  }
  const folder = await storage.createStudentFolder(account.id, name.trim().slice(0, 80));
  res.status(201).json(folder);
});

studentStorageRouter.delete("/api/student/storage/folders/:id", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid folder ID" });
  await storage.deleteStudentFolder(id, account.id);
  res.json({ message: "Folder deleted" });
});

// ── Files ─────────────────────────────────────────────────────────────────────

studentStorageRouter.get("/api/student/storage/folders/:folderId/files", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const rawFolderId = String(req.params.folderId);
  const folderId = rawFolderId === "root" ? null : parseInt(rawFolderId);
  const files = await storage.getFilesInFolder(folderId, account.id);
  res.json(files);
});

studentStorageRouter.post("/api/student/storage/folders/:folderId/files", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });

  const rawFolderId = String(req.params.folderId);
  const folderId = rawFolderId === "root" ? null : parseInt(rawFolderId);
  const destDir = getStudentDir(account.id);

  const uploader = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: MAX_FILE_SIZE },
  }).single("file");

  uploader(req, res, async (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "File is too large (max 20 MB)" });
      return res.status(400).json({ message: err.message || "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ message: "No file provided" });

    const file = await storage.createStudentFile(
      account.id,
      folderId,
      req.file.originalname,
      req.file.path,
      req.file.mimetype,
      req.file.size,
    );
    res.status(201).json(file);
  });
});

studentStorageRouter.delete("/api/student/storage/files/:id", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid file ID" });
  const deleted = await storage.deleteStudentFile(id, account.id);
  if (!deleted) return res.status(404).json({ message: "File not found" });
  res.json({ message: "File deleted" });
});

studentStorageRouter.get("/api/student/storage/files/:id/download", async (req, res) => {
  const rawToken = typeof req.query._token === "string" ? req.query._token : undefined;
  const authHeader = req.headers.authorization || (rawToken ? `Bearer ${rawToken}` : undefined);
  const account = await getStudentAccount(authHeader);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid file ID" });
  const file = await storage.getStudentFile(id, account.id);
  if (!file) return res.status(404).json({ message: "File not found" });
  if (!fs.existsSync(file.storedPath)) return res.status(404).json({ message: "File not found on disk" });
  res.download(file.storedPath, file.originalName);
});

studentStorageRouter.post("/api/student/storage/files/:id/submit", async (req, res) => {
  const account = await getStudentAccount(req.headers.authorization);
  if (!account) return res.status(401).json({ message: "Not authenticated" });
  const id = parseInt(String(req.params.id));
  const { projectId } = req.body;
  if (isNaN(id) || !projectId) return res.status(400).json({ message: "Invalid parameters" });
  const file = await storage.submitStudentFile(id, account.id, parseInt(String(projectId)));
  if (!file) return res.status(404).json({ message: "File not found" });
  res.json(file);
});
