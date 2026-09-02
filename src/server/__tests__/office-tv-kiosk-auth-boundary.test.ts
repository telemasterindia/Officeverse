/**
 * Phase 6 — Office TV kiosk auth boundary.
 *
 * `/office-tv` is a standalone kiosk route: NO CRM user session is required to
 * open it in a browser, but the Office TV STATE API stays display-token
 * protected (`verifyDisplayToken`, `tv_read`).
 *
 * This regression pins BOTH halves:
 *   1. `SessionProvider`'s "no CRM session → redirect to /" guard must EXEMPT
 *      `/office-tv` (it is in PUBLIC_PATHS) while still redirecting real CRM
 *      routes. The guard predicate itself is unchanged — only the allow-list.
 *   2. `GET /api/office-tv/state` still fails closed without a valid token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleInternal } from "../internal-routes";

const sessionSrc = readFileSync(
  join(__dirname, "..", "..", "lib", "officeverse", "session.tsx"),
  "utf8",
);

/** Pull the literal string entries of `const PUBLIC_PATHS = [ ... ]`. */
function readPublicPaths(src: string): string[] {
  const m = src.match(/const\s+PUBLIC_PATHS\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error("PUBLIC_PATHS not found in session.tsx");
  return [...m[1]!.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!);
}

/** The redirect guard, mirrored from session.tsx exactly. */
function redirectsToLogin(opts: {
  ready: boolean;
  publicUser: unknown;
  pathname: string;
  publicPaths: string[];
}): boolean {
  return opts.ready && !opts.publicUser && !opts.publicPaths.includes(opts.pathname);
}

describe("SessionProvider — /office-tv is exempt from the CRM-login redirect", () => {
  const PUBLIC_PATHS = readPublicPaths(sessionSrc);

  it("PUBLIC_PATHS contains /office-tv (plus the existing / and /login)", () => {
    expect(PUBLIC_PATHS).toContain("/");
    expect(PUBLIC_PATHS).toContain("/login");
    expect(PUBLIC_PATHS).toContain("/office-tv");
  });

  it("PUBLIC_PATHS did NOT become a broad allow-list — CRM routes stay excluded", () => {
    for (const crm of [
      "/leads",
      "/followups",
      "/employees",
      "/assignments",
      "/scoring",
      "/mission-control",
      "/workspace",
      "/profile",
      "/settings",
      "/team",
      "/notifications",
      "/exports",
      "/closer-hub",
    ]) {
      expect(PUBLIC_PATHS).not.toContain(crm);
    }
    expect(PUBLIC_PATHS.length).toBe(3);
  });

  it("the guard still keys on a missing CRM session (`!publicUser`) — logic unchanged", () => {
    expect(sessionSrc).toMatch(
      /if\s*\(\s*ready\s*&&\s*!publicUser\s*&&\s*!PUBLIC_PATHS\.includes\(pathname\)\s*\)/,
    );
  });

  it("a fresh browser with NO CRM session is NOT redirected away from /office-tv", () => {
    expect(
      redirectsToLogin({
        ready: true,
        publicUser: null,
        pathname: "/office-tv",
        publicPaths: PUBLIC_PATHS,
      }),
    ).toBe(false);
  });

  it("real CRM routes with NO CRM session ARE still redirected to /", () => {
    for (const p of ["/leads", "/employees", "/scoring", "/workspace"]) {
      expect(
        redirectsToLogin({ ready: true, publicUser: null, pathname: p, publicPaths: PUBLIC_PATHS }),
      ).toBe(true);
    }
  });

  it("/ and /login are unaffected; a logged-in user is never redirected", () => {
    expect(
      redirectsToLogin({ ready: true, publicUser: null, pathname: "/", publicPaths: PUBLIC_PATHS }),
    ).toBe(false);
    expect(
      redirectsToLogin({
        ready: true,
        publicUser: null,
        pathname: "/login",
        publicPaths: PUBLIC_PATHS,
      }),
    ).toBe(false);
    expect(
      redirectsToLogin({
        ready: true,
        publicUser: { id: 1, role: "admin" },
        pathname: "/leads",
        publicPaths: PUBLIC_PATHS,
      }),
    ).toBe(false);
  });
});

describe("Office TV API stays display-token protected (unchanged by the fix)", () => {
  const req = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

  it("GET /api/office-tv/state with NO token → 401 no_token", async () => {
    const res = await handleInternal(req("/api/office-tv/state"));
    expect(res!.status).toBe(401);
    expect(((await res!.json()) as { error: string }).error).toBe("no_token");
  });

  it("GET /api/office-tv/state with an unknown token → fails closed, leaks no data", async () => {
    const res = await handleInternal(req("/api/office-tv/state?token=ovtv_" + "z".repeat(40)));
    expect([401, 503]).toContain(res!.status);
    expect((await res!.json()) as Record<string, unknown>).not.toHaveProperty("leaderboard");
  });

  it("the /office-tv PAGE itself is not an internal-route — it falls through to SSR", async () => {
    expect(await handleInternal(req("/office-tv"))).toBeNull();
    expect(await handleInternal(req("/office-tv?token=ovtv_abc"))).toBeNull();
  });

  it("internal-routes still guards the state endpoint with a token read + verify path", () => {
    const ir = readFileSync(join(__dirname, "..", "internal-routes.ts"), "utf8");
    expect(ir).toMatch(/"\/api\/office-tv\/state"/);
    expect(ir).toMatch(/x-display-token/);
    expect(ir).toMatch(/tvState\(token/);
  });
});
