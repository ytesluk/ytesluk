import type {
  FreeFormContent,
  SendInteractiveRequest,
  SendMediaRequest,
  SendTemplateRequest,
  SendTextRequest,
  TemplateComponent,
  TemplateParameter,
} from "./provider";

/** Cloud API request bodies (POST /<PHONE_NUMBER_ID>/messages), docs S3. */
export function textBody(req: SendTextRequest): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: req.to,
    type: "text",
    text: { preview_url: req.previewUrl ?? false, body: req.text },
    ...(req.replyToMessageId ? { context: { message_id: req.replyToMessageId } } : {}),
    ...(req.bizOpaqueCallbackData ? { biz_opaque_callback_data: req.bizOpaqueCallbackData } : {}),
  };
}

export function templateBody(req: SendTemplateRequest): Record<string, unknown> {
  const named = (req.template.parameterFormat ?? "NAMED") === "NAMED";
  const parameters = req.template.bodyParameters.map((p) => ({
    type: "text",
    text: p.value,
    ...(named && p.name ? { parameter_name: p.name } : {}),
  }));
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: req.to,
    type: "template",
    template: {
      name: req.template.name,
      language: { code: req.template.language },
      ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}),
    },
    ...(req.bizOpaqueCallbackData ? { biz_opaque_callback_data: req.bizOpaqueCallbackData } : {}),
  };
}

export function mediaBody(req: SendMediaRequest): Record<string, unknown> {
  const media: Record<string, unknown> = {};
  if (req.mediaId) media.id = req.mediaId;
  else if (req.link) media.link = req.link;
  if (req.caption && req.mediaType !== "audio" && req.mediaType !== "sticker") media.caption = req.caption;
  if (req.filename && req.mediaType === "document") media.filename = req.filename;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: req.to,
    type: req.mediaType,
    [req.mediaType]: media,
    ...(req.bizOpaqueCallbackData ? { biz_opaque_callback_data: req.bizOpaqueCallbackData } : {}),
  };
}

/** Cloud API limits of the message types used when a template's content goes as a free-form message. */
export const FREE_FORM_LIMITS = { text: 4096, interactiveBody: 1024, header: 60, footer: 60, buttonTitle: 20, replyButtons: 3 } as const;

/** POST /<PHONE_NUMBER_ID>/messages with type "interactive": reply buttons ("button") or one URL button ("cta_url"). */
export function interactiveBody(req: SendInteractiveRequest): Record<string, unknown> {
  const c = req.content;
  const common = {
    ...(c.header ? { header: { type: "text", text: c.header } } : {}),
    body: { text: c.body },
    ...(c.footer ? { footer: { text: c.footer } } : {}),
  };
  const interactive =
    c.type === "buttons"
      ? { type: "button", ...common, action: { buttons: c.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) } }
      : { type: "cta_url", ...common, action: { name: "cta_url", parameters: { display_text: c.displayText, url: c.url } } };
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: req.to,
    type: "interactive",
    interactive,
    ...(req.bizOpaqueCallbackData ? { biz_opaque_callback_data: req.bizOpaqueCallbackData } : {}),
  };
}

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const hasVariable = (text: string | undefined): boolean => !!text && /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(text);
const upper = (v: string | undefined): string => (v ?? "").toUpperCase();

