/**
 * A visual variant of primitives.tsx <ActivityTimeline> — same item shape,
 * rendered as a trail of steps. Existing ActivityTimeline is left in place for
 * screens not yet transformed.
 */
export function ActivityTrail({
  items,
}: {
  items: { actor: string; action: string; target: string; time: string }[];
}) {
  return (
    <ol className="relative space-y-4 pl-7">
      <span
        aria-hidden
        className="absolute bottom-1 left-[10px] top-1 w-px bg-gradient-to-b from-primary/50 via-border to-transparent"
      />
      {items.map((item, i) => (
        <li
          key={i}
          className="animate-rise-in relative"
          style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
        >
          <span className="absolute -left-7 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-primary/15 ring-2 ring-background">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <p className="text-sm">
            <span className="font-semibold">{item.actor}</span>{" "}
            <span className="text-muted-foreground">{item.action}</span>{" "}
            <span className="font-mono text-xs text-accent">{item.target}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.time}</p>
        </li>
      ))}
    </ol>
  );
}
