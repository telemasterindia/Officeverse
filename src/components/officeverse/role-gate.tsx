import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/officeverse/primitives";
import { useSession } from "@/lib/officeverse/session";
import type { Role } from "@/lib/officeverse/types";

/**
 * Route-level guard for management screens. Uses the EXISTING session role —
 * no new auth. Renders its children only for an allowed role; anyone else gets
 * a plain "not authorized" panel (they also never see the sidebar links).
 */
export function RoleGate({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user } = useSession();
  if (!user) return null;
  if (!allow.includes(user.role)) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-1.5 text-warning">
              <ShieldAlert className="h-4 w-4" /> Restricted
            </span>
          }
          title="Not authorized"
          description="This area is limited to management roles."
        />
      </div>
    );
  }
  return <>{children}</>;
}
