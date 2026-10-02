import {
  BillingCategory as C,
  BillingEvent,
  EntryPointType,
  FreeCondition as F,
  MessageKind,
  PolicyStatus,
  QuotaScope,
} from "@wco/domain";
import type { CategoryRule, PolicyDefinition, SourceExcerpt } from "./types";

/**
 * Versioned Meta billing rules. This file is DATA: it is seeded into PricingPolicyVersion/PricingRule
 * and the runtime reads from the database. To change a rule, add a NEW version — never edit an
 * ACTIVE one (historical invoices/savings must keep the policy they were computed with, spec §86).
 *
 * Sources: docs/META-SOURCES.md (consulted 2026-10-02). Conflicts: docs/KNOWN-CONFLICTS.md.
 */

const PRICING_URL = "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/";
const UPCOMING_URL =
  "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages";
const CSW_URL = "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages";

export const SOURCES = {
  PMP: {
    id: "S1-PMP",
    url: PRICING_URL,
    excerpt:
      "Effective July 1, 2025, Meta charges on a per-message basis for messages businesses deliver to WhatsApp users: You are only charged when a template message is delivered.",
  },
  MARKET: {
    id: "S1-MARKET",
    url: PRICING_URL,
    excerpt: "Charges for messages are based on the country calling code of the recipient WhatsApp phone number.",
  },
  NON_TEMPLATE_FREE: {
    id: "S1-NONTEMPLATE-2024",
    url: PRICING_URL,
    excerpt: "As of November 1, 2024 - Meta does not charge for non-template messages.",
  },
  UTILITY_CSW_FREE: {
    id: "S1-UTILITY-CSW-2025",
    url: PRICING_URL,
    excerpt:
      "As of July 1, 2025 - Meta does not charge for utility templates in response to users (delivered within an open customer service window).",
  },
  FEP: {
    id: "S1-FEP",
    url: PRICING_URL,
    excerpt:
      "If you respond within 24 hours using any type of message, the message will be free, and a Free Entry Point window will be opened, starting from the time when you responded. FEP windows remain open for 72 hours.",
  },
  TIERS: {
    id: "S1-TIERS",
    url: PRICING_URL,
    excerpt:
      "Messages are aggregated at the business portfolio level [...] for each market-category pair. Only messages that are charged count toward the tiers. Rates are tier-specific [...] specifically for messages in that tier. Tiers reset monthly (12am WABA timezone).",
  },
  CSW: {
    id: "S3-CSW",
    url: CSW_URL,
    excerpt:
      "When a WhatsApp user messages you or calls you, a 24-hour timer called a customer service window starts. If the user messages or calls you again before the timer expires, the timer resets to 24 hours.",
  },
  SERVICE_2026: {
    id: "S1-SERVICE-2026-10",
    url: PRICING_URL,
    excerpt:
      "Effective October 1, 2026 – Meta will charge on a per-message basis for service messages. [...] rates for service messages will be the same as those of utility and authentication, by market.",
  },
  SERVICE_QUOTA_2026: {
    id: "S1-SERVICE-QUOTA-2026-10",
    url: PRICING_URL,
    excerpt:
      "Effective October 1, 2026 – [...] every business phone number will receive 1,000 free service messages; Meta will only charge as of the 1,001st service message delivered. [...] reset monthly, for each business phone number.",
  },
  UTILITY_CSW_2026: {
    id: "S1-UTILITY-CSW-2026-10",
    url: PRICING_URL,
    excerpt: "Effective October 1, 2026 – Meta will charge for utility messages sent in an open 24-hour customer service window.",
  },
  SERVICE_NO_TIERS: {
    id: "S2-SERVICE-NO-TIERS",
    url: UPCOMING_URL,
    excerpt: "Volume tiers: None. Meta will not offer volume tiers for service messages.",
  },
  FEP_2026: {
    id: "S2-FEP-UNCHANGED",
    url: UPCOMING_URL,
    excerpt:
      "The 72-hour free entry point window is unchanged for message delivery. [Free in FEP: marketing, utility, authentication, service: Yes; Meta Business Agent: No]",
  },
  MBA: {
    id: "S2-MBA-TOKENS",
    url: UPCOMING_URL,
    excerpt: "Effective August 1, 2026 - Meta will charge on a per-token basis for Meta Business Agent messages.",
  },
} satisfies Record<string, SourceExcerpt>;

