import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, ProcessBadge, SectionCard } from "@/components/officeverse/primitives";
import { PROCESSES } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";
import type { ProcessCode } from "@/lib/officeverse/types";

export const Route = createFileRoute("/_shell/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TeleMaster India" },
      {
        name: "description",
        content: "Configure processes, notifications, appearance and platform behaviour.",
      },
      { property: "og:title", content: "Settings — TeleMaster India" },
      { property: "og:description", content: "Platform configuration for the operations floor." },
    ],
  }),
  component: SettingsPage,
});

const TOGGLES: { id: string; label: string; hint: string; on: boolean }[] = [
  {
    id: "dup",
    label: "Duplicate phone detection",
    hint: "Warn agents before a duplicate lead is submitted.",
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

function SettingsPage() {
  const { user, theme, toggleTheme, setProcess } = useSession();
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
              <Input id="org" defaultValue="TeleMaster India" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">Default timezone</Label>
              <Select defaultValue="IST">
                <SelectTrigger id="tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["IST", "GMT", "EST", "AEST"].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="rounded-full" onClick={() => toast.success("Settings saved")}>
              Save changes
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Processes" description="Active campaigns and their default process">
          <div className="space-y-3">
            {(Object.keys(PROCESSES) as ProcessCode[]).map((code) => (
              <div
                key={code}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-secondary/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <ProcessBadge code={code} />
                </div>
                <Button
                  size="sm"
                  variant={user.process === code ? "default" : "outline"}
                  className="shrink-0 rounded-full"
                  onClick={() => setProcess(code)}
                >
                  {user.process === code ? "Active" : "Set active"}
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

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
