import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared process / shift filter control.
 *
 * `id` is either "ALL" or an authoritative `PROCESS_CODES` value (US / UK / IN /
 * AU) — the exact string stored on `users.process` and carried by the server
 * staff / presence DTOs. Consumers filter their rows with a plain equality on
 * that server field; this control never inspects display text, emoji, or shift
 * labels.
 *
 * Visual treatment matches the rest of Officeverse: a pill button group where
 * the selected option is filled (`variant="default"`) and carries
 * `aria-pressed`. Pure controlled component — no state, no data fetching.
 */
export const PROCESS_FILTER_OPTIONS = [
  { id: "ALL", label: "ALL" },
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "IN", label: "INDIA" },
  { id: "AU", label: "AU" },
] as const;

export type ProcessFilterValue = (typeof PROCESS_FILTER_OPTIONS)[number]["id"];

export function ProcessFilter({
  value,
  onChange,
  label = "Filter by process",
  className,
}: {
  value: ProcessFilterValue;
  onChange: (next: ProcessFilterValue) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap justify-end gap-1.5", className)}
    >
      {PROCESS_FILTER_OPTIONS.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="sm"
          variant={value === o.id ? "default" : "outline"}
          aria-pressed={value === o.id}
          className="h-7 rounded-full px-3 text-xs"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