/** Fills {{1}} / {{order_id}} with the parameter values. Null when a variable has no value. */
export function interpolateTemplateText(text: string, params: TemplateParameter[]): string | null {
  let missing = false;
  const out = text.replace(VARIABLE, (_m, name: string) => {
    const byName = params.find((p) => p.name === name);
    const byPosition = /^\d+$/.test(name) ? params[Number(name) - 1] : undefined;
    const value = (byName ?? byPosition)?.value;
    if (value === undefined || value === "") {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? null : out;
}

export type FreeFormConversion = { ok: true; content: FreeFormContent } | { ok: false; reason: string };

/**
 * Whether a template's STRUCTURE can be shown as a free-form message (checked when an intent is
 * created, before the parameters are known). Text header (no variables), body, footer and either
 * no buttons, up to three quick replies, or exactly one static URL button. Media headers, phone,
 * copy-code/OTP, flow and catalog buttons, carousels and limited-time offers are NOT convertible:
 * those messages are always sent as the approved template.
 */
export function templateFreeFormShape(components: unknown): { ok: true; shape: FreeFormContent["type"] } | { ok: false; reason: string } {
  if (!Array.isArray(components)) return { ok: false, reason: "no_components" };
  const list = components as TemplateComponent[];
  const known = new Set(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
  if (list.some((c) => !known.has(upper(c.type)))) return { ok: false, reason: "unsupported_component" };
  const body = list.find((c) => upper(c.type) === "BODY");
  if (!body?.text) return { ok: false, reason: "no_body" };
  const header = list.find((c) => upper(c.type) === "HEADER");
  if (header) {
    if (upper(header.format ?? "TEXT") !== "TEXT" || !header.text) return { ok: false, reason: "media_header" };
    if (hasVariable(header.text)) return { ok: false, reason: "header_variable" };
  }
  const buttons = list.filter((c) => upper(c.type) === "BUTTONS").flatMap((c) => c.buttons ?? []);
  if (buttons.length === 0) return { ok: true, shape: "text" };
  if (buttons.some((b) => !b.text || hasVariable(b.text) || b.text.length > FREE_FORM_LIMITS.buttonTitle)) return { ok: false, reason: "button_text" };
  if ((header?.text?.length ?? 0) > FREE_FORM_LIMITS.header) return { ok: false, reason: "header_too_long" };
  const footer = list.find((c) => upper(c.type) === "FOOTER");
  if ((footer?.text?.length ?? 0) > FREE_FORM_LIMITS.footer) return { ok: false, reason: "footer_too_long" };
  if (buttons.every((b) => upper(b.type) === "QUICK_REPLY")) {
    return buttons.length <= FREE_FORM_LIMITS.replyButtons ? { ok: true, shape: "buttons" } : { ok: false, reason: "too_many_buttons" };
  }
  if (buttons.length === 1 && upper(buttons[0]!.type) === "URL") {
    const url = buttons[0]!.url;
    if (!url || hasVariable(url) || !/^https?:\/\//i.test(url)) return { ok: false, reason: "dynamic_url" };
    return { ok: true, shape: "cta_url" };
  }
  return { ok: false, reason: "unsupported_buttons" };
}

/**
 * The content of an approved template (header, body with its parameters filled in, footer, buttons)
 * as a free-form message: plain text, reply buttons or one URL button. The wording is unchanged —
 * only the message type differs — and it may only be sent inside an open customer service window.
 */
export function templateToFreeForm(components: unknown, params: TemplateParameter[]): FreeFormConversion {
  const shape = templateFreeFormShape(components);
  if (!shape.ok) return shape;
  const list = components as TemplateComponent[];
  const find = (type: string) => list.find((c) => upper(c.type) === type);
  const body = interpolateTemplateText(find("BODY")!.text!, params);
  if (body === null) return { ok: false, reason: "missing_parameter" };
  const header = find("HEADER")?.text;
  const footer = find("FOOTER")?.text;
  const buttons = list.filter((c) => upper(c.type) === "BUTTONS").flatMap((c) => c.buttons ?? []);

  if (shape.shape === "text") {
    // WhatsApp text formatting: *bold* header, _italic_ footer.
    const text = [header ? `*${header}*` : null, body, footer ? `_${footer}_` : null].filter((x): x is string => !!x).join("\n\n");
    return text.length > FREE_FORM_LIMITS.text ? { ok: false, reason: "too_long" } : { ok: true, content: { type: "text", text } };
  }
  if (body.length > FREE_FORM_LIMITS.interactiveBody) return { ok: false, reason: "too_long" };
  const common = { ...(header ? { header } : {}), body, ...(footer ? { footer } : {}) };
  if (shape.shape === "buttons") {
    // The id is the button text, like the payload a template quick reply sends back by default.
    return { ok: true, content: { type: "buttons", ...common, buttons: buttons.map((b) => ({ id: b.text!, title: b.text! })) } };
  }
  return { ok: true, content: { type: "cta_url", ...common, displayText: buttons[0]!.text!, url: buttons[0]!.url! } };
}
