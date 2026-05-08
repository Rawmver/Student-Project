import { useState, useEffect } from "react";
import { Clock } from "lucide-react";
import { differenceInSeconds } from "date-fns";

type Props = {
  /**
   * Optional explicit deadline. When omitted the timer falls back to the
   * active project's deadline (and then to the legacy global setting), so
   * existing call sites keep working without any prop.
   */
  deadline?: Date | null;
};

export function CountdownTimer({ deadline: deadlineProp }: Props = {}) {
  const [deadline, setDeadline] = useState<Date | null>(deadlineProp ?? null);
  const [timeLeft, setTimeLeft] = useState(0);

  // Sync prop changes (parent reloads the active project, etc.)
  useEffect(() => {
    if (deadlineProp !== undefined) {
      if (deadlineProp && deadlineProp > new Date()) {
        setDeadline(deadlineProp);
        setTimeLeft(differenceInSeconds(deadlineProp, new Date()));
      } else {
        setDeadline(null);
        setTimeLeft(0);
      }
    }
  }, [deadlineProp?.getTime()]);

  // No prop given → resolve from active project (preferred) then global setting.
  useEffect(() => {
    if (deadlineProp !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const projRes = await fetch("/api/projects/active");
        const proj = await projRes.json();
        if (proj?.deadline) {
          const d = new Date(proj.deadline);
          if (!cancelled && d > new Date()) {
            setDeadline(d);
            setTimeLeft(differenceInSeconds(d, new Date()));
            return;
          }
        }
      } catch { /* ignore — fall through to legacy setting */ }

      try {
        const setRes = await fetch("/api/settings/submission_deadline");
        const set = await setRes.json();
        if (set?.value) {
          const d = new Date(set.value);
          if (!cancelled && d > new Date()) {
            setDeadline(d);
            setTimeLeft(differenceInSeconds(d, new Date()));
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [deadlineProp]);

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const diff = differenceInSeconds(deadline, new Date());
      if (diff <= 0) {
        clearInterval(timer);
        setTimeLeft(0);
      } else {
        setTimeLeft(diff);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [deadline]);

  if (!deadline || timeLeft <= 0) return null;

  const days = Math.floor(timeLeft / (3600 * 24));
  const hours = Math.floor((timeLeft % (3600 * 24)) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 shadow-lg" data-testid="countdown-timer">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 animate-pulse" />
          <span className="font-medium text-sm sm:text-base">Submission Deadline approaching!</span>
        </div>

        <div className="flex gap-4 text-center">
          <div className="flex flex-col min-w-[3rem]">
            <span className="text-xl font-bold font-mono leading-none" data-testid="text-countdown-days">{days}</span>
            <span className="text-[10px] uppercase opacity-80">Days</span>
          </div>
          <div className="flex flex-col min-w-[3rem]">
            <span className="text-xl font-bold font-mono leading-none" data-testid="text-countdown-hours">{hours}</span>
            <span className="text-[10px] uppercase opacity-80">Hours</span>
          </div>
          <div className="flex flex-col min-w-[3rem]">
            <span className="text-xl font-bold font-mono leading-none" data-testid="text-countdown-mins">{minutes}</span>
            <span className="text-[10px] uppercase opacity-80">Mins</span>
          </div>
          <div className="flex flex-col min-w-[3rem]">
            <span className="text-xl font-bold font-mono leading-none" data-testid="text-countdown-secs">{seconds}</span>
            <span className="text-[10px] uppercase opacity-80">Secs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
