ALTER TYPE "VoxTransactionType" ADD VALUE 'TASK_REWARD';

CREATE TYPE "TaskType" AS ENUM ('TELEGRAM_CHANNEL_SUBSCRIPTION');
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

CREATE TABLE "tasks" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "type" "TaskType" NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'DRAFT',
  "reward_vox" INTEGER NOT NULL,
  "target_url" VARCHAR(2000) NOT NULL,
  "telegram_chat_id" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_reward_vox_check" CHECK ("reward_vox" > 0 AND "reward_vox" <= 1000000)
);

CREATE TABLE "task_translations" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "language" VARCHAR(8) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "action_label" VARCHAR(80) NOT NULL,
  CONSTRAINT "task_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_task_completions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_task_completions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "vox_transactions" ADD COLUMN "task_completion_id" UUID;

CREATE UNIQUE INDEX "tasks_slug_key" ON "tasks"("slug");
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at");
CREATE UNIQUE INDEX "task_translations_task_id_language_key" ON "task_translations"("task_id", "language");
CREATE UNIQUE INDEX "user_task_completions_user_id_task_id_key" ON "user_task_completions"("user_id", "task_id");
CREATE INDEX "user_task_completions_task_id_completed_at_idx" ON "user_task_completions"("task_id", "completed_at" DESC);
CREATE INDEX "user_task_completions_user_id_completed_at_idx" ON "user_task_completions"("user_id", "completed_at" DESC);
CREATE UNIQUE INDEX "vox_transactions_task_completion_id_key" ON "vox_transactions"("task_completion_id");

ALTER TABLE "task_translations" ADD CONSTRAINT "task_translations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_task_completions" ADD CONSTRAINT "user_task_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_task_completions" ADD CONSTRAINT "user_task_completions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vox_transactions" ADD CONSTRAINT "vox_transactions_task_completion_id_fkey" FOREIGN KEY ("task_completion_id") REFERENCES "user_task_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "tasks" ("id", "slug", "type", "status", "reward_vox", "target_url", "telegram_chat_id", "updated_at")
VALUES ('30000000-0000-4000-8000-000000000001', 'subscribe-myvoice-channel', 'TELEGRAM_CHANNEL_SUBSCRIPTION', 'PAUSED', 10, 'https://t.me/myvoiceTGC', '@myvoiceTGC', CURRENT_TIMESTAMP);

INSERT INTO "task_translations" ("id", "task_id", "language", "title", "description", "action_label") VALUES
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'en', 'Join the MyVoice channel', 'Follow project news, new votes and important updates in the official channel.', 'Open channel'),
  ('31000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'ru', 'Подпишитесь на канал MyVoice', 'Следите за новостями проекта, новыми голосованиями и важными обновлениями в официальном канале.', 'Открыть канал');
