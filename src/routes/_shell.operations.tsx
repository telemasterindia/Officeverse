import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  useCelebrationCue,
  type InlineAudioSpec,
} from "@/components/celebration/useCelebrationAudio";
import { resolveAudioProfile } from "@/components/celebration/celebration-audio-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PageHeader,
  SectionCard,
  EmptyState,
  MetricCard,
} from "@/components/officeverse/primitives";
import { RoleGate } from "@/components/officeverse/role-gate";
import { RuleBuilderDialog } from "@/components/officeverse/scoring/rule-builder";
import { DryRunPanel } from "@/components/officeverse/scoring/dry-run-panel";
import { useScoringRules, useSetScoringRuleEnabled } from "@/lib/officeverse/use-scoring";
import type { ScoringRuleDTO } from "@/lib/officeverse/scoring-fns";
import {
  announcementsFn,
  celebrationOverviewFn,
  celebrationProfilesFn,
  createAnnouncementFn,
  createCelebrationProfileFn,
  createMilestoneFn,
  createPowerHourFn,
  milestonesFn,
  operationsAuditFn,
  playAnnouncementNowFn,
  playCelebrationProfileFn,
  powerHoursFn,
  previewAnnouncementFn,
  previewCelebrationProfileFn,
  setAnnouncementEnabledFn,
  setCelebrationProfileEnabledFn,
  setMilestoneEnabledFn,
  simulateMilestoneFn,
  startPowerHourFn,
  stopAnnouncementCcFn,
  stopPowerHourFn,
  triggerTestCelebrationFn,
  updateAnnouncementFn,
  updateCelebrationProfileFn,
  updateMilestoneFn,
} from "@/lib/officeverse/operations-fns";
import {
  approveIncentiveResultFn,
  calculateIncentivesFn,
  createIncentiveSchemeFn,
  finalizeIncentiveResultFn,
  incentiveDryRunFn,
  incentiveResultsFn,
  incentiveSchemesFn,
  reverseIncentiveResultFn,
  reviewIncentiveResultFn,
  setIncentiveSchemeEnabledFn,
} from "@/lib/officeverse/incentive-fns";

export const Route = createFileRoute("/_shell/operations")({
  head: () => ({
    meta: [
      { title: "Operations Control — TMI Officeverse" },
      {
        name: "description",
        content:
          "Admin + Operations Manager control for celebrations, Power Hour, team announcements and incentive/scoring rules. Recognition score only — no effect on pay.",
      },
    ],
  }),
  component: () => (
    <RoleGate allow={["admin", "closer"]}>
      <OperationsPage />
    </RoleGate>
  ),
});

function OperationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Control"
        description="Run team recognition, Power Hour, announcements and incentive/scoring rules. Every change is written to the immutable audit trail. Nothing here creates pay, salary, commission or incentive money."
      />
      <Tabs defaultValue="celebration">
        <TabsList className="flex-wrap">
          <TabsTrigger value="celebration">Celebration</TabsTrigger>
          <TabsTrigger value="profiles">Celebration Profiles</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="powerhour">Power Hour</TabsTrigger>
          <TabsTrigger value="incentive">Incentive &amp; Scoring</TabsTrigger>
          <TabsTrigger value="schemes">Incentive Schemes</TabsTrigger>
          <TabsTrigger value="results">Incentive Results</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="celebration" className="mt-5">
          <CelebrationOps />
        </TabsContent>
        <TabsContent value="profiles" className="mt-5">
          <CelebrationProfilesTab />
        </TabsContent>
        <TabsContent value="announcements" className="mt-5">
          <AnnouncementsTab />
        </TabsContent>
        <TabsContent value="milestones" className="mt-5">
          <MilestonesTab />
        </TabsContent>
        <TabsContent value="powerhour" className="mt-5">
          <PowerHourOps />
        </TabsContent>
        <TabsContent value="incentive" className="mt-5">
          <IncentiveOps />
        </TabsContent>
        <TabsContent value="schemes" className="mt-5">
          <IncentiveSchemesTab />
        </TabsContent>
        <TabsContent value="results" className="mt-5">
          <IncentiveResultsTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-5">
          <AuditOps />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------------------- celebration ops --------------------------- */

