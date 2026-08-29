import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Palette, Upload } from "lucide-react";
import { toast } from "sonner";
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
import { PhotoDisplay } from "@/components/officeverse/photo/PhotoDisplay";
import { PHOTO_EFFECT_IDS } from "@/lib/officeverse/photo-effects";
import {
  fileToSquareJpegBase64,
  photoDataUrl,
  useProfilePhoto,
  useRemoveProfilePhoto,
  useSetProfilePhoto,
} from "@/lib/officeverse/use-photo";
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

/* ------------------------ real photo card ---------------------- */

function RealPhotoCard({
  name,
  role,
  designation,
  process,
  employeeId,
  email,
}: {
  name: string;
  role: keyof typeof ROLE_LABEL;
  designation: string;
  process: keyof typeof PROCESSES;
  employeeId: string;
  email: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const photoQ = useProfilePhoto();
  const setPhoto = useSetProfilePhoto();
  const removePhoto = useRemoveProfilePhoto();

  const src = photoDataUrl(photoQ.data);
  const hasPhoto = Boolean(src);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataBase64 = await fileToSquareJpegBase64(file, 512);
      await setPhoto.mutateAsync({ dataBase64 });
      toast.success("Profile photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the photo");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card className="surface-panel rounded-3xl border-border/70 p-6 text-center">
      <div className="flex justify-center">
        <PhotoDisplay name={name} process={process} src={src} size="2xl" presence="online" />
      </div>
      <h2 className="mt-3 font-display text-xl font-bold">{name}</h2>
      <p className="text-sm text-muted-foreground">
        {ROLE_LABEL[role]} · {designation}
      </p>
      <div className="mt-4 flex justify-center">
        <ProcessBadge code={process} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy || setPhoto.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          {hasPhoto ? "Replace photo" : "Upload photo"}
        </Button>
        {hasPhoto ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={removePhoto.isPending}
            onClick={() =>
              removePhoto.mutate(
                {},
                {
                  onSuccess: () => toast.success("Photo removed — showing initials"),
                  onError: (err) => toast.error(err.message || "Failed"),
                },
              )
            }
          >
            Remove
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link to="/avatar-studio">
            <Palette className="mr-2 h-4 w-4" /> Avatar Studio
          </Link>
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        JPEG / PNG / WebP · cropped to a square · stored privately. No photo → your initials.
      </p>

      <div className="mt-3">
        <button
          type="button"
          className="text-[11px] font-semibold text-primary underline"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Hide effect preview" : "Preview recognition effects"}
        </button>
      </div>
      {preview ? (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {PHOTO_EFFECT_IDS.map((id) => (
            <div key={id} className="flex flex-col items-center gap-1">
              <PhotoDisplay name={name} src={src} size="lg" effect={id} />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {id}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <Separator className="my-5" />
      <dl className="space-y-3 text-left text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Employee ID</dt>
          <dd className="font-mono">{employeeId}</dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate text-right">{email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Shift hours</dt>
          <dd>{PROCESSES[process].hours}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ProfilePage() {
  const { user, theme, toggleTheme } = useSession();
  if (!user) return null;

  return (
    <div className="space-y-7">
      <PageHeader title="My Profile" description="Your identity across the TeleMaster India." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <RealPhotoCard
          name={user.name}
          role={user.role}
          designation={user.designation}
          process={user.process}
          employeeId={user.employeeId}
          email={user.email}
        />

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
