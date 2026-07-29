-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "VoteStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoteResultStatus" AS ENUM ('PENDING', 'OPTION_WIN', 'TIE');

-- CreateEnum
CREATE TYPE "VoxTransactionType" AS ENUM ('SIGNUP_BONUS', 'VOTE_REWARD', 'REFERRAL_SIGNUP_REWARD', 'REFERRAL_VOTE_REWARD', 'EARLY_VOTE_BONUS', 'WINNER_REWARD', 'LOSER_REWARD', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "first_name" VARCHAR(128) NOT NULL,
    "last_name" VARCHAR(128),
    "language_code" VARCHAR(8) NOT NULL DEFAULT 'en',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registration_completed_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vox_balance" INTEGER NOT NULL DEFAULT 0,
    "own_votes_count" INTEGER NOT NULL DEFAULT 0,
    "eligible_votes_count" INTEGER NOT NULL DEFAULT 0,
    "completed_votes_participated" INTEGER NOT NULL DEFAULT 0,
    "activity_rate" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "referral_code" VARCHAR(20) NOT NULL,
    "suggestion_blocked" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "terms_version" VARCHAR(20) NOT NULL,
    "privacy_version" VARCHAR(20) NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" VARCHAR(64),

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token_hash" VARCHAR(64) NOT NULL,
    "refresh_token_hash" VARCHAR(64) NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "invitee_id" UUID NOT NULL,
    "source_code" VARCHAR(20) NOT NULL,
    "signup_rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" UUID NOT NULL,
    "status" "VoteStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "image_url" TEXT,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "result_status" "VoteResultStatus" NOT NULL DEFAULT 'PENDING',
    "winner_option_id" UUID,
    "result_published_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "early_reward_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_translations" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "vote_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_options" (
    "id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "vote_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vote_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_option_translations" (
    "id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "text" VARCHAR(160) NOT NULL,

    CONSTRAINT "vote_option_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_votes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vote_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "client_request_id" VARCHAR(80) NOT NULL,
    "reward_state" VARCHAR(20) NOT NULL DEFAULT 'PAID',
    "early_rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vox_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VoxTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "vote_id" UUID,
    "user_vote_id" UUID,
    "referral_id" UUID,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "comment" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vox_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_suggestions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "language" VARCHAR(8) NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vote_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_suggestion_translations" (
    "id" UUID NOT NULL,
    "suggestion_id" UUID NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT NOT NULL,
    "option_one" VARCHAR(160) NOT NULL,
    "option_two" VARCHAR(160) NOT NULL,

    CONSTRAINT "vote_suggestion_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "users_threshold" INTEGER,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(500) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(80),
    "before" JSONB,
    "after" JSONB,
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_status_last_activity_at_idx" ON "users"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "users_activity_rate_idx" ON "users"("activity_rate");

-- CreateIndex
CREATE INDEX "user_consents_user_id_accepted_at_idx" ON "user_consents"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_terms_version_privacy_version_key" ON "user_consents"("user_id", "terms_version", "privacy_version");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_access_token_hash_key" ON "user_sessions"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_invitee_id_key" ON "referrals"("invitee_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "votes_status_starts_at_ends_at_idx" ON "votes"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "votes_completed_at_idx" ON "votes"("completed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vote_translations_vote_id_language_key" ON "vote_translations"("vote_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "vote_options_vote_id_position_key" ON "vote_options"("vote_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "vote_option_translations_option_id_language_key" ON "vote_option_translations"("option_id", "language");

-- CreateIndex
CREATE INDEX "user_votes_vote_id_option_id_idx" ON "user_votes"("vote_id", "option_id");

-- CreateIndex
CREATE INDEX "user_votes_user_id_created_at_idx" ON "user_votes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_votes_user_id_vote_id_key" ON "user_votes"("user_id", "vote_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_votes_user_id_client_request_id_key" ON "user_votes"("user_id", "client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "vox_transactions_idempotency_key_key" ON "vox_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "vox_transactions_user_id_created_at_idx" ON "vox_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "vox_transactions_type_created_at_idx" ON "vox_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "vote_suggestions_user_id_created_at_idx" ON "vote_suggestions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "vote_suggestions_status_created_at_idx" ON "vote_suggestions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vote_suggestion_translations_suggestion_id_language_key" ON "vote_suggestion_translations"("suggestion_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_entity_type_entity_id_idx" ON "admin_audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_winner_option_id_fkey" FOREIGN KEY ("winner_option_id") REFERENCES "vote_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_translations" ADD CONSTRAINT "vote_translations_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_options" ADD CONSTRAINT "vote_options_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_option_translations" ADD CONSTRAINT "vote_option_translations_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "vote_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_votes" ADD CONSTRAINT "user_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "vote_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_vote_id_fkey" FOREIGN KEY ("vote_id") REFERENCES "votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_user_vote_id_fkey" FOREIGN KEY ("user_vote_id") REFERENCES "user_votes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_suggestions" ADD CONSTRAINT "vote_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_suggestions" ADD CONSTRAINT "vote_suggestions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_suggestion_translations" ADD CONSTRAINT "vote_suggestion_translations_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "vote_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
