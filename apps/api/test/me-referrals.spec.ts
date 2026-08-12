import { MeController } from '../src/me.controller';
import { AuthRequest } from '../src/common';

describe('referral profile visibility', () => {
  test('a referrer sees invited people without Telegram or internal IDs', async () => {
    const now = new Date();
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'referrer-id',
          referralCode: 'VOICE123',
          activityRate: 91,
        })),
      },
      referral: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        findMany: jest.fn(async () => [
          {
            createdAt: now,
            invitee: {
              firstName: 'Anna',
              lastName: 'Voice',
              username: 'anna_voice',
              status: 'ACTIVE',
              registrationCompletedAt: now,
              lastActivityAt: now,
              ownVotesCount: 3,
            },
          },
        ]),
      },
      voxTransaction: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 9 } })),
      },
    };
    const controller = new MeController(prisma as never, {} as never);

    const result = await controller.referrals({ userId: 'referrer-id' } as AuthRequest);

    expect(result.invitees).toEqual([
      {
        firstName: 'Anna',
        lastName: 'Voice',
        username: 'anna_voice',
        joinedAt: now,
        registrationCompleted: true,
        active: true,
        votes: 3,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('telegramId');
    expect(JSON.stringify(result)).not.toContain('inviteeId');
  });
});
