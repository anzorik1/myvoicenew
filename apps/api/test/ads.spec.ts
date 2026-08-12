import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdCampaignInputDto, AdminAdsController, AdsService } from '../src/ads.controller';
import { AuthRequest } from '../src/common';

describe('advertising rewards', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const campaignId = '00000000-0000-4000-8000-000000000002';
  const sessionId = '00000000-0000-4000-8000-000000000003';

  test('a repeated claim creates exactly one VOX award', async () => {
    const campaign = {
      id: campaignId,
      minimumWatchSeconds: 15,
      rewardVox: 7,
      dailyRewardLimit: 1,
    };
    const state: {
      claimedAt: Date | null;
      transaction: { amount: number; balanceAfter: number } | null;
    } = { claimedAt: null, transaction: null };
    const session = () => ({
      id: sessionId,
      userId,
      campaignId,
      rewardDay: new Date('2026-08-10T00:00:00.000Z'),
      watchedSeconds: 15,
      expiresAt: new Date('2099-08-10T00:30:00.000Z'),
      claimedAt: state.claimedAt,
      campaign,
      transaction: state.transaction,
    });
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: sessionId }]),
      adRewardSession: {
        findUnique: jest.fn(async () => session()),
        count: jest.fn(async () => 0),
        update: jest.fn(async ({ data }: { data: { claimedAt: Date } }) => {
          state.claimedAt = data.claimedAt;
          return session();
        }),
      },
      adCampaign: { update: jest.fn(async () => campaign) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const award = jest.fn(async () => {
      state.transaction = { amount: 7, balanceAfter: 107 };
      return state.transaction;
    });
    const service = new AdsService(prisma as never, { award } as never);

    await expect(service.claim(userId, sessionId)).resolves.toEqual({
      claimed: true,
      reward: 7,
      balance: 107,
    });
    await expect(service.claim(userId, sessionId)).resolves.toEqual({
      claimed: true,
      reward: 7,
      balance: 107,
    });

    expect(award).toHaveBeenCalledTimes(1);
    expect(award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'AD_REWARD',
        idempotencyKey: `ad-reward:${sessionId}`,
        adRewardSessionId: sessionId,
      }),
    );
    expect(tx.adCampaign.update).toHaveBeenCalledTimes(1);
  });

  test('a concurrent repeated start returns the existing session', async () => {
    const repeated = {
      id: sessionId,
      campaignId,
      watchedSeconds: 4,
      expiresAt: new Date('2099-08-10T00:30:00.000Z'),
      claimedAt: null,
      campaign: { minimumWatchSeconds: 15 },
    };
    const tx = {
      $queryRaw: jest.fn(async () => []),
      adRewardSession: {
        findUnique: jest.fn(async () => repeated),
        count: jest.fn(),
        create: jest.fn(),
      },
      adCampaign: { findFirst: jest.fn() },
    };
    const prisma = {
      adRewardSession: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdsService(prisma as never, {} as never);

    await expect(service.startRewardSession(userId, campaignId, 'same-request')).resolves.toEqual(
      expect.objectContaining({ id: sessionId, watchedSeconds: 4, remainingSeconds: 11 }),
    );

    expect(tx.adRewardSession.create).not.toHaveBeenCalled();
    expect(tx.adCampaign.findFirst).not.toHaveBeenCalled();
  });

  test('the per-user daily limit reserves active sessions atomically', async () => {
    const tx = {
      $queryRaw: jest.fn(async () => []),
      adRewardSession: {
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 1),
        create: jest.fn(),
      },
      adCampaign: {
        findFirst: jest.fn(async () => ({ minimumWatchSeconds: 15, dailyRewardLimit: 1 })),
      },
    };
    const prisma = {
      adRewardSession: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AdsService(prisma as never, {} as never);

    await expect(service.startRewardSession(userId, campaignId, 'new-request')).rejects.toThrow(
      'Daily advertisement reward limit reached',
    );
    expect(tx.adRewardSession.create).not.toHaveBeenCalled();
  });

  test('admin campaign DTO accepts localized English and Russian content', async () => {
    const dto = plainToInstance(AdCampaignInputDto, {
      type: 'BANNER',
      startsAt: '2026-08-10T12:00:00.000Z',
      targetUrl: 'https://example.com',
      rewardVox: 0,
      minimumWatchSeconds: 0,
      dailyRewardLimit: 1,
      translations: [
        { language: 'en', title: 'Campaign', description: 'Description', actionLabel: 'Open' },
        { language: 'ru', title: 'Кампания', description: 'Описание', actionLabel: 'Открыть' },
      ],
    });

    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual(
      [],
    );
  });

  test('admin campaign audit safely serializes bigint counters', async () => {
    const campaign = {
      id: campaignId,
      type: 'BANNER',
      status: 'DRAFT',
      imageUrl: null,
      mediaUrl: null,
      targetUrl: 'https://example.com',
      startsAt: new Date('2026-08-10T12:00:00.000Z'),
      endsAt: null,
      rewardVox: 0,
      minimumWatchSeconds: 0,
      dailyRewardLimit: 1,
      impressionCount: 0n,
      clickCount: 0n,
      rewardCount: 0n,
      createdByAdminId: userId,
      createdAt: new Date('2026-08-10T12:00:00.000Z'),
      updatedAt: new Date('2026-08-10T12:00:00.000Z'),
      deletedAt: null,
      translations: [
        { language: 'en', title: 'Campaign', description: 'Description', actionLabel: 'Open' },
        { language: 'ru', title: 'Кампания', description: 'Описание', actionLabel: 'Открыть' },
      ],
    };
    const audit = jest.fn(async (args: unknown) => {
      JSON.stringify(args);
      return { id: 'audit-id' };
    });
    const prisma = {
      adCampaign: { create: jest.fn(async () => campaign) },
      adminAuditLog: { create: audit },
    };
    const controller = new AdminAdsController(prisma as never);
    const dto = plainToInstance(AdCampaignInputDto, {
      type: 'BANNER',
      startsAt: '2026-08-10T12:00:00.000Z',
      targetUrl: 'https://example.com',
      rewardVox: 0,
      minimumWatchSeconds: 0,
      dailyRewardLimit: 1,
      translations: campaign.translations,
    });

    await expect(controller.create({ adminId: userId } as AuthRequest, dto)).resolves.toEqual(
      expect.objectContaining({ impressionCount: 0, clickCount: 0, rewardCount: 0 }),
    );
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: expect.objectContaining({ impressionCount: '0', clickCount: '0', rewardCount: '0' }),
      }),
    });
  });

  test('an expired campaign cannot be published', async () => {
    const expired = {
      id: campaignId,
      translations: [{ language: 'en' }, { language: 'ru' }],
      endsAt: new Date('2020-01-01T00:00:00.000Z'),
    };
    const update = jest.fn();
    const prisma = {
      adCampaign: {
        findUniqueOrThrow: jest.fn(async () => expired),
        update,
      },
    };
    const controller = new AdminAdsController(prisma as never);

    await expect(
      controller.activate({ adminId: userId } as AuthRequest, campaignId),
    ).rejects.toThrow('Campaign has already ended');
    expect(update).not.toHaveBeenCalled();
  });
});
