import { VotesService } from '../src/votes.service';

describe('configured outcome rewards', () => {
  test('pays the configured winner and loser amounts when a vote completes', async () => {
    const voteId = '00000000-0000-4000-8000-000000000010';
    const winnerOptionId = '00000000-0000-4000-8000-000000000011';
    const loserOptionId = '00000000-0000-4000-8000-000000000012';
    const userVotes = [
      { id: 'uv-winner', userId: 'user-winner', optionId: winnerOptionId },
      { id: 'uv-loser', userId: 'user-loser', optionId: loserOptionId },
    ];
    const tx = {
      $queryRaw: jest.fn(async () => [
        {
          status: 'ACTIVE',
          starts_at: new Date(Date.now() - 172_800_000),
          ends_at: new Date(Date.now() - 1_000),
          deleted_at: null,
          winner_reward: 25,
          loser_reward: 5,
        },
      ]),
      userVote: {
        groupBy: jest.fn(async () => [
          { optionId: winnerOptionId, _count: { _all: 2 } },
          { optionId: loserOptionId, _count: { _all: 1 } },
        ]),
        findMany: jest.fn(async () => userVotes),
      },
      voteOption: {
        findMany: jest.fn(async () => [
          { id: winnerOptionId, position: 1 },
          { id: loserOptionId, position: 2 },
        ]),
        update: jest.fn(async () => ({})),
      },
      vote: { update: jest.fn(async () => ({})) },
      user: {
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const award = jest.fn(async () => ({}));
    const service = new VotesService(prisma as never, { award } as never);

    await service.complete(voteId);

    expect(award).toHaveBeenCalledTimes(2);
    expect(award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-winner',
        type: 'WINNER_REWARD',
        amount: 25,
        idempotencyKey: 'vote:uv-winner:outcome:WINNER_REWARD',
      }),
    );
    expect(award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-loser',
        type: 'LOSER_REWARD',
        amount: 5,
        idempotencyKey: 'vote:uv-loser:outcome:LOSER_REWARD',
      }),
    );
  });
});
