/**
 * React Query hooks over the authoritative staff directory (staff-fns.ts →
 * server service → MySQL). No localStorage.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStaffFn,
  listStaffFn,
  promoteAgentFn,
  removeStaffFn,
  setStaffStatusFn,
  updateStaffProfileFn,
} from "./staff-fns";

export type StaffKind = "agent" | "closer";
export type StaffProcess = "US" | "IN" | "UK" | "AU";

export function useServerStaff(
  kind: StaffKind,
  q?: string,
  process?: StaffProcess,
  opts: { activeOnly?: boolean } = {},
) {
  const activeOnly = opts.activeOnly === true;
  const query = useQuery({
    queryKey: ["srv-staff", kind, q ?? "", process ?? "all", activeOnly],
    queryFn: () =>
      listStaffFn({
        data: {
          kind,
          ...(q ? { q } : {}),
          ...(process ? { process } : {}),
          ...(activeOnly ? { activeOnly: true } : {}),
        },
      }),
    staleTime: 10_000,
  });
  return { ...query, staff: query.data?.staff ?? [] };
}

export function useCreateServerStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => createStaffFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-staff"] }),
  });
}

export function useSetServerStaffStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: StaffKind; code: string; status: string; phone?: string }) =>
      setStaffStatusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-staff"] }),
  });
}

/** §1/§2/§4 — Admin/HR edit an Agent/Closer profile (name, phone, process,
 *  DOB, anniversary, joining date, salary). Reuses the existing photo + salary
 *  systems; refreshes every StaffAvatar / directory consumer. */
export function useUpdateStaffProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      kind: StaffKind;
      code: string;
      full_name?: string;
      phone?: string;
      process?: StaffProcess;
      status?: string;
      dob?: string;
      anniversary_date?: string;
      joining_date?: string;
      base_salary?: number;
      salary_effective_from?: string;
    }) => updateStaffProfileFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["srv-staff"] });
      qc.invalidateQueries({ queryKey: ["photo"] }); // name/process shown alongside the photo
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["presence"] });
    },
  });
}

/** §9 — Admin-only Agent → Closer promotion. Moves no leads/follow-ups. */
export function usePromoteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_code: string }) => promoteAgentFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["srv-staff"] });
      qc.invalidateQueries({ queryKey: ["srv-closers"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["presence"] });
    },
  });
}

/** §8 — Admin-only remove (deactivate / terminate). No row deleted. */
export function useRemoveStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: StaffKind; code: string }) => removeStaffFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["srv-staff"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["presence"] });
    },
  });
}
