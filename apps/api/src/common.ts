import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';

export type AuthRequest = Request & { userId: string; adminId?: string };

export const tokenHash = (token: string) =>
  createHash('sha256')
    .update(`${token}:${process.env.SESSION_PEPPER ?? ''}`)
    .digest('hex');

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Missing access session');
    const session = await this.prisma.userSession.findUnique({
      where: { accessTokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.accessExpiresAt <= new Date() ||
      ['BLOCKED', 'DELETED'].includes(session.user.status)
    ) {
      throw new UnauthorizedException('Invalid or expired access session');
    }
    req.userId = session.userId;
    void this.prisma.user.update({
      where: { id: session.userId },
      data: { lastActivityAt: new Date() },
    });
    return true;
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Missing admin token');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; realm: string }>(token, {
        secret: process.env.ADMIN_JWT_SECRET,
      });
      if (payload.realm !== 'admin') throw new Error('Wrong realm');
      const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
      if (!admin?.active) throw new Error('Inactive admin');
      req.adminId = admin.id;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid admin token');
    }
  }
}

@Injectable()
export class RedisRateLimitMiddleware implements NestMiddleware {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  async use(req: Request, _res: Response, next: NextFunction) {
    const fingerprint = createHash('sha256')
      .update(`${req.ip}:${req.headers.authorization?.slice(-16) ?? 'anonymous'}`)
      .digest('hex')
      .slice(0, 20);
    const window = Math.floor(Date.now() / 60_000);
    const key = `rl:${fingerprint}:${window}`;
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 70);
      if (count > 120) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // PostgreSQL invariants still protect writes when Redis is temporarily unavailable.
    }
    next();
  }
}
