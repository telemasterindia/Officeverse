import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_BY_ROLE } from "@/lib/officeverse/nav";
import { useServerLeads } from "@/lib/officeverse/use-lead-lifecycle";
import { useSession } from "@/lib/officeverse/session";

/**
 * ⌘K search. UAT #11: this NEVER loads the whole lead list. Nothing is fetched
 * until the user types ≥ 2 characters, and then only the server's top matches
 * (scoped to what this user may see) are returned — a bounded typeahead, not a
 * dropdown of every lead.
 */
export function SearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useSession();

  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");

  // debounce the typed query
  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 180);
    return () => clearTimeout(t);
  }, [raw]);

  // reset when the palette closes
  useEffect(() => {
    if (!open) {
      setRaw("");
      setQ("");
    }
  }, [open]);

  const active = q.length >= 2;
  const { leads, isFetching } = useServerLeads(
    { q, pageSize: 8, sort: "newest" },
    { enabled: active },
  );

  if (!user) return null;
  const pages = NAV_BY_ROLE[user.role].flatMap((g) => g.items);

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };
  const openLead = (leadId: string) => {
    onOpenChange(false);
    navigate({ to: "/leads/$leadId", params: { leadId } });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={raw}
        onValueChange={setRaw}
        placeholder="Search a Lead ID, phone or customer name…"
      />
      <CommandList>
        <CommandEmpty>
          {active
            ? isFetching
              ? "Searching…"
              : "No matching leads."
            : "Type at least 2 characters to search your leads."}
        </CommandEmpty>

        {active && leads.length > 0 ? (
          <>
            <CommandGroup heading={`Leads matching “${q}”`}>
              {leads.map((lead) => (
                <CommandItem
                  key={lead.lead_id}
                  value={`${lead.lead_id} ${lead.phone} ${lead.customer_name}`}
                  onSelect={() => openLead(lead.lead_id)}
                >
                  <span className="font-mono text-xs">{lead.lead_id}</span>
                  <span className="ml-2 truncate">{lead.customer_name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {lead.phone}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading="Go to">
          {pages.map((p) => (
            <CommandItem key={p.to} value={p.label} onSelect={() => go(p.to)}>
              <p.icon className="mr-2 h-4 w-4" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
