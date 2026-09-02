import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/officeverse/primitives";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { StaffEditDialog } from "@/components/officeverse/staff-edit-dialog";
import { RoleGate } from "@/components/officeverse/role-gate";
import { useServerStaff } from "@/lib/officeverse/use-staff";
import type { StaffDTO } from "@/server/staff/service";

export const Route = createFileRoute("/_shell/agents/")({
  head: () => ({
    meta: [
      { title: "Agent List — TMI Officeverse CRM" },
      { name: "description", content: "Every sales agent — contact, shift date and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <AgentListPage />
    </RoleGate>
  ),
});

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  on_leave: "On leave",
};

function statusTone(s: string): string {
  if (s === "active") return "bg-success/12 text-success border-success/25";
  if (s === "on_leave") return "bg-info/12 text-info border-info/25";
  if (s === "suspended") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function AgentListPage() {
  const [q, setQ] = useState("");
  const { staff: rows, isLoading } = useServerStaff("agent", q.trim() || undefined);
  const [detail, setDetail] = useState<StaffDTO | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Every sales agent — contact details, operational shift date and status. Admin / HR can edit any profile; Admin can promote or remove."
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
          placeholder="Search name or email…"
          className="max-w-sm"
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          emoji="🧑‍💼"
          title={isLoading ? "Loading…" : "No agents"}
          message={
            isLoading ? "Fetching the agent directory." : "Create your first agent to get started."
          }
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
                  <TableHead>Process</TableHead>
                  <TableHead>Shift date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.code}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <StaffAvatar
                          userId={a.user_id}
                          name={a.full_name}
                          hasPhoto={a.photo_available}
                          process={a.process as never}
                          size="medium"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{a.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {a.phone || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.process}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {a.registered_on}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`rounded-full border ${statusTone(a.status)}`}
                      >
                        {STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => setDetail(a)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <StaffEditDialog staff={detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
