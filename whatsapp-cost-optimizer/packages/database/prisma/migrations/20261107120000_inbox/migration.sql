-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "inboxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bodyEncrypted" TEXT,
    "templateName" TEXT,
    "providerMessageId" TEXT,
    "intentId" UUID,
    "authorUserId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "bodyPurgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_providerMessageId_key" ON "ChatMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "ChatMessage_tenantId_conversationId_occurredAt_idx" ON "ChatMessage"("tenantId", "conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "ChatMessage_tenantId_occurredAt_idx" ON "ChatMessage"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

