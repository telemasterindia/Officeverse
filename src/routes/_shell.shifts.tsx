import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import {
  useRecomputeShiftDate,
  useRemoveShiftOverride,
  useSetShiftOverride,
  useShiftOverrides,
} from "@/lib/officeverse/use-shift-overrides";

export const Route = createFileRoute("/_shell/shifts")({
  head: () => ({ meta: [{ title: "Shift Timing — TMI Officeverse CRM" }] }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <ShiftOverridesPage />
    </RoleGate>
  ),
});

const PROCESSES = ["US", "IN", "UK", "AU"] as const;

function ShiftOverridesPage() {
  const { data, isPending } = useShiftOverrides();
  const setM = useSetShiftOverride();
  const removeM = useRemoveShiftOverride();
  const recomputeM = useRecomputeShiftDate();
  const [process, setProcess] = useState<string>("US");

  const rows = data?.rows ?? [];

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (setM.isPending) return;
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    // Canonicalise to strict 24-hour "HH:MM": pad a single-digit hour and drop
    // any ":SS" a browser time widget may append — the server Zod schema
    // accepts exactly "HH:MM" and this keeps the two representations aligned.
    const hhmm = (k: string) => {
      const v = s(k);
      if (!v) return "";
      const m = /^(\d{1,2}):(\d{2})/.exec(v);
      return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : v;
    };
    try {
      await setM.mutateAsync({
        process: process as "US" | "IN" | "UK" | "AU",
        operationalDate: s("operationalDate"),
        startHHMM: hhmm("startHHMM"),
        endHHMM: hhmm("endHHMM"),
        ...(hhmm("reportingHHMM") ? { reportingHHMM: hhmm("reportingHHMM") } : {}),
        ...(hhmm("shortLateFromHHMM") ? { shortLateFromHHMM: hhmm("shortLateFromHHMM") } : {}),
        ...(hhmm("lateFromHHMM") ? { lateFromHHMM: hhmm("lateFromHHMM") } : {}),
        ...(s("reason") ? { reason: s("reason") } : {}),
      });
      toast.success("Shift override saved");
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the shift override");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift timing"
        description="Override the shift start / end for one process on one operational date — a temporary Saturday shift, an early shift, a DST or seasonal change. Admin only. Employees can never change their own shift."
      />

      <SectionCard
        title="Add / update an override"
        description="Late boundaries are optional — leave them blank to derive them from the new start time (reporting = start−10m for US / = start otherwise · short-late = reporting+1m · late = start+31m)."
      >
        <form className="grid gap-5 sm:grid-cols-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="process">Process</Label>
            <Select value={process} onValueChange={setProcess}>
              <SelectTrigger id="process">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCESSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="operationalDate">Operational date *</Label>
            <Input id="operationalDate" name="operationalDate" type="date" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              name="reason"
              placeholder="e.g. Saturday early shift"
              maxLength={255}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startHHMM">Shift start *</Label>
            <Input id="startHHMM" name="startHHMM" type="time" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endHHMM">Shift end *</Label>
            <Input id="endHHMM" name="endHHMM" type="time" required />
          </div>
          <div className="hidden sm:block" />
          <div className="space-y-1.5">
            <Label htmlFor="reportingHHMM">Reporting (opt.)</Label>
            <Input id="reportingHHMM" name="reportingHHMM" type="time" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shortLateFromHHMM">Short-late from (opt.)</Label>
            <Input id="shortLateFromHHMM" name="shortLateFromHHMM" type="time" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lateFromHHMM">Late from (opt.)</Label>
            <Input id="lateFromHHMM" name="lateFromHHMM" type="time" />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <Button
              type="submit"
              disabled={setM.isPending}
              className="rounded-lg px-6 py-5 font-semibold"
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              {setM.isPending ? "Saving…" : "Save override"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Configured overrides" description="Most recent first.">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shift overrides configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Process</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Effective window</th>
                  <th className="py-2 pr-3">Reporting</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.process}:${r.operationalDate}`}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 pr-3 font-semibold">{r.process}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.operationalDate}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.effective.start} → {r.effective.end}
                      {r.effective.overnight ? " (+1d)" : ""}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{r.effective.reportingHHMM ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.reason ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={recomputeM.isPending}
                          onClick={async () => {
                            try {
                              const res = await recomputeM.mutateAsync({
                                process: r.process,
                                operationalDate: r.operationalDate,
                              });
                              toast.success(
                                `Recomputed ${res.recomputed} row(s); skipped ${res.skippedCorrected} corrected`,
                              );
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Recompute failed");
                            }
                          }}
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Recompute date
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={removeM.isPending}
                          onClick={async () => {
                            try {
                              await removeM.mutateAsync({
                                process: r.process,
                                operationalDate: r.operationalDate,
                              });
                              toast.success("Override removed");
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Could not remove");
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
