import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Activity, Eye, EyeOff, Lock, ShieldCheck, Trophy, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { HOME_BY_ROLE } from "@/lib/officeverse/nav";
import { useSession } from "@/lib/officeverse/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — TMI Officeverse CRM" },
      {
        name: "description",
        content:
          "Sign in to TMI Officeverse CRM — the internal platform for leads, follow-ups and team performance.",
      },
      { property: "og:title", content: "Sign in — TMI Officeverse CRM" },
      { property: "og:description", content: "Stronger Team. Stronger Results." },
    ],
  }),
  component: LoginPage,
});

const VALUES = [
  { icon: Activity, title: "Real Results", copy: "Track performance and achieve your goals" },
  { icon: Users, title: "One Team", copy: "Collaborate, support and grow together" },
  { icon: Trophy, title: "Recognize Success", copy: "Celebrate wins and inspire others" },
  {
    icon: ShieldCheck,
    title: "Secure & Reliable",
    copy: "Your data. Our priority. Always protected.",
  },
];

function LoginPage() {
  const { user, ready, devMode, signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Real team photography is optional — resolved client-side so a missing
  // asset never emits an SSR preload. Falls back to a clean navy field.
  const [hero, setHero] = useState<"pending" | "ok" | "none">("pending");

  useEffect(() => {
    if (ready && user) navigate({ to: HOME_BY_ROLE[user.role] });
  }, [ready, user, navigate]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setHero("ok");
    img.onerror = () => setHero("none");
    img.src = "/team-hero.jpg";
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      setError("Invalid email or password.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aurora relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto grid min-h-screen w-full max-w-[1400px] grid-cols-1 items-stretch lg:grid-cols-[1.15fr_minmax(0,480px)]">
        {/* ---------------- LEFT — team visual + brand story ---------------- */}
        <section className="relative order-2 hidden overflow-hidden bg-[oklch(0.13_0.024_262)] lg:order-1 lg:flex lg:flex-col">
          {/* Composed-hero backdrop — a deep-navy field with blue lighting.
              ALWAYS rendered: the fallback when no photo exists AND the navy
              field the copy + the team-photo band sit on. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(72% 55% at 16% 16%, oklch(0.4 0.16 256 / 0.3), transparent 70%), radial-gradient(62% 50% at 92% 100%, oklch(0.34 0.14 250 / 0.26), transparent 72%)",
            }}
          />

          {/* Art direction: the hero copy lives in the CLEAR upper-left navy
              area; the team photograph is a self-contained band BELOW it; the
              feature strip sits on the navy field below the band. The photo
              never runs behind the typography, so no headline or sentence can
              cross an employee's face. `justify-between` keeps that
              copy → photo → strip rhythm at every viewport height. */}
          <div className="relative z-10 flex flex-1 flex-col justify-between">
            {/* hero copy — pushed high into the clear upper navy area, above the
                people. Deliberately compact (text-4xl / xl:text-5xl) so it takes
                as little vertical space as possible and the photo band below can
                be as tall as possible. */}
            <div className="px-10 pt-8 xl:px-14 xl:pt-10">
              <div className="flex max-w-xl gap-4">
                <span
                  aria-hidden
                  className="mt-1 w-1 shrink-0 self-stretch rounded-full bg-primary"
                />
                <div>
                  <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-white [text-shadow:0_2px_16px_oklch(0.09_0.02_262_/_0.5)] xl:text-5xl">
                    Stronger Team.
                    <span className="mt-1 block text-primary">Stronger Results.</span>
                  </h1>
                  <p className="mt-4 max-w-md text-base font-medium leading-relaxed text-white/90">
                    At TMI Officeverse, we empower our people to achieve more, every day.
                  </p>
                </div>
              </div>
            </div>

            {/* team photograph — a TALL composed band that fills the space
                between the (now compact) copy and the feature strip. At the
                ~920px column width `object-cover` renders the 1536×1024 source
                ~613px tall, so a band of ~520–640px shows almost the ENTIRE
                image with the people at their natural size — no enlargement, no
                horizontal crop (cover only ever scales by width here). `min-h`
                keeps it tall on shorter screens (the panel scrolls rather than
                shrinking the photo); `max-h` stops a navy letterbox on very deep
                screens. `object-position:center 20%` keeps every head clear of
                the small top/bottom trim. */}
            <div className="relative my-4 w-full flex-1 overflow-hidden min-h-[500px] max-h-[640px] xl:my-5">
              {hero === "ok" ? (
                <img
                  src="/team-hero.jpg"
                  alt="The TMI Officeverse team"
                  className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
                />
              ) : null}
              {/* Light edge blend only — no text sits over the photo, so the
                  centre stays clear; the top/bottom fade the band into the
                  navy copy area above and the feature strip below. */}
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, oklch(0.13 0.024 262 / 0.92) 0%, oklch(0.12 0.022 262 / 0.28) 9%, transparent 22%, transparent 74%, oklch(0.12 0.02 262 / 0.5) 88%, oklch(0.12 0.022 262 / 0.96) 100%)",
                }}
              />
            </div>

            {/* feature strip — on the navy field below the photo */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-5 px-10 pb-8 xl:grid-cols-4 xl:px-14">
              {VALUES.map(({ icon: Icon, title, copy }) => (
                <div key={title} className="min-w-0">
                  <span className="grid h-9 w-9 place-items-center rounded-full border border-primary/60 bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-xs font-medium leading-snug text-white/75">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- RIGHT — sign-in panel ---------------- */}
        <section className="order-1 flex items-center justify-center p-5 sm:p-8 lg:order-2">
          <div className="surface-panel w-full max-w-[420px] rounded-2xl border p-7 sm:p-9">
            {/* brand */}
            <div className="flex flex-col items-center text-center">
              <span
                className="grid h-12 w-12 place-items-center rounded-2xl font-display text-xl font-black text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-hero)" }}
                aria-hidden
              >
                T
              </span>
              <p className="mt-3 font-display text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                TeleMaster India
              </p>
              <p className="mt-2 font-display text-3xl font-black tracking-tight">OFFICEVERSE</p>
              <p className="mt-1 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.32em] text-primary">
                <span aria-hidden className="h-px w-6 bg-primary/50" /> CRM
                <span aria-hidden className="h-px w-6 bg-primary/50" />
              </p>
            </div>

            <h2 className="mt-7 text-center font-display text-lg font-bold">
              Sign in to your account
            </h2>
            <p className="mx-auto mt-1.5 max-w-[19rem] text-center text-sm text-muted-foreground">
              Access your dashboard and manage your leads, follow-ups, and performance.
            </p>

            <form className="mt-6 space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    autoComplete="username"
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="px-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p role="alert" className="text-sm font-semibold text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 text-sm text-foreground/90">
                  <Checkbox defaultChecked /> Remember me
                </label>
                <button type="button" className="text-sm font-medium text-primary hover:underline">
                  Forgot Password?
                </button>
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-xl text-sm font-semibold"
                style={{ backgroundImage: busy ? undefined : "var(--gradient-hero)" }}
              >
                {busy ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            <div className="my-6 h-px bg-border" />
            <p className="text-center text-sm text-muted-foreground">
              Need help? Contact your{" "}
              <span className="font-medium text-primary">administrator</span>.
            </p>

            {devMode ? (
              <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-semibold text-warning">Dev mode</span> (no database): sign in
                with <code>admin@officeverse.dev</code> / <code>agent@officeverse.dev</code> /{" "}
                <code>closer@officeverse.dev</code> / <code>hr@officeverse.dev</code> · password{" "}
                <code>officeverse-dev</code>.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
