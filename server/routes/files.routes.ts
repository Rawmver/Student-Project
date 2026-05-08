/**
 * File submission routes — public upload and admin management.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import archiver from "archiver";
import { storage } from "../storage";
import { requireRole } from "../middlewares/auth";
import { buildUploader, buildAdminUploader, FILE_TYPE_OPTIONS, getAllowedMimes } from "../config/multer";
import { sanitizeFolder } from "../utils/url";
import {
  moveLocalFileToObjectStorage,
  getStoredFileStream,
  deleteStoredFile,
} from "../lib/fileStorage";
import { scanFileForViruses, runFullVtScan } from "../lib/virusScan";
import { convertFile, detectConvertibleKind, describeConvertibleKind, getAvailableTargetsForKind, type ConvertTarget } from "../lib/fileConvert";
import { notifyIfEnabled } from "../lib/notify";
import multer from "multer";
import os from "os";

/**
 * Snapshot a local file at `srcPath` to `srcPath + ".bg"` so the background
 * VirusTotal scan can keep using the bytes after `moveLocalFileToObjectStorage`
 * unlinks the original. Returns the snapshot path or null on failure.
 */
function snapshotForBackgroundScan(srcPath: string): string | null {
  try {
    const dst = `${srcPath}.bg`;
    fs.copyFileSync(srcPath, dst);
    return dst;
  } catch (err) {
    console.error("[virus-scan] failed to snapshot for background scan:", err);
    return null;
  }
}

/**
 * Fire-and-forget: run a full VirusTotal scan on a local copy of an uploaded
 * file. If it comes back malicious, delete the file from object storage and
 * remove the DB row. Always cleans up the local copy at the end.
 */
function scheduleBackgroundScan(
  localCopyPath: string,
  originalName: string,
  submissionId: number,
  storedObjectPaths: string[],
) {
  setImmediate(async () => {
    try {
      const result = await runFullVtScan(localCopyPath, originalName);
      if (!result.safe) {
        console.warn(`[virus-scan] BACKGROUND SCAN FLAGGED submission ${submissionId} (${originalName}): ${result.threat}`);
        for (const p of storedObjectPaths) { try { await deleteStoredFile(p); } catch (e) { console.error(e); } }
        try { await storage.deleteFileSubmission(submissionId); } catch (e) { console.error(e); }
        // Fan out to whichever notification channels the admin turned on
        // (Slack / Discord / Telegram). Gated by ALERT_ON_VIRUS_FLAGGED.
        notifyIfEnabled(
          "ALERT_ON_VIRUS_FLAGGED",
          `🚨 Virus flagged\nSubmission #${submissionId} — file "${originalName}" was deleted.\nReason: ${result.threat || "VirusTotal flagged"}`
        ).catch(() => {});
      }
    } finally {
      try { fs.unlinkSync(localCopyPath); } catch {}
    }
  });
}

export const filesRouter = Router();

