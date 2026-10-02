import { TemplateCategory } from "@wco/domain";

/**
 * Deterministic category analyzer (spec §20). ADVISORY ONLY:
 *  - heuristics never become Meta's official category ("Final category is determined by Meta.");
 *  - it never suggests rewording content to obtain a cheaper category (spec §19, §98).
 *
 * Mirrors Meta's guideline structure (S7): utility must be non-promotional AND tied to a user
 * action/transaction (or essential); mixed utility+promotional content is MARKETING; only
 * authentication templates may carry one-time passcodes.
 */
export const FINAL_CATEGORY_DISCLAIMER = "Final category is determined by Meta.";

type Signal = { pattern: RegExp; label: string; weight: number };

const MARKETING: Signal[] = [
  { pattern: /\bdesconto|\bdiscount|\bdescuento/i, label: "desconto", weight: 3 },
  { pattern: /\bpromo(ção|cao|tion|ción)?\b|\bpromoç/i, label: "promoção", weight: 3 },
  { pattern: /\boferta|\boffer\b|\bdeal\b/i, label: "oferta", weight: 3 },
  { pattern: /\bcompre\b|\bbuy now\b|\bshop now\b|\bcompra ya\b/i, label: "compre", weight: 2 },
  { pattern: /\baproveite\b|\bdon'?t miss\b|\bnão perca\b|\bnao perca\b/i, label: "aproveite", weight: 2 },
  { pattern: /\blançamento\b|\blancamento\b|\bnew arrival|\blaunch\b|\bnovidade/i, label: "lançamento", weight: 2 },
  { pattern: /\bcupom\b|\bcoupon\b|\bcup[oó]n\b|\bpromo ?code\b/i, label: "cupom", weight: 3 },
  { pattern: /\bvenda\b|\bsale\b|\bliquida(ção|cao)\b|\bblack friday\b/i, label: "venda", weight: 2 },
  { pattern: /\d+\s?% (off|de desconto)/i, label: "percentual de desconto", weight: 3 },
  { pattern: /\bfrete grátis\b|\bfrete gratis\b|\bfree shipping\b/i, label: "frete grátis", weight: 2 },
  { pattern: /\bupgrade\b|\brenove\b|\brenew\b/i, label: "renovação/upgrade", weight: 1 },
  { pattern: /\bcarrinho\b|\bcart\b/i, label: "carrinho (retargeting)", weight: 2 },
];

const UTILITY: Signal[] = [
  { pattern: /\bpedido\b|\border\b|\bencomenda\b/i, label: "pedido", weight: 2 },
  { pattern: /\bpagamento\b|\bpayment\b|\bfatura\b|\binvoice\b|\bboleto\b/i, label: "pagamento", weight: 2 },
  { pattern: /\bentrega\b|\bdelivery\b|\benvio\b|\bshipped\b|\benviado\b|\brastreio\b|\btracking\b/i, label: "entrega", weight: 2 },
  { pattern: /\bagendamento\b|\bappointment\b|\bconsulta\b|\breserva\b|\bbooking\b/i, label: "agendamento", weight: 2 },
  { pattern: /\bconta\b|\baccount\b|\bsaldo\b|\bbalance\b/i, label: "atualização de conta", weight: 1 },
  { pattern: /\bconfirma(do|da|ção|cao|mos)\b|\bconfirmed\b/i, label: "confirmação", weight: 1 },
  { pattern: /\bstatus\b|\batualiza(ção|cao|do)\b|\bupdate\b/i, label: "alteração de status", weight: 1 },
  { pattern: /\breembolso\b|\brefund\b|\bestorno\b/i, label: "reembolso", weight: 2 },
];

const AUTHENTICATION: Signal[] = [
  { pattern: /\bc[oó]digo\b|\bcode\b/i, label: "código", weight: 2 },
  { pattern: /\botp\b|\bone[- ]time pass/i, label: "OTP", weight: 3 },
  { pattern: /\bverifica(ção|cao|tion)\b|\bverify\b/i, label: "verificação", weight: 2 },
  { pattern: /\blogin\b|\bacesso\b|\bsign[- ]in\b/i, label: "login", weight: 1 },
  { pattern: /\bidentidade\b|\bidentity\b/i, label: "identidade", weight: 1 },
  { pattern: /\b\d{4,8}\b|\{\{\s*(code|codigo|otp)\s*\}\}/i, label: "código numérico", weight: 1 },
];

export interface CategoryAnalysis {
  category: TemplateCategory | "SERVICE";
  classificationConfidence: number;
  requiresHumanReview: boolean;
  signals: { marketing: string[]; utility: string[]; authentication: string[] };
  notes: string[];
  disclaimer: string;
}

function score(text: string, signals: Signal[]): { score: number; labels: string[] } {
  let s = 0;
  const labels: string[] = [];
  for (const sig of signals) {
    if (sig.pattern.test(text)) {
      s += sig.weight;
      labels.push(sig.label);
    }
  }
  return { score: s, labels };
}

export function analyzeCategory(text: string, opts: { isFreeFormReply?: boolean } = {}): CategoryAnalysis {
  const m = score(text, MARKETING);
  const u = score(text, UTILITY);
  const a = score(text, AUTHENTICATION);
  const notes: string[] = [];
  const signals = { marketing: m.labels, utility: u.labels, authentication: a.labels };

  if (opts.isFreeFormReply) {
    notes.push("Free-form reply inside an open customer service window is a service (non-template) message.");
    if (m.score > 0) notes.push("Contains promotional language; Meta still prices non-template messages as service (single charge).");
    return { category: "SERVICE", classificationConfidence: 0.9, requiresHumanReview: m.score >= 3, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }

  const otpLike = a.labels.includes("OTP") || (a.labels.includes("código") && (a.labels.includes("código numérico") || a.labels.includes("verificação")));
  if (otpLike && m.score === 0) {
    notes.push("Looks like a one-time passcode. Only authentication templates may carry OTPs (Template Library, OTP button).");
    return { category: TemplateCategory.AUTHENTICATION, classificationConfidence: Math.min(0.95, 0.6 + a.score * 0.05), requiresHumanReview: u.score > 2, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }
  if (m.score > 0 && u.score > 0) {
    notes.push("Mixed transactional and promotional content: Meta's guidelines classify mixed content as marketing.");
    return { category: TemplateCategory.MARKETING, classificationConfidence: Math.min(0.9, 0.55 + m.score * 0.05), requiresHumanReview: true, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }
  if (m.score > 0) {
    notes.push("This content looks promotional.");
    return { category: TemplateCategory.MARKETING, classificationConfidence: Math.min(0.95, 0.6 + m.score * 0.05), requiresHumanReview: m.score < 3, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }
  if (u.score > 0) {
    notes.push("This content looks transactional (tied to an order, account, payment or appointment).");
    notes.push("Utility also requires the message to be specific to or requested by the user (or essential).");
    return { category: TemplateCategory.UTILITY, classificationConfidence: Math.min(0.9, 0.5 + u.score * 0.06), requiresHumanReview: u.score < 3, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }
  notes.push("Unclear content (e.g. only variables or a generic greeting): Meta treats unclear templates as marketing.");
  return { category: TemplateCategory.MARKETING, classificationConfidence: 0.4, requiresHumanReview: true, signals, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
}

/** Extracts the text of a template's components (HEADER/BODY/FOOTER/BUTTONS). */
export function templateText(components: unknown): string {
  if (!Array.isArray(components)) return typeof components === "string" ? components : "";
  const parts: string[] = [];
  for (const c of components as Array<Record<string, unknown>>) {
    if (typeof c.text === "string") parts.push(c.text);
    if (Array.isArray(c.buttons)) for (const b of c.buttons as Array<Record<string, unknown>>) if (typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}
