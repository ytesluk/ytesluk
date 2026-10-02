-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'OPERATOR');

-- CreateEnum
CREATE TYPE "BillingCategory" AS ENUM ('MARKETING', 'MARKETING_LITE', 'UTILITY', 'AUTHENTICATION', 'AUTHENTICATION_INTERNATIONAL', 'SERVICE', 'META_BUSINESS_AGENT');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEMPLATE', 'NON_TEMPLATE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('CREATED', 'PENDING_OPTIMIZATION', 'QUEUED', 'DELAYED', 'CONSOLIDATED', 'DEDUPLICATED', 'SUPERSEDED', 'BLOCKED', 'READY_TO_SEND', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('SEND_NOW', 'DELAY', 'CONSOLIDATE', 'SUPERSEDE', 'SUPPRESS_DUPLICATE', 'BLOCK', 'CANCEL');

-- CreateEnum
CREATE TYPE "PricingStatus" AS ENUM ('FREE', 'QUOTA', 'PAID', 'UNKNOWN', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "EntryPointType" AS ENUM ('CLICK_TO_WHATSAPP_AD', 'FACEBOOK_PAGE_CTA', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('ESTIMATED', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WindowStatus" AS ENUM ('OPEN', 'EXPIRED', 'NONE');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNVERIFIED', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('ESTIMATED', 'REALIZED', 'RECONCILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SavingsKind" AS ENUM ('META', 'BSP', 'INFRASTRUCTURE');

-- CreateEnum
CREATE TYPE "SavingsMechanism" AS ENUM ('DEDUPLICATION', 'SUPERSESSION', 'CONSOLIDATION', 'FREE_WINDOW', 'FREE_QUOTA', 'VOLUME_TIER', 'CATEGORY', 'DIRECT_API', 'BSP_MARKUP', 'INFRASTRUCTURE', 'NONE');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('POLICY_CHANGED', 'PRICE_CHANGED', 'QUOTA_NEAR_LIMIT', 'UNEXPECTED_COST_INCREASE', 'HIGH_DUPLICATE_RATE', 'HIGH_API_ERROR_RATE', 'WEBHOOK_FAILURE', 'TEMPLATE_CATEGORY_CHANGED', 'PAYMENT_METHOD_ISSUE', 'ACCOUNT_RESTRICTION');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('OPT_IN', 'OPT_OUT');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('ALL', 'MARKETING');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "QuotaScope" AS ENUM ('PHONE_NUMBER', 'WABA', 'BUSINESS_PORTFOLIO');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('MOCK', 'META_CLOUD_API');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "requireOptIn" BOOLEAN NOT NULL DEFAULT true,
    "bspFeeModel" JSONB,
    "usesBsp" BOOLEAN NOT NULL DEFAULT false,
    "plan" "PlanCode" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "metaBusinessId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waba" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "businessAccountId" UUID NOT NULL,
    "metaWabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "provider" "ProviderKind" NOT NULL DEFAULT 'MOCK',
    "accessTokenEncrypted" TEXT,
    "authInternationalEligible" BOOLEAN NOT NULL DEFAULT false,
    "webhookSubscribedAt" TIMESTAMPTZ(3),
    "validatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Waba_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneNumber" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "wabaId" UUID NOT NULL,
    "metaPhoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "throughputMps" INTEGER NOT NULL DEFAULT 80,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "wabaId" UUID,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnboardingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneEncrypted" TEXT,
    "phoneMasked" TEXT NOT NULL,
    "market" TEXT,
    "optedInAt" TIMESTAMPTZ(3),
    "optedOutAt" TIMESTAMPTZ(3),
    "marketingOptedOutAt" TIMESTAMPTZ(3),
    "erasedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "scope" "ConsentScope" NOT NULL DEFAULT 'ALL',
    "source" TEXT NOT NULL,
    "evidence" JSONB,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "phoneNumberId" UUID NOT NULL,
    "lastInboundAt" TIMESTAMPTZ(3),
    "lastOutboundAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerServiceWindow" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "phoneNumberId" UUID NOT NULL,
    "customerPhoneHash" TEXT NOT NULL,
    "lastInboundMessageAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "WindowStatus" NOT NULL,
    "sourceEventId" TEXT,
    "windowHours" INTEGER NOT NULL,
    "policyVersionId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerServiceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationEntryPoint" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "type" "EntryPointType" NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "userMessageAt" TIMESTAMPTZ(3) NOT NULL,
    "firstBusinessReplyAt" TIMESTAMPTZ(3),
    "freeWindowStartedAt" TIMESTAMPTZ(3),
    "freeWindowExpiresAt" TIMESTAMPTZ(3),
    "eligibility" TEXT NOT NULL,
    "sourcePayload" JSONB,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'ESTIMATED',
    "metaConversationId" TEXT,
    "policyVersionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationEntryPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID,
    "intentId" UUID,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageIntent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerPhoneHash" TEXT NOT NULL,
    "phoneNumberId" UUID NOT NULL,
    "businessEntityId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MessageStatus" NOT NULL DEFAULT 'CREATED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "maxDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3),
    "mustSendImmediately" BOOLEAN NOT NULL DEFAULT false,
    "allowDeduplication" BOOLEAN NOT NULL DEFAULT true,
    "allowAggregation" BOOLEAN NOT NULL DEFAULT false,
    "allowSupersession" BOOLEAN NOT NULL DEFAULT false,
    "messageKind" "MessageKind" NOT NULL DEFAULT 'TEMPLATE',
    "category" "BillingCategory",
    "templateId" UUID,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "data" JSONB,
    "freeFormText" TEXT,
    "groupKey" TEXT NOT NULL,
    "supersessionKey" TEXT,
    "consolidationKey" TEXT,
    "supersededById" UUID,
    "duplicateOfId" UUID,
    "consolidatedIntoId" UUID,
    "decisionAction" "DecisionAction",
    "decisionReason" TEXT,
    "market" TEXT,
    "currency" TEXT,
    "estimatedCost" DECIMAL(18,8),
    "baselineCost" DECIMAL(18,8),
    "realizedCost" DECIMAL(18,8),
    "realizedConfidence" "Confidence",
    "policyVersionId" TEXT,
    "dispatchedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "payloadPurgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "providerMessageId" TEXT,
    "status" "MessageStatus" NOT NULL,
    "coveredIntentIds" UUID[],
    "messageKind" "MessageKind" NOT NULL,
    "templateName" TEXT,
    "category" "BillingCategory",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryable" BOOLEAN,
    "latencyMs" INTEGER,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "pricingBillable" BOOLEAN,
    "pricingType" TEXT,
    "pricingCategory" TEXT,
    "pricingModel" TEXT,
    "metaConversationId" TEXT,
    "conversationExpiresAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "webhookEventId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "wabaId" UUID,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "declaredCategory" "TemplateCategory" NOT NULL,
    "metaCategory" "TemplateCategory",
    "correctCategory" "TemplateCategory",
    "previousCategory" "TemplateCategory",
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "components" JSONB NOT NULL,
    "quality" TEXT,
    "externalId" TEXT,
    "consolidationParam" TEXT,
    "maxParamLength" INTEGER NOT NULL DEFAULT 1024,
    "analyzedCategory" "TemplateCategory",
    "classificationConfidence" DECIMAL(5,4),
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "analysisNotes" JSONB,
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPolicyVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "sourceUrl" TEXT NOT NULL,
    "sourceCheckedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "notes" TEXT,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT '*',
    "currency" TEXT NOT NULL DEFAULT '*',
    "messageCategory" "BillingCategory" NOT NULL,
    "billable" BOOLEAN NOT NULL,
    "baseRate" DECIMAL(18,8),
    "tierStart" INTEGER,
    "tierEnd" INTEGER,
    "freeEligibility" TEXT[],
    "freeQuota" INTEGER,
    "freeQuotaScope" "QuotaScope",
    "tiered" BOOLEAN NOT NULL DEFAULT false,
    "requiresCustomerServiceWindow" BOOLEAN NOT NULL DEFAULT false,
    "customerServiceWindowHours" INTEGER NOT NULL,
    "freeEntryPointWindowHours" INTEGER NOT NULL,
    "freeEntryPointReplyHours" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "sourceUrl" TEXT NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalogImport" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "sourceUrl" TEXT NOT NULL,
    "sourceDocument" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "marketAliases" JSONB,
    "marketMappingVersion" TEXT,
    "rowCount" INTEGER NOT NULL,
    "importedBy" TEXT,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceCatalogImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalog" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "category" "BillingCategory" NOT NULL,
    "tierStart" INTEGER NOT NULL DEFAULT 1,
    "tierEnd" INTEGER,
    "unitRate" DECIMAL(18,8) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "sourceUrl" TEXT NOT NULL,
    "sourceDocument" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksum" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PriceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTier" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "category" "BillingCategory" NOT NULL,
    "tierIndex" INTEGER NOT NULL,
    "tierStart" INTEGER NOT NULL,
    "tierEnd" INTEGER,
    "label" TEXT NOT NULL,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeQuotaCounter" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "businessAccountId" UUID,
    "wabaId" UUID,
    "phoneNumberId" UUID,
    "scope" "QuotaScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "category" "BillingCategory" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "usedConfirmed" INTEGER NOT NULL DEFAULT 0,
    "quota" INTEGER NOT NULL,
    "sourcePolicyVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FreeQuotaCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierAccrual" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "businessAccountId" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "category" "BillingCategory" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "chargedCount" INTEGER NOT NULL DEFAULT 0,
    "chargedConfirmed" INTEGER NOT NULL DEFAULT 0,
    "metaReportedTier" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TierAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationPolicy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "maxDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "debounceSeconds" INTEGER NOT NULL DEFAULT 0,
    "allowAggregation" BOOLEAN NOT NULL DEFAULT false,
    "allowSupersession" BOOLEAN NOT NULL DEFAULT false,
    "allowDeduplication" BOOLEAN NOT NULL DEFAULT true,
    "dedupWindowSeconds" INTEGER NOT NULL DEFAULT 86400,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "requiresImmediateDelivery" BOOLEAN NOT NULL DEFAULT false,
    "supersessionGroup" TEXT,
    "consolidationTemplate" TEXT,
    "defaultTemplate" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" "BillingCategory",
    "allowFreeFormInWindow" BOOLEAN NOT NULL DEFAULT false,
    "maxConsolidatedItems" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OptimizationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRuleSet" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationDecision" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "intentId" UUID NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "reasons" TEXT[],
    "explanation" JSONB NOT NULL,
    "sendAt" TIMESTAMPTZ(3),
    "estimatedSavings" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "opportunities" JSONB,
    "rulesetVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostDecision" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageIntentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "category" "BillingCategory" NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "baseRate" DECIMAL(18,8),
    "effectiveRate" DECIMAL(18,8) NOT NULL,
    "isFree" BOOLEAN NOT NULL,
    "freeReason" TEXT,
    "pricingStatus" "PricingStatus" NOT NULL,
    "tier" TEXT,
    "policyVersion" TEXT,
    "rateCardId" TEXT,
    "estimatedCost" DECIMAL(18,8) NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "intentId" UUID,
    "day" DATE NOT NULL,
    "kind" "SavingsKind" NOT NULL,
    "mechanism" "SavingsMechanism" NOT NULL,
    "baselineCost" DECIMAL(18,8) NOT NULL,
    "optimizedCost" DECIMAL(18,8) NOT NULL,
    "savings" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "category" "BillingCategory",
    "eventType" TEXT,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SavingsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "intents" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "messagesDelivered" INTEGER NOT NULL DEFAULT 0,
    "messagesRead" INTEGER NOT NULL DEFAULT 0,
    "messagesFailed" INTEGER NOT NULL DEFAULT 0,
    "deduplicated" INTEGER NOT NULL DEFAULT 0,
    "superseded" INTEGER NOT NULL DEFAULT 0,
    "consolidated" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "freeEntryPoint" INTEGER NOT NULL DEFAULT 0,
    "freeQuota" INTEGER NOT NULL DEFAULT 0,
    "freeWindow" INTEGER NOT NULL DEFAULT 0,
    "baselineCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "realizedCost" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "estimatedSavings" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "realizedSavings" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "bspSavings" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "infraSavings" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "byCategory" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "provider" "ProviderKind" NOT NULL,
    "field" TEXT,
    "payloadHash" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "rawPayload" JSONB,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "rawPurgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "dedupKey" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRetentionPolicy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "rawWebhookRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "payloadRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "customerHash" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "report" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "results" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExperimentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL,
    "cost" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyFee" DECIMAL(18,8) NOT NULL,
    "savingsShare" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "includedIntents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "plan" "PlanCode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "intents" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "BusinessAccount_tenantId_idx" ON "BusinessAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccount_tenantId_metaBusinessId_key" ON "BusinessAccount"("tenantId", "metaBusinessId");

-- CreateIndex
CREATE INDEX "Waba_tenantId_idx" ON "Waba"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Waba_metaWabaId_key" ON "Waba"("metaWabaId");

-- CreateIndex
CREATE INDEX "PhoneNumber_tenantId_idx" ON "PhoneNumber"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_metaPhoneNumberId_key" ON "PhoneNumber"("metaPhoneNumberId");

-- CreateIndex
CREATE INDEX "OnboardingSession_tenantId_idx" ON "OnboardingSession"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_phoneHash_key" ON "Customer"("tenantId", "phoneHash");

-- CreateIndex
CREATE INDEX "ConsentRecord_tenantId_customerId_occurredAt_idx" ON "ConsentRecord"("tenantId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_updatedAt_idx" ON "Conversation"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_phoneNumberId_customerId_key" ON "Conversation"("tenantId", "phoneNumberId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerServiceWindow_conversationId_key" ON "CustomerServiceWindow"("conversationId");

-- CreateIndex
CREATE INDEX "CustomerServiceWindow_tenantId_phoneNumberId_customerPhoneH_idx" ON "CustomerServiceWindow"("tenantId", "phoneNumberId", "customerPhoneHash");

-- CreateIndex
CREATE INDEX "ConversationEntryPoint_tenantId_conversationId_userMessageA_idx" ON "ConversationEntryPoint"("tenantId", "conversationId", "userMessageAt");

-- CreateIndex
CREATE INDEX "ConversationEvent_tenantId_intentId_occurredAt_idx" ON "ConversationEvent"("tenantId", "intentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConversationEvent_tenantId_conversationId_occurredAt_idx" ON "ConversationEvent"("tenantId", "conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_groupKey_status_idx" ON "MessageIntent"("tenantId", "groupKey", "status");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_eventHash_requestedAt_idx" ON "MessageIntent"("tenantId", "eventHash", "requestedAt");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_status_scheduledFor_idx" ON "MessageIntent"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_requestedAt_idx" ON "MessageIntent"("tenantId", "requestedAt");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_eventType_requestedAt_idx" ON "MessageIntent"("tenantId", "eventType", "requestedAt");

-- CreateIndex
CREATE INDEX "MessageIntent_tenantId_customerId_requestedAt_idx" ON "MessageIntent"("tenantId", "customerId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageIntent_tenantId_idempotencyKey_key" ON "MessageIntent"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_providerMessageId_key" ON "MessageAttempt"("providerMessageId");

-- CreateIndex
CREATE INDEX "MessageAttempt_tenantId_requestedAt_idx" ON "MessageAttempt"("tenantId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_intentId_attemptNumber_key" ON "MessageAttempt"("intentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "MessageDelivery_tenantId_occurredAt_idx" ON "MessageDelivery"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_providerMessageId_status_key" ON "MessageDelivery"("providerMessageId", "status");

-- CreateIndex
CREATE INDEX "Template_tenantId_status_idx" ON "Template"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Template_tenantId_name_language_key" ON "Template"("tenantId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_policyVersionId_market_currency_messageCategory_key" ON "PricingRule"("policyVersionId", "market", "currency", "messageCategory");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalogImport_checksum_key" ON "PriceCatalogImport"("checksum");

-- CreateIndex
CREATE INDEX "PriceCatalog_market_currency_category_effectiveFrom_idx" ON "PriceCatalog"("market", "currency", "category", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PriceCatalog_importId_idx" ON "PriceCatalog"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_importId_market_category_tierIndex_key" ON "PricingTier"("importId", "market", "category", "tierIndex");

-- CreateIndex
CREATE UNIQUE INDEX "FreeQuotaCounter_tenantId_scope_scopeKey_category_periodKey_key" ON "FreeQuotaCounter"("tenantId", "scope", "scopeKey", "category", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "TierAccrual_tenantId_businessAccountId_market_category_peri_key" ON "TierAccrual"("tenantId", "businessAccountId", "market", "category", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "OptimizationPolicy_tenantId_eventType_key" ON "OptimizationPolicy"("tenantId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRuleSet_tenantId_name_key" ON "PolicyRuleSet"("tenantId", "name");

-- CreateIndex
CREATE INDEX "OptimizationDecision_tenantId_intentId_createdAt_idx" ON "OptimizationDecision"("tenantId", "intentId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationDecision_tenantId_createdAt_idx" ON "OptimizationDecision"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CostDecision_tenantId_messageIntentId_idx" ON "CostDecision"("tenantId", "messageIntentId");

-- CreateIndex
CREATE INDEX "CostDecision_tenantId_createdAt_idx" ON "CostDecision"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SavingsRecord_tenantId_day_idx" ON "SavingsRecord"("tenantId", "day");

-- CreateIndex
CREATE INDEX "SavingsRecord_tenantId_kind_day_idx" ON "SavingsRecord"("tenantId", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsRecord_intentId_kind_mechanism_key" ON "SavingsRecord"("intentId", "kind", "mechanism");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_tenantId_day_currency_key" ON "DailyMetric"("tenantId", "day", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_payloadHash_key" ON "WebhookEvent"("payloadHash");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_tenantId_receivedAt_idx" ON "WebhookEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupKey_key" ON "Alert"("dedupKey");

-- CreateIndex
CREATE INDEX "Alert_tenantId_createdAt_idx" ON "Alert"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_tenantId_key" ON "DataRetentionPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_tenantId_createdAt_idx" ON "DataSubjectRequest"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_createdAt_idx" ON "ImportJob"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperimentRun_tenantId_createdAt_idx" ON "ExperimentRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_tenantId_createdAt_idx" ON "AiUsage"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_tenantId_periodKey_key" ON "Usage"("tenantId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_periodKey_key" ON "Invoice"("tenantId", "periodKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waba" ADD CONSTRAINT "Waba_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waba" ADD CONSTRAINT "Waba_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "BusinessAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_wabaId_fkey" FOREIGN KEY ("wabaId") REFERENCES "Waba"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerServiceWindow" ADD CONSTRAINT "CustomerServiceWindow_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEntryPoint" ADD CONSTRAINT "ConversationEntryPoint_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEvent" ADD CONSTRAINT "ConversationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntent" ADD CONSTRAINT "MessageIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageIntent" ADD CONSTRAINT "MessageIntent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MessageIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "MessageAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_wabaId_fkey" FOREIGN KEY ("wabaId") REFERENCES "Waba"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PricingPolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCatalog" ADD CONSTRAINT "PriceCatalog_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PriceCatalogImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PriceCatalogImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationPolicy" ADD CONSTRAINT "OptimizationPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationDecision" ADD CONSTRAINT "OptimizationDecision_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MessageIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostDecision" ADD CONSTRAINT "CostDecision_messageIntentId_fkey" FOREIGN KEY ("messageIntentId") REFERENCES "MessageIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsRecord" ADD CONSTRAINT "SavingsRecord_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MessageIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRetentionPolicy" ADD CONSTRAINT "DataRetentionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
