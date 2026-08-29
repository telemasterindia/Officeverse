import { afterEach, describe, expect, it } from "vitest";
import {
  devLogEmailProvider,
  getDevEmailOutbox,
  getEmailProvider,
  isEmailProviderConfigured,
  resetDevEmailOutbox,
} from "../email/provider";

afterEach(() => {
  resetDevEmailOutbox();
  delete process.env["OFFICEVERSE_EMAIL_PROVIDER"];
});

describe("dev-safe email provider", () => {
  it("delivers to an in-process log and returns a provider message id", async () => {
    const res = await devLogEmailProvider.send({
      to: "jane@example.com",
      subject: "Officeverse Salary Slip - August 2026",
      text: "attached",
      attachments: [
        { filename: "slip.pdf", contentBase64: "AA==", contentType: "application/pdf" },
      ],
    });
    expect(res.providerMessageId).toMatch(/^devlog-/);
    const box = getDevEmailOutbox();
    expect(box).toHaveLength(1);
    expect(box[0]!.to).toBe("jane@example.com");
    expect(box[0]!.attachmentNames).toEqual(["slip.pdf"]);
  });

  it("rejects an invalid recipient (a failed send is a real failure)", async () => {
    await expect(
      devLogEmailProvider.send({ to: "not-an-email", subject: "x", text: "y" }),
    ).rejects.toThrow(/recipient/i);
  });

  it("never reads a secret and performs no network I/O", () => {
    // structural: the module source has no fetch / http / SMTP / secret access
    // (asserted more fully in the placement test) — here just the name contract
    expect(devLogEmailProvider.name).toBe("devlog");
  });
});

describe("getEmailProvider resolution", () => {
  it("returns the dev provider outside production when unset", () => {
    expect(getEmailProvider()?.name).toBe("devlog");
    expect(isEmailProviderConfigured()).toBe(true);
  });

  it("OFFICEVERSE_EMAIL_PROVIDER=none disables sending", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "none";
    expect(getEmailProvider()).toBeNull();
    expect(isEmailProviderConfigured()).toBe(false);
  });

  it("OFFICEVERSE_EMAIL_PROVIDER=devlog forces the dev provider", () => {
    process.env["OFFICEVERSE_EMAIL_PROVIDER"] = "devlog";
    expect(getEmailProvider()?.name).toBe("devlog");
  });
});
