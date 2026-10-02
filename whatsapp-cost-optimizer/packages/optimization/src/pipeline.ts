import {
  BillingCategory,
  DecisionAction,
  EntryPointType,
  MessageKind,
  MessageStatus,
  Money,
  PricingStatus,
  Priority,
  VerificationStatus,
  addSeconds,
  billingMonth,
  localDate,
  payloadHash as hashPayload,
  resolveMarket,
  type ConversationContext,
  type Decimal,
} from "@wco/domain";
import type { CostDecision, CostEngine } from "@wco/pricing";
import { resolvePolicy, type OptimizationPolicyConfig, type PolicyEngine } from "@wco/policy";
import { extendDebounce, nextFlushTime, selectFlushSet, type BufferedEntry } from "./buffer";
import { planFlush } from "./consolidation";
import { decide } from "./decision-engine";
import { hashUniform, MinHeap } from "./heap";
import { consolidationKey, eventHash, groupKey, supersessionKey } from "./keys";
import { priceAt } from "./scheduler";
import type { ConsentState, FlushMessage, IntentRecord, OptimizationDecision, OptimizationFeatures, PricingCounters, TemplateInfo } from "./types";

/**
 * In-memory implementation of the WCO pipeline with a VIRTUAL CLOCK (discrete-event simulation).
 * It runs exactly the same decision engine, scheduler, buffer and consolidation code as the
 * production worker; only persistence and the provider are replaced. Used by unit tests (spec §41
 * cases 1–4) and by the academic simulator (spec §39–40, §77).
 */
export interface PipelineHooks {
  onDecision?(intent: IntentRecord, decision: OptimizationDecision, at: Date): void;
  onAvoided?(intent: IntentRecord, status: MessageStatus, baseline: CostDecision | null, at: Date): void;
  onDispatch?(primary: IntentRecord, message: FlushMessage, estimated: CostDecision, at: Date, willDeliver: boolean): void;
  onDelivery?(primary: IntentRecord, realized: CostDecision, at: Date): void;
}

export interface PipelineConfig {
  hooks?: PipelineHooks;
  tenantId: string;
  timezone: string;
  currency: string;
  engine: CostEngine;
  rules: PolicyEngine;
  policies: OptimizationPolicyConfig[];
  templates: TemplateInfo[];
  features: OptimizationFeatures;
  requireOptIn?: boolean;
  /** Probability (0..1) that a dispatched message is delivered (deterministic per message). */
  deliveryRate?: number;
  deliveryLatencySeconds?: number;
  authInternationalEligible?: boolean;
  explain?: boolean;
  recordDecisions?: boolean;
  /** Drop dispatched intents older than this from memory (0 = keep everything). */
  retentionSeconds?: number;
}

export interface IntentSubmission {
  id?: string;
  idempotencyKey?: string;
  customerKey: string;
  recipient: string;
  phoneNumberId: string;
  eventType: string;
  businessEntityId?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
  priority?: Priority;
  maxDelaySeconds?: number;
  mustSendImmediately?: boolean;
  category?: BillingCategory;
  messageKind?: MessageKind;
  templateName?: string | null;
  freeFormText?: string | null;
  earliestSendAt?: Date;
  preferredSendAt?: Date;
  optimization?: { allowDeduplication?: boolean; allowAggregation?: boolean; allowSupersession?: boolean };
}

export interface CategoryStats {
  dispatched: number;
  delivered: number;
  paid: number;
  free: number;
  realizedCost: Decimal;
}

export interface PipelineReport {
  intents: number;
  byStatus: Record<string, number>;
  messagesDispatched: number;
  messagesDelivered: number;
  messagesFailed: number;
  consolidatedMessages: number;
  deduplicated: number;
  superseded: number;
  consolidatedIntents: number;
  blocked: number;
  cancelled: number;
  estimatedCost: Decimal;
  realizedCost: Decimal;
  avoidedBaselineEstimate: Decimal;
  free: { entryPoint: number; customerServiceWindow: number; quota: number; notBillable: number };
  paidMessages: number;
  unknownPricing: number;
  byCategory: Record<string, CategoryStats>;
  tiers: Record<string, number>;
  daily: Record<string, { dispatched: number; delivered: number; cost: Decimal }>;
  policyVersions: Record<string, number>;
  rateCards: Record<string, number>;
}

