import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  MetaCloudApiProvider,
  MockWhatsAppProvider,
  ProviderError,
  buildHandoffLink,
  buildInboundPayload,
  classifyMetaError,
  deliverabilityCooldownMs,
  deliverabilitySignal,
  extractSessionRef,
  interactiveBody,
  templateFreeFormShape,
  templateToFreeForm,
  waMeLink,
  computeSignature,
  isOptOutKeyword,
  parseWebhook,
  templateBody,
  verifyChallenge,
  verifySignature,
} from "./index";

const SECRET = "app-secret-for-tests";

describe("webhook security (spec §25, §41 security tests)", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("accepts a valid X-Hub-Signature-256 over the raw body", () => {
    expect(verifySignature(body, computeSignature(body, SECRET), SECRET)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, malformed and missing headers", () => {
    const sig = computeSignature(body, SECRET);
    expect(verifySignature(body + " ", sig, SECRET)).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, sig, undefined)).toBe(false);
  });

  it("answers the verification challenge only with the right token", () => {
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }, "tok")).toEqual({ ok: true, challenge: "123" });
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "123" }, "tok")).toEqual({ ok: false });
    expect(verifyChallenge({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }, "tok")).toEqual({ ok: false });
  });
});

describe("webhook parsing (Meta payload formats)", () => {
  it("parses status webhooks with pricing, FEP conversation and errors", () => {
    const events = parseWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN1" },
                statuses: [
                  { id: "wamid.1", status: "sent", timestamp: "1750030073", recipient_id: "5511999", conversation: { id: "c1", expiration_timestamp: "1750116480", origin: { type: "referral_conversion" } } },
                  { id: "wamid.1", status: "delivered", timestamp: "1750030080", recipient_id: "5511999", pricing: { billable: false, pricing_model: "PMP", type: "free_entry_point", category: "referral_conversion" } },
                  { id: "wamid.2", status: "failed", timestamp: "1751142888", recipient_id: "5511", errors: [{ code: 131049, title: "x", error_data: { details: "y" } }] },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(3);
    const [sent, delivered, failed] = events as Array<Extract<(typeof events)[number], { type: "status" }>>;
    expect(sent!.conversation?.expiresAt?.toISOString()).toBe("2025-06-16T23:28:00.000Z");
    expect(delivered!.pricing).toEqual({ billable: false, pricingModel: "PMP", type: "free_entry_point", category: "referral_conversion" });
    expect(failed!.errors?.[0]?.code).toBe(131049);
  });

  it("parses inbound messages with Click-to-WhatsApp referral", () => {
    const payload = buildInboundPayload({ wabaId: "W", phoneNumberId: "P", from: "+5511999990000", text: "Quero saber mais", referral: { sourceType: "ad", sourceId: "AD1" } });
    const [ev] = parseWebhook(payload);
    expect(ev?.type).toBe("inbound");
    if (ev?.type === "inbound") {
      expect(ev.referral?.sourceType).toBe("ad");
      expect(ev.referral?.sourceId).toBe("AD1");
      expect(ev.from).toBe("5511999990000");
    }
  });

  it("parses tier, template category and preference updates; ignores garbage", () => {
    const events = parseWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "W",
          changes: [
            { field: "account_update", value: { event: "VOLUME_BASED_PRICING_TIER_UPDATE", volume_tier_info: { tier_update_time: 1743451903, pricing_category: "UTILITY", tier: "25000001:50000000", effective_month: "2025-11", region: "India" } } },
            { field: "template_category_update", value: { message_template_id: 1, message_template_name: "t", message_template_language: "pt_BR", previous_category: "UTILITY", new_category: "MARKETING" } },
            { field: "user_preferences", value: { user_preferences: [{ wa_id: "5511", category: "marketing_messages", value: "stop", timestamp: 1 }] } },
          ],
        },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(["account_update", "template_category", "user_preference"]);
    expect(parseWebhook({ hello: "world" })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });

  it("detects explicit opt-out keywords only", () => {
    expect(isOptOutKeyword("SAIR")).toBe(true);
    expect(isOptOutKeyword(" stop ")).toBe(true);
    expect(isOptOutKeyword("quero sair mais cedo amanhã")).toBe(false);
  });
});

describe("error classification (spec §27, §55, §56)", () => {
  it("retryable vs non-retryable", () => {
    expect(classifyMetaError(130429).retryable).toBe(true);
    expect(classifyMetaError(131056)).toMatchObject({ retryable: true, action: "PAIR_RATE_LIMIT" });
    expect(classifyMetaError(131047)).toMatchObject({ retryable: false, action: "NEEDS_TEMPLATE" });
    expect(classifyMetaError(131050)).toMatchObject({ retryable: false, action: "MARKETING_OPT_OUT" });
    expect(classifyMetaError(undefined, 503).retryable).toBe(true);
    expect(classifyMetaError(undefined, 400).retryable).toBe(false);
  });
});

describe("circuit breaker (spec §104)", () => {
  it("opens on high error rate and half-opens after the cool-down", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ windowMs: 10_000, minCalls: 4, failureRateThreshold: 0.5, openMs: 5_000, now: () => now });
    const fail = () => cb.exec(async () => Promise.reject(new Error("boom")));
    for (let i = 0; i < 4; i++) await expect(fail()).rejects.toThrow("boom");
    await expect(cb.exec(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
    now = 6_000;
    expect(cb.currentState).toBe("HALF_OPEN");
    await expect(cb.exec(async () => 42)).resolves.toBe(42);
    expect(cb.currentState).toBe("CLOSED");
  });
});

