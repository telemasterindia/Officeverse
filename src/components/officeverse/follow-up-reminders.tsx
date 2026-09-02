import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { claimOnce } from "@/lib/officeverse/alerts";
import {
  displayTime,
  liveReminderThreshold,
  minutesUntil,
  reminderKey,
  type FollowUpRecord,
} from "@/lib/officeverse/followups";
import { listFollowUpsFn } from "@/lib/officeverse/followup-fns";
import { useSession } from "@/lib/officeverse/session";

const SCAN_MS = 15_000;

type Fu = {
  follow_up_id: string;
  scheduled_at: string;
  status: string;
  customer_name: string;
  phone: string;
  comment: string | null;
  lead_id: string | null;
};
type ActiveReminder = { fu: Fu; threshold: number } | null;

/**
 * In-CRM follow-up reminder — an ephemeral toast + a non-blocking floating
 * card fired 15 / 3 / 1 minutes before a SCHEDULED follow-up.
 *
 * AUTHORITATIVE SOURCE: the server follow-up list (`listFollowUpsFn`), polled
 * every 15s and already scoped to this user (an Agent sees only their own, a
 * Closer only theirs). This component only *renders* reminders — it never
 * writes business state. The per-session "don't toast twice" dedupe lives in
 * localStorage (`claimOnce`) and is UI-only.
 *
 * NOT a delivery guarantee: it runs only while a tab is open. Reliable,
 * time-based reminder + email delivery is the server scheduler's job
 * (`/internal/tick`, a future phase); the isolated localStorage email-outbox
 * demo that used to live here has been removed.
 */
export function FollowUpReminders() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveReminder>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery({
    queryKey: ["srv-followups", "reminders"],
    queryFn: () => listFollowUpsFn({ data: { pageSize: 100, status: "SCHEDULED" } }),
    enabled: !!user && (user.role === "agent" || user.role === "closer"),
    refetchInterval: SCAN_MS,
    staleTime: SCAN_MS,
  });

  const showCard = useCallback((fu: Fu, threshold: number) => {
    setActive({ fu, threshold });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), 60_000);
  }, []);

  useEffect(() => {
    if (!user || !data?.followUps) return;
    const now = Date.now();
    for (const dto of data.followUps) {
      if (dto.status !== "SCHEDULED") continue;
      const fu: Fu = {
        follow_up_id: dto.follow_up_id,
        scheduled_at: dto.scheduled_at,
        status: dto.status,
        customer_name: dto.customer_name,
        phone: dto.phone,
        comment: dto.comment,
        lead_id: dto.lead_id ?? null,
      };
      const m = minutesUntil(fu.scheduled_at, now);
      const t = liveReminderThreshold(fu as unknown as FollowUpRecord, now);
      if (t != null && claimOnce(reminderKey(fu as unknown as FollowUpRecord, t))) {
        const mins = Math.max(0, Math.ceil(m));
        const title =
          m <= 1 ? "Follow-up now" : `Follow-up in ${mins} minute${mins === 1 ? "" : "s"}`;
        toast(`⏰ ${title}`, {
          description: `${fu.customer_name} · ${fu.follow_up_id} — ${displayTime(fu.scheduled_at)}`,
          duration: m <= 1 ? 12_000 : 8_000,
          action: {
            label: "Open follow-up",
            onClick: () =>
              navigate({ to: "/followups/$followUpId", params: { followUpId: fu.follow_up_id } }),
          },
        });
        if (t <= 3) showCard(fu, t);
      }
    }
  }, [user, data, navigate, showCard]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  if (!active) return null;
  const { fu, threshold } = active;
  const imminent = threshold <= 1;

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
        <p className="font-display text-base font-bold">{fu.customer_name}</p>
        <p className="text-sm text-muted-foreground">
          {fu.follow_up_id} · {fu.phone}
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
