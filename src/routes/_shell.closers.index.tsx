import { createFileRoute, Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
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

export const Route = createFileRoute("/_shell/closers/")({
  head: () => ({
    meta: [
      { title: "Closer List — TMI Officeverse CRM" },
      { name: "description", content: "Every closer — contact, registration date and status." },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <CloserListPage />
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

function CloserListPage() {
  const [q, setQ] = useState("");
  const { staff: rows, isLoading } = useServerStaff("closer", q.trim() || undefined);
  const [detail, setDetail] = useState<StaffDTO | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Closers"
        description="Every closer — a separate role from Agents. Admin / HR can edit any profile; Admin can remove."
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
          placeholder="Search name or email…"
          className="max-w-sm"
        />
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          emoji="🎧"
          title={isLoading ? "Loading…" : "No closers"}
          message={
            isLoading
              ? "Fetching the closer directory."
              : "Create your first closer to get started."
          }
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
                  <TableHead>Process</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <StaffAvatar
                          userId={c.user_id}
                          name={c.full_name}
                          hasPhoto={c.photo_available}
                          process={c.process as never}
                          size="medium"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.phone || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.process}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.registered_on}
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