// ─── Public: config for the student file-submit form ─────────────────────────
filesRouter.get("/api/file-submit/config", async (_req, res) => {
  try {
    const [enabled, maxSize, requireLeader, requireTopic, activeIdStr, title, subject, projTitle, deadline] =
      await Promise.all([
        storage.getSetting("file_submission_enabled"),
        storage.getSetting("file_submission_max_size_mb"),
        storage.getSetting("file_submission_require_leader"),
        storage.getSetting("file_submission_require_topic"),
        storage.getSetting("active_file_project_id").then(v => v || storage.getSetting("active_project_id")),
        storage.getSetting("file_submission_title"),
        storage.getSetting("file_submission_subject_label"),
        storage.getSetting("file_submission_project_title"),
        storage.getSetting("file_submission_deadline"),
      ]);
    let activeProject = null;
    if (activeIdStr) {
      const proj = await storage.getProjectById(parseInt(activeIdStr));
      if (proj?.status === "active") activeProject = proj;
    }
    const allowedTypeSetting = await storage.getSetting("allowed_file_types");
    let allowedTypeKeys = ["pdf", "ppt"];
    try { if (allowedTypeSetting) allowedTypeKeys = JSON.parse(allowedTypeSetting); } catch {}
    const acceptExtensions = allowedTypeKeys
      .filter(k => FILE_TYPE_OPTIONS[k])
      .map(k => FILE_TYPE_OPTIONS[k].extensions)
      .join(",");
    const allowedMimes = await getAllowedMimes();
    const typeLabels = allowedTypeKeys
      .filter(k => FILE_TYPE_OPTIONS[k])
      .map(k => FILE_TYPE_OPTIONS[k].label);

    res.json({
      enabled: enabled === "true",
      maxSizeMb: parseInt(maxSize || "5") || 5,
      requireLeader: requireLeader === "true",
      requireTopic: requireTopic === "true",
      activeProject,
      pageTitle: title || "",
      subjectHeading: subject || "",
      projectTitle: projTitle || "",
      deadline: deadline || "",
      acceptExtensions,
      allowedMimes,
      typeLabels,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load config" });
  }
});

// ─── Public: convert an unsupported file to PDF ─────────────────────────────
// Students who try to upload a DOCX / image / text file get bounced by the
// strict allowed-mime filter on /api/file-submit. Rather than send them off
// to a third-party converter, we accept the file here, run an in-process
// conversion, and stream back the resulting PDF — which they can then upload
// through the normal flow.
//
// Limits this endpoint deliberately enforces:
//   • Single file per request (no batch — the UI converts one at a time).
//   • 25 MB hard cap (independent of the project's max-size; a 25 MB DOCX
//     usually shrinks dramatically once converted).
//   • Only the formats fileConvert.ts knows about (jpg/png/txt/md/csv/docx).
//   • Virus scan runs on the input BEFORE conversion so we never process a
//     malicious payload through pdf-lib / mammoth.
const convertUploader = multer({
  dest: path.join(os.tmpdir(), "convert-uploads"),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const kind = detectConvertibleKind(file.originalname, file.mimetype);
    if (kind) cb(null, true);
    else cb(new Error("This file type cannot be converted. Supported: JPG, PNG, TXT, MD, CSV, DOCX.") as any, false);
  },
});

// Per-IP rate limit for the conversion endpoint. Conversion is CPU-heavy
// (mammoth + pdf-lib + virus scan) and the route is unauthenticated, so the
// generic /api limiter (500/15m) is too loose. 20 conversions per 10 minutes
// is plenty for a real student and quickly blocks abuse.
const CONVERT_RATE_WINDOW_MS = 10 * 60 * 1000;
const CONVERT_RATE_MAX = 20;
const convertRateBuckets = new Map<string, number[]>();
function checkConvertRate(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const times = (convertRateBuckets.get(ip) || []).filter(t => now - t < CONVERT_RATE_WINDOW_MS);
  if (times.length >= CONVERT_RATE_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((CONVERT_RATE_WINDOW_MS - (now - times[0])) / 1000) };
  }
  times.push(now);
  convertRateBuckets.set(ip, times);
  if (convertRateBuckets.size > 1000) {
    for (const [k, v] of convertRateBuckets) {
      if (!v.length || now - v[v.length - 1] > CONVERT_RATE_WINDOW_MS) convertRateBuckets.delete(k);
    }
  }
  return { ok: true };
}

