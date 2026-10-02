import { z } from "zod";
import { commercialOnboardingStatus } from "@wco/config";
import { Errors, isValidTimeZone, localDate } from "@wco/domain";
import { MetaCloudApiProvider, buildInboundPayload, computeSignature } from "@wco/whatsapp";
import { audit } from "./audit";
import { publishTenantChanged, type Actor, type AppContext } from "./context";
import { ingestWebhook } from "./webhooks";

/**
 * "Connect WhatsApp" (spec §70): Meta account → Business account → WABA → Phone number → Permissions →
 * Webhook → Validation → Pricing policy snapshot → Ready.
 *
 * Modes:
 *  - MOCK:            development without credentials (MockWhatsAppProvider)
 *  - MANUAL:          the developer's own WABA/test WABA with a system user token (academic mode)
 *  - EMBEDDED_SIGNUP: Tech Provider / Solution Partner flow (requires Meta approval; spec §69)
 * Production mode blocks commercial onboarding when partner credentials/approvals are missing.
 */
export const STEPS = ["META_ACCOUNT", "BUSINESS_ACCOUNT", "WABA", "PHONE_NUMBER", "PERMISSIONS", "WEBHOOK", "VALIDATION", "PRICING_SNAPSHOT", "READY"] as const;
type StepStatus = "DONE" | "PENDING" | "BLOCKED" | "NOT_APPLICABLE";

export async function onboardingStatus(ctx: AppContext, tenantId: string) {
  const [accounts, wabas, phones, webhooks, policies, cards] = await Promise.all([
    ctx.db.businessAccount.count({ where: { tenantId } }),
    ctx.db.waba.findMany({ where: { tenantId } }),
    ctx.db.phoneNumber.count({ where: { tenantId } }),
    ctx.db.webhookEvent.count({ where: { tenantId } }),
    ctx.db.pricingPolicyVersion.count({ where: { status: "ACTIVE" } }),
    ctx.db.priceCatalogImport.findMany({ where: { status: "ACTIVE" }, select: { currency: true, isDemo: true } }),
  ]);
  const gate = commercialOnboardingStatus(ctx.config);
  const mock = ctx.config.meta.mock;
  const waba = wabas[0];
  const priced = !!waba && cards.some((c) => c.currency === waba.currency);
  const steps: Record<(typeof STEPS)[number], StepStatus> = {
    META_ACCOUNT: mock || ctx.config.meta.appId ? "DONE" : "PENDING",
    BUSINESS_ACCOUNT: accounts > 0 ? "DONE" : "PENDING",
    WABA: wabas.length > 0 ? "DONE" : "PENDING",
    PHONE_NUMBER: phones > 0 ? "DONE" : "PENDING",
    PERMISSIONS: waba && (waba.provider === "MOCK" || waba.accessTokenEncrypted) ? "DONE" : "PENDING",
    WEBHOOK: waba?.webhookSubscribedAt || webhooks > 0 ? "DONE" : "PENDING",
    VALIDATION: waba?.validatedAt ? "DONE" : "PENDING",
    PRICING_SNAPSHOT: policies > 0 && priced ? "DONE" : "PENDING",
    READY: "PENDING",
  };
  steps.READY = Object.entries(steps).every(([k, v]) => k === "READY" || v === "DONE") ? "DONE" : "PENDING";
  if (!gate.allowed) for (const k of ["PERMISSIONS", "VALIDATION"] as const) if (steps[k] !== "DONE") steps[k] = "BLOCKED";
  return {
    mode: mock ? "MOCK" : ctx.config.meta.partnerType ? "EMBEDDED_SIGNUP" : "MANUAL",
    appMode: ctx.config.mode,
    graphApiVersion: ctx.config.meta.graphApiVersion ?? null,
    commercialOnboarding: gate,
    steps,
    embeddedSignup:
      ctx.config.meta.partnerType && ctx.config.meta.appId && ctx.config.meta.embeddedSignupConfigId
        ? { appId: ctx.config.meta.appId, configId: ctx.config.meta.embeddedSignupConfigId, graphApiVersion: ctx.config.meta.graphApiVersion }
        : null,
    pricingDemoOnly: cards.length > 0 && cards.every((c) => c.isDemo),
    notes: [
      "O Embedded Signup exige que o app seja Tech Provider/Solution Partner da Meta, com acesso avançado a whatsapp_business_management e whatsapp_business_messaging.",
      "Um token de desenvolvedor só gerencia as WABAs às quais recebeu acesso; ele não administra a WABA de qualquer cliente.",
    ],
  };
}

export const ManualConnectSchema = z.object({
  businessName: z.string().min(1),
  metaBusinessId: z.string().optional(),
  wabaId: z.string().min(3),
  phoneNumberId: z.string().min(3),
  accessToken: z.string().min(10),
  timezone: z.string().default("America/Sao_Paulo"),
  currency: z.string().length(3).default("BRL"),
});

