# `src/server/api/` — intentionally empty

Client-callable server functions do **not** live here. Everything under
`src/server/**` is import-protected from the client bundle by
`@lovable.dev/vite-tanstack-config`, so a `createServerFn` file placed here can
never be imported by a route.

The convention (see `auth-fns.ts`, `photo-fns.ts`, `lead-fns.ts`,
`followup-fns.ts`, `gamification-fns.ts`, …) is:

- the `createServerFn` wrapper lives in `src/lib/officeverse/*-fns.ts`
- its `.handler()` body imports the service from `@/server/<domain>/service`
- the TanStack Start compiler strips the handler body + `@/server/*` imports
  from the client build; only the RPC stub ships

Placement tests assert that no domain module reappears under this directory.
This file only keeps the directory present after a fresh checkout.