// Sanitize a filename for use inside a Content-Disposition header. We strip
// CR/LF (header injection), quotes/backslashes (Content-Disposition quoting),
// path separators, and non-ASCII characters (some HTTP clients/proxies mangle
// them). For the non-ASCII case we also expose the original name via the
// RFC 5987 `filename*=` parameter so modern browsers still see the real name.
function safeAsciiFilename(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, "")
    .replace(/[\/\\"]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .trim();
  return cleaned || "converted";
}
function contentDisposition(name: string): string {
  const ascii = safeAsciiFilename(name);
  const utf8 = encodeURIComponent(name.replace(/[\r\n\t\x00-\x1f\x7f]/g, ""));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const VALID_TARGETS = new Set<ConvertTarget>(["pdf", "txt", "html", "docx", "xlsx", "pptx"]);

filesRouter.post("/api/file-submit/convert", (req: any, res) => {
  const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
  const rate = checkConvertRate(ip);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    return res.status(429).json({ message: `Too many conversions — please wait ${Math.ceil(rate.retryAfterSec / 60)} minute(s) and try again.` });
  }
  convertUploader.single("file")(req, res, async (uploadErr: any) => {
    const cleanup = () => { if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} } };
    try {
      if (uploadErr) {
        if (uploadErr.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "File too large to convert (25 MB max)." });
        return res.status(400).json({ message: uploadErr.message || "Upload failed." });
      }
      const f = req.file as Express.Multer.File | undefined;
      if (!f) return res.status(400).json({ message: "No file received." });

      // Virus scan the original before we let any parser touch it.
      const scan = await scanFileForViruses(f.path, f.originalname);
      if (!scan.safe) {
        cleanup();
        return res.status(400).json({ message: scan.threat || "This file appears to be infected." });
      }

      // Target format — defaults to "pdf" for back-compat with older clients.
      const targetRaw = String(req.query?.target || req.body?.target || "pdf").toLowerCase();
      if (!VALID_TARGETS.has(targetRaw as ConvertTarget)) {
        cleanup();
        return res.status(400).json({ message: `Unknown target format "${targetRaw}". Allowed: ${[...VALID_TARGETS].join(", ")}.` });
      }
      const target = targetRaw as ConvertTarget;

      const { bytes, outputName, mimeType } = await convertFile(f.path, f.originalname, target, f.mimetype);
      cleanup();
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", contentDisposition(outputName));
      res.setHeader("X-Converted-From", describeConvertibleKind(detectConvertibleKind(f.originalname, f.mimetype)!));
      res.setHeader("X-Converted-To", target);
      res.send(Buffer.from(bytes));
    } catch (err: any) {
      cleanup();
      console.error("[file-convert]", err);
      res.status(500).json({ message: err?.message || "Conversion failed." });
    }
  });
});

// ─── Public: list available conversion targets for a given input filename ─────
// The client uses this (or the static map below) to know which target buttons
// to show. Returning the spec lets the client also know the produced MIME so
// it can intersect with the admin's allowed-format list.
filesRouter.get("/api/file-submit/convert-targets", async (req, res) => {
  const filename = String(req.query?.filename || "");
  if (!filename) return res.status(400).json({ message: "filename query param is required." });
  const kind = detectConvertibleKind(filename);
  if (!kind) return res.json({ kind: null, targets: [] });
  res.json({ kind, targets: getAvailableTargetsForKind(kind) });
});

