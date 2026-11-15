-- CreateTable
CREATE TABLE "GlobalSuppression" (
    "globalPhoneHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalSuppression_pkey" PRIMARY KEY ("globalPhoneHash")
);

-- CreateTable
CREATE TABLE "MirrorTemplateVariant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "metaTemplateName" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "lastReclassifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorTemplateVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyServiceQuota" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaPhoneId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "freeUsedCount" INTEGER NOT NULL DEFAULT 0,
    "freeLimit" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyServiceQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinOpsSavingsLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL,
    "selectedTemplateName" TEXT,
    "baselineTotalCostUsd" DOUBLE PRECISION NOT NULL,
    "finalTotalCostUsd" DOUBLE PRECISION NOT NULL,
    "metaTariffSavingsUsd" DOUBLE PRECISION NOT NULL,
    "avoidedBspFeeUsd" DOUBLE PRECISION NOT NULL,
    "totalSavingsUsd" DOUBLE PRECISION NOT NULL,
    "appliedStrategiesJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinOpsSavingsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlobalSuppression_expiresAt_idx" ON "GlobalSuppression"("expiresAt");

-- CreateIndex
CREATE INDEX "MirrorTemplateVariant_tenantId_groupKey_status_category_idx" ON "MirrorTemplateVariant"("tenantId", "groupKey", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorTemplateVariant_tenantId_metaTemplateName_language_key" ON "MirrorTemplateVariant"("tenantId", "metaTemplateName", "language");

-- CreateIndex
CREATE INDEX "MonthlyServiceQuota_tenantId_yearMonth_idx" ON "MonthlyServiceQuota"("tenantId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyServiceQuota_wabaPhoneId_yearMonth_key" ON "MonthlyServiceQuota"("wabaPhoneId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "FinOpsSavingsLedger_intentId_key" ON "FinOpsSavingsLedger"("intentId");

-- CreateIndex
CREATE INDEX "FinOpsSavingsLedger_tenantId_createdAt_idx" ON "FinOpsSavingsLedger"("tenantId", "createdAt");
