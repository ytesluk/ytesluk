import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@wco/domain";
import { migrateTestDatabase, truncateAll, useTestEnv } from "@wco/testing";
import { authenticateBearer, connectMock, createAppContext, createIntent, DEFAULT_JOIN_TEXT, flushGroup, getJoinMessage, joinMessageProblems, optimizeIntent, seedAll, signup, submitJoinMessage, type Actor, type AppContext } from "./index";

/**
 * Integration tests (PostgreSQL + Redis, mock WhatsApp) of "Economia de juntar mensagens": the
 * company's own combined message goes to Meta as a template and, once approved, several updates of
 * the same order leave as one message with that text.
 */
let ctx: AppContext;
let acme: Actor;

beforeAll(async () => {
  useTestEnv();
  migrateTestDatabase();
  ctx = createAppContext({ service: "test", subscribe: false });
  await truncateAll(ctx.db);
  await ctx.redis.flushdb();
  const s = await seedAll(ctx, { demoHistory: false });
  acme = { type: "SYSTEM", id: null, tenantId: s.acmeTenantId, role: Role.OWNER };
});

afterAll(async () => {
  await ctx?.close();
});

const GOOD = "Olá! Novidades do seu pedido: {{atualizacoes}}. Qualquer dúvida, é só responder esta mensagem.";

describe("Joining messages, built in", () => {
  it("a company that connects its WhatsApp gets the standard combined message and joining, with nothing to write", async () => {
    const s = await signup(ctx, { companyName: "Loja Nova Junta", name: "Bia", email: "bia@lojanova.test", password: "senha-forte-123", acceptTerms: true });
    const owner = await authenticateBearer(ctx, s.token);
    expect((await getJoinMessage(ctx, owner.tenantId)).current).toBeNull();

    const r = await connectMock(ctx, owner);
    expect(r.joinMessage).toMatchObject({ created: true });
    const now = await getJoinMessage(ctx, owner.tenantId);
    expect(now).toMatchObject({ connected: true, current: { status: "APPROVED", writtenInWco: true, text: DEFAULT_JOIN_TEXT } });
    const order = await ctx.db.optimizationPolicy.findFirstOrThrow({ where: { tenantId: owner.tenantId, eventType: "order.status" } });
    expect(order).toMatchObject({ allowAggregation: true, consolidationTemplate: now.current!.name });

    // Connecting again does not submit a second one.
    expect((await connectMock(ctx, owner)).joinMessage).toMatchObject({ created: false, name: now.current!.name });
    expect(await ctx.db.template.count({ where: { tenantId: owner.tenantId, name: { startsWith: "wco_juntar_" } } })).toBe(1);
  });
});

describe("Economia de juntar mensagens", () => {
  it("explains what Meta would refuse before sending anything", () => {
    expect(joinMessageProblems("Olá, novidades do seu pedido de hoje.")).toContain("Inclua o lugar onde entram as atualizações.");
    expect(joinMessageProblems("{{atualizacoes}} são as novidades do seu pedido.").join(" ")).toContain("antes das atualizações");
    expect(joinMessageProblems("As novidades do seu pedido são: {{atualizacoes}}").join(" ")).toContain("depois das atualizações");
    expect(joinMessageProblems("Oi {{nome}}, novidades do pedido: {{atualizacoes}}. Até logo!").join(" ")).toContain("sem outras variáveis");
    expect(joinMessageProblems("Novidades: {{atualizacoes}} {{atualizacoes}} fim.").join(" ")).toContain("só pode aparecer uma vez");
    expect(joinMessageProblems(GOOD)).toEqual([]);
  });

  it("refuses a text Meta would reject, and creates nothing", async () => {
    await expect(submitJoinMessage(ctx, acme, { text: "As novidades do seu pedido são: {{atualizacoes}}" })).rejects.toMatchObject({ httpStatus: 400 });
    expect(await ctx.db.template.count({ where: { tenantId: acme.tenantId, name: { startsWith: "wco_juntar_" } } })).toBe(0);
    expect((await getJoinMessage(ctx, acme.tenantId)).current?.writtenInWco ?? false).toBe(false);
  });

  it("submits the message to Meta and turns joining on for the utility notices only", async () => {
    const r = await submitJoinMessage(ctx, acme, { text: GOOD });
    expect(r).toMatchObject({ connected: true, current: { status: "APPROVED", writtenInWco: true, text: GOOD } });
    const t = await ctx.db.template.findFirstOrThrow({ where: { tenantId: acme.tenantId, name: r.current!.name } });
    expect(t).toMatchObject({ consolidationParam: "atualizacoes", declaredCategory: "UTILITY", status: "APPROVED", externalId: `mock-template-${t.name}` });
    expect(t.name).toMatch(/^wco_juntar_\d{14}$/);

    const policies = await ctx.db.optimizationPolicy.findMany({ where: { tenantId: acme.tenantId } });
    const of = (e: string) => policies.find((p) => p.eventType === e)!;
    expect(of("order.status")).toMatchObject({ allowAggregation: true, consolidationTemplate: t.name });
    expect(of("payment.approved")).toMatchObject({ allowAggregation: true, consolidationTemplate: t.name });
    expect(of("order.status").maxDelaySeconds).toBeGreaterThanOrEqual(60);
    // Marketing notices cannot share a utility template; codes and critical alerts are never held.
    expect(of("marketing.campaign")).toMatchObject({ allowAggregation: false, consolidationTemplate: null });
    expect(of("authentication.otp")).toMatchObject({ allowAggregation: false, consolidationTemplate: null });
  });

  it("two different updates of the same order now leave as ONE message, with the company's template", async () => {
    // Two notices that do not replace each other (a status update would replace the older one).
    const common = { customer: "+5511950007001", entityId: "PED-JUNTA-1", consent: { optIn: true, source: "test" } } as const;
    const a = await createIntent(ctx, acme, { ...common, eventType: "payment.approved", data: { orderId: "PED-JUNTA-1", amount: "R$ 120,00", summary: "pagamento aprovado" } });
    const b = await createIntent(ctx, acme, { ...common, eventType: "order.status", data: { orderId: "PED-JUNTA-1", statusLabel: "pedido separado" } });
    await optimizeIntent(ctx, { tenantId: acme.tenantId, intentId: a.intentId });
    await optimizeIntent(ctx, { tenantId: acme.tenantId, intentId: b.intentId });
    const rows = await ctx.db.messageIntent.findMany({ where: { id: { in: [a.intentId, b.intentId] } } });
    expect(rows.map((r) => r.status)).toEqual(["DELAYED", "DELAYED"]);
    expect(new Set(rows.map((r) => r.groupKey)).size).toBe(1);

    const realNow = ctx.now;
    ctx.now = () => new Date(realNow.call(ctx).getTime() + 10 * 60_000);
    try {
      await flushGroup(ctx, { tenantId: acme.tenantId, groupKey: rows[0]!.groupKey });
    } finally {
      ctx.now = realNow;
    }
    const attempts = await ctx.db.messageAttempt.findMany({ where: { tenantId: acme.tenantId, coveredIntentIds: { hasSome: [a.intentId, b.intentId] } } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.templateName).toMatch(/^wco_juntar_/);
    expect([...attempts[0]!.coveredIntentIds].sort()).toEqual([a.intentId, b.intentId].sort());
  });
});
