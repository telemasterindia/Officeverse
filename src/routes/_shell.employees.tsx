import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { EmployeeIdentity } from "@/components/officeverse/employee-identity";
import { IdentityToggle } from "@/components/officeverse/identity-controls";
import { useIdentityMode } from "@/lib/officeverse/identity";
import { EMPLOYEES } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/employees")({
  head: () => ({
    meta: [
      { title: "Employees — TeleMaster India" },
      {
        name: "description",
        content: "Searchable directory of everyone on the floor with department and status.",
      },
      { property: "og:title", content: "Employees — TeleMaster India" },
      {
        property: "og:description",
        content: "Employee directory with departments, processes and status.",
      },
    ],
  }),
  component: EmployeesPage,
});

const DEPARTMENTS = ["All", "Sales", "Closing", "People", "Operations"];

function EmployeesPage() {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("All");
  const [idMode, setIdMode] = useIdentityMode("photo");

  const rows = EMPLOYEES.filter(
    (e) =>
      (dept === "All" || e.department === dept) &&
      (e.name.toLowerCase().includes(q.trim().toLowerCase()) ||
        e.employee_id.toLowerCase().includes(q.trim().toLowerCase())),
  );

  return (
    <div className="space-y-7">
      <PageHeader title="Employees" description="One directory for the whole floor." />

      <SectionCard
        title={`${rows.length} people`}
        action={<IdentityToggle mode={idMode} onChange={setIdMode} />}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or employee ID"
            className="rounded-full sm:max-w-xs"
          />
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="rounded-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="No one matches" message="Try another name, ID or department." />
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <EmployeeIdentity
                          name={e.name}
                          mode={idMode}
                          size="small"
                          presence={e.presence}
                          process={e.process}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{e.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{e.designation}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.employee_id}</TableCell>
                    <TableCell className="text-muted-foreground">{e.department}</TableCell>
                    <TableCell>
                      <ProcessBadge code={e.process} compact />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.joining_date}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-full">
                        {e.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