export async function connectManual(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = ManualConnectSchema.parse(raw);
  const gate = commercialOnboardingStatus(ctx.config);
  if (!gate.allowed) throw Errors.forbidden(`Production onboarding blocked: missing ${gate.missing.join(", ")}`);
  if (ctx.config.meta.mock) throw Errors.validation("MOCK_WHATSAPP=true — set MOCK_WHATSAPP=false and META_GRAPH_API_VERSION to connect a real WABA");
  if (!isValidTimeZone(input.timezone)) throw Errors.validation("Invalid IANA timezone");
  const provider = ctx.provider({ id: "", metaWabaId: input.wabaId, businessAccountId: "", timezone: input.timezone, currency: input.currency, provider: "META_CLOUD_API", accessTokenEncrypted: null, authInternationalEligible: false });
  const creds = { accessToken: input.accessToken };
  const [waba, phone] = await Promise.all([provider.getBusinessAccount(input.wabaId, creds), provider.getPhoneNumber(input.phoneNumberId, creds)]);
  const sub = await provider.registerWebhook(input.wabaId, creds);
  return persistConnection(ctx, actor, { ...input, wabaName: waba.name ?? input.businessName, display: phone.displayPhoneNumber, verifiedName: phone.verifiedName, quality: phone.qualityRating, provider: "META_CLOUD_API", webhookSubscribed: sub.success, mode: "MANUAL" });
}

export const EmbeddedSignupSchema = z.object({ code: z.string().min(10), wabaId: z.string().min(3), phoneNumberId: z.string().min(3), pin: z.string().regex(/^\d{6}$/), businessName: z.string().min(1), timezone: z.string().default("America/Sao_Paulo"), currency: z.string().length(3).default("BRL") });

export async function completeEmbeddedSignup(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = EmbeddedSignupSchema.parse(raw);
  const gate = commercialOnboardingStatus(ctx.config);
  if (!gate.allowed || !ctx.config.meta.partnerType) throw Errors.forbidden(`Embedded Signup indisponível; faltam: ${[...gate.missing, ...(ctx.config.meta.partnerType ? [] : ["META_PARTNER_TYPE"])].join(", ")}`);
  const meta = new MetaCloudApiProvider({ graphApiVersion: ctx.config.meta.graphApiVersion!, baseUrl: ctx.config.meta.graphApiBaseUrl, appSecret: ctx.config.meta.appSecret });
  const { accessToken } = await meta.exchangeCodeForToken(input.code, ctx.config.meta.appId!, ctx.config.meta.appSecret!);
  const creds = { accessToken };
  const sub = await meta.registerWebhook(input.wabaId, creds);
  await meta.registerPhoneNumber(input.phoneNumberId, input.pin, creds);
  const phone = await meta.getPhoneNumber(input.phoneNumberId, creds);
  return persistConnection(ctx, actor, { ...input, accessToken, wabaName: input.businessName, display: phone.displayPhoneNumber, verifiedName: phone.verifiedName, quality: phone.qualityRating, provider: "META_CLOUD_API", webhookSubscribed: sub.success, mode: "EMBEDDED_SIGNUP" });
}

/** Development: connect a mock WABA/phone so the full pipeline runs without Meta credentials. */
export async function connectMock(ctx: AppContext, actor: Actor) {
  if (ctx.config.isProduction && !ctx.config.env.ALLOW_MOCK_IN_PRODUCTION) throw Errors.forbidden("Mock connection is not available in production");
  const suffix = actor.tenantId.slice(0, 8);
  return persistConnection(ctx, actor, {
    businessName: "Mock Business",
    wabaId: `mock-waba-${suffix}`,
    phoneNumberId: `mock-pn-${suffix}`,
    accessToken: null,
    timezone: "America/Sao_Paulo",
    currency: "BRL",
    wabaName: "Mock WABA",
    display: "+55 11 4000-0000",
    verifiedName: "Mock Business",
    quality: "GREEN",
    provider: "MOCK",
    webhookSubscribed: true,
    mode: "MOCK",
  });
}

