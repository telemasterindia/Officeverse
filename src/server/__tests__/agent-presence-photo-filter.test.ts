/**
 * AGENT PRESENCE — UI UAT: a Photo column (server-authoritative StaffAvatar,
 * ~56–64px) and a process filter (ALL / US / UK / IN / AU) driven ONLY by the
 * authoritative server `process` field, with the header count following the
 * selection. Agents only — never closers.
 *
 * Structural guards + a pure check of the filter predicate. Command Center is
 * NOT touched by this test or the change it guards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROCESS_CODES } from "@/lib/db/schema";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const page = read("routes/_shell.presence.tsx");
const filter = read("components/officeverse/process-filter.tsx");

describe("shared ProcessFilter control", () => {
  it("offers ALL + the four authoritative PROCESS_CODES in the required order", () => {
    expect(filter).toMatch(/PROCESS_FILTER_OPTIONS = \[/);
    const ids = [...filter.matchAll(/id: "([A-Z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["ALL", ...PROCESS_CODES]); // ALL, US, UK, IN, AU
    // IN is labelled INDIA, AU stays AU (per the Agent Presence spec)
    expect(filter).toMatch(/id: "IN", label: "INDIA"/);
    expect(filter).toMatch(/id: "AU", label: "AU"/);
  });

  it("uses the Officeverse pill treatment: filled-when-selected + aria-pressed, controlled", () => {
    expect(filter).toMatch(/variant=\{value === o\.id \? "default" : "outline"\}/);
    expect(filter).toMatch(/aria-pressed=\{value === o\.id\}/);
    expect(filter).toMatch(/onClick=\{\(\) => onChange\(o\.id\)\}/);
    expect(filter).not.toMatch(/useState|useQuery|fetch\(/); // pure controlled component
  });
});

describe("Agent Presence — Photo column", () => {
  it("adds a dedicated Photo column rendered with the shared StaffAvatar (no new photo system)", () => {
    expect(page).toMatch(/<th className="[^"]*">Photo<\/th>/);
    expect(page).toMatch(/import \{ StaffAvatar \}/);
    expect(page).toMatch(/<StaffAvatar[\s\S]{0,400}size="roster"/); // 64px roster thumbnail
    expect(page).toMatch(/userId=\{s\?\.user_id\}/);
    expect(page).toMatch(/hasPhoto=\{s\?\.photo_available \?\? false\}/);
    expect(page).not.toMatch(/profilePhotoFn|agentPhotoFn|new Image\(|<img /);
  });

  it("the roster (64px) size is a real 56–64px token on PhotoDisplay + StaffAvatar", () => {
    expect(read("components/officeverse/photo/PhotoDisplay.tsx")).toMatch(/roster:\s*"h-16 w-16/);
    expect(read("components/officeverse/staff-avatar.tsx")).toMatch(/roster:\s*"roster"/);
  });

  it("keeps the existing presence columns and the server-derived status untouched", () => {
    for (const col of [
      "Agent",
      "Status",
      "Login time",
      "Last active",
      "Shift",
      "Process",
      "Sessions",
    ]) {
      expect(page).toMatch(new RegExp(`>${col}<`));
    }
    expect(page).toMatch(/STATUS_STYLE\[a\.status\]/);
    expect(page).toMatch(/a\.status/); // presence classification consumed as-is
    expect(page).not.toMatch(/derivePresence|onlineWithinMinutes|last[_ ]?seen/i); // no presence-logic change here
  });
});

describe("Agent Presence — process filter", () => {
  it("is wired into the panel header, defaults to ALL, no reload", () => {
    expect(page).toMatch(/useState<ProcessFilterValue>\("ALL"\)/);
    expect(page).toMatch(/action=\{[\s\S]{0,120}<ProcessFilter/);
    expect(page).toMatch(/onChange=\{setProcessFilter\}/);
  });

  it("filters on the AUTHORITATIVE server `process` field only", () => {
    // the ONLY filtering expression in the page is a plain equality on a.process
    expect(page).toMatch(
      /processFilter === "ALL" \? rows : rows\.filter\(\(a\) => a\.process === processFilter\)/,
    );
    // no filter keyed off name / shift label / emoji / flag
    expect(page).not.toMatch(/filter\(\(a\) => a\.name/);
    expect(page).not.toMatch(/filter\(\(a\) => a\.shift/);
  });

  it("is agent-only — the presence source is agents, closers never enter", () => {
    expect(page).toMatch(/useAgentPresence\(\)/);
    expect(page).toMatch(/useServerStaff\("agent"\)/);
    expect(page).not.toMatch(/useServerStaff\("closer"\)|kind === "closer"|closers/);
  });

  it("the header count follows the filtered set", () => {
    expect(page).toMatch(/\$\{filtered\.length\} agent\$\{filtered\.length === 1 \? "" : "s"\}/);
  });

  it("shows the standard empty state when a process has no agents", () => {
    expect(page).toMatch(/filtered\.length === 0 \?[\s\S]{0,200}<EmptyState/);
  });
});

describe("filter predicate — pure equality on the server code, agents only", () => {
  const agents = [
    { agentCode: "A1", process: "US" },
    { agentCode: "A2", process: "US" },
    { agentCode: "A3", process: "IN" },
    { agentCode: "A4", process: "UK" },
    { agentCode: "A5", process: "AU" },
    { agentCode: "A6", process: "US" },
  ];
  const apply = (f: string) => (f === "ALL" ? agents : agents.filter((a) => a.process === f));

  it("ALL → every agent", () => expect(apply("ALL")).toHaveLength(6));
  it("US → only US agents", () =>
    expect(apply("US").map((a) => a.agentCode)).toEqual(["A1", "A2", "A6"]));
  it("UK → only UK", () => expect(apply("UK").map((a) => a.agentCode)).toEqual(["A4"]));
  it("INDIA (IN) → only IN", () => expect(apply("IN").map((a) => a.agentCode)).toEqual(["A3"]));
  it("AU → only AU", () => expect(apply("AU").map((a) => a.agentCode)).toEqual(["A5"]));
  it("counts update: ALL 6 · US 3 · IN 1 · UK 1 · AU 1", () => {
    expect(
      [apply("ALL"), apply("US"), apply("IN"), apply("UK"), apply("AU")].map((r) => r.length),
    ).toEqual([6, 3, 1, 1, 1]);
  });
  it("every bucket sums back to the whole roster — nothing lost or doubled", () => {
    const sum = (["US", "UK", "IN", "AU"] as const).reduce((n, p) => n + apply(p).length, 0);
    expect(sum).toBe(agents.length);
  });
});
