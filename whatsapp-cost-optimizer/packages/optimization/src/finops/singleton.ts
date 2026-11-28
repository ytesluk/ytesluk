import { FinOpsRuntimeBridge } from './runtime-bridge';
import type { FinOpsPrismaClientLike } from './prisma-adapter';

const FALLBACK_SALT = 'wco-fallback-salt-change-in-prod';
let instance: FinOpsRuntimeBridge | null = null;

export function getFinOpsBridge(prisma: FinOpsPrismaClientLike): FinOpsRuntimeBridge {
  if (!instance) {
    const salt = process.env.FINOPS_GLOBAL_SALT?.trim();
    if (process.env.NODE_ENV === 'production' && (!salt || salt === FALLBACK_SALT)) {
      throw new Error('FINOPS_GLOBAL_SALT must be configured in production');
    }
    instance = new FinOpsRuntimeBridge(prisma, salt || FALLBACK_SALT);
  }
  return instance;
}
