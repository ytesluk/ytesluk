import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { AlertSeverity, AlertType, Errors, type WcoEventType } from "@wco/domain";
import { metrics } from "@wco/logging";
import { audit, raiseAlert } from "./audit";
import { publishTenantChanged, type Actor, type AppContext, type TenantConfig } from "./context";
import { QUEUE, type OutboundWebhookJob } from "./queues";

/**
 * Outbound webhooks: HTTP POSTs from the WCO to endpoints the tenant configured.
 *
 *   MIRROR ("mirrorWebhookUrls") — a copy of the Meta webhooks of the tenant's OWN WABAs, so the CRM
 *     or helpdesk that used to receive them from a BSP keeps working when the WABA is connected
 *     directly to the Cloud API through the WCO. Only the entries of that tenant's WABAs are sent.
 *   EVENTS — WCO events (e.g. INBOUND_WAKEUP_REQUESTED) for the tenant's other channels.
 *
 * Delivery: asynchronous (queue), retried with exponential backoff, dead-lettered with an alert.
 * Signed with HMAC-SHA256 over the exact body when a secret is set. Secrets are stored encrypted and
 * never returned by the API. The payload is the tenant's own data and goes only to its endpoints.
 */
export const MIRROR_FIELDS = ["messages", "template_category_update", "message_template_status_update", "account_update", "user_preferences"] as const;
const MAX_ENDPOINTS_PER_KIND = 5;

export const OutboundWebhookSchema = z.object({
  kind: z.enum(["MIRROR", "EVENTS"]),
  url: z.string().url().max(2000),
  secret: z.string().min(16).max(200).optional().describe("HMAC-SHA256 signing secret (stored encrypted, never returned)"),
  authHeader: z.string().min(1).max(500).optional().describe("Value sent as the Authorization header (stored encrypted)"),
  fields: z.array(z.enum(MIRROR_FIELDS)).default([]).describe("MIRROR only: Meta webhook fields to forward; empty = all"),
  enabled: z.boolean().default(true),
});

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Loopback, private, link-local and unique-local addresses (never a valid webhook target in production). */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(a) === 4) return PRIVATE_V4.some((r) => r.test(a));
  if (isIP(a) === 6) return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || (a.startsWith("::ffff:") && isPrivateAddress(a.slice(7)));
  return false;
}

/**
 * Static checks of a target URL. In production: HTTPS only, no credentials in the URL, no
 * localhost/private addresses (SSRF). Development accepts http://localhost so the flow can be tested.
 */
export function assertSafeWebhookUrl(raw: string, opts: { production: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Errors.validation("URL de webhook inválida");
  }
  if (url.username || url.password) throw Errors.validation("A URL do webhook não pode conter usuário/senha");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !opts.production)) throw Errors.validation("O webhook precisa usar HTTPS");
  if (opts.production) {
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || isPrivateAddress(host)) {
      throw Errors.validation("O webhook precisa apontar para um endereço público");
    }
  }
  return url;
}

/** DNS check at delivery time: a public name must not resolve to a private address. */
async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error("webhook host resolves to a private address");
}

