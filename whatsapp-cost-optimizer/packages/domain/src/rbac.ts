import { Role } from "./enums";

/**
 * Permission matrix (spec §45):
 *  OWNER: everything · ADMIN: configuration · ANALYST: analytics · OPERATOR: messages/logs
 */
export const Permission = {
  MESSAGES_WRITE: "messages:write",
  MESSAGES_READ: "messages:read",
  CONVERSATIONS_READ: "conversations:read",
  ANALYTICS_READ: "analytics:read",
  COST_READ: "cost:read",
  PRICING_READ: "pricing:read",
  PRICING_WRITE: "pricing:write",
  POLICIES_READ: "policies:read",
  POLICIES_WRITE: "policies:write",
  TEMPLATES_READ: "templates:read",
  TEMPLATES_WRITE: "templates:write",
  PROVIDERS_MANAGE: "providers:manage",
  WEBHOOKS_READ: "webhooks:read",
  AUDIT_READ: "audit:read",
  TENANT_MANAGE: "tenant:manage",
  USERS_MANAGE: "users:manage",
  PRIVACY_MANAGE: "privacy:manage",
  SIMULATOR_USE: "simulator:use",
  OBSERVABILITY_READ: "observability:read",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);
const P = Permission;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    P.PRICING_READ,
    P.PRICING_WRITE,
    P.POLICIES_READ,
    P.POLICIES_WRITE,
    P.TEMPLATES_READ,
    P.TEMPLATES_WRITE,
    P.PROVIDERS_MANAGE,
    P.WEBHOOKS_READ,
    P.AUDIT_READ,
    P.MESSAGES_READ,
    P.CONVERSATIONS_READ,
    P.ANALYTICS_READ,
    P.COST_READ,
    P.SIMULATOR_USE,
    P.OBSERVABILITY_READ,
    P.PRIVACY_MANAGE,
  ],
  ANALYST: [
    P.ANALYTICS_READ,
    P.COST_READ,
    P.PRICING_READ,
    P.POLICIES_READ,
    P.TEMPLATES_READ,
    P.SIMULATOR_USE,
    P.MESSAGES_READ,
    P.CONVERSATIONS_READ,
  ],
  OPERATOR: [
    P.MESSAGES_WRITE,
    P.MESSAGES_READ,
    P.CONVERSATIONS_READ,
    P.WEBHOOKS_READ,
    P.TEMPLATES_READ,
    P.OBSERVABILITY_READ,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