// ─── Public: submit a file ────────────────────────────────────────────────────
filesRouter.post("/api/file-submit", async (req: any, res) => {
  let uploader;
  try { uploader = await buildUploader(); } catch { return res.status(500).json({ message: "Upload init failed" }); }

  uploader.array("files", 2)(req, res, async (uploadErr: any) => {
    const cleanup = () => {
      if (Array.isArray(req.files)) { for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} } }
    };
    try {
      if (uploadErr) {
        if (uploadErr.code === "LIMIT_FILE_SIZE") {
          const sizeStr = await storage.getSetting("file_submission_max_size_mb");
          return res.status(400).json({ message: `File must be smaller than ${sizeStr || 5} MB.` });
        }
        return res.status(400).json({ message: uploadErr.message || "Upload failed." });
      }

      const enabled = await storage.getSetting("file_submission_enabled");
      if (enabled !== "true") { cleanup(); return res.status(403).json({ message: "File submissions are currently disabled." }); }

      const deadlineStr = await storage.getSetting("file_submission_deadline");
      if (deadlineStr) {
        const dl = new Date(deadlineStr);
        if (!isNaN(dl.getTime()) && new Date() > dl) { cleanup(); return res.status(403).json({ message: "The file submission deadline has passed." }); }
      }

      let activeIdStr = await storage.getSetting("active_file_project_id");
      if (!activeIdStr) activeIdStr = await storage.getSetting("active_project_id");
      let activeProject = null;
      if (activeIdStr) {
        const proj = await storage.getProjectById(parseInt(activeIdStr));
        if (proj?.status === "active") activeProject = proj;
      }
      if (!activeProject) { cleanup(); return res.status(403).json({ message: "There is no active project accepting submissions right now." }); }

      const requireLeader = (await storage.getSetting("file_submission_require_leader")) === "true";
      const requireTopic = (await storage.getSetting("file_submission_require_topic")) === "true";
      const { studentName, studentId, subject, groupLeader, topic } = req.body;
      if (!studentName?.trim()) { cleanup(); return res.status(400).json({ message: "Student name is required." }); }
      if (!studentId?.trim()) { cleanup(); return res.status(400).json({ message: "Student ID is required." }); }
      if (requireLeader && !groupLeader?.trim()) { cleanup(); return res.status(400).json({ message: "Group leader is required." }); }
      if (requireTopic && !topic?.trim()) { cleanup(); return res.status(400).json({ message: "Project topic is required." }); }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) { cleanup(); return res.status(400).json({ message: "At least one file is required." }); }
      if (files.length > 2) { cleanup(); return res.status(400).json({ message: "You can upload at most 2 files." }); }

      // Virus / malware scan before persisting (parallel for multi-file uploads)
      const scanResults = await Promise.all(
        files.map((f) => scanFileForViruses(f.path, f.originalname)),
      );
      const unsafeIdx = scanResults.findIndex((r) => !r.safe);
      if (unsafeIdx >= 0) {
        const bad = scanResults[unsafeIdx];
        cleanup();
        return res.status(400).json({
          message: `${bad.threat || "This file appears to be infected."} Please upload a different, clean file.`,
          infectedFile: files[unsafeIdx].originalname,
        });
      }

      // Snapshot bytes for any files that need a background backstop scan,
      // BEFORE moveLocalFileToObjectStorage unlinks the originals.
      const bgSnapshots: (string | null)[] = files.map((f, i) =>
        scanResults[i].needsBackgroundScan ? snapshotForBackgroundScan(f.path) : null
      );

      const uploadedObjectPaths: string[] = [];
      try {
        const [file1Path, file2Path] = await Promise.all([
          moveLocalFileToObjectStorage(files[0].path, files[0].originalname, files[0].mimetype),
          files[1]
            ? moveLocalFileToObjectStorage(files[1].path, files[1].originalname, files[1].mimetype)
            : Promise.resolve(null),
        ]);
        uploadedObjectPaths.push(file1Path);
        if (file2Path) uploadedObjectPaths.push(file2Path);

        const submission = await storage.createFileSubmission({
          projectId: activeProject.id,
          studentName: studentName.trim(), studentId: studentId.trim().toUpperCase(),
          subject: (subject || "").trim(), groupLeader: (groupLeader || "").trim(), topic: (topic || "").trim(),
          fileName: files[0].originalname, filePath: file1Path, fileSize: files[0].size, mimeType: files[0].mimetype,
          file2Name: files[1]?.originalname || null, file2Path: file2Path,
          file2Size: files[1]?.size || null, file2MimeType: files[1]?.mimetype || null,
        });
        res.status(201).json({ message: "Virus scan passed — your file has been uploaded successfully.", scanned: true });

        notifyIfEnabled(
          "ALERT_ON_NEW_SUBMISSION",
          `📥 New file submission\nFrom: ${studentName.trim()} (${studentId.trim().toUpperCase()})\nSubject: ${subject || "—"}\nFile: ${files[0].originalname}${files[1] ? ` + ${files[1].originalname}` : ""}`
        ).catch(() => {});

        // Kick off background scans for any files VT didn't already know about.
        for (let i = 0; i < files.length; i++) {
          if (bgSnapshots[i]) {
            scheduleBackgroundScan(bgSnapshots[i]!, files[i].originalname, submission.id, uploadedObjectPaths);
          }
        }
      } catch (innerErr) {
        // Compensating cleanup: remove any objects we already uploaded to GCS
        for (const p of uploadedObjectPaths) { await deleteStoredFile(p); }
        throw innerErr;
      }
    } catch (err: any) {
      console.error("File submit error:", err); cleanup();
      res.status(500).json({ message: err.message || "Upload failed." });
    }
  });
});

