import { createFileRoute } from "@tanstack/react-router";
import { Check, RotateCcw, Save, Shuffle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FloatingPanel } from "@/components/officeverse/floating-panel";
import { Workstation } from "@/components/officeverse/workstation";
import { OfficeCharacter } from "@/components/officeverse/office-character/office-character";
import { PhotoUploadField } from "@/components/officeverse/identity-controls";
import { ShiftBadge } from "@/components/officeverse/shift-badge";
import {
  CATEGORY_LABELS,
  DEFAULT_AVATAR,
  HAIR,
  OPTION_LABELS,
  OPTIONS,
  OUTFIT_COLOR,
  PERSONAS,
  SKIN,
  randomAvatar,
  type AvatarCategory,
} from "@/lib/officeverse/avatar";
import { PROCESSES } from "@/lib/officeverse/data";
import type { AvatarConfig, CharacterPose, ProcessCode } from "@/lib/officeverse/types";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/avatar-studio")({
  head: () => ({
    meta: [
      { title: "Create Your Office Character — TeleMaster India" },
      {
        name: "description",
        content: "Build the illustrated character that represents you across the TeleMaster India.",
      },
      { property: "og:title", content: "Create Your Office Character — TeleMaster India" },
      { property: "og:description", content: "Your character. Your TeleMaster India identity." },
    ],
  }),
  component: AvatarStudioPage,
});

type GroupId = "build" | "face" | "hair" | "outfit" | "extras" | "process";

const GROUPS: { id: Exclude<GroupId, "process">; label: string; cats: AvatarCategory[] }[] = [
  { id: "build", label: "Character", cats: ["presentation"] },
  { id: "face", label: "Face", cats: ["skin", "facialHair", "expression"] },
  { id: "hair", label: "Hair", cats: ["hair", "hairColor"] },
  { id: "outfit", label: "Outfit", cats: ["outfit", "outfitColor"] },
  { id: "extras", label: "Accessories", cats: ["glasses", "headwear", "accessory"] },
];

const COLOR_CATS: AvatarCategory[] = ["hairColor", "outfitColor"];
const BUST_CATS: AvatarCategory[] = ["skin", "facialHair", "expression", "glasses", "headwear"];
const POSES: CharacterPose[] = [
  "idle",
  "working",
  "happy",
  "thinking",
  "celebrating",
  "concerned",
  "focused",
  "wave",
];

function swatch(cat: AvatarCategory, value: string): string {
  if (cat === "hairColor") return HAIR[value as keyof typeof HAIR].base;
  return OUTFIT_COLOR[value as keyof typeof OUTFIT_COLOR].base;
}

