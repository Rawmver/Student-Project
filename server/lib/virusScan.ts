import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getCred } from "./credentials";

/**
 * Virus / malware scanning for file uploads.
 *
 * Layered defenses (in order):
 *   1. Hard-blocked executable file extensions (always on, no API call).
 *   2. Magic-byte check for executable headers (MZ / ELF / Mach-O), so a
 *      renamed .exe-as-.pdf is still rejected.
 *   3. (If VIRUSTOTAL_API_KEY is set) full VirusTotal scan with ~70 AV engines.
 *
 * Returns a `{ safe, threat }` result. When `safe` is false, `threat` contains
 * a short user-facing reason string.
 */

export interface VirusScanResult {
  safe: boolean;
  threat?: string;
  scanner?: "extension" | "magic-bytes" | "virustotal" | "skipped" | "hash-unknown";
  /** True when local checks + hash lookup all passed but VT had no record of this hash.
   *  Caller should run runFullVtScan() in the background as a backstop. */
  needsBackgroundScan?: boolean;
}

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".dll", ".sys",
  ".vbs", ".vbe", ".wsf", ".wsh", ".ps1", ".psm1", ".jar", ".hta",
  ".jse", ".cpl", ".reg", ".lnk", ".pif", ".gadget", ".inf",
  ".app", ".deb", ".dmg", ".rpm", ".sh",
]);

function checkExtension(originalName: string): VirusScanResult {
  const ext = path.extname(originalName).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      safe: false,
      threat: `Files with the "${ext}" extension are not allowed because they may contain malware.`,
      scanner: "extension",
    };
  }
  return { safe: true };
}

function checkMagicBytes(localPath: string): VirusScanResult {
  let buf: Buffer;
  try {
    const fd = fs.openSync(localPath, "r");
    buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
  } catch {
    return { safe: true };
  }

  // Windows PE / DOS executable
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    return { safe: false, threat: "File appears to be a Windows executable disguised as another type.", scanner: "magic-bytes" };
  }
  // Linux ELF
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return { safe: false, threat: "File appears to be a Linux executable disguised as another type.", scanner: "magic-bytes" };
  }
  // Mach-O (macOS) — multiple variants
  const m32 = buf.readUInt32BE(0);
  if (m32 === 0xfeedface || m32 === 0xfeedfacf || m32 === 0xcefaedfe || m32 === 0xcffaedfe || m32 === 0xcafebabe) {
    return { safe: false, threat: "File appears to be a macOS executable disguised as another type.", scanner: "magic-bytes" };
  }
  return { safe: true };
}

// ── VirusTotal API v3 ────────────────────────────────────────────────────────

const VT_API = "https://www.virustotal.com/api/v3";
const VT_MAX_FILE_BYTES = 32 * 1024 * 1024;     // free-tier upload limit
const VT_POLL_INTERVAL_MS = 1500;
const VT_POLL_TIMEOUT_MS = 60_000;
const MIN_MALICIOUS_FOR_BLOCK = 2;               // require >= N engines to flag

function sha256OfFile(localPath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(localPath));
  return hash.digest("hex");
}

