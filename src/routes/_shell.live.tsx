import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, PageHeader, SectionCard } from "@/components/officeverse/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/officeverse/session";
import {
  useCelebrationAssets,
  useCreateAnnouncement,
  useCreateDisplay,
  useOfficeTvAnnouncements,
  useOfficeTvDisplays,
  useOfficeTvSettings,
  usePublishAnnouncement,
  useRevokeDisplay,
  useRotateDisplay,
  useSeedOfficeTv,
  useSetCelebrationAssetEnabled,
  useStopAnnouncement,
  useUpdateOfficeTvSettings,
} from "@/lib/officeverse/use-office-tv";

export const Route = createFileRoute("/_shell/live")({
  head: () => ({ meta: [{ title: "Live Office — TeleMaster India" }] }),
  component: LiveOfficePage,
});

function LiveOfficePage() {
  const { user } = useSession();
  if (user?.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Live Office" description="Office TV, celebrations & broadcasts." />
        <EmptyState
          emoji="🔒"
          title="Admins only"
          message="Live Office control is restricted to Admins."
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Office"
        description="Control the read-only Office TV: display tokens, celebration assets, TV settings and admin broadcasts. Broadcasts are announcements only — they never create pay, incentive or commission data."
      />
      <SeedRow />
      <DisplaysSection />
      <AnnouncementsSection />
      <AssetsSection />
      <SettingsSection />
    </div>
  );
}

function SeedRow() {
  const seed = useSeedOfficeTv();
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">
        First run: create the built-in celebration effect registry + default TV settings.
      </p>
      <Button size="sm" variant="secondary" disabled={seed.isPending} onClick={() => seed.mutate()}>
        {seed.isPending ? "Seeding…" : "Seed defaults"}
      </Button>
      {seed.data && !("dbUnavailable" in seed.data && seed.data.dbUnavailable) ? (
        <span className="text-xs text-success">
          +{seed.data.assetsAdded} assets{seed.data.settingsCreated ? " · settings created" : ""}
        </span>
      ) : null}
    </Card>
  );
}

/* ------------------------------ displays ----------------------------- */

