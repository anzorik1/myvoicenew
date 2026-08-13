import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import { RULES } from '@myvoice/config';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';

class LanguageDto {
  @IsIn(['en', 'ru'])
  language!: 'en' | 'ru';
}

class ConsentDto {
  @IsBoolean()
  termsAccepted!: boolean;
  @IsBoolean()
  privacyAccepted!: boolean;
  @IsString()
  termsVersion!: string;
  @IsString()
  privacyVersion!: string;
}

class NotificationPreferencesDto {
  @IsBoolean()
  notificationsEnabled!: boolean;
  @IsBoolean()
  notifyNewVotes!: boolean;
  @IsBoolean()
  notifyVoteEnding!: boolean;
  @IsBoolean()
  notifyResults!: boolean;
}

@Controller('me')
@UseGuards(UserAuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
  ) {}

  @Get()
  async me(@Req() req: AuthRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      include: { consents: { orderBy: { acceptedAt: 'desc' }, take: 1 } },
    });
    const referralCount = await this.prisma.referral.count({ where: { referrerId: user.id } });
    return {
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      language: user.languageCode,
      registeredAt: user.registeredAt,
      registrationComplete: Boolean(user.registrationCompletedAt),
      balance: user.voxBalance,
      ownVotes: user.ownVotesCount,
      eligibleVotes: user.eligibleVotesCount,
      participatedVotes: user.completedVotesParticipated,
      activityRate: Math.round(Number(user.activityRate)),
      referralCount,
      referralProgramActive: Number(user.activityRate) >= RULES.REFERRAL_MIN_ACTIVITY_PERCENT,
      notifications: {
        enabled: user.notificationsEnabled,
        newVotes: user.notifyNewVotes,
        voteEnding: user.notifyVoteEnding,
        results: user.notifyResults,
      },
      consent: user.consents[0] ?? null,
    };
  }

  @Get('notifications')
  async notificationPreferences(@Req() req: AuthRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
      select: {
        notificationsEnabled: true,
        notifyNewVotes: true,
        notifyVoteEnding: true,
        notifyResults: true,
      },
    });
    return {
      enabled: user.notificationsEnabled,
      newVotes: user.notifyNewVotes,
      voteEnding: user.notifyVoteEnding,
      results: user.notifyResults,
    };
  }

  @Patch('notifications')
  async updateNotificationPreferences(
    @Req() req: AuthRequest,
    @Body() dto: NotificationPreferencesDto,
  ) {
    await this.prisma.user.update({
      where: { id: req.userId },
      data: dto,
    });
    return {
      enabled: dto.notificationsEnabled,
      newVotes: dto.notifyNewVotes,
      voteEnding: dto.notifyVoteEnding,
      results: dto.notifyResults,
    };
  }

  @Patch('language')
  async language(@Req() req: AuthRequest, @Body() dto: LanguageDto) {
    await this.prisma.user.update({
      where: { id: req.userId },
      data: { languageCode: dto.language },
    });
    return { language: dto.language };
  }

  @Post('consents')
  async consent(@Req() req: AuthRequest, @Body() dto: ConsentDto) {
    if (!dto.termsAccepted || !dto.privacyAccepted) {
      throw new BadRequestException('Both documents must be accepted');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: req.userId } });
        await tx.userConsent.upsert({
          where: {
            userId_termsVersion_privacyVersion: {
              userId: user.id,
              termsVersion: dto.termsVersion,
              privacyVersion: dto.privacyVersion,
            },
          },
          create: {
            userId: user.id,
            termsVersion: dto.termsVersion,
            privacyVersion: dto.privacyVersion,
          },
          update: {},
        });
        if (!user.registrationCompletedAt) {
          await tx.user.update({
            where: { id: user.id },
            data: { status: 'ACTIVE', registrationCompletedAt: new Date() },
          });
          await this.vox.award(tx, {
            userId: user.id,
            type: 'SIGNUP_BONUS',
            amount: RULES.SIGNUP_REWARD,
            idempotencyKey: `signup:${user.id}`,
            comment: 'Registration completed',
          });
          const referral = await tx.referral.findUnique({
            where: { inviteeId: user.id },
            include: { referrer: true },
          });
          if (
            referral &&
            !referral.signupRewardedAt &&
            Number(referral.referrer.activityRate) >= RULES.REFERRAL_MIN_ACTIVITY_PERCENT
          ) {
            await this.vox.award(tx, {
              userId: referral.referrerId,
              type: 'REFERRAL_SIGNUP_REWARD',
              amount: RULES.REFERRAL_SIGNUP_REWARD,
              idempotencyKey: `ref-signup:${referral.id}`,
              referralId: referral.id,
              comment: 'Direct referral completed registration',
            });
            await tx.referral.update({
              where: { id: referral.id },
              data: { signupRewardedAt: new Date() },
            });
          }
        }
        const updated = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        return { registrationComplete: true, balance: updated.voxBalance };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  @Get('activity')
  async activity(@Req() req: AuthRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    return {
      rate: Math.round(Number(user.activityRate)),
      exactRate: Number(user.activityRate),
      participated: user.completedVotesParticipated,
      missed: Math.max(0, user.eligibleVotesCount - user.completedVotesParticipated),
      eligible: user.eligibleVotesCount,
      referralProgramActive: Number(user.activityRate) >= RULES.REFERRAL_MIN_ACTIVITY_PERCENT,
    };
  }

  @Get('referrals')
  async referrals(@Req() req: AuthRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const [registered, active, earned, invitees] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: user.id } }),
      this.prisma.referral.count({
        where: {
          referrerId: user.id,
          invitee: { status: 'ACTIVE', lastActivityAt: { gte: new Date(Date.now() - 7 * 864e5) } },
        },
      }),
      this.prisma.voxTransaction.aggregate({
        where: {
          userId: user.id,
          type: { in: ['REFERRAL_SIGNUP_REWARD', 'REFERRAL_VOTE_REWARD'] },
        },
        _sum: { amount: true },
      }),
      this.prisma.referral.findMany({
        where: { referrerId: user.id, invitee: { deletedAt: null } },
        select: {
          createdAt: true,
          invitee: {
            select: {
              firstName: true,
              lastName: true,
              username: true,
              status: true,
              registrationCompletedAt: true,
              lastActivityAt: true,
              ownVotesCount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const activeSince = Date.now() - 7 * 864e5;
    const bot = process.env.VITE_BOT_USERNAME ?? process.env.BOT_USERNAME ?? 'MyVoiceBot';
    return {
      link: `https://t.me/${bot}?start=ref_${user.referralCode}`,
      registered,
      active,
      earned: earned._sum.amount ?? 0,
      programActive: Number(user.activityRate) >= RULES.REFERRAL_MIN_ACTIVITY_PERCENT,
      invitees: invitees.map((referral) => ({
        firstName: referral.invitee.firstName,
        lastName: referral.invitee.lastName,
        username: referral.invitee.username,
        joinedAt: referral.createdAt,
        registrationCompleted: Boolean(referral.invitee.registrationCompletedAt),
        active:
          referral.invitee.status === 'ACTIVE' &&
          referral.invitee.lastActivityAt.getTime() >= activeSince,
        votes: referral.invitee.ownVotesCount,
      })),
    };
  }

  @Get('vox-transactions')
  async transactions(@Req() req: AuthRequest, @Query('cursor') cursor?: string) {
    const [rows, groups] = await Promise.all([
      this.prisma.voxTransaction.findMany({
        where: { userId: req.userId },
        take: 21,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.voxTransaction.groupBy({
        by: ['type'],
        where: { userId: req.userId },
        _sum: { amount: true },
      }),
    ]);
    const total = (types: string[]) =>
      groups
        .filter((group) => types.includes(group.type))
        .reduce((sum, group) => sum + (group._sum.amount ?? 0), 0);
    return {
      items: rows.slice(0, 20),
      nextCursor: rows[20]?.id ?? null,
      summary: {
        registration: total(['SIGNUP_BONUS']),
        voting: total(['VOTE_REWARD', 'EARLY_VOTE_BONUS', 'WINNER_REWARD', 'LOSER_REWARD']),
        referrals: total(['REFERRAL_SIGNUP_REWARD', 'REFERRAL_VOTE_REWARD']),
        ads: total(['AD_REWARD']),
        tasks: total(['TASK_REWARD']),
        legacy: total(['TAP_REWARD']),
        adjustments: total(['ADMIN_ADJUSTMENT']),
        totalEarned: groups.reduce((sum, group) => sum + Math.max(0, group._sum.amount ?? 0), 0),
      },
    };
  }
}