async function vtRequest(url: string, init: RequestInit, apiKey: string): Promise<any> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "x-apikey": apiKey,
      accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(`VirusTotal ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

/** Fast path: ask VT whether this exact file (by SHA-256) is already known. */
async function vtLookupByHash(
  hash: string,
  apiKey: string,
): Promise<VirusScanResult | null> {
  try {
    const result = await vtRequest(`${VT_API}/files/${hash}`, {}, apiKey);
    const stats = result?.data?.attributes?.last_analysis_stats || {};
    const malicious = Number(stats.malicious || 0);
    if (malicious >= MIN_MALICIOUS_FOR_BLOCK) {
      return {
        safe: false,
        threat: `This file appears to be infected. ${malicious} antivirus engine${malicious === 1 ? "" : "s"} flagged it as malicious.`,
        scanner: "virustotal",
      };
    }
    return { safe: true, scanner: "virustotal" };
  } catch (err: any) {
    // 404 = unknown file (need to upload). Other errors propagate.
    if (err?.status === 404) return null;
    throw err;
  }
}

async function scanWithVirusTotal(
  localPath: string,
  originalName: string,
  apiKey: string,
): Promise<VirusScanResult> {
  const stat = fs.statSync(localPath);
  if (stat.size > VT_MAX_FILE_BYTES) {
    // Too large for free tier; we already passed extension/magic-byte checks.
    console.warn(`[virus-scan] ${originalName} (${stat.size} bytes) exceeds VirusTotal limit; relying on extension/magic-byte checks only`);
    return { safe: true, scanner: "skipped" };
  }

  // 1. Upload
  const fileBuf = fs.readFileSync(localPath);
  const blob = new Blob([new Uint8Array(fileBuf)]);
  const form = new FormData();
  form.append("file", blob, originalName);
  const uploadResp = await vtRequest(`${VT_API}/files`, { method: "POST", body: form }, apiKey);
  const analysisId: string | undefined = uploadResp?.data?.id;
  if (!analysisId) throw new Error("VirusTotal upload returned no analysis id");

  // 2. Poll for analysis result
  const start = Date.now();
  while (Date.now() - start < VT_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, VT_POLL_INTERVAL_MS));
    const result = await vtRequest(`${VT_API}/analyses/${analysisId}`, {}, apiKey);
    const status = result?.data?.attributes?.status;
    if (status !== "completed") continue;

    const stats = result?.data?.attributes?.stats || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    if (malicious >= MIN_MALICIOUS_FOR_BLOCK) {
      return {
        safe: false,
        threat: `This file appears to be infected. ${malicious} antivirus engine${malicious === 1 ? "" : "s"} flagged it as malicious.`,
        scanner: "virustotal",
      };
    }
    if (suspicious >= MIN_MALICIOUS_FOR_BLOCK + 1) {
      return {
        safe: false,
        threat: `This file looks suspicious. ${suspicious} antivirus engines flagged it as suspicious.`,
        scanner: "virustotal",
      };
    }
    return { safe: true, scanner: "virustotal" };
  }

  // Timeout — be permissive but warn. Files that pass extension/magic byte
  // checks but time out at VT shouldn't block legitimate uploads.
  console.warn(`[virus-scan] VirusTotal poll timed out for ${originalName}; allowing upload`);
  return { safe: true, scanner: "skipped" };
}

/**
 * Scan a freshly-uploaded local file. Always runs cheap local checks first;
 * only calls VirusTotal if a key is configured and local checks pass.
 */
export async function scanFileForViruses(
  localPath: string,
  originalName: string,
): Promise<VirusScanResult> {
  const ext = checkExtension(originalName);
  if (!ext.safe) return ext;

  const magic = checkMagicBytes(localPath);
  if (!magic.safe) return magic;

  const apiKey = getCred("VIRUSTOTAL_API_KEY");
  if (!apiKey) return { safe: true, scanner: "skipped" };

  // SHA-256 hash lookup. Most legitimate files (PDFs, Office templates, common
  // images) are already in VT's database and resolve in well under a second.
  // Files VT has never seen are accepted optimistically and re-checked in the
  // background via runFullVtScan() (see routes/files.routes.ts).
  try {
    const hash = sha256OfFile(localPath);
    const cached = await vtLookupByHash(hash, apiKey);
    if (cached) return cached;
    return { safe: true, scanner: "hash-unknown", needsBackgroundScan: true };
  } catch (err: any) {
    console.error(`[virus-scan] VT hash lookup failed for ${originalName}:`, err?.message || err);
    return { safe: true, scanner: "skipped" };
  }
}

/**
 * Full VirusTotal upload + poll scan. Used as a background backstop for files
 * whose hash was not in VT's database at upload time. Returns a VirusScanResult.
 * Never throws — on error returns `{ safe: true, scanner: "skipped" }` and logs.
 */
export async function runFullVtScan(
  localPath: string,
  originalName: string,
): Promise<VirusScanResult> {
  const apiKey = getCred("VIRUSTOTAL_API_KEY");
  if (!apiKey) return { safe: true, scanner: "skipped" };
  try {
    return await scanWithVirusTotal(localPath, originalName, apiKey);
  } catch (err: any) {
    console.error(`[virus-scan] background VT scan failed for ${originalName}:`, err?.message || err);
    return { safe: true, scanner: "skipped" };
  }
}
