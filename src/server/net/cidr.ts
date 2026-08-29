/**
 * Officeverse — CIDR / IP matching (Phase 23). PURE. No DB, no network I/O.
 *
 * Matches the SERVER-OBSERVED public request IP against configured office
 * CIDRs. IPv4 is matched bitwise; IPv6 is matched by exact normalized string
 * (a `/128`), which is sufficient for the "single office endpoint" case and
 * never produces a false positive. A client-supplied IP is never trusted — the
 * caller passes the value the trusted-proxy-aware server resolver returned.
 */

export interface ParsedCidr {
  family: 4 | 6;
  /** for v4: the network address as a uint32; for v6: the normalized address */
  base: number | string;
  prefix: number;
  raw: string;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** Strip an IPv4-mapped IPv6 prefix ("::ffff:203.0.113.7" → "203.0.113.7"). */
export function normalizeIp(ip: string | null | undefined): string {
  const s = (ip ?? "").trim().toLowerCase();
  if (!s) return "";
  const m = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return m[1]!;
  // drop a zone id and surrounding brackets
  return s.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
}

export function parseCidr(raw: string): ParsedCidr | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const slash = s.indexOf("/");
  const addr = slash === -1 ? s : s.slice(0, slash);
  const prefixStr = slash === -1 ? "" : s.slice(slash + 1);

  const v4 = ipv4ToInt(addr);
  if (v4 != null) {
    const prefix = prefixStr === "" ? 32 : Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return { family: 4, base: v4, prefix, raw: s };
  }

  const norm = normalizeIp(addr);
  if (norm.includes(":")) {
    const prefix = prefixStr === "" ? 128 : Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    return { family: 6, base: norm, prefix, raw: s };
  }
  return null;
}

/** True when `cidr` is a syntactically valid CIDR / bare IP. */
export function isValidCidr(raw: string): boolean {
  return parseCidr(raw) != null;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  const target = normalizeIp(ip);
  if (!target) return false;

  if (parsed.family === 4) {
    const t = ipv4ToInt(target);
    if (t == null) return false;
    if (parsed.prefix === 0) return true;
    const mask = parsed.prefix === 32 ? 0xffffffff : (0xffffffff << (32 - parsed.prefix)) >>> 0;
    return (t & mask) >>> 0 === (Number(parsed.base) & mask) >>> 0;
  }

  // IPv6: exact match only (documented limitation)
  return target === parsed.base && (parsed.prefix === 128 || parsed.prefix === 0);
}

export interface NetworkLike {
  id: number;
  name: string;
  cidr: string;
  process: string | null;
  enabled: boolean;
}

/**
 * The first ENABLED office network whose CIDR contains `ip`. When `process` is
 * given, a process-scoped row only matches that process; a null-process row
 * ("all processes") always matches. Deterministic: process-scoped rows are
 * preferred, then lowest id.
 */
export function matchOfficeNetwork(
  ip: string,
  networks: NetworkLike[],
  process?: string | null,
): NetworkLike | null {
  const candidates = networks
    .filter((n) => n.enabled)
    .filter((n) => n.process == null || process == null || n.process === process)
    .filter((n) => ipInCidr(ip, n.cidr))
    .sort((a, b) => {
      const ap = a.process == null ? 1 : 0;
      const bp = b.process == null ? 1 : 0;
      return ap - bp || a.id - b.id;
    });
  return candidates[0] ?? null;
}
