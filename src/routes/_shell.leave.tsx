import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { PeerAvatar } from "@/components/officeverse/peer-avatar";
import { EMPLOYEES } from "@/lib/officeverse/data";

export const Route = createFileRoute("/_shell/leave")({
  head: () => ({
    meta: [
      { title: "Leave — TeleMaster India" },
      { name: "description", content: "Raise, review and approve leave requests without the email chain." },
      { property: "og:title", content: "Leave — TeleMaster India" },
      { property: "og:description", content: "Leave requests, approvals and balances in one place." },
    ],
  }),
  component: LeavePage,
});

type Req = { id: string; name: string; type: string; from: string; to: string; reason: string; state: string };

const INITIAL: Req[] = EMPLOYEES.slice(0, 6).map((e, i) => ({
  id: `L-${100 + i}`,
  name: e.name,
  type: (["Casual", "Sick", "Earned", "Comp Off"] as const)[i % 4]!,
  from: `2026-03-${10 + i}`,
  to: `2026-03-${11 + i}`,
  reason: ["Family function", "Fever", "Travel", "Personal work", "Medical checkup", "Wedding"][i]!,
  state: i < 3 ? "Pending" : i < 5 ? "Approved" : "Rejected",
}));

function LeavePage() {
  const [reqs, setReqs] = useState<Req[]>(INITIAL);
  const decide = (id: string, state: string) => {
    setReqs((r) => r.map((x) => (x.id === id ? { ...x, state } : x)));
    toast.success(`Request ${state.toLowerCase()}`);
  };

  const groups = ["Pending", "Approved", "Rejected"];

  return (
    <div className="space-y-7">
      <PageHeader title="Leave" description="Requests in, decisions out — no email chains." />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Tabs defaultValue="Pending">
          <TabsList className="rounded-full">
            {groups.map((g) => (
              <TabsTrigger key={g} value={g} className="rounded-full">
                {g} ({reqs.filter((r) => r.state === g).length})
              </TabsTrigger>
            ))}
          </TabsList>
          {groups.map((g) => {
            const list = reqs.filter((r) => r.state === g);
            return (
              <TabsContent key={g} value={g} className="mt-5 space-y-3">
                {list.length === 0 ? (
                  <EmptyState title={`Nothing ${g.toLowerCase()}`} message="You're all caught up here." />
                ) : (
                  list.map((r) => (
                    <Card key={r.id} className="surface-panel rounded-2xl border-border/70 p-5">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                        <PeerAvatar name={r.name} size="small" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{r.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.type} leave · {r.from} → {r.to}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{r.id}</span>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{r.reason}</p>
                      {r.state === "Pending" && (
                        <div className="mt-4 flex gap-2">
                          <Button size="sm" className="rounded-full" onClick={() => decide(r.id, "Approved")}>
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => decide(r.id, "Rejected")}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </TabsContent>
            );
          })}
        </Tabs>

        <SectionCard title="Apply for leave" description="Raise a request in 20 seconds">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              toast.success("Leave request submitted", { description: "HR will get back to you shortly." });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="type">Leave type</Label>
              <Select defaultValue="Casual">
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Casual", "Sick", "Earned", "Comp Off"].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="from">From</Label>
                <Input id="from" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" rows={4} placeholder="Keep it short and clear." />
            </div>
            <Button type="submit" className="w-full rounded-full py-6 font-bold">
              Submit request
            </Button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}
