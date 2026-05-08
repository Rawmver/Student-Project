/**
 * Runtime credentials store.
 *
 * Resolution order for any credential key (e.g. "OPENAI_API_KEY"):
 *   1. Value previously written by the admin via the Credentials panel
 *      (stored in the `settings` table under key `cred:<KEY>`, cached in memory).
 *   2. Process environment variable `process.env.<KEY>` (Replit Secret / .env).
 *   3. Empty string.
 *
 * Use `getCred(key)` (sync, reads cache) at call sites instead of
 * `process.env.<key>` so that admin overrides take effect without a restart.
 *
 * Call `loadCredentialsFromDb()` once at server boot before starting the
 * HTTP server so the cache is warm for the very first request.
 */

import { storage } from "../storage";
import webpush from "web-push";

const PREFIX = "cred:";

// Every editable credential the Credentials panel will manage.
// `secret: true` → value is masked when reading from the API.
export interface CredentialDef {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  group:
    | "AI"
    | "Alternative AI"
    | "Email"
    | "SMTP"
    | "Push Notifications"
    | "Virus Scanning"
    | "App"
    | "Library"
    | "Databases"
    | "Cloud Storage"
    | "SMS & Messaging"
    | "Payments"
    | "Analytics & Monitoring"
    | "Developer";
  /** Renders a special control in the admin panel. */
  type?: "boolean" | "select";
  /** For type="select" — the allowed values. */
  options?: string[];
}

