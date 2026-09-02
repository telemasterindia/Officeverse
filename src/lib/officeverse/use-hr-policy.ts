/**
 * Officeverse — HR Policy hooks. React Query wrappers around the policy fns.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deletePolicyFn, listPoliciesFn, savePolicyFn, setPolicyStatusFn } from "./hr-policy-fns";
import type { PolicyDTO } from "@/server/hr-policy/service";

export type { PolicyDTO };

export function usePolicies() {
  return useQuery<{ dbUnavailable?: boolean; canManage: boolean; rows: PolicyDTO[] }>({
    queryKey: ["hr-policies"],
    queryFn: () => listPoliciesFn(),
  });
}

export function useSavePolicy() {
  const qc = useQueryClient();
  return useMutation<
    PolicyDTO,
    Error,
    { id?: number; title: string; content: string; effective_date?: string }
  >({
    mutationFn: (v) => savePolicyFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-policies"] }),
  });
}

export function useSetPolicyStatus() {
  const qc = useQueryClient();
  return useMutation<PolicyDTO, Error, { id: number; publish: boolean }>({
    mutationFn: (v) => setPolicyStatusFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-policies"] }),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { id: number }>({
    mutationFn: (v) => deletePolicyFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-policies"] }),
  });
}
