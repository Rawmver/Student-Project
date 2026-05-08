/**
 * Centralised AI client + multi-provider fallback.
 *
 * Provider priority (configured via Credentials panel):
 *   1. If `USE_REPLIT_AI` toggle is ON  → Replit's built-in AI integration.
 *   2. Else if `OPENAI_API_KEY` is set  → OpenAI directly.
 *   3. Else if `GEMINI_API_KEY` is set  → Google Gemini (via its
 *      OpenAI-compatible REST endpoint, so we keep using the OpenAI SDK).
 *   4. Else                              → Replit's built-in AI integration.
 *
 * `chatComplete()` is a smart wrapper: it tries the primary provider and,
 * if the request fails with a quota / auth / rate-limit error, automatically
 * retries with Gemini (when a Gemini key is configured). This makes the
 * student-facing AI features resilient to OpenAI billing outages.
 *
 * Direct callers that need full SDK access (e.g. tool-calling agentic loops)
 * can still use `buildOpenAI()` — but they will not get auto-failover.
 */
import OpenAI from "openai";
import { getCred } from "./credentials";

export type AiProvider = "openai" | "gemini" | "replit";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
// `gemini-flash-latest` is the only flash-tier model Google currently grants
// free-tier quota to (verified Nov 2026 — `gemini-2.0-flash` and
// `gemini-1.5-flash` both return 429 "limit: 0" on free keys). Override
// per-call with `geminiModel` if a paid project needs a specific snapshot.
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

function openaiOnly(): OpenAI {
  return new OpenAI({ apiKey: getCred("OPENAI_API_KEY") });
}
function replitOnly(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}
function geminiOnly(): OpenAI {
  return new OpenAI({ apiKey: getCred("GEMINI_API_KEY"), baseURL: GEMINI_BASE_URL });
}

/** Which provider should serve the next request? */
export function activeProvider(): AiProvider {
  if ((getCred("USE_REPLIT_AI") || "").toLowerCase() === "true") return "replit";
  if (getCred("OPENAI_API_KEY")) return "openai";
  if (getCred("GEMINI_API_KEY")) return "gemini";
  return "replit";
}

/**
 * Build a raw OpenAI-SDK client for the active provider.
 *
 * IMPORTANT: this never returns a Gemini-backed client, because callers that
 * use `buildOpenAI()` directly (e.g. the Admin AI tool-calling loop) hardcode
 * OpenAI-specific model names like `gpt-5-mini` that Gemini does not
 * understand. If the admin only has a Gemini key set, those callers fall
 * through to Replit's built-in AI integration (which speaks the OpenAI
 * dialect with compatible models).
 *
 * For features that *should* fall over to Gemini at request time, use
 * `chatComplete()` instead — it handles the model-name remapping safely.
 */
export function buildOpenAI(): OpenAI {
  const p = activeProvider();
  if (p === "openai") return openaiOnly();
  // Gemini is intentionally skipped here — see doc-comment above.
  return replitOnly();
}

/** True if the error looks like a billing / quota / auth failure worth retrying on a different provider. */
function isRetryableUpstreamError(err: any): boolean {
  const status = err?.status;
  const msg = String(err?.message || "");
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  if (/quota|insufficient_quota|billing|exceeded|rate.?limit|api key/i.test(msg)) return true;
  return false;
}

interface ChatOpts {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  /** Preferred model on OpenAI / Replit. Ignored on Gemini (uses `geminiModel`). */
  model: string;
  temperature?: number;
  /** Use this for "classic" max_tokens (works on all three providers). */
  max_tokens?: number;
  /** Use this for the newer OpenAI gpt-5-mini style param. Mapped to `max_tokens` on Gemini. */
  max_completion_tokens?: number;
  /** Optional override when falling back to Gemini. */
  geminiModel?: string;
}

interface ChatResult {
  reply: string;
  provider: AiProvider;
  finish_reason?: string;
}

/**
 * One-shot chat completion with automatic Gemini failover.
 * Throws the *original* primary-provider error if no fallback is possible.
 */
export async function chatComplete(opts: ChatOpts): Promise<ChatResult> {
  const primary = activeProvider();

  async function callProvider(provider: AiProvider): Promise<ChatResult> {
    const client =
      provider === "openai" ? openaiOnly() :
      provider === "gemini" ? geminiOnly() :
      replitOnly();
    const model = provider === "gemini" ? (opts.geminiModel || DEFAULT_GEMINI_MODEL) : opts.model;
    // Gemini's OpenAI-compat layer expects `max_tokens`, not `max_completion_tokens`.
    const tokenCap = opts.max_completion_tokens ?? opts.max_tokens;
    const params: any = {
      model,
      messages: opts.messages,
      temperature: opts.temperature,
    };
    if (tokenCap != null) {
      if (provider === "openai" && opts.max_completion_tokens != null) {
        params.max_completion_tokens = opts.max_completion_tokens;
      } else {
        params.max_tokens = tokenCap;
      }
    }
    const r = await client.chat.completions.create(params);
    return {
      reply: r.choices[0]?.message?.content?.trim() || "",
      provider,
      finish_reason: r.choices[0]?.finish_reason as string | undefined,
    };
  }

  try {
    return await callProvider(primary);
  } catch (err: any) {
    const canFallback =
      primary !== "gemini" &&
      isRetryableUpstreamError(err) &&
      !!getCred("GEMINI_API_KEY");
    if (!canFallback) throw err;
    console.warn(`[ai] ${primary} failed (${err?.status} ${err?.message}); falling back to Gemini`);
    try {
      return await callProvider("gemini");
    } catch (gerr: any) {
      // Try to surface real Gemini failure details — the OpenAI SDK strips body on some errors.
      const body = gerr?.error || gerr?.response?.data || gerr?.cause;
      console.error(
        `[ai] Gemini fallback also failed:`, gerr?.status, gerr?.message,
        body ? `body=${JSON.stringify(body).slice(0, 500)}` : "(no body)"
      );
      // Surface the *original* error so the user sees the real root cause.
      throw err;
    }
  }
}