export const CREDENTIAL_DEFS: CredentialDef[] = [
  { key: "USE_REPLIT_AI",        group: "AI",                 secret: false, type: "boolean", label: "Use Replit Built-in AI",  description: "When ON, all AI features (Play Room, Admin Assistant, Virtual Room explainer) use Replit's built-in AI integration instead of your own OpenAI key. Handy for testing when your OpenAI account is out of credit." },
  { key: "OPENAI_API_KEY",       group: "AI",                 secret: true,  label: "OpenAI API Key",        description: "Used by the AI Admin Assistant and the Virtual Room AI explainer. Falls back to the platform-provided key if empty." },
  { key: "GEMINI_API_KEY",       group: "AI",                 secret: true,  label: "Google Gemini API Key", description: "Optional. When set, the Play Room and Virtual Room automatically fall back to Gemini if OpenAI fails (out of credit, rate-limited, etc). Get one free at https://aistudio.google.com/app/apikey." },
  { key: "YOUTUBE_API_KEY",      group: "AI",                 secret: true,  label: "YouTube Data API Key",  description: "Used by the Virtual Room video search. Falls back to a fragile HTML scraper if empty." },
  // Active email provider — drives which transport sendOtpEmail / verification / magic-link emails actually go through.
  { key: "EMAIL_PROVIDER",       group: "Email",              secret: false, type: "select", options: ["resend", "sendgrid", "mailgun"], label: "Active Email Provider", description: "Which provider sends admin OTPs, magic links and student verification emails. Defaults to 'resend'. Switching takes effect immediately." },
  { key: "EMAIL_FROM",           group: "Email",              secret: false, label: "Default From Address",  description: "The 'From' header on outgoing email — used by SendGrid and Mailgun. For Resend on the free tier, leave as 'onboarding@resend.dev' or use a verified domain." },
  { key: "RESEND_API_KEY",       group: "Email",              secret: true,  label: "Resend API Key",        description: "Required when Active Email Provider = 'resend'. Used for admin 2FA OTPs, magic links and student verification emails." },
  { key: "RESEND_FROM",          group: "Email",              secret: false, label: "Resend From Address",   description: "Resend-specific 'From' override. Falls back to Default From Address. On the free tier this must be 'onboarding@resend.dev'." },
  { key: "VIRUSTOTAL_API_KEY",   group: "Virus Scanning",     secret: true,  label: "VirusTotal API Key",    description: "Optional. Enables hash-lookup virus scanning on file uploads. When empty, only local extension and magic-byte checks run." },
  { key: "VAPID_PUBLIC_KEY",     group: "Push Notifications", secret: false, label: "VAPID Public Key",      description: "Sent to the browser to authenticate push subscriptions. Changing this invalidates every existing student subscription." },
  { key: "VAPID_PRIVATE_KEY",    group: "Push Notifications", secret: true,  label: "VAPID Private Key",     description: "Used by the server to sign push notifications. Pair it with the matching public key." },
  { key: "VAPID_SUBJECT",        group: "Push Notifications", secret: false, label: "VAPID Subject",         description: "Contact email shown to push services, e.g. 'mailto:admin@example.com'." },
  { key: "APP_BASE_URL",         group: "App",                secret: false, label: "App Base URL",          description: "Override for links sent in emails (e.g. 'https://my-app.com'). Auto-detected when empty." },
  { key: "GOOGLE_BOOKS_API_KEY", group: "Library",            secret: true,  label: "Google Books API Key",  description: "Used by the student Library tab to search books and find free PDFs. Without a key, the public 1,000/day quota is used (often not enough). Get one at https://console.cloud.google.com → enable 'Books API' → Create API key." },

  // ─── Alternative AI providers (used as additional fallbacks / future
  //     model-picker support). Setting any of these makes them available to
  //     the multi-provider client; leaving them blank is safe. ──────────────
  { key: "ANTHROPIC_API_KEY",    group: "Alternative AI",     secret: true,  label: "Anthropic (Claude) API Key", description: "Optional. Enables Anthropic Claude models as an additional AI fallback. Get one at https://console.anthropic.com/." },
  { key: "MISTRAL_API_KEY",      group: "Alternative AI",     secret: true,  label: "Mistral API Key",       description: "Optional. Enables Mistral / Codestral models. Get one at https://console.mistral.ai/." },
  { key: "GROQ_API_KEY",         group: "Alternative AI",     secret: true,  label: "Groq API Key",          description: "Optional. Very fast Llama / Mixtral inference. Free tier available at https://console.groq.com/." },
  { key: "DEEPSEEK_API_KEY",     group: "Alternative AI",     secret: true,  label: "DeepSeek API Key",      description: "Optional. OpenAI-compatible. Cheap reasoning models — https://platform.deepseek.com/." },
  { key: "OPENROUTER_API_KEY",   group: "Alternative AI",     secret: true,  label: "OpenRouter API Key",    description: "Optional. Single key that routes to 100+ models from many providers. https://openrouter.ai/." },
  { key: "COHERE_API_KEY",       group: "Alternative AI",     secret: true,  label: "Cohere API Key",        description: "Optional. Cohere Command / Embed / Rerank models. https://dashboard.cohere.com/api-keys." },
  { key: "HUGGINGFACE_API_KEY",  group: "Alternative AI",     secret: true,  label: "Hugging Face Token",    description: "Optional. Inference endpoints + model access. https://huggingface.co/settings/tokens." },
  { key: "PERPLEXITY_API_KEY",   group: "Alternative AI",     secret: true,  label: "Perplexity API Key",    description: "Optional. Web-grounded search-augmented LLM. https://www.perplexity.ai/settings/api." },

  // ─── Generic SMTP fallback (used if RESEND_API_KEY is empty). Lets the
  //     admin point email at any provider — Gmail, Mailgun, Postmark, etc.
  { key: "SMTP_HOST",            group: "SMTP",               secret: false, label: "SMTP Host",             description: "e.g. 'smtp.gmail.com'. Used as a fallback when Resend is not configured." },
  { key: "SMTP_PORT",            group: "SMTP",               secret: false, label: "SMTP Port",             description: "Usually 587 (STARTTLS) or 465 (SSL)." },
  { key: "SMTP_USER",            group: "SMTP",               secret: false, label: "SMTP Username",         description: "Login username for the SMTP server." },
  { key: "SMTP_PASS",            group: "SMTP",               secret: true,  label: "SMTP Password",         description: "Login password (or app-password) for the SMTP server." },
  { key: "SMTP_FROM",            group: "SMTP",               secret: false, label: "SMTP From Address",     description: "The 'From' header for emails sent via SMTP, e.g. 'noreply@yourdomain.com'." },

  // ─── Databases (secondary stores — not the primary DATABASE_URL which
  //     must be set via the host's env, since panel-stored creds live in
  //     that DB). These let admins wire MongoDB / Redis / etc for future
  //     features (search, caching, queues, archival).
  { key: "MONGODB_URI",          group: "Databases",          secret: true,  label: "MongoDB Connection URI",description: "e.g. 'mongodb+srv://user:pass@cluster.mongodb.net/dbname'. For future MongoDB-backed features (analytics archive, doc search)." },
  { key: "REDIS_URL",            group: "Databases",          secret: true,  label: "Redis URL",             description: "e.g. 'rediss://default:pass@host:6379'. Enables caching, rate-limit storage, and background-job queues." },
  { key: "MYSQL_URL",            group: "Databases",          secret: true,  label: "MySQL Connection URL",  description: "Optional secondary MySQL DB for legacy data import / read replicas." },
  { key: "SUPABASE_URL",         group: "Databases",          secret: false, label: "Supabase Project URL",  description: "e.g. 'https://xxxx.supabase.co'. Pair with the keys below to use Supabase for realtime / auth / storage." },
  { key: "SUPABASE_ANON_KEY",    group: "Databases",          secret: true,  label: "Supabase Anon Key",     description: "Public key safe to expose to the browser. Required for Supabase client-side usage." },
  { key: "SUPABASE_SERVICE_KEY", group: "Databases",          secret: true,  label: "Supabase Service Role Key", description: "Privileged server-side key — bypasses RLS. Keep secret." },
  { key: "FIREBASE_PROJECT_ID",  group: "Databases",          secret: false, label: "Firebase Project ID",   description: "Used by Firebase Admin SDK for Firestore / FCM push." },
  { key: "FIREBASE_SERVICE_ACCOUNT_JSON", group: "Databases", secret: true,  label: "Firebase Service Account JSON", description: "Paste the full service-account JSON. Used by Firebase Admin for server-side Firestore / FCM." },

  // ─── Cloud storage (alternatives to Replit Object Storage).
  { key: "AWS_ACCESS_KEY_ID",    group: "Cloud Storage",      secret: false, label: "AWS Access Key ID",     description: "Used by AWS SDK for S3 / SES. Pair with the secret below." },
  { key: "AWS_SECRET_ACCESS_KEY",group: "Cloud Storage",      secret: true,  label: "AWS Secret Access Key", description: "AWS secret. Keep private." },
  { key: "AWS_REGION",           group: "Cloud Storage",      secret: false, label: "AWS Region",            description: "e.g. 'us-east-1'." },
  { key: "AWS_S3_BUCKET",        group: "Cloud Storage",      secret: false, label: "AWS S3 Bucket Name",    description: "Default S3 bucket for file uploads / exports." },
  { key: "CLOUDFLARE_R2_ACCOUNT_ID", group: "Cloud Storage",  secret: false, label: "Cloudflare R2 Account ID", description: "Cloudflare account ID for R2 (S3-compatible, no egress fees)." },
  { key: "CLOUDFLARE_R2_ACCESS_KEY", group: "Cloud Storage",  secret: false, label: "Cloudflare R2 Access Key", description: "R2 access key ID (Cloudflare dashboard → R2 → Manage API Tokens)." },
  { key: "CLOUDFLARE_R2_SECRET", group: "Cloud Storage",      secret: true,  label: "Cloudflare R2 Secret",  description: "R2 secret access key." },
  { key: "CLOUDFLARE_R2_BUCKET", group: "Cloud Storage",      secret: false, label: "Cloudflare R2 Bucket",  description: "R2 bucket name." },

  // ─── SMS & messaging (deadline alerts, OTP, admin notifications).
  { key: "TWILIO_ACCOUNT_SID",   group: "SMS & Messaging",    secret: false, label: "Twilio Account SID",    description: "Starts with 'AC…'. Required for SMS / WhatsApp via Twilio." },
  { key: "TWILIO_AUTH_TOKEN",    group: "SMS & Messaging",    secret: true,  label: "Twilio Auth Token",     description: "Twilio API auth token. Keep private." },
  { key: "TWILIO_FROM_NUMBER",   group: "SMS & Messaging",    secret: false, label: "Twilio From Number",    description: "Sender phone in E.164 format, e.g. '+15551234567'." },
  { key: "SENDGRID_API_KEY",     group: "SMS & Messaging",    secret: true,  label: "SendGrid API Key",      description: "Optional alternative email provider. https://app.sendgrid.com/settings/api_keys." },
  { key: "MAILGUN_API_KEY",      group: "SMS & Messaging",    secret: true,  label: "Mailgun API Key",       description: "Optional alternative email provider." },
  { key: "MAILGUN_DOMAIN",       group: "SMS & Messaging",    secret: false, label: "Mailgun Domain",        description: "Verified Mailgun sending domain, e.g. 'mg.yourdomain.com'." },
  // ─── Admin notification channels — toggles control where alerts fan out.
  { key: "ENABLE_SLACK_ALERTS",  group: "SMS & Messaging",    secret: false, type: "boolean", label: "Send Alerts to Slack",   description: "When ON, admin alerts (virus flagged, new submission, etc.) are posted to the Slack webhook below." },
  { key: "SLACK_WEBHOOK_URL",    group: "SMS & Messaging",    secret: true,  label: "Slack Incoming Webhook", description: "Posts admin alerts to a Slack channel. Create at https://api.slack.com/apps → Incoming Webhooks." },
  { key: "ENABLE_DISCORD_ALERTS",group: "SMS & Messaging",    secret: false, type: "boolean", label: "Send Alerts to Discord", description: "When ON, admin alerts are posted to the Discord webhook below." },
  { key: "DISCORD_WEBHOOK_URL",  group: "SMS & Messaging",    secret: true,  label: "Discord Webhook",        description: "Posts admin alerts to a Discord channel. Server Settings → Integrations → Webhooks." },
  { key: "ENABLE_TELEGRAM_ALERTS",group: "SMS & Messaging",   secret: false, type: "boolean", label: "Send Alerts to Telegram", description: "When ON, admin alerts are sent via the Telegram bot below." },
  { key: "TELEGRAM_BOT_TOKEN",   group: "SMS & Messaging",    secret: true,  label: "Telegram Bot Token",     description: "Issued by @BotFather. Pair with the chat ID below." },
  { key: "TELEGRAM_CHAT_ID",     group: "SMS & Messaging",    secret: false, label: "Telegram Chat ID",       description: "Numeric chat / group / channel ID where the bot will post." },
  // Per-event toggles so admins can pick what triggers an alert.
  { key: "ALERT_ON_VIRUS_FLAGGED", group: "SMS & Messaging",  secret: false, type: "boolean", label: "Alert: Virus Flagged",    description: "When ON, send an admin alert if the background virus scan flags a submitted file." },
  { key: "ALERT_ON_NEW_SUBMISSION",group: "SMS & Messaging",  secret: false, type: "boolean", label: "Alert: New Submission",   description: "When ON, send an admin alert every time a student submits a file. Can be noisy on busy projects." },

  // ─── Payments (future premium / sponsored features).
  { key: "STRIPE_SECRET_KEY",    group: "Payments",           secret: true,  label: "Stripe Secret Key",     description: "Starts with 'sk_…'. Server-side Stripe API access." },
  { key: "STRIPE_PUBLISHABLE_KEY",group: "Payments",          secret: false, label: "Stripe Publishable Key",description: "Starts with 'pk_…'. Safe to expose to the browser." },
  { key: "STRIPE_WEBHOOK_SECRET",group: "Payments",           secret: true,  label: "Stripe Webhook Secret", description: "Starts with 'whsec_…'. Verifies incoming webhook signatures." },
  { key: "PAYPAL_CLIENT_ID",     group: "Payments",           secret: false, label: "PayPal Client ID",      description: "From your PayPal Developer dashboard." },
  { key: "PAYPAL_CLIENT_SECRET", group: "Payments",           secret: true,  label: "PayPal Client Secret",  description: "PayPal API secret. Keep private." },
  { key: "RAZORPAY_KEY_ID",      group: "Payments",           secret: false, label: "Razorpay Key ID",       description: "Razorpay API key (India). Public key ID." },
  { key: "RAZORPAY_KEY_SECRET",  group: "Payments",           secret: true,  label: "Razorpay Key Secret",   description: "Razorpay API secret." },

  // ─── Analytics & monitoring.
  { key: "SENTRY_DSN",           group: "Analytics & Monitoring", secret: true, label: "Sentry DSN",         description: "Error tracking. Looks like 'https://abc@oXX.ingest.sentry.io/123'." },
  { key: "POSTHOG_API_KEY",      group: "Analytics & Monitoring", secret: true, label: "PostHog Project API Key", description: "Product analytics. Starts with 'phc_…'." },
  { key: "POSTHOG_HOST",         group: "Analytics & Monitoring", secret: false, label: "PostHog Host",      description: "e.g. 'https://us.i.posthog.com' or your self-hosted URL." },
  { key: "MIXPANEL_TOKEN",       group: "Analytics & Monitoring", secret: true, label: "Mixpanel Project Token", description: "Optional Mixpanel ingestion token." },
  { key: "GA_MEASUREMENT_ID",    group: "Analytics & Monitoring", secret: false, label: "Google Analytics Measurement ID", description: "Starts with 'G-…'. Adds GA4 page-view tracking." },

  // ─── Developer / integrations.
  { key: "GITHUB_TOKEN",         group: "Developer",          secret: true,  label: "GitHub Personal Access Token", description: "For repo automation, issue sync, or CI integrations. https://github.com/settings/tokens." },
  { key: "REPLIT_DB_URL",        group: "Developer",          secret: true,  label: "Replit DB URL",         description: "Override Replit's auto-injected key/value DB URL — only set if you know what you're doing." },
];

