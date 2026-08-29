import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ActivityTimeline, LeadIdChip, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { AUDIT, EMPLOYEES, LEADS } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/assignments")({
  head: () => ({
    meta: [
      { title: "Assignment Control — TeleMaster India" },
      { name: "description", content: "Route leads and follow-ups to the right agent or closer in a couple of clicks." },
      { property: "og:title", content: "Assignment Control — TeleMaster India" },
      { property: "og:description", content: "Reassign ownership and review assignment history." },
    ],
  }),
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const people = EMPLOYEES.filter((e) => e.department === "Sales" || e.department === "Closing");
  const [owner, setOwner] = useState(people[0]!.name);
  const [target, setTarget] = useState(people[1]!.name);

  return (
    <div className="space-y-7">
      <PageHeader title="Assignment Control" description="Move work to the person who can act on it fastest." />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <SectionCard title="Reassign" description="Lead or follow-up ownership">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="what">What are you moving?</Label>
              <Select defaultValue="lead">
                <SelectTrigger id="what">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead → Closer</SelectItem>
                  <SelectItem value="followup">Follow-up → Agent / Closer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec">Record</Label>
              <Select defaultValue={LEADS[0]!.lead_id}>
                <SelectTrigger id="rec">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEADS.slice(0, 10).map((l) => (
                    <SelectItem key={l.lead_id} value={l.lead_id}>
                      {l.lead_id} · {l.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="from">Current owner</Label>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger id="from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ArrowRight className="mb-2.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-2">
                <Label htmlFor="to">New owner</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="to">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="grid grid-cols-[auto_auto_auto] items-center justify-center gap-4 rounded-2xl border-border/70 bg-secondary/30 p-4">
              <PeerAvatar name={owner} size="medium" />
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <PeerAvatar name={target} size="medium" />
            </Card>

            <Button
              className="w-full rounded-full py-6 font-bold"
              onClick={() => toast.success("Assignment updated", { description: `${owner} → ${target}` })}
            >
              Confirm reassignment
            </Button>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Current assignments" description="Latest 6 records">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Closer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LEADS.slice(0, 6).map((l) => (
                    <TableRow key={l.lead_id}>
                      <TableCell>
                        <LeadIdChip id={l.lead_id} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.submitted_by}</TableCell>
                      <TableCell className="text-muted-foreground">{l.assigned_closer}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <SectionCard title="Assignment history">
            <ActivityTimeline items={AUDIT.slice(0, 5)} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
