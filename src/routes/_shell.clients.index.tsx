import { createFileRoute, Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import {
  useServerClients,
  useUpdateServerClient,
  type ClientDTO,
} from "@/lib/officeverse/use-clients";

export const Route = createFileRoute("/_shell/clients/")({
  head: () => ({
    meta: [
      { title: "Client List — TMI Officeverse CRM" },
      { name: "description", content: "Every client organisation — contact and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <ClientListPage />
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

function statusTone(s: string): string {
  if (s === "active") return "bg-success/12 text-success border-success/25";
  if (s === "prospect") return "bg-info/12 text-info border-info/25";
  if (s === "closed") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function ClientDetailDialog({
  client,
  onOpenChange,
}: {
  client: ClientDTO | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<string>("prospect");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const updateM = useUpdateServerClient();

  useEffect(() => {
    if (client) {
      setStatus(client.status);
      setPhone(client.phone);
      setAddress(client.address);
    }
  }, [client]);

  if (!client) return null;

  const save = async () => {
    try {
      await updateM.mutateAsync({
        code: client.code,
        status: status as ClientDTO["status"],
        phone: phone.trim(),
        address: address.trim(),
      });
      toast.success("Client updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const rows: [string, string][] = [
    ["Client ID", client.code],
    ["Name", client.name],
    ["Contact", client.contact_name || "—"],
    ["Email", client.email || "—"],
    ["Registered", client.registered_on],
  ];

  return (
    <Dialog open={client != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <h2 className="font-display text-lg font-bold">{client.name}</h2>
        <p className="text-xs text-muted-foreground">Client · {client.code}</p>

        <div className="mt-4 divide-y divide-border/70">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="min-w-0 font-medium">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cl-phone">Phone</Label>
              <Input id="cl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="cl-status">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-address">Address</Label>
            <Input id="cl-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" className="rounded-lg" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="rounded-lg" onClick={save} disabled={updateM.isPending}>
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClientListPage() {
  const [q, setQ] = useState("");
  const { clients: rows, isLoading } = useServerClients(q.trim() || undefined);
  const [detail, setDetail] = useState<ClientDTO | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Client organisations — a separate entity from Agents and Closers."
        actions={
          <Button asChild className="rounded-lg">
            <Link to="/clients/new">
              <UserPlus className="mr-1.5 h-4 w-4" /> Create client
            </Link>
          </Button>
        }
      />

      <Card className="rounded-2xl border-border/70 p-4 shadow-sm">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, contact, email or ID…"
          className="max-w-sm"
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          emoji="🏢"
          title={isLoading ? "Loading…" : "No clients"}
          message={
            isLoading
              ? "Fetching the client directory."
              : "Create your first client to get started."
          }
          action={
            <Button asChild className="rounded-full">
              <Link to="/clients/new">Create client</Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.code}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.contact_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.phone || "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">
                      {c.address || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`rounded-full border ${statusTone(c.status)}`}
                      >
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => setDetail(c)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <ClientDetailDialog client={detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
