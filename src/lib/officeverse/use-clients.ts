/**
 * React Query hooks over the authoritative client directory (client-fns.ts →
 * server service → MySQL). No localStorage.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClientFn, listClientsFn, updateClientFn } from "./client-fns";
import type { ClientDTO, ClientStatus } from "@/server/clients/service";

export type { ClientDTO, ClientStatus };

export function useServerClients(q?: string, status?: ClientStatus) {
  const query = useQuery({
    queryKey: ["srv-clients", q ?? "", status ?? ""],
    queryFn: () => listClientsFn({ data: { ...(q ? { q } : {}), ...(status ? { status } : {}) } }),
    staleTime: 10_000,
  });
  return { ...query, clients: query.data?.clients ?? [] };
}

export function useCreateServerClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => createClientFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-clients"] }),
  });
}

export function useUpdateServerClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      code: string;
      contact_name?: string;
      phone?: string;
      address?: string;
      status?: ClientStatus;
    }) => updateClientFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srv-clients"] }),
  });
}
