/**
 * Officeverse — trusted client-IP resolution (Phase 24A hardening / audit C-1).
 *
 * A remote client can put ANYTHING in `X-Forwarded-For` / `X-Real-IP`. Those
 * headers are ONLY meaningful when the request actually arrived through a
 * reverse proxy we operate. This module makes that boundary explicit.
 *
 *   1. The socket peer address (`getRequestIP()` with NO options) is never
 *      client-controlled — it is where the TCP connection came from.
 *   2. Forwarded headers are consulted ONLY when that peer is inside a
 *      configured trusted-proxy CIDR (`TRUSTED_PROXY_IPS`). We then walk the
 *      `X-Forwarded-For` chain from the RIGHT, skipping further trusted-proxy
 *      hops, and take the first non-proxy address. A value injected on the
 *      left by the client is ignored.
 *   3. No trusted proxy configured, or the peer is not a trusted proxy → the
 *      peer address is used verbatim. There is NO fail-open: an unconfigured
 *      deployment can never turn a spoofed header into an office IP.
 *
 * DEPLOYMENT (GoDaddy / cPanel + Passenger/Apache):
 *   Passenger proxies to the Node app over loopback and APPENDS the client IP
 *   to any client-sent `X-Forwarded-For` (it does not strip it). Set:
 *
 *     TRUSTED_PROXY_IPS=127.0.0.1/32,::1/128
 *
 *   so the loopback proxy hop is trusted and the real client is taken as the
 *   last non-loopback entry of the chain. If a CDN (e.g. Cloudflare) sits in
 *   front, add its egress ranges too. Leaving `TRUSTED_PROXY_IPS` empty is
 *   safe but then every request is attributed to the proxy's own IP.
 */
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { env } from "../env";
import { ipInCidr, normalizeIp } from "./cidr";

/* -------------------------------- pure core -------------------------------- */

export interface PickClientIpInput {
  /** the socket peer address (server-observed, never client-controlled) */
  peer: string | null | undefined;
  /** raw `X-Forwarded-For` header value, if any */
  forwardedFor?: string | null | undefined;
  /** raw `X-Real-IP` header value, if any */
  realIp?: string | null | undefined;
  /** CIDRs of proxies whose forwarding headers we trust (may be empty) */
  trustedProxyCidrs: readonly string[];
}

function isTrusted(ip: string, cidrs: readonly string[]): boolean {
  if (!ip || cidrs.length === 0) return false;
  return cidrs.some((c) => ipInCidr(ip, c));
}

/**
 * Resolve the real client IP from server-observed facts. PURE — no request,
 * no env. Returns a normalised IP string, or "" when nothing usable is known.
 */
export function pickClientIp(input: PickClientIpInput): string {
  const peer = normalizeIp(input.peer ?? "");
  const cidrs = input.trustedProxyCidrs;

  // Peer is not a proxy we trust → forwarding headers are attacker-controlled
  // noise. Use the peer verbatim (this is the spoof-proof path).
  if (!isTrusted(peer, cidrs)) return peer;

  // Peer IS a trusted proxy → the forwarded chain is meaningful. Walk it from
  // the right, skipping further trusted-proxy hops, and take the first real
  // client address. A client-injected left-hand value never survives this.
  const chain = String(input.forwardedFor ?? "")
    .split(",")
    .map((s) => normalizeIp(s.trim()))
    .filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = chain[i]!;
    if (!isTrusted(hop, cidrs)) return hop;
  }

  // `X-Real-IP` is a single value set by exactly one proxy — only honoured
  // when the immediate peer is trusted and there was no usable XFF chain.
  const realIp = normalizeIp(input.realIp ?? "");
  if (realIp && !isTrusted(realIp, cidrs)) return realIp;

  // The entire chain was trusted proxies (unusual) → fall back to the peer.
  return peer;
}

/* ----------------------------- request binding ---------------------------- */

/** Parsed `TRUSTED_PROXY_IPS` (comma-separated CIDRs / bare IPs). Empty = none. */
export function trustedProxyCidrs(): string[] {
  return (env("TRUSTED_PROXY_IPS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The current request's real client IP, resolved safely. Never throws.
 * Returns `null` when no address can be determined.
 */
export function resolveClientIp(): string | null {
  let peer: string | null = null;
  try {
    // NO xForwardedFor option → h3 returns the socket peer, not a header.
    peer = getRequestIP() ?? null;
  } catch {
    peer = null;
  }
  let xff: string | null = null;
  let realIp: string | null = null;
  try {
    xff = getRequestHeader("x-forwarded-for") ?? null;
  } catch {
    /* ignore */
  }
  try {
    realIp = getRequestHeader("x-real-ip") ?? null;
  } catch {
    /* ignore */
  }
  const ip = pickClientIp({
    peer,
    forwardedFor: xff,
    realIp,
    trustedProxyCidrs: trustedProxyCidrs(),
  });
  return ip || null;
}