async function persistConnection(
  ctx: AppContext,
  actor: Actor,
  c: { businessName: string; metaBusinessId?: string; wabaId: string; phoneNumberId: string; accessToken: string | null; timezone: string; currency: string; wabaName: string; display: string; verifiedName?: string; quality?: string; provider: "MOCK" | "META_CLOUD_API"; webhookSubscribed: boolean; mode: string },
) {
  const now = ctx.now();
  const result = await ctx.db.$transaction(async (tx) => {
    const ba =
      (await tx.businessAccount.findFirst({ where: { tenantId: actor.tenantId } })) ??
      (await tx.businessAccount.create({ data: { tenantId: actor.tenantId, name: c.businessName, metaBusinessId: c.metaBusinessId ?? null } }));
    const existingWaba = await tx.waba.findUnique({ where: { metaWabaId: c.wabaId } });
    if (existingWaba && existingWaba.tenantId !== actor.tenantId) throw Errors.conflict("This WABA is already connected to another tenant");
    const waba = await tx.waba.upsert({
      where: { metaWabaId: c.wabaId },
      create: { tenantId: actor.tenantId, businessAccountId: ba.id, metaWabaId: c.wabaId, name: c.wabaName, timezone: c.timezone, currency: c.currency, provider: c.provider, accessTokenEncrypted: c.accessToken ? ctx.vault.encryptSecret(c.accessToken) : null, webhookSubscribedAt: c.webhookSubscribed ? now : null, validatedAt: now },
      update: { name: c.wabaName, timezone: c.timezone, currency: c.currency, provider: c.provider, ...(c.accessToken ? { accessTokenEncrypted: ctx.vault.encryptSecret(c.accessToken) } : {}), webhookSubscribedAt: c.webhookSubscribed ? now : undefined, validatedAt: now },
    });
    const existingPhone = await tx.phoneNumber.findUnique({ where: { metaPhoneNumberId: c.phoneNumberId } });
    if (existingPhone && existingPhone.tenantId !== actor.tenantId) throw Errors.conflict("This phone number is already connected to another tenant");
    const hasDefault = await tx.phoneNumber.count({ where: { tenantId: actor.tenantId, isDefault: true } });
    const phone = await tx.phoneNumber.upsert({
      where: { metaPhoneNumberId: c.phoneNumberId },
      create: { tenantId: actor.tenantId, wabaId: waba.id, metaPhoneNumberId: c.phoneNumberId, displayPhoneNumber: c.display, verifiedName: c.verifiedName ?? null, qualityRating: c.quality ?? null, isDefault: hasDefault === 0 },
      update: { wabaId: waba.id, displayPhoneNumber: c.display, verifiedName: c.verifiedName ?? null, qualityRating: c.quality ?? null },
    });
    const engine = await ctx.pricing.engine();
    const policy = engine.policies.forInstant(now, c.timezone);
    const card = engine.rates.select(c.currency, localDate(now, c.timezone));
    const session = await tx.onboardingSession.create({
      data: {
        tenantId: actor.tenantId,
        mode: c.mode,
        status: "READY",
        wabaId: waba.id,
        steps: { META_ACCOUNT: "DONE", BUSINESS_ACCOUNT: "DONE", WABA: "DONE", PHONE_NUMBER: "DONE", PERMISSIONS: "DONE", WEBHOOK: c.webhookSubscribed ? "DONE" : "PENDING", VALIDATION: "DONE", PRICING_SNAPSHOT: { policy: policy?.id ?? null, rateCard: card?.meta.name ?? null, isDemo: card?.meta.isDemo ?? null }, READY: "DONE" },
      },
    });
    return { businessAccountId: ba.id, wabaId: waba.id, phoneNumberId: phone.id, sessionId: session.id, pricingSnapshot: { policy: policy?.id ?? null, rateCard: card?.meta.name ?? null, isDemo: card?.meta.isDemo ?? null } };
  });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "integration.connected", entityType: "Waba", entityId: result.wabaId, data: { mode: c.mode, provider: c.provider } });
  await publishTenantChanged(ctx, actor.tenantId);
  return result;
}

export const SimulateInboundSchema = z.object({
  customer: z.string().min(8),
  text: z.string().max(1000).default("Olá!"),
  viaAd: z.boolean().default(false),
  adId: z.string().default("mock-ad-1"),
  phoneNumberId: z.string().optional(),
});

/** Development helper: makes the mock "customer" write to the business (opens CSW / FEP). */
export async function simulateInbound(ctx: AppContext, actor: Actor, raw: unknown) {
  if (!ctx.config.meta.mock) throw Errors.forbidden("Only available with MOCK_WHATSAPP=true");
  const input = SimulateInboundSchema.parse(raw);
  const tenant = await ctx.tenants.get(actor.tenantId);
  const phone = tenant.phones.find((p) => p.id === input.phoneNumberId || p.metaPhoneNumberId === input.phoneNumberId) ?? tenant.phones.find((p) => p.isDefault) ?? tenant.phones[0];
  if (!phone) throw Errors.validation("No phone number connected");
  const waba = tenant.wabas.get(phone.wabaId);
  const payload = buildInboundPayload({
    wabaId: waba?.metaWabaId ?? "mock-waba",
    phoneNumberId: phone.metaPhoneNumberId,
    from: input.customer,
    text: input.text,
    timestamp: ctx.now(),
    referral: input.viaAd ? { sourceType: "ad", sourceId: input.adId } : undefined,
  });
  const raw2 = Buffer.from(JSON.stringify(payload));
  return ingestWebhook(ctx, { rawBody: raw2, signature: computeSignature(raw2, ctx.config.meta.appSecret ?? "wco-dev-app-secret") });
}
