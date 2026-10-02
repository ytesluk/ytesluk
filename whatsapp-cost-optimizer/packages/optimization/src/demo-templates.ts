import { BillingCategory, TemplateCategory } from "@wco/domain";
import type { TemplateInfo } from "./types";

/**
 * Demo templates (seed, tests and simulator). In production, templates are registered via
 * /api/v1/templates and their category/status come from Meta (webhooks or the Templates API).
 */
export interface DemoTemplate {
  name: string;
  language: string;
  category: TemplateCategory;
  bodyParams: string[];
  consolidationParam?: string;
  body: string;
}

export const DEMO_TEMPLATES: DemoTemplate[] = [
  { name: "order_status_update", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["orderId", "statusLabel"], body: "Pedido {{orderId}}: {{statusLabel}}." },
  {
    name: "order_update_summary",
    language: "pt_BR",
    category: TemplateCategory.UTILITY,
    bodyParams: ["orderId", "updates", "tracking"],
    consolidationParam: "updates",
    body: "Atualização do pedido #{{orderId}}: {{updates}}. Rastreio: {{tracking}}",
  },
  { name: "payment_confirmation", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["orderId", "amount"], body: "Pagamento do pedido {{orderId}} confirmado: {{amount}}." },
  { name: "shipping_update", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["orderId", "tracking"], body: "Seu pedido {{orderId}} foi enviado. Rastreio: {{tracking}}." },
  { name: "appointment_reminder", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["date", "time"], body: "Lembrete: sua consulta é em {{date}} às {{time}}." },
  { name: "otp_code", language: "pt_BR", category: TemplateCategory.AUTHENTICATION, bodyParams: ["code"], body: "{{code}} é o seu código de verificação." },
  { name: "security_alert", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["event"], body: "Alerta de segurança na sua conta: {{event}}." },
  { name: "fraud_alert", language: "pt_BR", category: TemplateCategory.UTILITY, bodyParams: ["amount", "merchant"], body: "Detectamos uma transação de {{amount}} em {{merchant}}. Foi você?" },
  { name: "weekly_offer", language: "pt_BR", category: TemplateCategory.MARKETING, bodyParams: ["offer"], body: "Oferta da semana: {{offer}}. Aproveite!" },
  { name: "cart_reminder", language: "pt_BR", category: TemplateCategory.MARKETING, bodyParams: ["items"], body: "Você deixou {{items}} no carrinho. Finalize sua compra!" },
  { name: "back_in_stock", language: "pt_BR", category: TemplateCategory.MARKETING, bodyParams: ["product"], body: "{{product}} voltou ao estoque!" },
];

export function toTemplateInfo(t: DemoTemplate): TemplateInfo {
  return {
    name: t.name,
    language: t.language,
    category: t.category as unknown as BillingCategory,
    approved: true,
    consolidationParam: t.consolidationParam ?? null,
    maxParamLength: 1024,
    bodyParams: t.bodyParams,
  };
}

export const DEMO_TEMPLATE_INFOS: TemplateInfo[] = DEMO_TEMPLATES.map(toTemplateInfo);
