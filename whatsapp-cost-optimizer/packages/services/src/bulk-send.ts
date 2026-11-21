import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAppError } from "@wco/domain";
import { audit } from "./audit";
import type { Actor, AppContext } from "./context";
import { createIntent } from "./intents";

/**
 * "Enviar mensagens": a company without a system of its own sends an approved template to a list of
 * customers from the dashboard. Each customer becomes an ordinary intent, so every saving applies
 * exactly as for a system that calls the API. Done server side so a long list does not hit the API
 * rate limit. Errors are reported by line, never echoing phone numbers back.
 */
export const BULK_MAX = 1000;
export const BULK_EVENT = "painel.envio";

export const BulkSendSchema = z.object({
  template: z.object({ name: z.string().min(1), language: z.string().min(2).optional() }),
  data: z.record(z.string(), z.string().max(1024)).default({}),
  customers: z.array(z.string().min(8).max(32)).min(1).max(BULK_MAX),
  consent: z.object({ optIn: z.literal(true), source: z.string().max(100).default("painel") }),
});

export async function sendBulk(ctx: AppContext, actor: Actor, raw: unknown) {
  const input = BulkSendSchema.parse(raw);
  const batch = randomUUID();
  const seen = new Set<string>();
  const failed: Array<{ line: number; error: string }> = [];
  let accepted = 0;
  let duplicates = 0;
  for (const [i, customer] of input.customers.entries()) {
    const phone = customer.trim();
    if (seen.has(phone)) {
      duplicates++;
      continue;
    }
    seen.add(phone);
    try {
      await createIntent(ctx, actor, {
        customer: phone,
        eventType: BULK_EVENT,
        template: input.template,
        data: input.data,
        consent: input.consent,
        idempotencyKey: `${batch}:${i}`,
      });
      accepted++;
    } catch (e) {
      failed.push({ line: i + 1, error: isAppError(e) ? e.message : "erro inesperado" });
    }
  }
  await audit(ctx.db, { tenantId: actor.tenantId, actor, action: "messages.bulk_sent", entityType: "Template", entityId: input.template.name, data: { batch, total: input.customers.length, accepted, failed: failed.length, duplicates } });
  return { batch, accepted, duplicates, failed };
}