function DisplaysSection() {
  const q = useOfficeTvDisplays();
  const create = useCreateDisplay();
  const revoke = useRevokeDisplay();
  const rotate = useRotateDisplay();
  const [name, setName] = useState("");
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);

  return (
    <SectionCard title="TV displays">
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return;
          create.mutate(
            { name: name.trim() },
            {
              onSuccess: (r) => {
                setFreshToken({ name: name.trim(), token: r.token });
                setName("");
              },
            },
          );
        }}
      >
        <div>
          <label className="block text-[10px] uppercase text-muted-foreground">
            New display name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-64"
            placeholder="Sales floor TV"
          />
        </div>
        <Button type="submit" size="sm" disabled={create.isPending}>
          Create display token
        </Button>
      </form>

      {freshToken ? (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-semibold">Copy this token now — it is shown only once.</p>
          <p className="mt-1 break-all font-mono text-xs">{freshToken.token}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            On the TV, open <span className="font-mono">/office-tv?token=…</span> or paste it into
            the connect screen.
          </p>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setFreshToken(null)}>
            Done
          </Button>
        </div>
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.data?.dbUnavailable ? (
        <EmptyState
          emoji="🗄️"
          title="Database not connected"
          message="Displays need the database."
        />
      ) : (q.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No displays yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Token</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {q.data!.rows.map((d) => (
                <tr key={d.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {d.tokenPrefix}…
                  </td>
                  <td className="px-3 py-2">
                    {d.revokedAt ? (
                      <span className="text-destructive">revoked</span>
                    ) : d.enabled ? (
                      <span className="text-success">active</span>
                    ) : (
                      "disabled"
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{d.lastSeenAt ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="mr-3 text-xs text-primary hover:underline"
                      onClick={() =>
                        rotate.mutate(
                          { id: d.id },
                          {
                            onSuccess: (r) => setFreshToken({ name: d.name, token: r.token }),
                          },
                        )
                      }
                    >
                      rotate
                    </button>
                    <button
                      className="text-xs text-destructive hover:underline disabled:opacity-40"
                      disabled={!!d.revokedAt}
                      onClick={() => revoke.mutate({ id: d.id })}
                    >
                      revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* --------------------------- announcements -------------------------- */

function AnnouncementsSection() {
  const q = useOfficeTvAnnouncements();
  const create = useCreateAnnouncement();
  const publish = usePublishAnnouncement();
  const stop = useStopAnnouncement();
  const [f, setF] = useState({
    title: "",
    subtitle: "",
    message: "",
    priority: "NORMAL",
    durationMs: 12000,
    publishAt: "",
    expiresAt: "",
  });

  return (
    <SectionCard title="Broadcasts">
      <form
        className="mb-4 grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.title.trim().length < 2 || f.message.trim().length < 2) return;
          create.mutate(
            {
              title: f.title.trim(),
              subtitle: f.subtitle.trim() || undefined,
              message: f.message.trim(),
              priority: f.priority,
              durationMs: Number(f.durationMs) || 12000,
              publishAt: f.publishAt || undefined,
              expiresAt: f.expiresAt || undefined,
              publishNow: !f.publishAt,
            },
            { onSuccess: () => setF({ ...f, title: "", subtitle: "", message: "" }) },
          );
        }}
      >
        <Input
          placeholder="Title (e.g. POWER HOUR)"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <Input
          placeholder="Subtitle (optional)"
          value={f.subtitle}
          onChange={(e) => setF({ ...f, subtitle: e.target.value })}
        />
        <Input
          className="sm:col-span-2"
          placeholder="Message"
          value={f.message}
          onChange={(e) => setF({ ...f, message: e.target.value })}
        />
        <label className="text-xs text-muted-foreground">
          Priority
          <select
            className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value })}
          >
            <option>NORMAL</option>
            <option>IMPORTANT</option>
            <option>URGENT</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Duration (ms)
          <Input
            type="number"
            className="mt-1 h-9"
            value={f.durationMs}
            onChange={(e) => setF({ ...f, durationMs: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Publish at (IST, blank = now)
          <Input
            className="mt-1 h-9"
            placeholder="2026-08-30 22:00"
            value={f.publishAt}
            onChange={(e) => setF({ ...f, publishAt: e.target.value })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Expires at (IST, optional)
          <Input
            className="mt-1 h-9"
            placeholder="2026-08-30 23:00"
            value={f.expiresAt}
            onChange={(e) => setF({ ...f, expiresAt: e.target.value })}
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={create.isPending}>
            {f.publishAt ? "Schedule" : "Publish now"}
          </Button>
        </div>
      </form>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (q.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
      ) : (
        <ul className="space-y-2">
          {q.data!.rows.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <span>
                <span className="font-semibold">{a.title}</span>
                <span className="ml-2 text-[10px] font-bold uppercase text-muted-foreground">
                  {a.priority} · {a.status}
                </span>
                {a.publishAt ? (
                  <span className="ml-2 text-xs text-muted-foreground">@ {a.publishAt}</span>
                ) : null}
                {a.expiresAt ? (
                  <span className="ml-2 text-xs text-muted-foreground">→ {a.expiresAt}</span>
                ) : null}
              </span>
              <span className="flex gap-3">
                {a.status !== "published" ? (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => publish.mutate({ id: a.id })}
                  >
                    publish now
                  </button>
                ) : null}
                {a.status !== "stopped" && a.status !== "expired" ? (
                  <button
                    className="text-xs text-destructive hover:underline"
                    onClick={() => stop.mutate({ id: a.id })}
                  >
                    stop
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------ assets ----------------------------- */

function AssetsSection() {
  const q = useCelebrationAssets();
  const toggle = useSetCelebrationAssetEnabled();
  return (
    <SectionCard title="Celebration assets">
      <p className="mb-3 text-xs text-muted-foreground">
        Built-in effects always work as a fallback. Approved short videos (mp4/webm, ≤ 8 MB) can be
        added per category — original / licensed / owner-supplied only.
      </p>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (q.data?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No assets — run “Seed defaults”.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {q.data!.rows.map((a) => (
            <div key={a.id} className="rounded-lg border border-border/60 p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.category}</span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {a.kind}
                  {a.builtin ? " · builtin" : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{a.hasVideo ? "video attached" : "effect only"}</span>
                <button
                  className="text-primary hover:underline"
                  onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })}
                >
                  {a.enabled ? "disable" : "enable"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ----------------------------- settings ---------------------------- */

function SettingsSection() {
  const q = useOfficeTvSettings();
  const save = useUpdateOfficeTvSettings();
  const c = q.data?.config;
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const v = draft ?? (c as Record<string, unknown> | undefined) ?? {};

  if (q.isLoading || !c) return <SectionCard title="TV settings">Loading…</SectionCard>;

  return (
    <SectionCard title="TV settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Display name
          <Input
            className="mt-1 h-9"
            value={String(v["displayName"] ?? "")}
            onChange={(e) => setDraft({ ...v, displayName: e.target.value })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Rotation (seconds, 4–60)
          <Input
            type="number"
            className="mt-1 h-9"
            value={Number(v["rotationSec"] ?? 12)}
            onChange={(e) => setDraft({ ...v, rotationSec: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Leaderboard window
          <select
            className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={String(v["leaderboardWindow"] ?? "daily")}
            onChange={(e) => setDraft({ ...v, leaderboardWindow: e.target.value })}
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="alltime">alltime</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Celebration intensity
          <select
            className="mt-1 block h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={String(v["celebrationIntensity"] ?? "normal")}
            onChange={(e) => setDraft({ ...v, celebrationIntensity: e.target.value })}
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          “On fire” threshold (accepted leads/day)
          <Input
            type="number"
            className="mt-1 h-9"
            value={Number(v["thirdAcceptedThreshold"] ?? 3)}
            onChange={(e) => setDraft({ ...v, thirdAcceptedThreshold: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Team milestone every N accepted (0 = off)
          <Input
            type="number"
            className="mt-1 h-9"
            value={Number(v["teamMilestoneEvery"] ?? 0)}
            onChange={(e) => setDraft({ ...v, teamMilestoneEvery: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={Boolean(v["soundEnabled"])}
            onChange={(e) => setDraft({ ...v, soundEnabled: e.target.checked })}
          />
          Sound enabled (default off / safe)
        </label>
      </div>
      <div className="mt-3">
        <Button
          size="sm"
          disabled={save.isPending || !draft}
          onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}
        >
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </SectionCard>
  );
}
