import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdminAuthGuard, AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';
import { acquireAdvisoryTransactionLock } from './database-locks';

class AdTranslationDto {
  @IsIn(['en', 'ru'])
  language!: 'en' | 'ru';

  @IsString()
  @Length(2, 160)
  title!: string;

  @IsString()
  @Length(2, 500)
  description!: string;

  @IsString()
  @Length(2, 80)
  actionLabel!: string;
}

export class AdCampaignInputDto {
  @IsIn(['BANNER', 'REWARDED'])
  type!: 'BANNER' | 'REWARDED';

  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @Matches(/^(https:\/\/[^\s]+|\/api\/media\/[a-f0-9]{48}\.webp)$/)
  imageUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  mediaUrl?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  targetUrl?: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  rewardVox!: number;

  @IsInt()
  @Min(0)
  @Max(3600)
  minimumWatchSeconds!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  dailyRewardLimit!: number;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AdTranslationDto)
  translations!: AdTranslationDto[];
}

class RewardSessionStartDto {
  @IsString()
  @Length(8, 80)
  clientRequestId!: string;
}

type CampaignWithTranslations = Prisma.AdCampaignGetPayload<{
  include: { translations: true };
}>;

@Injectable()
export class AdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
  ) {}

  async placements(userId: string) {
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { languageCode: true },
    });
    const language = user.languageCode === 'ru' ? 'ru' : 'en';
    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      include: { translations: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      take: 6,
    });
    if (campaigns.length) {
      await this.prisma.adCampaign.updateMany({
        where: { id: { in: campaigns.map((campaign) => campaign.id) } },
        data: { impressionCount: { increment: 1 } },
      });
    }
    const rewardDay = this.utcDay(now);
    const claims = await this.prisma.adRewardSession.groupBy({
      by: ['campaignId'],
      where: { userId, rewardDay, claimedAt: { not: null } },
      _count: { id: true },
    });
    const claimCounts = new Map(claims.map((row) => [row.campaignId, row._count.id]));
    return {
      banners: campaigns
        .filter((campaign) => campaign.type === 'BANNER')
        .map((campaign) => this.publicCampaign(campaign, language, 0)),
      rewarded: campaigns
        .filter((campaign) => campaign.type === 'REWARDED')
        .map((campaign) =>
          this.publicCampaign(campaign, language, claimCounts.get(campaign.id) ?? 0),
        ),
    };
  }

  async click(campaignId: string) {
    const now = new Date();
    const result = await this.prisma.adCampaign.updateMany({
      where: {
        id: campaignId,
        type: 'BANNER',
        status: 'ACTIVE',
        deletedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      data: { clickCount: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Advertisement is not active');
    return { tracked: true };
  }

  async startRewardSession(userId: string, campaignId: string, clientRequestId: string) {
    const existing = await this.prisma.adRewardSession.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
      include: { campaign: true },
    });
    if (existing) {
      if (existing.campaignId !== campaignId) throw new BadRequestException('Request ID conflict');
      return this.sessionState(existing, existing.campaign.minimumWatchSeconds);
    }

    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const rewardDay = this.utcDay(now);
        await this.advisoryLock(tx, userId, campaignId, rewardDay);
        const repeated = await tx.adRewardSession.findUnique({
          where: { userId_clientRequestId: { userId, clientRequestId } },
          include: { campaign: true },
        });
        if (repeated) {
          if (repeated.campaignId !== campaignId) {
            throw new BadRequestException('Request ID conflict');
          }
          return this.sessionState(repeated, repeated.campaign.minimumWatchSeconds);
        }
        const campaign = await tx.adCampaign.findFirst({
          where: {
            id: campaignId,
            type: 'REWARDED',
            status: 'ACTIVE',
            deletedAt: null,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        });
        if (!campaign) throw new NotFoundException('Rewarded advertisement is not active');
        const reserved = await tx.adRewardSession.count({
          where: {
            userId,
            campaignId,
            rewardDay,
            OR: [{ claimedAt: { not: null } }, { expiresAt: { gt: now } }],
          },
        });
        if (reserved >= campaign.dailyRewardLimit) {
          throw new BadRequestException('Daily advertisement reward limit reached');
        }
        const session = await tx.adRewardSession.create({
          data: {
            userId,
            campaignId,
            clientRequestId,
            rewardDay,
            startedAt: now,
            lastHeartbeatAt: now,
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
          },
        });
        return this.sessionState(session, campaign.minimumWatchSeconds);
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  async heartbeat(userId: string, sessionId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ad_reward_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
        const session = await tx.adRewardSession.findUnique({
          where: { id: sessionId },
          include: { campaign: true },
        });
        if (!session || session.userId !== userId) throw new NotFoundException('Session not found');
        const now = new Date();
        if (session.claimedAt)
          return this.sessionState(session, session.campaign.minimumWatchSeconds);
        if (session.expiresAt <= now)
          throw new BadRequestException('Advertisement session expired');
        const elapsed = Math.max(
          0,
          Math.floor((now.getTime() - session.lastHeartbeatAt.getTime()) / 1000),
        );
        const credited = Math.min(6, elapsed);
        const watchedSeconds = Math.min(
          session.campaign.minimumWatchSeconds,
          session.watchedSeconds + credited,
        );
        const updated = await tx.adRewardSession.update({
          where: { id: session.id },
          data: { watchedSeconds, lastHeartbeatAt: now },
        });
        return this.sessionState(updated, session.campaign.minimumWatchSeconds);
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  async claim(userId: string, sessionId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ad_reward_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
        const session = await tx.adRewardSession.findUnique({
          where: { id: sessionId },
          include: { campaign: true, transaction: true },
        });
        if (!session || session.userId !== userId) throw new NotFoundException('Session not found');
        if (session.claimedAt && session.transaction) {
          return {
            claimed: true,
            reward: session.transaction.amount,
            balance: session.transaction.balanceAfter,
          };
        }
        const now = new Date();
        if (session.expiresAt <= now)
          throw new BadRequestException('Advertisement session expired');
        if (session.watchedSeconds < session.campaign.minimumWatchSeconds) {
          throw new BadRequestException('Advertisement viewing is not complete');
        }
        await this.advisoryLock(tx, userId, session.campaignId, session.rewardDay);
        const claimedToday = await tx.adRewardSession.count({
          where: {
            userId,
            campaignId: session.campaignId,
            rewardDay: session.rewardDay,
            claimedAt: { not: null },
          },
        });
        if (claimedToday >= session.campaign.dailyRewardLimit) {
          throw new BadRequestException('Daily advertisement reward limit reached');
        }
        const transaction = await this.vox.award(tx, {
          userId,
          type: 'AD_REWARD',
          amount: session.campaign.rewardVox,
          idempotencyKey: `ad-reward:${session.id}`,
          comment: `Rewarded advertisement ${session.campaignId}`,
          adRewardSessionId: session.id,
        });
        await tx.adRewardSession.update({ where: { id: session.id }, data: { claimedAt: now } });
        await tx.adCampaign.update({
          where: { id: session.campaignId },
          data: { rewardCount: { increment: 1 } },
        });
        return { claimed: true, reward: transaction.amount, balance: transaction.balanceAfter };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  private publicCampaign(
    campaign: CampaignWithTranslations,
    language: string,
    claimsToday: number,
  ) {
    const translation =
      campaign.translations.find((item) => item.language === language) ??
      campaign.translations.find((item) => item.language === 'en') ??
      campaign.translations[0];
    return {
      id: campaign.id,
      type: campaign.type,
      title: translation?.title ?? '',
      description: translation?.description ?? '',
      actionLabel: translation?.actionLabel ?? '',
      imageUrl: campaign.imageUrl,
      mediaUrl: campaign.mediaUrl,
      targetUrl: campaign.targetUrl,
      rewardVox: campaign.rewardVox,
      minimumWatchSeconds: campaign.minimumWatchSeconds,
      dailyRewardLimit: campaign.dailyRewardLimit,
      claimsToday,
    };
  }

  private sessionState(
    session: { id: string; watchedSeconds: number; expiresAt: Date; claimedAt: Date | null },
    minimumWatchSeconds: number,
  ) {
    return {
      id: session.id,
      watchedSeconds: session.watchedSeconds,
      minimumWatchSeconds,
      remainingSeconds: Math.max(0, minimumWatchSeconds - session.watchedSeconds),
      expiresAt: session.expiresAt,
      claimed: Boolean(session.claimedAt),
    };
  }

  private utcDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private async advisoryLock(
    tx: Prisma.TransactionClient,
    userId: string,
    campaignId: string,
    rewardDay: Date,
  ) {
    const key = `ad:${userId}:${campaignId}:${rewardDay.toISOString().slice(0, 10)}`;
    await acquireAdvisoryTransactionLock(tx, key);
  }
}

@Controller('ads')
@UseGuards(UserAuthGuard)
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('current')
  placements(@Req() req: AuthRequest) {
    return this.ads.placements(req.userId);
  }

  @Post(':id/click')
  click(@Param('id') id: string) {
    return this.ads.click(id);
  }

  @Post(':id/reward-sessions')
  start(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: RewardSessionStartDto) {
    return this.ads.startRewardSession(req.userId, id, dto.clientRequestId);
  }

  @Post('reward-sessions/:id/heartbeat')
  heartbeat(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.ads.heartbeat(req.userId, id);
  }

  @Post('reward-sessions/:id/claim')
  claim(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.ads.claim(req.userId, id);
  }
}

@Controller('admin/ads')
@UseGuards(AdminAuthGuard)
export class AdminAdsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const campaigns = await this.prisma.adCampaign.findMany({
      where: { deletedAt: null },
      include: { translations: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return campaigns.map((campaign) => this.adminCampaign(campaign));
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() dto: AdCampaignInputDto) {
    const dates = this.validate(dto);
    const campaign = await this.prisma.adCampaign.create({
      data: {
        ...dates,
        type: dto.type,
        status: 'DRAFT',
        imageUrl: dto.imageUrl,
        mediaUrl: dto.mediaUrl,
        targetUrl: dto.targetUrl,
        rewardVox: dto.type === 'REWARDED' ? dto.rewardVox : 0,
        minimumWatchSeconds: dto.type === 'REWARDED' ? dto.minimumWatchSeconds : 0,
        dailyRewardLimit: dto.type === 'REWARDED' ? dto.dailyRewardLimit : 1,
        createdByAdminId: req.adminId!,
        translations: { create: dto.translations },
      },
      include: { translations: true },
    });
    await this.audit(req.adminId!, 'AD_CREATE', campaign.id, undefined, campaign);
    return this.adminCampaign(campaign);
  }

  @Patch(':id')
  async edit(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: AdCampaignInputDto) {
    const before = await this.prisma.adCampaign.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
    if (before.status === 'ACTIVE') throw new BadRequestException('Pause an active campaign first');
    const dates = this.validate(dto);
    const campaign = await this.prisma.$transaction(async (tx) => {
      await tx.adCampaignTranslation.deleteMany({ where: { campaignId: id } });
      return tx.adCampaign.update({
        where: { id },
        data: {
          ...dates,
          type: dto.type,
          imageUrl: dto.imageUrl,
          mediaUrl: dto.mediaUrl,
          targetUrl: dto.targetUrl,
          rewardVox: dto.type === 'REWARDED' ? dto.rewardVox : 0,
          minimumWatchSeconds: dto.type === 'REWARDED' ? dto.minimumWatchSeconds : 0,
          dailyRewardLimit: dto.type === 'REWARDED' ? dto.dailyRewardLimit : 1,
          translations: { create: dto.translations },
        },
        include: { translations: true },
      });
    });
    await this.audit(req.adminId!, 'AD_EDIT', id, before, campaign);
    return this.adminCampaign(campaign);
  }

  @Post(':id/activate')
  async activate(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.adCampaign.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: { translations: true },
    });
    if (before.translations.length < 2)
      throw new BadRequestException('Translations are incomplete');
    if (before.endsAt && before.endsAt <= new Date()) {
      throw new BadRequestException(
        'Campaign has already ended. Update the end time before publishing.',
      );
    }
    const after = await this.prisma.adCampaign.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    await this.audit(req.adminId!, 'AD_ACTIVATE', id, before, after);
    return after;
  }

  @Post(':id/pause')
  async pause(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.adCampaign.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
    const after = await this.prisma.adCampaign.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    await this.audit(req.adminId!, 'AD_PAUSE', id, before, after);
    return after;
  }

  @Delete(':id')
  async remove(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.adCampaign.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
    const after = await this.prisma.adCampaign.update({
      where: { id },
      data: { status: 'ENDED', deletedAt: new Date() },
    });
    await this.audit(req.adminId!, 'AD_DELETE', id, before, after);
    return { deleted: true };
  }

  private validate(dto: AdCampaignInputDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (!Number.isFinite(startsAt.getTime()) || (endsAt && endsAt <= startsAt)) {
      throw new BadRequestException('Invalid campaign date range');
    }
    if (endsAt && endsAt <= new Date()) {
      throw new BadRequestException('Campaign end time must be in the future');
    }
    if (new Set(dto.translations.map((item) => item.language)).size !== 2) {
      throw new BadRequestException('English and Russian translations are required');
    }
    if (dto.type === 'BANNER' && !dto.targetUrl) {
      throw new BadRequestException('Banner target URL is required');
    }
    if (dto.type === 'REWARDED') {
      if (!dto.mediaUrl) throw new BadRequestException('Rewarded video URL is required');
      if (dto.rewardVox <= 0 || dto.minimumWatchSeconds < 5) {
        throw new BadRequestException('Reward and at least 5 watch seconds are required');
      }
    }
    return { startsAt, endsAt };
  }

  private adminCampaign(campaign: CampaignWithTranslations) {
    return {
      ...campaign,
      impressionCount: Number(campaign.impressionCount),
      clickCount: Number(campaign.clickCount),
      rewardCount: Number(campaign.rewardCount),
    };
  }

  private audit(
    adminId: string,
    action: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
  ) {
    return this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType: 'AdCampaign',
        entityId,
        before: this.auditJson(before),
        after: this.auditJson(after),
      },
    });
  }

  private auditJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as Prisma.InputJsonValue;
  }
}
