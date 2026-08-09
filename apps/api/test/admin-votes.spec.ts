import { BadRequestException } from '@nestjs/common';
import { AdminController } from '../src/admin.controller';
import { AuthRequest } from '../src/common';

describe('admin vote deletion', () => {
  const adminId = '00000000-0000-4000-8000-000000000001';
  const voteId = '00000000-0000-4000-8000-000000000002';

  const setup = (row: { status: string; participant_count: number }) => {
    const update = jest.fn(async () => ({ id: voteId }));
    const audit = jest.fn(async () => ({ id: 'audit-id' }));
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: voteId, deleted_at: null, ...row }]),
      userVote: { count: jest.fn(async () => row.participant_count) },
      voxTransaction: { count: jest.fn(async () => row.participant_count) },
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

  test('soft-deletes an unparticipated vote and records the admin action', async () => {
    const { controller, update, audit } = setup({ status: 'SCHEDULED', participant_count: 0 });

    await expect(controller.deleteVote({ adminId } as AuthRequest, voteId)).resolves.toEqual({
      deleted: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: voteId },
      data: { status: 'CANCELLED', deletedAt: expect.any(Date) },
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

  test('does not delete a completed vote', async () => {
    const { controller, update } = setup({ status: 'COMPLETED', participant_count: 0 });

    await expect(controller.deleteVote({ adminId } as AuthRequest, voteId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  test('does not delete a vote that has participants', async () => {
    const { controller, update } = setup({ status: 'ACTIVE', participant_count: 1 });

    await expect(controller.deleteVote({ adminId } as AuthRequest, voteId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
