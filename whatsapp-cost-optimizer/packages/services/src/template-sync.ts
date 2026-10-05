import type { MetaTemplateInfo } from "@wco/whatsapp";
import { audit } from "./audit";
import { publishTenantChanged, type Actor, type AppContext } from "./context";

/**
 * Imports the templates that already exist on the tenant's WABAs (GET /<WABA_ID>/message_templates)
 * so intents can reference them by name. Meta is the authority: status and category come from Meta
 * and are kept current afterwards by the template webhooks. Nothing is created or edited on Meta.
 */
const STATUS: Record<string, "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED"> = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  IN_APPEAL: "PENDING",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
  PENDING_DELETION: "DISABLED",
  DELETED: "DISABLED",
  ARCHIVED: "DISABLED",
  LIMIT_EXCEEDED: "DISABLED",
};
const CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);

/** Variable names of a component text, in order: {{1}} → "1", {{order_id}} → "order_id". */
export function templateVariables(text: string | undefined): string[] {
  const names = [...(text ?? "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(names)];
}

/** Meta components → the WCO's stored shape (BODY carries `params` and `parameterFormat` for sending). */
export function toLocalComponents(t: MetaTemplateInfo) {
  const body = t.components.find((c) => c.type?.toUpperCase() === "BODY");
  const vars = templateVariables(body?.text);
  const positional = t.parameterFormat ? t.parameterFormat.toUpperCase() === "POSITIONAL" : vars.length > 0 && vars.every((v) => /^\d+$/.test(v));
  const params = positional ? [...vars].sort((a, b) => Number(a) - Number(b)) : vars;
  return {
    components: t.components.map((c) => (c.type?.toUpperCase() === "BODY" ? { ...c, type: "BODY", params, parameterFormat: positional ? "POSITIONAL" : "NAMED" } : c)),
    params,
    /** Header/button variables are not filled by the WCO dispatcher (body parameters only). */
    unsupportedVariables: t.components.filter((c) => c.type?.toUpperCase() !== "BODY").some((c) => templateVariables(c.text).length > 0),
  };
}

export async function syncTemplates(ctx: AppContext, actor: Actor) {
  const tenant = await ctx.tenants.get(actor.tenantId);
  const now = ctx.now();
  const result = { wabas: 0, synced: 0, approved: 0, skipped: [] as string[], warnings: [] as string[] };
  for (const waba of tenant.wabas.values()) {
    const provider = ctx.provider(waba);
    const creds = { accessToken: waba.accessTokenEncrypted ? ctx.vault.decryptSecret(waba.accessTokenEncrypted) : (ctx.config.meta.devCredentials.accessToken ?? "mock-token") };
    const templates = await provider.listTemplates(waba.metaWabaId, creds);
    result.wabas++;
    for (const t of templates) {
      const category = t.category.toUpperCase();
      if (!t.name || !t.language || !CATEGORIES.has(category)) {
        result.skipped.push(`${t.name || "?"} (${t.language || "?"}): categoria ${t.category || "ausente"}`);
        continue;
      }
      const status = STATUS[t.status.toUpperCase()] ?? "PENDING";
      const local = toLocalComponents(t);
      if (local.unsupportedVariables) result.warnings.push(`${t.name}: variáveis fora do corpo (cabeçalho/botões) não são preenchidas pelo WCO`);
      const data = {
        wabaId: waba.id,
        metaCategory: category as never,
        status,
        components: local.components as never,
        externalId: t.id || null,
        ...(status === "APPROVED" ? { approvedAt: now } : {}),
        ...(status === "REJECTED" ? { rejectedAt: now } : {}),
      };
      await ctx.db.template.upsert({
        where: { tenantId_name_language: { tenantId: actor.tenantId, name: t.name, language: t.language } },
        create: { tenantId: actor.tenantId, name: t.name, language: t.language, declaredCategory: category as never, ...data },
        update: data,
      });
      result.synced++;
      if (status === "APPROVED") result.approved++;
    }
  }
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "template.synced", entityType: "Tenant", entityId: actor.tenantId, data: { wabas: result.wabas, synced: result.synced, approved: result.approved } });
  await publishTenantChanged(ctx, actor.tenantId);
  return result;
}
