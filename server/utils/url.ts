/**
 * Returns a trusted base URL for constructing emailed links.
 * We deliberately do NOT read X-Forwarded-Host / Host headers to prevent
 * host-header injection / token exfiltration attacks.
 *
 * Resolution order:
 *   1) APP_BASE_URL  (explicit override, e.g. https://my-app.example.com)
 *   2) https://${REPLIT_DEPLOYMENT_DOMAIN}  — set on published deployments
 *   3) https://${REPLIT_DOMAINS.split(",")[0]}  — set in Replit dev/preview
 *   4) http://localhost:5000  — local fallback
 */
import { getCred } from "../lib/credentials";

export function getTrustedBaseUrl(): string {
  const override = getCred("APP_BASE_URL");
  if (override) return override.replace(/\/+$/, "");
  if (process.env.REPLIT_DEPLOYMENT_DOMAIN) return `https://${process.env.REPLIT_DEPLOYMENT_DOMAIN}`;
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return "http://localhost:5000";
}

/**
 * Sanitises a project name into a safe folder name.
 * Strips characters that are unsafe in paths, collapses runs of underscores,
 * and caps at 64 characters.
 */
export function sanitizeFolder(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "project";
}
