/**
 * Officeverse — Admin system-status hook (Phase 17).
 */
import { useQuery } from "@tanstack/react-query";
import { systemStatusFn } from "./system-fns";

export function useSystemStatus(deep = false) {
  return useQuery({
    queryKey: ["system-status", deep],
    queryFn: () => systemStatusFn({ data: { deep } }),
    staleTime: 15_000,
  });
}