// ─── Admin: submit a file (no restrictions) ───────────────────────────────────
filesRouter.post("/api/admin/file-submit", requireRole("editor"), async (req: any, res) => {
  const queryProjectId = req.query.projectId ? parseInt(String(req.query.projectId)) : undefined;
  let uploader;
  try { uploader = await buildAdminUploader(queryProjectId); } catch { return res.status(500).json({ message: "Upload init failed" }); }

  uploader.array("files", 2)(req, res, async (uploadErr: any) => {
    const cleanup = () => {
      if (Array.isArray(req.files)) { for (const f of req.files) { try { fs.unlinkSync(f.path); } catch {} } }
    };
    try {
      if (uploadErr) return res.status(400).json({ message: uploadErr.message || "Upload failed." });
      const { studentName, studentId, subject, groupLeader, topic, projectId: bodyProjectId } = req.body;
      if (!studentName?.trim()) { cleanup(); return res.status(400).json({ message: "Student name is required." }); }
      if (!studentId?.trim()) { cleanup(); return res.status(400).json({ message: "Student ID is required." }); }

      let targetProjectId: number | null = null;
      const explicit = bodyProjectId ? parseInt(String(bodyProjectId)) : queryProjectId;
      if (explicit && !isNaN(explicit)) {
        const p = await storage.getProjectById(explicit);
        if (p) targetProjectId = p.id;
      } else {
        let activeIdStr = await storage.getSetting("active_file_project_id");
        if (!activeIdStr) activeIdStr = await storage.getSetting("active_project_id");
        if (activeIdStr) { const p = await storage.getProjectById(parseInt(activeIdStr)); if (p) targetProjectId = p.id; }
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) { cleanup(); return res.status(400).json({ message: "At least one file is required." }); }
      if (files.length > 2) { cleanup(); return res.status(400).json({ message: "You can upload at most 2 files." }); }

      // Virus / malware scan before persisting (parallel for multi-file uploads)
      const scanResults = await Promise.all(
        files.map((f) => scanFileForViruses(f.path, f.originalname)),
      );
      const unsafeIdx = scanResults.findIndex((r) => !r.safe);
      if (unsafeIdx >= 0) {
        const bad = scanResults[unsafeIdx];
        cleanup();
        return res.status(400).json({
          message: `${bad.threat || "This file appears to be infected."} Please upload a different, clean file.`,
          infectedFile: files[unsafeIdx].originalname,
        });
      }

      const bgSnapshots: (string | null)[] = files.map((f, i) =>
        scanResults[i].needsBackgroundScan ? snapshotForBackgroundScan(f.path) : null
      );

      const uploadedObjectPaths: string[] = [];
      try {
        const [file1Path, file2Path] = await Promise.all([
          moveLocalFileToObjectStorage(files[0].path, files[0].originalname, files[0].mimetype),
          files[1]
            ? moveLocalFileToObjectStorage(files[1].path, files[1].originalname, files[1].mimetype)
            : Promise.resolve(null),
        ]);
        uploadedObjectPaths.push(file1Path);
        if (file2Path) uploadedObjectPaths.push(file2Path);

        const submission = await storage.createFileSubmission({
          projectId: targetProjectId,
          studentName: studentName.trim(), studentId: studentId.trim().toUpperCase(),
          subject: (subject || "").trim(), groupLeader: (groupLeader || "").trim(), topic: (topic || "").trim(),
          fileName: files[0].originalname, filePath: file1Path, fileSize: files[0].size, mimeType: files[0].mimetype,
          file2Name: files[1]?.originalname || null, file2Path: file2Path,
          file2Size: files[1]?.size || null, file2MimeType: files[1]?.mimetype || null,
        });
        res.status(201).json({ message: "Virus scan passed — file uploaded successfully.", scanned: true });

        notifyIfEnabled(
          "ALERT_ON_NEW_SUBMISSION",
          `📥 New file submission\nFrom: ${studentName.trim()} (${studentId.trim().toUpperCase()})\nSubject: ${subject || "—"}\nFile: ${files[0].originalname}${files[1] ? ` + ${files[1].originalname}` : ""}`
        ).catch(() => {});

        for (let i = 0; i < files.length; i++) {
          if (bgSnapshots[i]) {
            scheduleBackgroundScan(bgSnapshots[i]!, files[i].originalname, submission.id, uploadedObjectPaths);
          }
        }
      } catch (innerErr) {
        for (const p of uploadedObjectPaths) { await deleteStoredFile(p); }
        throw innerErr;
      }
    } catch (err: any) {
      console.error("Admin file submit error:", err); cleanup();
      res.status(500).json({ message: err.message || "Upload failed." });
    }
  });
});

