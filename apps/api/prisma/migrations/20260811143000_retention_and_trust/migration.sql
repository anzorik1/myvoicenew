CREATE TYPE "NotificationKind" AS ENUM ('VOTE_STARTED', 'VOTE_ENDING', 'VOTE_RESULT');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "VoteReportReason" AS ENUM ('MISLEADING', 'OFFENSIVE', 'BIASED', 'OTHER');
CREATE TYPE "VoteReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

ALTER TABLE "users"
  ADD COLUMN "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_new_votes" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_vote_ending" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_results" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "vote_translations" ADD COLUMN "context" TEXT;

CREATE TABLE "vote_sources" (
  "id" UUID NOT NULL,
  "vote_id" UUID NOT NULL,
  "language" VARCHAR(8) NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "url" VARCHAR(2000) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vote_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vote_sources_position_check" CHECK ("position" >= 1 AND "position" <= 10)
);

CREATE TABLE "user_notifications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "vote_id" UUID NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vote_reports" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "vote_id" UUID NOT NULL,
  "reason" "VoteReportReason" NOT NULL,
  "details" VARCHAR(1000),
  "status" "VoteReportStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_admin_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vote_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vote_shares" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "vote_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vote_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vote_sources_vote_id_language_position_key" ON "vote_sources"("vote_id", "language", "position");
CREATE INDEX "vote_sources_vote_id_language_idx" ON "vote_sources"("vote_id", "language");
CREATE UNIQUE INDEX "user_notifications_idempotency_key_key" ON "user_notifications"("idempotency_key");
CREATE UNIQUE INDEX "user_notifications_user_id_vote_id_kind_key" ON "user_notifications"("user_id", "vote_id", "kind");
CREATE INDEX "user_notifications_status_created_at_idx" ON "user_notifications"("status", "created_at");
CREATE INDEX "user_notifications_user_id_created_at_idx" ON "user_notifications"("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "vote_reports_user_id_vote_id_key" ON "vote_reports"("user_id", "vote_id");
CREATE INDEX "vote_reports_status_created_at_idx" ON "vote_reports"("status", "created_at" DESC);
CREATE INDEX "vote_reports_vote_id_created_at_idx" ON "vote_reports"("vote_id", "created_at" DESC);
CREATE UNIQUE INDEX "vote_shares_token_hash_key" ON "vote_shares"("token_hash");
CREATE INDEX "vote_shares_user_id_created_at_idx" ON "vote_shares"("user_id", "created_at" DESC);
CREATE INDEX "vote_shares_vote_id_created_at_idx" ON "vote_shares"("vote_id", "created_at" DESC);
CREATE INDEX "vote_shares_expires_at_idx" ON "vote_shares"("expires_at");

ALTER TABLE "vote_sources" ADD CONSTRAINT "vote_sources_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vote_reports" ADD CONSTRAINT "vote_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vote_reports" ADD CONSTRAINT "vote_reports_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vote_reports" ADD CONSTRAINT "vote_reports_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vote_shares" ADD CONSTRAINT "vote_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vote_shares" ADD CONSTRAINT "vote_shares_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
