import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redaction (spec §23, §57)", () => {
  it("never leaks tokens, secrets, passwords or full phones", () => {
    const out = JSON.stringify(
      redact({
        headers: { authorization: "Bearer EAAJsecret", "x-hub-signature-256": "sha256=abc" },
        accessToken: "EAAJsecret",
        META_APP_SECRET: "s3cr3t",
        password: "hunter2",
        to: "+5511999991234",
        nested: { wa_id: "5511999991234", note: "call me at +5511999991234" },
        body: "conteúdo sensível",
      }),
    );
    expect(out).not.toContain("EAAJsecret");
    expect(out).not.toContain("s3cr3t");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("5511999991234");
    expect(out).not.toContain("conteúdo sensível");
    expect(out).toContain("+55*******1234");
  });

  it("keeps non-phone values of phone-like keys", () => {
    expect(redact({ from: "READY_TO_SEND", to: "SENT" })).toEqual({ from: "READY_TO_SEND", to: "SENT" });
  });
});
