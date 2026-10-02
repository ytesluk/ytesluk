import { metrics, getLogger } from "@wco/logging";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker";
import { classifyMetaError, isProviderError, ProviderError } from "./errors";
import { mediaBody, templateBody, textBody } from "./payloads";
import type {
  BusinessAccountInfo,
  PhoneNumberInfo,
  ProviderCredentials,
  ProviderMessageInfo,
  SendMediaRequest,
  SendResult,
  SendTemplateRequest,
  SendTextRequest,
  WebhookVerificationInput,
  WhatsAppProvider,
} from "./provider";
import { verifySignature } from "./webhook";

export interface MetaCloudApiOptions {
  /** Graph API version from META_GRAPH_API_VERSION (e.g. "v26.0"). Never hardcoded (spec §44). */
  graphApiVersion: string;
  baseUrl?: string;
  appSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  breaker?: CircuitBreaker;
}

/**
 * Real WhatsApp Cloud API provider. The ONLY place in WCO that calls graph.facebook.com.
 * Tokens are passed per call (decrypted just-in-time) and never logged.
 */
export class MetaCloudApiProvider implements WhatsAppProvider {
  readonly kind = "META_CLOUD_API" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly breaker: CircuitBreaker;
  private readonly log = getLogger("meta-cloud-api");

