import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminController, VoteInputDto } from '../src/admin.controller';
import { AuthRequest } from '../src/common';

describe('admin vote deletion', () => {
  const adminId = '00000000-0000-4000-8000-000000000001';
  const voteId = '00000000-0000-4000-8000-000000000002';

  const setup = (row: { status: string; participant_count: number }) => {
    const update = jest.fn(async () => ({ id: voteId }));
    const audit = jest.fn(async () => ({ id: 'audit-id' }));
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: voteId, deleted_at: null, ...row }]),
      vote: { update },
      adminAuditLog: { create: audit },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    };
    return {
      controller: new AdminController(prisma as never, {} as never, {} as never),
      update,
      audit,
    };
  };

  test('soft-deletes any vote and records the admin action', async () => {
    const { controller, update, audit } = setup({ status: 'COMPLETED', participant_count: 3 });

    await expect(controller.deleteVote({ adminId } as AuthRequest, voteId)).resolves.toEqual({
      deleted: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: voteId },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId,
        action: 'VOTE_DELETE',
        entityType: 'Vote',
        entityId: voteId,
      }),
    });
  });

  test('accepts the nested vote payload that the admin form sends', async () => {
    const payload = plainToInstance(VoteInputDto, {
      startsAt: '2026-08-10T12:00:00.000Z',
      endsAt: '2026-08-11T12:00:00.000Z',
      winnerReward: 25,
      loserReward: 5,
      translations: [
        { language: 'en', title: 'English title', description: 'English description' },
        { language: 'ru', title: 'Русский заголовок', description: 'Русское описание' },
      ],
      options: [
        { position: 1, translations: [{ language: 'en', text: 'Yes' }, { language: 'ru', text: 'Да' }] },
        { position: 2, translations: [{ language: 'en', text: 'No' }, { language: 'ru', text: 'Нет' }] },
      ],
    });

    await expect(validate(payload, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
  });
});
