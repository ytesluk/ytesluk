-- The inbox is back and on by default: the company answers its customers inside the WCO.
-- Texts stay encrypted (AES-256-GCM) and are purged after the payload retention period.
ALTER TABLE "Tenant" ALTER COLUMN "inboxEnabled" SET DEFAULT true;
UPDATE "Tenant" SET "inboxEnabled" = true;

-- A message written in the WCO waiting for Meta to approve its template; sent on approval.
CREATE TABLE "PendingSend" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "customerIds" UUID[],
    "conversationId" UUID,
    "authorUserId" UUID,
    "consentSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingSend_tenantId_templateId_status_idx" ON "PendingSend"("tenantId", "templateId", "status");
CREATE INDEX "PendingSend_tenantId_createdAt_idx" ON "PendingSend"("tenantId", "createdAt");
