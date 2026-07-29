import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { verify } from 'argon2';
import { IsEmail, IsInt, IsOptional, IsString, Length } from 'class-validator';
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

type VoteTranslationInput = { language: 'en' | 'ru'; title: string; description: string };
type OptionInput = { position: 1 | 2; translations: { language: 'en' | 'ru'; text: string }[] };
class VoteInputDto {
  @IsString()
  startsAt!: string;
  @IsString()
  endsAt!: string;
  @IsOptional()
  @IsString()
  imageUrl?: string;
  translations!: VoteTranslationInput[];
  options!: OptionInput[];
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
    const before = await this.prisma.vote.findUniqueOrThrow({ where: { id } });
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
      where: { id },
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
    const before = await this.prisma.vote.findUniqueOrThrow({ where: { id } });
    if (before.status === 'COMPLETED') throw new BadRequestException('Completed result is immutable');
    const after = await this.prisma.vote.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(req.adminId!, 'VOTE_CANCEL', 'Vote', id, before, after);
    return after;
  }

  @Get('votes')
  async votesList() {
    return this.prisma.vote.findMany({
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
