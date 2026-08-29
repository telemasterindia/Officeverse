import { createFileRoute, Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { CLIENT_STATUSES, updateClient, type ClientRecord } from "@/lib/officeverse/clients";
import { useClients } from "@/lib/officeverse/use-crm";

export const Route = createFileRoute("/_shell/clients/")({
  head: () => ({
    meta: [
      { title: "Client List — TeleMaster India" },
      { name: "description", content: "Every client organisation — contact and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <ClientListPage />
    </RoleGate>
  ),
});

function statusTone(s: ClientRecord["status"]): string {
  if (s === "Active") return "bg-success/12 text-success border-success/25";
  if (s === "Prospect") return "bg-info/12 text-info border-info/25";
  if (s === "Closed") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function ClientDetailDialog({
  client,
  onOpenChange,
}: {
  client: ClientRecord | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<ClientRecord["status"]>("Prospect");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (client) {
      setStatus(client.status);
      setPhone(client.phone);
      setAddress(client.address);
    }
  }, [client]);

  if (!client) return null;

  const save = () => {
    updateClient(client.id, { status, phone: phone.trim(), address: address.trim() });
    toast.success("Client updated");
    onOpenChange(false);
  };

  const rows: [string, string][] = [
    ["Client ID", client.id],
    ["Name", client.name],
    ["Contact", client.contact_name || "—"],
    ["Email", client.email],
    ["Registered", client.registered_on],
  ];

  return (
    <Dialog open={client != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <h2 className="font-display text-lg font-bold">{client.name}</h2>
        <p className="text-xs text-muted-foreground">Client · {client.id}</p>

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
              <Select value={status} onValueChange={(v) => setStatus(v as ClientRecord["status"])}>
                <SelectTrigger id="cl-status">
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
          <Button className="rounded-lg" onClick={save}>
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClientListPage() {
  const clients = useClients();
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<ClientRecord | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return clients.filter(
      (c) =>
        !s ||
        c.name.toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        c.contact_name.toLowerCase().includes(s) ||
        c.id.toLowerCase().includes(s),
    );
  }, [clients, q]);

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
          title="No clients"
          message="Create your first client to get started."
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
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.id}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.contact_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email}</TableCell>
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
                        {c.status}
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
