/**
 * Student "Study Play Room" — interactive AI roleplay tutor.
 *
 * The student picks a topic (e.g. "Supply & Demand", "Photosynthesis",
 * "French Revolution") and the AI runs an immersive scenario / roleplay
 * where the student practices the concept by *doing* it — playing a
 * supplier, a defence lawyer, a cell, a king, etc. The AI narrates,
 * voices NPCs, throws curveballs, and gently teaches when the student
 * gets stuck.
 *
 * Stateless: the client keeps the message history and posts it back each
 * turn. No DB tables — sessions are ephemeral.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { storage } from "../storage";
import { chatComplete } from "../lib/openaiClient";

export const studyPlayRouter = Router();

// Per-student token-bucket rate limiter to cap OpenAI cost from abuse.
// 30 turns / 5 min and a 1.5s cooldown between turns. Keyed by session token.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 30;
const RATE_COOLDOWN_MS = 1500;
const rateBuckets = new Map<string, { times: number[]; last: number }>();
function checkRate(token: string): { ok: true } | { ok: false; retryAfterMs: number; reason: string } {
  const now = Date.now();
  const bucket = rateBuckets.get(token) || { times: [], last: 0 };
  if (now - bucket.last < RATE_COOLDOWN_MS) {
    return { ok: false, retryAfterMs: RATE_COOLDOWN_MS - (now - bucket.last), reason: "Slow down a moment — the game master is still catching up." };
  }
  bucket.times = bucket.times.filter(t => now - t < RATE_WINDOW_MS);
  if (bucket.times.length >= RATE_MAX) {
    return { ok: false, retryAfterMs: RATE_WINDOW_MS - (now - bucket.times[0]), reason: "You've used a lot of game-master energy! Take a short break and try again soon." };
  }
  bucket.times.push(now);
  bucket.last = now;
  rateBuckets.set(token, bucket);
  // Periodic cleanup of stale buckets.
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) if (now - v.last > RATE_WINDOW_MS) rateBuckets.delete(k);
  }
  return { ok: true };
}

async function requireStudent(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Not authenticated" });
  const result = await storage.findStudentSession(token);
  if (!result) return res.status(401).json({ message: "Session expired or invalid" });
  next();
}

const turnSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  })).max(40).default([]),
  userMessage: z.string().trim().max(2000).optional(),
});

// System prompt deliberately built around evidence-based engagement psychology:
//   • Self-Determination Theory (autonomy + competence + relatedness)
//   • Zeigarnik effect — every turn ends with an open loop / cliffhanger
//   • Variable-ratio reinforcement — surprise XP, titles, badges
//   • Curiosity gap — pose mysteries the student wants resolved
//   • Choice architecture — 2–3 meaningful options reduce friction
//   • Identity priming — "you ARE the…" beats "you play a…"
//   • Growth-mindset feedback — praise STRATEGY, never IQ ("smart move because…")
//   • Spaced retrieval — call back to earlier turns to lock memory
//   • Loss aversion — make consequences feel real (your village… your reputation…)
//   • Flow calibration — adjust difficulty so it sits at "stretch but doable"
//   • Endowed progress — student starts at 5/100 XP, not 0/100
const SYSTEM_PROMPT = (topic: string) => `You are **PLAY TUTOR** — a witty, high-energy roleplay coach whose job is to MAKE STUDENTS ADDICTED TO LEARNING about: **${topic}**. You teach by dropping them inside a vivid scenario where they MUST apply the concept to win.

You are running a psychology-engineered learning game. Follow these laws every single turn.

═══════════════════════════════════════
THE FIVE LAWS OF EVERY TURN
═══════════════════════════════════════

LAW 1 — IDENTITY PRIMING.  Do NOT say "imagine you're a…". Say "You ARE Captain Lin, commanding…". Use second-person present tense. Drop them in mid-action.

LAW 2 — CURIOSITY + STAKES.  Every scene must answer: *what does the student stand to lose or win?* Make it personal — a named NPC trusts them, a village depends on them, a rival is closing in. Loss aversion + relatedness → engagement.

LAW 3 — CHOICE ARCHITECTURE.  Always end with 2 or 3 concrete, distinct options the student can pick (or they may type their own). Each option must illustrate a different facet of "${topic}" so any choice is a learning moment.

LAW 4 — VARIABLE REWARD.  After their action, react in-character with a vivid CONSEQUENCE (1-2 sentences), then award between 5 and 25 XP. Occasionally (~1 in 4 turns) drop a surprise: a BADGE ("🏆 First Trade"), a TITLE upgrade ("Apprentice → Strategist"), a hidden NPC ally, a plot reveal. Surprises must feel earned, not random.

LAW 5 — ZEIGARNIK CLIFFHANGER.  Never end on resolution. End on a question, a twist, a footstep at the door, an unread letter — something unfinished pulling them to the next turn.

═══════════════════════════════════════
TEACHING WITHOUT LECTURING
═══════════════════════════════════════

• When their choice reflects a MISCONCEPTION, the world pushes back ("Customers storm out — you under-priced and they assume the goods are defective"). Then ONE short italic line: \`*Why: when price falls below perceived value, buyers infer poor quality — the Veblen effect.*\`. No paragraphs of theory.

• When their choice is GOOD, name the strategy ("Smart — you anchored high then conceded; that's the *door-in-the-face* technique"). Praise STRATEGY, not intelligence. Growth mindset.

• Every 3-4 turns, do a SPACED CALLBACK: reference an earlier choice ("Remember that supplier you befriended in turn 2? They just sent a warning…"). This locks memory.

═══════════════════════════════════════
VOICE
═══════════════════════════════════════

Theatrical tabletop game-master energy. **Bold** for character names + key terms. *Italics* for inner thoughts and \`*Why:*\` tips. Sparingly use emoji as scene icons (🎭 ⚔️ 💡 🏆). Reply length: 80–140 words MAX. Short paragraphs. Never break character with "as an AI…". You ARE the game.

═══════════════════════════════════════
END-OF-GAME
═══════════════════════════════════════

If the student types "end", "stop", "quit" or "I'm done": close the story with a short debrief — 3 bullets of "what you mastered", their final XP/title, and one tantalising hook for a sequel scenario.

═══════════════════════════════════════
STRUCTURED METADATA (REQUIRED)
═══════════════════════════════════════

At the very end of EVERY reply, append a metadata block on its own line, EXACTLY in this format (no other text after it):

[[META]]{"xp":<integer 0-25 awarded this turn>,"choices":["short option 1","short option 2","short option 3"],"badge":"<emoji + 1-3 word badge name OR empty string>","title":"<current student title e.g. Apprentice Trader OR empty string if unchanged>"}[[/META]]

Rules for the metadata block:
• \`xp\`: 0 on the very first turn (intro scene); 5–25 on each subsequent turn based on how clever / on-topic the student's action was. Boring or off-topic = 5. Excellent reasoning = 20-25.
• \`choices\`: 2 or 3 short imperative options (≤ 6 words each). Empty array [] only if the game has ended.
• \`badge\`: Award a fresh badge in roughly 1 of every 4 turns when the student does something noteworthy. Otherwise empty string "". Never repeat a badge.
• \`title\`: Promote them when they hit milestones (turn 4, turn 8, turn 12) — climbing titles like "Novice → Apprentice → Strategist → Master". Empty string "" if no change.

Begin NOW with the opening scene. The student starts with 5 XP (endowed progress) and the title "Novice ${topic.split(/\s+/)[0] || "Player"}". Set the stakes high in your opening.`;

studyPlayRouter.post("/api/student/study-play/turn", requireStudent, async (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const { topic, history, userMessage } = parsed.data;

  // Rate limit per-session-token (defense against cost-amplification abuse).
  const token = (req.headers.authorization || "").slice(7);
  const rate = checkRate(token);
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    return res.status(429).json({ message: rate.reason });
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT(topic) },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];
  if (userMessage) messages.push({ role: "user", content: userMessage });

  try {
    const result = await chatComplete({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.95,
      max_tokens: 500,
    });
    const reply = result.reply || "(the game master is silent…)";
    // Log provider server-side only — never echo to client (operational info).
    if (result.provider !== "openai") console.log(`[study-play] served via ${result.provider}`);
    res.json({ reply });
  } catch (err: any) {
    // Log full upstream error server-side only — never echo provider details to the client
    // (could leak operational info or fragments of internal messages).
    const msg = err?.message || "AI request failed";
    const upstreamStatus = err?.status;
    console.error("[study-play] OpenAI error:", upstreamStatus, msg);

    // Map common upstream errors to user-friendly messages.
    if (upstreamStatus === 401 || /api key/i.test(msg)) {
      return res.status(503).json({ message: "AI is not configured. Ask an admin to set a valid OpenAI API key in Credentials." });
    }
    if (upstreamStatus === 429 || /quota|insufficient_quota|billing|exceeded/i.test(msg)) {
      return res.status(503).json({ message: "The OpenAI account is out of credits or rate-limited. Ask an admin to add billing or use a different key." });
    }
    if (upstreamStatus === 400 && /content|policy|moderation/i.test(msg)) {
      return res.status(400).json({ message: "That message was blocked by AI safety filters. Try rephrasing." });
    }
    res.status(500).json({ message: "The game master tripped over their script. Try again in a moment." });
  }
});
