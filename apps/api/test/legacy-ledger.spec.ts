import { MeController } from '../src/me.controller';

describe('legacy immutable VOX ledger compatibility', () => {
  test('old TAP_REWARD rows remain readable and are grouped as early activity', async () => {
    const row = {
      id: 'transaction-1',
      type: 'TAP_REWARD',
      amount: 25,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const prisma = {
      voxTransaction: {
        findMany: jest.fn().mockResolvedValue([row]),
        groupBy: jest.fn().mockResolvedValue([
          { type: 'TAP_REWARD', _sum: { amount: 25 } },
          { type: 'SIGNUP_BONUS', _sum: { amount: 50 } },
        ]),
      },
    };
    const controller = new MeController(prisma as never, {} as never);

    await expect(controller.transactions({ userId: 'user-1' } as never)).resolves.toEqual(
      expect.objectContaining({
        items: [row],
        summary: expect.objectContaining({ legacy: 25, registration: 50, totalEarned: 75 }),
      }),
    );
  });
});
