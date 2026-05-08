import { db } from "../db";
import { studentAccounts } from "@shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "../storage";

const ADVANCE_MONTHS = [2, 9];
const MAX_SEMESTER = 8;
const MARKER_KEY = "last_semester_advance";

function todayLocal(): { year: number; month: number; day: number; key: string } {
  const d = new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return { year, month, day, key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

async function advanceAllStudents(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE student_accounts
    SET semester = CASE
      WHEN semester ~ '^[0-9]+$' AND CAST(semester AS INTEGER) < ${MAX_SEMESTER}
        THEN CAST(CAST(semester AS INTEGER) + 1 AS TEXT)
      ELSE semester
    END
    WHERE semester ~ '^[0-9]+$' AND CAST(semester AS INTEGER) < ${MAX_SEMESTER}
  `);
  return (result as any).rowCount ?? 0;
}

async function checkAndAdvance() {
  try {
    const { year, month, day, key } = todayLocal();
    if (!ADVANCE_MONTHS.includes(month) || day !== 1) return;

    const last = await storage.getSetting(MARKER_KEY);
    const thisCycle = `${year}-${String(month).padStart(2, "0")}`;
    if (last === thisCycle) return;

    const updated = await advanceAllStudents();
    await storage.setSetting(MARKER_KEY, thisCycle);
    console.log(`[semester-scheduler] Advanced ${updated} student(s) on ${key}`);
  } catch (err) {
    console.error("[semester-scheduler] Error:", err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSemesterScheduler() {
  if (intervalId) return;
  void checkAndAdvance();
  intervalId = setInterval(checkAndAdvance, 60 * 60 * 1000);
  console.log("[semester-scheduler] Started — auto-advances on Feb 1 & Sept 1");
}
