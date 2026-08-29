import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const photoFiles = [
  "lib/officeverse/photo-effects.ts",
  "lib/officeverse/photo-fns.ts",
  "lib/officeverse/use-photo.ts",
  "server/hr/photo.ts",
  "server/hr/photo-storage.ts",
  "server/hr/photo-service.ts",
  "server/authz/photo.ts",
  "components/officeverse/photo/PhotoDisplay.tsx",
  "components/officeverse/photo/PhotoEffect.tsx",
  "components/officeverse/photo/CelebrationOverlay.tsx",
].map((f) => ({ f, src: read(f) }));

describe("Phase 19 — photo + effects: placement & trust boundary", () => {
  it("no photo module under src/server/api", () => {
    expect(readdirSync(join(root, "server", "api")).some((x) => /photo|avatar/i.test(x))).toBe(
      false,
    );
  });

  it("NO AI image generation anywhere in the photo / effects code", () => {
    for (const { src } of photoFiles) {
      expect(src).not.toMatch(/openai|dall[- ]?e|midjourney|stable[- ]?diffusion|replicate/i);
      expect(src).not.toMatch(/generateImage|imageGeneration|text-to-image|face(Gen|Swap)/i);
    }
  });

  it("the effects engine has ZERO payroll / HR / gamification coupling", () => {
    const fx = strip(read("lib/officeverse/photo-effects.ts"));
    expect(fx).not.toMatch(/payroll|salary|incentive|commission|\bbonus\b|attendance/i);
    expect(fx).not.toMatch(/\bpoints\b|leaderboard|ranking/i);
    // it imports nothing at all (pure config)
    expect(read("lib/officeverse/photo-effects.ts")).not.toMatch(/^import\s/m);
  });

  it("the client fns only reach the server through the photo-service", () => {
    const fns = read("lib/officeverse/photo-fns.ts");
    expect(fns).toMatch(/from "@\/server\/hr\/photo-service"/);
    expect(fns).not.toMatch(/photo-storage|photo\.ts|\.\.\/server\/hr\/photo["']/);
    // every exported fn authenticates
    for (const h of fns.split(/export const \w+Fn/).slice(1)) {
      expect(h).toMatch(/requireUser\(\)/);
    }
  });

  it("the server never trusts a client id for a non-manager (resolvePhotoTarget)", () => {
    const svc = read("server/hr/photo-service.ts");
    expect(svc).toMatch(/resolvePhotoTarget\(actor\.role, actor\.id/);
    expect(svc).toMatch(/assertCanManagePhotoFor\(/);
    // client cannot submit dimensions / mime as truth — the service re-validates bytes
    expect(read("lib/officeverse/photo-fns.ts")).not.toMatch(/width|height|\bmime\s*:/);
    expect(svc).toMatch(/validatePhotoUpload\(input\.bytes/);
  });

  it("photos are stored PRIVATELY — no public URL is written on the row", () => {
    const svc = read("server/hr/photo-service.ts");
    expect(svc).toMatch(/url: null/);
    expect(svc).not.toMatch(/photoPublicBase|publicUrl|signedUrl/);
  });

  it("effects never modify the image src (decorate `children` only)", () => {
    const fx = read("components/officeverse/photo/PhotoEffect.tsx");
    expect(fx).not.toMatch(/<img/); // PhotoEffect renders no image itself
    expect(fx).toMatch(/\{children\}/);
    const disp = read("components/officeverse/photo/PhotoDisplay.tsx");
    // the img src is passed straight through, never rewritten
    expect(disp).toMatch(/src=\{src \?\? undefined\}/);
  });

  it("celebration overlay respects reduced motion and plays no sound in Phase 19", () => {
    const raw = read("components/officeverse/photo/CelebrationOverlay.tsx");
    const co = strip(raw);
    expect(raw).toMatch(/useReducedMotion/);
    expect(raw).toMatch(/never played/i);
    // no audio is ever constructed or played in the code
    expect(co).not.toMatch(/new Audio\(|\.play\(\)|HTMLAudioElement/);
  });
});
