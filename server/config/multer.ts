import multer from "multer";
import path from "path";
import fs from "fs";
import { storage as db } from "../storage";

export const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export const DEFAULT_ALLOWED_MIMES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export const FILE_TYPE_OPTIONS: Record<string, { label: string; mimes: string[]; extensions: string }> = {
  pdf: { label: "PDF", mimes: ["application/pdf"], extensions: ".pdf" },
  ppt: { label: "PowerPoint (PPT/PPTX)", mimes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], extensions: ".ppt,.pptx" },
  doc: { label: "Word (DOC/DOCX)", mimes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], extensions: ".doc,.docx" },
  xls: { label: "Excel (XLS/XLSX)", mimes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], extensions: ".xls,.xlsx" },
  zip: { label: "ZIP Archive", mimes: ["application/zip", "application/x-zip-compressed"], extensions: ".zip" },
  image: { label: "Images (JPG/PNG/GIF)", mimes: ["image/jpeg", "image/png", "image/gif", "image/webp"], extensions: ".jpg,.jpeg,.png,.gif,.webp" },
  txt: { label: "Text (TXT)", mimes: ["text/plain"], extensions: ".txt" },
};

export async function getAllowedMimes(): Promise<string[]> {
  const setting = await db.getSetting("allowed_file_types");
  if (!setting) return DEFAULT_ALLOWED_MIMES;
  try {
    const types: string[] = JSON.parse(setting);
    const mimes: string[] = [];
    for (const t of types) {
      if (FILE_TYPE_OPTIONS[t]) mimes.push(...FILE_TYPE_OPTIONS[t].mimes);
    }
    return mimes.length > 0 ? mimes : DEFAULT_ALLOWED_MIMES;
  } catch {
    return DEFAULT_ALLOWED_MIMES;
  }
}

function safeName(original: string): string {
  return Date.now() + "-" + original.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/**
 * Public file uploader: respects the admin-configured max size and routes
 * uploads into the folder of the currently active project.
 */
export async function buildUploader(): Promise<multer.Multer> {
  const sizeStr = await db.getSetting("file_submission_max_size_mb");
  const sizeMb = Math.max(1, Math.min(100, parseInt(sizeStr || "5") || 5));
  let activeIdStr = await db.getSetting("active_file_project_id");
  if (!activeIdStr) activeIdStr = await db.getSetting("active_project_id");
  let destDir = uploadsDir;
  if (activeIdStr) {
    const proj = await db.getProjectById(parseInt(activeIdStr));
    if (proj) {
      destDir = path.join(uploadsDir, proj.folderName);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    }
  }
  const allowedMimes = await getAllowedMimes();
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => cb(null, safeName(file.originalname)),
    }),
    limits: { fileSize: sizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedMimes.includes(file.mimetype)) cb(null, true);
      else cb(new Error("This file type is not allowed.") as any, false);
    },
  });
}

/**
 * Admin file uploader: no type or size restrictions.
 * Routes uploads to the specified project folder (or active project, or root).
 */
export async function buildAdminUploader(projectIdOverride?: number): Promise<multer.Multer> {
  let destDir = uploadsDir;
  let chosenProjectId: number | null = null;
  if (projectIdOverride && !isNaN(projectIdOverride)) {
    chosenProjectId = projectIdOverride;
  } else {
    let activeIdStr = await db.getSetting("active_file_project_id");
    if (!activeIdStr) activeIdStr = await db.getSetting("active_project_id");
    if (activeIdStr) chosenProjectId = parseInt(activeIdStr);
  }
  if (chosenProjectId) {
    const proj = await db.getProjectById(chosenProjectId);
    if (proj) {
      destDir = path.join(uploadsDir, proj.folderName);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    }
  }
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => cb(null, safeName(file.originalname)),
    }),
    // Generous cap to prevent memory/disk exhaustion via the admin endpoint
    // while still allowing typical large attachments.
    limits: { fileSize: 200 * 1024 * 1024 },
  });
}