describe("MetaCloudApiProvider (no real network)", () => {
  it("uses the configured Graph API version and never hardcodes it", () => {
    expect(() => new MetaCloudApiProvider({ graphApiVersion: "26" })).toThrow();
  });

  it("sends a template with named parameters and maps errors", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      if (calls.length === 1) return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "5511" }], messages: [{ id: "wamid.X" }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "(#131056) pair rate limit", code: 131056, fbtrace_id: "trace" } }), { status: 400 });
    }) as unknown as typeof fetch;
    const p = new MetaCloudApiProvider({ graphApiVersion: "v26.0", fetchImpl });
    const req = { phoneNumberId: "PN1", to: "+5511999990000", template: { name: "order_status_update", language: "pt_BR", bodyParameters: [{ name: "orderId", value: "1" }] } };
    const r = await p.sendTemplate(req, { accessToken: "SECRET-TOKEN" });
    expect(r.providerMessageId).toBe("wamid.X");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v26.0/PN1/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer SECRET-TOKEN");
    expect(JSON.parse(calls[0]!.init.body as string).template.components[0].parameters[0]).toEqual({ type: "text", text: "1", parameter_name: "orderId" });
    const err = await p.sendTemplate(req, { accessToken: "SECRET-TOKEN" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(err.providerCode).toBe(131056);
    expect(err.requestId).toBe("trace");
    expect(JSON.stringify(err)).not.toContain("SECRET-TOKEN");
  });

  it("lists templates following cursor pagination", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [{ id: "1", name: "hello_world", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hi" }] }], paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/next" } },
      { data: [{ id: "2", name: "pedido", language: "pt_BR", status: "PENDING", category: "UTILITY", parameter_format: "POSITIONAL", components: [] }], paging: { cursors: { after: "C2" } } },
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new MetaCloudApiProvider({ graphApiVersion: "v26.0", fetchImpl });
    const list = await p.listTemplates("W1", { accessToken: "T" });
    expect(list.map((t) => t.name)).toEqual(["hello_world", "pedido"]);
    expect(list[1]!.parameterFormat).toBe("POSITIONAL");
    expect(urls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v26\.0\/W1\/message_templates\?fields=/);
    expect(urls[1]).toContain("after=C1");
    expect(urls).toHaveLength(2);
  });

  it("sets a WABA webhook override with the documented body", async () => {
    let sent: { url: string; body: unknown } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new MetaCloudApiProvider({ graphApiVersion: "v26.0", fetchImpl });
    expect(await p.setWebhookOverride("W1", "https://x.example/api/v1/webhooks/meta", "vt", { accessToken: "T" })).toEqual({ success: true });
    expect(sent).toEqual({ url: "https://graph.facebook.com/v26.0/W1/subscribed_apps", body: { override_callback_uri: "https://x.example/api/v1/webhooks/meta", verify_token: "vt" } });
  });

  it("template body omits parameter_name for positional templates", () => {
    const b = templateBody({ phoneNumberId: "p", to: "+1", template: { name: "t", language: "en_US", bodyParameters: [{ name: "x", value: "1" }], parameterFormat: "POSITIONAL" } });
    expect((b.template as { components: Array<{ parameters: unknown[] }> }).components[0]!.parameters[0]).toEqual({ type: "text", text: "1" });
  });
});

