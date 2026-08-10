ALTER TABLE "votes"
ADD COLUMN "winner_reward" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "loser_reward" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "votes"
ADD CONSTRAINT "votes_winner_reward_nonnegative" CHECK ("winner_reward" >= 0),
ADD CONSTRAINT "votes_loser_reward_nonnegative" CHECK ("loser_reward" >= 0);
