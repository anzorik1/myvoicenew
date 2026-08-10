ALTER TYPE "VoxTransactionType" ADD VALUE 'AD_REWARD';

CREATE TYPE "AdCampaignType" AS ENUM ('BANNER', 'REWARDED');
CREATE TYPE "AdCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');

CREATE TABLE "ad_campaigns" (
  "id" UUID NOT NULL,
  "type" "AdCampaignType" NOT NULL,
  "status" "AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "image_url" VARCHAR(2000),
  "media_url" VARCHAR(2000),
  "target_url" VARCHAR(2000),
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  "reward_vox" INTEGER NOT NULL DEFAULT 0,
  "minimum_watch_seconds" INTEGER NOT NULL DEFAULT 0,
  "daily_reward_limit" INTEGER NOT NULL DEFAULT 1,
  "impression_count" BIGINT NOT NULL DEFAULT 0,
  "click_count" BIGINT NOT NULL DEFAULT 0,
  "reward_count" BIGINT NOT NULL DEFAULT 0,
  "created_by_admin_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_campaign_reward_check" CHECK ("reward_vox" >= 0),
  CONSTRAINT "ad_campaign_watch_check" CHECK ("minimum_watch_seconds" >= 0 AND "minimum_watch_seconds" <= 3600),
  CONSTRAINT "ad_campaign_daily_limit_check" CHECK ("daily_reward_limit" >= 1 AND "daily_reward_limit" <= 100)
);

CREATE TABLE "ad_campaign_translations" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "language" VARCHAR(8) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "action_label" VARCHAR(80) NOT NULL,
  CONSTRAINT "ad_campaign_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ad_reward_sessions" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_request_id" VARCHAR(80) NOT NULL,
  "reward_day" DATE NOT NULL,
  "watched_seconds" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  CONSTRAINT "ad_reward_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_reward_watched_check" CHECK ("watched_seconds" >= 0)
);

ALTER TABLE "vox_transactions" ADD COLUMN "ad_reward_session_id" UUID;

CREATE UNIQUE INDEX "ad_campaign_translations_campaign_id_language_key" ON "ad_campaign_translations"("campaign_id", "language");
CREATE INDEX "ad_campaigns_status_type_starts_at_ends_at_idx" ON "ad_campaigns"("status", "type", "starts_at", "ends_at");
CREATE INDEX "ad_campaigns_created_at_idx" ON "ad_campaigns"("created_at" DESC);
CREATE UNIQUE INDEX "ad_reward_sessions_user_id_client_request_id_key" ON "ad_reward_sessions"("user_id", "client_request_id");
CREATE INDEX "ad_reward_sessions_user_id_campaign_id_reward_day_claimed_at_idx" ON "ad_reward_sessions"("user_id", "campaign_id", "reward_day", "claimed_at");
CREATE INDEX "ad_reward_sessions_campaign_id_claimed_at_idx" ON "ad_reward_sessions"("campaign_id", "claimed_at");
CREATE UNIQUE INDEX "vox_transactions_ad_reward_session_id_key" ON "vox_transactions"("ad_reward_session_id");

ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_campaign_translations" ADD CONSTRAINT "ad_campaign_translations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_reward_sessions" ADD CONSTRAINT "ad_reward_sessions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_reward_sessions" ADD CONSTRAINT "ad_reward_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_ad_reward_session_id_fkey" FOREIGN KEY ("ad_reward_session_id") REFERENCES "ad_reward_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
