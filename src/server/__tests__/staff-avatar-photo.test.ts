/**
 * LIVE UAT — "agent photo not rendering" fix.
 *
 * The staff directory (agents/closers list + detail), the employees / people /
 * mission-control rosters, the team roster, the leaderboard table and the
 * performance ranking all showed the initial-letter placeholder even when a
 * real profile photo was stored, because they rendered <PeerAvatar> /
 * <EmployeeIdentity> / bare <PhotoDisplay> — none of which read the
 * server-backed Phase-19 photo. They now render the shared <StaffAvatar>,
 * which resolves the AUTHORITATIVE photo from `staff_photos` via the existing
 * `profilePhotoFn` (no new storage system, no public URL, same auth).
 *
 * Structural guard so a future refactor cannot silently regress it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("StaffAvatar — server-backed identity chip", () => {
  const avatar = read("components/officeverse/staff-avatar.tsx");

  it("reuses the ONE Phase-19 photo API — no parallel photo system", () => {
    expect(avatar).toMatch(/useProfilePhoto\(/);
    expect(avatar).toMatch(/photoDataUrl\(/);
    expect(avatar).not.toMatch(/agentPhotoFn|closerPhotoFn|staffPhotoFn/);
    // never a raw <img src> to a public URL — bytes come back base64
    expect(avatar).not.toMatch(/https?:\/\//);
  });

  it("only fetches when the DTO says a photo exists AND the viewer may see it", () => {
    // gated on hasPhoto (from photo_available) …
    expect(avatar).toMatch(/hasPhoto !== false/);
    // … and on the viewer's own role — Admin/HR, or their own row. This MIRRORS
    // the server rule in profilePhotoBytes; it never widens it.
    expect(avatar).toMatch(/role === "admin"/);
    expect(avatar).toMatch(/role === "hr"/);
    expect(avatar).toMatch(/String\(userId\) === user\.id/);
    expect(avatar).toMatch(
      /enabled\s*=\s*Boolean\(userId\) && hasPhoto !== false && viewerMayFetch/,
    );
  });

  it("falls back local-photo → initials when there is no server photo", () => {
    expect(avatar).toMatch(/useEmployeePhoto\(name\)/);
    expect(avatar).toMatch(/serverSrc \?\? localSrc \?\? null/);
  });
});

describe("every staff photo surface now uses StaffAvatar", () => {
  const surfaces: Array<[string, RegExp[]]> = [
    // agent / closer directory list rows (the edit dialog moved to
    // staff-edit-dialog.tsx — guarded separately below)
    [
      "routes/_shell.agents.index.tsx",
      [/userId=\{a\.user_id\}/, /hasPhoto=\{a\.photo_available\}/],
    ],
    [
      "routes/_shell.closers.index.tsx",
      [/userId=\{c\.user_id\}/, /hasPhoto=\{c\.photo_available\}/],
    ],
    [
      "components/officeverse/staff-edit-dialog.tsx",
      [/userId=\{staff\.user_id\}/, /hasPhoto=\{staff\.photo_available\}/],
    ],
    ["routes/_shell.employees.tsx", [/userId=\{e\.user_id\}/, /hasPhoto=\{e\.photo_available\}/]],
    ["routes/_shell.people.tsx", [/userId=\{e\.user_id\}/]],
    ["routes/_shell.mission-control.tsx", [/userId=\{e\.user_id\}/]],
    ["routes/_shell.team.tsx", [/userId=\{m\.user_id\}/, /userId=\{e\.user_id\}/]],
    ["routes/_shell.performance.tsx", [/userId=\{r\.userId\}/, /hasPhoto=\{r\.photoAvailable\}/]],
    ["routes/_shell.leaderboard.tsx", [/userId=\{r\.userId\}/, /hasPhoto=\{r\.photoAvailable\}/]],
  ];

  for (const [file, patterns] of surfaces) {
    it(`${file} renders StaffAvatar wired to the user id`, () => {
      const src = read(file);
      expect(src).toMatch(/StaffAvatar/);
      expect(src).not.toMatch(/<PeerAvatar\b/);
      expect(src).not.toMatch(/<EmployeeIdentity\b/);
      for (const p of patterns) expect(src).toMatch(p);
    });
  }

  it('the admin agent-list thumbnail is ~48–56px (StaffAvatar size="medium" → h-14/56px)', () => {
    const route = read("routes/_shell.agents.index.tsx");
    // the list-row avatar block, wired to the row user id and sized "medium"
    expect(route).toMatch(/userId=\{a\.user_id\}[\s\S]{0,400}size="medium"/);
    // and PhotoDisplay maps "md" → h-14 w-14 (56px)
    const pd = read("components/officeverse/photo/PhotoDisplay.tsx");
    expect(pd).toMatch(/md:\s*"h-14 w-14/);
  });
});

describe("server photo authorization is untouched", () => {
  it("profilePhotoBytes still refuses a non-manager reading another user's photo", () => {
    const svc = read("server/hr/photo-service.ts");
    const fn = svc.slice(svc.indexOf("export async function profilePhotoBytes"));
    expect(fn).toMatch(/isPhotoManager\(actor\.role\)/);
    expect(fn).toMatch(/Not allowed to view that photo/);
  });
});
