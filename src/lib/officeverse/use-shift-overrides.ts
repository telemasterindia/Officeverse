/**
 * Officeverse — dynamic shift-override hooks (Admin UAT Batch-2 follow-up §1).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listShiftOverridesFn,
  recomputeShiftDateFn,
  removeShiftOverrideFn,
  setShiftOverrideFn,
  type SetShiftOverrideInput,
} from "./shift-override-fns";

const KEY = ["shift-overrides"];

export function useShiftOverrides(filter?: { process?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: [...KEY, filter ?? {}],
    queryFn: () => listShiftOverridesFn({ data: filter ?? {} }),
    staleTime: 15_000,
  });
}

export function useSetShiftOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SetShiftOverrideInput) => setShiftOverrideFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveShiftOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { process: string; operationalDate: string }) =>
      removeShiftOverrideFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRecomputeShiftDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { process: string; operationalDate: string }) =>
      recomputeShiftDateFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}