type SimEvent =
  | { kind: "FLUSH"; at: number; seq: number; group: string }
  | { kind: "DISPATCH"; at: number; seq: number; intentId: string }
  | { kind: "DELIVERY"; at: number; seq: number; msg: InFlight };

interface InFlight {
  id: string;
  primary: IntentRecord;
  covered: string[];
  messageKind: MessageKind;
  category: BillingCategory;
  sentAt: Date;
  estimated: CostDecision;
}

const ZERO = () => new Money(0) as Decimal;

export class InMemoryPipeline {
  readonly cfg: Required<Omit<PipelineConfig, "authInternationalEligible" | "hooks">> & { authInternationalEligible: boolean; hooks?: PipelineHooks };
  private now: Date = new Date(0);
  private seq = 0;
  private readonly heap = new MinHeap<SimEvent>((a, b) => a.at < b.at || (a.at === b.at && a.seq < b.seq));
  private readonly groups = new Map<string, IntentRecord[]>();
  private readonly buffer = new Map<string, BufferedEntry[]>();
  private readonly idempotency = new Map<string, string>();
  private readonly byId = new Map<string, IntentRecord>();
  private readonly conversations = new Map<string, ConversationContext>();
  private readonly consents = new Map<string, Partial<ConsentState>>();
  private readonly estQuota = new Map<string, number>();
  private readonly estTier = new Map<string, number>();
  private readonly realQuota = new Map<string, number>();
  private readonly realTier = new Map<string, number>();
  private readonly templates: Map<string, TemplateInfo>;
  private idSeq = 0;
  private processed = 0;
  readonly decisions: OptimizationDecision[] = [];
  readonly report: PipelineReport;

  constructor(cfg: PipelineConfig) {
    this.cfg = {
      requireOptIn: false,
      deliveryRate: 1,
      deliveryLatencySeconds: 2,
      explain: false,
      recordDecisions: false,
      retentionSeconds: 0,
      authInternationalEligible: false,
      ...cfg,
    } as InMemoryPipeline["cfg"];
    this.templates = new Map(cfg.templates.map((t) => [t.name, t]));
    this.report = {
      intents: 0,
      byStatus: {},
      messagesDispatched: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      consolidatedMessages: 0,
      deduplicated: 0,
      superseded: 0,
      consolidatedIntents: 0,
      blocked: 0,
      cancelled: 0,
      estimatedCost: ZERO(),
      realizedCost: ZERO(),
      avoidedBaselineEstimate: ZERO(),
      free: { entryPoint: 0, customerServiceWindow: 0, quota: 0, notBillable: 0 },
      paidMessages: 0,
      unknownPricing: 0,
      byCategory: {},
      tiers: {},
      daily: {},
      policyVersions: {},
      rateCards: {},
    };
  }

  // ------------------------------------------------------------------ public API

  get clock(): Date {
    return this.now;
  }

  get(id: string): IntentRecord | undefined {
    return this.byId.get(id);
  }

  setConsent(customerKey: string, consent: Partial<ConsentState>): void {
    this.consents.set(customerKey, { ...(this.consents.get(customerKey) ?? {}), ...consent });
  }

  /** A user message/call (opens or resets the customer service window; may be a free entry point). */
  inbound(customerKey: string, phoneNumberId: string, at: Date, entryPoint?: EntryPointType): void {
    this.advance(at);
    const conv = this.conversation(phoneNumberId, customerKey);
    conv.customerServiceWindow = { lastInboundAt: at };
    if (entryPoint && entryPoint !== EntryPointType.OTHER) {
      const fep = conv.freeEntryPoint;
      const open = fep?.windowStartedAt && at < addSeconds(fep.windowStartedAt, 72 * 3600);
      if (!open) {
        conv.freeEntryPoint = {
          type: entryPoint,
          userMessageAt: at,
          firstBusinessReplyAt: null,
          windowStartedAt: null,
          confirmedExpiresAt: null,
          verification: VerificationStatus.ESTIMATED,
        };
      }
    }
  }

