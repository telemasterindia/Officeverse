/**
 * Remediation — the Client directory (/clients, /clients/new) must be served by
 * the authoritative server layer (server fn → auth → Zod → service → repo →
 * MySQL), NOT the old client-side localStorage `officeverse.clients` demo store.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const code = (rel: string) => stripComments(read(rel));

describe("CLIENTS — the localStorage demo store is gone", () => {
  it("src/lib/officeverse/clients.ts no longer exists", () => {
    expect(existsSync(join(root, "lib", "officeverse", "clients.ts"))).toBe(false);
  });

  it("use-crm.ts exposes no client hook / store any more", () => {
    const src = code("lib/officeverse/use-crm.ts");
    expect(src).not.toMatch(/useClients|loadClients|subscribeClients|officeverse\/clients/);
  });

  it("neither /clients route imports the demo store, use-crm, or touches localStorage", () => {
    for (const f of ["routes/_shell.clients.index.tsx", "routes/_shell.clients.new.tsx"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/@\/lib\/officeverse\/clients"/);
      expect(src, f).not.toMatch(/use-crm/);
      expect(src, f).not.toMatch(/\blocalStorage\b/);
      expect(src, f).not.toMatch(/\bcreateClient\(|\bupdateClient\(|\bloadClients\(/);
    }
  });
});

describe("CLIENTS — routes use the authoritative server hooks + Admin/HR gate", () => {
  const list = code("routes/_shell.clients.index.tsx");
  const create = code("routes/_shell.clients.new.tsx");

  it("the list route reads the server directory and gates to admin | hr", () => {
    expect(list).toMatch(/useServerClients\(/);
    expect(list).toMatch(/useUpdateServerClient\(/);
    expect(list).toMatch(/RoleGate allow=\{\["admin", "hr"\]\}/);
  });

  it("the create route calls the server mutation and gates to admin | hr", () => {
    expect(create).toMatch(/useCreateServerClient\(/);
    expect(create).toMatch(/createM\.mutateAsync\(/);
    expect(create).toMatch(/RoleGate allow=\{\["admin", "hr"\]\}/);
    expect(create).not.toMatch(/monthly_salary|salary/i);
  });
});

describe("CLIENTS — client-fns authenticate + validate", () => {
  const fns = read("lib/officeverse/client-fns.ts");

  it("every fn is a createServerFn with an inputValidator and requireUser()", () => {
    for (const name of ["createClientFn", "listClientsFn", "updateClientFn"]) {
      expect(fns).toMatch(new RegExp(`${name} = createServerFn\\(`));
    }
    expect(fns).toMatch(/createClientFn = createServerFn\(\{ method: "POST" \}\)/);
    expect(fns).toMatch(/listClientsFn = createServerFn\(\{ method: "GET" \}\)/);
    expect((fns.match(/\.inputValidator\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((fns.match(/requireUser\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // the client never picks the id / code / row status outside the enum
    expect(fns).toMatch(/z\.enum\(\["active", "prospect", "inactive", "closed"\]\)/);
  });
});

describe("CLIENTS — the service is Admin/HR-only and audited; the repo writes MySQL", () => {
  const svc = read("server/clients/service.ts");
  const authz = read("server/authz/clients.ts");
  const repo = code("server/db/repos/clients.ts");

  it("assertCanManageClients rejects everyone but admin / hr", () => {
    expect(authz).toMatch(/role === "admin" \|\| role === "hr"/);
    expect(authz).toMatch(/throw new HttpError\(403/);
  });

  it("create / list / update all assert Admin/HR before doing anything", () => {
    for (const fn of ["createClient", "listClients", "updateClient"]) {
      const body = svc.slice(svc.indexOf(`export async function ${fn}`));
      const head = body.slice(0, body.indexOf("\n}", 1) + 2);
      expect(head, fn).toMatch(/assertCanManageClients\(actor\.role\)/);
    }
  });

  it("createClient inserts a real row + writes an audit log", () => {
    const body = svc.slice(svc.indexOf("export async function createClient"));
    expect(body).toMatch(/repo\.nextClientCode\(/);
    expect(body).toMatch(/repo\.insertClient\(/);
    expect(body).toMatch(/recordAudit\(/);
    expect(body).toMatch(/action: "client\.created"/);
  });

  it("the DTO exposes only business fields — no internal id, password or salary", () => {
    const dto = svc.slice(svc.indexOf("export interface ClientDTO"), svc.indexOf("function toDTO"));
    expect(dto).not.toMatch(/\bid\b|password|salary|created_at|updated_at/i);
  });

  it("the repo talks to the clients table via drizzle, never localStorage", () => {
    expect(repo).toMatch(/\.insert\(clients\)/);
    expect(repo).toMatch(/\.update\(clients\)/);
    expect(repo).toMatch(/from\(clients\)/);
    expect(repo).not.toMatch(/localStorage/);
    // server-generated code from the current max, mirroring the staff codes
    expect(repo).toMatch(/max\(cast\(substring\(\$\{clients\.clientCode\}/);
  });
});
