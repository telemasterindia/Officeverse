import { createFileRoute } from "@tanstack/react-router";
import { Circle } from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { Card } from "@/components/ui/card";
import { useAgentPresence } from "@/lib/officeverse/use-presence";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/presence")({
  head: () => ({ meta: [{ title: "Agent Presence — TeleMaster India" }] }),
  component: PresencePage,
});

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const STATUS_STYLE: Record<string, string> = {
  ONLINE: "text-success",
  IDLE: "text-warning",
  OFFLINE: "text-muted-foreground",
};

function PresencePage() {
  const { user } = useSession();
  const q = useAgentPresence();

  if (user?.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Agent Presence" description="Who is logged in right now." />
        <EmptyState
          emoji="🔒"
          title="Admins only"
          message="Live presence is restricted to Admins."
        />
      </div>
    );
  }

  const data = q.data;
  const rows = data?.agents ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Presence"
        description="Server-derived from active sessions. ONLINE = activity in the last 5 minutes · IDLE = logged in but idle · OFFLINE = no active session."
      />

      <SectionCard title="Agents">
        {q.isLoading ? (
          <Card className="rounded-xl border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
            Loading presence…
          </Card>
        ) : q.isError ? (
          <Card className="rounded-xl border-destructive/40 bg-destructive/5 p-6 text-center text-sm shadow-sm">
            <p className="font-semibold text-destructive">Couldn't load presence.</p>
          </Card>
        ) : data?.dbUnavailable ? (
          <EmptyState
            emoji="🗄️"
            title="Database not connected"
            message="Agent presence needs the production/local database. It will populate once the DB is configured."
          />
        ) : rows.length === 0 ? (
          <EmptyState emoji="🧑‍💼" title="No agents yet" message="No agent accounts exist." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Login time</th>
                  <th className="px-3 py-2">Last active</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">Process</th>
                  <th className="px-3 py-2">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.agentCode} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="ml-2 text-[11px] text-muted-foreground">{a.agentCode}</span>
                      {a.accountStatus !== "active" ? (
                        <span className="ml-2 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">
                          {a.accountStatus}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn("px-3 py-2 font-semibold", STATUS_STYLE[a.status])}>
                      <Circle className="mr-1 inline h-2.5 w-2.5 fill-current" aria-hidden />
                      {a.status}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtTime(a.loginAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtTime(a.lastActiveAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {a.shiftName} · {a.shiftWindow}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{a.process}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.sessionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
