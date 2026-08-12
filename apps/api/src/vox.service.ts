import { Injectable } from '@nestjs/common';
import { Prisma, VoxTransactionType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

@Injectable()
export class VoxService {
  async award(
    tx: Tx,
    input: {
      userId: string;
      type: VoxTransactionType;
      amount: number;
      idempotencyKey: string;
      comment: string;
      voteId?: string;
      userVoteId?: string;
      referralId?: string;
      adRewardSessionId?: string;
      taskCompletionId?: string;
    },
  ) {
    const existing = await tx.voxTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    const rows = await tx.$queryRaw<Array<{ vox_balance: number }>>`
      SELECT vox_balance FROM users WHERE id = ${input.userId}::uuid FOR UPDATE
    `;
    const before = rows[0]?.vox_balance;
    if (before === undefined) throw new Error('VOX recipient does not exist');
    const after = before + input.amount;
    if (after < 0) throw new Error('VOX balance cannot become negative');
    await tx.user.update({ where: { id: input.userId }, data: { voxBalance: after } });
    return tx.voxTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceBefore: before,
        balanceAfter: after,
        idempotencyKey: input.idempotencyKey,
        comment: input.comment,
        voteId: input.voteId,
        userVoteId: input.userVoteId,
        referralId: input.referralId,
        adRewardSessionId: input.adRewardSessionId,
        taskCompletionId: input.taskCompletionId,
      },
    });
  }
}
