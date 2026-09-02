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
import { useCreateServerClient, type ClientDTO } from "@/lib/officeverse/use-clients";
import { shiftDateIST } from "@/lib/officeverse/shift";

export const Route = createFileRoute("/_shell/clients/new")({
  head: () => ({ meta: [{ title: "Create Client — TMI Officeverse CRM" }] }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <CreateClientPage />
    </RoleGate>
  ),
});

const STATUS_OPTS = ["active", "prospect", "inactive", "closed"] as const;
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  prospect: "Prospect",
  inactive: "Inactive",
  closed: "Closed",
};

function CreateClientPage() {
  const [status, setStatus] = useState<string>("prospect");
  const [created, setCreated] = useState<ClientDTO | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const createM = useCreateServerClient();

  const reset = () => {
    setCreated(null);
    setStatus("prospect");
    formRef.current?.reset();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("name")) return;
    try {
      const { client } = await createM.mutateAsync({
        name: s("name"),
        status,
        ...(s("contact_name") ? { contact_name: s("contact_name") } : {}),
        ...(s("email") ? { email: s("email") } : {}),
        ...(s("phone") ? { phone: s("phone") } : {}),
        ...(s("address") ? { address: s("address") } : {}),
        ...(s("registered_on") ? { registered_on: s("registered_on") } : {}),
      });
      toast.success("Client created", { description: `${client.name} · ${client.code}` });
      setCreated(client);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the client");
    }
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
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                placeholder="Enter email address"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" rows={2} placeholder="Enter address" />
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button
            type="submit"
            className="rounded-lg px-6 py-5 text-base font-semibold"
            disabled={createM.isPending}
          >
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
              {created?.name} · {created?.code}
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
