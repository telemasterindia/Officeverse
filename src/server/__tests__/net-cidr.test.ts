import { describe, expect, it } from "vitest";
import {
  ipInCidr,
  isValidCidr,
  matchOfficeNetwork,
  normalizeIp,
  parseCidr,
  type NetworkLike,
} from "../net/cidr";

describe("CIDR parsing + matching (server-observed IP only)", () => {
  it("parses IPv4 hosts and CIDRs", () => {
    expect(parseCidr("203.0.113.7")).toMatchObject({ family: 4, prefix: 32 });
    expect(parseCidr("198.51.100.0/24")).toMatchObject({ family: 4, prefix: 24 });
    expect(parseCidr("10.0.0.0/8")).toMatchObject({ family: 4, prefix: 8 });
    expect(parseCidr("not-an-ip")).toBeNull();
    expect(parseCidr("203.0.113.7/33")).toBeNull();
    expect(parseCidr("999.1.1.1")).toBeNull();
  });

  it("isValidCidr", () => {
    expect(isValidCidr("203.0.113.7/32")).toBe(true);
    expect(isValidCidr("2001:db8::1")).toBe(true);
    expect(isValidCidr("garbage")).toBe(false);
  });

  it("normalizes IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeIp("203.0.113.7%eth0")).toBe("203.0.113.7");
    expect(normalizeIp("")).toBe("");
  });

  it("ipInCidr — exact host", () => {
    expect(ipInCidr("203.0.113.7", "203.0.113.7/32")).toBe(true);
    expect(ipInCidr("203.0.113.8", "203.0.113.7/32")).toBe(false);
    expect(ipInCidr("::ffff:203.0.113.7", "203.0.113.7/32")).toBe(true);
  });

  it("ipInCidr — subnet", () => {
    expect(ipInCidr("198.51.100.42", "198.51.100.0/24")).toBe(true);
    expect(ipInCidr("198.51.101.42", "198.51.100.0/24")).toBe(false);
    expect(ipInCidr("10.9.8.7", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.9.8.7", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("anything", "0.0.0.0/0")).toBe(false); // invalid ip → false, not a wildcard hole
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  it("a malformed CIDR never matches", () => {
    expect(ipInCidr("1.2.3.4", "garbage")).toBe(false);
  });
});

describe("matchOfficeNetwork", () => {
  const nets: NetworkLike[] = [
    { id: 1, name: "US Office", cidr: "203.0.113.0/24", process: "US", enabled: true },
    { id: 2, name: "India Office", cidr: "198.51.100.7/32", process: "IN", enabled: true },
    { id: 3, name: "VPN (disabled)", cidr: "10.0.0.0/8", process: null, enabled: false },
    { id: 4, name: "HQ (all)", cidr: "192.0.2.0/24", process: null, enabled: true },
  ];

  it("matches an enabled network containing the IP", () => {
    expect(matchOfficeNetwork("203.0.113.55", nets, "US")?.id).toBe(1);
    expect(matchOfficeNetwork("198.51.100.7", nets, "IN")?.id).toBe(2);
  });

  it("a null-process ('all') network matches any process", () => {
    expect(matchOfficeNetwork("192.0.2.9", nets, "US")?.id).toBe(4);
    expect(matchOfficeNetwork("192.0.2.9", nets, "IN")?.id).toBe(4);
  });

  it("a process-scoped network does NOT match a different process", () => {
    expect(matchOfficeNetwork("203.0.113.55", nets, "IN")).toBeNull(); // US-only row
  });

  it("a disabled network never matches", () => {
    expect(matchOfficeNetwork("10.1.2.3", nets, "US")).toBeNull();
  });

  it("no match → null", () => {
    expect(matchOfficeNetwork("8.8.8.8", nets, "US")).toBeNull();
  });
});
