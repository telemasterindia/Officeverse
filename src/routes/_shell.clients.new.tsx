import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, UserPlus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { CLIENT_STATUSES, createClient, type ClientRecord } from "@/lib/officeverse/clients";
import { shiftDateIST } from "@/lib/officeverse/shift";

export const Route = createFileRoute("/_shell/clients/new")({
  head: () => ({ meta: [{ title: "Create Client — TeleMaster India" }] }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <CreateClientPage />
    </RoleGate>
  ),
});

function CreateClientPage() {
  const [status, setStatus] = useState<ClientRecord["status"]>("Prospect");
  const [created, setCreated] = useState<ClientRecord | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const reset = () => {
    setCreated(null);
    setStatus("Prospect");
    formRef.current?.reset();
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("name") || !s("email")) return;
    const rec = createClient({
      name: s("name"),
      contact_name: s("contact_name"),
      email: s("email"),
      phone: s("phone"),
      address: s("address"),
      status,
      ...(s("registered_on") ? { registered_on: s("registered_on") } : {}),
    });
    toast.success("Client created", { description: `${rec.name} · ${rec.id}` });
    setCreated(rec);
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/clients"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          ← Client list
        </Link>
        <PageHeader
          title="Create client"
          description="Register a new client organisation. A Client is not an Agent or Closer."
        />
      </div>

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard title="Client details" description="All fields marked * are required.">
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
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ClientRecord["status"])}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Full name / company name *</Label>
              <Input id="name" name="name" placeholder="Enter client or company name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact_name">Primary contact</Label>
              <Input id="contact_name" name="contact_name" placeholder="Contact person" />
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" rows={2} placeholder="Enter address" />
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button type="submit" className="rounded-lg px-6 py-5 text-base font-semibold">
            <UserPlus className="mr-2 h-4 w-4" /> Create client
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
            <h2 className="mt-4 font-display text-xl font-bold">Client created</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {created?.name} · {created?.id}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button asChild className="rounded-lg">
                <Link to="/clients">Go to Client list</Link>
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
