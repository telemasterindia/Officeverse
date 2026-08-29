import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { PROCESSES, DEMO_USERS, ROLE_LABEL } from "@/lib/officeverse/data";
import { HOME_BY_ROLE } from "@/lib/officeverse/nav";
import { useSession } from "@/lib/officeverse/session";
import type { Role } from "@/lib/officeverse/types";
import { Workstation } from "@/components/officeverse/workstation";
import { ProcessRibbon } from "@/components/officeverse/process-ribbon";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — TeleMaster India" },
      {
        name: "description",
        content:
          "Sign in to TeleMaster India, the internal sales and operations workspace for Exclusive Verified Leads.",
      },
      { property: "og:title", content: "Sign in — TeleMaster India" },
      { property: "og:description", content: "Your work. Your leads. Your wins." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, ready, signIn } = useSession();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>("agent");

  useEffect(() => {
    if (ready && user) navigate({ to: HOME_BY_ROLE[user.role] });
  }, [ready, user, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn(role);
    navigate({ to: HOME_BY_ROLE[role] });
  };

  return (
    <div
      data-room="workspace"
      data-process="US"
      className="aurora relative min-h-screen overflow-hidden bg-background"
    >
      <ProcessRibbon
        process="US"
        className="pointer-events-none fixed inset-x-0 top-0 -z-[1] h-[52vh]"
      />
      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-5 py-12 lg:grid-cols-[1.1fr_minmax(0,420px)] lg:gap-16">
        <section className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              className="grid h-12 w-12 place-items-center rounded-2xl font-display text-xl font-black text-primary-foreground"
              style={{ backgroundImage: "var(--gradient-hero)" }}
              aria-hidden
            >
              T
            </span>
            <div>
              <p className="font-display text-lg font-black tracking-[0.18em]">TELEMASTER INDIA</p>
              <p className="text-xs text-muted-foreground">Global Sales Floor · India → USA</p>
            </div>
          </div>

          <h1 className="mt-10 font-display text-5xl font-black leading-[1.05] sm:text-6xl">
            The sales floor
            <span className="mt-2 block text-gradient">is open.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted-foreground">
            Leads, follow-ups, teams and people — one command center for every shift, from India to
            the US market.
          </p>

          <Workstation
            bare
            name="TeleMaster India"
            room="workspace"
            pose="working"
            expression="happy"
            className="mt-6 hidden w-full max-w-[520px] sm:block"
          />

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.values(PROCESSES).map((p) => (
              <Card
                key={p.code}
                className="surface-panel rounded-2xl border-border/70 p-4 transition-transform duration-200 hover:-translate-y-1"
              >
                <p className="text-2xl leading-none" aria-hidden>
                  {p.flags}
                </p>
                <p className="mt-3 font-display text-sm font-bold">{p.shift}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{p.hours}</p>
              </Card>
            ))}
          </div>
        </section>

        <Card className="surface-panel w-full rounded-3xl border-border/70 p-7">
          <h2 className="font-display text-xl font-bold">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose your workspace to continue.</p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {(Object.keys(DEMO_USERS) as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                  role === r
                    ? "border-primary/50 bg-primary/12 text-foreground glow-ring"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email / Username</Label>
              <Input
                id="email"
                type="text"
                defaultValue={DEMO_USERS[role].email}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                defaultValue="officeverse"
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox defaultChecked /> Remember me
              </label>
              <button type="button" className="text-sm font-medium text-accent hover:underline">
                Forgot password?
              </button>
            </div>
            <Button type="submit" className="w-full rounded-full py-6 text-base font-bold">
              Login
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Signing in as {DEMO_USERS[role].name} · {DEMO_USERS[role].designation}
          </p>
        </Card>
      </div>
    </div>
  );
}
