import { describe, expect, it } from "vitest";
import { handleInternal } from "../internal-routes";

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe("GET /api/office-tv/state — display-token authenticated, read-only", () => {
  it("rejects a missing token with 401", async () => {
    const res = await handleInternal(req("/api/office-tv/state"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe("no_token");
  });

  it("rejects a non-GET method with 405", async () => {
    const res = await handleInternal(req("/api/office-tv/state", { method: "POST" }));
    expect(res!.status).toBe(405);
  });

  it("with a well-formed but unknown token, fails closed (401 or 503 — never leaks data)", async () => {
    const res = await handleInternal(req("/api/office-tv/state?token=ovtv_" + "a".repeat(40)));
    expect([401, 503]).toContain(res!.status);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("leaderboard");
  });

  it("the asset endpoint also requires a token and is GET-only", async () => {
    expect(
      (await handleInternal(req("/api/office-tv/asset?id=1", { method: "POST" })))!.status,
    ).toBe(405);
    const res = await handleInternal(req("/api/office-tv/asset?id=1"));
    expect([401, 404, 503]).toContain(res!.status);
  });

  it("unrelated paths still fall through to SSR (null)", async () => {
    expect(await handleInternal(req("/office-tv"))).toBeNull();
  });
});
