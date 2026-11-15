import { FinOpsRuntimeBridge } from './runtime-bridge';
import type { FinOpsPrismaClientLike } from './prisma-adapter';

let instance: FinOpsRuntimeBridge | null = null;

export function getFinOpsBridge(prisma: FinOpsPrismaClientLike): FinOpsRuntimeBridge {
  if (!instance) {
    const salt = process.env.FINOPS_GLOBAL_SALT || 'wco-fallback-salt-change-in-prod';
    instance = new FinOpsRuntimeBridge(prisma, salt);
  }
  return instance;
}
