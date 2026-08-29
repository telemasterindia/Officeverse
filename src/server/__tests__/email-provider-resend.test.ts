import { afterEach, describe, expect, it, vi } from "vitest";
import { describeEmailProvider, getEmailProvider, makeResendProvider } from "../email/provider";

const ENVK = [
  "OFFICEVERSE_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "OFFICEVERSE_EMAIL_FROM",
  "EMAIL_FROM",
];
afterEach(() => {
  for (const k of ENVK) delete process.env[k];
  vi.restoreAllMocks();
});

const SECRET = "re_test_SECRETKEY_do_not_log";

type Init = { method: string; headers: Record<string, string>; body: string };

async function captureError(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw");
}

function okFetch(json: unknown) {
  return vi.fn((_url: string, _init: Init) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) }),
  );
}

describe("makeResendProvider — transactional send behind the EmailProvider interface", () => {
  it("posts to the Resend API with bearer auth and returns the provider message id", async () => {
    const fetchImpl = okFetch({ id: "resend-abc-123" });
    const p = makeResendProvider({ apiKey: SECRET, defaultFrom: "hr@officeverse.app", fetchImpl });
    const res = await p.send({
      to: "jane@example.com",
      subject: "Officeverse Salary Slip - August 2026",
      text: "attached",
      html: "<p>attached</p>",
      attachments: [
        { filename: "slip.pdf", contentBase64: "QUJD", contentType: "application/pdf" },
      ],
    });
    expect(p.name).toBe("resend");
    expect(res.providerMessageId).toBe("resend-abc-123");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["jane@example.com"]);
    expect(body.from).toBe("hr@officeverse.app");
    expect(body.subject).toBe("Officeverse Salary Slip - August 2026");
    expect(body.attachments[0]).toEqual({
      filename: "slip.pdf",
      content: "QUJD",
      content_type: "application/pdf",
    });
  });

  it("uses msg.from when provided, else the configured default", async () => {
    const fetchImpl = okFetch({ id: "x" });
    const p = makeResendProvider({ apiKey: SECRET, defaultFrom: "def@officeverse.app", fetchImpl });
    await p.send({ to: "a@b.com", from: "override@officeverse.app", subject: "s", text: "t" });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).from).toBe("override@officeverse.app");
  });

  it("rejects an invalid recipient before any network call", async () => {
    const fetchImpl = okFetch({ id: "x" });
    const p = makeResendProvider({ apiKey: SECRET, defaultFrom: "d@e.com", fetchImpl });
    await expect(p.send({ to: "not-an-email", subject: "s", text: "t" })).rejects.toThrow(
      /recipient/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a controlled error on a non-2xx response — no key or body leaked", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) =>
      Promise.resolve({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: "domain not verified", secret_echo: SECRET }),
      }),
    );
    const p = makeResendProvider({ apiKey: SECRET, defaultFrom: "d@e.com", fetchImpl });
    const err = await captureError(() => p.send({ to: "a@b.com", subject: "s", text: "t" }));
    expect(err.message).toMatch(/HTTP 422/);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain("domain not verified");
  });

  it("throws a generic error on a network failure (never surfaces the request)", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) => {
      throw new Error(`connect ECONNREFUSED with Bearer ${SECRET}`);
    });
    const p = makeResendProvider({ apiKey: SECRET, defaultFrom: "d@e.com", fetchImpl });
    const err = await captureError(() => p.send({ to: "a@b.com", subject: "s", text: "t" }));
    expect(err.message).toMatch(/network error/i);
    expect(err.message).not.toContain(SECRET);
  });

  it("the provider object exposes no secret", () => {
    const p = makeResendProvider({
      apiKey: SECRET,
      defaultFrom: "d@e.com",
      fetchImpl: okFetch({}),
    });
    expect(JSON.stringify(p)).not.toContain(SECRET);
    expect(Object.keys(p)).toEqual(["name", "send"]);
  });
});

describe("getEmailProvider / describeEmailProvider selection", () => {
  it("resend + key → real provider", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "resend";
    process.env["RESEND_API_KEY"] = SECRET;
    expect(getEmailProvider()?.name).toBe("resend");
    expect(describeEmailProvider()).toEqual({ configured: true, name: "resend", reason: null });
  });

  it("resend + missing key → null, and a secret-free reason (never fakes SENT)", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "resend";
    expect(getEmailProvider()).toBeNull();
    const d = describeEmailProvider();
    expect(d.configured).toBe(false);
    expect(d.name).toBe("resend");
    expect(d.reason).toMatch(/RESEND_API_KEY/);
    expect(d.reason).not.toContain(SECRET);
  });

  it("none → disabled", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "none";
    expect(getEmailProvider()).toBeNull();
    expect(describeEmailProvider().configured).toBe(false);
  });

  it("devlog behaviour is unchanged", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "devlog";
    expect(getEmailProvider()?.name).toBe("devlog");
    expect(describeEmailProvider()).toEqual({ configured: true, name: "devlog", reason: null });
  });
});
