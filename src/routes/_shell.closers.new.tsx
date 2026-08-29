import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, UserPlus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
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
import { PhotoPickerField } from "@/components/officeverse/identity-controls";
import { RoleGate } from "@/components/officeverse/role-gate";
import { PROCESSES } from "@/lib/officeverse/data";
import { setEmployeePhoto } from "@/lib/officeverse/identity";
import { createPerson, PERSON_STATUSES, type PersonRecord } from "@/lib/officeverse/people";
import { shiftDateIST } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";

export const Route = createFileRoute("/_shell/closers/new")({
  head: () => ({ meta: [{ title: "Create Closer — TeleMaster India" }] }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <CreateCloserPage />
    </RoleGate>
  ),
});

function CreateCloserPage() {
  const [process, setProcess] = useState<ProcessCode>("US");
  const [status, setStatus] = useState<PersonRecord["status"]>("Active");
  const [photo, setPhoto] = useState<string | null>(null);
  const [created, setCreated] = useState<PersonRecord | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const reset = () => {
    setCreated(null);
    setPhoto(null);
    setStatus("Active");
    setProcess("US");
    formRef.current?.reset();
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("full_name") || !s("email") || !s("password")) return;
    const rec = createPerson({
      kind: "closer",
      full_name: s("full_name"),
      email: s("email"),
      password: s("password"),
      phone: s("phone"),
      dob: s("dob"),
      ...(s("registered_on") ? { registered_on: s("registered_on") } : {}),
      status,
      process,
    });
    if (photo) setEmployeePhoto(rec.full_name, photo);
    toast.success("Closer created", { description: `${rec.full_name} · ${rec.id}` });
    setCreated(rec);
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/closers"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          ← Closer list
        </Link>
        <PageHeader
          title="Create closer"
          description="Register a new closer. A Closer is a separate role from an Agent."
        />
      </div>

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard title="Closer details" description="All fields marked * are required.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="registered_on">Date of registration</Label>
              <Input
                id="registered_on"
                name="registered_on"
                type="date"
                defaultValue={shiftDateIST()}
              />
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
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Set a login password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as PersonRecord["status"])}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERSON_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Profile picture</Label>
              <PhotoPickerField value={photo} onChange={setPhoto} />
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button type="submit" className="rounded-lg px-6 py-5 text-base font-semibold">
            <UserPlus className="mr-2 h-4 w-4" /> Create closer
          </Button>
        </div>
      </form>

      <Dialog open={created != null} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-sm rounded-2xl text-center">
          <div className="py-4">
            <span
              className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/12 text-success"
              aria-hidden
            >
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-xl font-bold">Closer created</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {created?.full_name} · {created?.id}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button asChild className="rounded-lg">
                <Link to="/closers">Go to Closer list</Link>
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