// ─── Admin: list all file submissions ────────────────────────────────────────
filesRouter.get("/api/admin/file-submissions", requireRole("viewer", "editor", "downloader"), async (_req, res) => {
  try { res.json(await storage.getFileSubmissions()); }
  catch { res.status(500).json({ message: "Failed to fetch submissions" }); }
});

// ─── Admin: export as ZIP (must come before :id route) ───────────────────────
filesRouter.get("/api/admin/file-submissions/export-zip", requireRole("downloader", "editor"), async (req, res) => {
  try {
    const projectIdQ = req.query.projectId ? parseInt(String(req.query.projectId)) : null;
    const all = await storage.getFileSubmissions();
    const submissions = projectIdQ ? all.filter(s => s.projectId === projectIdQ) : all;

    let zipName = "file-submissions-export.zip";
    if (projectIdQ) {
      const proj = await storage.getProjectById(projectIdQ);
      if (proj) zipName = `${sanitizeFolder(proj.name)}-submissions.zip`;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    let aborted = false;
    archive.on("error", (err) => {
      console.error("[zip-export] archive error:", err);
      aborted = true;
      try { archive.abort(); } catch {}
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(err);
      }
    });
    res.on("close", () => {
      if (!res.writableEnded && !aborted) {
        aborted = true;
        try { archive.abort(); } catch {}
      }
    });
    archive.pipe(res);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("File Submissions");
    ws.columns = [
      { header: "#", key: "num", width: 6 }, { header: "Project", key: "project", width: 24 },
      { header: "Student Name", key: "studentName", width: 28 }, { header: "Student ID", key: "studentId", width: 18 },
      { header: "Group Leader", key: "groupLeader", width: 24 }, { header: "Topic", key: "topic", width: 26 },
      { header: "Subject", key: "subject", width: 24 }, { header: "File 1", key: "fileName", width: 32 },
      { header: "File 1 Size", key: "fileSize", width: 12 }, { header: "File 2", key: "file2Name", width: 32 },
      { header: "File 2 Size", key: "file2Size", width: 12 }, { header: "Submitted At", key: "createdAt", width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    submissions.forEach((sub: any, idx) => ws.addRow({
      num: idx + 1, project: sub.project?.name || "(no project)",
      studentName: sub.studentName, studentId: sub.studentId,
      groupLeader: sub.groupLeader || "", topic: sub.topic || "", subject: sub.subject || "",
      fileName: sub.fileName, fileSize: `${(sub.fileSize / 1024).toFixed(1)} KB`,
      file2Name: sub.file2Name || "", file2Size: sub.file2Size ? `${(sub.file2Size / 1024).toFixed(1)} KB` : "",
      createdAt: new Date(sub.createdAt).toLocaleString(),
    }));

    const excelBuffer = await workbook.xlsx.writeBuffer();
    archive.append(Buffer.from(excelBuffer), { name: "summary.xlsx" });

    const cleanName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
    let missingCount = 0;
    for (const sub of submissions as any[]) {
      const projectFolder = sub.project ? cleanName(sub.project.name) : "_no_project";
      const baseLabel = `${cleanName(sub.studentName)}_${cleanName(sub.studentId)}`;
      if (sub.filePath) {
        const stream = await getStoredFileStream(sub.filePath);
        if (stream) {
          const ext1 = path.extname(sub.fileName) || ".pdf";
          archive.append(stream, { name: `${projectFolder}/${baseLabel}${ext1}` });
        } else {
          missingCount++;
        }
      }
      if (sub.file2Path) {
        const stream2 = await getStoredFileStream(sub.file2Path);
        if (stream2) {
          const ext2 = path.extname(sub.file2Name || "") || ".pdf";
          archive.append(stream2, { name: `${projectFolder}/${baseLabel}_2${ext2}` });
        } else {
          missingCount++;
        }
      }
    }
    if (missingCount > 0) {
      const note = `${missingCount} file${missingCount === 1 ? "" : "s"} could not be included because they are missing from storage (likely uploaded before persistent storage was enabled).`;
      archive.append(Buffer.from(note, "utf8"), { name: "MISSING_FILES_README.txt" });
      console.warn(`[zip-export] ${missingCount} file(s) missing from storage`);
    }
    await archive.finalize();
  } catch (err) {
    console.error("ZIP export error:", err);
    if (!res.headersSent) res.status(500).json({ message: "ZIP export failed" });
  }
});

// ─── Admin: download a single file ───────────────────────────────────────────
filesRouter.get("/api/admin/file-submissions/:id/download", requireRole("downloader", "editor"), async (req, res) => {
  try {
    const fileNum = req.query.file === "2" ? 2 : 1;
    const submissions = await storage.getFileSubmissions();
    const sub = submissions.find(s => s.id === parseInt(String(req.params.id)));
    if (!sub) return res.status(404).json({ message: "Not found" });
    const fp = fileNum === 2 ? sub.file2Path : sub.filePath;
    const fn = fileNum === 2 ? sub.file2Name : sub.fileName;
    const mt = fileNum === 2 ? sub.file2MimeType : sub.mimeType;
    if (!fp || !fn) return res.status(404).json({ message: "File not present" });
    const stream = await getStoredFileStream(fp);
    if (!stream) return res.status(404).json({ message: "File missing from storage" });
    res.setHeader("Content-Type", mt || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fn.replace(/"/g, "")}"`);
    stream.on("error", () => { if (!res.headersSent) res.status(500).json({ message: "Download failed" }); });
    stream.pipe(res);
  } catch { res.status(500).json({ message: "Download failed" }); }
});

// ─── Admin: delete a submission ───────────────────────────────────────────────
filesRouter.delete("/api/admin/file-submissions/:id", requireRole("editor"), async (req, res) => {
  try {
    const submissions = await storage.getFileSubmissions();
    const sub = submissions.find(s => s.id === parseInt(String(req.params.id)));
    if (!sub) return res.status(404).json({ message: "Not found" });
    await deleteStoredFile(sub.filePath);
    await deleteStoredFile(sub.file2Path);
    await storage.deleteFileSubmission(sub.id);
    res.json({ message: "Deleted" });
  } catch { res.status(500).json({ message: "Delete failed" }); }
});

// ─── Excel export ─────────────────────────────────────────────────────────────
filesRouter.get("/api/export/excel", requireRole("downloader", "editor"), async (req, res) => {
  try {
    const filter = (() => {
      const raw = req.query.projectId;
      if (!raw || raw === "" || raw === "all") return "all" as const;
      if (raw === "none" || raw === "null") return null;
      const n = parseInt(String(raw));
      return isNaN(n) ? ("all" as const) : n;
    })();
    const groups = await storage.getGroups(filter);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Submissions");
    worksheet.columns = [
      { header: "Project", key: "project", width: 25 }, { header: "Group #", key: "groupSerial", width: 10 },
      { header: "Submission Date", key: "createdAt", width: 20 }, { header: "Role", key: "role", width: 10 },
      { header: "Student Name", key: "name", width: 25 }, { header: "Student ID", key: "studentId", width: 15 },
      { header: "Topic", key: "topic", width: 30 },
    ];
    groups.forEach((group: any) => {
      const serial = group.projectSerial ? String(group.projectSerial).padStart(2, "0") : String(group.id);
      group.members.forEach((member: any) => worksheet.addRow({
        project: group.project?.name || "(no project)", groupSerial: serial,
        createdAt: group.createdAt ? new Date(group.createdAt).toLocaleString() : "N/A",
        role: member.role, name: member.name, studentId: member.studentId, topic: member.topic?.name || "N/A",
      }));
    });

    let fileLabel = "submissions";
    if (typeof filter === "number") { const proj = await storage.getProjectById(filter); if (proj) fileLabel = `submissions-${proj.folderName}`; }
    else if (filter === null) { fileLabel = "submissions-no-project"; }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fileLabel}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).json({ message: "Excel export failed" });
  }
});
