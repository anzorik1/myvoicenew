import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RULES } from '@myvoice/config';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';

const localized = <T extends { language: string }>(rows: T[], language: string) =>
  rows.find((row) => row.language === language) ??
  rows.find((row) => row.language === 'en') ??
  rows[0];

@Injectable()
export class VotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
  ) {}

  async publicVote(voteId: string, userId: string, language: string, includeResult = false) {
    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId, deletedAt: null },
      include: {
        translations: true,
        options: { orderBy: { position: 'asc' }, include: { translations: true } },
        userVotes: {
          where: { userId },
          take: 1,
          include: { transactions: { select: { amount: true } } },
        },
      },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    const translation = localized(vote.translations, language);
    const own = vote.userVotes[0];
    const canShow = includeResult && vote.status === 'COMPLETED';
    const total = vote.participantCount;
    const raw = vote.options.map((option) => ({
      count: option.voteCount,
      exact: total ? (option.voteCount * 100) / total : 0,
    }));
    const firstPercent = total ? Math.round(raw[0]?.exact ?? 0) : 0;
    const percents = [firstPercent, total ? 100 - firstPercent : 0];
    return {
      id: vote.id,
      status: vote.status,
      title: translation?.title ?? '',
      description: translation?.description ?? '',
      startsAt: vote.startsAt,
      endsAt: vote.endsAt,
      completedAt: vote.completedAt,
      imageUrl: vote.imageUrl,
      options: vote.options.map((option, index) => ({
        id: option.id,
        position: option.position,
        text: localized(option.translations, language)?.text ?? '',
        ...(canShow ? { count: option.voteCount, percent: percents[index] } : {}),
      })),
      hasVoted: Boolean(own),
      selectedOptionId: own?.optionId ?? null,
      rewardState: own?.rewardState ?? null,
      userReward: own?.transactions.reduce((sum, transaction) => sum + transaction.amount, 0) ?? 0,
      ...(canShow
        ? {
            participantCount: total,
            resultStatus: vote.resultStatus,
            winnerOptionId: vote.winnerOptionId,
            resultPublishedAt: vote.resultPublishedAt,
          }
        : {}),
    };
  }

  async current(userId: string, language: string) {
    const now = new Date();
    const vote = await this.prisma.vote.findFirst({
      where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now }, deletedAt: null },
      orderBy: { endsAt: 'asc' },
    });
    return vote ? this.publicVote(vote.id, userId, language) : null;
  }

  async history(
    userId: string,
    language: string,
    filter: 'all' | 'participated' | 'missed',
    cursor?: string,
  ) {
    const registration = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const where: Prisma.VoteWhereInput = {
      status: 'COMPLETED',
      deletedAt: null,
      ...(filter === 'participated' ? { userVotes: { some: { userId } } } : {}),
      ...(filter === 'missed'
        ? {
            startsAt: { gte: registration.registrationCompletedAt ?? registration.registeredAt },
            userVotes: { none: { userId } },
          }
        : {}),
    };
    const rows = await this.prisma.vote.findMany({
      where,
      take: 11,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return {
      items: await Promise.all(
        rows.slice(0, 10).map((row) => this.publicVote(row.id, userId, language, true)),
      ),
      nextCursor: rows[10]?.id ?? null,
    };
  }

  async cast(userId: string, voteId: string, optionId: string, clientRequestId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          const lockedVotes = await tx.$queryRaw<
            Array<{ id: string; status: string; starts_at: Date; ends_at: Date; early_reward_count: number }>
          >`
            SELECT id, status, starts_at, ends_at, early_reward_count
            FROM votes WHERE id = ${voteId}::uuid FOR UPDATE
          `;
          const vote = lockedVotes[0];
          const now = new Date();
          if (!vote) throw new NotFoundException('Vote not found');
          if (vote.status !== 'ACTIVE' || vote.starts_at > now || vote.ends_at <= now) {
            throw new ForbiddenException('Voting is not open');
          }
          const option = await tx.voteOption.findFirst({ where: { id: optionId, voteId } });
          if (!option) throw new BadRequestException('Option does not belong to this vote');
          const existing = await tx.userVote.findUnique({
            where: { userId_voteId: { userId, voteId } },
          });
          if (existing) {
            if (existing.clientRequestId === clientRequestId) {
              return {
                accepted: true,
                alreadyProcessed: true,
                userVoteId: existing.id,
                reward: RULES.BASE_VOTE_REWARD,
              };
            }
            throw new ConflictException('You have already voted');
          }
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
            include: {
              referralAsInvitee: { include: { referrer: true } },
            },
          });
          if (!user.registrationCompletedAt) throw new ForbiddenException('Consent is required');
          const userVote = await tx.userVote.create({
            data: { userId, voteId, optionId, clientRequestId },
          });
          await tx.user.update({
            where: { id: userId },
            data: { ownVotesCount: { increment: 1 } },
          });
          await tx.vote.update({
            where: { id: voteId },
            data: { participantCount: { increment: 1 } },
          });
          await this.vox.award(tx, {
            userId,
            type: 'VOTE_REWARD',
            amount: RULES.BASE_VOTE_REWARD,
            idempotencyKey: `vote:${userVote.id}:base`,
            voteId,
            userVoteId: userVote.id,
            comment: 'MVP vote participation reward',
          });
          const referral = user.referralAsInvitee;
          if (
            referral &&
            Number(referral.referrer.activityRate) >= RULES.REFERRAL_MIN_ACTIVITY_PERCENT
          ) {
            await this.vox.award(tx, {
              userId: referral.referrerId,
              type: 'REFERRAL_VOTE_REWARD',
              amount: RULES.REFERRAL_VOTE_REWARD,
              idempotencyKey: `vote:${userVote.id}:referrer`,
              voteId,
              userVoteId: userVote.id,
              referralId: referral.id,
              comment: 'Direct referral voted while referrer activity was eligible',
            });
          }
          const [usersCount, earlyFlag] = await Promise.all([
            tx.user.count({ where: { registrationCompletedAt: { not: null } } }),
            tx.featureFlag.findUnique({ where: { key: 'EARLY_VOTE_BONUS' } }),
          ]);
          let earlyReward = 0;
          if (
            earlyFlag?.enabled &&
            usersCount >= (earlyFlag.usersThreshold ?? RULES.EARLY_REWARD_USERS_THRESHOLD) &&
            vote.early_reward_count < RULES.EARLY_VOTERS_LIMIT
          ) {
            const rank = vote.early_reward_count + 1;
            await tx.vote.update({ where: { id: voteId }, data: { earlyRewardCount: rank } });
            await tx.userVote.update({ where: { id: userVote.id }, data: { earlyRank: rank } });
            await this.vox.award(tx, {
              userId,
              type: 'EARLY_VOTE_BONUS',
              amount: RULES.EARLY_VOTER_REWARD,
              idempotencyKey: `vote:${userVote.id}:early`,
              voteId,
              userVoteId: userVote.id,
              comment: `Early participant rank ${rank}`,
            });
            earlyReward = RULES.EARLY_VOTER_REWARD;
          }
          return {
            accepted: true,
            alreadyProcessed: false,
            userVoteId: userVote.id,
            reward: RULES.BASE_VOTE_REWARD + earlyReward,
          };
        },
        { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
      )
      .catch((error: any) => {
        if (error?.code === 'P2002') throw new ConflictException('You have already voted');
        throw error;
      });
  }

  async complete(voteId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string; starts_at: Date; ends_at: Date }>>`
          SELECT status, starts_at, ends_at FROM votes WHERE id = ${voteId}::uuid FOR UPDATE
        `;
        const vote = locked[0];
        if (!vote) throw new NotFoundException('Vote not found');
        if (vote.status === 'COMPLETED' || vote.status === 'CANCELLED') {
          return { alreadyFinal: true };
        }
        if (vote.ends_at > new Date()) throw new BadRequestException('Vote has not ended');
        const counts = await tx.userVote.groupBy({
          by: ['optionId'],
          where: { voteId },
          _count: { _all: true },
        });
        const options = await tx.voteOption.findMany({
          where: { voteId },
          orderBy: { position: 'asc' },
        });
        if (options.length !== 2) throw new Error('Vote invariant: exactly two options required');
        const totals = new Map(counts.map((row) => [row.optionId, row._count._all]));
        const first = totals.get(options[0]!.id) ?? 0;
        const second = totals.get(options[1]!.id) ?? 0;
        const tie = first === second;
        const winnerOptionId = tie ? null : first > second ? options[0]!.id : options[1]!.id;
        await Promise.all(
          options.map((option) =>
            tx.voteOption.update({
              where: { id: option.id },
              data: { voteCount: totals.get(option.id) ?? 0 },
            }),
          ),
        );
        const now = new Date();
        await tx.vote.update({
          where: { id: voteId },
          data: {
            status: 'COMPLETED',
            participantCount: first + second,
            resultStatus: tie ? 'TIE' : 'OPTION_WIN',
            winnerOptionId,
            completedAt: now,
            resultPublishedAt: now,
          },
        });
        const eligibleUsers = await tx.user.findMany({
          where: {
            status: 'ACTIVE',
            registrationCompletedAt: { not: null, lte: vote.starts_at },
          },
          select: { id: true, eligibleVotesCount: true, completedVotesParticipated: true },
        });
        const participants = new Set(
          (
            await tx.userVote.findMany({
              where: { voteId },
              select: { userId: true },
            })
          ).map((item) => item.userId),
        );
        for (const user of eligibleUsers) {
          const eligible = user.eligibleVotesCount + 1;
          const participated = user.completedVotesParticipated + (participants.has(user.id) ? 1 : 0);
          const activity = eligible ? Math.min(100, (participated / eligible) * 100) : 100;
          await tx.user.update({
            where: { id: user.id },
            data: {
              eligibleVotesCount: eligible,
              completedVotesParticipated: participated,
              activityRate: new Prisma.Decimal(activity.toFixed(2)),
            },
          });
        }
        return { alreadyFinal: false, tie, winnerOptionId, participantCount: first + second };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 30_000 },
    );
  }
}
