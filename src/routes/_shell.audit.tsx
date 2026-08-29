import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { AUDIT } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — TeleMaster India" },
      { name: "description", content: "Every action on the floor, who did it, and when — searchable." },
      { property: "og:title", content: "Audit Trail — TeleMaster India" },
      { property: "og:description", content: "Immutable record of leads, assignments and system actions." },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const [q, setQ] = useState("");
  const rows = AUDIT.filter((a) =>
    `${a.actor} ${a.action} ${a.target}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="space-y-7">
      <PageHeader title="Audit Trail" description="Nothing disappears. Every change is on the record." />

      <SectionCard title={`${rows.length} entries`}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by person, action or record"
          className="rounded-full sm:max-w-sm"
        />

        {rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="No matching entries" message="Try a different person or record." />
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <PeerAvatar name={a.actor} size="small" />
                        <span className="min-w-0 truncate font-medium">{a.actor}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-full">
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{a.target}</TableCell>
                    <TableCell className="text-muted-foreground">{a.time}</TableCell>
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
