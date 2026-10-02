import { BUFFERED_STATUSES, MessageKind } from "@wco/domain";
import type { OptimizationPolicyConfig } from "@wco/policy";
import type { FlushMessage, FlushPlan, IntentRecord, OptimizationFeatures, TemplateInfo } from "./types";

/**
 * Consolidation engine (spec §10, §97). At flush time, buffered intents of one group are merged into
 * ONE message only when they are semantically compatible:
 *   - same consolidationKey (same customer + entity + SAME billing category + same consolidation template);
 *   - the consolidation template is registered and APPROVED by Meta (no "magic" templates);
 *   - the merged content fits the template parameter limits (otherwise it is split, never truncated);
 *   - never mixing categories/contexts (an OTP, an order update and a promotion stay separate).
 *
 * Template parameters cannot carry line breaks or tabs (Graph API validation), so merged lines are
 * joined with "; " and the template body provides the layout.
 */
export interface FlushOptions {
  policyFor: (eventType: string) => OptimizationPolicyConfig;
  templateFor: (name: string) => TemplateInfo | undefined;
  features: OptimizationFeatures;
}

export function sanitizeParam(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

/** One-line summary of an intent for a consolidated message (no personal data beyond the payload). */
export function summarize(intent: IntentRecord): string {
  const d = intent.data;
  const pick = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : undefined);
  return sanitizeParam(pick("summary") ?? pick("statusLabel") ?? pick("status") ?? pick("title") ?? intent.eventType);
}

function renderParams(template: TemplateInfo | undefined, data: Record<string, unknown>, overrides: Record<string, string> = {}): Array<{ name: string; value: string }> {
  if (!template) return Object.entries(data).filter(([, v]) => typeof v !== "object").map(([name, v]) => ({ name, value: sanitizeParam(v) }));
  return template.bodyParams.map((name) => ({ name, value: overrides[name] ?? sanitizeParam(data[name]) }));
}

function single(intent: IntentRecord, templateFor: FlushOptions["templateFor"]): FlushMessage {
  const isFreeForm = intent.messageKind === MessageKind.NON_TEMPLATE;
  const template = intent.templateName ? templateFor(intent.templateName) : undefined;
  return {
    primaryIntentId: intent.id,
    coveredIntentIds: [intent.id],
    consolidated: false,
    templateName: isFreeForm ? null : (intent.templateName ?? null),
    messageKind: intent.messageKind,
    category: intent.category,
    parameters: isFreeForm ? [] : renderParams(template, intent.data),
    text: isFreeForm ? (intent.freeFormText ?? summarize(intent)) : null,
    reasons: ["single_message"],
  };
}

export function planFlush(pending: IntentRecord[], opts: FlushOptions): FlushPlan {
  const notes: string[] = [];
  const buffered = pending.filter((i) => BUFFERED_STATUSES.has(i.status)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const groups = new Map<string, IntentRecord[]>();
  const singles: IntentRecord[] = [];
  for (const i of buffered) {
    // A free-form (service) intent is never merged into a template message.
    if (!opts.features.aggregation || !i.consolidationKey || i.messageKind === MessageKind.NON_TEMPLATE) singles.push(i);
    else groups.set(i.consolidationKey, [...(groups.get(i.consolidationKey) ?? []), i]);
  }

  const messages: FlushMessage[] = singles.map((i) => single(i, opts.templateFor));
  const consolidated: FlushPlan["consolidated"] = [];

  for (const [key, members] of groups) {
    if (members.length === 1) {
      messages.push(single(members[0]!, opts.templateFor));
      continue;
    }
    const policy = opts.policyFor(members[members.length - 1]!.eventType);
    const tplName = policy.consolidationTemplate ?? undefined;
    const template = tplName ? opts.templateFor(tplName) : undefined;
    if (!template || !template.approved || !template.consolidationParam) {
      notes.push(`${key}: consolidation template ${tplName ?? "(none)"} unavailable or not approved — sending individually`);
      members.forEach((m) => messages.push(single(m, opts.templateFor)));
      continue;
    }
    if (members.some((m) => m.category !== template.category)) {
      notes.push(`${key}: category mismatch with template ${template.name} — sending individually`);
      members.forEach((m) => messages.push(single(m, opts.templateFor)));
      continue;
    }
    // Chunk by item count and parameter length (never truncate: split instead).
    const maxItems = Math.max(1, policy.maxConsolidatedItems);
    let chunk: IntentRecord[] = [];
    let lines: string[] = [];
    const flush = () => {
      if (chunk.length === 0) return;
      const primary = chunk[chunk.length - 1]!;
      if (chunk.length === 1) {
        messages.push(single(primary, opts.templateFor));
      } else {
        const joined = [...new Set(lines)].join("; ");
        messages.push({
          primaryIntentId: primary.id,
          coveredIntentIds: chunk.map((c) => c.id),
          consolidated: true,
          templateName: template.name,
          messageKind: MessageKind.TEMPLATE,
          category: template.category,
          parameters: renderParams(template, primary.data, { [template.consolidationParam!]: joined }),
          text: null,
          reasons: ["consolidated", `items_${chunk.length}`, "same_category", "approved_template"],
        });
        for (const c of chunk) if (c.id !== primary.id) consolidated.push({ intentId: c.id, into: primary.id });
      }
      chunk = [];
      lines = [];
    };
    for (const m of members) {
      const line = summarize(m);
      const projected = [...new Set([...lines, line])].join("; ");
      if (chunk.length >= maxItems || projected.length > template.maxParamLength) flush();
      chunk.push(m);
      lines.push(line);
    }
    flush();
  }

  return { messages, consolidated, notes };
}
