import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QUOTES } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";
import { CharacterStage } from "./character-stage";
import { RoomScene } from "./room-scene";
import { ShiftIdentityTag } from "./shift-badge";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "GOOD MORNING";
  if (h < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

/**
 * Daily Energy — the "entering Officeverse for your shift" moment.
 * Gate logic unchanged: shows once per shift/session via `quoteSeen` / `markQuoteSeen`.
 */
export function QuotePopup() {
  const { user, quoteSeen, markQuoteSeen } = useSession();
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState(QUOTES[0]!);

  useEffect(() => {
    if (!user || quoteSeen) return;
    const idx = Math.floor(Math.random() * QUOTES.length);
    setQuote(QUOTES[idx]!);
    const t = setTimeout(() => setOpen(true), 350);
    return () => clearTimeout(t);
  }, [user, quoteSeen]);

  if (!user) return null;
  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const close = () => {
    setOpen(false);
    markQuoteSeen();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="max-w-lg overflow-hidden rounded-3xl border-border/70 p-0">
        <div data-shift={user.process} className="relative overflow-hidden">
          <div
            className="room-wash pointer-events-none absolute inset-0"
            aria-hidden
            data-room="workspace"
          />
          <div className="relative p-8 text-center">
            <p className="animate-rise-in font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Welcome back
            </p>
            <h2
              className="animate-rise-in mt-1 font-display text-3xl font-black tracking-tight sm:text-4xl"
              style={{ animationDelay: "60ms" }}
            >
              {greeting()}, {user.name.split(" ")[0]!.toUpperCase()}
            </h2>

            <div
              className="animate-rise-in relative mx-auto mt-6 w-full max-w-[340px] overflow-hidden rounded-[1.75rem]"
              style={{ animationDelay: "120ms", background: "var(--room-wash)" }}
              data-room="workspace"
            >
              <RoomScene
                room="workspace"
                className="absolute inset-x-0 bottom-0 h-[64%] w-full text-foreground opacity-90"
              />
              <div className="relative grid place-items-end px-5 pb-4 pt-7">
                <CharacterStage
                  name={user.name}
                  process={user.process}
                  presence="online"
                  pose="happy"
                  expression="excited"
                  showShiftBadge={false}
                />
              </div>
            </div>

            <div
              className="animate-rise-in mt-5 flex flex-wrap items-center justify-center gap-2"
              style={{ animationDelay: "180ms" }}
            >
              <ShiftIdentityTag code={user.process} />
              <span className="rounded-2xl border border-border/70 bg-card/60 px-4 py-2.5 text-xs text-muted-foreground">
                {date}
              </span>
            </div>

            <div
              className="animate-rise-in mt-6 rounded-2xl border border-border/70 bg-card/70 p-5"
              style={{ animationDelay: "240ms" }}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Today&apos;s energy
              </p>
              <p className="mt-2 font-display text-lg font-semibold leading-snug">
                &ldquo;{quote}&rdquo;
              </p>
            </div>

            <Button
              className="animate-rise-in mt-7 w-full rounded-full py-6 text-base font-black tracking-wide"
              style={{ animationDelay: "300ms" }}
              onClick={close}
            >
              LET&apos;S GET IT 🚀
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Your workspace is ready.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
