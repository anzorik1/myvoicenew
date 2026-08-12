import { BadRequestException } from '@nestjs/common';
import { TasksService } from '../src/tasks.controller';

describe('VOX tasks', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const taskId = '30000000-0000-4000-8000-000000000001';
  const completionId = '32000000-0000-4000-8000-000000000001';
  const task = {
    id: taskId,
    slug: 'subscribe-myvoice-channel',
    type: 'TELEGRAM_CHANNEL_SUBSCRIPTION',
    status: 'ACTIVE',
    rewardVox: 10,
    telegramChatId: '@myvoiceTGC',
  };
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  test('a verified subscription awards the task once', async () => {
    const state: { transaction: { amount: number } | null } = { transaction: null };
    const completion = () => ({ id: completionId, userId, taskId, transaction: state.transaction });
    const tx = {
      $queryRaw: jest.fn(async () => [{ pg_advisory_xact_lock: null }]),
      userTaskCompletion: {
        findUnique: jest.fn(async () => (state.transaction ? completion() : null)),
        create: jest.fn(async () => completion()),
      },
    };
    const prisma = {
      task: { findFirst: jest.fn(async () => task) },
      userTaskCompletion: {
        findUnique: jest.fn(async () => (state.transaction ? completion() : null)),
      },
      user: { findUniqueOrThrow: jest.fn(async () => ({ telegramId: 123456789n })) },
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    const award = jest.fn(async () => {
      state.transaction = { amount: 10 };
      return state.transaction;
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { status: 'member' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new TasksService(prisma as never, { award } as never);

    await expect(service.verify(userId, taskId)).resolves.toEqual({
      completed: true,
      alreadyCompleted: false,
      reward: 10,
    });
    await expect(service.verify(userId, taskId)).resolves.toEqual({
      completed: true,
      alreadyCompleted: true,
      reward: 10,
    });

    expect(award).toHaveBeenCalledTimes(1);
    expect(award).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId,
        type: 'TASK_REWARD',
        amount: 10,
        idempotencyKey: `task:${taskId}:${userId}`,
        taskCompletionId: completionId,
      }),
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a user who is not subscribed receives no reward', async () => {
    const prisma = {
      task: { findFirst: jest.fn(async () => task) },
      userTaskCompletion: { findUnique: jest.fn(async () => null) },
      user: { findUniqueOrThrow: jest.fn(async () => ({ telegramId: 987654321n })) },
      $transaction: jest.fn(),
    };
    const award = jest.fn();
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { status: 'left' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new TasksService(prisma as never, { award } as never);

    await expect(service.verify(userId, taskId)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(award).not.toHaveBeenCalled();
  });

  test('task list uses the user language and shows completion state', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn(async () => ({ languageCode: 'ru' })) },
      task: {
        findMany: jest.fn(async () => [
          {
            ...task,
            targetUrl: 'https://t.me/myvoiceTGC',
            createdAt: new Date(),
            translations: [
              {
                language: 'en',
                title: 'Join the channel',
                description: 'News',
                actionLabel: 'Open',
              },
              {
                language: 'ru',
                title: 'Подпишитесь на канал',
                description: 'Новости',
                actionLabel: 'Открыть',
              },
            ],
            completions: [{ completedAt: new Date('2026-08-12T12:00:00.000Z') }],
          },
        ]),
      },
    };
    const service = new TasksService(prisma as never, {} as never);

    await expect(service.list(userId)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: taskId,
          title: 'Подпишитесь на канал',
          completed: true,
          rewardVox: 10,
        }),
      ],
    });
  });
});