function AvatarStudioPage() {
  const { user, avatar, setAvatar, setProcess } = useSession();
  const saved = useMemo(() => avatar ?? DEFAULT_AVATAR, [avatar]);

  const [draft, setDraft] = useState<AvatarConfig>(saved);
  const [dirty, setDirty] = useState(false);
  const [group, setGroup] = useState<GroupId>("build");
  const [pose, setPose] = useState<CharacterPose>("idle");

  useEffect(() => {
    if (!dirty) setDraft(saved);
  }, [saved, dirty]);

  if (!user) return null;

  const setField = (key: AvatarCategory, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }) as AvatarConfig);
    setDirty(true);
  };
  const applyPersona = (base: (typeof PERSONAS)[number]["base"]) => {
    setDraft((d) => ({
      ...base,
      presentation: d.presentation,
      skin: d.skin,
      hairColor: d.hairColor,
    }));
    setDirty(true);
  };

  const onSave = () => {
    setAvatar(draft);
    setDirty(false);
    toast.success("Character saved", {
      description: "This is you across the TeleMaster India now.",
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-display text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            <span aria-hidden>🎨</span> Character Studio
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-black leading-tight sm:text-4xl">
            Create your office character
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Build the character that shows up at your desk, in the Deal Room, on every roster.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => {
              setDraft(saved);
              setDirty(false);
            }}
            disabled={!dirty}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => {
              setDraft(randomAvatar());
              setDirty(true);
            }}
          >
            <Shuffle className="mr-2 h-4 w-4" /> Surprise me
          </Button>
          <Button className="rounded-full" onClick={onSave} disabled={!dirty}>
            <Save className="mr-2 h-4 w-4" /> Save character
          </Button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ---------- preview ---------- */}
        <FloatingPanel className="relative" bodyClassName="p-6">
          <div
            className="room-wash pointer-events-none absolute inset-0"
            aria-hidden
            data-room="workspace"
          />
          <div className="relative flex flex-col items-center">
            <Workstation
              name={user.name}
              process={user.process}
              config={draft}
              pose={pose}
              room="workspace"
              className="w-full max-w-[360px]"
            />
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {POSES.map((ps) => (
                <button
                  key={ps}
                  type="button"
                  onClick={() => setPose(ps)}
                  aria-pressed={pose === ps}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors",
                    pose === ps
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ps}
                </button>
              ))}
            </div>

            <div className="mt-6 w-full">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Start from a vibe
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PERSONAS.map((persona) => (
                  <button
                    key={persona.id}
                    type="button"
                    onClick={() => applyPersona(persona.base)}
                    title={persona.blurb}
                    className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {persona.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 w-full border-t border-border/60 pt-5">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Or use a real photo
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                A real profile photograph replaces your character everywhere your avatar is shown.
              </p>
              <PhotoUploadField name={user.name} />
            </div>
          </div>
        </FloatingPanel>

        {/* ---------- controls ---------- */}
        <FloatingPanel bodyClassName="p-0">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] divide-x divide-border/60">
            <nav className="space-y-1 p-3" aria-label="Character groups">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroup(g.id)}
                  aria-current={group === g.id ? "true" : undefined}
                  className={cn(
                    "block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors",
                    group === g.id
                      ? "bg-primary/12 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )}
                >
                  {g.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setGroup("process")}
                aria-current={group === "process" ? "true" : undefined}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors",
                  group === "process"
                    ? "bg-primary/12 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                Process
              </button>
            </nav>

            <div className="space-y-6 p-4">
              {group === "process" ? (
                <ProcessPicker
                  current={user.process}
                  onPick={setProcess}
                  editable={user.role === "admin"}
                />
              ) : (
                GROUPS.find((g) => g.id === group)!.cats.map((cat) => (
                  <div key={cat}>
                    <p className="mb-2.5 font-display text-sm font-bold">{CATEGORY_LABELS[cat]}</p>
                    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                      {(OPTIONS[cat] as readonly string[]).map((value) => {
                        const selected = draft[cat] === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setField(cat, value)}
                            aria-pressed={selected}
                            title={OPTION_LABELS[value] ?? value}
                            className={cn(
                              "group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all",
                              selected
                                ? "border-primary bg-primary/10"
                                : "border-border bg-secondary/25 hover:-translate-y-0.5",
                            )}
                          >
                            {selected ? (
                              <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : null}
                            {COLOR_CATS.includes(cat) ? (
                              <span
                                className="h-12 w-12 rounded-full ring-1 ring-black/10"
                                style={{ background: swatch(cat, value) }}
                                aria-hidden
                              />
                            ) : (
                              <span className="h-16 w-14 overflow-hidden rounded-lg bg-background/50">
                                <OfficeCharacter
                                  config={{ ...draft, [cat]: value } as AvatarConfig}
                                  frame={BUST_CATS.includes(cat) ? "bust" : "full"}
                                  animated={false}
                                />
                              </span>
                            )}
                            <span className="max-w-full truncate text-[10px] font-medium text-muted-foreground">
                              {OPTION_LABELS[value] ?? value}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </FloatingPanel>
      </div>
    </div>
  );
}

function ProcessPicker({
  current,
  onPick,
  editable,
}: {
  current: ProcessCode;
  onPick: (p: ProcessCode) => void;
  editable: boolean;
}) {
  return (
    <div>
      <p className="mb-1 font-display text-sm font-bold">Your shift</p>
      <p className="mb-3 text-xs text-muted-foreground">
        {editable
          ? "Assign the process. This updates the environment and the character's country cue everywhere."
          : "Your process is assigned by your admin. It gives your character a subtle country cue and sets the environment."}
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {(Object.keys(PROCESSES) as ProcessCode[]).map((code) => {
          const p = PROCESSES[code];
          const active = current === code;
          return (
            <button
              key={code}
              type="button"
              disabled={!editable}
              onClick={() => editable && onPick(code)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                active ? "border-primary bg-primary/10" : "border-border bg-secondary/25",
                editable && !active && "hover:-translate-y-0.5",
                !editable && !active && "cursor-default opacity-55",
              )}
            >
              <span className="text-xl leading-none" aria-hidden>
                {p.flags}
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-bold">{p.shift}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{p.hours}</span>
              </span>
              {active ? <ShiftBadge code={code} className="ml-auto" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