export function signOutbound(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const view = (r: { id: string; kind: string; url: string; fields: string[]; enabled: boolean; secretEncrypted: string | null; authHeaderEncrypted: string | null; lastStatus: number | null; lastDeliveredAt: Date | null; lastError: string | null; consecutiveFailures: number; createdAt: Date }) => ({
  id: r.id,
  kind: r.kind,
  url: r.url,
  fields: r.fields,
  enabled: r.enabled,
  hasSecret: !!r.secretEncrypted,
  hasAuthHeader: !!r.authHeaderEncrypted,
  lastStatus: r.lastStatus,
  lastDeliveredAt: r.lastDeliveredAt,
  lastError: r.lastError,
  consecutiveFailures: r.consecutiveFailures,
  createdAt: r.createdAt,
});

export async function listOutboundWebhooks(ctx: AppContext, tenantId: string) {
  const rows = await ctx.db.outboundWebhook.findMany({ where: { tenantId }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
  return { webhooks: rows.map(view), mirrorFields: MIRROR_FIELDS, signature: "X-WCO-Signature-256: sha256=HMAC-SHA256(body, secret)" };
}

export async function upsertOutboundWebhook(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = OutboundWebhookSchema.parse(raw);
  const url = assertSafeWebhookUrl(input.url, { production: ctx.config.isProduction }).toString();
  const existing = await ctx.db.outboundWebhook.findFirst({ where: { tenantId: actor.tenantId, kind: input.kind, url } });
  if (!existing && (await ctx.db.outboundWebhook.count({ where: { tenantId: actor.tenantId, kind: input.kind } })) >= MAX_ENDPOINTS_PER_KIND) {
    throw Errors.validation(`Limite de ${MAX_ENDPOINTS_PER_KIND} endpoints do tipo ${input.kind}`);
  }
  const data = {
    fields: input.kind === "MIRROR" ? input.fields : [],
    enabled: input.enabled,
    ...(input.secret !== undefined ? { secretEncrypted: ctx.vault.encryptSecret(input.secret) } : {}),
    ...(input.authHeader !== undefined ? { authHeaderEncrypted: ctx.vault.encryptSecret(input.authHeader) } : {}),
  };
  const row = existing
    ? await ctx.db.outboundWebhook.update({ where: { id: existing.id }, data: { ...data, consecutiveFailures: 0, lastError: null } })
    : await ctx.db.outboundWebhook.create({ data: { tenantId: actor.tenantId, kind: input.kind, url, ...data } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: existing ? "webhook.outbound.updated" : "webhook.outbound.created", entityType: "OutboundWebhook", entityId: row.id, data: { kind: input.kind, host: new URL(url).host, fields: data.fields, signed: !!row.secretEncrypted } });
  await publishTenantChanged(ctx, actor.tenantId);
  return view(row);
}

export async function deleteOutboundWebhook(ctx: AppContext, actor: Actor, id: string) {
  const row = await ctx.db.outboundWebhook.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw Errors.notFound("Webhook");
  await ctx.db.outboundWebhook.delete({ where: { id: row.id } });
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "webhook.outbound.deleted", entityType: "OutboundWebhook", entityId: row.id, data: { kind: row.kind, host: new URL(row.url).host } });
  await publishTenantChanged(ctx, actor.tenantId);
  return { deleted: true };
}

/**
 * The part of a raw Meta payload that belongs to one tenant: only the entries of its WABAs and, when
 * the endpoint asked for specific fields, only those changes. Null when nothing is left.
 */
export function payloadForTenant(raw: unknown, metaWabaIds: Set<string>, fields: string[]): Record<string, unknown> | null {
  const p = raw as { object?: unknown; entry?: unknown };
  if (!p || typeof p !== "object" || !Array.isArray(p.entry)) return null;
  const want = fields.length ? new Set(fields) : null;
  const entry = (p.entry as Array<{ id?: unknown; changes?: unknown }>)
    .filter((e) => typeof e.id === "string" && metaWabaIds.has(e.id))
    .map((e) => ({ ...e, changes: (Array.isArray(e.changes) ? (e.changes as Array<{ field?: unknown }>) : []).filter((c) => !want || (typeof c.field === "string" && want.has(c.field))) }))
    .filter((e) => e.changes.length > 0);
  return entry.length ? { object: p.object, entry } : null;
}

/** Queues one delivery per MIRROR endpoint of the tenant for a persisted Meta webhook. */
export async function fanOutMetaWebhook(ctx: AppContext, tenant: TenantConfig, webhookEventId: string): Promise<number> {
  for (const hook of tenant.mirrorWebhookUrls) {
    const job: OutboundWebhookJob = { tenantId: tenant.id, endpointId: hook.id, webhookEventId };
    // Same job id on a webhook retry: the copy is sent once.
    await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].add("mirror", job, { jobId: `mirror-${webhookEventId}-${hook.id}` });
  }
  return tenant.mirrorWebhookUrls.length;
}

