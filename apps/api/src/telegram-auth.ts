import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import { normalizeLanguage, TelegramUser } from '@myvoice/shared';
import { PrismaService } from './prisma.service';
import { tokenHash } from './common';

export class TelegramAuthDto {
  @IsString()
  initData!: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
  nowSeconds = Math.floor(Date.now() / 1000),
): { user: TelegramUser; authDate: number; startParam?: string } {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new UnauthorizedException('Telegram signature is missing');
  }
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const received = Buffer.from(receivedHash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new UnauthorizedException('Invalid Telegram signature');
  }
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new UnauthorizedException('Telegram authorization has expired');
  }
  let user: TelegramUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new BadRequestException('Malformed Telegram user');
  }
  if (!Number.isSafeInteger(user.id) || !user.first_name) {
    throw new BadRequestException('Invalid Telegram user');
  }
  return { user, authDate, startParam: params.get('start_param') ?? undefined };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  constructor(private readonly prisma: PrismaService) {}

  private async issueSession(userId: string, res: Response) {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(48).toString('base64url');
    const accessTtl = Number(process.env.SESSION_TTL_SECONDS ?? 900);
    const refreshTtl = Number(process.env.REFRESH_SESSION_TTL_SECONDS ?? 2_592_000);
    await this.prisma.userSession.create({
      data: {
        userId,
        accessTokenHash: tokenHash(accessToken),
        refreshTokenHash: tokenHash(refreshToken),
        accessExpiresAt: new Date(Date.now() + accessTtl * 1000),
        refreshExpiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    res.cookie('myvoice_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: refreshTtl * 1000,
      path: '/auth',
    });
    return { accessToken, expiresIn: accessTtl };
  }

  @Post('telegram')
  @ApiOperation({ summary: 'Validate Telegram Mini App initData and start a MyVoice session' })
  async telegram(@Body() dto: TelegramAuthDto, @Res({ passthrough: true }) res: Response) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    const telegram = validateTelegramInitData(
      dto.initData,
      token,
      Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS ?? 3600),
    );
    // Only signed initData or bot-written context may select a referrer.
    let startParam = telegram.startParam;
    if (!startParam) {
      try {
        if (this.redis.status === 'wait') await this.redis.connect();
        startParam =
          (await this.redis.get(`pending-ref:${telegram.user.id}`)) ?? undefined;
      } catch {
        // The signed start_param remains the primary path if Redis is unavailable.
      }
    }
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegram.user.id) },
    });
    const referralCode = randomBytes(7).toString('base64url');
    const user = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        return tx.user.update({
          where: { id: existing.id },
          data: {
            username: telegram.user.username,
            firstName: telegram.user.first_name,
            lastName: telegram.user.last_name,
            lastActivityAt: new Date(),
          },
        });
      }
      const created = await tx.user.create({
        data: {
          telegramId: BigInt(telegram.user.id),
          username: telegram.user.username,
          firstName: telegram.user.first_name,
          lastName: telegram.user.last_name,
          languageCode: normalizeLanguage(telegram.user.language_code),
          referralCode,
        },
      });
      const code = startParam?.startsWith('ref_') ? startParam.slice(4) : undefined;
      if (code) {
        const referrer = await tx.user.findUnique({ where: { referralCode: code } });
        if (referrer && referrer.id !== created.id) {
          await tx.referral.create({
            data: { referrerId: referrer.id, inviteeId: created.id, sourceCode: code },
          });
        }
      }
      return created;
    });
    if (!existing && startParam) {
      void this.redis.del(`pending-ref:${telegram.user.id}`).catch(() => undefined);
    }
    return {
      ...(await this.issueSession(user.id, res)),
      registrationComplete: Boolean(user.registrationCompletedAt),
      language: user.languageCode,
    };
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = dto.refreshToken ?? req.cookies?.myvoice_refresh;
    if (!raw) throw new UnauthorizedException('Missing refresh session');
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: tokenHash(raw) },
    });
    if (!session || session.revokedAt || session.refreshExpiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh session');
    }
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(session.userId, res);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.myvoice_refresh;
    if (raw) {
      await this.prisma.userSession.updateMany({
        where: { refreshTokenHash: tokenHash(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie('myvoice_refresh', { path: '/auth' });
    return { ok: true };
  }
}