describe("MockWhatsAppProvider (spec §42)", () => {
  it("emits signed-compatible sent/delivered/read status webhooks with pricing", async () => {
    const emitted: Array<{ payload: Record<string, unknown>; delay: number }> = [];
    let r = 0;
    const seq = [0.5, 0.5, 0.1, 0.5, 0.1, 0.5];
    const mock = new MockWhatsAppProvider({ appSecret: SECRET, wabaId: "W", emit: (payload, delay) => void emitted.push({ payload, delay }), random: () => seq[r++ % seq.length]! });
    const res = await mock.sendTemplate({ phoneNumberId: "PN", to: "+5511", template: { name: "t", language: "pt_BR", bodyParameters: [] }, mockPricingHint: { billable: true, type: "regular", category: "utility" } });
    expect(res.providerMessageId).toMatch(/^wamid\.MOCK/);
    const statuses = emitted.flatMap((e) => parseWebhook(e.payload)).map((e) => (e.type === "status" ? e.status : e.type));
    expect(statuses).toEqual(["sent", "delivered", "read"]);
    expect(emitted[1]!.delay).toBeGreaterThan(emitted[0]!.delay);
    const body = JSON.stringify(emitted[0]!.payload);
    expect(mock.validateWebhook({ rawBody: body, signatureHeader: computeSignature(body, SECRET) })).toBe(true);
  });
});