  submit(sub: IntentSubmission, at: Date): IntentRecord {
    this.advance(at);
    const idem = sub.idempotencyKey;
    if (idem) {
      const existing = this.idempotency.get(idem);
      if (existing) {
        const rec = this.byId.get(existing);
        if (rec) return rec;
      }
    }
    const policy = resolvePolicy(sub.eventType, this.cfg.policies);
    const id = sub.id ?? `int_${++this.idSeq}`;
    const data = sub.data ?? {};
    const category = sub.category ?? policy.category ?? BillingCategory.UTILITY;
    const messageKind = sub.messageKind ?? (category === BillingCategory.SERVICE ? MessageKind.NON_TEMPLATE : MessageKind.TEMPLATE);
    const templateName = messageKind === MessageKind.TEMPLATE ? (sub.templateName ?? policy.defaultTemplate ?? null) : null;
    const g = groupKey(this.cfg.tenantId, sub.phoneNumberId, sub.customerKey, sub.businessEntityId ?? null);
    const pHash = hashPayload(data);
    const maxDelay = sub.maxDelaySeconds ?? policy.maxDelaySeconds;
    const earliest = sub.earliestSendAt ?? at;
    const allowDedup = sub.optimization?.allowDeduplication ?? policy.allowDeduplication;
    const allowAgg = sub.optimization?.allowAggregation ?? policy.allowAggregation;
    const allowSup = sub.optimization?.allowSupersession ?? policy.allowSupersession;
    const rec: IntentRecord = {
      id,
      tenantId: this.cfg.tenantId,
      customerKey: sub.customerKey,
      recipient: sub.recipient,
      market: resolveMarket(sub.recipient, localDate(at, this.cfg.timezone)).market,
      phoneNumberId: sub.phoneNumberId,
      businessEntityId: sub.businessEntityId ?? null,
      eventType: sub.eventType,
      payloadHash: pHash,
      eventHash: eventHash({ eventType: sub.eventType, businessEntityId: sub.businessEntityId ?? null, payloadHash: pHash, customerKey: sub.customerKey, phoneNumberId: sub.phoneNumberId, templateName }),
      idempotencyKey: idem ?? id,
      occurredAt: sub.occurredAt ?? at,
      requestedAt: at,
      earliestSendAt: earliest,
      preferredSendAt: sub.preferredSendAt ?? earliest,
      deadlineAt: addSeconds(sub.preferredSendAt && sub.preferredSendAt > earliest ? sub.preferredSendAt : earliest, maxDelay),
      status: MessageStatus.PENDING_OPTIMIZATION,
      priority: sub.priority ?? policy.priority,
      maxDelaySeconds: maxDelay,
      mustSendImmediately: sub.mustSendImmediately ?? false,
      allowDeduplication: allowDedup,
      allowAggregation: allowAgg,
      allowSupersession: allowSup,
      category,
      messageKind,
      templateName,
      templateLanguage: policy.defaultLanguage ?? "pt_BR",
      freeFormText: sub.freeFormText ?? null,
      data,
      groupKey: g,
      supersessionKey: supersessionKey(g, sub.eventType, policy, allowSup),
      consolidationKey: consolidationKey(g, category, policy, allowAgg),
    };
    this.idempotency.set(rec.idempotencyKey, id);
    this.byId.set(id, rec);
    const group = this.groups.get(g) ?? [];
    group.push(rec);
    this.groups.set(g, group);
    this.report.intents++;
    this.count(MessageStatus.PENDING_OPTIMIZATION, +1);

    const consentOverride = this.consents.get(sub.customerKey) ?? {};
    const consent: ConsentState = {
      requireOptIn: this.cfg.requireOptIn,
      optedIn: consentOverride.optedIn ?? true,
      optedOut: consentOverride.optedOut ?? false,
      marketingOptedOut: consentOverride.marketingOptedOut ?? false,
    };
    const decisionInput = {
      intent: rec,
      policy,
      now: at,
      related: group,
      consent,
      conversation: this.conversation(sub.phoneNumberId, sub.customerKey),
      pricing: this.pricingInputs(),
      rules: this.cfg.rules,
      features: this.cfg.features,
      explain: this.cfg.explain,
    };
    const decision = decide(decisionInput);
    if (this.cfg.recordDecisions) this.decisions.push(decision);
    this.cfg.hooks?.onDecision?.(rec, decision, at);
    this.apply(rec, decision, at);
    this.maybeSweep();
    return rec;
  }

