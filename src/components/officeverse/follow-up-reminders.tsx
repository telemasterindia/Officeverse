import { useNavigate } from "@tanstack/react-router";
import { AlarmClock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addNotification, claimOnce, queueEmail } from "@/lib/officeverse/alerts";
import { renderCloserEmail, renderShiftEmail } from "@/lib/officeverse/email-templates";
import {
  closerEmailKey,
  displayTime,
  followUpsForNextShift,
  liveReminderThreshold,
  loadFollowUps,
  minutesUntil,
  nextShiftStart,
  reminderKey,
  resolveCustomer,
  seedDemoReminders,
  shiftEmailKey,
  SHIFT_EMAIL_LEAD_MINUTES,
  visibleFollowUps,
  type FollowUpRecord,
} from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";

const SCAN_MS = 15_000;

type ActiveReminder = { fu: FollowUpRecord; threshold: number } | null;

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DEVELOPMENT / DEMO REMINDER ENGINE — NOT PRODUCTION-GRADE.               │
 * │                                                                         │
 * │ This build has NO backend scheduler. Reminders therefore run ONLY while │
 * │ a CRM tab is open, driven by a 15s setInterval. If every tab is closed  │
 * │ at the reminder time, that reminder is skipped (the OVERDUE state still │
 * │ shows on the board). Do not treat this as reliable delivery.            │
 * │                                                                         │
 * │ The business logic is deliberately isolated so it can move server-side  │
 * │ unchanged: `scanForReminders(user, now)` is pure over the follow-up     │
 * │ store, thresholds/labels/dedupe keys are data, and every "send" is a    │
 * │ `queueEmail(...)` into the outbox. A cron/worker would call the same    │
 * │ derivation and forward the outbox to a mail provider.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Per follow-up, per open session:
 *   • 15 / 3 / 1-minute in-CRM notification + toast, each fired at most once
 *     (dedupe key = follow-up id · threshold · scheduled_at, persisted in
 *     localStorage). Reschedule → new scheduled_at → new keys → re-armed.
 *     Cancel / complete → status ≠ SCHEDULED → dropped from the scan.
 *   • ≤ 3-minute: a prominent, NON-blocking reminder card (no overlay).
 *   • CLOSER follow-up: ONE email to the closer (dedupe key =
 *     followup_id · "closer" · scheduled_at). Never sent to the agent.
 *   • 4 hours before the user's next shift: ONE shift-summary email
 *     (dedupe key = user_id · shift_start_date · "shift").
 */
export function FollowUpReminders() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveReminder>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCard = useCallback((fu: FollowUpRecord, threshold: number) => {
    setActive({ fu, threshold });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), 60_000);
  }, []);

  useEffect(() => {
    if (!user) return;
    seedDemoReminders(user);

    const scan = () => {
      const now = Date.now();
      const all = loadFollowUps();
      // Only SCHEDULED follow-ups. Completed / cancelled produce no reminders.
      const mine = visibleFollowUps(all, user).filter((f) => f.status === "SCHEDULED");

      for (const fu of mine) {
        const m = minutesUntil(fu.scheduled_at, now);

        // In-CRM reminder — pure derivation, persistent dedupe.
        const t = liveReminderThreshold(fu, now);
        if (t != null && claimOnce(reminderKey(fu, t))) {
          const mins = Math.max(0, Math.ceil(m));
          const title =
            m <= 1 ? "Follow-up now" : `Follow-up in ${mins} minute${mins === 1 ? "" : "s"}`;
          const c = resolveCustomer(fu);
          addNotification({
            category: "Follow-ups",
            title,
            body: `${c.name} · ${fu.lead_id} — scheduled ${displayTime(fu.scheduled_at)}`,
          });
          toast(`⏰ ${title}`, {
            description: `${c.name} · ${fu.follow_up_id} — ${displayTime(fu.scheduled_at)}`,
            duration: m <= 1 ? 12_000 : 8_000,
            action: {
              label: "Open follow-up",
              onClick: () =>
                navigate({
                  to: "/followups/$followUpId",
                  params: { followUpId: fu.follow_up_id },
                }),
            },
          });
          if (t <= 3) showCard(fu, t);
        }

        // CLOSER follow-up → exactly ONE email to the closer, from the 15-minute
        // mark. Triggered only from the closer's own session; never the agent's.
        if (fu.owner_role === "closer" && user.role === "closer" && m <= 15 && m > -2) {
          if (claimOnce(closerEmailKey(fu))) {
            const mail = renderCloserEmail(fu);
            queueEmail(mail);
            addNotification({
              category: "Follow-ups",
              title: "Closer follow-up email queued",
              body: `Ready to send → ${mail.to} (no mail server connected)`,
            });
          }
        }
      }

      // Shift-summary email — exactly ONE, 4 hours before the user's next shift.
      if (user.role === "agent" || user.role === "closer") {
        const startISO = nextShiftStart(user.process);
        const sendAt = new Date(startISO).getTime() - SHIFT_EMAIL_LEAD_MINUTES * 60_000;
        if (now >= sendAt && now <= sendAt + 12 * 60_000) {
          if (claimOnce(shiftEmailKey(user.id, startISO))) {
            const mail = renderShiftEmail(user, followUpsForNextShift(all, user));
            queueEmail(mail);
            addNotification({
              category: "System",
              title: "Upcoming-shift summary email queued",
              body: `Ready to send → ${mail.to} (no mail server connected)`,
            });
          }
        }
      }
    };

    scan();
    const id = setInterval(scan, SCAN_MS);
    return () => clearInterval(id);
  }, [user, navigate, showCard]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  if (!active) return null;
  const { fu, threshold } = active;
  const imminent = threshold <= 1;
  const cust = resolveCustomer(fu); // customer identity resolved from the Lead

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-40 w-[min(92vw,340px)] overflow-hidden rounded-xl border bg-card shadow-lg"
      style={{ borderColor: imminent ? "var(--destructive)" : "var(--primary)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white"
        style={{ background: imminent ? "var(--destructive)" : "var(--primary)" }}
      >
        <AlarmClock className="h-4 w-4" />
        {imminent ? "Follow-up now" : `Follow-up in ${threshold} minutes`}
        <button
          type="button"
          onClick={() => setActive(null)}
          className="ml-auto rounded p-0.5 hover:bg-white/20"
          aria-label="Dismiss reminder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4">
        <p className="font-display text-base font-bold">{cust.name}</p>
        <p className="text-sm text-muted-foreground">
          {fu.follow_up_id} · {cust.phone}
        </p>
        <p className="mt-1 text-sm">
          Scheduled <span className="font-semibold">{displayTime(fu.scheduled_at)}</span>
        </p>
        {fu.comment ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">“{fu.comment}”</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-lg"
            onClick={() => {
              setActive(null);
              navigate({
                to: "/followups/$followUpId",
                params: { followUpId: fu.follow_up_id },
              });
            }}
          >
            Open follow-up
          </Button>
          {fu.lead_id ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setActive(null);
                navigate({ to: "/leads/$leadId", params: { leadId: fu.lead_id! } });
              }}
            >
              Open lead
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setActive(null)}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
