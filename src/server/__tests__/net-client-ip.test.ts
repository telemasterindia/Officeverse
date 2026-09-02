/**
 * Audit C-1 — trusted client-IP resolution.
 *
 * A remote client MUST NOT be able to spoof `X-Forwarded-For` / `X-Real-IP`
 * and be seen as an office IP. `pickClientIp` only trusts forwarding headers
 * when the socket peer is a configured trusted proxy.
 */
import { describe, expect, it } from "vitest";
import { pickClientIp } from "../net/client-ip";
import { matchOfficeNetwork } from "../net/cidr";
import { evaluateAccess } from "../net/access";

const OFFICE = "203.0.113.10"; // pretend office CIDR is 203.0.113.0/24
const NET = [{ id: 1, name: "US Office", cidr: "203.0.113.0/24", process: "US", enabled: true }];

describe("pickClientIp — untrusted peer ignores all forwarding headers", () => {
  it("1. direct remote request with a spoofed X-Forwarded-For → the real peer wins", () => {
    const ip = pickClientIp({
      peer: "8.8.8.8",
      forwardedFor: OFFICE, // attacker claims to be in the office
      trustedProxyCidrs: [], // nothing trusted
    });
    expect(ip).toBe("8.8.8.8");
    // and therefore no office match
    expect(matchOfficeNetwork(ip, NET, "US")).toBeNull();
  });

  it("2. multiple X-Forwarded-For values are all ignored for an untrusted peer", () => {
    expect(
      pickClientIp({
        peer: "8.8.8.8",
        forwardedFor: `${OFFICE}, 10.0.0.5, 8.8.8.8`,
        trustedProxyCidrs: [],
      }),
    ).toBe("8.8.8.8");
  });

  it("3. spoofed X-Real-IP is ignored for an untrusted peer", () => {
    expect(pickClientIp({ peer: "8.8.8.8", realIp: OFFICE, trustedProxyCidrs: [] })).toBe(
      "8.8.8.8",
    );
  });

  it("even with a trusted-proxy list configured, a NON-proxy peer's headers are ignored", () => {
    expect(
      pickClientIp({
        peer: "8.8.8.8",
        forwardedFor: OFFICE,
        realIp: OFFICE,
        trustedProxyCidrs: ["127.0.0.1/32", "::1/128"],
      }),
    ).toBe("8.8.8.8");
  });
});

describe("pickClientIp — localhost / LOCAL UAT preserved", () => {
  it("4. legitimate localhost request (IPv4) → 127.0.0.1", () => {
    expect(pickClientIp({ peer: "127.0.0.1", trustedProxyCidrs: [] })).toBe("127.0.0.1");
  });
  it("5. IPv6 localhost → ::1", () => {
    expect(pickClientIp({ peer: "::1", trustedProxyCidrs: [] })).toBe("::1");
    expect(pickClientIp({ peer: "::ffff:127.0.0.1", trustedProxyCidrs: [] })).toBe("127.0.0.1");
  });
});

describe("pickClientIp — trusted proxy chain (production model)", () => {
  const TRUSTED = ["127.0.0.1/32", "::1/128"];

  it("6. loopback proxy hop trusted → real client is the last non-proxy entry", () => {
    // Passenger/Apache: client sent XFF, proxy appended its view of the client.
    // header = "<client-claim>, <real-client>"  peer = 127.0.0.1
    const ip = pickClientIp({
      peer: "127.0.0.1",
      forwardedFor: `${OFFICE}, 198.51.100.7`, // attacker-claim, then the real edge-seen client
      trustedProxyCidrs: TRUSTED,
    });
    expect(ip).toBe("198.51.100.7");
  });

  it("trusted proxy + client genuinely in the office → office IP is recovered", () => {
    const ip = pickClientIp({
      peer: "127.0.0.1",
      forwardedFor: OFFICE, // single proxy, real client is the office
      trustedProxyCidrs: TRUSTED,
    });
    expect(ip).toBe(OFFICE);
    expect(matchOfficeNetwork(ip, NET, "US")?.id).toBe(1);
  });

  it("trusted proxy but attacker prepends TWO office IPs → the rightmost real client still wins", () => {
    const ip = pickClientIp({
      peer: "127.0.0.1",
      forwardedFor: `${OFFICE}, 203.0.113.99, 8.8.8.8`,
      trustedProxyCidrs: TRUSTED,
    });
    expect(ip).toBe("8.8.8.8"); // the genuine edge-observed client
  });

  it("multiple trusted proxy hops are skipped from the right", () => {
    const ip = pickClientIp({
      peer: "::1",
      forwardedFor: `${OFFICE}, 8.8.4.4, ::1`, // last hop is another trusted proxy
      trustedProxyCidrs: TRUSTED,
    });
    expect(ip).toBe("8.8.4.4");
  });
});

describe("end-to-end: a spoofed header cannot grant CRM access / attendance to a remote Agent", () => {
  it("remote agent + spoofed XFF (no trusted proxy) → agent_remote_denied, not attendance-eligible", () => {
    const ip = pickClientIp({ peer: "8.8.8.8", forwardedFor: OFFICE, trustedProxyCidrs: [] });
    const match = matchOfficeNetwork(ip, NET, "US");
    const decision = evaluateAccess({
      role: "agent",
      officeMatch: match != null,
      policyConfigured: true,
    });
    expect(decision.crmAllowed).toBe(false);
    expect(decision.attendanceEligible).toBe(false);
    expect(decision.code).toBe("agent_remote_denied");
  });
});
