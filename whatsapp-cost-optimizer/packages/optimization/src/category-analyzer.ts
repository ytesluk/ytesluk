import { TemplateCategory } from "@wco/domain";

/**
 * Deterministic category analyzer (spec §20). ADVISORY ONLY:
 *  - heuristics never become Meta's official category ("Final category is determined by Meta.");
 *  - promotional content is never dressed up as utility. The compliance splitter below does the
 *    opposite: it takes promotional sentences OUT of a transactional template, so each part can be
 *    sent as what it is (the transactional part as a utility template, the offer separately).
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

// ------------------------------------------------------------------------------------------------
// Template compliance splitter

/** Outcome of separating the promotional part from a transactional template text. Advisory. */
export interface ComplianceSplit {
  /** The text with the promotional sentences taken out. Nothing is reworded by the rules. */
  transactional: string;
  /** The sentences taken out, to be sent separately (deferred follow-up or a marketing template). */
  promotional: string | null;
  removed: Array<{ text: string; signals: string[] }>;
  /** Sentences that mix both kinds of content and could not be separated by rules (left as they are). */
  mixed: Array<{ text: string; signals: string[] }>;
  changed: boolean;
  /** Analyzer verdict on the transactional part alone. */
  analysis: CategoryAnalysis;
  /**
   * Whether the transactional part reads as a utility message on its own. False when nothing
   * transactional is left or promotional wording remains — then it must stay a marketing template.
   */
  looksUtility: boolean;
  /** "rules", or the name of the rewriter that reworded mixed sentences. */
  rewriter: string;
  notes: string[];
  disclaimer: string;
}

/**
 * Optional rewriter (e.g. an LLM behind an HTTP endpoint) for sentences the rules cannot separate.
 * Its output is checked by the same rules: a "transactional" text that still carries promotional
 * wording is discarded. It never runs in the message hot path and never decides a category.
 */
export interface PromotionalRewriter {
  readonly name: string;
  rewrite(input: { original: string; transactional: string; promotional: string | null }): Promise<{ transactional: string; promotional: string | null }>;
}

const SENTENCE = /(?<=[.!?…])\s+/;

function splitSentences(line: string): string[] {
  return line.split(SENTENCE).map((x) => x.trim()).filter((x) => x.length > 0);
}

export class TemplateComplianceSplitter {
  constructor(private readonly opts: { rewriter?: PromotionalRewriter | null } = {}) {}

  /** Rule-based split: whole sentences with promotional signals (and no transactional ones) are taken out. */
  split(text: string): ComplianceSplit {
    const removed: ComplianceSplit["removed"] = [];
    const mixed: ComplianceSplit["mixed"] = [];
    const keptLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") {
        keptLines.push("");
        continue;
      }
      const kept: string[] = [];
      for (const sentence of splitSentences(line)) {
        const m = score(sentence, MARKETING);
        if (m.score === 0) {
          kept.push(sentence);
        } else if (score(sentence, UTILITY).score > 0) {
          mixed.push({ text: sentence, signals: m.labels });
          kept.push(sentence);
        } else {
          removed.push({ text: sentence, signals: m.labels });
        }
      }
      if (kept.length) keptLines.push(kept.join(" "));
    }
    const transactional = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return this.result(text, transactional, removed.length ? removed.map((r) => r.text).join(" ") : null, removed, mixed, "rules");
  }

  /** Rules first; then the optional rewriter for what the rules could not separate. */
  async splitWithRewriter(text: string): Promise<ComplianceSplit> {
    const base = this.split(text);
    const rewriter = this.opts.rewriter;
    if (!rewriter || base.mixed.length === 0) return base;
    try {
      const out = await rewriter.rewrite({ original: text, transactional: base.transactional, promotional: base.promotional });
      const candidate = this.result(text, out.transactional.trim(), out.promotional?.trim() || base.promotional, base.removed, [], rewriter.name);
      // The rewriter's transactional text must pass the same rules, or its output is not used.
      if (candidate.looksUtility) return { ...candidate, notes: [...candidate.notes, `Mixed sentences reworded by "${rewriter.name}"; review the wording before submitting it to Meta.`] };
      return { ...base, notes: [...base.notes, `Rewriter "${rewriter.name}" returned a text that still reads as promotional; its output was discarded.`] };
    } catch {
      return { ...base, notes: [...base.notes, `Rewriter "${rewriter.name}" failed; rule-based result kept.`] };
    }
  }

  private result(original: string, transactional: string, promotional: string | null, removed: ComplianceSplit["removed"], mixed: ComplianceSplit["mixed"], rewriter: string): ComplianceSplit {
    const analysis = analyzeCategory(transactional);
    const looksUtility = transactional.length > 0 && analysis.category === TemplateCategory.UTILITY && analysis.signals.marketing.length === 0;
    const notes: string[] = [];
    if (removed.length === 0 && mixed.length === 0) notes.push("No promotional content found.");
    if (removed.length > 0) notes.push(`${removed.length} promotional sentence(s) separated. Send them as their own message: a follow-up when the customer replies, or a marketing template.`);
    if (mixed.length > 0) notes.push(`${mixed.length} sentence(s) mix transactional and promotional content and need to be split by hand (or by a rewriter).`);
    if (!looksUtility) notes.push(transactional.length === 0 ? "Nothing transactional is left: this is a promotional message and belongs in a marketing template." : "The remaining text does not read as a plain transactional message; expect Meta to classify it as marketing.");
    notes.push("A changed text is a new template: it has to be submitted to Meta, which decides its category.");
    return { transactional, promotional, removed, mixed, changed: transactional !== original.trim(), analysis, looksUtility, rewriter, notes, disclaimer: FINAL_CATEGORY_DISCLAIMER };
  }
}

/**
 * Rewriter backed by an HTTP endpoint the operator runs (typically a small LLM service):
 * POST { original, transactional, promotional } → { transactional, promotional }.
 */
export class HttpPromotionalRewriter implements PromotionalRewriter {
  readonly name: string;
  constructor(private readonly opts: { url: string; authorization?: string; name?: string; timeoutMs?: number; fetchImpl?: typeof fetch }) {
    this.name = opts.name ?? "http-rewriter";
  }

  async rewrite(input: { original: string; transactional: string; promotional: string | null }): Promise<{ transactional: string; promotional: string | null }> {
    const res = await (this.opts.fetchImpl ?? fetch)(this.opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.opts.authorization ? { Authorization: this.opts.authorization } : {}) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new Error(`rewriter answered ${res.status}`);
    const out = (await res.json()) as { transactional?: unknown; promotional?: unknown };
    if (typeof out.transactional !== "string") throw new Error("rewriter response without a transactional text");
    return { transactional: out.transactional, promotional: typeof out.promotional === "string" ? out.promotional : null };
  }
}
