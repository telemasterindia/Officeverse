/**
 * Officeverse — Company Branding hooks (Admin UAT §7).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  companyBrandingFn,
  updateCompanyBrandingFn,
  type UpdateCompanyBrandingInput,
} from "./company-fns";

export function useCompanyBranding() {
  return useQuery({
    queryKey: ["company-branding"],
    queryFn: () => companyBrandingFn({ data: {} }),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateCompanyBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: UpdateCompanyBrandingInput) => updateCompanyBrandingFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company-branding"] }),
  });
}
