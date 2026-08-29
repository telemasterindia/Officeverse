import { createFileRoute, Link } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  ActivityTimeline,
  PageHeader,
  ProcessBadge,
  SectionCard,
} from "@/components/officeverse/primitives";
import { CharacterStage } from "@/components/officeverse/character-stage";
import { IdentityToggle, PhotoUploadField } from "@/components/officeverse/identity-controls";
import { useEmployeePhoto, useIdentityMode } from "@/lib/officeverse/identity";
import { AUDIT, PROCESSES, ROLE_LABEL } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — TeleMaster India" },
      {
        name: "description",
        content: "Your TeleMaster India profile, process, preferences and recent activity.",
      },
      { property: "og:title", content: "My Profile — TeleMaster India" },
      {
        property: "og:description",
        content: "Manage your workspace preferences and see your recent activity.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, theme, toggleTheme } = useSession();
  const [idMode, setIdMode] = useIdentityMode("photo");
  const photo = useEmployeePhoto(user?.name ?? "");
  if (!user) return null;
  const showPhoto = idMode === "photo" && !!photo;

  return (
    <div className="space-y-7">
      <PageHeader title="My Profile" description="Your identity across the TeleMaster India." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="surface-panel rounded-3xl border-border/70 p-6 text-center">
          <div className="mb-3 flex justify-center">
            <IdentityToggle mode={idMode} onChange={setIdMode} />
          </div>
          <div className="flex justify-center">
            {showPhoto ? (
              <img
                src={photo}
                alt={user.name}
                className="h-40 w-40 rounded-3xl object-cover ring-1 ring-border"
              />
            ) : (
              <CharacterStage
                name={user.name}
                process={user.process}
                presence="online"
                showShiftBadge={false}
              />
            )}
          </div>
          <h2 className="mt-3 font-display text-xl font-bold">{user.name}</h2>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABEL[user.role]} · {user.designation}
          </p>
          <div className="mt-4 flex justify-center">
            <ProcessBadge code={user.process} />
          </div>
          <div className="mt-4 flex flex-col items-center gap-3">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to="/avatar-studio">
                <Palette className="mr-2 h-4 w-4" /> Open Avatar Studio
              </Link>
            </Button>
            <PhotoUploadField name={user.name} />
          </div>
          <Separator className="my-5" />
          <dl className="space-y-3 text-left text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Employee ID</dt>
              <dd className="font-mono">{user.employeeId}</dd>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate text-right">{user.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Shift hours</dt>
              <dd>{PROCESSES[user.process].hours}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-5">
          <SectionCard title="Details" description="Contact information used across the workspace">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-name">Full name</Label>
                <Input id="p-name" defaultValue={user.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-email">Email</Label>
                <Input id="p-email" defaultValue={user.email} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-phone">Phone</Label>
                <Input id="p-phone" placeholder="Enter your phone number" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-desig">Designation</Label>
                <Input id="p-desig" defaultValue={user.designation} readOnly />
              </div>
            </div>
            <Button className="mt-5 rounded-full">Save changes</Button>
          </SectionCard>

          <SectionCard title="Preferences">
            <div className="space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Dark theme</p>
                  <p className="text-xs text-muted-foreground">
                    Easier on the eyes for night shifts.
                  </p>
                </div>
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={toggleTheme}
                  aria-label="Dark theme"
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Shift start popup</p>
                  <p className="text-xs text-muted-foreground">
                    Show the daily motivation card once per shift.
                  </p>
                </div>
                <Switch defaultChecked aria-label="Shift start popup" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Follow-up reminders</p>
                  <p className="text-xs text-muted-foreground">
                    Alert me 15 minutes before a follow-up.
                  </p>
                </div>
                <Switch defaultChecked aria-label="Follow-up reminders" />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent activity">
            <ActivityTimeline items={AUDIT.slice(0, 5)} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
