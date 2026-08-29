import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/officeverse/session";
import {
  useAddOfficeNetwork,
  useOfficeNetworks,
  useRemoveOfficeNetwork,
  useSetOfficeNetworkEnabled,
} from "@/lib/officeverse/use-office-networks";

export const Route = createFileRoute("/_shell/office-networks")({
  head: () => ({ meta: [{ title: "Office Networks — TeleMaster India" }] }),
  component: OfficeNetworksPage,
});

const PROCS = ["", "US", "UK", "IN", "AU"];

function OfficeNetworksPage() {
  const { user } = useSession();
  if (user?.role !== "admin" && user?.role !== "hr") {
    return (
      <div className="space-y-6">
        <PageHeader title="Authorized Office Networks" description="Manage office IP ranges." />
        <EmptyState
          emoji="🔒"
          title="HR / Admin only"
          message="This area is restricted to HR and Admin."
        />
      </div>
    );
  }
  return <Inner />;
}

function Inner() {
  const q = useOfficeNetworks();
  const add = useAddOfficeNetwork();
  const toggle = useSetOfficeNetworkEnabled();
  const remove = useRemoveOfficeNetwork();
  const [form, setForm] = useState({ name: "", cidr: "", process: "", note: "" });

  const rows = q.data?.dbUnavailable ? [] : (q.data?.rows ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Authorized Office Networks"
        description="Attendance is recorded only from these networks. Agents can sign in ONLY from an authorized network; Closers may sign in remotely but their attendance is not recorded off-network. Every change is audited. Office IP addresses are never shown to employees."
      />

      <SectionCard title="Add a network">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="US Office"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">IP / CIDR</Label>
            <Input
              className="mt-1"
              value={form.cidr}
              onChange={(e) => setForm({ ...form, cidr: e.target.value })}
              placeholder="203.0.113.7/32"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Process (optional)</Label>
            <select
              className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={form.process}
              onChange={(e) => setForm({ ...form, process: e.target.value })}
            >
              {PROCS.map((p) => (
                <option key={p || "all"} value={p}>
                  {p || "All processes"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Note (optional)</Label>
            <Input
              className="mt-1"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          size="sm"
          disabled={add.isPending || form.name.trim().length < 2 || form.cidr.trim().length < 3}
          onClick={() =>
            add.mutate(
              {
                name: form.name.trim(),
                cidr: form.cidr.trim(),
                process: form.process || null,
                ...(form.note.trim() ? { note: form.note.trim() } : {}),
              },
              {
                onSuccess: () => {
                  toast.success("Network added");
                  setForm({ name: "", cidr: "", process: "", note: "" });
                },
                onError: (e) => toast.error((e as Error).message || "Could not add network"),
              },
            )
          }
        >
          Add network
        </Button>
      </SectionCard>

      <SectionCard title="Authorized networks">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.data?.dbUnavailable ? (
          <EmptyState
            emoji="🗄️"
            title="Database not connected"
            message="Networks need the database."
          />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No networks yet. Until at least one is added, Agents are not IP-restricted and no
            session counts toward attendance.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">CIDR</th>
                  <th className="px-3 py-2">Process</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{n.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{n.cidr}</td>
                    <td className="px-3 py-2 text-muted-foreground">{n.process ?? "All"}</td>
                    <td
                      className={cn(
                        "px-3 py-2 font-semibold",
                        n.enabled ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {n.enabled ? "ACTIVE" : "INACTIVE"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{n.updatedAt}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="mr-3 text-xs text-primary hover:underline"
                        onClick={() =>
                          toggle.mutate(
                            { id: n.id, enabled: !n.enabled },
                            {
                              onError: (e) => {
                                const msg = (e as Error).message || "";
                                if (
                                  /only active/i.test(msg) &&
                                  window.confirm(`${msg}\n\nDisable anyway?`)
                                ) {
                                  toggle.mutate({ id: n.id, enabled: false, confirmLockout: true });
                                } else if (msg) {
                                  toast.error(msg);
                                }
                              },
                              onSuccess: () => toast.success(n.enabled ? "Disabled" : "Enabled"),
                            },
                          )
                        }
                      >
                        {n.enabled ? "disable" : "enable"}
                      </button>
                      <button
                        className="text-xs text-destructive hover:underline"
                        onClick={() =>
                          remove.mutate(
                            { id: n.id },
                            {
                              onError: (e) => {
                                const msg = (e as Error).message || "";
                                if (
                                  /only active/i.test(msg) &&
                                  window.confirm(`${msg}\n\nRemove anyway?`)
                                ) {
                                  remove.mutate({ id: n.id, confirmLockout: true });
                                } else if (msg) {
                                  toast.error(msg);
                                }
                              },
                              onSuccess: () => toast.success("Removed"),
                            },
                          )
                        }
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Disabling or removing the only active network for a process is blocked with an impact
          warning — confirm again to proceed.
        </p>
      </SectionCard>
    </div>
  );
}