  constructor(private readonly opts: MetaCloudApiOptions) {
    if (!/^v\d+\.\d+$/.test(opts.graphApiVersion)) throw new Error(`Invalid META_GRAPH_API_VERSION "${opts.graphApiVersion}" (expected e.g. v26.0)`);
    this.base = `${(opts.baseUrl ?? "https://graph.facebook.com").replace(/\/$/, "")}/${opts.graphApiVersion}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.breaker =
      opts.breaker ??
      new CircuitBreaker({
        windowMs: 60_000,
        minCalls: 20,
        failureRateThreshold: 0.5,
        openMs: 30_000,
        onStateChange: (s) => metrics.circuitState.set({ provider: "META_CLOUD_API" }, s === "OPEN" ? 1 : 0),
      });
  }

  private async call<T>(operation: string, method: "GET" | "POST", path: string, creds: ProviderCredentials, body?: unknown): Promise<{ data: T; latencyMs: number }> {
    const started = Date.now();
    const end = metrics.metaApiLatency.startTimer({ provider: "META_CLOUD_API", operation });
    try {
      const result = await this.breaker.exec(
        async () => {
          let res: Response;
          try {
            res = await this.fetchImpl(`${this.base}/${path}`, {
              method,
              headers: { ...(creds.accessToken ? { Authorization: `Bearer ${creds.accessToken}` } : {}), "Content-Type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
              signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
            });
          } catch (e) {
            throw new ProviderError({ message: `Network error calling Meta (${operation})`, provider: this.kind, classification: classifyMetaError(undefined), cause: e });
          }
          const text = await res.text();
          let json: Record<string, unknown> = {};
          try {
            json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          } catch {
            /* non-JSON body */
          }
          if (!res.ok || json.error) {
            const err = (json.error ?? {}) as { code?: number; message?: string; fbtrace_id?: string; error_data?: { details?: string } };
            const classification = classifyMetaError(err.code, res.status);
            throw new ProviderError({
              message: err.error_data?.details ?? err.message ?? `Meta API HTTP ${res.status}`,
              provider: this.kind,
              providerCode: err.code,
              httpStatus: res.status,
              requestId: err.fbtrace_id,
              classification,
            });
          }
          return json as T;
        },
        (e) => (isProviderError(e) ? e.retryable : true),
      );
      metrics.metaApiRequests.inc({ provider: this.kind, operation, outcome: "success" });
      return { data: result, latencyMs: Date.now() - started };
    } catch (e) {
      metrics.metaApiRequests.inc({ provider: this.kind, operation, outcome: e instanceof CircuitOpenError ? "circuit_open" : "error" });
      if (isProviderError(e)) this.log.warn({ operation, code: e.providerCode, action: e.action, retryable: e.retryable, requestId: e.requestId }, "meta api error");
      throw e;
    } finally {
      end();
    }
  }

  private async send(operation: string, phoneNumberId: string, body: Record<string, unknown>, creds: ProviderCredentials): Promise<SendResult> {
    const { data, latencyMs } = await this.call<{ contacts?: Array<{ wa_id?: string }>; messages?: Array<{ id: string; message_status?: string }> }>(
      operation,
      "POST",
      `${encodeURIComponent(phoneNumberId)}/messages`,
      creds,
      body,
    );
    const id = data.messages?.[0]?.id;
    if (!id) throw new ProviderError({ message: "Meta response without message id", provider: this.kind, classification: { retryable: false, action: "UNKNOWN" } });
    return { providerMessageId: id, waId: data.contacts?.[0]?.wa_id ?? null, acceptedAt: new Date(), latencyMs, messageStatus: data.messages?.[0]?.message_status };
  }

  sendMessage(req: SendTextRequest, creds: ProviderCredentials): Promise<SendResult> {
    return this.send("sendMessage", req.phoneNumberId, textBody(req), creds);
  }

  sendTemplate(req: SendTemplateRequest, creds: ProviderCredentials): Promise<SendResult> {
    return this.send("sendTemplate", req.phoneNumberId, templateBody(req), creds);
  }

  sendMedia(req: SendMediaRequest, creds: ProviderCredentials): Promise<SendResult> {
    return this.send("sendMedia", req.phoneNumberId, mediaBody(req), creds);
  }

  async getMessage(providerMessageId: string): Promise<ProviderMessageInfo> {
    throw new ProviderError({
      message: `Cloud API does not expose message status lookups; status for ${providerMessageId} arrives via the messages webhook`,
      provider: this.kind,
      httpStatus: 501,
      classification: { retryable: false, action: "INVALID_REQUEST" },
    });
  }

  async registerWebhook(wabaId: string, creds: ProviderCredentials): Promise<{ success: boolean }> {
    const { data } = await this.call<{ success?: boolean }>("registerWebhook", "POST", `${encodeURIComponent(wabaId)}/subscribed_apps`, creds);
    return { success: data.success === true };
  }

  validateWebhook(input: WebhookVerificationInput): boolean {
    return verifySignature(input.rawBody, input.signatureHeader, this.opts.appSecret);
  }

  async getPhoneNumber(phoneNumberId: string, creds: ProviderCredentials): Promise<PhoneNumberInfo> {
    const { data } = await this.call<Record<string, string>>(
      "getPhoneNumber",
      "GET",
      `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,throughput`,
      creds,
    );
    return {
      id: data.id ?? phoneNumberId,
      displayPhoneNumber: data.display_phone_number ?? "",
      verifiedName: data.verified_name,
      qualityRating: data.quality_rating,
      throughput: typeof data.throughput === "object" ? JSON.stringify(data.throughput) : data.throughput,
    };
  }

  /**
   * Embedded Signup (S11): exchanges the code returned to the browser (TTL ~30s) for a business token.
   * GET /oauth/access_token?client_id&client_secret&code — server-to-server only.
   */
  async exchangeCodeForToken(code: string, appId: string, appSecret: string): Promise<{ accessToken: string }> {
    const qs = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const { data } = await this.call<{ access_token?: string }>("exchangeCode", "GET", `oauth/access_token?${qs.toString()}`, { accessToken: "" });
    if (!data.access_token) throw new ProviderError({ message: "Meta did not return an access token", provider: this.kind, classification: { retryable: false, action: "AUTH_ISSUE" } });
    return { accessToken: data.access_token };
  }

  /** Registers a business phone number for Cloud API use (POST /<PHONE_NUMBER_ID>/register). */
  async registerPhoneNumber(phoneNumberId: string, pin: string, creds: ProviderCredentials): Promise<{ success: boolean }> {
    const { data } = await this.call<{ success?: boolean }>("registerPhone", "POST", `${encodeURIComponent(phoneNumberId)}/register`, creds, { messaging_product: "whatsapp", pin });
    return { success: data.success === true };
  }

  async getBusinessAccount(wabaId: string, creds: ProviderCredentials): Promise<BusinessAccountInfo> {
    const { data } = await this.call<Record<string, string>>("getBusinessAccount", "GET", `${encodeURIComponent(wabaId)}?fields=name,timezone_id,currency`, creds);
    return { id: data.id ?? wabaId, name: data.name, timezoneId: data.timezone_id, currency: data.currency };
  }
}
