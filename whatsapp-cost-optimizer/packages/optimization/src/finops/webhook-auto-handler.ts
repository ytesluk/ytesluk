import { getFinOpsBridge } from "./singleton";
import type { FinOpsPrismaClientLike } from "./prisma-adapter";
import type { MetaTemplateCategory } from "./two-step-and-mirror-pool";
export async function handleMetaWebhookFinOps(prisma: FinOpsPrismaClientLike, body: any, tenantId = "default") {
  const bridge = getFinOpsBridge(prisma); let processed = 0;
  for (const entry of body?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      const v = ch?.value ?? {};
      for (const st of v.statuses ?? []) {
        if (st?.status === "failed" && st?.recipient_id) {
          for (const e of st.errors ?? []) { if (e?.code) { await bridge.onMetaStatusFailed(String(st.recipient_id), e.code); processed++; } }
        }
      }
      for (const m of v.messages ?? []) { if (m?.from) { await bridge.onMetaInboundMessage(String(m.from)); processed++; } }
      if (ch?.field === "template_category_update" && v?.message_template_name && v?.new_category) {
        await bridge.onTemplateCategoryUpdated(tenantId, String(v.message_template_name), String(v.new_category).toUpperCase() as MetaTemplateCategory); processed++;
      }
    }
  }
  return { processed };
}
