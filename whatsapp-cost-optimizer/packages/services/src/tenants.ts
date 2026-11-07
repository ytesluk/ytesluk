import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword } from "@wco/config";
import type { Db } from "@wco/database";
import { Errors, isValidTimeZone } from "@wco/domain";
import { DEFAULT_OPTIMIZATION_POLICIES, DEFAULT_RULESET } from "@wco/policy";
import { audit } from "./audit";
import { issueSession } from "./auth";
import type { AppContext } from "./context";

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

export interface ProvisionTenantInput {
  slug: string;
  name: string;
  timezone?: string;
  currency?: string;
  plan?: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
  requireOptIn?: boolean;
  usesBsp?: boolean;
  bspFeeModel?: Record<string, unknown>;
  inboxEnabled?: boolean;
}

/**
 * Creates a tenant with everything the pipeline needs to run: default optimization policies, the
 * default rule set, a retention policy and a subscription. Shared by self-service signup and the seed,
 * so both produce identical tenants. No WhatsApp connection is created here (onboarding does that).
 */
export async function provisionTenant(tx: Tx, input: ProvisionTenantInput) {
  const plan = input.plan ?? "FREE";
  const tenant = await tx.tenant.create({
    data: {
      slug: input.slug,
      name: input.name,
      defaultCurrency: input.currency ?? "BRL",
      defaultTimezone: input.timezone ?? "America/Sao_Paulo",
      requireOptIn: input.requireOptIn ?? true,
      usesBsp: input.usesBsp ?? false,
      bspFeeModel: (input.bspFeeModel ?? { type: "NONE" }) as never,
      plan,
      inboxEnabled: input.inboxEnabled ?? false,
    },
  });
  await tx.optimizationPolicy.createMany({
    data: DEFAULT_OPTIMIZATION_POLICIES.map((p) => ({ ...p, tenantId: tenant.id, supersessionGroup: p.supersessionGroup ?? null, consolidationTemplate: p.consolidationTemplate ?? null, defaultTemplate: p.defaultTemplate ?? null, defaultLanguage: p.defaultLanguage ?? "pt_BR", category: (p.category ?? null) as never })),
  });
  await tx.policyRuleSet.create({ data: { tenantId: tenant.id, name: DEFAULT_RULESET.name, rules: DEFAULT_RULESET as never, active: true } });
  await tx.dataRetentionPolicy.create({ data: { tenantId: tenant.id } });
  await tx.subscription.create({ data: { tenantId: tenant.id, plan } });
  return tenant;
}

export const SignupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  timezone: z.string().default("America/Sao_Paulo"),
  acceptTerms: z.literal(true, { message: "É preciso aceitar os termos de uso e a política de privacidade" }),
});

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : "empresa";
}

/**
 * Self-service account creation (SaaS): one tenant + its OWNER user on the FREE plan, then a session.
 * The terms version accepted is recorded in the audit log. Disabled with SIGNUP_ENABLED=false.
 */
export async function signup(ctx: AppContext, raw: unknown) {
  if (!ctx.config.env.SIGNUP_ENABLED) throw Errors.forbidden("Cadastro desativado neste ambiente");
  const input = SignupSchema.parse(raw);
  if (!isValidTimeZone(input.timezone)) throw Errors.validation("Invalid IANA timezone");
  const email = input.email.toLowerCase();
  if (await ctx.db.user.findUnique({ where: { email } })) throw Errors.conflict("Email already in use");

  const base = slugify(input.companyName);
  const slug = (await ctx.db.tenant.findUnique({ where: { slug: base } })) ? `${base}-${randomBytes(3).toString("hex")}` : base;
  let created;
  try {
    created = await ctx.db.$transaction(async (tx) => {
      const tenant = await provisionTenant(tx, { slug, name: input.companyName, timezone: input.timezone });
      const user = await tx.user.create({ data: { tenantId: tenant.id, email, name: input.name, passwordHash: hashPassword(input.password), role: "OWNER" } });
      return { tenant, user };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw Errors.conflict("Email already in use");
    throw e;
  }
  const { tenant, user } = created;
  const actor = { type: "USER" as const, id: user.id, tenantId: tenant.id, role: user.role };
  await audit(ctx.db, { tenantId: tenant.id, actor, action: "tenant.signup", entityType: "Tenant", entityId: tenant.id, data: { plan: tenant.plan, termsVersion: ctx.config.env.TERMS_VERSION } });
  await ctx.db.user.update({ where: { id: user.id }, data: { lastLoginAt: ctx.now() } });
  return issueSession(ctx, user);
}
