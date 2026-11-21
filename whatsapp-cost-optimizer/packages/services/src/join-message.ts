import { Errors, isAppError } from "@wco/domain";
import { templateText } from "@wco/optimization";
import { z } from "zod";
import { audit } from "./audit";
import { publishTenantChanged, type Actor, type AppContext } from "./context";
import { TEMPLATE_STATUS } from "./template-sync";

/**
 * Joining messages, built in: when the company connects its WhatsApp, the WCO submits a standard
 * combined message to Meta as a UTILITY template (named parameter {{atualizacoes}}), stores it as the
 * consolidation template and switches joining on for the company's utility notices. Nobody has to
 * write it; the API can still replace the text. Until Meta approves it the notices go out one by one.
 */
export const JOIN_PARAM = "atualizacoes";
export const JOIN_MARKER = `{{${JOIN_PARAM}}}`;
/** Example value Meta requires for the parameter (what the joined updates look like). */
export const JOIN_EXAMPLE = "pagamento aprovado; pedido separado; pedido enviado";
const NAME_PREFIX = "wco_juntar_";
const LANGUAGE = "pt_BR";
const MIN_WAIT_S = 60;
const MIN_PAUSE_S = 30;

export const JoinMessageSchema = z.object({ text: z.string().min(1).max(1024) });

/** The standard combined message, generic enough for orders, appointments and deliveries. */
export const DEFAULT_JOIN_TEXT = `Olá! Temos novidades para você: ${JOIN_MARKER}. Qualquer dúvida, é só responder esta mensagem.`;

/**
 * What would make Meta reject the body, in the words shown to the company: the updates slot exactly
 * once, no other variable, not at the very start or end (Meta refuses dangling parameters), enough
 * text around it, at most 1024 characters.
 */
export function joinMessageProblems(raw: string): string[] {
  const text = raw.trim();
  const problems: string[] = [];
  const marks = text.split(JOIN_MARKER).length - 1;
  if (marks === 0) problems.push("Inclua o lugar onde entram as atualizações.");
  if (marks > 1) problems.push("O lugar das atualizações só pode aparecer uma vez.");
  if (/\{\{|\}\}/.test(text.split(JOIN_MARKER).join(""))) problems.push("Use só o marcador das atualizações, sem outras variáveis.");
  if (marks === 1 && text.startsWith(JOIN_MARKER)) problems.push("Escreva algo antes das atualizações (a Meta não aceita a mensagem começando por elas).");
  if (marks === 1 && text.endsWith(JOIN_MARKER)) problems.push("Escreva algo depois das atualizações (a Meta não aceita a mensagem terminando nelas).");
  const words = text.split(JOIN_MARKER).join(" ").split(/\s+/).filter(Boolean).length;
  if (marks >= 1 && words < 4) problems.push("Escreva um pouco mais de texto em volta das atualizações.");
  if (text.length > 1024) problems.push("A mensagem pode ter no máximo 1024 caracteres.");
  return problems;
}

/** Policies whose notices can be joined into the company's message (same category: utility). */
function joinable(p: { eventType: string; category: string | null; requiresImmediateDelivery: boolean; priority: string }): boolean {
  return p.eventType !== "*" && p.category === "UTILITY" && !p.requiresImmediateDelivery && p.priority !== "CRITICAL";
}

export async function getJoinMessage(ctx: AppContext, tenantId: string) {
  const [policies, wabas] = await Promise.all([ctx.db.optimizationPolicy.findMany({ where: { tenantId } }), ctx.db.waba.count({ where: { tenantId } })]);
  const names = policies.filter((p) => joinable(p) && p.allowAggregation && p.consolidationTemplate).map((p) => p.consolidationTemplate!);
  const name = names.find((n) => n.startsWith(NAME_PREFIX)) ?? names[0] ?? null;
  const template = name ? await ctx.db.template.findFirst({ where: { tenantId, name }, orderBy: { updatedAt: "desc" } }) : null;
  const text = template ? templateText(template.components) : null;
  return {
    connected: wabas > 0,
    current: template
      ? { name: template.name, status: template.status, text, writtenInWco: template.name.startsWith(NAME_PREFIX) && template.consolidationParam === JOIN_PARAM }
      : null,
  };
}

