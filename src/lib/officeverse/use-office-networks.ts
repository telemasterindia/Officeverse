/**
 * Officeverse — authorized office-network hooks (Phase 23). HR / Admin only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addOfficeNetworkFn,
  officeNetworksFn,
  removeOfficeNetworkFn,
  setOfficeNetworkEnabledFn,
  updateOfficeNetworkFn,
} from "./office-network-fns";

const KEY = ["office-networks"] as const;

export function useOfficeNetworks() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => officeNetworksFn({ data: {} }),
    staleTime: 15_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useAddOfficeNetwork() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { name: string; cidr: string; process?: string | null; note?: string }) =>
      addOfficeNetworkFn({ data: v }),
    onSuccess: done,
  });
}

export function useUpdateOfficeNetwork() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: {
      id: number;
      name?: string;
      cidr?: string;
      process?: string | null;
      note?: string;
    }) => updateOfficeNetworkFn({ data: v }),
    onSuccess: done,
  });
}

export function useSetOfficeNetworkEnabled() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number; enabled: boolean; confirmLockout?: boolean; reason?: string }) =>
      setOfficeNetworkEnabledFn({ data: v }),
    onSuccess: done,
  });
}

export function useRemoveOfficeNetwork() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: number; confirmLockout?: boolean; reason?: string }) =>
      removeOfficeNetworkFn({ data: v }),
    onSuccess: done,
  });
}
