export interface FlowPlanInput { flowId: string; flowToken: string; stepsCount: number; has24hWindow: boolean; templateUsd?: number; }
export function evaluateWhatsAppFlowConsolidation(inp: FlowPlanInput) {
  const usd = inp.templateUsd ?? 0.0068;
  const legacyCost = +(inp.stepsCount * usd).toFixed(6);
  const flowCost = inp.has24hWindow ? 0 : usd;
  return {
    mode: inp.has24hWindow ? 'INTERACTIVE_FLOW_FREE' as const : 'SINGLE_TEMPLATE_FLOW_TRIGGER' as const,
    flowId: inp.flowId, flowToken: inp.flowToken, opens24hWindowOnSubmit: true,
    legacyCostUsd: legacyCost, optimizedCostUsd: flowCost, savedUsd: +(legacyCost - flowCost).toFixed(6)
  };
}
