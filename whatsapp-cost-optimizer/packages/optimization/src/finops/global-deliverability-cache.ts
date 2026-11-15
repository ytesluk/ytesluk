import { createHmac } from 'node:crypto';

export type SuppressionReason = 'INVALID_RECIPIENT_131026' | 'MARKETING_FREQUENCY_CAP_131049';

export interface GlobalSuppressionEntry {
  globalPhoneHash: string;
  reason: SuppressionReason;
  hitCount: number;
  expiresAt: Date;
  updatedAt: Date;
}

export interface GlobalSuppressionStore {
  get(globalPhoneHash: string): Promise<GlobalSuppressionEntry | null>;
  upsert(entry: GlobalSuppressionEntry): Promise<void>;
  delete(globalPhoneHash: string): Promise<void>;
}

export class InMemorySuppressionStore implements GlobalSuppressionStore {
  private readonly map = new Map<string, GlobalSuppressionEntry>();

  async get(globalPhoneHash: string): Promise<GlobalSuppressionEntry | null> {
    return this.map.get(globalPhoneHash) ?? null;
  }

  async upsert(entry: GlobalSuppressionEntry): Promise<void> {
    this.map.set(entry.globalPhoneHash, entry);
  }

  async delete(globalPhoneHash: string): Promise<void> {
    this.map.delete(globalPhoneHash);
  }
}

export class GlobalDeliverabilityCache {
  constructor(
    private readonly store: GlobalSuppressionStore,
    private readonly globalSalt: string,
  ) {}

  public computeGlobalHash(e164Phone: string): string {
    const normalized = e164Phone.replace(/\D/g, '');
    return createHmac('sha256', this.globalSalt).update(normalized).digest('hex');
  }

  public async recordMetaFailure(
    e164Phone: string,
    metaErrorCode: number | string,
    now = new Date(),
  ): Promise<GlobalSuppressionEntry | null> {
    const code = Number(metaErrorCode);
    if (code !== 131026 && code !== 131049) return null;

    const globalPhoneHash = this.computeGlobalHash(e164Phone);
    const existing = await this.store.get(globalPhoneHash);
    const hitCount = (existing?.hitCount ?? 0) + 1;

    const reason: SuppressionReason =
      code === 131026 ? 'INVALID_RECIPIENT_131026' : 'MARKETING_FREQUENCY_CAP_131049';

    // Backoff progressivo calibrado:
    // 131026: 1d -> 7d -> 30d | 131049: 24h -> 48h -> 72h
    const ttlHours =
      code === 131026
        ? hitCount === 1
          ? 24
          : hitCount === 2
            ? 24 * 7
            : 24 * 30
        : Math.min(72, hitCount * 24);

    const entry: GlobalSuppressionEntry = {
      globalPhoneHash,
      reason,
      hitCount,
      expiresAt: new Date(now.getTime() + ttlHours * 3_600_000),
      updatedAt: now,
    };

    await this.store.upsert(entry);
    return entry;
  }

  public async clearOnInboundMessage(e164Phone: string): Promise<void> {
    const globalPhoneHash = this.computeGlobalHash(e164Phone);
    await this.store.delete(globalPhoneHash);
  }

  public async checkBeforeDispatch(
    e164Phone: string,
    category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE',
    now = new Date(),
  ): Promise<{
    blocked: boolean;
    action: 'ALLOW' | 'SUPPRESS' | 'DEFER';
    entry?: GlobalSuppressionEntry;
  }> {
    const globalPhoneHash = this.computeGlobalHash(e164Phone);
    const entry = await this.store.get(globalPhoneHash);

    if (!entry || entry.expiresAt <= now) {
      return { blocked: false, action: 'ALLOW' };
    }

    if (entry.reason === 'INVALID_RECIPIENT_131026') {
      return { blocked: true, action: 'SUPPRESS', entry };
    }

    if (entry.reason === 'MARKETING_FREQUENCY_CAP_131049' && category === 'MARKETING') {
      return { blocked: true, action: 'DEFER', entry };
    }

    return { blocked: false, action: 'ALLOW', entry };
  }
}
