import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@wco/domain";
import { migrateTestDatabase, truncateAll, useTestEnv } from "@wco/testing";
import { BULK_EVENT, createAppContext, seedAll, sendBulk, type Actor, type AppContext } from "./index";

/** Integration tests (PostgreSQL + Redis, mock WhatsApp) of "Enviar mensagens" from the dashboard. */
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

const template = { name: "order_status_update", language: "pt_BR" };
const consent = { optIn: true as const, source: "painel" };

describe("Enviar mensagens (dashboard)", () => {
  it("turns a list into one intent per customer, skipping repeated numbers and reporting bad lines without echoing them", async () => {
    const r = await sendBulk(ctx, acme, {
      template,
      data: { orderId: "Black Friday", statusLabel: "com 20% de desconto" },
      customers: ["+5511950009001", "+5511950009002", "+5511950009001", "texto-sem-numero"],
      consent,
    });
    expect(r).toMatchObject({ accepted: 2, duplicates: 1 });
    expect(r.failed).toEqual([{ line: 4, error: expect.any(String) }]);
    expect(JSON.stringify(r)).not.toContain("5511950009001");
    const intents = await ctx.db.messageIntent.findMany({ where: { tenantId: acme.tenantId, eventType: BULK_EVENT } });
    expect(intents).toHaveLength(2);
    expect(intents.every((i) => i.templateName === "order_status_update")).toBe(true);
  });

  it("an unknown template fails every line with the reason, and nothing is created", async () => {
    const before = await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, eventType: BULK_EVENT } });
    const r = await sendBulk(ctx, acme, { template: { name: "nao_existe" }, customers: ["+5511950009003"], consent });
    expect(r.accepted).toBe(0);
    expect(r.failed[0]!.error).toContain("not registered");
    expect(await ctx.db.messageIntent.count({ where: { tenantId: acme.tenantId, eventType: BULK_EVENT } })).toBe(before);
  });

  it("requires the customers' consent to be confirmed", async () => {
    await expect(sendBulk(ctx, acme, { template, customers: ["+5511950009004"], consent: { optIn: false } })).rejects.toThrow();
  });
});
