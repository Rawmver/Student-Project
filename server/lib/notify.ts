/**
 * Admin notification fan-out.
 *
 * `notifyAdmins(text, opts)` posts to every channel the admin enabled in the
 * Credentials panel: Slack, Discord, Telegram. Each channel is independently
 * gated by an ENABLE_* boolean so the admin can mix-and-match. Failures on
 * one channel never block the others, and a notification call NEVER throws —
 * it returns a per-channel result object so callers (e.g. background virus
 * scanner) can ignore-and-continue.
 *
 * Per-event toggles like ALERT_ON_VIRUS_FLAGGED gate whether a given event
 * should call this at all — that check is up to the caller; this module just
 * routes whatever it's given.
 */
import { getCred } from "./credentials";

const isOn = (key: string) => (getCred(key) || "").toLowerCase() === "true";

export interface NotifyResult {
  channel: "slack" | "discord" | "telegram";
  ok: boolean;
  message?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function postSlack(text: string): Promise<NotifyResult> {
  const url = getCred("SLACK_WEBHOOK_URL");
  if (!url) return { channel: "slack", ok: false, message: "SLACK_WEBHOOK_URL not set" };
  try {
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return { channel: "slack", ok: r.ok, message: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) {
    return { channel: "slack", ok: false, message: e?.message || "send failed" };
  }
}

async function postDiscord(text: string): Promise<NotifyResult> {
  const url = getCred("DISCORD_WEBHOOK_URL");
  if (!url) return { channel: "discord", ok: false, message: "DISCORD_WEBHOOK_URL not set" };
  try {
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Discord caps content at 2000 chars; truncate just in case.
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    });
    return { channel: "discord", ok: r.ok, message: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) {
    return { channel: "discord", ok: false, message: e?.message || "send failed" };
  }
}

async function postTelegram(text: string): Promise<NotifyResult> {
  const token = getCred("TELEGRAM_BOT_TOKEN");
  const chatId = getCred("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { channel: "telegram", ok: false, message: "Bot token or chat ID not set" };
  try {
    const r = await fetchWithTimeout(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Plain text — no parse_mode — so attacker-controlled filenames / subjects
      // can never inject Telegram HTML formatting. Telegram caps messages at
      // 4096 chars; truncate just under that to leave room for an ellipsis.
      body: JSON.stringify({ chat_id: chatId, text: text.length > 4090 ? text.slice(0, 4090) + "…" : text }),
    });
    return { channel: "telegram", ok: r.ok, message: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) {
    return { channel: "telegram", ok: false, message: e?.message || "send failed" };
  }
}

/**
 * Post `text` to every enabled channel. Returns the result for each channel
 * the admin enabled. If no channels are enabled, returns an empty array.
 *
 * `opts.force = true` ignores the per-channel ENABLE_* gates — used by the
 * "send test alert" admin endpoint so admins can verify configuration even
 * before flipping the global toggles on.
 */
export async function notifyAdmins(text: string, opts: { force?: boolean } = {}): Promise<NotifyResult[]> {
  const tasks: Promise<NotifyResult>[] = [];
  if (opts.force || isOn("ENABLE_SLACK_ALERTS"))    tasks.push(postSlack(text));
  if (opts.force || isOn("ENABLE_DISCORD_ALERTS"))  tasks.push(postDiscord(text));
  if (opts.force || isOn("ENABLE_TELEGRAM_ALERTS")) tasks.push(postTelegram(text));
  if (tasks.length === 0) return [];
  return Promise.all(tasks);
}

/** Convenience: only fire when the named per-event toggle is enabled. */
export async function notifyIfEnabled(eventToggleKey: string, text: string): Promise<NotifyResult[]> {
  if (!isOn(eventToggleKey)) return [];
  return notifyAdmins(text);
}
