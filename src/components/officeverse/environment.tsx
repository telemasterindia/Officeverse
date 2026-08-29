import { cn } from "@/lib/utils";
import type { RoomKey } from "@/lib/officeverse/visual";

/**
 * Ambient life for the cinematic navy environment — a few big, soft, slowly
 * drifting colour blobs that sit behind everything. Purely decorative, CSS only.
 * Restrained atmospheric colour (indigo / royal blue / violet) with a low note
 * of India→USA accent energy (saffron left, red/green low). The `room-bg`
 * gradient is the base; this adds slow motion.
 */
const BLOBS: Record<RoomKey, [string, string, string]> = {
  workspace: [
    "oklch(0.55 0.13 64 / 0.24)", // faint saffron — India side
    "oklch(0.42 0.14 260 / 0.5)", // deep indigo — USA side
    "oklch(0.46 0.11 156 / 0.24)", // India green low note
  ],
  deal: [
    "oklch(0.55 0.14 60 / 0.26)",
    "oklch(0.48 0.16 24 / 0.34)", // US red
    "oklch(0.42 0.13 262 / 0.34)",
  ],
  command: ["oklch(0.4 0.13 260 / 0.5)", "oklch(0.46 0.14 250 / 0.4)", "oklch(0.52 0.12 66 / 0.2)"],
  people: [
    "oklch(0.46 0.12 152 / 0.36)",
    "oklch(0.55 0.13 64 / 0.26)",
    "oklch(0.42 0.13 262 / 0.34)",
  ],
  generic: ["oklch(0.5 0.12 66 / 0.2)", "oklch(0.42 0.13 262 / 0.4)", "oklch(0.46 0.11 156 / 0.2)"],
};

export function EnvironmentLayer({
  room = "generic",
  className,
}: {
  room?: RoomKey;
  className?: string;
}) {
  const [a, b, c] = BLOBS[room];
  return (
    <div
      aria-hidden
      data-room={room}
      className={cn(
        "pointer-events-none overflow-hidden opacity-[0.55] dark:opacity-45",
        className,
      )}
    >
      <div
        className="animate-drift absolute -left-[12%] -top-[10%] h-[42vmax] w-[42vmax] rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${a}, transparent 66%)` }}
      />
      <div
        className="animate-drift absolute -right-[14%] top-[4%] h-[38vmax] w-[38vmax] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${b}, transparent 66%)`,
          animationDelay: "-6s",
        }}
      />
      <div
        className="animate-drift absolute -bottom-[18%] left-[28%] h-[46vmax] w-[46vmax] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${c}, transparent 68%)`,
          animationDelay: "-11s",
        }}
      />
    </div>
  );
}
