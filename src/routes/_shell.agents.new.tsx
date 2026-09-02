import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, UserPlus } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { PROCESSES } from "@/lib/officeverse/data";
import { shiftDateIST, shiftWindow } from "@/lib/officeverse/shift";
import { fileToSquareJpegBase64 } from "@/lib/officeverse/use-photo";
import { useCreateServerStaff, type StaffKind } from "@/lib/officeverse/use-staff";
import type { StaffDTO } from "@/server/staff/service";
import type { ProcessCode } from "@/lib/officeverse/types";

export const Route = createFileRoute("/_shell/agents/new")({
  head: () => ({
    meta: [{ title: "Create Agent — TMI Officeverse CRM" }],
  }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <CreateAgentPage />
    </RoleGate>
  ),
});

const STATUS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
  { value: "on_leave", label: "On leave" },
];

const KIND: StaffKind = "agent";

function CreateAgentPage() {
  const [process, setProcess] = useState<ProcessCode>("US");
  const [status, setStatus] = useState("active");
  const [created, setCreated] = useState<StaffDTO | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const createM = useCreateServerStaff();

  const win = shiftWindow(process);

  // revoke the object URL when it changes / on unmount (no leak)
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const onPhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    });
  };

  const reset = () => {
    setCreated(null);
    setStatus("active");
    setProcess("US");
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    formRef.current?.reset();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (createM.isPending) return;
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("full_name") || !s("email") || !s("password")) return;

    let photo_base64: string | undefined;
    const photoFile = fd.get("photo");
    if (photoFile instanceof File && photoFile.size > 0) {
      try {
        photo_base64 = await fileToSquareJpegBase64(photoFile);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "That photo could not be processed");
        return;
      }
    }

    const rawSalary = s("base_salary");
    const baseSalaryNum = rawSalary ? Number(rawSalary) : NaN;

    try {
      const res = await createM.mutateAsync({
        kind: KIND,
        full_name: s("full_name"),
        email: s("email"),
        password: s("password"),
        process,
        status,
        ...(s("phone") ? { phone: s("phone") } : {}),
        ...(s("dob") ? { dob: s("dob") } : {}),
        ...(s("joining_date") ? { joining_date: s("joining_date") } : {}),
        ...(s("registered_on") ? { registered_on: s("registered_on") } : {}),
        ...(Number.isFinite(baseSalaryNum) && baseSalaryNum >= 0
          ? { base_salary: baseSalaryNum }
          : {}),
        ...(photo_base64 ? { photo_base64 } : {}),
      });
      toast.success(`Agent created — Employee ID ${res.staff.code}`, {
        description: res.staff.full_name,
      });
      setCreated(res.staff);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the agent");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/agents"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          ← Agent list
        </Link>
        <PageHeader
          title="Create agent"
          description="Register a new sales agent — this creates their real login and profile. Base salary here is written straight into Payroll; the agent never sees it."
        />
      </div>

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard title="Agent details" description="All fields marked * are required.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="registered_on">Date of registration / shift date</Label>
              <Input
                id="registered_on"
                name="registered_on"
                type="date"
                defaultValue={shiftDateIST()}
              />
              <p className="text-xs text-muted-foreground">
                Shift date (IST) — window {win.start} → {win.end}, unaffected by midnight.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="process">Process</Label>
              <Select value={process} onValueChange={(v) => setProcess(v as ProcessCode)}>
                <SelectTrigger id="process">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PROCESSES).map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="full_name">Full name *</Label>
              <Input id="full_name" name="full_name" placeholder="Enter full name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" name="dob" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="joining_date">Joining date</Label>
              <Input
                id="joining_date"
                name="joining_date"
                type="date"
                defaultValue={shiftDateIST()}
              />
              <p className="text-xs text-muted-foreground">
                Official start date — drives the salary-profile effective-from date and appears on
                the salary slip.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" name="phone" inputMode="tel" placeholder="Enter phone number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                placeholder="Enter email address"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Temporary password *</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Min 8 characters — they must change it at first login"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="base_salary">Monthly base salary (₹)</Label>
              <Input
                id="base_salary"
                name="base_salary"
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="e.g. 31000"
              />
              <p className="text-xs text-muted-foreground">
                Written to Payroll, effective from the registration date. Never shown to the agent.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="photo">Official profile photo</Label>
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-xs text-muted-foreground">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Selected profile photo preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    "No photo"
                  )}
                </div>
                <Input
                  id="photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onPhotoChange}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Set by Admin / HR only. Cropped to a square and compressed in your browser before
                upload (max 5&nbsp;MB). The agent cannot change it later.
              </p>
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={createM.isPending}
            className="rounded-lg px-6 py-5 text-base font-semibold"
          >
            <UserPlus className="mr-2 h-4 w-4" /> {createM.isPending ? "Creating…" : "Create agent"}
          </Button>
        </div>
      </form>

      <Dialog open={created != null} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-sm rounded-2xl text-center">
          <div className="py-4">
            {photoPreview ? (
              <img
                src={photoPreview}
                alt={`${created?.full_name ?? "Agent"} photo`}
                className="mx-auto h-20 w-20 rounded-full border border-border object-cover"
              />
            ) : (
              <span
                className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/12 text-success"
                aria-hidden
              >
                <CheckCircle2 className="h-6 w-6" />
              </span>
            )}
            <h2 className="mt-4 font-display text-xl font-bold">Agent created</h2>
            <p className="mt-1 text-sm text-muted-foreground">{created?.full_name}</p>
            <div className="mx-auto mt-3 w-fit rounded-lg bg-muted px-3 py-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Employee ID
              </span>
              <div className="font-mono text-base font-bold tabular-nums">{created?.code}</div>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <Button asChild className="rounded-lg">
                <Link to="/agents">Go to Agent list</Link>
              </Button>
              <Button variant="ghost" className="rounded-lg" onClick={reset}>
                Create another
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
