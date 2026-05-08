import { Router } from "express";
import { z } from "zod";
import webpush from "web-push";
import { requireAdmin } from "../middlewares/auth";
import {
  listCredentials,
  setCred,
  clearCred,
  getCred,
  getCredSource,
  CREDENTIAL_DEFS,
} from "../lib/credentials";
import { sendEmail, getActiveEmailProvider } from "../email";
import { notifyAdmins } from "../lib/notify";

export const credentialsRouter = Router();

const VALID_KEYS = new Set(CREDENTIAL_DEFS.map(d => d.key));

// ─── Core CRUD ────────────────────────────────────────────────────────────────

// List all editable credentials with metadata, source, and a masked preview.
// Raw secret values are NEVER returned — only their masked form.
credentialsRouter.get("/api/admin/credentials", requireAdmin, (_req, res) => {
  res.json({ credentials: listCredentials() });
});

// Set / overwrite a credential value (stored in DB; takes effect immediately).
credentialsRouter.patch("/api/admin/credentials/:key", requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (!VALID_KEYS.has(key)) return res.status(404).json({ message: "Unknown credential key" });

    const schema = z.object({ value: z.string().max(4096) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Body must be { value: string }" });

    await setCred(key, parsed.data.value.trim());
    res.json({ message: "Credential updated", key });
  } catch (err: any) {
    console.error("[credentials] update failed:", err?.message);
    res.status(500).json({ message: err?.message || "Failed to update credential" });
  }
});

// Clear the DB override; the env var (if any) becomes effective again.
credentialsRouter.delete("/api/admin/credentials/:key", requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (!VALID_KEYS.has(key)) return res.status(404).json({ message: "Unknown credential key" });
    await clearCred(key);
    res.json({ message: "Credential cleared", key });
  } catch (err: any) {
    console.error("[credentials] clear failed:", err?.message);
    res.status(500).json({ message: err?.message || "Failed to clear credential" });
  }
});

// ─── Reveal raw value (audit-logged) ─────────────────────────────────────────
// Admins commonly forget what they set; this lets them peek at the actual
// value once. We log who looked at what so it's traceable.
credentialsRouter.get("/api/admin/credentials/:key/reveal", requireAdmin, (req: any, res) => {
  const key = String(req.params.key);
  if (!VALID_KEYS.has(key)) return res.status(404).json({ message: "Unknown credential key" });
  const value = getCred(key);
  const adminId = req.user?.userId || req.user?.id || req.session?.adminId || "unknown-admin";
  console.log(`[credentials] AUDIT: admin "${adminId}" revealed "${key}" (source=${getCredSource(key)})`);
  res.json({ key, value, source: getCredSource(key), hasValue: value.length > 0 });
});

// ─── Test connectivity ───────────────────────────────────────────────────────
// Calls the provider with the currently effective value and reports whether
// the key works. Each provider gets its own lightweight probe — never a write.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

type ProbeResult = { ok: boolean; message: string; details?: any };

async function probeOpenAi(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.openai.com/v1/models?limit=1", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "OpenAI key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid or revoked." };
  if (r.status === 429) return { ok: false, message: "Key is rate-limited or out of credit." };
  return { ok: false, message: `OpenAI returned HTTP ${r.status}.` };
}
async function probeGemini(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {});
  if (r.ok) return { ok: true, message: "Gemini key is valid." };
  if (r.status === 400 || r.status === 403) return { ok: false, message: "Key is invalid or lacks permission." };
  return { ok: false, message: `Gemini returned HTTP ${r.status}.` };
}
async function probeYouTube(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=test&key=${encodeURIComponent(key)}`, {});
  if (r.ok) return { ok: true, message: "YouTube key is valid." };
  if (r.status === 400 || r.status === 403) return { ok: false, message: "Key is invalid, restricted, or quota exceeded." };
  return { ok: false, message: `YouTube returned HTTP ${r.status}.` };
}
async function probeResend(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Resend key is valid." };
  if (r.status === 401 || r.status === 403) return { ok: false, message: "Key is invalid or unauthorized." };
  return { ok: false, message: `Resend returned HTTP ${r.status}.` };
}
async function probeVirusTotal(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://www.virustotal.com/api/v3/users/me", { headers: { "x-apikey": key } });
  if (r.ok) return { ok: true, message: "VirusTotal key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  if (r.status === 429) return { ok: false, message: "Daily quota exhausted." };
  return { ok: false, message: `VirusTotal returned HTTP ${r.status}.` };
}
async function probeGoogleBooks(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1&key=${encodeURIComponent(key)}`, {});
  if (r.ok) return { ok: true, message: "Google Books key is valid." };
  if (r.status === 400 || r.status === 403) return { ok: false, message: "Key is invalid or restricted." };
  return { ok: false, message: `Google Books returned HTTP ${r.status}.` };
}

