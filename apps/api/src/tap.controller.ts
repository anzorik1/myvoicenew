import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RULES } from '@myvoice/config';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';

export class TapClaimDto {
  @IsInt()
  @Min(1)
  @Max(RULES.TAP_CLAIM_MAX_TAPS)
  taps!: number;

  @IsString()
  @Length(8, 80)
  clientRequestId!: string;
}

type TapUser = {
  id: string;
  voxBalance: number;
  tapEnergy: number;
  tapEnergyUpdatedAt: Date;
  tapDailyEarned: number;
  tapDay: Date | null;
  tapTotal: number;
};

@Injectable()
export class TapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
  ) {}

  async state(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: this.userSelection,
    });
    return this.publicState(user, new Date());
  }

  async claim(userId: string, dto: TapClaimDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: this.userSelection,
        });
        const idempotencyKey = `tap:${userId}:${dto.clientRequestId}`;
        const existing = await tx.voxTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          return {
            ...this.publicState(user, new Date()),
            acceptedTaps: Math.floor(existing.amount / RULES.TAP_REWARD_PER_TAP),
            reward: existing.amount,
            balance: existing.balanceAfter,
          };
        }

        const now = new Date();
        const normalized = this.normalize(user, now);
        const tapsAvailableToday = Math.floor(normalized.dailyRemaining / RULES.TAP_REWARD_PER_TAP);
        const acceptedTaps = Math.min(dto.taps, normalized.energy, tapsAvailableToday);
        if (acceptedTaps <= 0) {
          throw new BadRequestException(
            normalized.dailyRemaining <= 0
              ? 'Daily tap reward limit reached'
              : 'Tap energy is empty',
          );
        }
        const reward = acceptedTaps * RULES.TAP_REWARD_PER_TAP;
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            tapEnergy: normalized.energy - acceptedTaps,
            tapEnergyUpdatedAt: now,
            tapDailyEarned: normalized.dailyEarned + reward,
            tapDay: normalized.today,
            tapTotal: { increment: acceptedTaps },
          },
          select: this.userSelection,
        });
        const transaction = await this.vox.award(tx, {
          userId,
          type: 'TAP_REWARD',
          amount: reward,
          idempotencyKey,
          comment: `Tap reward for ${acceptedTaps} taps`,
        });
        return {
          ...this.publicState({ ...updated, voxBalance: transaction.balanceAfter }, now),
          acceptedTaps,
          reward,
          balance: transaction.balanceAfter,
        };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  private readonly userSelection = {
    id: true,
    voxBalance: true,
    tapEnergy: true,
    tapEnergyUpdatedAt: true,
    tapDailyEarned: true,
    tapDay: true,
    tapTotal: true,
  } satisfies Prisma.UserSelect;

  private publicState(user: TapUser, now: Date) {
    const normalized = this.normalize(user, now);
    return {
      energy: normalized.energy,
      energyCap: RULES.TAP_ENERGY_CAP,
      energyRegenSeconds: RULES.TAP_ENERGY_REGEN_SECONDS,
      nextEnergyInSeconds: normalized.nextEnergyInSeconds,
      rewardPerTap: RULES.TAP_REWARD_PER_TAP,
      maxClaimTaps: RULES.TAP_CLAIM_MAX_TAPS,
      dailyEarned: normalized.dailyEarned,
      dailyLimit: RULES.TAP_DAILY_REWARD_LIMIT,
      dailyRemaining: normalized.dailyRemaining,
      tapTotal: user.tapTotal,
      balance: user.voxBalance,
    };
  }

  private normalize(user: TapUser, now: Date) {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - user.tapEnergyUpdatedAt.getTime()) / 1000),
    );
    const regenerated = Math.floor(elapsedSeconds / RULES.TAP_ENERGY_REGEN_SECONDS);
    const energy = Math.min(RULES.TAP_ENERGY_CAP, user.tapEnergy + regenerated);
    const today = this.utcDay(now);
    const sameDay = user.tapDay?.getTime() === today.getTime();
    const dailyEarned = sameDay ? user.tapDailyEarned : 0;
    const dailyRemaining = Math.max(0, RULES.TAP_DAILY_REWARD_LIMIT - dailyEarned);
    const nextEnergyInSeconds =
      energy >= RULES.TAP_ENERGY_CAP
        ? 0
        : RULES.TAP_ENERGY_REGEN_SECONDS - (elapsedSeconds % RULES.TAP_ENERGY_REGEN_SECONDS);
    return { energy, today, dailyEarned, dailyRemaining, nextEnergyInSeconds };
  }

  private utcDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}

@Controller('tap')
@UseGuards(UserAuthGuard)
export class TapController {
  constructor(private readonly taps: TapService) {}

  @Get('state')
  state(@Req() req: AuthRequest) {
    return this.taps.state(req.userId);
  }

  @Post('claim')
  claim(@Req() req: AuthRequest, @Body() dto: TapClaimDto) {
    return this.taps.claim(req.userId, dto);
  }
}