/**
 * After a connection: submits the standard combined message unless joining already has a template
 * that is approved or under review. Best effort: it never undoes a connection.
 */
export async function ensureJoinMessage(ctx: AppContext, actor: Actor): Promise<{ created: boolean; name?: string; error?: string }> {
  try {
    const { current } = await getJoinMessage(ctx, actor.tenantId);
    if (current && (current.status === "APPROVED" || current.status === "PENDING")) return { created: false, name: current.name };
    const r = await submitJoinMessage(ctx, actor, { text: DEFAULT_JOIN_TEXT });
    return { created: true, name: r.current?.name };
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message, tenantId: actor.tenantId }, "standard combined message not submitted");
    return { created: false, error: (e as Error).message };
  }
}

export async function submitJoinMessage(ctx: AppContext, actor: Actor, raw: unknown) {
  const { text: rawText } = JoinMessageSchema.parse(raw);
  const text = rawText.trim();
  const problems = joinMessageProblems(text);
  if (problems.length) throw Errors.validation(problems.join(" "), { problems });

  const tenant = await ctx.tenants.get(actor.tenantId);
  const waba = [...tenant.wabas.values()][0];
  if (!waba) throw Errors.validation("Conecte o WhatsApp da empresa antes de enviar a mensagem para a Meta.");
  const provider = ctx.provider(waba);
  const creds = { accessToken: waba.accessTokenEncrypted ? ctx.vault.decryptSecret(waba.accessTokenEncrypted) : (ctx.config.meta.devCredentials.accessToken ?? "mock-token") };

  const now = ctx.now();
  const name = `${NAME_PREFIX}${now.toISOString().replace(/\D/g, "").slice(0, 14)}`;
  let created;
  try {
    created = await provider.createTemplate(waba.metaWabaId, { name, language: LANGUAGE, category: "UTILITY", body: text, namedParams: [{ name: JOIN_PARAM, example: JOIN_EXAMPLE }] }, creds);
  } catch (e) {
    if (isAppError(e)) throw Errors.validation(`A Meta não aceitou a mensagem: ${e.message}`);
    throw e;
  }

  const status = TEMPLATE_STATUS[created.status.toUpperCase()] ?? "PENDING";
  const category = created.category.toUpperCase();
  await ctx.db.template.upsert({
    where: { tenantId_name_language: { tenantId: actor.tenantId, name, language: LANGUAGE } },
    create: {
      tenantId: actor.tenantId,
      wabaId: waba.id,
      name,
      language: LANGUAGE,
      declaredCategory: "UTILITY",
      metaCategory: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category) ? category : null) as never,
      status,
      components: [{ type: "BODY", text, params: [JOIN_PARAM], parameterFormat: "NAMED" }],
      consolidationParam: JOIN_PARAM,
      externalId: created.id,
      ...(status === "APPROVED" ? { approvedAt: now } : {}),
      ...(status === "REJECTED" ? { rejectedAt: now } : {}),
    },
    update: {},
  });

  const policies = await ctx.db.optimizationPolicy.findMany({ where: { tenantId: actor.tenantId } });
  const switched: string[] = [];
  for (const p of policies.filter(joinable)) {
    await ctx.db.optimizationPolicy.update({
      where: { id: p.id },
      data: { allowAggregation: true, consolidationTemplate: name, maxDelaySeconds: Math.max(p.maxDelaySeconds, MIN_WAIT_S), debounceSeconds: Math.max(p.debounceSeconds, MIN_PAUSE_S) },
    });
    switched.push(p.eventType);
  }

  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "join_message.submitted", entityType: "Template", entityId: name, data: { name, status, metaTemplateId: created.id, eventTypes: switched } });
  await publishTenantChanged(ctx, actor.tenantId);
  return getJoinMessage(ctx, actor.tenantId);
}