  /** Processes all events up to `to` (flushes, deliveries). */
  advance(to: Date): void {
    if (to < this.now) to = this.now;
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.at > to.getTime()) break;
      this.heap.pop();
      this.now = new Date(top.at);
      if (top.kind === "FLUSH") this.flushGroup(top.group, this.now);
      else if (top.kind === "DISPATCH") this.dispatchScheduled(top.intentId, this.now);
      else this.deliver(top.msg, this.now);
    }
    this.now = to;
  }

  /** Runs the clock until no events are left. */
  drain(): PipelineReport {
    for (;;) {
      const top = this.heap.peek();
      if (!top) break;
      this.advance(new Date(top.at));
    }
    return this.report;
  }

  // ------------------------------------------------------------------ internals

  private conversation(phoneNumberId: string, customerKey: string): ConversationContext {
    const k = `${phoneNumberId}:${customerKey}`;
    let c = this.conversations.get(k);
    if (!c) {
      c = { customerServiceWindow: { lastInboundAt: null }, freeEntryPoint: null };
      this.conversations.set(k, c);
    }
    return c;
  }

  private counters(estimate: boolean): PricingCounters {
    const quota = estimate ? this.estQuota : this.realQuota;
    const tier = estimate ? this.estTier : this.realTier;
    return {
      quotaUsed: (phoneNumberId, month) => quota.get(`${phoneNumberId}|${month}`) ?? 0,
      tierPosition: (market, category, month) => tier.get(`${market}|${category}|${month}`) ?? 0,
    };
  }

  private pricingInputs(estimate = true) {
    return {
      engine: this.cfg.engine,
      counters: this.counters(estimate),
      timezone: this.cfg.timezone,
      currency: this.cfg.currency,
      quotaUsed: 0,
      tierPosition: 0,
      authInternationalEligible: this.cfg.authInternationalEligible,
    };
  }

  private count(status: string, delta: number): void {
    this.report.byStatus[status] = (this.report.byStatus[status] ?? 0) + delta;
  }

  private setStatus(rec: IntentRecord, status: MessageStatus): void {
    if (rec.status === status) return;
    this.count(rec.status, -1);
    this.count(status, +1);
    rec.status = status;
  }

  private push(ev: { kind: "FLUSH"; at: number; group: string } | { kind: "DISPATCH"; at: number; intentId: string } | { kind: "DELIVERY"; at: number; msg: InFlight }): void {
    this.heap.push({ ...ev, seq: ++this.seq } as SimEvent);
  }

  private apply(rec: IntentRecord, d: OptimizationDecision, at: Date): void {
    rec.messageKind = d.messageKind;
    rec.category = d.category;
    if (d.messageKind === MessageKind.NON_TEMPLATE) rec.templateName = null;
    for (const id of d.supersedes) {
      const old = this.byId.get(id);
      if (!old) continue;
      this.setStatus(old, MessageStatus.SUPERSEDED);
      this.report.superseded++;
      this.removeFromBuffer(old);
      this.addAvoided(old, at);
    }
    switch (d.action) {
      case DecisionAction.SEND_NOW:
        this.setStatus(rec, MessageStatus.READY_TO_SEND);
        if (d.sendAt && d.sendAt > at) this.push({ kind: "DISPATCH", at: d.sendAt.getTime(), intentId: rec.id });
        else this.dispatch(this.singleMessage(rec, d.reasons), at);
        break;
      case DecisionAction.DELAY:
      case DecisionAction.CONSOLIDATE: {
        this.setStatus(rec, MessageStatus.DELAYED);
        const flushAt = d.sendAt ?? at;
        const windowDriven = d.reasons.some((r) => r.startsWith("before_"));
        const entry: BufferedEntry = { intent: rec, flushAt, hardDeadline: windowDriven ? flushAt : d.effectiveDeadline };
        const entries = this.buffer.get(rec.groupKey) ?? [];
        for (const u of extendDebounce(entries, entry)) {
          const e = entries.find((x) => x.intent.id === u.id);
          if (e) e.flushAt = u.flushAt;
        }
        entries.push(entry);
        this.buffer.set(rec.groupKey, entries);
        const next = nextFlushTime(entries);
        if (next) this.push({ kind: "FLUSH", at: next.getTime(), group: rec.groupKey });
        break;
      }
      case DecisionAction.SUPPRESS_DUPLICATE:
        this.setStatus(rec, MessageStatus.DEDUPLICATED);
        this.report.deduplicated++;
        this.addAvoided(rec, at, d.baselineCost ?? undefined);
        break;
      case DecisionAction.SUPERSEDE:
        this.setStatus(rec, MessageStatus.SUPERSEDED);
        this.report.superseded++;
        this.addAvoided(rec, at, d.baselineCost ?? undefined);
        break;
      case DecisionAction.BLOCK:
        this.setStatus(rec, MessageStatus.BLOCKED);
        this.report.blocked++;
        break;
      case DecisionAction.CANCEL:
        this.setStatus(rec, MessageStatus.CANCELLED);
        this.report.cancelled++;
        break;
    }
  }

  private singleMessage(rec: IntentRecord, reasons: string[]): FlushMessage {
    return { primaryIntentId: rec.id, coveredIntentIds: [rec.id], consolidated: false, templateName: rec.templateName ?? null, messageKind: rec.messageKind, category: rec.category, parameters: [], text: rec.freeFormText ?? null, reasons };
  }

  private dispatchScheduled(intentId: string, at: Date): void {
    const rec = this.byId.get(intentId);
    if (!rec || rec.status !== MessageStatus.READY_TO_SEND) return;
    this.dispatch(this.singleMessage(rec, ["scheduled_by_client"]), at);
  }

  private addAvoided(rec: IntentRecord, at: Date, baseline?: CostDecision): void {
    const b: CostDecision = baseline ?? priceAt(rec, at < rec.preferredSendAt ? rec.preferredSendAt : at, rec.messageKind, rec.category, this.conversation(rec.phoneNumberId, rec.customerKey), this.pricingInputs(), false, "BASELINE");
    if (b.pricingStatus !== PricingStatus.UNKNOWN && b.pricingStatus !== PricingStatus.NOT_ELIGIBLE) {
      this.report.avoidedBaselineEstimate = this.report.avoidedBaselineEstimate.plus(b.estimatedCost);
    }
    this.cfg.hooks?.onAvoided?.(rec, rec.status, b, at);
  }

  private removeFromBuffer(rec: IntentRecord): void {
    const entries = this.buffer.get(rec.groupKey);
    if (!entries) return;
    const idx = entries.findIndex((e) => e.intent.id === rec.id);
    if (idx >= 0) entries.splice(idx, 1);
    if (entries.length === 0) this.buffer.delete(rec.groupKey);
  }

  private flushGroup(group: string, at: Date): void {
    const entries = this.buffer.get(group);
    if (!entries || entries.length === 0) return;
    const next = nextFlushTime(entries);
    if (!next || next > at) return; // stale timer
    const { due, partners } = selectFlushSet(entries, at);
    const set = [...due, ...partners].map((e) => e.intent);
    const plan = planFlush(set, {
      policyFor: (t) => resolvePolicy(t, this.cfg.policies),
      templateFor: (n) => this.templates.get(n),
      features: this.cfg.features,
    });
    for (const e of [...due, ...partners]) this.removeFromBuffer(e.intent);
    for (const c of plan.consolidated) {
      const r = this.byId.get(c.intentId);
      if (r) {
        this.setStatus(r, MessageStatus.CONSOLIDATED);
        this.report.consolidatedIntents++;
        this.addAvoided(r, at);
      }
    }
    for (const m of plan.messages) this.dispatch(m, at);
    const remaining = this.buffer.get(group);
    if (remaining && remaining.length > 0) {
      const n = nextFlushTime(remaining);
      if (n) this.push({ kind: "FLUSH", at: Math.max(n.getTime(), at.getTime()), group });
    }
  }

  private dispatch(m: FlushMessage, at: Date): void {
    const primary = this.byId.get(m.primaryIntentId);
    if (!primary) return;
    const conv = this.conversation(primary.phoneNumberId, primary.customerKey);
    const estimated = priceAt(primary, at, m.messageKind, m.category, conv, this.pricingInputs(true), false);
    if (estimated.pricingStatus === PricingStatus.NOT_ELIGIBLE) {
      // e.g. a buffered free-form message whose window closed: never send it.
      this.setStatus(primary, MessageStatus.CANCELLED);
      this.report.cancelled++;
      return;
    }
    this.setStatus(primary, MessageStatus.SENT);
    primary.sentAt = at;
    this.report.messagesDispatched++;
    if (m.consolidated) this.report.consolidatedMessages++;
    this.report.estimatedCost = this.report.estimatedCost.plus(estimated.estimatedCost);
    const month = billingMonth(at, this.cfg.timezone);
    if (estimated.pricingStatus === PricingStatus.QUOTA) inc(this.estQuota, `${primary.phoneNumberId}|${month}`);
    if (estimated.eligibility.countsTowardTier) inc(this.estTier, `${estimated.market}|${estimated.category}|${month}`);
    // The first business reply after a free entry point opens the FEP window (starting at the reply).
    const fep = conv.freeEntryPoint;
    if (fep && !fep.windowStartedAt && estimated.eligibility.windows.freeEntryPoint.opensOnThisMessage) {
      fep.firstBusinessReplyAt = at;
      fep.windowStartedAt = at;
    }
    const day = localDate(at, this.cfg.timezone);
    const d = (this.report.daily[day] ??= { dispatched: 0, delivered: 0, cost: ZERO() });
    d.dispatched++;
    const cat = (this.report.byCategory[m.category] ??= { dispatched: 0, delivered: 0, paid: 0, free: 0, realizedCost: ZERO() });
    cat.dispatched++;
    const delivered = hashUniform(primary.id, 7) < this.cfg.deliveryRate;
    this.cfg.hooks?.onDispatch?.(primary, m, estimated, at, delivered);
    if (!delivered) {
      this.report.messagesFailed++;
      this.setStatus(primary, MessageStatus.FAILED);
      return;
    }
    this.push({
      kind: "DELIVERY",
      at: at.getTime() + this.cfg.deliveryLatencySeconds * 1000,
      msg: { id: primary.id, primary, covered: m.coveredIntentIds, messageKind: m.messageKind, category: m.category, sentAt: at, estimated },
    });
  }

  private deliver(msg: InFlight, at: Date): void {
    const conv = this.conversation(msg.primary.phoneNumberId, msg.primary.customerKey);
    const realized = priceAt(msg.primary, at, msg.messageKind, msg.category, conv, this.pricingInputs(false), false, "REALIZED");
    this.setStatus(msg.primary, MessageStatus.DELIVERED);
    this.report.messagesDelivered++;
    this.cfg.hooks?.onDelivery?.(msg.primary, realized, at);
    const month = realized.eligibility.billingMonth;
    const r = this.report;
    r.policyVersions[realized.policyVersion ?? "none"] = (r.policyVersions[realized.policyVersion ?? "none"] ?? 0) + 1;
    if (realized.rateCardId) r.rateCards[realized.rateCardId] = (r.rateCards[realized.rateCardId] ?? 0) + 1;
    const cat = (r.byCategory[msg.category] ??= { dispatched: 0, delivered: 0, paid: 0, free: 0, realizedCost: ZERO() });
    cat.delivered++;
    const day = localDate(at, this.cfg.timezone);
    const d = (r.daily[day] ??= { dispatched: 0, delivered: 0, cost: ZERO() });
    d.delivered++;
    switch (realized.pricingStatus) {
      case PricingStatus.FREE:
        cat.free++;
        if (realized.freeReason === "free_entry_point_window") r.free.entryPoint++;
        else if (realized.freeReason === "customer_service_window") r.free.customerServiceWindow++;
        else r.free.notBillable++;
        break;
      case PricingStatus.QUOTA:
        cat.free++;
        r.free.quota++;
        inc(this.realQuota, `${msg.primary.phoneNumberId}|${month}`);
        break;
      case PricingStatus.PAID: {
        cat.paid++;
        r.paidMessages++;
        cat.realizedCost = cat.realizedCost.plus(realized.estimatedCost);
        r.realizedCost = r.realizedCost.plus(realized.estimatedCost);
        d.cost = d.cost.plus(realized.estimatedCost);
        if (realized.eligibility.countsTowardTier) {
          inc(this.realTier, `${realized.market}|${realized.category}|${month}`);
          const label = realized.tier ?? "List rate";
          const key = `${realized.market}|${realized.category}|${label}`;
          r.tiers[key] = (r.tiers[key] ?? 0) + 1;
        }
        break;
      }
      default:
        r.unknownPricing++;
    }
  }

  private maybeSweep(): void {
    const keep = this.cfg.retentionSeconds;
    if (!keep || ++this.processed % 20_000 !== 0) return;
    const cutoff = this.now.getTime() - keep * 1000;
    for (const [g, list] of this.groups) {
      const kept = list.filter((r) => r.requestedAt.getTime() >= cutoff || r.status === MessageStatus.DELAYED || r.status === MessageStatus.PENDING_OPTIMIZATION);
      for (const r of list) if (!kept.includes(r)) this.byId.delete(r.id);
      if (kept.length === 0) this.groups.delete(g);
      else this.groups.set(g, kept);
    }
    for (const [k, id] of this.idempotency) if (!this.byId.has(id)) this.idempotency.delete(k);
  }
}

function inc(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
