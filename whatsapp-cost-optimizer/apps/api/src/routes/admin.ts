import type { FastifyInstance } from "fastify";
import { Permission } from "@wco/domain";
import {
  BspComparisonSchema,
  EmbeddedSignupSchema,
  HistoryImportSchema,
  ManualConnectSchema,
  OptimizationPolicySchema,
  PricingImportSchema,
  RateCardSimulationSchema,
  ResearchSchema,
  RetentionSchema,
  SavingsSimulationSchema,
  SimulateInboundSchema,
  TemplateCostSchema,
  TemplateSchema,
  TenantSettingsSchema,
  ConsentSchema,
  bspComparison,
  classificationAssistant,
  completeEmbeddedSignup,
  connectManual,
  connectMock,
  deleteCustomerData,
  exportCustomerData,
  getRetention,
  getTenant,
  historyImport,
  importPricing,
  listOptimizationPolicies,
  listPricing,
  listResearchRuns,
  listTemplates,
  onboardingStatus,
  rateCardSimulation,
  recordConsent,
  runResearch,
  savingsSimulation,
  setRateCardStatus,
  setRetention,
  simulateInbound,
  templateCost,
  updateTenant,
  upsertOptimizationPolicy,
  upsertRuleSet,
  upsertTemplate,
  type AppContext,
} from "@wco/services";
import { RuleSetSchema } from "@wco/policy";
import { z } from "zod";
import { actorOf, doc, guard } from "../http";

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const t = (req: Parameters<typeof actorOf>[0]) => actorOf(req).tenantId;

  // ---------------------------------------------------------------- pricing (spec §15)
  app.get("/api/v1/pricing", { schema: { tags: ["pricing"], summary: "Versioned pricing policies and rate cards" }, preHandler: guard(ctx, Permission.PRICING_READ) }, async () => listPricing(ctx));
  app.post("/api/v1/pricing/import", { schema: { tags: ["pricing"], summary: "Administrative rate-card import (CSV/JSON)", body: doc(PricingImportSchema) }, preHandler: guard(ctx, Permission.PRICING_WRITE), bodyLimit: 12 * 1024 * 1024 }, async (req) =>
    importPricing(ctx, actorOf(req), req.body),
  );
  app.patch("/api/v1/pricing/rate-cards/:id", { schema: { tags: ["pricing"] }, preHandler: guard(ctx, Permission.PRICING_WRITE) }, async (req) =>
    setRateCardStatus(ctx, actorOf(req), (req.params as { id: string }).id, z.object({ status: z.enum(["ACTIVE", "RETIRED"]) }).parse(req.body).status),
  );

  // ---------------------------------------------------------------- templates (spec §19, §65)
  app.get("/api/v1/templates", { schema: { tags: ["templates"] }, preHandler: guard(ctx, Permission.TEMPLATES_READ) }, async (req) => listTemplates(ctx, t(req)));
  app.post("/api/v1/templates", { schema: { tags: ["templates"], body: doc(TemplateSchema) }, preHandler: guard(ctx, Permission.TEMPLATES_WRITE) }, async (req, reply) => reply.status(201).send(await upsertTemplate(ctx, actorOf(req), req.body)));
  app.post("/api/v1/templates/cost-analysis", { schema: { tags: ["templates"], summary: "Template Cost Analyzer (final category is determined by Meta)", body: doc(TemplateCostSchema) }, preHandler: guard(ctx, Permission.TEMPLATES_READ) }, async (req) =>
    templateCost(ctx, t(req), req.body),
  );
  app.post("/api/v1/templates/:id/assistant", { schema: { tags: ["templates"], summary: "Optional AI classification assistant (disabled by default)" }, preHandler: guard(ctx, Permission.TEMPLATES_WRITE) }, async (req) =>
    classificationAssistant(ctx, actorOf(req), (req.params as { id: string }).id),
  );

  // ---------------------------------------------------------------- optimization policies (spec §9, §60)
  app.get("/api/v1/optimization/policies", { schema: { tags: ["optimization"] }, preHandler: guard(ctx, Permission.POLICIES_READ) }, async (req) => listOptimizationPolicies(ctx, t(req)));
  app.post("/api/v1/optimization/policies", { schema: { tags: ["optimization"], body: doc(OptimizationPolicySchema) }, preHandler: guard(ctx, Permission.POLICIES_WRITE) }, async (req) => upsertOptimizationPolicy(ctx, actorOf(req), req.body));
  app.put("/api/v1/optimization/rules", { schema: { tags: ["optimization"], summary: "Declarative rule set (PolicyEngine)", body: doc(RuleSetSchema) }, preHandler: guard(ctx, Permission.POLICIES_WRITE) }, async (req) => upsertRuleSet(ctx, actorOf(req), req.body));

  // ---------------------------------------------------------------- tenant
  app.get("/api/v1/tenant", { schema: { tags: ["tenant"] }, preHandler: guard(ctx, Permission.MESSAGES_READ) }, async (req) => getTenant(ctx, t(req)));
  app.patch("/api/v1/tenant", { schema: { tags: ["tenant"], body: doc(TenantSettingsSchema) }, preHandler: guard(ctx, Permission.TENANT_MANAGE) }, async (req) => updateTenant(ctx, actorOf(req), req.body));

  // ---------------------------------------------------------------- onboarding (spec §70)
  app.get("/api/v1/onboarding", { schema: { tags: ["onboarding"] }, preHandler: guard(ctx, Permission.PROVIDERS_MANAGE) }, async (req) => onboardingStatus(ctx, t(req)));
  app.post("/api/v1/onboarding/mock", { schema: { tags: ["onboarding"] }, preHandler: guard(ctx, Permission.PROVIDERS_MANAGE) }, async (req) => connectMock(ctx, actorOf(req)));
  app.post("/api/v1/onboarding/manual", { schema: { tags: ["onboarding"], body: doc(ManualConnectSchema) }, preHandler: guard(ctx, Permission.PROVIDERS_MANAGE) }, async (req) => connectManual(ctx, actorOf(req), req.body));
  app.post("/api/v1/onboarding/embedded-signup", { schema: { tags: ["onboarding"], body: doc(EmbeddedSignupSchema) }, preHandler: guard(ctx, Permission.PROVIDERS_MANAGE) }, async (req) =>
    completeEmbeddedSignup(ctx, actorOf(req), req.body),
  );
  app.post("/api/v1/dev/simulate-inbound", { schema: { tags: ["dev"], summary: "MOCK mode: simulate a customer message (opens CSW / FEP)", body: doc(SimulateInboundSchema) }, preHandler: guard(ctx, Permission.MESSAGES_WRITE) }, async (req) =>
    simulateInbound(ctx, actorOf(req), req.body),
  );

  // ---------------------------------------------------------------- privacy / LGPD (spec §24)
  const phoneBody = z.object({ customer: z.string().min(8) });
  app.post("/api/v1/privacy/export", { schema: { tags: ["privacy"], body: doc(phoneBody) }, preHandler: guard(ctx, Permission.PRIVACY_MANAGE) }, async (req) => exportCustomerData(ctx, actorOf(req), phoneBody.parse(req.body).customer));
  app.post("/api/v1/privacy/delete", { schema: { tags: ["privacy"], body: doc(phoneBody) }, preHandler: guard(ctx, Permission.PRIVACY_MANAGE) }, async (req) => deleteCustomerData(ctx, actorOf(req), phoneBody.parse(req.body).customer));
  app.post("/api/v1/privacy/consent", { schema: { tags: ["privacy"], body: doc(ConsentSchema) }, preHandler: guard(ctx, Permission.MESSAGES_WRITE) }, async (req) => recordConsent(ctx, actorOf(req), req.body));
  app.get("/api/v1/privacy/retention", { schema: { tags: ["privacy"] }, preHandler: guard(ctx, Permission.PRIVACY_MANAGE) }, async (req) => getRetention(ctx, t(req)));
  app.put("/api/v1/privacy/retention", { schema: { tags: ["privacy"], body: doc(RetentionSchema) }, preHandler: guard(ctx, Permission.PRIVACY_MANAGE) }, async (req) => setRetention(ctx, actorOf(req), req.body));

  // ---------------------------------------------------------------- simulators (spec §16, §37, §38, §39, §66)
  app.post("/api/v1/simulate/savings", { schema: { tags: ["simulation"], summary: "Simular Economia — Resultado estimado", body: doc(SavingsSimulationSchema) }, preHandler: guard(ctx, Permission.SIMULATOR_USE) }, async (req) => savingsSimulation(ctx, req.body));
  app.post("/api/v1/simulate/rate-card", { schema: { tags: ["simulation"], body: doc(RateCardSimulationSchema) }, preHandler: guard(ctx, Permission.SIMULATOR_USE) }, async (req) => rateCardSimulation(ctx, req.body));
  app.post("/api/v1/simulate/bsp", { schema: { tags: ["simulation"], summary: "Direct Cloud API vs BSP", body: doc(BspComparisonSchema) }, preHandler: guard(ctx, Permission.SIMULATOR_USE) }, async (req) => bspComparison(req.body));
  app.post("/api/v1/import/history", { schema: { tags: ["simulation"], summary: "Historical CSV import → baseline + WCO simulation", body: doc(HistoryImportSchema) }, preHandler: guard(ctx, Permission.SIMULATOR_USE), bodyLimit: 60 * 1024 * 1024 }, async (req) =>
    historyImport(ctx, actorOf(req), req.body),
  );
  app.post("/api/v1/research/run", { schema: { tags: ["simulation"], summary: "Academic experiment A–F (small runs)", body: doc(ResearchSchema) }, preHandler: guard(ctx, Permission.SIMULATOR_USE) }, async (req) => runResearch(ctx, actorOf(req), req.body));
  app.get("/api/v1/research/runs", { schema: { tags: ["simulation"] }, preHandler: guard(ctx, Permission.SIMULATOR_USE) }, async (req) => listResearchRuns(ctx, t(req)));
}
