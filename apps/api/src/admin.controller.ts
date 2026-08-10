import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { RULES } from '@myvoice/config';
import { hash, verify } from 'argon2';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdminAuthGuard, AuthRequest } from './common';
import { JobsService } from './jobs.service';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';

class AdminLoginDto {
  @IsEmail()
  email!: string;
  @IsString()
  @Length(8, 200)
  password!: string;
}

class AdminChangePasswordDto {
  @IsString()
  @Length(8, 200)
  currentPassword!: string;

  @IsString()
  @Length(12, 128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'New password must include uppercase, lowercase, number, and symbol',
  })
  newPassword!: string;
}

class AdjustmentDto {
  @IsInt()
  amount!: number;
  @IsString()
  @Length(5, 500)
  comment!: string;
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

class VoteTranslationDto {
  @IsIn(['en', 'ru'])
  language!: 'en' | 'ru';
  @IsString()
  @Length(3, 240)
  title!: string;
  @IsString()
  @Length(10, 3000)
  description!: string;
}

class VoteOptionTranslationDto {
  @IsIn(['en', 'ru'])
  language!: 'en' | 'ru';
  @IsString()
  @Length(1, 160)
  text!: string;
}

class VoteOptionDto {
  @IsInt()
  @IsIn([1, 2])
  position!: 1 | 2;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => VoteOptionTranslationDto)
  translations!: VoteOptionTranslationDto[];
}

