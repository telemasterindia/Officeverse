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
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { RoleGate } from "@/components/officeverse/role-gate";
import { PERSON_STATUSES, updatePerson, type PersonRecord } from "@/lib/officeverse/people";
import { usePeople } from "@/lib/officeverse/use-crm";

export const Route = createFileRoute("/_shell/closers/")({
  head: () => ({
    meta: [
      { title: "Closer List — TeleMaster India" },
      { name: "description", content: "Every closer — contact, registration date and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <CloserListPage />
    </RoleGate>
  ),
});

function statusTone(s: PersonRecord["status"]): string {
  if (s === "Active") return "bg-success/12 text-success border-success/25";
  if (s === "On Leave") return "bg-info/12 text-info border-info/25";
  if (s === "Suspended") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function CloserDetailDialog({
  closer,
  onOpenChange,
}: {
  closer: PersonRecord | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<PersonRecord["status"]>("Active");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (closer) {
      setStatus(closer.status);
      setPhone(closer.phone);
    }
  }, [closer]);

  if (!closer) return null;

  const save = () => {
    updatePerson(closer.id, { status, phone: phone.trim() });
    toast.success("Closer updated");
    onOpenChange(false);
  };

  const rows: [string, string][] = [
    ["Closer ID", closer.id],
    ["Full name", closer.full_name],
    ["Email", closer.email],
    ["Date of birth", closer.dob || "—"],
    ["Date of registration", closer.registered_on],
    ["Process", closer.process],
  ];

  return (
    <Dialog open={closer != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <div className="flex items-center gap-3">
          <PeerAvatar name={closer.full_name} size="large" />
          <div>
            <h2 className="font-display text-lg font-bold">{closer.full_name}</h2>
            <p className="text-xs text-muted-foreground">Closer · {closer.id}</p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-border/70">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="min-w-0 font-medium">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cd-phone">Phone</Label>
            <Input id="cd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PersonRecord["status"])}>
              <SelectTrigger id="cd-status">
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

function CloserListPage() {
  const closers = usePeople("closer");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<PersonRecord | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return closers.filter(
      (c) =>
        !s ||
        c.full_name.toLowerCase().includes(s) ||
        c.email.toLowerCase().includes(s) ||
        c.id.toLowerCase().includes(s) ||
        c.phone.includes(s),
    );
  }, [closers, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Closers"
        description="Every closer — a separate role from Agents. Contact details and status."
        actions={
          <Button asChild className="rounded-lg">
            <Link to="/closers/new">
              <UserPlus className="mr-1.5 h-4 w-4" /> Create closer
            </Link>
          </Button>
        }
      />

      <Card className="rounded-2xl border-border/70 p-4 shadow-sm">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone or ID…"
          className="max-w-sm"
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          emoji="🎧"
          title="No closers"
          message="Create your first closer to get started."
          action={
            <Button asChild className="rounded-full">
              <Link to="/closers/new">Create closer</Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Closer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <PeerAvatar name={c.full_name} size="small" process={c.process} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.phone || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.registered_on}
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

      <CloserDetailDialog closer={detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
