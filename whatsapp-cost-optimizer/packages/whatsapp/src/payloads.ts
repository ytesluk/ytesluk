import type { SendMediaRequest, SendTemplateRequest, SendTextRequest } from "./provider";

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
