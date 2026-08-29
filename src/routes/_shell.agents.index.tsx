import { createFileRoute, Link } from "@tanstack/react-router";
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
import { shiftWindow } from "@/lib/officeverse/shift";
import { PERSON_STATUSES, updatePerson, type PersonRecord } from "@/lib/officeverse/people";
import { usePeople } from "@/lib/officeverse/use-crm";
import { UserPlus } from "lucide-react";

export const Route = createFileRoute("/_shell/agents/")({
  head: () => ({
    meta: [
      { title: "Agent List — TeleMaster India" },
      { name: "description", content: "Every sales agent — contact, shift date and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <AgentListPage />
    </RoleGate>
  ),
});

function statusTone(s: PersonRecord["status"]): string {
  if (s === "Active") return "bg-success/12 text-success border-success/25";
  if (s === "On Leave") return "bg-info/12 text-info border-info/25";
  if (s === "Suspended") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function AgentDetailDialog({
  agent,
  onOpenChange,
}: {
  agent: PersonRecord | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<PersonRecord["status"]>("Active");
  const [phone, setPhone] = useState("");
  const [salary, setSalary] = useState("");

  useEffect(() => {
    if (agent) {
      setStatus(agent.status);
      setPhone(agent.phone);
      setSalary(agent.monthly_salary ? String(agent.monthly_salary) : "");
    }
  }, [agent]);

  if (!agent) return null;
  const win = shiftWindow(agent.process);

  const save = () => {
    updatePerson(agent.id, {
      status,
      phone: phone.trim(),
      monthly_salary: Number(salary.replace(/[^0-9.]/g, "")) || 0,
    });
    toast.success("Agent updated");
    onOpenChange(false);
  };

  const rows: [string, string][] = [
    ["Agent ID", agent.id],
    ["Full name", agent.full_name],
    ["Email", agent.email],
    ["Date of birth", agent.dob || "—"],
    ["Shift date", agent.registered_on],
    ["Shift window", `${win.start} → ${win.end} ${agent.process} (IST)`],
    ["Process", agent.process],
  ];

  return (
    <Dialog open={agent != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        <div className="flex items-center gap-3">
          <PeerAvatar name={agent.full_name} size="large" />
          <div>
            <h2 className="font-display text-lg font-bold">{agent.full_name}</h2>
            <p className="text-xs text-muted-foreground">Agent · {agent.id}</p>
          </div>
        </div>

        <div className="mt-4 divide-y divide-border/70">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="min-w-0 font-medium">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ed-phone">Phone</Label>
            <Input id="ed-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-salary">Monthly salary</Label>
            <Input
              id="ed-salary"
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PersonRecord["status"])}>
              <SelectTrigger id="ed-status">
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

function AgentListPage() {
  const agents = usePeople("agent");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<PersonRecord | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return agents.filter(
      (a) =>
        !s ||
        a.full_name.toLowerCase().includes(s) ||
        a.email.toLowerCase().includes(s) ||
        a.id.toLowerCase().includes(s) ||
        a.phone.includes(s),
    );
  }, [agents, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Every sales agent — contact details, operational shift date and status."
        actions={
          <Button asChild className="rounded-lg">
            <Link to="/agents/new">
              <UserPlus className="mr-1.5 h-4 w-4" /> Create agent
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
          emoji="🧑‍💼"
          title="No agents"
          message="Create your first agent to get started."
          action={
            <Button asChild className="rounded-full">
              <Link to="/agents/new">Create agent</Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Shift date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <PeerAvatar name={a.full_name} size="small" process={a.process} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{a.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {a.phone || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {a.registered_on}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`rounded-full border ${statusTone(a.status)}`}
                      >
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => setDetail(a)}
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

      <AgentDetailDialog agent={detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
