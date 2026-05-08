import { Router } from "express";
import webpush from "web-push";
import { storage } from "../storage";
import { z } from "zod";
import { getCred } from "../lib/credentials";

export const pushRouter = Router();

// VAPID details are applied centrally in server/lib/credentials.ts whenever
// the credentials cache is loaded or any VAPID_* credential is updated.

pushRouter.get("/api/push/vapid-key", (_req, res) => {
  res.json({ publicKey: getCred("VAPID_PUBLIC_KEY") });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

async function extractStudentId(req: any): Promise<number | null> {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const session = await storage.findStudentSession(token);
  return session ? session.account.id : null;
}

pushRouter.post("/api/push/subscribe", async (req, res) => {
  try {
    const studentAccountId = await extractStudentId(req);
    if (!studentAccountId) return res.status(401).json({ message: "Not authenticated" });

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid subscription data" });

    const { endpoint, keys } = parsed.data;
    const sub = await storage.savePushSubscription(studentAccountId, endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true, id: sub.id });
  } catch (err) {
    console.error("Push subscribe error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

pushRouter.post("/api/push/unsubscribe", async (req, res) => {
  try {
    const studentAccountId = await extractStudentId(req);
    if (!studentAccountId) return res.status(401).json({ message: "Not authenticated" });

    const endpointSchema = z.object({ endpoint: z.string().url() });
    const parsed = endpointSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

    await storage.deletePushSubscriptionOwned(parsed.data.endpoint, studentAccountId);
    res.json({ ok: true });
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
