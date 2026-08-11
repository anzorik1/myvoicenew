import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TapClaimDto, TapService } from '../src/tap.controller';

describe('tap rewards', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const user = () => ({
    id: userId,
    voxBalance: 100,
    tapEnergy: 20,
    tapEnergyUpdatedAt: new Date(),
    tapDailyEarned: 0,
    tapDay: today,
    tapTotal: 12,
  });

  test('a repeated claim cannot award VOX twice', async () => {
    let current = user();
    let existing: { amount: number; balanceAfter: number } | null = null;
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: userId }]),
      user: {
        findUniqueOrThrow: jest.fn(async () => current),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          current = {
            ...current,
            tapEnergy: Number(data.tapEnergy),
            tapEnergyUpdatedAt: data.tapEnergyUpdatedAt as Date,
            tapDailyEarned: Number(data.tapDailyEarned),
            tapDay: data.tapDay as Date,
            tapTotal: current.tapTotal + 5,
          };
          return current;
        }),
      },
      voxTransaction: { findUnique: jest.fn(async () => existing) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const award = jest.fn(async () => {
      existing = { amount: 5, balanceAfter: 105 };
      return existing;
    });
    const service = new TapService(prisma as never, { award } as never);

    const first = await service.claim(userId, { taps: 5, clientRequestId: 'same-request' });
    const repeated = await service.claim(userId, { taps: 5, clientRequestId: 'same-request' });

    expect(first).toEqual(expect.objectContaining({ acceptedTaps: 5, reward: 5, balance: 105 }));
    expect(repeated).toEqual(expect.objectContaining({ acceptedTaps: 5, reward: 5, balance: 105 }));
    expect(award).toHaveBeenCalledTimes(1);
  });

  test('energy and the daily remainder cap the accepted tap batch', async () => {
    const limited = {
      ...user(),
      tapEnergy: 4,
      tapDailyEarned: 498,
      tapEnergyUpdatedAt: new Date(),
    };
    const update = jest.fn(async () => ({
      ...limited,
      voxBalance: 102,
      tapEnergy: 2,
      tapDailyEarned: 500,
      tapTotal: limited.tapTotal + 2,
    }));
    const tx = {
      $queryRaw: jest.fn(async () => []),
      user: { findUniqueOrThrow: jest.fn(async () => limited), update },
      voxTransaction: { findUnique: jest.fn(async () => null) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const award = jest.fn(async () => ({ amount: 2, balanceAfter: 102 }));
    const service = new TapService(prisma as never, { award } as never);

    await expect(
      service.claim(userId, { taps: 5, clientRequestId: 'limited-request' }),
    ).resolves.toEqual(expect.objectContaining({ acceptedTaps: 2, reward: 2, dailyRemaining: 0 }));
    expect(award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'TAP_REWARD', amount: 2 }),
    );
  });

  test('the daily limit resets on a new UTC day', async () => {
    const yesterday = new Date(today.getTime() - 86_400_000);
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn(async () => ({
          ...user(),
          tapDay: yesterday,
          tapDailyEarned: 500,
        })),
      },
    };
    const service = new TapService(prisma as never, {} as never);

    await expect(service.state(userId)).resolves.toEqual(
      expect.objectContaining({ dailyEarned: 0, dailyRemaining: 500 }),
    );
  });

  test('DTO rejects batches above the configured maximum', async () => {
    const dto = plainToInstance(TapClaimDto, { taps: 51, clientRequestId: 'request-too-large' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'taps')).toBe(true);
  });
});