// ── Alternative AI providers ──
async function probeAnthropic(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (r.ok) return { ok: true, message: "Anthropic key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `Anthropic returned HTTP ${r.status}.` };
}
async function probeMistral(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Mistral key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `Mistral returned HTTP ${r.status}.` };
}
async function probeGroq(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Groq key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `Groq returned HTTP ${r.status}.` };
}
async function probeDeepseek(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.deepseek.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "DeepSeek key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `DeepSeek returned HTTP ${r.status}.` };
}
async function probeOpenRouter(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "OpenRouter key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `OpenRouter returned HTTP ${r.status}.` };
}
async function probeCohere(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.cohere.ai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Cohere key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `Cohere returned HTTP ${r.status}.` };
}
async function probeHuggingface(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://huggingface.co/api/whoami-v2", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Hugging Face token is valid." };
  if (r.status === 401) return { ok: false, message: "Token is invalid." };
  return { ok: false, message: `Hugging Face returned HTTP ${r.status}.` };
}

// ── Communications / payments / monitoring ──
async function probeSendgrid(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.sendgrid.com/v3/scopes", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "SendGrid key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `SendGrid returned HTTP ${r.status}.` };
}
async function probeTwilio(): Promise<ProbeResult> {
  const sid = getCred("TWILIO_ACCOUNT_SID");
  const token = getCred("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, message: "Both Account SID and Auth Token are required." };
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const r = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, { headers: { Authorization: `Basic ${auth}` } });
  if (r.ok) return { ok: true, message: "Twilio credentials are valid." };
  if (r.status === 401) return { ok: false, message: "Account SID or Auth Token is wrong." };
  return { ok: false, message: `Twilio returned HTTP ${r.status}.` };
}
async function probeStripe(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
  if (r.ok) return { ok: true, message: "Stripe key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `Stripe returned HTTP ${r.status}.` };
}
async function probeGithub(key: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json", "User-Agent": "credentials-test" },
  });
  if (r.ok) return { ok: true, message: "GitHub token is valid." };
  if (r.status === 401) return { ok: false, message: "Token is invalid or expired." };
  return { ok: false, message: `GitHub returned HTTP ${r.status}.` };
}
async function probeSupabase(key: string): Promise<ProbeResult> {
  const url = getCred("SUPABASE_URL");
  if (!url) return { ok: false, message: "Set SUPABASE_URL first." };
  const r = await fetchWithTimeout(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (r.ok || r.status === 200 || r.status === 404) return { ok: true, message: "Supabase URL + key reachable." };
  if (r.status === 401) return { ok: false, message: "Key is invalid for this project." };
  return { ok: false, message: `Supabase returned HTTP ${r.status}.` };
}
async function probePosthog(key: string): Promise<ProbeResult> {
  const host = getCred("POSTHOG_HOST") || "https://us.i.posthog.com";
  // /decide is the lightweight health endpoint; accepts the project API key.
  const r = await fetchWithTimeout(`${host.replace(/\/$/, "")}/decide/?v=3`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, distinct_id: "credential-test" }),
  });
  if (r.ok) return { ok: true, message: "PostHog project key is valid." };
  if (r.status === 401) return { ok: false, message: "Key is invalid." };
  return { ok: false, message: `PostHog returned HTTP ${r.status}.` };
}
async function probeMailgun(key: string): Promise<ProbeResult> {
  const domain = getCred("MAILGUN_DOMAIN");
  if (!domain) return { ok: false, message: "Set MAILGUN_DOMAIN first." };
  const auth = Buffer.from(`api:${key}`).toString("base64");
  const r = await fetchWithTimeout(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/stats/total?event=delivered`, { headers: { Authorization: `Basic ${auth}` } });
  if (r.ok) return { ok: true, message: "Mailgun credentials are valid." };
  if (r.status === 401) return { ok: false, message: "API key is invalid." };
  if (r.status === 404) return { ok: false, message: "Domain not found in this Mailgun account." };
  return { ok: false, message: `Mailgun returned HTTP ${r.status}.` };
}
async function probeSlackWebhook(url: string): Promise<ProbeResult> {
  // Slack returns 200 "ok" for valid webhooks; we can't easily test without
  // sending a message, so just verify the URL shape and reachable endpoint.
  if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]+/.test(url)) {
    return { ok: false, message: "URL doesn't look like a Slack webhook." };
  }
  return { ok: true, message: "Webhook URL has the expected Slack format (no message sent)." };
}
async function probeDiscordWebhook(url: string): Promise<ProbeResult> {
  // Discord webhooks support GET to inspect metadata without posting.
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\//.test(url)) {
    return { ok: false, message: "URL doesn't look like a Discord webhook." };
  }
  const r = await fetchWithTimeout(url, {});
  if (r.ok) return { ok: true, message: "Discord webhook is valid." };
  return { ok: false, message: `Discord returned HTTP ${r.status}.` };
}
async function probeTelegram(token: string): Promise<ProbeResult> {
  const r = await fetchWithTimeout(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, {});
  if (r.ok) return { ok: true, message: "Telegram bot token is valid." };
  if (r.status === 401 || r.status === 404) return { ok: false, message: "Token is invalid." };
  return { ok: false, message: `Telegram returned HTTP ${r.status}.` };
}
function probeVapid(): ProbeResult {
  const pub = getCred("VAPID_PUBLIC_KEY");
  const priv = getCred("VAPID_PRIVATE_KEY");
  const sub = getCred("VAPID_SUBJECT");
  if (!pub || !priv) return { ok: false, message: "Both public and private keys must be set." };
  if (!sub) return { ok: false, message: "VAPID_SUBJECT is missing (use 'mailto:you@example.com')." };
  try {
    webpush.setVapidDetails(sub, pub, priv);
    return { ok: true, message: "VAPID keypair is valid and applied." };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Invalid VAPID configuration." };
  }
}

const TESTABLE: Record<string, (value: string) => Promise<ProbeResult> | ProbeResult> = {
  // Original
  OPENAI_API_KEY: probeOpenAi,
  GEMINI_API_KEY: probeGemini,
  YOUTUBE_API_KEY: probeYouTube,
  RESEND_API_KEY: probeResend,
  VIRUSTOTAL_API_KEY: probeVirusTotal,
  GOOGLE_BOOKS_API_KEY: probeGoogleBooks,
  VAPID_PUBLIC_KEY: probeVapid,
  VAPID_PRIVATE_KEY: probeVapid,
  VAPID_SUBJECT: probeVapid,
  // Alternative AI
  ANTHROPIC_API_KEY: probeAnthropic,
  MISTRAL_API_KEY: probeMistral,
  GROQ_API_KEY: probeGroq,
  DEEPSEEK_API_KEY: probeDeepseek,
  OPENROUTER_API_KEY: probeOpenRouter,
  COHERE_API_KEY: probeCohere,
  HUGGINGFACE_API_KEY: probeHuggingface,
  // Comms / payments / monitoring / db
  SENDGRID_API_KEY: probeSendgrid,
  MAILGUN_API_KEY: probeMailgun,
  TWILIO_ACCOUNT_SID: probeTwilio,
  TWILIO_AUTH_TOKEN: probeTwilio,
  STRIPE_SECRET_KEY: probeStripe,
  GITHUB_TOKEN: probeGithub,
  SUPABASE_ANON_KEY: probeSupabase,
  SUPABASE_SERVICE_KEY: probeSupabase,
  POSTHOG_API_KEY: probePosthog,
  SLACK_WEBHOOK_URL: probeSlackWebhook,
  DISCORD_WEBHOOK_URL: probeDiscordWebhook,
  TELEGRAM_BOT_TOKEN: probeTelegram,
};

credentialsRouter.post("/api/admin/credentials/:key/test", requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    if (!VALID_KEYS.has(key)) return res.status(404).json({ message: "Unknown credential key" });
    const probe = TESTABLE[key];
    if (!probe) return res.json({ ok: false, testable: false, message: "This credential cannot be auto-tested." });
    const value = getCred(key);
    if (!value) return res.json({ ok: false, testable: true, message: "No value set." });

    const start = Date.now();
    const result = await probe(value);
    res.json({ ...result, testable: true, latencyMs: Date.now() - start });
  } catch (err: any) {
    res.status(500).json({ ok: false, testable: true, message: err?.message || "Test failed unexpectedly." });
  }
});

// ─── Generate VAPID keypair ──────────────────────────────────────────────────
// Spares admins from running a CLI. Optionally applies the new keys
// immediately (warning: invalidates every existing push subscription).
credentialsRouter.post("/api/admin/credentials/vapid/generate", requireAdmin, async (req, res) => {
  try {
    const apply = req.body?.apply === true;
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const keys = webpush.generateVAPIDKeys();
    if (apply) {
      await setCred("VAPID_PUBLIC_KEY", keys.publicKey);
      await setCred("VAPID_PRIVATE_KEY", keys.privateKey);
      if (subject) await setCred("VAPID_SUBJECT", subject);
    }
    res.json({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      applied: apply,
      warning: apply ? "Existing student push subscriptions are now invalidated and must be re-registered." : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to generate VAPID keypair." });
  }
});

// ─── Feature health summary ──────────────────────────────────────────────────
// Single call that powers a status widget: which features are fully working,
// degraded (e.g. has fallback) or down (no key at all).
credentialsRouter.get("/api/admin/credentials/health", requireAdmin, (_req, res) => {
  const has = (k: string) => getCred(k).length > 0;
  const useReplitAi = (getCred("USE_REPLIT_AI") || "").toLowerCase() === "true";
  type Status = "ok" | "degraded" | "down";
  const features: { name: string; status: Status; reason: string }[] = [];

  // AI features
  if (useReplitAi) features.push({ name: "AI (Play Room, Assistant, Virtual Room)", status: "ok", reason: "Using Replit built-in AI." });
  else if (has("OPENAI_API_KEY") && has("GEMINI_API_KEY")) features.push({ name: "AI (Play Room, Assistant, Virtual Room)", status: "ok", reason: "OpenAI primary, Gemini fallback." });
  else if (has("OPENAI_API_KEY")) features.push({ name: "AI (Play Room, Assistant, Virtual Room)", status: "degraded", reason: "OpenAI only — no fallback if it runs out." });
  else if (has("GEMINI_API_KEY")) features.push({ name: "AI (Play Room, Assistant, Virtual Room)", status: "degraded", reason: "Gemini only." });
  else features.push({ name: "AI (Play Room, Assistant, Virtual Room)", status: "down", reason: "No AI key configured." });

  features.push({
    name: "Virtual Room video search",
    status: has("YOUTUBE_API_KEY") ? "ok" : "degraded",
    reason: has("YOUTUBE_API_KEY") ? "Using YouTube Data API." : "Using HTML scraper fallback (fragile).",
  });

  features.push({
    name: "Email (2FA, magic links, verification)",
    status: has("RESEND_API_KEY") ? "ok" : "down",
    reason: has("RESEND_API_KEY") ? "Resend configured." : "No Resend key — emails cannot be sent.",
  });

  features.push({
    name: "Virus scanning",
    status: has("VIRUSTOTAL_API_KEY") ? "ok" : "degraded",
    reason: has("VIRUSTOTAL_API_KEY") ? "Hash + cloud scan active." : "Local checks only (extension + magic bytes).",
  });

  const vapidOk = has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY") && has("VAPID_SUBJECT");
  features.push({
    name: "Push notifications",
    status: vapidOk ? "ok" : "down",
    reason: vapidOk ? "VAPID configured." : "Missing one or more VAPID values.",
  });

  features.push({
    name: "Library search",
    status: has("GOOGLE_BOOKS_API_KEY") ? "ok" : "degraded",
    reason: has("GOOGLE_BOOKS_API_KEY") ? "Google Books configured." : "Using public 1,000/day quota.",
  });

  const overall: Status = features.some(f => f.status === "down")
    ? "down"
    : features.some(f => f.status === "degraded")
      ? "degraded"
      : "ok";
  res.json({ overall, features });
});

// ─── Export / import ─────────────────────────────────────────────────────────
// Export every DB-overridden credential as a JSON blob the admin can save and
// re-apply on a fresh instance. Env-only values are NOT exported (they live
// with the new host's environment). Returns full plaintext — admin only.
credentialsRouter.get("/api/admin/credentials/export", requireAdmin, (req: any, res) => {
  const adminId = req.user?.userId || req.user?.id || req.session?.adminId || "unknown-admin";
  const out: Record<string, string> = {};
  for (const def of CREDENTIAL_DEFS) {
    if (getCredSource(def.key) === "db") out[def.key] = getCred(def.key);
  }
  console.log(`[credentials] AUDIT: admin "${adminId}" exported ${Object.keys(out).length} credentials.`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="credentials-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), version: 1, credentials: out });
});

// Bulk import. Body: { credentials: { [key]: value }, overwrite?: boolean }.
// Unknown keys are skipped (reported back). With overwrite=false (default),
// keys already set in the DB are also skipped so an admin can safely re-run
// an import without clobbering newer values.
credentialsRouter.post("/api/admin/credentials/import", requireAdmin, async (req, res) => {
  const schema = z.object({
    credentials: z.record(z.string(), z.string().max(4096)),
    overwrite: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Body must be { credentials: { KEY: value, … }, overwrite?: boolean }" });

  const overwrite = parsed.data.overwrite === true;
  const imported: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const [key, rawValue] of Object.entries(parsed.data.credentials)) {
    if (!VALID_KEYS.has(key)) { skipped.push({ key, reason: "unknown credential key" }); continue; }
    const value = rawValue.trim();
    if (!value) { skipped.push({ key, reason: "empty value" }); continue; }
    if (!overwrite && getCredSource(key) === "db") { skipped.push({ key, reason: "already set (use overwrite=true)" }); continue; }
    try {
      await setCred(key, value);
      imported.push(key);
    } catch (e: any) {
      skipped.push({ key, reason: e?.message || "set failed" });
    }
  }
  res.json({ imported, skipped, overwrite });
});

// ─── Test the active email provider ───────────────────────────────────────────
// Sends a real test email through whichever provider EMAIL_PROVIDER currently
// points at. Lets the admin verify their config end-to-end after switching.
credentialsRouter.post("/api/admin/email/test", requireAdmin, async (req, res) => {
  const schema = z.object({ to: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Body must be { to: <email> }" });
  const provider = getActiveEmailProvider();
  try {
    await sendEmail(
      parsed.data.to,
      `Student Portal — test email (${provider})`,
      `<div style="font-family:system-ui,sans-serif;padding:24px"><h2>It works! ✅</h2><p>This test email was sent through your <b>${provider}</b> provider. If you received it, your email configuration is good.</p><p style="color:#666;font-size:12px">Sent at ${new Date().toISOString()}</p></div>`
    );
    res.json({ ok: true, provider, to: parsed.data.to });
  } catch (err: any) {
    // Provider error bodies can echo back request fields (incl. parts of the API
    // key on rare occasions). Log the full message server-side; return only a
    // short, redacted summary to the admin UI.
    const raw = String(err?.message || "Send failed");
    console.error(`[email/test] ${provider} send failed:`, raw);
    const summary = raw.split("\n")[0].slice(0, 200);
    res.status(502).json({ ok: false, provider, message: `Provider rejected the test send. Details logged on the server. (${summary})` });
  }
});

// ─── Test the admin notification fan-out ──────────────────────────────────────
// Posts a test alert to every messaging channel that has its toggle ON, OR if
// `force=true` is passed, ignores the toggles and tries every channel that has
// credentials configured. Returns the per-channel result so the admin can see
// exactly which one failed and why.
credentialsRouter.post("/api/admin/notify/test", requireAdmin, async (req, res) => {
  const force = req.body?.force === true;
  const results = await notifyAdmins(
    `🧪 <b>Test alert</b> from your Student Portal admin panel — sent at ${new Date().toLocaleString()}`,
    { force }
  );
  if (results.length === 0) {
    return res.json({
      ok: false,
      results: [],
      message: "No notification channels are enabled. Turn on at least one (Slack / Discord / Telegram), or POST again with { force: true } to test all configured channels.",
    });
  }
  res.json({ ok: results.every(r => r.ok), results });
});
