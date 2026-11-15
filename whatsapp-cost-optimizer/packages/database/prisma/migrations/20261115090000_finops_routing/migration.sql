-- CreateEnum
CREATE TYPE "OutboundWebhookKind" AS ENUM ('MIRROR', 'EVENTS');

-- CreateEnum
CREATE TYPE "DeliverabilityKind" AS ENUM ('UNDELIVERABLE', 'MARKETING_FREQUENCY_CAP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SavingsMechanism" ADD VALUE 'TEMPLATE_TO_FREEFORM_CSW';
ALTER TYPE "SavingsMechanism" ADD VALUE 'UTILITY_SPLIT_DEFERRED';
ALTER TYPE "SavingsMechanism" ADD VALUE 'FEP_PRIORITY';
ALTER TYPE "SavingsMechanism" ADD VALUE 'BSP_MARKUP_AVOIDED';
ALTER TYPE "SavingsMechanism" ADD VALUE 'FREQUENCY_CAP_DEFERRED';
ALTER TYPE "SavingsMechanism" ADD VALUE 'INVALID_RECIPIENT_SUPPRESSED';

-- AlterTable
ALTER TABLE "MessageIntent" ADD COLUMN     "contentCategory" "BillingCategory";

-- AlterTable
ALTER TABLE "OptimizationPolicy" ADD COLUMN     "allowMarketingFreeFormInWindow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inboundFirstGraceMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "legacyBspFeeModel" JSONB;

-- CreateTable
CREATE TABLE "DeferredFollowUp" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "phoneNumberId" UUID NOT NULL,
    "deferredFreeFormPayload" TEXT,
    "contentCategory" "BillingCategory" NOT NULL DEFAULT 'MARKETING',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "triggeredAt" TIMESTAMPTZ(3),
    "followUpIntentId" UUID,
    "payloadPurgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeferredFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundWebhook" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "OutboundWebhookKind" NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT,
    "authHeaderEncrypted" TEXT,
    "fields" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastDeliveredAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboundWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientDeliverabilityCache" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "kind" "DeliverabilityKind" NOT NULL,
    "errorCode" INTEGER NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecipientDeliverabilityCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeferredFollowUp_intentId_key" ON "DeferredFollowUp"("intentId");

-- CreateIndex
CREATE INDEX "DeferredFollowUp_tenantId_customerId_status_idx" ON "DeferredFollowUp"("tenantId", "customerId", "status");

-- CreateIndex
CREATE INDEX "DeferredFollowUp_status_expiresAt_idx" ON "DeferredFollowUp"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OutboundWebhook_tenantId_kind_enabled_idx" ON "OutboundWebhook"("tenantId", "kind", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundWebhook_tenantId_kind_url_key" ON "OutboundWebhook"("tenantId", "kind", "url");

-- CreateIndex
CREATE INDEX "RecipientDeliverabilityCache_expiresAt_idx" ON "RecipientDeliverabilityCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientDeliverabilityCache_tenantId_phoneHash_kind_key" ON "RecipientDeliverabilityCache"("tenantId", "phoneHash", "kind");

-- AddForeignKey
ALTER TABLE "DeferredFollowUp" ADD CONSTRAINT "DeferredFollowUp_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MessageIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundWebhook" ADD CONSTRAINT "OutboundWebhook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
