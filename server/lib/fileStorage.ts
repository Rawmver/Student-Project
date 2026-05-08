import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { objectStorageClient } from "../replit_integrations/object_storage";

const OBJSTORE_PREFIX = "objstore:";

function getPrivateDir(): { bucket: string; prefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucket: trimmed, prefix: "" };
  return { bucket: trimmed.slice(0, slash), prefix: trimmed.slice(slash + 1) };
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export function isObjectStoragePath(p: string | null | undefined): boolean {
  return !!p && p.startsWith(OBJSTORE_PREFIX);
}

function parseObjectStoragePath(p: string): { bucket: string; objectName: string } {
  const without = p.slice(OBJSTORE_PREFIX.length);
  const slash = without.indexOf("/");
  if (slash === -1) throw new Error("Invalid object storage path");
  return { bucket: without.slice(0, slash), objectName: without.slice(slash + 1) };
}

/**
 * Upload a local file to object storage. Returns the storage path that should
 * be persisted in the DB. The local file is removed after a successful upload.
 */
export async function moveLocalFileToObjectStorage(
  localPath: string,
  originalName: string,
  contentType: string,
  subfolder: string = "file_submissions"
): Promise<string> {
  const { bucket, prefix } = getPrivateDir();
  const objectName = [
    prefix,
    subfolder,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName(originalName)}`,
  ]
    .filter(Boolean)
    .join("/");

  const writeStream = objectStorageClient
    .bucket(bucket)
    .file(objectName)
    .createWriteStream({ contentType, resumable: false });

  await pipeline(fs.createReadStream(localPath), writeStream);

  try { fs.unlinkSync(localPath); } catch {}

  return `${OBJSTORE_PREFIX}${bucket}/${objectName}`;
}

/**
 * Check if a stored file exists, regardless of whether it lives on disk or in
 * object storage.
 */
export async function storedFileExists(storedPath: string | null | undefined): Promise<boolean> {
  if (!storedPath) return false;
  if (isObjectStoragePath(storedPath)) {
    try {
      const { bucket, objectName } = parseObjectStoragePath(storedPath);
      const [exists] = await objectStorageClient.bucket(bucket).file(objectName).exists();
      return exists;
    } catch {
      return false;
    }
  }
  return fs.existsSync(storedPath);
}

/**
 * Get a Readable stream for a stored file (either local disk or object storage).
 * Returns null if the file does not exist.
 */
export async function getStoredFileStream(storedPath: string): Promise<Readable | null> {
  if (isObjectStoragePath(storedPath)) {
    const { bucket, objectName } = parseObjectStoragePath(storedPath);
    const file = objectStorageClient.bucket(bucket).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    return file.createReadStream();
  }
  if (!fs.existsSync(storedPath)) return null;
  return fs.createReadStream(storedPath);
}

/**
 * Delete a stored file (best-effort; ignores errors).
 */
export async function deleteStoredFile(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) return;
  try {
    if (isObjectStoragePath(storedPath)) {
      const { bucket, objectName } = parseObjectStoragePath(storedPath);
      await objectStorageClient.bucket(bucket).file(objectName).delete({ ignoreNotFound: true });
    } else if (fs.existsSync(storedPath)) {
      fs.unlinkSync(storedPath);
    }
  } catch {}
}

/**
 * Get content-type for a stored file (object storage only). Returns undefined
 * for local files (caller should use the DB's stored mimeType).
 */
export async function getStoredFileContentType(storedPath: string): Promise<string | undefined> {
  if (!isObjectStoragePath(storedPath)) return undefined;
  try {
    const { bucket, objectName } = parseObjectStoragePath(storedPath);
    const [metadata] = await objectStorageClient.bucket(bucket).file(objectName).getMetadata();
    return metadata.contentType || undefined;
  } catch {
    return undefined;
  }
}
