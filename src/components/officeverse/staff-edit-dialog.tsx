import { useEffect, useRef, useState } from "react";
import { ArrowUpCircle, ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { StaffAvatar } from "@/components/officeverse/staff-avatar";
import { useSession } from "@/lib/officeverse/session";
import { fileToSquareJpegBase64, useSetProfilePhoto } from "@/lib/officeverse/use-photo";
import {
  usePromoteAgent,
  useRemoveStaff,
  useUpdateStaffProfile,
  type StaffProcess,
} from "@/lib/officeverse/use-staff";
import type { StaffDTO } from "@/server/staff/service";

const PROCESSES: StaffProcess[] = ["US", "IN", "UK", "AU"];
const STATUSES = ["active", "inactive", "suspended", "on_leave"] as const;
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  on_leave: "On leave",
};
// server accepts "" to CLEAR a date; a date input yields "" when emptied
const dateOr = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/**
 * ONE shared Admin/HR editor for an Agent or Closer profile.
 *
 *   - shows the CURRENT authoritative photo (StaffAvatar) + a Replace action
 *     that reuses the existing Phase-19 photo system (server-validated, size-
 *     limited, `users.photo_asset_id`) — never localStorage.
 *   - edits name / phone / process / status / DOB / anniversary /
 *     joining-date (agents) / base salary (agents → existing salary-profile).
 *   - Admin-only footer: Promote Agent → Closer, and Remove (deactivate).
 *
 * Every write is server-authorized + audited; the UI only gates visibility.
 */