const S = SOURCES;

const FEP_STANDARD = {
  entryPoints: [EntryPointType.CLICK_TO_WHATSAPP_AD, EntryPointType.FACEBOOK_PAGE_CTA],
  replyWithinHours: 24,
  windowHours: 72,
};

function template(category: C, extra: Partial<CategoryRule> = {}): CategoryRule {
  return {
    market: "*",
    category,
    messageKind: MessageKind.TEMPLATE,
    billable: true,
    requiresCustomerServiceWindow: false,
    freeEligibility: [F.FREE_ENTRY_POINT],
    tiered: false,
    unit: "MESSAGE",
    sourceIds: [S.PMP.id, S.FEP.id, S.MARKET.id],
    ...extra,
  };
}

/** 2025-07-01 → 2026-09-30: per-message pricing, service free, utility free inside CSW. */
export const META_PMP_2025_07: PolicyDefinition = {
  id: "meta-pmp-2025-07",
  name: "Meta — cobrança por mensagem (jul/2025)",
  effectiveFrom: "2025-07-01",
  effectiveUntil: "2026-09-30",
  status: PolicyStatus.ACTIVE,
  sourceUrl: PRICING_URL,
  sourceCheckedAt: "2026-10-02T00:00:00.000Z",
  sources: [S.PMP, S.MARKET, S.NON_TEMPLATE_FREE, S.UTILITY_CSW_FREE, S.FEP, S.TIERS, S.CSW],
  notes:
    "Service (non-template) gratuita; templates utility gratuitos dentro da janela de atendimento aberta; " +
    "todas as mensagens gratuitas na janela FEP de 72h; tiers de volume para utility/autenticação (só mensagens cobradas).",
  billingEvent: BillingEvent.DELIVERED,
  customerServiceWindowHours: 24,
  freeEntryPoint: FEP_STANDARD,
  rules: [
    template(C.MARKETING),
    template(C.MARKETING_LITE),
    template(C.UTILITY, {
      freeEligibility: [F.FREE_ENTRY_POINT, F.CUSTOMER_SERVICE_WINDOW],
      tiered: true,
      sourceIds: [S.PMP.id, S.UTILITY_CSW_FREE.id, S.FEP.id, S.TIERS.id],
    }),
    template(C.AUTHENTICATION, { tiered: true, sourceIds: [S.PMP.id, S.FEP.id, S.TIERS.id] }),
    template(C.AUTHENTICATION_INTERNATIONAL, { tiered: true, sourceIds: [S.PMP.id, S.FEP.id, S.TIERS.id] }),
    {
      market: "*",
      category: C.SERVICE,
      messageKind: MessageKind.NON_TEMPLATE,
      billable: false,
      requiresCustomerServiceWindow: true,
      freeEligibility: [F.ALWAYS],
      tiered: false,
      unit: "MESSAGE",
      sourceIds: [S.NON_TEMPLATE_FREE.id, S.CSW.id],
    },
  ],
};

