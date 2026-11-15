import { FinOpsCostOrchestrator, GlobalDeliverabilityCache, InMemorySuppressionStore, DirectCloudApiRouter } from "./index.ts";
const [phoneNumberId, accessToken, recipientPhone] = [process.env.META_PHONE_NUMBER_ID!, process.env.META_ACCESS_TOKEN!, process.env.TEST_RECIPIENT_PHONE!];
if (!phoneNumberId || !accessToken || !recipientPhone) throw new Error("Faltam META_PHONE_NUMBER_ID, META_ACCESS_TOKEN ou TEST_RECIPIENT_PHONE");
const orch = new FinOpsCostOrchestrator(new GlobalDeliverabilityCache(new InMemorySuppressionStore(), "live-salt"));
const dec = await orch.evaluateAndRoute({ intentId: `live-${Date.now()}`, tenantId: "live", recipientPhone, category: "MARKETING", renderedBodyText: "Teste real WCO FinOps: pedido saiu para entrega!", buttons: [{ id: "btn_ok", title: "Rastrear pedido" }], hasActive24hWindow: true, hasActiveFep72hWindow: false, allowMarketingToFreeForm: true, hasMarketingConsent: true, routingTransport: "DIRECT_CLOUD_API", directRouteConfig: { phoneNumberId, accessToken, legacyBspMarkupPerMsgUsd: 0.008 }, monthlyFreeServiceQuotaUsed: 0, serviceUnitCostUsd: 0.0068, utilityUnitCostUsd: 0.0068, marketingUnitCostUsd: 0.0625 });
console.log("Decisao FinOps:", dec);
const req = new DirectCloudApiRouter().buildDirectRequest({ phoneNumberId, accessToken, legacyBspMarkupPerMsgUsd: 0.008 });
const res = await fetch(req.endpointUrl, { method: "POST", headers: req.headers, body: JSON.stringify({ messaging_product: "whatsapp", to: recipientPhone.replace(/\D/g, ""), type: "interactive", interactive: { type: "button", body: { text: dec.finalText }, action: { buttons: [{ type: "reply", reply: { id: "btn_ok", title: "Rastrear pedido" } }] } } }) });
console.log("HTTP Meta:", res.status, await res.json());
