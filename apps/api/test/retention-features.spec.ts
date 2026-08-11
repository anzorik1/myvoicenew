import { NotificationService } from '../src/notification.service';
import { VotesService } from '../src/votes.service';

describe('retention and trust features', () => {
  const vote = {
    id: 'vote-1',
    translations: [{ language: 'en', title: 'A public question' }],
  };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.WEB_APP_URL = 'https://example.test';
    jest.restoreAllMocks();
  });

  test('a retried notification job does not send an already delivered message twice', async () => {
    const prisma = {
      vote: { findUnique: jest.fn().mockResolvedValue(vote) },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'user-1', telegramId: 42n, languageCode: 'en' }]),
      },
      userNotification: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'notification-1', status: 'SENT', lastError: null }),
      },
    };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await new NotificationService(prisma as never).notifyVote(
      'vote-1',
      'VOTE_STARTED',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: false });
  });

  test('notification preferences are enforced in the recipient database query', async () => {
    const prisma = {
      vote: { findUnique: jest.fn().mockResolvedValue(vote) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new NotificationService(prisma as never).notifyVote('vote-1', 'VOTE_ENDING');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          notificationsEnabled: true,
          notifyVoteEnding: true,
        }),
      }),
    );
  });

  test('a user can create only one report per vote', async () => {
    const prisma = {
      vote: { findUnique: jest.fn().mockResolvedValue({ id: 'vote-1', status: 'ACTIVE' }) },
      voteReport: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        create: jest.fn(),
      },
    };
    const service = new VotesService(prisma as never, {} as never);
    await expect(service.report('user-1', 'vote-1', 'MISLEADING')).resolves.toEqual({
      reported: true,
      alreadyReported: true,
      status: 'PENDING',
    });
    expect(prisma.voteReport.create).not.toHaveBeenCalled();
  });
});