const KEY_TO_DEF = new Map(CREDENTIAL_DEFS.map(d => [d.key, d]));

// In-memory cache. Only contains DB-overridden values; env fallback is read live.
const cache = new Map<string, string>();
let loaded = false;

export async function loadCredentialsFromDb(): Promise<void> {
  for (const def of CREDENTIAL_DEFS) {
    try {
      const v = await storage.getSetting(PREFIX + def.key);
      if (v !== undefined && v !== "") cache.set(def.key, v);
    } catch (e) {
      console.error(`[credentials] failed to load ${def.key}:`, e);
    }
  }
  loaded = true;
  // Apply VAPID immediately so push works on first request.
  applyVapidIfReady();
}

/** Synchronous credential read. Always safe to call after `loadCredentialsFromDb()`. */
export function getCred(key: string): string {
  if (!loaded) {
    // Soft warn — first-request before boot init shouldn't happen, but don't crash.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[credentials] getCred("${key}") called before loadCredentialsFromDb() finished`);
    }
  }
  const fromDb = cache.get(key);
  if (fromDb && fromDb.length > 0) return fromDb;
  return process.env[key] || "";
}

/** Where is the *currently effective* value coming from? */
export function getCredSource(key: string): "db" | "env" | "none" {
  if (cache.has(key) && cache.get(key)) return "db";
  if (process.env[key]) return "env";
  return "none";
}

