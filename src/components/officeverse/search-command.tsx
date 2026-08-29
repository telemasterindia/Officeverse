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
import { LEADS } from "@/lib/officeverse/data";
import { NAV_BY_ROLE } from "@/lib/officeverse/nav";
import { useSession } from "@/lib/officeverse/session";

export function SearchCommand({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { user } = useSession();
  if (!user) return null;
  const pages = NAV_BY_ROLE[user.role].flatMap((g) => g.items);

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search Lead ID or Phone…" />
      <CommandList>
        <CommandEmpty>Nothing matched. Try a Lead ID like TMI_00012000.</CommandEmpty>
        <CommandGroup heading="Leads">
          {LEADS.slice(0, 8).map((lead) => (
            <CommandItem
              key={lead.lead_id}
              value={`${lead.lead_id} ${lead.phone} ${lead.customer_name}`}
              onSelect={() => go("/leads")}
            >
              <span className="font-mono text-xs">{lead.lead_id}</span>
              <span className="ml-2 truncate">{lead.customer_name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{lead.phone}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
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
