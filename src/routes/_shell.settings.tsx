import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader, ProcessBadge, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { PROCESSES } from "@/lib/officeverse/data";
import { IST_TZ_LABEL } from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";
import { useSystemStatus } from "@/lib/officeverse/use-system";
import { cn } from "@/lib/utils";
import type { ProcessCode } from "@/lib/officeverse/types";

export const Route = createFileRoute("/_shell/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TMI Officeverse" },
      {
        name: "description",
        content: "Platform configuration for the operations floor. Admin / HR only.",
      },
    ],
  }),
  // UAT #2: Settings is an Admin / HR screen — Agents / Closers have no access.
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <SettingsPage />
    </RoleGate>
  ),
});

const TOGGLES: { id: string; label: string; hint: string; on: boolean }[] = [
  {
    id: "dup",
    label: "Duplicate phone detection",
    hint: "Always enforced server-side for Agents — a duplicate US phone is rejected on submit.",
    on: true,
  },
  {
    id: "quote",
    label: "Shift-start quote popup",
    hint: "Show a motivational card once per day per user.",
    on: true,
  },
  {
    id: "remind",
    label: "Follow-up reminders",
    hint: "Ping owners 15 minutes before a scheduled follow-up.",
    on: true,
  },
  {
    id: "auto",
    label: "Auto-assign new leads",
    hint: "Route new leads to the closer with the lightest queue.",
    on: false,
  },
  {
    id: "audit",
    label: "Verbose audit logging",
    hint: "Record field-level changes, not just actions.",
    on: false,
  },
];

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 px-4 py-2.5 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold uppercase",
            ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {ok ? "OK" : "check"}
        </span>
      </span>
    </div>
  );
}

function ProductionReadiness() {
  const q = useSystemStatus(false);
  const d = q.data;
  return (
    <SectionCard
      title="Production readiness"
      description="Status only — no secrets are shown. Deep DB checks run server-side via the cron endpoint."
    >
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">Status unavailable.</p>
      ) : (
        <div className="space-y-2">
          <StatusRow ok={d.database.configured} label="Database configured" detail={d.nodeEnv} />
          <StatusRow
            ok={d.migrations.localCount > 0}
            label="Migrations bundled"
            detail={`${d.migrations.localCount} files`}
          />
          <StatusRow
            ok={d.session.secureCookies || d.nodeEnv !== "production"}
            label="Session cookies"
            detail={`${d.session.cookieName} · httpOnly · SameSite=Lax · secure=${d.session.secureCookies}`}
          />
          <StatusRow
            ok={d.email.configured}
            label="Email provider"
            detail={d.email.provider ?? d.email.reason ?? "not configured"}
          />
          <StatusRow
            ok={d.storage.durable}
            label="Salary-slip storage"
            detail={`${d.storage.provider}${d.storage.rootConfigured ? " · root set" : " · in-memory"}`}
          />
          <StatusRow
            ok={d.automation.cronSecretConfigured}
            label="Cron secret"
            detail={d.automation.cronSecretConfigured ? "set" : "unset"}
          />
        </div>
      )}
    </SectionCard>
  );
}

function SettingsPage() {
  const { user, theme, toggleTheme } = useSession();
  if (!user) return null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Settings"
        description="How the platform behaves for everyone on the floor."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Organisation" description="Names shown across the platform">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org">Organisation name</Label>
              <Input id="org" defaultValue="TMI Officeverse" />
            </div>
            <div className="space-y-2">
              <Label>Platform timezone</Label>
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-sm font-medium">
                {IST_TZ_LABEL}
              </p>
              <p className="text-xs text-muted-foreground">
                Officeverse runs on India Standard Time everywhere — every date, shift, follow-up
                and reminder. This is fixed and not configurable.
              </p>
            </div>
            <Button className="rounded-full" onClick={() => toast.success("Settings saved")}>
              Save changes
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Processes" description="Active campaigns and their shift windows (IST)">
          <div className="space-y-3">
            {(Object.keys(PROCESSES) as ProcessCode[]).map((code) => (
              <div
                key={code}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-secondary/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <ProcessBadge code={code} />
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {PROCESSES[code].hours}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {user.role === "admin" ? <ProductionReadiness /> : null}

      <SectionCard title="Platform behaviour">
        <div className="space-y-3">
          {TOGGLES.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl bg-secondary/40 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.hint}</p>
              </div>
              <Switch defaultChecked={t.on} className="shrink-0" />
            </div>
          ))}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl bg-secondary/40 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Dark mode</p>
              <p className="text-xs text-muted-foreground">
                TeleMaster India looks best after dark.
              </p>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} className="shrink-0" />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
