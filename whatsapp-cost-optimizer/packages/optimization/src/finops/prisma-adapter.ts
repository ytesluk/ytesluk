import type {
  GlobalSuppressionEntry,
  GlobalSuppressionStore,
  SuppressionReason,
} from './global-deliverability-cache';
import type {
  MetaTemplateCategory,
  MetaTemplateStatus,
  MirrorTemplateVariant,
} from './two-step-and-mirror-pool';
import type { FinOpsRoutingDecision } from './finops-orchestrator';

/**
 * Interface estrutural compatível com qualquer instância gerada do PrismaClient
 * no monorepo, evitando conflitos de importação entre pacotes.
 */
export interface FinOpsPrismaClientLike {
  globalSuppression: {
    findUnique(args: { where: { globalPhoneHash: string } }): Promise<{
      globalPhoneHash: string;
      reason: string;
      hitCount: number;
      expiresAt: Date;
      updatedAt: Date;
    } | null>;
    upsert(args: {
      where: { globalPhoneHash: string };
      create: {
        globalPhoneHash: string;
        reason: string;
        hitCount: number;
        expiresAt: Date;
      };
      update: {
        reason: string;
        hitCount: number;
        expiresAt: Date;
      };
    }): Promise<unknown>;
    deleteMany(args: { where: { globalPhoneHash: string } }): Promise<unknown>;
  };
  mirrorTemplateVariant: {
    findMany(args: {
      where: { tenantId: string; groupKey?: string; language?: string };
      orderBy?: { priority: 'asc' | 'desc' };
    }): Promise<
      Array<{
        id: string;
        tenantId: string;
        groupKey: string;
        metaTemplateName: string;
        language: string;
        category: string;
        status: string;
        priority: number;
        lastReclassifiedAt: Date | null;
      }>
    >;
    update(args: {
      where: { id: string };
      data: {
        category?: string;
        status?: string;
        priority?: number;
        lastReclassifiedAt?: Date | null;
      };
    }): Promise<unknown>;
  };
  monthlyServiceQuota: {
    findUnique(args: {
      where: { wabaPhoneId_yearMonth: { wabaPhoneId: string; yearMonth: string } };
    }): Promise<{ freeUsedCount: number; freeLimit: number } | null>;
    upsert(args: {
      where: { wabaPhoneId_yearMonth: { wabaPhoneId: string; yearMonth: string } };
      create: {
        tenantId: string;
        wabaPhoneId: string;
        yearMonth: string;
        freeUsedCount: number;
        freeLimit: number;
      };
      update: {
        freeUsedCount: { increment: number };
      };
    }): Promise<{ freeUsedCount: number; freeLimit: number }>;
  };
  finOpsSavingsLedger: {
    upsert(args: {
      where: { intentId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export class PrismaSuppressionStore implements GlobalSuppressionStore {
  constructor(private readonly prisma: FinOpsPrismaClientLike) {}

  async get(globalPhoneHash: string): Promise<GlobalSuppressionEntry | null> {
    const row = await this.prisma.globalSuppression.findUnique({
      where: { globalPhoneHash },
    });
    if (!row) return null;

    return {
      globalPhoneHash: row.globalPhoneHash,
      reason: row.reason as SuppressionReason,
      hitCount: row.hitCount,
      expiresAt: row.expiresAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(entry: GlobalSuppressionEntry): Promise<void> {
    await this.prisma.globalSuppression.upsert({
      where: { globalPhoneHash: entry.globalPhoneHash },
      create: {
        globalPhoneHash: entry.globalPhoneHash,
        reason: entry.reason,
        hitCount: entry.hitCount,
        expiresAt: entry.expiresAt,
      },
      update: {
        reason: entry.reason,
        hitCount: entry.hitCount,
        expiresAt: entry.expiresAt,
      },
    });
  }

  async delete(globalPhoneHash: string): Promise<void> {
    await this.prisma.globalSuppression.deleteMany({
      where: { globalPhoneHash },
    });
  }
}

export class PrismaFinOpsRepository {
  constructor(private readonly prisma: FinOpsPrismaClientLike) {}

  private getCurrentYearMonth(now = new Date()): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  public async getMonthlyFreeServiceQuotaUsed(
    wabaPhoneId: string,
    now = new Date(),
  ): Promise<number> {
    const yearMonth = this.getCurrentYearMonth(now);
    const record = await this.prisma.monthlyServiceQuota.findUnique({
      where: { wabaPhoneId_yearMonth: { wabaPhoneId, yearMonth } },
    });
    return record?.freeUsedCount ?? 0;
  }

  public async incrementMonthlyServiceQuota(
    tenantId: string,
    wabaPhoneId: string,
    now = new Date(),
  ): Promise<{ freeUsedCount: number; freeLimit: number }> {
    const yearMonth = this.getCurrentYearMonth(now);
    return this.prisma.monthlyServiceQuota.upsert({
      where: { wabaPhoneId_yearMonth: { wabaPhoneId, yearMonth } },
      create: {
        tenantId,
        wabaPhoneId,
        yearMonth,
        freeUsedCount: 1,
        freeLimit: 1000,
      },
      update: {
        freeUsedCount: { increment: 1 },
      },
    });
  }

  public async listMirrorVariants(
    tenantId: string,
    groupKey?: string,
    language?: string,
  ): Promise<MirrorTemplateVariant[]> {
    const rows = await this.prisma.mirrorTemplateVariant.findMany({
      where: {
        tenantId,
        ...(groupKey ? { groupKey } : {}),
        ...(language ? { language } : {}),
      },
      orderBy: { priority: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      groupKey: r.groupKey,
      metaTemplateName: r.metaTemplateName,
      language: r.language,
      category: r.category as MetaTemplateCategory,
      status: r.status as MetaTemplateStatus,
      priority: r.priority,
      lastReclassifiedAt: r.lastReclassifiedAt,
    }));
  }

  public async saveMirrorVariantState(variant: MirrorTemplateVariant): Promise<void> {
    await this.prisma.mirrorTemplateVariant.update({
      where: { id: variant.id },
      data: {
        category: variant.category,
        status: variant.status,
        priority: variant.priority,
        lastReclassifiedAt: variant.lastReclassifiedAt ?? null,
      },
    });
  }

  public async recordDecisionLedger(
    tenantId: string,
    intentId: string,
    decision: FinOpsRoutingDecision,
  ): Promise<void> {
    const payload = {
      tenantId,
      intentId,
      status: decision.status,
      transport: decision.transport,
      deliveryMode: decision.deliveryMode,
      selectedTemplateName: decision.selectedTemplateName ?? null,
      baselineTotalCostUsd: decision.baselineTotalCostUsd,
      finalTotalCostUsd: decision.finalTotalCostUsd,
      metaTariffSavingsUsd: decision.metaTariffSavingsUsd,
      avoidedBspFeeUsd: decision.avoidedBspFeeUsd,
      totalSavingsUsd: decision.totalSavingsUsd,
      appliedStrategiesJson: JSON.stringify(decision.appliedStrategies),
    };

    await this.prisma.finOpsSavingsLedger.upsert({
      where: { intentId },
      create: payload,
      update: payload,
    });
  }
}
