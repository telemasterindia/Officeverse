import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROCESSES } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";
import { Workstation } from "./workstation";
import { cn } from "@/lib/utils";

/**
 * Clock into Officeverse — a visual reaction layered on the *existing*
 * check-in data. This writes nothing and creates no attendance record; it only
 * compares the current time to the employee's assigned shift start and stages
 * the character's response. No XP / points / badges.
 */
function shiftStartMinutes(hours: string): number {
  const m = hours.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9 * 60 + 30;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function AttendanceCheckIn() {
  const { user } = useSession();
  const [state, setState] = useState<null | "ontime" | "late">(null);

  if (!user) return null;

  const checkIn = () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = shiftStartMinutes(PROCESSES[user.process].hours);
    let diff = nowMin - startMin;
    if (diff < -720) diff += 1440; // shift wrapped past midnight
    setState(diff > 10 ? "late" : "ontime");
  };

  const ontime = state === "ontime";

  return (
    <div className="floating-panel animate-rise-in relative overflow-hidden">
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Clock in
          </p>

          {state === null ? (
            <>
              <h2 className="mt-3 font-display text-2xl font-black">Ready for your shift?</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {PROCESSES[user.process].shift} · starts {PROCESSES[user.process].hours}
              </p>
              <Button className="mt-4 rounded-full" onClick={checkIn}>
                Check in
              </Button>
            </>
          ) : (
            <>
              <h2
                className={cn(
                  "mt-3 font-display text-2xl font-black",
                  ontime ? "text-success" : "text-warning",
                )}
              >
                {ontime ? "Right on time." : "You're a little late — that's okay."}
              </h2>
              <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                {ontime
                  ? "Right on time. Let's make this shift count."
                  : "You're late for the shift, but that's fine. You can still catch up, give your best and earn big incentives."}
              </p>
              <Button
                variant="outline"
                className="mt-4 rounded-full"
                onClick={() => setState(null)}
              >
                Done
              </Button>
            </>
          )}
        </div>

        <Workstation
          name={user.name}
          process={user.process}
          room="workspace"
          pose={state === null ? "working" : ontime ? "wave" : "thinking"}
          expression={state === null ? "focused" : ontime ? "excited" : "happy"}
          className="w-full max-w-[300px] justify-self-center sm:w-[280px]"
        />
      </div>
    </div>
  );
}
