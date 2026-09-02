import { createFileRoute } from "@tanstack/react-router";
import { Building2, Save } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { useCompanyBranding, useUpdateCompanyBranding } from "@/lib/officeverse/use-company";

export const Route = createFileRoute("/_shell/company")({
  head: () => ({ meta: [{ title: "Company Branding — TMI Officeverse CRM" }] }),
  component: () => (
    <RoleGate allow={["admin"]}>
      <CompanyBrandingPage />
    </RoleGate>
  ),
});

const LOGO_MIMES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_LOGO_BYTES = 512 * 1024;

/** Raw base64 of a file (no `data:` prefix). */
function fileToRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("That file could not be read."));
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(file);
  });
}

function CompanyBrandingPage() {
  const { data: branding, isPending } = useCompanyBranding();
  const updateM = useUpdateCompanyBranding();
  const formRef = useRef<HTMLFormElement>(null);
  const [clearLogo, setClearLogo] = useState(false);

  // hydrate defaultValues once branding arrives
  useEffect(() => {
    if (!branding || !formRef.current) return;
    const f = formRef.current;
    const set = (name: string, v: string | null) => {
      const el = f.elements.namedItem(name) as HTMLInputElement | null;
      if (el) el.value = v ?? "";
    };
    set("companyName", branding.companyName);
    set("legalName", branding.legalName);
    set("addressLine", branding.addressLine);
    set("taxId", branding.taxId);
    set("contactEmail", branding.contactEmail);
    set("contactPhone", branding.contactPhone);
    set("documentFooter", branding.documentFooter);
  }, [branding]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (updateM.isPending) return;
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "").trim();

    let logo: { mime: string; base64: string } | null | undefined;
    const file = fd.get("logo");
    if (file instanceof File && file.size > 0) {
      if (!LOGO_MIMES.includes(file.type)) {
        toast.error("Logo must be PNG, JPEG, SVG or WebP");
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        toast.error("Logo must be 512 KB or smaller");
        return;
      }
      logo = { mime: file.type, base64: await fileToRawBase64(file) };
    } else if (clearLogo) {
      logo = null;
    }

    try {
      await updateM.mutateAsync({
        companyName: s("companyName"),
        legalName: s("legalName") || null,
        addressLine: s("addressLine") || null,
        taxId: s("taxId") || null,
        contactEmail: s("contactEmail") || null,
        contactPhone: s("contactPhone") || null,
        documentFooter: s("documentFooter") || null,
        ...(logo !== undefined ? { logo } : {}),
      });
      toast.success("Company branding saved");
      setClearLogo(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save company branding");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company branding"
        description="The official company identity used on salary slips, system emails and the app header. Admin only."
      />

      <form ref={formRef} className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
        <SectionCard title="Identity" description="Shown on every official document.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="companyName">Company name *</Label>
              <Input id="companyName" name="companyName" required minLength={2} maxLength={160} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="legalName">Registered / legal name</Label>
              <Input id="legalName" name="legalName" maxLength={200} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="addressLine">Registered address</Label>
              <Input id="addressLine" name="addressLine" maxLength={400} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxId">Tax / GST / registration ID</Label>
              <Input id="taxId" name="taxId" maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" name="contactPhone" maxLength={40} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" name="contactEmail" type="email" maxLength={191} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="documentFooter">Document footer line</Label>
              <Input id="documentFooter" name="documentFooter" maxLength={400} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Logo" description="PNG, JPEG, SVG or WebP · up to 512 KB.">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
              {branding?.hasLogo && branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt="Current company logo"
                  className="max-h-full max-w-full"
                />
              ) : (
                <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Input name="logo" type="file" accept={LOGO_MIMES.join(",")} />
              {branding?.hasLogo ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearLogo}
                    onChange={(e) => setClearLogo(e.target.checked)}
                  />
                  Remove the current logo (leave the file picker empty)
                </label>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={updateM.isPending || isPending}
            className="rounded-lg px-6 py-5 text-base font-semibold"
          >
            <Save className="mr-2 h-4 w-4" /> {updateM.isPending ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </form>
    </div>
  );
}
