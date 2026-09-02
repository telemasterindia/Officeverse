import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Lock, Search, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
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
  LeadIdChip,
  PageHeader,
  StatusBadge,
} from "@/components/officeverse/primitives";
import { toast } from "sonner";
import { useServerLeads } from "@/lib/officeverse/use-lead-lifecycle";
import { useExportMyLeads } from "@/lib/officeverse/use-export";
import { useServerStaff } from "@/lib/officeverse/use-staff";
import { useSession } from "@/lib/officeverse/session";
import type { LeadStatus, ProcessCode } from "@/lib/officeverse/types";

const PROCESS_OPTS: ProcessCode[] = ["US", "IN", "UK", "AU"];

export const Route = createFileRoute("/_shell/leads/")({
  head: () => ({
    meta: [
      { title: "My Leads — TeleMaster India" },
      {
        name: "description",
        content: "Every lead you submitted, with status, closer and last activity.",
      },
    ],
  }),
  component: LeadsPage,
});

const STATUSES: LeadStatus[] = [
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "REJECTED",
  "FOLLOW-UP",
  "COMPLETED",
];

function LeadsPage() {
  const { user } = useSession();
  const isAgent = user?.role === "agent";
  const isCloser = user?.role === "closer";
  const isAdmin = user?.role === "admin" || user?.role === "hr";
  const exportMine = useExportMyLeads();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [processF, setProcessF] = useState<string>("all");
  const [agentF, setAgentF] = useState<string>("all");
  const [closerF, setCloserF] = useState<string>("all");
  const [page, setPage] = useState(0);
  const perPage = 10;

  // Admin UAT §3/§4 — filters are applied SERVER-SIDE (role/process scope +
  // process/agent/closer/status). The client only adds a text search on the page.
  const { leads } = useServerLeads(
    isAdmin
      ? {
          pageSize: 100,
          ...(status !== "all" ? { status } : {}),
          ...(processF !== "all" ? { process: processF } : {}),
          ...(agentF !== "all" ? { agentCode: agentF } : {}),
          ...(closerF !== "all" ? { closerCode: closerF } : {}),
        }
      : {},
  );

  const scopedProcess = processF !== "all" ? (processF as ProcessCode) : undefined;
  const { staff: agentStaff } = useServerStaff(
    "agent",
    undefined,
    isAdmin ? scopedProcess : undefined,
  );
  const { staff: closerStaff } = useServerStaff(
    "closer",
    undefined,
    isAdmin ? scopedProcess : undefined,
  );

  const rows = useMemo(
    () =>
      leads.filter(
        (l) =>
          (status === "all" || l.status === status) &&
          (q === "" ||
            l.lead_id.toLowerCase().includes(q.toLowerCase()) ||
            (!isAgent && l.phone.includes(q)) ||
            l.customer_name.toLowerCase().includes(q.toLowerCase())),
      ),
    [leads, q, status, isAgent],
  );
  const paged = rows.slice(page * perPage, page * perPage + perPage);

  return (
    <div className="space-y-7">
      <PageHeader
        title={isAdmin ? "All Leads" : "My Leads"}
        description={
          isAdmin
            ? "Every lead across processes, agents and closers."
            : isCloser
              ? "Leads transferred to you."
              : "Leads you submitted. Once a lead is transferred to a Closer it is read-only for you."
        }
        actions={
          <>
            {/* Admin UAT §12 — Agents may NOT export. Closer / Admin / HR only. */}
            {!isAgent ? (
              <Button
                variant="outline"
                className="rounded-full"
                disabled={exportMine.isPending}
                onClick={() =>
                  exportMine.mutate(
                    { dataset: "leads", format: "xlsx" },
                    {
                      onSuccess: (r) =>
                        toast.success(`Exported ${r.rowCount} lead${r.rowCount === 1 ? "" : "s"}`),
                      onError: (e) => toast.error(e.message || "Export failed"),
                    },
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                {exportMine.isPending ? "Exporting…" : "Export (Excel)"}
              </Button>
            ) : null}
            <Button asChild className="rounded-full">
              <Link to="/leads/new">
                <Target className="mr-2 h-4 w-4" /> New customer
              </Link>
            </Button>
          </>
        }
      />

      <Card className="surface-panel rounded-2xl border-border/70 p-4">
        <div className={isAgent ? "relative min-w-0" : "space-y-3"}>
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder={
                isAgent ? "Search customer name or Lead ID…" : "Search Lead ID, phone or customer…"
              }
              className="pl-9"
              aria-label="Search leads"
            />
          </div>
          {!isAgent ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  setPage(0);
                }}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isAdmin ? (
                <>
                  <Select
                    value={processF}
                    onValueChange={(v) => {
                      setProcessF(v);
                      setAgentF("all");
                      setCloserF("all");
                      setPage(0);
                    }}
                  >
                    <SelectTrigger aria-label="Filter by process">
                      <SelectValue placeholder="Process" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All processes</SelectItem>
                      {PROCESS_OPTS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={agentF}
                    onValueChange={(v) => {
                      setAgentF(v);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger aria-label="Filter by agent">
                      <SelectValue placeholder="Agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All agents</SelectItem>
                      {agentStaff.map((a) => (
                        <SelectItem key={a.code} value={a.code}>
                          {a.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={closerF}
                    onValueChange={(v) => {
                      setCloserF(v);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger aria-label="Filter by closer">
                      <SelectValue placeholder="Closer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All closers</SelectItem>
                      {closerStaff.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {paged.length === 0 ? (
        <EmptyState
          emoji="🎯"
          title="No leads yet."
          message="Leads you create on the New customer form show up here."
          action={
            <Button asChild className="rounded-full">
              <Link to="/leads/new">New customer</Link>
            </Button>
          }
        />
      ) : (
        <Card className="surface-panel overflow-hidden rounded-2xl border-border/70">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {isAgent ? (
                    <>
                      <TableHead>Customer name</TableHead>
                      <TableHead>Lead ID</TableHead>
                      <TableHead className="text-right">View</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Lead ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Closer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((l) =>
                  isAgent ? (
                    <TableRow key={l.lead_id}>
                      <TableCell className="font-medium">
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: l.lead_id }}
                          className="hover:text-accent hover:underline"
                        >
                          {l.customer_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <LeadIdChip id={l.lead_id} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline" className="rounded-lg">
                          <Link to="/leads/$leadId" params={{ leadId: l.lead_id }}>
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={l.lead_id}>
                      <TableCell>
                        <LeadIdChip id={l.lead_id} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: l.lead_id }}
                          className="hover:text-accent hover:underline"
                        >
                          {l.customer_name}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {l.phone}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.file_name}</TableCell>
                      <TableCell className="text-muted-foreground">{l.assigned_closer}</TableCell>
                      <TableCell>
                        <StatusBadge status={l.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {l.created_at}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline" className="rounded-lg">
                          <Link to="/leads/$leadId" params={{ leadId: l.lead_id }}>
                            Open
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-4 py-3">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {!isAdmin ? (
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Transferred leads are read-only
                </span>
              ) : (
                `${rows.length} leads`
              )}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * perPage >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
