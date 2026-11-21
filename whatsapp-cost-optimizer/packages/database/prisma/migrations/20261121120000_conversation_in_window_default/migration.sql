-- "Mandar como conversa" becomes built in: inside the 24 h customer service window, a template's
-- content may go as a service message when that is cheaper. Authentication is never converted
-- (enforced in code) and marketing consent still applies.
ALTER TABLE "OptimizationPolicy" ALTER COLUMN "allowFreeFormInWindow" SET DEFAULT true;
ALTER TABLE "OptimizationPolicy" ALTER COLUMN "allowMarketingFreeFormInWindow" SET DEFAULT true;

-- Existing policies follow the new default.
UPDATE "OptimizationPolicy" SET "allowFreeFormInWindow" = true, "allowMarketingFreeFormInWindow" = true;