export class VoteInputDto {
  @IsString()
  startsAt!: string;
  @IsString()
  endsAt!: string;
  @IsOptional()
  @IsString()
  imageUrl?: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => VoteTranslationDto)
  translations!: VoteTranslationDto[];
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => VoteOptionDto)
  options!: VoteOptionDto[];
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RULES.MAX_OUTCOME_REWARD)
  winnerReward?: number;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RULES.MAX_OUTCOME_REWARD)
  loserReward?: number;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  async login(@Body() dto: AdminLoginDto) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (!admin?.active || !(await verify(admin.passwordHash, dto.password))) {
      throw new BadRequestException('Invalid admin credentials');
    }
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      accessToken: await this.jwt.signAsync(
        { sub: admin.id, realm: 'admin' },
        { secret: process.env.ADMIN_JWT_SECRET, expiresIn: '30m' },
      ),
    };
  }

  @Post('change-password')
  @UseGuards(AdminAuthGuard)
  async changePassword(@Req() req: AuthRequest, @Body() dto: AdminChangePasswordDto) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id: req.adminId! },
    });
    if (!(await verify(admin.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (await verify(admin.passwordHash, dto.newPassword)) {
      throw new BadRequestException('New password must be different');
    }

    const passwordHash = await hash(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHash },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: 'ADMIN_PASSWORD_CHANGE',
          entityType: 'AdminUser',
          entityId: admin.id,
          after: { changed: true },
        },
      }),
    ]);
    return { changed: true };
  }
}

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
    private readonly jobs: JobsService,
  ) {}

  private audit(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
  ) {
    return this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        before: before as Prisma.InputJsonValue | undefined,
        after: after as Prisma.InputJsonValue | undefined,
      },
    });
  }

  @Get('metrics')
  async metrics() {
    const now = Date.now();
    const current = await this.prisma.vote.findFirst({ where: { status: 'ACTIVE' } });
    const [total, day, week, month, eligible, referrals, vox, blocked] = await Promise.all([
      this.prisma.user.count({ where: { registrationCompletedAt: { not: null } } }),
      this.prisma.user.count({ where: { lastActivityAt: { gte: new Date(now - 86_400_000) } } }),
      this.prisma.user.count({ where: { lastActivityAt: { gte: new Date(now - 7 * 86_400_000) } } }),
      this.prisma.user.count({ where: { lastActivityAt: { gte: new Date(now - 30 * 86_400_000) } } }),
      this.prisma.user.count({ where: { activityRate: { gte: 80 } } }),
      this.prisma.referral.count(),
      this.prisma.voxTransaction.aggregate({ _sum: { amount: true }, where: { amount: { gt: 0 } } }),
      this.prisma.user.count({ where: { status: 'BLOCKED' } }),
    ]);
    return {
      totalUsers: total,
      active1d: day,
      active7d: week,
      active30d: month,
      currentVoteParticipants: current?.participantCount ?? 0,
      currentParticipationPercent: total
        ? Math.round(((current?.participantCount ?? 0) / total) * 100)
        : 0,
      activityAtLeast80: eligible,
      referrals,
      voxAwarded: vox._sum.amount ?? 0,
      blocked,
    };
  }

  @Get('users')
  async users(@Query('search') search = '', @Query('cursor') cursor?: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(search);
    const telegram = /^\d+$/.test(search) ? BigInt(search) : undefined;
    const rows = await this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              ...(isUuid ? [{ id: search }] : []),
              ...(telegram ? [{ telegramId: telegram }] : []),
            ],
          }
        : {},
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        status: true,
        voxBalance: true,
        activityRate: true,
        createdAt: true,
      },
    });
    return {
      items: rows.slice(0, 50).map((row) => ({ ...row, telegramId: row.telegramId.toString() })),
      nextCursor: rows[50]?.id ?? null,
    };
  }

  @Get('users/:id/vox-transactions')
  async ledger(@Param('id') id: string) {
    return this.prisma.voxTransaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post('users/:id/block')
  async block(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.user.update({ where: { id }, data: { status: 'BLOCKED' } });
    await this.audit(req.adminId!, 'USER_BLOCK', 'User', id, before, after);
    return { ok: true };
  }

  @Post('users/:id/unblock')
  async unblock(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit(req.adminId!, 'USER_UNBLOCK', 'User', id, before, after);
    return { ok: true };
  }

  @Post('users/:id/vox-adjustment')
  async adjustment(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: AdjustmentDto,
  ) {
    const tx = await this.prisma.$transaction((db) =>
      this.vox.award(db, {
        userId: id,
        type: 'ADMIN_ADJUSTMENT',
        amount: dto.amount,
        idempotencyKey: `admin:${req.adminId}:${dto.idempotencyKey}`,
        comment: dto.comment,
      }),
    );
    await this.audit(req.adminId!, 'VOX_ADJUSTMENT', 'User', id, undefined, {
      amount: dto.amount,
      comment: dto.comment,
    });
    return tx;
  }

  private validateVote(dto: VoteInputDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Invalid UTC date range');
    }
    if (dto.options?.length !== 2 || dto.options[0]?.position !== 1 || dto.options[1]?.position !== 2) {
      throw new BadRequestException('Exactly two ordered options are required');
    }
    for (const language of ['en', 'ru']) {
      if (!dto.translations?.some((item) => item.language === language)) {
        throw new BadRequestException(`Missing ${language} vote translation`);
      }
      if (dto.options.some((option) => !option.translations.some((item) => item.language === language))) {
        throw new BadRequestException(`Missing ${language} option translation`);
      }
    }
    return { startsAt, endsAt };
  }

  @Post('votes')
  async createVote(@Req() req: AuthRequest, @Body() dto: VoteInputDto) {
    const { startsAt, endsAt } = this.validateVote(dto);
    const vote = await this.prisma.vote.create({
      data: {
        startsAt,
        endsAt,
        imageUrl: dto.imageUrl,
        winnerReward: dto.winnerReward ?? 0,
        loserReward: dto.loserReward ?? 0,
        status: 'DRAFT',
        createdByAdminId: req.adminId!,
        translations: { create: dto.translations },
        options: {
          create: dto.options.map((option) => ({
            position: option.position,
            translations: { create: option.translations },
          })),
        },
      },
      include: { translations: true, options: { include: { translations: true } } },
    });
    await this.audit(req.adminId!, 'VOTE_CREATE', 'Vote', vote.id, undefined, vote);
    return vote;
  }

  @Patch('votes/:id')
  async editVote(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: VoteInputDto) {
    const before = await this.prisma.vote.findUniqueOrThrow({ where: { id, deletedAt: null } });
    if (before.status !== 'DRAFT') throw new BadRequestException('Only drafts may be edited');
    const { startsAt, endsAt } = this.validateVote(dto);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.voteTranslation.deleteMany({ where: { voteId: id } });
      await tx.voteOption.deleteMany({ where: { voteId: id } });
      return tx.vote.update({
        where: { id },
        data: {
          startsAt,
          endsAt,
          imageUrl: dto.imageUrl,
          winnerReward: dto.winnerReward ?? 0,
          loserReward: dto.loserReward ?? 0,
          translations: { create: dto.translations },
          options: {
            create: dto.options.map((option) => ({
              position: option.position,
              translations: { create: option.translations },
            })),
          },
        },
        include: { translations: true, options: { include: { translations: true } } },
      });
    });
    await this.audit(req.adminId!, 'VOTE_EDIT', 'Vote', id, before, after);
    return after;
  }

  @Post('votes/:id/schedule')
  async schedule(@Req() req: AuthRequest, @Param('id') id: string) {
    const vote = await this.prisma.vote.findUniqueOrThrow({
      where: { id, deletedAt: null },
      include: { translations: true, options: { include: { translations: true } } },
    });
    if (vote.status !== 'DRAFT') throw new BadRequestException('Only drafts may be scheduled');
    if (vote.options.length !== 2 || vote.translations.length < 2) {
      throw new BadRequestException('Vote is incomplete');
    }
    const status = vote.startsAt <= new Date() ? 'ACTIVE' : 'SCHEDULED';
    const after = await this.prisma.vote.update({ where: { id }, data: { status } });
    await this.jobs.schedule(id, vote.startsAt, vote.endsAt);
    await this.audit(req.adminId!, 'VOTE_SCHEDULE', 'Vote', id, vote, after);
    return after;
  }

  @Post('votes/:id/cancel')
  async cancel(@Req() req: AuthRequest, @Param('id') id: string) {
    const before = await this.prisma.vote.findUniqueOrThrow({ where: { id, deletedAt: null } });
    if (before.status === 'COMPLETED') throw new BadRequestException('Completed result is immutable');
    const after = await this.prisma.vote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(req.adminId!, 'VOTE_CANCEL', 'Vote', id, before, after);
    return after;
  }

  @Delete('votes/:id')
  async deleteVote(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            participant_count: number;
            deleted_at: Date | null;
          }>
        >`
          SELECT id, status, participant_count, deleted_at
          FROM votes
          WHERE id = ${id}::uuid
          FOR UPDATE
        `;
        const before = rows[0];
        if (!before || before.deleted_at) throw new NotFoundException('Vote not found');
        const deletedAt = new Date();
        await tx.vote.update({
          where: { id },
          data: { deletedAt },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: req.adminId!,
            action: 'VOTE_DELETE',
            entityType: 'Vote',
            entityId: id,
            before: {
              status: before.status,
              participantCount: before.participant_count,
            },
            after: { status: before.status, deletedAt: deletedAt.toISOString() },
          },
        });
        return { deleted: true };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  @Get('votes')
  async votesList() {
    return this.prisma.vote.findMany({
      where: { deletedAt: null },
      include: { translations: true, options: { include: { translations: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('suggestions')
  async suggestions() {
    return this.prisma.voteSuggestion.findMany({
      include: { translations: true, user: { select: { username: true, firstName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('suggestions/:id/:decision')
  async decide(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('decision') decision: string,
  ) {
    if (!['approve', 'reject'].includes(decision)) throw new BadRequestException('Bad decision');
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const result = await this.prisma.voteSuggestion.update({
      where: { id },
      data: { status, reviewedBy: req.adminId, reviewedAt: new Date() },
    });
    await this.audit(req.adminId!, `SUGGESTION_${status}`, 'VoteSuggestion', id, undefined, result);
    return result;
  }

  @Get('audit-log')
  async auditLog() {
    return this.prisma.adminAuditLog.findMany({
      include: { admin: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
