import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Flame, Trophy } from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { PhotoDisplay } from "@/components/officeverse/photo/PhotoDisplay";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/officeverse/session";
import { useProfilePhoto, photoDataUrl } from "@/lib/officeverse/use-photo";
import {
  useAdjustPoints,
  useGamificationParticipant,
  useLeaderboard,
  useMyGamification,
  useReversePoint,
} from "@/lib/officeverse/use-gamification";

export const Route = createFileRoute("/_shell/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — TeleMaster India" }] }),
  component: LeaderboardPage,
});

const KINDS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "alltime", label: "All-time" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

function LeaderboardPage() {
  const { user } = useSession();
  const [kind, setKind] = useState<Kind>("weekly");
  const board = useLeaderboard(kind);
  const isManager = user?.role === "admin" || user?.role === "hr";
  const isParticipant = user?.role === "agent" || user?.role === "closer";
  const myId = user ? Number(user.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Recognition points earned from your work — submitted leads, accepted leads, sales and milestones. Points are a recognition score only: they have no effect on pay, HR records or any financial calculation."
      />

      {isParticipant ? <MyStats /> : null}

      <SectionCard title="Rankings">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                kind === k.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        {board.isLoading ? (
          <Card className="rounded-xl border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
            Loading rankings…
          </Card>
        ) : board.isError ? (
          <Card className="rounded-xl border-destructive/40 bg-destructive/5 p-6 text-center text-sm shadow-sm">
            <p className="font-semibold text-destructive">Couldn't load the leaderboard.</p>
          </Card>
        ) : board.data?.dbUnavailable ? (
          <EmptyState
            emoji="🗄️"
            title="Database not connected"
            message="The leaderboard needs the database. It will populate once the DB is configured and points are earned."
          />
        ) : (board.data?.rows.length ?? 0) === 0 ? (
          <EmptyState
            emoji="🏁"
            title="No points yet"
            message="Once Admin configures point values and agents/closers start working, rankings appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 w-14">#</th>
                  <th className="px-3 py-2">Participant</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2 text-right">Points</th>
                  <th className="px-3 py-2">Streak</th>
                  {isManager ? <th className="px-3 py-2"></th> : null}
                </tr>
              </thead>
              <tbody>
                {board.data!.rows.map((r) => (
                  <tr
                    key={r.userId}
                    className={cn("border-t border-border/60", r.userId === myId && "bg-primary/5")}
                  >
                    <td className="px-3 py-2 font-bold tabular-nums text-muted-foreground">
                      {r.rank}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <PhotoDisplay
                          name={r.name}
                          size="xs"
                          {...(r.rank <= 3 ? { rank: r.rank } : {})}
                          {...(r.topBadge ? { badge: r.topBadge } : {})}
                        />
                        <span className="font-medium">{r.name}</span>
                        {!r.photoAvailable ? (
                          <span className="text-[10px] text-muted-foreground/70">no photo</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 capitalize text-muted-foreground">{r.role}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {r.points} pts
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.streak > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Flame className="h-3.5 w-3.5 text-warning" aria-hidden />
                          {r.streak}d
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {isManager ? (
                      <td className="relative px-3 py-2 text-right">
                        <ManagerPeek userId={r.userId} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {board.data && !board.data.dbUnavailable ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Window: {fmtDate(board.data.window.from)} → {fmtDate(board.data.window.to)} · ties
            broken by lowest user id. {board.data.myRank ? `Your rank: #${board.data.myRank}.` : ""}
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}

/* --------------------------- personal ------------------------- */

function MyStats() {
  const q = useMyGamification();
  const photo = useProfilePhoto();
  const d = q.data;
  if (q.isLoading) {
    return (
      <Card className="rounded-xl border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
        Loading your stats…
      </Card>
    );
  }
  if (!d || d.dbUnavailable) {
    return (
      <EmptyState
        emoji="🗄️"
        title="Database not connected"
        message="Your gamification stats need the database."
      />
    );
  }
  return (
    <Card className="rounded-xl border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-5">
        <PhotoDisplay
          name={d.name}
          src={photoDataUrl(photo.data)}
          size="lg"
          {...(d.rank.allTime ? { rank: d.rank.allTime } : {})}
        />
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
          <Stat label="All-time" value={`${d.points.allTime} pts`} />
          <Stat label="This week" value={`${d.points.weekly} pts`} />
          <Stat label="Today" value={`${d.points.daily} pts`} />
          <Stat label="All-time rank" value={d.rank.allTime ? `#${d.rank.allTime}` : "—"} />
          <Stat
            label="Current streak"
            value={d.streak.current > 0 ? `${d.streak.current} days` : "—"}
          />
          <Stat label="Best streak" value={d.streak.best > 0 ? `${d.streak.best} days` : "—"} />
          <Stat label="Achievements" value={String(d.achievements.length)} />
        </div>
      </div>

      {d.achievements.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.achievements.map((a) => (
            <span
              key={a.code}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-2.5 py-1 text-xs font-medium"
              title={a.description ?? a.name}
            >
              <Trophy className="h-3.5 w-3.5 text-primary" aria-hidden />
              {a.name}
            </span>
          ))}
        </div>
      ) : null}

      {d.recent.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Recent point events
          </p>
          <ul className="space-y-1 text-sm">
            {d.recent.slice(0, 8).map((t) => (
              <li key={t.id} className="flex justify-between gap-4 text-muted-foreground">
                <span>
                  {t.event.replace(/_/g, " ").toLowerCase()}
                  {t.status !== "ACTIVE" ? (
                    <span className="ml-1.5 text-[10px] font-bold uppercase text-destructive">
                      {t.status}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums">
                  {t.points >= 0 ? "+" : ""}
                  {t.points} · {t.operationalDate}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/* --------------------------- manager ------------------------- */

function ManagerPeek({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Why?"}
      </Button>
      {open ? <ParticipantDetail userId={userId} /> : null}
    </>
  );
}

function ParticipantDetail({ userId }: { userId: number }) {
  const q = useGamificationParticipant(userId);
  const reverse = useReversePoint();
  const adjust = useAdjustPoints();
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const d = q.data;

  return (
    <div className="absolute right-3 z-10 mt-2 w-[36rem] max-w-[90vw] rounded-xl border border-border bg-popover p-4 text-left shadow-lg">
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !d || d.dbUnavailable ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <>
          <p className="mb-1 text-sm font-semibold">
            {d.name} — {d.points.allTime} pts all-time · rank{" "}
            {d.rank.allTime ? `#${d.rank.allTime}` : "—"}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Streak {d.streak.current}d (best {d.streak.best}d) · {d.achievements.length}{" "}
            achievements
          </p>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/60 text-left uppercase">
                <tr>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Event</th>
                  <th className="px-2 py-1.5 text-right">Pts</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Reason</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((t) => (
                  <tr key={t.id} className="border-t border-border/60">
                    <td className="px-2 py-1.5 text-muted-foreground">{t.operationalDate}</td>
                    <td className="px-2 py-1.5">{t.event.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.points}</td>
                    <td className="px-2 py-1.5">{t.status}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{t.reason ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {t.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="text-destructive hover:underline disabled:opacity-50"
                          disabled={reverse.isPending}
                          onClick={() => {
                            const why = window.prompt(
                              "Reason for reversing this entry (min 5 chars):",
                            );
                            if (why && why.trim().length >= 5) {
                              reverse.mutate({ transactionId: t.id, reason: why.trim() });
                            }
                          }}
                        >
                          reverse
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(points);
              if (!Number.isInteger(n) || n === 0 || reason.trim().length < 5) return;
              adjust.mutate(
                { targetUserId: userId, points: n, reason: reason.trim() },
                {
                  onSuccess: () => {
                    setPoints("");
                    setReason("");
                  },
                },
              );
            }}
          >
            <div>
              <label className="block text-[10px] uppercase text-muted-foreground">
                Adjust ±pts
              </label>
              <Input
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                inputMode="numeric"
                className="h-8 w-24"
                placeholder="e.g. -5"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] uppercase text-muted-foreground">
                Reason (required, audited)
              </label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8"
                placeholder="Why this manual adjustment"
              />
            </div>
            <Button type="submit" size="sm" disabled={adjust.isPending}>
              Apply
            </Button>
          </form>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Manual adjustments are explicit, reason-required and written to the audit log — there is
            no “give N points” shortcut. Points never convert to money.
          </p>
        </>
      )}
    </div>
  );
}