export async function setCred(key: string, value: string): Promise<void> {
  if (!KEY_TO_DEF.has(key)) throw new Error(`Unknown credential key: ${key}`);
  await storage.setSetting(PREFIX + key, value);
  cache.set(key, value);
  if (key.startsWith("VAPID_")) applyVapidIfReady();
}

/** Clears the DB override; the env fallback (if any) becomes effective again. */
export async function clearCred(key: string): Promise<void> {
  if (!KEY_TO_DEF.has(key)) throw new Error(`Unknown credential key: ${key}`);
  await storage.deleteSetting(PREFIX + key);
  cache.delete(key);
  if (key.startsWith("VAPID_")) applyVapidIfReady();
}

export function listCredentials() {
  return CREDENTIAL_DEFS.map(def => {
    const value = getCred(def.key);
    const hasValue = value.length > 0;
    return {
      ...def,
      hasValue,
      source: getCredSource(def.key),
      // Mask secrets — never return raw secret values to the client.
      maskedValue: !hasValue
        ? ""
        : def.secret
          ? maskSecret(value)
          : value,
    };
  });
}

function maskSecret(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.min(v.length - 8, 16)) + v.slice(-4);
}

/** (Re)apply VAPID details to web-push when both keys + subject are set. */
function applyVapidIfReady() {
  const pub = getCred("VAPID_PUBLIC_KEY");
  const priv = getCred("VAPID_PRIVATE_KEY");
  const sub = getCred("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (pub && priv) {
    try {
      webpush.setVapidDetails(sub, pub, priv);
    } catch (e) {
      console.error("[credentials] failed to apply VAPID details:", e);
    }
  }
}