function CelebrationOps() {
  const q = useQuery({ queryKey: ["ops", "celebration"], queryFn: () => celebrationOverviewFn() });
  const test = useMutation({
    mutationFn: (v: { level: string; withAudio?: boolean }) =>
      triggerTestCelebrationFn({
        data: { level: v.level as "LEVEL_1", ...(v.withAudio ? { withAudio: true } : {}) },
      }),
    onSuccess: (r) => toast.success(`Test celebration queued (${r.level}, seq ${r.seq})`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <SectionCard title="Celebration">Loading…</SectionCard>;
  const data = q.data;
  if (!data) return <SectionCard title="Celebration">Unavailable</SectionCard>;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="Display" value={data.config.displayName} />
        <MetricCard label="Intensity" value={data.config.celebrationIntensity} />
        <MetricCard label="Sound" value={data.config.soundEnabled ? "On" : "Off"} />
        <MetricCard label="Rotation" value={`${data.config.rotationSec}s`} />
      </div>

      <SectionCard title="Celebration levels — preview / test">
        <div className="flex flex-wrap gap-2">
          {data.levels.map((lv) => (
            <Button
              key={lv.level}
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate({ level: lv.level })}
              title={`${lv.profile} · ${lv.particleProfile} · ${lv.durationMs}ms`}
            >
              {lv.level} · {lv.profile}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={test.isPending}
            onClick={() => test.mutate({ level: "LEVEL_2", withAudio: true })}
          >
            Test LEVEL 2 with audio (bell → announcement → chime)
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          A test publishes one synthetic celebration to the Office TV. It never runs scoring, never
          creates a business event, and carries 0 points. Audio depends on the Office TV kiosk
          allowing autoplay / speech; the visual always plays.
        </p>
      </SectionCard>

      <SectionCard title="Audio / announcement profiles">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile</TableHead>
                <TableHead>Pre</TableHead>
                <TableHead>Post</TableHead>
                <TableHead>TTS</TableHead>
                <TableHead>Announcement template</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.audioProfiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.label}</TableCell>
                  <TableCell>{p.preSound}</TableCell>
                  <TableCell>{p.postSound}</TableCell>
                  <TableCell>{p.ttsEnabled ? "on" : "off"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.ttsTemplate || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sound effects are synthesised (no copyrighted audio). Speech uses the kiosk browser&apos;s
          own text-to-speech. Master on/off is the Office&nbsp;TV “Sound” setting.
        </p>
      </SectionCard>

      <SectionCard title={`Recent recognition (${data.recent.length})`}>
        {data.recent.length === 0 ? (
          <EmptyState title="No recognition yet today" message="Events appear as the team works." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.kind}</TableCell>
                    <TableCell>{r.subjectUserId ?? "—"}</TableCell>
                    <TableCell>{r.points ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.referenceType ? `${r.referenceType}:${r.referenceId ?? ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.createdAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Points shown are supplied by the scoring engine — this screen never calculates a score.
        </p>
      </SectionCard>
    </div>
  );
}

/* ----------------------------- power hour ----------------------------- */

function PowerHourOps() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ops", "power-hours"], queryFn: () => powerHoursFn() });
  const [form, setForm] = useState({ title: "", message: "", startsAt: "", endsAt: "" });

  const create = useMutation({
    mutationFn: () => createPowerHourFn({ data: { ...form } }),
    onSuccess: () => {
      toast.success("Power Hour created");
      setForm({ title: "", message: "", startsAt: "", endsAt: "" });
      void qc.invalidateQueries({ queryKey: ["ops", "power-hours"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const start = useMutation({
    mutationFn: (id: number) => startPowerHourFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Power Hour started");
      void qc.invalidateQueries({ queryKey: ["ops", "power-hours"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: (id: number) => stopPowerHourFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Power Hour stopped");
      void qc.invalidateQueries({ queryKey: ["ops", "power-hours"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <SectionCard title="New Power Hour">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Title (e.g. 30 MINUTE SPRINT)"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <Input
            placeholder="Message shown on Office TV"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
          <Input
            placeholder="Start  YYYY-MM-DD HH:MM"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
          <Input
            placeholder="End  YYYY-MM-DD HH:MM"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </div>
        <Button className="mt-3" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus className="mr-1.5 h-4 w-4" /> Create
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          A Power Hour is a team announcement window on the Office TV. To make it affect points,
          create a matching scoring rule under “Incentive &amp; Scoring” — the two are audited
          independently.
        </p>
      </SectionCard>

      <SectionCard title={`Power Hours (${q.data?.rows.length ?? 0})`}>
        {(q.data?.rows.length ?? 0) === 0 ? (
          <EmptyState title="None yet" message="Create a Power Hour above." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.startsAt ?? "—"} → {r.endsAt ?? "—"}
                    </TableCell>
                    <TableCell>{r.audience}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => start.mutate(r.id)}>
                        Start
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => stop.mutate(r.id)}>
                        Stop
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* -------------------------- incentive / scoring -------------------------- */

function IncentiveOps() {
  const rules = useScoringRules();
  const toggle = useSetScoringRuleEnabled();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<ScoringRuleDTO | null>(null);

  return (
    <div className="space-y-6">
      <SectionCard title="Incentive & scoring rules">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Open-ended, versioned rules built from the scoring engine’s event / field registry.
            Editing appends an immutable version — historical results are never rewritten.
          </p>
          <Button
            onClick={() => {
              setEditing(null);
              setBuilderOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New rule
          </Button>
        </div>

        {rules.data?.rules.length ? (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.data.rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.event}</TableCell>
                    <TableCell>v{r.currentVersion}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={r.enabled ? "default" : "outline"}
                        onClick={() => toggle.mutate({ ruleId: r.id, enabled: !r.enabled })}
                      >
                        {r.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(r);
                          setBuilderOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="No rules yet" message="Create your first incentive/scoring rule." />
          </div>
        )}
      </SectionCard>

      <DryRunPanel />

      <RuleBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} editing={editing} />
    </div>
  );
}

/* -------------------------------- audit -------------------------------- */

function AuditOps() {
  const q = useQuery({
    queryKey: ["ops", "audit"],
    queryFn: () => operationsAuditFn({ data: {} }),
  });
  return (
    <SectionCard title={`Operations audit (${q.data?.rows.length ?? 0})`}>
      <p className="mb-3 text-xs text-muted-foreground">
        Immutable. Read-only. Written by the server from the authenticated session — this screen
        cannot edit or delete an audit record.
      </p>
      {(q.data?.rows.length ?? 0) === 0 ? (
        <EmptyState title="No operations audit yet" message="Actions appear here as they happen." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground">{r.createdAt}</TableCell>
                  <TableCell>{r.actorName ?? r.actorUserId ?? "—"}</TableCell>
                  <TableCell>{r.actorRole ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.entityType ? `${r.entityType}#${r.entityId ?? ""}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------- Phase 10 · celebration profiles ------------------ */

const EFFECT_KEYS = [
  "confetti",
  "colourParticles",
  "lightBurst",
  "energyBurst",
  "fireworks",
  "dollarRain",
  "goldEffect",
  "victoryEffect",
] as const;
const SHOW_KEYS = ["photo", "name", "achievementText", "points", "incentive"] as const;
const CUE_OPTS = ["none", "bell", "chime", "success", "applause", "victory", "alert"] as const;
const TRIGGER_OPTS = [
  "MANUAL",
  "LEAD_SUBMITTED",
  "LEAD_ACCEPTED",
  "SALE",
  "THIRD_ACCEPTED_LEAD",
  "TEAM_MILESTONE",
  "ACHIEVEMENT_UNLOCKED",
] as const;

type ProfileForm = {
  id: number | null;
  name: string;
  description: string;
  recognitionLevel: "LEVEL_1" | "LEVEL_2" | "LEVEL_3" | "LEVEL_4";
  triggerEvent: (typeof TRIGGER_OPTS)[number];
  priority: string;
  durationMs: string;
  intensity: "low" | "normal" | "high";
  achievementText: string;
  openingSound: (typeof CUE_OPTS)[number];
  closingSound: (typeof CUE_OPTS)[number];
  ttsEnabled: boolean;
  ttsTemplate: string;
  ttsRate: string;
  ttsPitch: string;
  ttsVolume: string;
  ttsLang: string;
  effects: Record<(typeof EFFECT_KEYS)[number], boolean>;
  show: Record<(typeof SHOW_KEYS)[number], boolean>;
};

const BLANK_PROFILE: ProfileForm = {
  id: null,
  name: "",
  description: "",
  recognitionLevel: "LEVEL_1",
  triggerEvent: "MANUAL",
  priority: "100",
  durationMs: "5000",
  intensity: "normal",
  achievementText: "",
  openingSound: "chime",
  closingSound: "none",
  ttsEnabled: false,
  ttsTemplate: "Attention team! {employeeName} has just accepted a lead.",
  ttsRate: "1",
  ttsPitch: "1",
  ttsVolume: "1",
  ttsLang: "en-US",
  effects: {
    confetti: true,
    colourParticles: true,
    lightBurst: true,
    energyBurst: false,
    fireworks: false,
    dollarRain: false,
    goldEffect: false,
    victoryEffect: false,
  },
  show: { photo: true, name: true, achievementText: true, points: true, incentive: false },
};

function formToConfig(f: ProfileForm) {
  return {
    durationMs: Number(f.durationMs) || 5000,
    intensity: f.intensity,
    show: { ...f.show },
    effects: { ...f.effects },
    particles: { count: null, size: null, fallSpeed: null, spread: null },
    light: { intensity: null },
    sound: { opening: f.openingSound, closing: f.closingSound },
    tts: {
      enabled: f.ttsEnabled,
      template: f.ttsTemplate,
      rate: Number(f.ttsRate) || 1,
      pitch: Number(f.ttsPitch) || 1,
      volume: Number(f.ttsVolume) || 1,
      lang: f.ttsLang || "en-US",
    },
    achievementText: f.achievementText.trim() || null,
  };
}

const selCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

function CelebrationProfilesTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["ops", "celeb-profiles"],
    queryFn: () => celebrationProfilesFn(),
  });
  const [f, setF] = useState<ProfileForm>(BLANK_PROFILE);
  const [preview, setPreview] = useState<unknown>(null);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ops", "celeb-profiles"] });
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: f.name,
        description: f.description || undefined,
        recognitionLevel: f.recognitionLevel,
        triggerEvent: f.triggerEvent,
        priority: Number(f.priority) || 100,
        config: formToConfig(f),
      };
      return f.id == null
        ? createCelebrationProfileFn({ data: payload })
        : updateCelebrationProfileFn({ data: { ...payload, id: f.id } });
    },
    onSuccess: () => {
      toast.success(
        f.id == null ? "Profile created (disabled — preview then enable)" : "Profile updated",
      );
      setF(BLANK_PROFILE);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) =>
      setCelebrationProfileEnabledFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const play = useMutation({
    mutationFn: (id: number) => playCelebrationProfileFn({ data: { id } }),
    onSuccess: (r) => toast.success(`Sent to Office TV (seq ${r.seq})`),
    onError: (e: Error) => toast.error(e.message),
  });
  const doPreview = useMutation({
    mutationFn: (id: number) => previewCelebrationProfileFn({ data: { id } }),
    onSuccess: (r) => setPreview(r.payload),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <SectionCard title={f.id == null ? "New celebration profile" : `Editing profile #${f.id}`}>
        <p className="mb-4 text-xs text-muted-foreground">
          Compose the effects a recognition moment uses — there is no fixed set of combinations. A
          profile bound to a trigger overrides the built-in default for that event; “Manual”
          profiles only play from here. Presentation only: a profile never scores, awards points, or
          touches pay/incentive money.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          <Input
            placeholder="Description (optional)"
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <Input
            placeholder="Achievement text override (e.g. LEAD ACCEPTED)"
            value={f.achievementText}
            onChange={(e) => set("achievementText", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Level
            <select
              className={selCls}
              value={f.recognitionLevel}
              onChange={(e) =>
                set("recognitionLevel", e.target.value as ProfileForm["recognitionLevel"])
              }
            >
              {["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Trigger
            <select
              className={selCls}
              value={f.triggerEvent}
              onChange={(e) => set("triggerEvent", e.target.value as ProfileForm["triggerEvent"])}
            >
              {TRIGGER_OPTS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Priority
            <Input
              className="w-24"
              value={f.priority}
              onChange={(e) => set("priority", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Duration ms
            <Input
              className="w-28"
              value={f.durationMs}
              onChange={(e) => set("durationMs", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Intensity
            <select
              className={selCls}
              value={f.intensity}
              onChange={(e) => set("intensity", e.target.value as ProfileForm["intensity"])}
            >
              {["low", "normal", "high"].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">
              Effects
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {EFFECT_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.effects[k]}
                    onChange={(e) => set("effects", { ...f.effects, [k]: e.target.checked })}
                  />
                  {k}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-muted-foreground">
              Show
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {SHOW_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.show[k]}
                    onChange={(e) => set("show", { ...f.show, [k]: e.target.checked })}
                  />
                  {k}
                  {k === "incentive" ? (
                    <span className="text-[10px] text-muted-foreground">(off by default)</span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            Opening sound
            <select
              className={selCls}
              value={f.openingSound}
              onChange={(e) => set("openingSound", e.target.value as ProfileForm["openingSound"])}
            >
              {CUE_OPTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Closing sound
            <select
              className={selCls}
              value={f.closingSound}
              onChange={(e) => set("closingSound", e.target.value as ProfileForm["closingSound"])}
            >
              {CUE_OPTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.ttsEnabled}
              onChange={(e) => set("ttsEnabled", e.target.checked)}
            />
            TTS enabled
          </label>
          <Input
            placeholder="TTS lang (en-US)"
            value={f.ttsLang}
            onChange={(e) => set("ttsLang", e.target.value)}
          />
          <Input
            className="sm:col-span-2 lg:col-span-4"
            placeholder="TTS template — {employeeName} {points} {headline} {eventLabel}"
            value={f.ttsTemplate}
            onChange={(e) => set("ttsTemplate", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Rate
            <Input
              className="w-20"
              value={f.ttsRate}
              onChange={(e) => set("ttsRate", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Pitch
            <Input
              className="w-20"
              value={f.ttsPitch}
              onChange={(e) => set("ttsPitch", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Volume
            <Input
              className="w-20"
              value={f.ttsVolume}
              onChange={(e) => set("ttsVolume", e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>
            {f.id == null ? "Create profile" : "Save changes"}
          </Button>
          {f.id != null ? (
            <Button variant="ghost" onClick={() => setF(BLANK_PROFILE)}>
              Cancel edit
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Sound effects are synthesised; speech uses the Office&nbsp;TV kiosk browser. Audio never
          blocks the visual — if the kiosk mutes autoplay the celebration still plays.
        </p>
      </SectionCard>

      <SectionCard title={`Profiles (${q.data?.profiles.length ?? 0})`}>
        {(q.data?.profiles.length ?? 0) === 0 ? (
          <EmptyState
            title="No profiles yet"
            message="Create one above, preview it, then enable."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Prio</TableHead>
                  <TableHead>Effects</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.recognitionLevel}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.triggerEvent ?? "manual"}
                    </TableCell>
                    <TableCell>{p.priority}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.entries(p.config.effects)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={p.enabled ? "default" : "outline"}
                        onClick={() => toggle.mutate({ id: p.id, enabled: !p.enabled })}
                      >
                        {p.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => doPreview.mutate(p.id)}>
                        Preview
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => play.mutate(p.id)}>
                        Play on TV
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setF({
                            ...BLANK_PROFILE,
                            id: p.id,
                            name: p.name,
                            description: p.description ?? "",
                            recognitionLevel: p.recognitionLevel as ProfileForm["recognitionLevel"],
                            triggerEvent: (p.triggerEvent ??
                              "MANUAL") as ProfileForm["triggerEvent"],
                            priority: String(p.priority),
                            durationMs: String(p.config.durationMs),
                            intensity: p.config.intensity,
                            achievementText: p.config.achievementText ?? "",
                            openingSound: p.config.sound.opening as ProfileForm["openingSound"],
                            closingSound: p.config.sound.closing as ProfileForm["closingSound"],
                            ttsEnabled: p.config.tts.enabled,
                            ttsTemplate: p.config.tts.template || BLANK_PROFILE.ttsTemplate,
                            ttsRate: String(p.config.tts.rate),
                            ttsPitch: String(p.config.tts.pitch),
                            ttsVolume: String(p.config.tts.volume),
                            ttsLang: p.config.tts.lang,
                            effects: { ...BLANK_PROFILE.effects, ...p.config.effects },
                            show: { ...BLANK_PROFILE.show, ...p.config.show },
                          })
                        }
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {preview != null ? (
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(preview, null, 2)}
          </pre>
        ) : null}
      </SectionCard>
    </div>
  );
}

/* ------------------- Phase 10 Stage 4 · milestone engine --------------- */

const MS_TYPES = [
  "INDIVIDUAL_COUNT",
  "INDIVIDUAL_POINTS",
  "INDIVIDUAL_EVENT",
  "TEAM_COUNT",
  "TEAM_POINTS",
  "TEAM_EVENT",
] as const;
const MS_PERIODS = ["DAILY", "WEEKLY", "MONTHLY", "ALL_TIME"] as const;
const MS_POLICIES = ["ONCE", "PER_PERIOD", "EVERY_THRESHOLD_CROSSING"] as const;
const MS_LEVELS = ["LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"] as const;

type MsForm = {
  id: number | null;
  name: string;
  description: string;
  type: (typeof MS_TYPES)[number];
  metric: string;
  threshold: string;
  period: (typeof MS_PERIODS)[number];
  triggerPolicy: (typeof MS_POLICIES)[number];
  priority: string;
  recognitionLevel: (typeof MS_LEVELS)[number];
  celebrationProfileId: string;
  announcementId: string;
  effectiveFrom: string;
  effectiveUntil: string;
};

const BLANK_MS: MsForm = {
  id: null,
  name: "",
  description: "",
  type: "INDIVIDUAL_COUNT",
  metric: "LEAD_ACCEPTED",
  threshold: "10",
  period: "ALL_TIME",
  triggerPolicy: "ONCE",
  priority: "100",
  recognitionLevel: "LEVEL_2",
  celebrationProfileId: "",
  announcementId: "",
  effectiveFrom: "",
  effectiveUntil: "",
};

function MilestonesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ops", "milestones"], queryFn: () => milestonesFn() });
  const profiles = useQuery({
    queryKey: ["ops", "celeb-profiles"],
    queryFn: () => celebrationProfilesFn(),
  });
  const anns = useQuery({ queryKey: ["ops", "announcements"], queryFn: () => announcementsFn() });
  const [f, setF] = useState<MsForm>(BLANK_MS);
  const [simUser, setSimUser] = useState("");
  const [sim, setSim] = useState<unknown>(null);
  const set = <K extends keyof MsForm>(k: K, v: MsForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ops", "milestones"] });

  const isTeam = f.type.startsWith("TEAM");
  const isPoints = f.type.endsWith("POINTS");

  const payload = () => ({
    name: f.name,
    description: f.description || undefined,
    type: f.type,
    metric: isPoints ? undefined : f.metric,
    threshold: Number(f.threshold) || 1,
    period: f.period,
    triggerPolicy: f.triggerPolicy,
    priority: Number(f.priority) || 100,
    recognitionLevel: f.recognitionLevel,
    ...(f.celebrationProfileId ? { celebrationProfileId: Number(f.celebrationProfileId) } : {}),
    ...(f.announcementId ? { announcementId: Number(f.announcementId) } : {}),
    effectiveFrom: f.effectiveFrom,
    ...(f.effectiveUntil ? { effectiveUntil: f.effectiveUntil } : {}),
  });

  const save = useMutation({
    mutationFn: () =>
      f.id == null
        ? createMilestoneFn({ data: payload() })
        : updateMilestoneFn({ data: { ...payload(), id: f.id } }),
    onSuccess: () => {
      toast.success(f.id == null ? "Milestone created (disabled)" : "Milestone updated");
      setF(BLANK_MS);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => setMilestoneEnabledFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const simulate = useMutation({
    mutationFn: (v: { id: number; userId?: number }) =>
      simulateMilestoneFn({ data: v.userId ? { id: v.id, userId: v.userId } : { id: v.id } }),
    onSuccess: (r) => setSim(r),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <SectionCard title={f.id == null ? "Create milestone" : `Editing milestone #${f.id}`}>
        <p className="mb-4 text-xs text-muted-foreground">
          Milestones are a RECOGNITION layer — they read authoritative ledger / performance data
          and, when the configured threshold is reached, fire ONE celebration / announcement to the
          Office TV. They never award points, never re-rank, never touch incentive or payroll.
          Definitions are Admin-only; a Closer can view + simulate.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          <Input
            placeholder="Description (spoken/shown)"
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Type
            <select
              className={selCls}
              value={f.type}
              onChange={(e) => set("type", e.target.value as MsForm["type"])}
            >
              {MS_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {!isPoints ? (
            <Input
              placeholder="Metric event key (LEAD_ACCEPTED, SALE, …)"
              value={f.metric}
              onChange={(e) => set("metric", e.target.value)}
            />
          ) : (
            <div className="text-xs text-muted-foreground self-center">
              points milestone — sums the authoritative ACTIVE ledger
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            Threshold
            <Input
              className="w-28"
              value={f.threshold}
              onChange={(e) => set("threshold", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Period
            <select
              className={selCls}
              value={f.period}
              onChange={(e) => set("period", e.target.value as MsForm["period"])}
            >
              {MS_PERIODS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Trigger policy
            <select
              className={selCls}
              value={f.triggerPolicy}
              onChange={(e) => set("triggerPolicy", e.target.value as MsForm["triggerPolicy"])}
            >
              {MS_POLICIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Level
            <select
              className={selCls}
              value={f.recognitionLevel}
              onChange={(e) =>
                set("recognitionLevel", e.target.value as MsForm["recognitionLevel"])
              }
            >
              {MS_LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Priority
            <Input
              className="w-24"
              value={f.priority}
              onChange={(e) => set("priority", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Celebration
            <select
              className={selCls}
              value={f.celebrationProfileId}
              onChange={(e) => set("celebrationProfileId", e.target.value)}
            >
              <option value="">Default</option>
              {(profiles.data?.profiles ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Announcement
            <select
              className={selCls}
              value={f.announcementId}
              onChange={(e) => set("announcementId", e.target.value)}
            >
              <option value="">None</option>
              {(anns.data?.rows ?? []).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Effective from
            <Input
              className="w-40"
              placeholder="YYYY-MM-DD"
              value={f.effectiveFrom}
              onChange={(e) => set("effectiveFrom", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Until (optional)
            <Input
              className="w-40"
              placeholder="YYYY-MM-DD"
              value={f.effectiveUntil}
              onChange={(e) => set("effectiveUntil", e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={save.isPending || f.name.trim().length < 1 || !f.effectiveFrom}
            onClick={() => save.mutate()}
          >
            {f.id == null ? "Create" : "Save changes"}
          </Button>
          {f.id != null ? (
            <Button variant="ghost" onClick={() => setF(BLANK_MS)}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title={`Milestones (${q.data?.milestones.length ?? 0})`}>
        {(q.data?.milestones.length ?? 0) === 0 ? (
          <EmptyState title="None yet" message="Create one above, simulate it, then enable." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.milestones.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell className="text-xs">{m.type}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.metric ?? "points"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.threshold}</TableCell>
                    <TableCell className="text-xs">{m.period}</TableCell>
                    <TableCell className="text-xs">{m.triggerPolicy}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={m.enabled ? "default" : "outline"}
                        onClick={() => toggle.mutate({ id: m.id, enabled: !m.enabled })}
                      >
                        {m.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          simulate.mutate({
                            id: m.id,
                            ...(simUser ? { userId: Number(simUser) } : {}),
                          })
                        }
                      >
                        Simulate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setF({
                            ...BLANK_MS,
                            id: m.id,
                            name: m.name,
                            description: m.description ?? "",
                            type: m.type as MsForm["type"],
                            metric: m.metric ?? "",
                            threshold: String(m.threshold),
                            period: m.period as MsForm["period"],
                            triggerPolicy: m.triggerPolicy as MsForm["triggerPolicy"],
                            priority: String(m.priority),
                            recognitionLevel: m.recognitionLevel as MsForm["recognitionLevel"],
                            celebrationProfileId: m.celebrationProfileId
                              ? String(m.celebrationProfileId)
                              : "",
                            announcementId: m.announcementId ? String(m.announcementId) : "",
                            effectiveFrom: m.effectiveFrom,
                            effectiveUntil: m.effectiveUntil ?? "",
                          })
                        }
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Simulate for individual user id:</span>
          <Input
            className="w-28"
            placeholder="userId"
            value={simUser}
            onChange={(e) => setSimUser(e.target.value)}
          />
        </div>
        {sim != null ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(sim, null, 2)}
          </pre>
        ) : null}
      </SectionCard>

      <SectionCard title={`Recent milestone fires (${q.data?.triggers.length ?? 0})`}>
        {(q.data?.triggers.length ?? 0) === 0 ? (
          <EmptyState
            title="No milestone fires yet"
            message="They appear here as thresholds are reached."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Value / Threshold</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.triggers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-muted-foreground">{t.triggeredAt}</TableCell>
                    <TableCell>#{t.milestoneId}</TableCell>
                    <TableCell className="text-xs">{t.userId ?? "TEAM"}</TableCell>
                    <TableCell className="text-xs">{t.periodKey}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.actualValue} / {t.thresholdValue}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.sourceType ? `${t.sourceType}:${t.sourceId ?? ""}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ---------------- Phase 10 Stage 2 · announcement command center -------- */

const ANN_CUE_OPTS = ["none", "bell", "chime", "success", "applause", "victory", "alert"] as const;

type AnnForm = {
  id: number | null;
  title: string;
  message: string;
  priority: "NORMAL" | "IMPORTANT" | "URGENT";
  audience: "all" | "agents" | "closers";
  durationMs: string;
  ttsEnabled: boolean;
  voiceName: string;
  rate: string;
  pitch: string;
  volume: string;
  lang: string;
  openingSound: (typeof ANN_CUE_OPTS)[number];
  closingSound: (typeof ANN_CUE_OPTS)[number];
  celebrationProfileId: string;
};

const BLANK_ANN: AnnForm = {
  id: null,
  title: "",
  message: "",
  priority: "NORMAL",
  audience: "all",
  durationMs: "12000",
  ttsEnabled: true,
  voiceName: "",
  rate: "1",
  pitch: "1",
  volume: "1",
  lang: "en-US",
  openingSound: "bell",
  closingSound: "bell",
  celebrationProfileId: "",
};

/** Runs the full opening → pause → TTS → closing sequence locally for Preview.
 *  Mounts the shared `useCelebrationCue` engine — no network, no side effects. */
function AnnouncementPreviewRunner({
  payload,
  onDone,
}: {
  payload: Record<string, unknown>;
  onDone: () => void;
}) {
  const audio = (payload["audio"] ?? {}) as {
    openingSound?: string;
    closingSound?: string;
    ttsEnabled?: boolean;
    spokenText?: string;
    tts?: InlineAudioSpec["tts"];
  };
  const dur = Number(payload["durationMs"]) || 12000;
  const spec: InlineAudioSpec = {
    openingSound: (audio.openingSound as InlineAudioSpec["openingSound"]) ?? "none",
    closingSound: (audio.closingSound as InlineAudioSpec["closingSound"]) ?? "none",
    tts: audio.tts ?? { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
  };
  useCelebrationCue({
    profile: resolveAudioProfile("silent"),
    announcement: audio.ttsEnabled ? (audio.spokenText ?? "") : "",
    soundEnabled: true,
    reduced: false,
    durationMs: dur,
    inlineSpec: spec,
  });
  useEffect(() => {
    const t = setTimeout(onDone, dur + 1200);
    return () => clearTimeout(t);
  }, [dur, onDone]);
  return null;
}

function AnnouncementsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["ops", "announcements"], queryFn: () => announcementsFn() });
  const profiles = useQuery({
    queryKey: ["ops", "celeb-profiles"],
    queryFn: () => celebrationProfilesFn(),
  });
  const [f, setF] = useState<AnnForm>(BLANK_ANN);
  const [previewPayload, setPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const set = <K extends keyof AnnForm>(k: K, v: AnnForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ops", "announcements"] });

  const payload = () => ({
    title: f.title,
    message: f.message,
    priority: f.priority,
    audience: f.audience,
    durationMs: Number(f.durationMs) || 12000,
    ttsEnabled: f.ttsEnabled,
    ttsConfig: {
      voiceName: f.voiceName || null,
      rate: Number(f.rate) || 1,
      pitch: Number(f.pitch) || 1,
      volume: Number(f.volume) || 1,
      lang: f.lang || "en-US",
    },
    openingSound: f.openingSound,
    closingSound: f.closingSound,
    ...(f.celebrationProfileId ? { celebrationProfileId: Number(f.celebrationProfileId) } : {}),
    publishNow: false,
  });

  const save = useMutation({
    mutationFn: () =>
      f.id == null
        ? createAnnouncementFn({ data: payload() })
        : updateAnnouncementFn({ data: { ...payload(), id: f.id } }),
    onSuccess: () => {
      toast.success(f.id == null ? "Announcement created (disabled)" : "Announcement updated");
      setF(BLANK_ANN);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => setAnnouncementEnabledFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: (id: number) => stopAnnouncementCcFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Announcement stopped");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const play = useMutation({
    mutationFn: (id: number) => playAnnouncementNowFn({ data: { id } }),
    onSuccess: (r) => toast.success(`Sent to Office TV (seq ${r.seq})`),
    onError: (e: Error) => toast.error(e.message),
  });
  const preview = useMutation({
    mutationFn: (id: number) => previewAnnouncementFn({ data: { id } }),
    onSuccess: (r) => {
      setPreviewPayload(r.payload as Record<string, unknown>);
      setRunning(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <SectionCard title={f.id == null ? "Create announcement" : `Editing announcement #${f.id}`}>
        <p className="mb-4 text-xs text-muted-foreground">
          Text is sanitised on save (no markup ever reaches the Office TV). Play&nbsp;on&nbsp;TV is
          an explicit operator action and may repeat; automatic business-event announcements stay
          idempotent. Nothing here creates points, incentive or payroll data.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            placeholder="Title"
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Priority
            <select
              className={selCls}
              value={f.priority}
              onChange={(e) => set("priority", e.target.value as AnnForm["priority"])}
            >
              {["NORMAL", "IMPORTANT", "URGENT"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Audience
            <select
              className={selCls}
              value={f.audience}
              onChange={(e) => set("audience", e.target.value as AnnForm["audience"])}
            >
              {["all", "agents", "closers"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          className="mt-3 w-full rounded-md border border-input bg-background p-2 text-sm shadow-sm"
          rows={3}
          placeholder="Message shown + spoken on the Office TV"
          value={f.message}
          onChange={(e) => set("message", e.target.value)}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.ttsEnabled}
              onChange={(e) => set("ttsEnabled", e.target.checked)}
            />
            TTS enabled
          </label>
          <Input
            placeholder="Voice name (optional)"
            value={f.voiceName}
            onChange={(e) => set("voiceName", e.target.value)}
          />
          <Input
            placeholder="Language (en-US)"
            value={f.lang}
            onChange={(e) => set("lang", e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            Duration ms
            <Input
              className="w-24"
              value={f.durationMs}
              onChange={(e) => set("durationMs", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Rate
            <Input className="w-20" value={f.rate} onChange={(e) => set("rate", e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Pitch
            <Input
              className="w-20"
              value={f.pitch}
              onChange={(e) => set("pitch", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Volume
            <Input
              className="w-20"
              value={f.volume}
              onChange={(e) => set("volume", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Opening
            <select
              className={selCls}
              value={f.openingSound}
              onChange={(e) => set("openingSound", e.target.value as AnnForm["openingSound"])}
            >
              {ANN_CUE_OPTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Closing
            <select
              className={selCls}
              value={f.closingSound}
              onChange={(e) => set("closingSound", e.target.value as AnnForm["closingSound"])}
            >
              {ANN_CUE_OPTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Celebration
            <select
              className={selCls}
              value={f.celebrationProfileId}
              onChange={(e) => set("celebrationProfileId", e.target.value)}
            >
              <option value="">None</option>
              {(profiles.data?.profiles ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={save.isPending || f.title.trim().length < 2}
            onClick={() => save.mutate()}
          >
            {f.id == null ? "Create" : "Save changes"}
          </Button>
          {f.id != null ? (
            <Button variant="ghost" onClick={() => setF(BLANK_ANN)}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title={`Announcements & history (${list.data?.rows.length ?? 0})`}>
        {(list.data?.rows.length ?? 0) === 0 ? (
          <EmptyState
            title="None yet"
            message="Create one above, preview it, then enable / play."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>TTS</TableHead>
                  <TableHead>Sounds</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data!.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.title}</TableCell>
                    <TableCell>{a.priority}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.status}</TableCell>
                    <TableCell className="text-xs">{a.ttsEnabled ? "on" : "off"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.audio.openingSound} → {a.audio.closingSound}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={a.enabled ? "default" : "outline"}
                        onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })}
                      >
                        {a.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => preview.mutate(a.id)}>
                        Preview
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => play.mutate(a.id)}>
                        Play on TV
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setF({
                            ...BLANK_ANN,
                            id: a.id,
                            title: a.title,
                            message: a.message,
                            priority: a.priority as AnnForm["priority"],
                            audience: a.audience as AnnForm["audience"],
                            durationMs: String(a.durationMs),
                            ttsEnabled: a.ttsEnabled,
                            voiceName: a.audio.tts.voiceName ?? "",
                            rate: String(a.audio.tts.rate),
                            pitch: String(a.audio.tts.pitch),
                            volume: String(a.audio.tts.volume),
                            lang: a.audio.tts.lang,
                            openingSound: a.audio.openingSound as AnnForm["openingSound"],
                            closingSound: a.audio.closingSound as AnnForm["closingSound"],
                            celebrationProfileId: a.celebrationProfileId
                              ? String(a.celebrationProfileId)
                              : "",
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => stop.mutate(a.id)}>
                        Stop
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {previewPayload ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase text-primary">
              Preview{" "}
              {running ? "· playing the opening → pause → TTS → closing sequence…" : "· done"}
            </p>
            {running ? (
              <AnnouncementPreviewRunner
                payload={previewPayload}
                onDone={() => setRunning(false)}
              />
            ) : null}
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(previewPayload, null, 2)}
            </pre>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

/* --------------------- Phase 9 · incentive schemes --------------------- */

function IncentiveSchemesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inc", "schemes"], queryFn: () => incentiveSchemesFn() });
  const [form, setForm] = useState({
    name: "",
    periodType: "monthly",
    priority: "100",
    combineMode: "independent",
    effectiveFrom: "",
    eligibility:
      '{ "op": "AND", "nodes": [ { "metric": "points", "operator": "gte", "value": 5000 } ] }',
    reward:
      '{ "kind": "TIERED", "metric": "points", "tiers": [ { "min": 5000, "amount": 2500 }, { "min": 7500, "amount": 5000 }, { "min": 10000, "amount": 10000 } ] }',
  });
  const [dry, setDry] = useState({ schemeId: "", userId: "", period: "monthly", from: "", to: "" });
  const [dryOut, setDryOut] = useState<unknown>(null);

  const create = useMutation({
    mutationFn: () => {
      let eligibility: unknown = null;
      let reward: unknown = null;
      try {
        eligibility = form.eligibility.trim() ? JSON.parse(form.eligibility) : null;
        reward = JSON.parse(form.reward);
      } catch {
        throw new Error("Eligibility / reward must be valid JSON");
      }
      return createIncentiveSchemeFn({
        data: {
          name: form.name,
          periodType: form.periodType as "monthly",
          priority: Number(form.priority) || 100,
          combineMode: form.combineMode as "independent",
          effectiveFrom: form.effectiveFrom,
          eligibility,
          reward,
        },
      });
    },
    onSuccess: () => {
      toast.success("Incentive scheme created (disabled — dry-run then enable)");
      void qc.invalidateQueries({ queryKey: ["inc", "schemes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => setIncentiveSchemeEnabledFn({ data: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inc", "schemes"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const dryRun = useMutation({
    mutationFn: () =>
      incentiveDryRunFn({
        data: {
          schemeId: Number(dry.schemeId),
          userId: Number(dry.userId),
          period: dry.period as "monthly",
          ...(dry.period === "custom" && dry.from && dry.to ? { from: dry.from, to: dry.to } : {}),
        },
      }),
    onSuccess: (r) => setDryOut(r),
    onError: (e: Error) => toast.error(e.message),
  });
  const calc = useMutation({
    mutationFn: (schemeId: number) =>
      calculateIncentivesFn({ data: { schemeId, period: "monthly" } }),
    onSuccess: (r) => {
      toast.success(`Calculated ${r.results.length} result(s)`);
      void qc.invalidateQueries({ queryKey: ["inc"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <SectionCard title="New incentive scheme">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="Effective from  YYYY-MM-DD"
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
          />
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.periodType}
            onChange={(e) => setForm({ ...form, periodType: e.target.value })}
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="custom">custom</option>
          </select>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.combineMode}
            onChange={(e) => setForm({ ...form, combineMode: e.target.value })}
          >
            <option value="independent">independent</option>
            <option value="exclusive">exclusive</option>
            <option value="highest">highest reward</option>
          </select>
          <Input
            placeholder="Priority (lower = first)"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </div>
        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          Eligibility (JSON condition tree over performance metrics)
        </label>
        <textarea
          className="mt-1 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          rows={3}
          value={form.eligibility}
          onChange={(e) => setForm({ ...form, eligibility: e.target.value })}
        />
        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          Reward (JSON — FIXED / TIERED / PERCENT / RECOGNITION)
        </label>
        <textarea
          className="mt-1 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          rows={3}
          value={form.reward}
          onChange={(e) => setForm({ ...form, reward: e.target.value })}
        />
        <Button className="mt-3" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus className="mr-1.5 h-4 w-4" /> Create scheme
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Metrics available: points, leadsSubmitted, leadsAccepted, followUps, sales, scoredLeads,
          totalActivity, rulePoints:&lt;id&gt;, eventPoints:&lt;EVENT&gt;. The engine consumes the
          Phase-8 snapshot — it never re-scores.
        </p>
      </SectionCard>

      <SectionCard title={`Schemes (${q.data?.schemes.length ?? 0})`}>
        {(q.data?.schemes.length ?? 0) === 0 ? (
          <EmptyState title="No schemes yet" message="Create one above, dry-run it, then enable." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Combine</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>v</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data!.schemes.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.periodType}</TableCell>
                    <TableCell>{s.combineMode}</TableCell>
                    <TableCell>{s.priority}</TableCell>
                    <TableCell>v{s.currentVersion}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={s.enabled ? "default" : "outline"}
                        onClick={() => toggle.mutate({ id: s.id, enabled: !s.enabled })}
                      >
                        {s.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => calc.mutate(s.id)}>
                        Calculate (this month)
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Dry-run (no result is persisted)">
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-32"
            placeholder="scheme id"
            value={dry.schemeId}
            onChange={(e) => setDry({ ...dry, schemeId: e.target.value })}
          />
          <Input
            className="w-32"
            placeholder="user id"
            value={dry.userId}
            onChange={(e) => setDry({ ...dry, userId: e.target.value })}
          />
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={dry.period}
            onChange={(e) => setDry({ ...dry, period: e.target.value })}
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="custom">custom</option>
          </select>
          {dry.period === "custom" ? (
            <>
              <Input
                className="w-36"
                placeholder="from"
                value={dry.from}
                onChange={(e) => setDry({ ...dry, from: e.target.value })}
              />
              <Input
                className="w-36"
                placeholder="to"
                value={dry.to}
                onChange={(e) => setDry({ ...dry, to: e.target.value })}
              />
            </>
          ) : null}
          <Button disabled={dryRun.isPending} onClick={() => dryRun.mutate()}>
            Dry-run
          </Button>
        </div>
        {dryOut ? (
          <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(dryOut, null, 2)}
          </pre>
        ) : null}
      </SectionCard>
    </div>
  );
}

function IncentiveResultsTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["inc", "results"],
    queryFn: () => incentiveResultsFn({ data: {} }),
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const useStep = (fn: (id: number) => Promise<unknown>, label: string) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        toast.success(label);
        void qc.invalidateQueries({ queryKey: ["inc", "results"] });
      },
      onError: (e: Error) => toast.error(e.message),
    });
  const review = useStep((id) => reviewIncentiveResultFn({ data: { id } }), "Reviewed");
  const approve = useStep((id) => approveIncentiveResultFn({ data: { id } }), "Approved");
  const finalize = useStep((id) => finalizeIncentiveResultFn({ data: { id } }), "Finalized");
  const reverse = useStep(
    (id) => reverseIncentiveResultFn({ data: { id, reason: "reversed via Operations" } }),
    "Reversed",
  );

  const rows = q.data?.results ?? [];
  return (
    <SectionCard title={`Incentive results (${rows.length})`}>
      <p className="mb-3 text-xs text-muted-foreground">
        Lifecycle CALCULATED → REVIEWED → APPROVED → FINALIZED. Review is Admin + Operations
        Manager; approve / finalize / reverse are Admin only. Finalized results are immutable.
        Non-pay outcomes (NOT_ELIGIBLE / NO_MATCH / OUT_OF_SCOPE) are shown, not errors. No payroll
        is written.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          title="No calculated results"
          message="Calculate a scheme from the Schemes tab."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Scheme</TableHead>
                <TableHead>v</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Reward</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <>
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <TableCell>{r.userId}</TableCell>
                    <TableCell>#{r.schemeId}</TableCell>
                    <TableCell>v{r.schemeVersion}</TableCell>
                    <TableCell className="text-xs">
                      {r.periodFrom}→{r.periodTo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rewardKind === "RECOGNITION"
                        ? (r.rewardLabel ?? "recognition")
                        : `${r.rewardAmount} ${r.currency}`}
                    </TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      {r.status === "CALCULATED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            review.mutate(r.id);
                          }}
                        >
                          Review
                        </Button>
                      ) : null}
                      {["CALCULATED", "REVIEWED"].includes(r.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            approve.mutate(r.id);
                          }}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {r.status === "APPROVED" ? (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            finalize.mutate(r.id);
                          }}
                        >
                          Finalize
                        </Button>
                      ) : null}
                      {r.status === "FINALIZED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            reverse.mutate(r.id);
                          }}
                        >
                          Reverse
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {openId === r.id ? (
                    <TableRow key={`${r.id}-x`}>
                      <TableCell colSpan={8}>
                        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                          {JSON.stringify(r.explanation, null, 2)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