describe("template content as a free-form message (inside the customer service window)", () => {
  const body = { type: "BODY", text: "Olá {{name}}, o pedido {{order}} saiu para entrega." };

  it("turns header + body + footer into one text message, filling the parameters", () => {
    const r = templateToFreeForm(
      [{ type: "HEADER", format: "TEXT", text: "Pedido a caminho" }, body, { type: "FOOTER", text: "Loja Demo" }],
      [
        { name: "name", value: "Ana" },
        { name: "order", value: "PED-1" },
      ],
    );
    expect(r).toEqual({ ok: true, content: { type: "text", text: "*Pedido a caminho*\n\nOlá Ana, o pedido PED-1 saiu para entrega.\n\n_Loja Demo_" } });
  });

  it("fills positional parameters ({{1}}, {{2}}) by order", () => {
    const r = templateToFreeForm([{ type: "BODY", text: "Código {{1}} para {{2}}" }], [{ value: "A1" }, { value: "Bia" }]);
    expect(r).toEqual({ ok: true, content: { type: "text", text: "Código A1 para Bia" } });
  });

  it("quick replies become reply buttons and one static URL button becomes a CTA", () => {
    const quick = templateToFreeForm([body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }, { type: "QUICK_REPLY", text: "Reagendar" }] }], [
      { name: "name", value: "Ana" },
      { name: "order", value: "1" },
    ]);
    expect(quick).toMatchObject({ ok: true, content: { type: "buttons", buttons: [{ id: "Confirmar", title: "Confirmar" }, { id: "Reagendar", title: "Reagendar" }] } });
    const cta = templateToFreeForm([{ type: "BODY", text: "Acompanhe a entrega." }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Rastrear", url: "https://loja.example/rastreio" }] }], []);
    expect(cta).toEqual({ ok: true, content: { type: "cta_url", body: "Acompanhe a entrega.", displayText: "Rastrear", url: "https://loja.example/rastreio" } });
  });

  it("refuses what a free-form message cannot show faithfully (the template is sent instead)", () => {
    const shape = (components: unknown) => templateFreeFormShape(components);
    expect(shape([{ type: "HEADER", format: "IMAGE" }, body])).toEqual({ ok: false, reason: "media_header" });
    expect(shape([{ type: "HEADER", format: "TEXT", text: "Olá {{1}}" }, body])).toEqual({ ok: false, reason: "header_variable" });
    expect(shape([body, { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.example/{{1}}" }] }])).toEqual({ ok: false, reason: "dynamic_url" });
    expect(shape([body, { type: "BUTTONS", buttons: [{ type: "PHONE_NUMBER", text: "Ligar", phone_number: "+5511" }] }])).toEqual({ ok: false, reason: "unsupported_buttons" });
    expect(shape([body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sim" }, { type: "URL", text: "Site", url: "https://x.example" }] }])).toEqual({ ok: false, reason: "unsupported_buttons" });
    expect(shape([body, { type: "BUTTONS", buttons: [1, 2, 3, 4].map((n) => ({ type: "QUICK_REPLY", text: `Opção ${n}` })) }])).toEqual({ ok: false, reason: "too_many_buttons" });
    expect(shape([body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Um título de botão longo demais" }] }])).toEqual({ ok: false, reason: "button_text" });
    expect(shape([body, { type: "CAROUSEL" }])).toEqual({ ok: false, reason: "unsupported_component" });
    expect(templateToFreeForm([body], [{ name: "name", value: "Ana" }])).toEqual({ ok: false, reason: "missing_parameter" });
    expect(templateToFreeForm([{ type: "BODY", text: "{{t}}" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ok" }] }], [{ name: "t", value: "x".repeat(1025) }])).toEqual({ ok: false, reason: "too_long" });
  });

  it("builds the documented interactive payloads and sends them to /messages", async () => {
    const base = { phoneNumberId: "PN1", to: "+5511999990000", bizOpaqueCallbackData: "att-1" };
    expect(interactiveBody({ ...base, content: { type: "buttons", header: "Pedido", body: "Chegou?", footer: "Loja", buttons: [{ id: "Sim", title: "Sim" }] } })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999990000",
      type: "interactive",
      interactive: { type: "button", header: { type: "text", text: "Pedido" }, body: { text: "Chegou?" }, footer: { text: "Loja" }, action: { buttons: [{ type: "reply", reply: { id: "Sim", title: "Sim" } }] } },
      biz_opaque_callback_data: "att-1",
    });
    expect(interactiveBody({ ...base, content: { type: "cta_url", body: "Acompanhe", displayText: "Rastrear", url: "https://x.example/r" } }).interactive).toEqual({
      type: "cta_url",
      body: { text: "Acompanhe" },
      action: { name: "cta_url", parameters: { display_text: "Rastrear", url: "https://x.example/r" } },
    });
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.I" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new MetaCloudApiProvider({ graphApiVersion: "v26.0", fetchImpl });
    const r = await p.sendInteractive({ ...base, content: { type: "buttons", body: "Chegou?", buttons: [{ id: "Sim", title: "Sim" }] } }, { accessToken: "T" });
    expect(r.providerMessageId).toBe("wamid.I");
    expect(sent!.url).toBe("https://graph.facebook.com/v26.0/PN1/messages");
    expect(sent!.body.type).toBe("interactive");
    const mock = new MockWhatsAppProvider({ appSecret: SECRET, wabaId: "W" });
    await mock.sendInteractive({ ...base, content: { type: "cta_url", body: "Acompanhe", displayText: "Rastrear", url: "https://x.example/r" } });
    expect(mock.sent[0]).toMatchObject({ type: "interactive", to: "+5511999990000" });
  });
});

describe("deliverability signals from Meta errors (131026 / 131049)", () => {
  it("recognizes only the two recipient-level failures", () => {
    expect(deliverabilitySignal(131026)).toBe("UNDELIVERABLE");
    expect(deliverabilitySignal("131049")).toBe("MARKETING_FREQUENCY_CAP");
    expect(deliverabilitySignal(131050)).toBeNull();
    expect(deliverabilitySignal(undefined)).toBeNull();
    expect(classifyMetaError(131026)).toMatchObject({ retryable: false, action: "UNDELIVERABLE" });
    expect(classifyMetaError(131049)).toMatchObject({ retryable: false, action: "ECOSYSTEM_LIMIT" });
  });

  it("waits longer on each consecutive occurrence, up to a cap", () => {
    const h = 3_600_000;
    // Never less than the 24 hours Meta asks for after a 131049.
    expect([1, 2, 3, 9].map((n) => deliverabilityCooldownMs("MARKETING_FREQUENCY_CAP", n) / h)).toEqual([24, 48, 72, 72]);
    expect([1, 2, 3, 9].map((n) => deliverabilityCooldownMs("UNDELIVERABLE", n) / h)).toEqual([24, 168, 720, 720]);
  });
});

describe("handoff link to the official number (wa.me)", () => {
  it("builds a click-to-chat link with a pre-filled text carrying a short reference", () => {
    const link = buildHandoffLink({ officialPhone: "+55 (41) 3333-0000", seed: "intent-123", prompt: "Quero ver minha oferta" });
    expect(link.ref).toMatch(/^[A-Z0-9]{8}$/);
    expect(link.text).toBe(`Quero ver minha oferta (ref ${link.ref})`);
    expect(link.url).toBe(`https://wa.me/554133330000?text=${encodeURIComponent(link.text)}`);
    expect(extractSessionRef(`Oi! ${link.text}`)).toBe(link.ref);
    expect(extractSessionRef("Oi, tudo bem?")).toBeNull();
    expect(buildHandoffLink({ officialPhone: "+554133330000", seed: "intent-123" }).ref).toBe(link.ref);
    expect(waMeLink("+554133330000")).toBe("https://wa.me/554133330000");
    expect(() => waMeLink("123")).toThrow();
  });
});