/** Queues a WCO event for every EVENTS endpoint of the tenant. Returns how many endpoints will receive it. */
export async function emitWcoEvent(ctx: AppContext, tenant: TenantConfig, type: WcoEventType, data: Record<string, unknown>, opts: { dedupKey?: string } = {}): Promise<number> {
  const event = { id: randomUUID(), type, occurredAt: ctx.now().toISOString(), data };
  for (const hook of tenant.eventWebhookUrls) {
    const job: OutboundWebhookJob = { tenantId: tenant.id, endpointId: hook.id, event };
    await ctx.queues[QUEUE.OUTBOUND_WEBHOOK].add("event", job, opts.dedupKey ? { jobId: `event-${opts.dedupKey}-${hook.id}` } : {});
  }
  return tenant.eventWebhookUrls.length;
}

/** Worker: performs one delivery. Throws on failure so the queue retries with backoff. */
export async function deliverOutboundWebhook(ctx: AppContext, job: OutboundWebhookJob, opts: { finalAttempt: boolean; fetchImpl?: typeof fetch }): Promise<{ status: string }> {
  const hook = await ctx.db.outboundWebhook.findFirst({ where: { id: job.endpointId, tenantId: job.tenantId } });
  if (!hook || !hook.enabled) return { status: "skipped:disabled" };
  let payload: Record<string, unknown> | null;
  let eventName: string;
  if (job.webhookEventId) {
    const [row, wabas] = await Promise.all([
      ctx.db.webhookEvent.findUnique({ where: { id: job.webhookEventId }, select: { rawPayload: true } }),
      ctx.db.waba.findMany({ where: { tenantId: job.tenantId }, select: { metaWabaId: true } }),
    ]);
    payload = row?.rawPayload ? payloadForTenant(row.rawPayload, new Set(wabas.map((w) => w.metaWabaId)), hook.fields) : null;
    eventName = "meta.webhook";
  } else {
    payload = job.event ? { ...job.event, tenantId: job.tenantId } : null;
    eventName = job.event?.type ?? "unknown";
  }
  if (!payload) return { status: "skipped:nothing_to_send" };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "WCO-Webhooks/1", "X-WCO-Event": eventName };
  if (hook.secretEncrypted) {
    const signature = signOutbound(body, ctx.vault.decryptSecret(hook.secretEncrypted));
    headers["X-WCO-Signature-256"] = signature;
    // Same scheme and header Meta uses, so receivers that verify Meta's signature can use this secret.
    if (hook.kind === "MIRROR") headers["X-Hub-Signature-256"] = signature;
  }
  if (hook.authHeaderEncrypted) headers.Authorization = ctx.vault.decryptSecret(hook.authHeaderEncrypted);

  const now = ctx.now();
  try {
    const url = assertSafeWebhookUrl(hook.url, { production: ctx.config.isProduction });
    if (ctx.config.isProduction) await assertPublicHost(url);
    // Redirects are not followed: a redirect could point the POST (and its payload) somewhere else.
    const res = await (opts.fetchImpl ?? fetch)(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`endpoint answered ${res.status}`), { httpStatus: res.status });
    await ctx.db.outboundWebhook.update({ where: { id: hook.id }, data: { lastStatus: res.status, lastDeliveredAt: now, lastError: null, consecutiveFailures: 0 } });
    metrics.outboundWebhooks.inc({ kind: hook.kind, outcome: "delivered" });
    return { status: "delivered" };
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await ctx.db.outboundWebhook.update({ where: { id: hook.id }, data: { lastStatus: (e as { httpStatus?: number }).httpStatus ?? null, lastError: message, consecutiveFailures: { increment: 1 } } });
    metrics.outboundWebhooks.inc({ kind: hook.kind, outcome: opts.finalAttempt ? "dead" : "retry" });
    if (opts.finalAttempt) {
      await raiseAlert(ctx.db, {
        tenantId: job.tenantId,
        type: AlertType.WEBHOOK_FAILURE,
        severity: AlertSeverity.WARNING,
        title: "Falha ao entregar webhook ao seu sistema",
        message: `O endpoint ${new URL(hook.url).host} (${hook.kind}) não aceitou a entrega após várias tentativas: ${message}`,
        dedupKey: `outbound-webhook:${hook.id}:${now.toISOString().slice(0, 13)}`,
      });
    }
    throw e;
  }
}
