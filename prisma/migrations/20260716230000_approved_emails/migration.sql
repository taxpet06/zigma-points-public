-- CreateTable
CREATE TABLE "approved_emails" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approved_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approved_emails_email_key" ON "approved_emails"("email");

-- Seed the allowlist with every email that already has an account, so enabling
-- the gate never locks out an existing user. Runs per-environment, so prod seeds
-- from prod's own users rather than a list hardcoded at development time.
-- DISTINCT + ON CONFLICT: two accounts differing only by case collapse to one row.
INSERT INTO "approved_emails" ("id", "email")
SELECT gen_random_uuid()::text, DISTINCT_EMAILS.email
FROM (SELECT DISTINCT lower(trim("email")) AS email FROM "users" WHERE "email" IS NOT NULL) AS DISTINCT_EMAILS
ON CONFLICT ("email") DO NOTHING;
