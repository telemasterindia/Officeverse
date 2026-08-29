import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The room-native surface. A translucent, elevated panel that lets the
 * environment read faintly at its edges. Drop-in replacement for a plain Card
 * on transformed screens; existing Card usage elsewhere is left untouched.
 */

const TONE: Record<string, string> = {
  default: "bg-primary/12 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  accent: "bg-accent/12 text-accent",
  info: "bg-info/12 text-info",
};

export function FloatingPanel({
  title,
  description,
  icon: Icon,
  action,
  tone = "default",
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  tone?: "default" | "success" | "warning" | "accent" | "info";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || description || action || Icon);
  return (
    <section className={cn("floating-panel animate-rise-in overflow-hidden", className)}>
      {hasHeader ? (
        <header className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
          {Icon ? (
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONE[tone])}>
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
            ) : null}
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
