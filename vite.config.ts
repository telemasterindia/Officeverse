// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * @tanstack/devtools-vite injects `data-tsd-source="file:line:col"` onto every
 * JSX element in dev (for "open in editor"). React Three Fiber's reconciler
 * reads the hyphens as a nested property path and throws
 * (`Cannot set "data-tsd-source"`). Strip that attribute from the R3F scene
 * files only — dev-only, no effect on production which never injects it.
 */
function stripTsdSourceForR3F(): Plugin {
  const RE_KEY = /["']data-tsd-source["']\s*:\s*["'][^"']*["']\s*,?/g;
  const RE_ATTR = /\sdata-tsd-source=("[^"]*"|\{[^{}]*\})/g;
  return {
    name: "strip-tsd-source-r3f",
    enforce: "post",
    transform(code, id) {
      if (!/office-character\/avatar-3d(-figure|-impl)?\.tsx/.test(id)) return null;
      if (!code.includes("data-tsd-source")) return null;
      return { code: code.replace(RE_KEY, "").replace(RE_ATTR, ""), map: null };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: { plugins: [stripTsdSourceForR3F()] },
});
