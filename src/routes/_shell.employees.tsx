import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  EmptyState,
  PageHeader,
  ProcessBadge,
  SectionCard,
} from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { StaffEditDialog } from "@/components/officeverse/staff-edit-dialog";
import { Button } from "@/components/ui/button";
import { useServerStaff } from "@/lib/officeverse/use-staff";
import type { StaffDTO } from "@/server/staff/service";

export const Route = createFileRoute("/_shell/employees")({
  head: () => ({
    meta: [
      { title: "Employees — TMI Officeverse CRM" },
      {
        name: "description",
        content: "Searchable directory of every agent and closer with process and status.",
      },
      { property: "og:title", content: "Employees — TMI Officeverse CRM" },
      {
        property: "og:description",
        content: "Employee directory with roles, processes and status.",
      },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "hr"]}>
      <EmployeesPage />
    </RoleGate>
  ),
});

const ROLE_FILTER = ["All", "Agents", "Closers"] as const;
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  on_leave: "On leave",
};

function EmployeesPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<(typeof ROLE_FILTER)[number]>("All");
  const [detail, setDetail] = useState<StaffDTO | null>(null);
  const { staff: agents } = useServerStaff("agent");
  const { staff: closers } = useServerStaff("closer");

  const rows = useMemo(() => {
    const all = [
      ...(role !== "Closers" ? agents.map((a) => ({ ...a, roleLabel: "Sales Agent" })) : []),
      ...(role !== "Agents" ? closers.map((c) => ({ ...c, roleLabel: "Closer" })) : []),
    ];
    const s = q.trim().toLowerCase();
    return all.filter(
      (e) =>
        !s ||
        e.full_name.toLowerCase().includes(s) ||
        e.email.toLowerCase().includes(s) ||
        e.code.toLowerCase().includes(s),
    );
  }, [agents, closers, role, q]);

  return (
    <div className="space-y-7">
      <PageHeader title="Employees" description="One directory for every agent and closer." />

      <SectionCard title={`${rows.length} people`}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or ID"
            className="rounded-full sm:max-w-xs"
          />
          <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLE_FILTER)[number])}>
            <SelectTrigger className="rounded-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTER.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="No one matches" message="Try another name, ID or role." />
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Process / shift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.code}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <StaffAvatar
                          userId={e.user_id}
                          name={e.full_name}
                          hasPhoto={e.photo_available}
                          size="medium"
                          process={e.process as never}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{e.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{e.roleLabel}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{e.code}</TableCell>
                    <TableCell className="text-muted-foreground">{e.roleLabel}</TableCell>
                    <TableCell>
                      <ProcessBadge code={e.process as never} compact />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-full">
                        {STATUS_LABEL[e.status] ?? e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full text-xs"
                        onClick={() => setDetail(e)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <StaffEditDialog staff={detail} onOpenChange={(v) => !v && setDetail(null)} />
    </div>
  );
}
