import { mergeOutOfWindowUtility, type MergeEvent } from './template-merger';
import { routeByVolumeTier, type WabaPool } from './volume-tier-router';
import { evaluateWhatsAppFlowConsolidation, type FlowPlanInput } from './flows-orchestrator';
export interface AdvancedFinOpsInput { pendingBatch?: { events: MergeEvent[]; templateName: string; maxSlots: number }; wabaPools?: WabaPool[]; flowPlan?: FlowPlanInput; unitUsd?: number; }
export function runAdvancedFinOps(inp: AdvancedFinOpsInput) {
  const merge = inp.pendingBatch ? mergeOutOfWindowUtility(inp.pendingBatch.events, inp.pendingBatch.templateName, inp.pendingBatch.maxSlots, inp.unitUsd) : null;
  const tier = inp.wabaPools?.length ? routeByVolumeTier(inp.wabaPools) : null;
  const flow = inp.flowPlan ? evaluateWhatsAppFlowConsolidation(inp.flowPlan) : null;
  return { merge, tier, flow, extraSavedUsd: +((merge?.savedUsd ?? 0) + (tier?.unitSavedUsd ?? 0) + (flow?.savedUsd ?? 0)).toFixed(6) };
}
