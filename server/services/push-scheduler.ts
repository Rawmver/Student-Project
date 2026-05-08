import webpush from "web-push";
import { storage } from "../storage";
import { getCred } from "../lib/credentials";

// VAPID details are applied centrally in server/lib/credentials.ts whenever
// the credentials cache is loaded or any VAPID_* credential is updated.

function localDateStr(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const sentReminders = new Set<string>();

function cleanOldKeys() {
  const today = localDateStr(0);
  for (const key of sentReminders) {
    const datePart = key.split(":")[1];
    if (datePart && datePart < today) sentReminders.delete(key);
  }
}

async function checkAndSendReminders() {
  if (!getCred("VAPID_PUBLIC_KEY") || !getCred("VAPID_PRIVATE_KEY")) return;

  try {
    cleanOldKeys();

    const tomorrow = localDateStr(1);
    const dayAfter = localDateStr(2);

    const allEvents = await storage.getCalendarEvents();
    const reminderEvents = allEvents.filter(
      (e) =>
        (e.eventType === "assignment" || e.eventType === "exam") &&
        (e.eventDate === tomorrow || e.eventDate === dayAfter)
    );

    if (reminderEvents.length === 0) return;

    let totalSent = 0;

    for (const event of reminderEvents) {
      const isExam = event.eventType === "exam";
      const daysUntil = event.eventDate === tomorrow ? "tomorrow" : "in 2 days";
      const typeLabel = isExam ? "Exam" : "Assignment";

      const payload = JSON.stringify({
        title: `${typeLabel} Reminder`,
        body: `${event.title} is ${daysUntil}${event.startTime ? ` at ${event.startTime}` : ""}`,
        tag: `reminder-${event.id}-${event.eventDate}`,
        url: "/student-portal",
      });

      const subs = await storage.getAllPushSubscriptionsForSemester(event.semester);

      for (const sub of subs) {
        const dedupeKey = `${event.id}:${event.eventDate}:${sub.id}`;
        if (sentReminders.has(dedupeKey)) continue;

        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
          sentReminders.add(dedupeKey);
          totalSent++;
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await storage.deletePushSubscription(sub.endpoint);
          } else {
            console.error(`[push-scheduler] Failed to send to sub ${sub.id}:`, err.message);
          }
        }
      }
    }

    if (totalSent > 0) {
      console.log(`[push-scheduler] Sent ${totalSent} reminder notification(s)`);
    }
  } catch (err) {
    console.error("[push-scheduler] Error:", err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startPushScheduler() {
  checkAndSendReminders();
  intervalId = setInterval(checkAndSendReminders, 60 * 60 * 1000);
  console.log("[push-scheduler] Started — checking every hour");
}

export function stopPushScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
