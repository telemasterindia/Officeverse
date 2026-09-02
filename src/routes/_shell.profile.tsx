import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { PageHeader, ProcessBadge, SectionCard } from "@/components/officeverse/primitives";
import { PhotoDisplay } from "@/components/officeverse/photo/PhotoDisplay";
import {
  fileToSquareJpegBase64,
  photoDataUrl,
  useProfilePhoto,
  useRemoveProfilePhoto,
  useSetProfilePhoto,
} from "@/lib/officeverse/use-photo";
import { PROCESSES, ROLE_LABEL } from "@/lib/officeverse/data";
import { IST_TZ_LABEL } from "@/lib/officeverse/followups";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/_shell/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — TMI Officeverse" },
      {
        name: "description",
        content: "Your TMI Officeverse identity, assigned process and shift, and preferences.",
      },
    ],
  }),
  component: ProfilePage,
});

/**
 * The identity card. For an Agent / Closer everything on it is READ-ONLY — the
 * name, official photo, role, process and shift are HR records (UAT #1 / #3).
 * Only Admin / HR see the photo upload controls; the server enforces this
 * regardless of what the UI shows.
 */
function IdentityCard({
  name,
  role,
  designation,
  process,
  employeeId,
  email,
  canManagePhoto,
}: {
  name: string;
  role: keyof typeof ROLE_LABEL;
  designation: string;
  process: keyof typeof PROCESSES;
  employeeId: string;
  email: string;
  canManagePhoto: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
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

      {canManagePhoto ? (
        <>
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
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            JPEG / PNG / WebP · cropped to a square · stored privately.
          </p>
        </>
      ) : (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Your photo, name, role, process and shift are managed by HR / Admin.
        </p>
      )}

      <Separator className="my-5" />
      <dl className="space-y-3 text-left text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Employee ID</dt>
          <dd className="font-mono">{employeeId || "—"}</dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate text-right">{email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Process</dt>
          <dd className="font-semibold">{PROCESSES[process].label}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Assigned shift</dt>
          <dd>{PROCESSES[process].hours}</dd>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
          <dt className="text-muted-foreground">Timezone</dt>
          <dd className="text-right">{IST_TZ_LABEL}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        All dates and times across Officeverse are shown in {IST_TZ_LABEL}. Your shift is fixed by
        your process and cannot be changed here.
      </p>
    </Card>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="rounded-lg bg-secondary/40 px-3 py-2 text-sm">{value || "—"}</p>
    </div>
  );
}

function ProfilePage() {
  const { user, theme, toggleTheme } = useSession();
  if (!user) return null;

  const canManagePhoto = user.role === "admin" || user.role === "hr";

  return (
    <div className="space-y-7">
      <PageHeader title="My Profile" description="Your identity across TMI Officeverse." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <IdentityCard
          name={user.name}
          role={user.role}
          designation={user.designation}
          process={user.process}
          employeeId={user.employeeId}
          email={user.email}
          canManagePhoto={canManagePhoto}
        />

        <div className="space-y-5">
          <SectionCard
            title="Details"
            description="Read-only. Contact HR / Admin to update your record."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnlyRow label="Full name" value={user.name} />
              <ReadOnlyRow label="Email" value={user.email} />
              <ReadOnlyRow label="Designation" value={user.designation} />
              <ReadOnlyRow label="Employee ID" value={user.employeeId} />
              <ReadOnlyRow label="Process" value={PROCESSES[user.process].label} />
              <ReadOnlyRow label="Shift (IST)" value={PROCESSES[user.process].hours} />
            </div>
          </SectionCard>

          <SectionCard
            title="Preferences"
            description="Personal display preference — this device only."
          >
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
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
