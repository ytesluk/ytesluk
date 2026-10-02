/** Response shapes of the WCO API used by the dashboard (money values are decimal strings). */
export interface Summary {
  range: { from: string; to: string };
  currency: string;
  isDemoRates: boolean;
  messages: {
    processed: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    avoided: number;
    deduplicated: number;
    superseded: number;
    consolidated: number;
    consolidatedMessages: number;
    blocked: number;
    cancelled: number;
    pending: number;
    byStatus: Record<string, number>;
  };
  costs: {
    metaWithoutWco: string;
    metaWithWco: string;
    metaRealized: string;
    realizedMessages: number;
    bsp: string;
    bspWithoutWco: string;
    infrastructure: string;
    infrastructureWithoutWco: string;
    totalWithoutWco: string;
    totalWithWco: string;
    savingsPercent: string | null;
  };
  savings: {
    estimated: { meta: string; bsp: string; infrastructure: string; total: string };
    realized: { meta: string };
    byMechanism: Record<string, string>;
    note: string;
  };
  free: { entryPoint: number; customerServiceWindow: number; quota: number; other: number; paid: number };
}

export interface DailyRow {
  day: string;
  intents: number;
  sent: number;
  delivered: number;
  deduplicated: number;
  superseded: number;
  consolidated: number;
  blocked: number;
  avoided: number;
  baselineCost: string;
  cost: string;
  savingsEstimated: string;
  savingsRealized: string;
  bspSavings: string;
  infraSavings: string;
}

export interface Breakdown {
  byCategory: Array<{ category: string; intents: number; sent: number; avoided: number; baselineCost: string; cost: string; savings: string }>;
  byEventType: Array<{ eventType: string; intents: number; sent: number; deduplicated: number; superseded: number; consolidated: number; averageCost: string }>;
  tiers: Array<{ market: string; category: string; tier: string; messages: number }>;
  quota: Array<{ phoneNumber?: string; month?: string; used: number; limit?: number; [k: string]: unknown }>;
}

export interface Insights {
  recommendations: Array<{ id: string; title: string; description: string; evidence: Record<string, unknown>; potentialSaving: string; currency: string; confidence: number; label: string }>;
  opportunities: Array<{ type: string; title: string; potentialSaving: string; currency: string; confidence: number; note: string }>;
  anomaly: { anomalous: boolean; mean: string; today: string; increasePercent: number; message: string | null };
  disclaimer: string;
}

export interface Analytics {
  summary: Summary;
  daily: DailyRow[];
  breakdown: Breakdown;
  insights: Insights;
}

export interface IntentRow {
  id: string;
  eventType: string;
  entityId: string | null;
  customer: string;
  status: string;
  priority: string;
  category: string | null;
  messageKind: string;
  templateName: string | null;
  decisionAction: string | null;
  decisionReason: string | null;
  market: string | null;
  currency: string | null;
  estimatedCost: string | null;
  baselineCost: string | null;
  realizedCost: string | null;
  realizedConfidence: string | null;
  requestedAt: string;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  supersededById: string | null;
  duplicateOfId: string | null;
  consolidatedIntoId: string | null;
}
