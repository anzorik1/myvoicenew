ALTER TYPE "VoxTransactionType" ADD VALUE 'TAP_REWARD';

ALTER TABLE "users"
  ADD COLUMN "tap_energy" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "tap_energy_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "tap_daily_earned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tap_day" DATE,
  ADD COLUMN "tap_total" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "users_tap_energy_check" CHECK ("tap_energy" >= 0),
  ADD CONSTRAINT "users_tap_daily_earned_check" CHECK ("tap_daily_earned" >= 0),
  ADD CONSTRAINT "users_tap_total_check" CHECK ("tap_total" >= 0);

CREATE INDEX "users_tap_total_idx" ON "users"("tap_total" DESC);
