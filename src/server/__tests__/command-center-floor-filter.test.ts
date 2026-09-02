/**
 * COMMAND CENTER — "On the floor" UAT refinement.
 *
 *   1. staff thumbnails at ~64px via the shared StaffAvatar (no new photo system)
 *   2. a process/shift filter (ALL / US / UK / IN / AU) that narrows the
 *      AUTHORITATIVE server roster by the staff DTO's `process` field only, with
 *      the header counts following the selection
 *
 * Structural guards + a pure check of the filter predicate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROCESS_CODES } from "@/lib/db/schema";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const mc = read("routes/_shell.mission-control.tsx");

describe("64px roster thumbnails via the shared StaffAvatar", () => {
  it("PhotoDisplay + StaffAvatar expose a 64px (h-16 w-16) 'roster' size", () => {
    const pd = read("components/officeverse/photo/PhotoDisplay.tsx");
    expect(pd).toMatch(/roster:\s*"h-16 w-16/); // 64px, circular via rounded-full
    const sa = read("components/officeverse/staff-avatar.tsx");
    expect(sa).toMatch(/roster:\s*"roster"/);
  });

  it('the On the floor cards render StaffAvatar size="roster" for BOTH agents and closers', () => {
    // one roster built from both sources, one card renderer
    expect(mc).toMatch(
      /\.\.\.agents\.map\(\(a\) => \(\{ \.\.\.a, designation: "Sales Agent" \}\)\)/,
    );
    expect(mc).toMatch(/\.\.\.closers\.map\(\(c\) => \(\{ \.\.\.c, designation: "Closer" \}\)\)/);
    expect(mc).toMatch(/<StaffAvatar[\s\S]{0,200}size="roster"/);
    expect(mc).toMatch(/userId=\{e\.user_id\}/);
    expect(mc).toMatch(/hasPhoto=\{e\.photo_available\}/);
    // no bespoke <img> / new photo path
    expect(mc).not.toMatch(/profilePhotoFn|agentPhotoFn|closerPhotoFn|new Image\(/);
    // identity fields kept
    expect(mc).toMatch(/\{e\.full_name\}/);
    expect(mc).toMatch(/\{e\.designation\} · \{e\.code\}/);
    expect(mc).toMatch(/PROCESSES\[e\.process as keyof typeof PROCESSES\]\?\.flags/);
  });
});

describe("process / shift filter", () => {
  it("offers exactly ALL + the four authoritative PROCESS_CODES", () => {
    expect(mc).toMatch(/const FLOOR_FILTERS = \[/);
    for (const id of ["ALL", ...PROCESS_CODES]) {
      expect(mc, `filter option ${id}`).toMatch(new RegExp(`id: "${id}"`));
    }
    // INDIA / AUSTRALIA are LABELS only — the id is the server code
    expect(mc).toMatch(/id: "IN", label: "India"/);
    expect(mc).toMatch(/id: "AU", label: "Australia"/);
  });

  it("filters on the SERVER `process` field, never display text / emoji / guesses", () => {
    expect(mc).toMatch(/roster\.filter\(\(e\) => e\.process === floorFilter\)/);
    // agents + closers filtered together = one filtered list drives everything
    expect(mc).toMatch(/floorFilter === "ALL" \? roster : roster\.filter/);
  });

  it("header counts follow the filtered set (team / agents / closers)", () => {
    expect(mc).toMatch(
      /\$\{floor\.rows\.length\} on the team · \$\{floor\.agents\} agents · \$\{floor\.closers\} closers/,
    );
    expect(mc).toMatch(/rows\.filter\(\(e\) => e\.kind === "agent"\)\.length/);
    expect(mc).toMatch(/rows\.filter\(\(e\) => e\.kind === "closer"\)\.length/);
  });

  it("default is ALL, lives in the panel header action slot, no reload", () => {
    expect(mc).toMatch(/useState<FloorFilter>\("ALL"\)/);
    expect(mc).toMatch(/action=\{[\s\S]{0,400}FLOOR_FILTERS\.map/);
    expect(mc).toMatch(/onClick=\{\(\) => setFloorFilter\(f\.id\)\}/);
    // selected state is visually obvious
    expect(mc).toMatch(/variant=\{floorFilter === f\.id \? "default" : "outline"\}/);
    expect(mc).toMatch(/aria-pressed=\{floorFilter === f\.id\}/);
  });

  it("the filter predicate itself is a plain equality on the server code", () => {
    const staff = [
      { code: "A1", kind: "agent", process: "US" },
      { code: "A2", kind: "agent", process: "IN" },
      { code: "C1", kind: "closer", process: "US" },
      { code: "C2", kind: "closer", process: "UK" },
      { code: "C3", kind: "closer", process: "AU" },
    ];
    const apply = (f: string) => (f === "ALL" ? staff : staff.filter((e) => e.process === f));
    expect(apply("ALL")).toHaveLength(5);
    expect(apply("US").map((s) => s.code)).toEqual(["A1", "C1"]);
    expect(apply("IN").map((s) => s.code)).toEqual(["A2"]);
    expect(apply("UK").map((s) => s.code)).toEqual(["C2"]);
    expect(apply("AU").map((s) => s.code)).toEqual(["C3"]);
    // both roles filtered together
    expect(apply("US").some((s) => s.kind === "agent")).toBe(true);
    expect(apply("US").some((s) => s.kind === "closer")).toBe(true);
  });
});