export function StaffEditDialog({
  staff,
  onOpenChange,
}: {
  staff: StaffDTO | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const update = useUpdateStaffProfile();
  const setPhoto = useSetProfilePhoto();
  const promote = usePromoteAgent();
  const remove = useRemoveStaff();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [process, setProcess] = useState<StaffProcess>("US");
  const [status, setStatus] = useState("active");
  const [dob, setDob] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [joining, setJoining] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryFrom, setSalaryFrom] = useState("");
  const [promoteArm, setPromoteArm] = useState(false);
  const [removeText, setRemoveText] = useState("");

  useEffect(() => {
    if (!staff) return;
    setFullName(staff.full_name);
    setPhone(staff.phone ?? "");
    setProcess((staff.process as StaffProcess) || "US");
    setStatus(staff.status);
    setDob(dateOr(staff.dob));
    setAnniversary(dateOr(staff.anniversary_date));
    setJoining(dateOr(staff.joining_date));
    setSalary("");
    setSalaryFrom("");
    setPromoteArm(false);
    setRemoveText("");
  }, [staff]);

  if (!staff) return null;
  const isAgent = staff.kind === "agent";

  const onPhoto = async (file: File | null) => {
    if (!file) return;
    try {
      const dataBase64 = await fileToSquareJpegBase64(file);
      await setPhoto.mutateAsync({ dataBase64, targetUserId: staff.user_id });
      toast.success("Photo replaced");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () => {
    const patch: Parameters<typeof update.mutate>[0] = { kind: staff.kind, code: staff.code };
    if (fullName.trim() !== staff.full_name) patch.full_name = fullName.trim();
    if ((phone.trim() || "") !== (staff.phone ?? "")) patch.phone = phone.trim();
    if (process !== staff.process) patch.process = process;
    if (status !== staff.status) patch.status = status;
    if (dob !== dateOr(staff.dob)) patch.dob = dob;
    if (anniversary !== dateOr(staff.anniversary_date)) patch.anniversary_date = anniversary;
    if (isAgent && joining !== dateOr(staff.joining_date)) patch.joining_date = joining;
    if (isAgent && salary.trim() !== "") {
      patch.base_salary = Number(salary);
      if (salaryFrom) patch.salary_effective_from = salaryFrom;
    }
    const touched = Object.keys(patch).filter((k) => k !== "kind" && k !== "code");
    if (touched.length === 0) {
      toast("Nothing changed");
      return;
    }
    update.mutate(patch, {
      onSuccess: () => {
        toast.success(`${isAgent ? "Agent" : "Closer"} profile updated`);
        onOpenChange(false);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
    });
  };

  const doPromote = () =>
    promote.mutate(
      { agent_code: staff.code },
      {
        onSuccess: (r) => {
          toast.success(`Promoted to Closer — ${r.closer_code}`, {
            description: "Now a Closer. Removed from the Agent roster. History preserved.",
          });
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Promotion failed"),
      },
    );

  const doRemove = () =>
    remove.mutate(
      { kind: staff.kind, code: staff.code },
      {
        onSuccess: () => {
          toast.success(`${staff.full_name} removed from the active workforce`, {
            description: "Login blocked, sessions revoked. All history preserved.",
          });
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Remove failed"),
      },
    );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
        {/* identity + photo */}
        <div className="flex items-center gap-4">
          <StaffAvatar
            userId={staff.user_id}
            name={staff.full_name}
            hasPhoto={staff.photo_available}
            size="large"
          />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold">{staff.full_name}</h2>
            <p className="text-xs text-muted-foreground">
              {isAgent ? "Agent" : "Closer"} · {staff.code}
              {staff.status !== "active" ? ` · ${STATUS_LABEL[staff.status] ?? staff.status}` : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1.5 rounded-lg"
              disabled={setPhoto.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <ImageUp className="mr-1.5 h-4 w-4" />
              {setPhoto.isPending
                ? "Uploading…"
                : staff.photo_available
                  ? "Replace photo"
                  : "Add photo"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {/* editable profile */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="se-name">Full name</Label>
            <Input id="se-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="se-phone">Phone</Label>
            <Input id="se-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="se-process">Process / shift</Label>
            <Select value={process} onValueChange={(v) => setProcess(v as StaffProcess)}>
              <SelectTrigger id="se-process">
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
            <Label htmlFor="se-dob">Date of birth</Label>
            <Input id="se-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="se-anniv">Anniversary date</Label>
            <Input
              id="se-anniv"
              type="date"
              value={anniversary}
              onChange={(e) => setAnniversary(e.target.value)}
            />
          </div>
          {isAgent ? (
            <div className="space-y-1.5">
              <Label htmlFor="se-join">Joining date</Label>
              <Input
                id="se-join"
                type="date"
                value={joining}
                onChange={(e) => setJoining(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="se-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="se-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isAgent ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="se-salary">Base salary (₹/month)</Label>
                <Input
                  id="se-salary"
                  inputMode="numeric"
                  placeholder="unchanged"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="se-salary-from">Salary effective from</Label>
                <Input
                  id="se-salary-from"
                  type="date"
                  value={salaryFrom}
                  onChange={(e) => setSalaryFrom(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Salary is applied through the existing payroll salary-profile model — it only
                affects payroll from the effective date forward, never past runs.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              A Closer works on incentives — there is no fixed base salary field.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" className="rounded-lg" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button className="rounded-lg" onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>

        {/* Admin-only lifecycle */}
        {isAdmin ? (
          <div className="mt-5 space-y-3 border-t border-border/70 pt-4">
            {isAgent ? (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <p className="text-sm font-semibold">Promote to Closer</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Admin only. Role → Closer, Closer permissions applied. Employee record + all lead
                  / follow-up / attendance / payroll history preserved; no work is moved. The
                  employee leaves the Agent roster automatically.
                </p>
                {!promoteArm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 rounded-lg"
                    onClick={() => setPromoteArm(true)}
                  >
                    <ArrowUpCircle className="mr-1.5 h-4 w-4" /> Promote {staff.full_name}
                  </Button>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs">
                      Promote <strong>{staff.full_name}</strong> ({staff.code}) to Closer?
                    </span>
                    <Button
                      size="sm"
                      className="rounded-lg"
                      onClick={doPromote}
                      disabled={promote.isPending}
                    >
                      {promote.isPending ? "Promoting…" : "Confirm"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg"
                      onClick={() => setPromoteArm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">Remove employee</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Admin only. Deactivates the account: login is blocked, every session is revoked, and
                the employee leaves the operational rosters. This is <strong>not</strong> a hard
                delete — all leads, follow-ups, attendance, payroll and audit history are kept and
                stay attributable to {staff.full_name}. Re-activate any time via Status.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-40"
                  placeholder={`type ${staff.code}`}
                  value={removeText}
                  onChange={(e) => setRemoveText(e.target.value)}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-lg"
                  disabled={removeText.trim() !== staff.code || remove.isPending}
                  onClick={doRemove}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {remove.isPending ? "Removing…" : "Remove from workforce"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