/** 2026-10-01 → open: service charged (1,000 free/number/month, no tiers), utility charged inside CSW. */
export const META_PMP_2026_10: PolicyDefinition = {
  id: "meta-pmp-2026-10",
  name: "Meta — cobrança por mensagem (out/2026: service e utility na janela passam a ser cobradas)",
  effectiveFrom: "2026-10-01",
  effectiveUntil: null,
  status: PolicyStatus.ACTIVE,
  sourceUrl: PRICING_URL,
  sourceCheckedAt: "2026-10-02T00:00:00.000Z",
  sources: [
    S.PMP,
    S.MARKET,
    S.SERVICE_2026,
    S.SERVICE_QUOTA_2026,
    S.UTILITY_CSW_2026,
    S.SERVICE_NO_TIERS,
    S.FEP_2026,
    S.TIERS,
    S.CSW,
    S.MBA,
  ],
  notes:
    "Conflito C1 resolvido a favor da seção datada 'Updates to rate cards'. Escopo da cota gratuita de service = número " +
    "de telefone da empresa (C2). Reinício mensal da cota assumido no fuso da WABA (C3, premissa). Meta Business Agent " +
    "é cobrado por token e não é enviado pelo WCO (avaliações retornam UNKNOWN).",
  billingEvent: BillingEvent.DELIVERED,
  customerServiceWindowHours: 24,
  freeEntryPoint: FEP_STANDARD,
  rules: [
    template(C.MARKETING, { sourceIds: [S.PMP.id, S.FEP_2026.id, S.MARKET.id] }),
    template(C.MARKETING_LITE, { sourceIds: [S.PMP.id, S.FEP_2026.id] }),
    template(C.UTILITY, { tiered: true, sourceIds: [S.UTILITY_CSW_2026.id, S.FEP_2026.id, S.TIERS.id] }),
    template(C.AUTHENTICATION, { tiered: true, sourceIds: [S.PMP.id, S.FEP_2026.id, S.TIERS.id] }),
    template(C.AUTHENTICATION_INTERNATIONAL, { tiered: true, sourceIds: [S.PMP.id, S.FEP_2026.id, S.TIERS.id] }),
    {
      market: "*",
      category: C.SERVICE,
      messageKind: MessageKind.NON_TEMPLATE,
      billable: true,
      requiresCustomerServiceWindow: true,
      freeEligibility: [F.FREE_ENTRY_POINT],
      freeQuota: { amount: 1000, scope: QuotaScope.PHONE_NUMBER, period: "MONTH" },
      tiered: false,
      rateCategory: C.SERVICE,
      // S1: "rates for service messages will be the same as those of utility [...] by market".
      rateCategoryFallback: C.UTILITY,
      unit: "MESSAGE",
      sourceIds: [S.SERVICE_2026.id, S.SERVICE_QUOTA_2026.id, S.SERVICE_NO_TIERS.id, S.FEP_2026.id, S.CSW.id],
    },
    {
      market: "*",
      category: C.META_BUSINESS_AGENT,
      messageKind: MessageKind.NON_TEMPLATE,
      billable: true,
      requiresCustomerServiceWindow: true,
      freeEligibility: [],
      tiered: false,
      unit: "TOKEN",
      sourceIds: [S.MBA.id],
    },
  ],
};

/**
 * Candidate from THIRD-PARTY sources only (KNOWN-CONFLICTS C4): CTWA free window "may extend up to 7 days".
 * Status UNVERIFIED → never selected automatically.
 */
export const META_FEP_CTWA_7D_CANDIDATE: PolicyDefinition = {
  ...META_PMP_2026_10,
  id: "meta-fep-ctwa-7d-2026-09",
  name: "CANDIDATA — janela gratuita CTWA de até 7 dias (não verificada)",
  effectiveFrom: "2026-09-21",
  effectiveUntil: null,
  status: PolicyStatus.UNVERIFIED,
  notes:
    "Ausente da documentação pública para desenvolvedores da Meta em 2026-10-02 (S2 mantém a FEP de 72 horas). " +
    "Mantida apenas para análise what-if. A confirmação deve vir dos webhooks (conversation.expiration_timestamp).",
  freeEntryPoint: {
    entryPoints: [EntryPointType.CLICK_TO_WHATSAPP_AD],
    replyWithinHours: 24,
    windowHours: 72,
    extendOnInboundHours: 24,
    maxWindowHours: 168,
  },
};

export const BUILTIN_POLICIES: PolicyDefinition[] = [META_PMP_2025_07, META_PMP_2026_10, META_FEP_CTWA_7D_CANDIDATE];
