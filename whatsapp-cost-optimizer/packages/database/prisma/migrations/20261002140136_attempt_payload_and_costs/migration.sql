-- AlterTable
ALTER TABLE "MessageAttempt" ADD COLUMN     "estimatedCost" DECIMAL(18,8),
ADD COLUMN     "freeReason" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "pricingStatus" "PricingStatus",
ADD COLUMN     "realizedAt" TIMESTAMPTZ(3),
ADD COLUMN     "realizedCost" DECIMAL(18,8);
