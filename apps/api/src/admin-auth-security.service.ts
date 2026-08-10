import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const CAPTCHA_AFTER_FAILURES = 3;
const BLOCK_AFTER_FAILURES = 5;
const INITIAL_BLOCK_MS = 15 * 60 * 1000;
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const RECORD_FAILURE_SCRIPT = `
local now = tonumber(ARGV[1])
local failureLimit = tonumber(ARGV[2])
local initialBlock = tonumber(ARGV[3])
local maximumBlock = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local maximumFailures = 0
local maximumBlockedUntil = 0

for _, key in ipairs(KEYS) do
  local failures = tonumber(redis.call('HGET', key, 'failures') or '0')
  local level = tonumber(redis.call('HGET', key, 'lockLevel') or '0')
  local blockedUntil = tonumber(redis.call('HGET', key, 'blockedUntil') or '0')

  if blockedUntil <= now then
    if blockedUntil > 0 then
      failures = 0
      blockedUntil = 0
    end
    failures = failures + 1
    if failures >= failureLimit then
      level = level + 1
      local duration = initialBlock * (2 ^ (level - 1))
      if duration > maximumBlock then duration = maximumBlock end
      blockedUntil = now + duration
      failures = 0
    end
    redis.call('HSET', key, 'failures', failures, 'lockLevel', level, 'blockedUntil', blockedUntil)
  end

  redis.call('PEXPIRE', key, ttl)
  if failures > maximumFailures then maximumFailures = failures end
  if blockedUntil > maximumBlockedUntil then maximumBlockedUntil = blockedUntil end
end

return { maximumFailures, maximumBlockedUntil }
`;

export type AdminLoginIdentity = {
  keys: string[];
  ipHash: string;
  accountHash: string;
};

export type AdminLoginSecurityState = {
  failedAttempts: number;
  captchaRequired: boolean;
  blocked: boolean;
  retryAfterSeconds: number;
};

@Injectable()
export class AdminLoginThrottleService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  identity(ip: string, email: string): AdminLoginIdentity {
    const normalizedIp = ip || 'unknown';
    const normalizedEmail = email.trim().toLowerCase();
    const ipHash = this.fingerprint(`ip:${normalizedIp}`);
    const accountHash = this.fingerprint(`account:${normalizedEmail}`);
    return {
      ipHash,
      accountHash,
      keys: [
        `admin-login:ip:${ipHash}`,
        `admin-login:account:${accountHash}`,
        `admin-login:combo:${this.fingerprint(`${normalizedIp}:${normalizedEmail}`)}`,
      ],
    };
  }

  async getState(identity: AdminLoginIdentity): Promise<AdminLoginSecurityState> {
    try {
      await this.connect();
      const pipeline = this.redis.pipeline();
      for (const key of identity.keys) pipeline.hmget(key, 'failures', 'blockedUntil');
      const rows = await pipeline.exec();
      let failedAttempts = 0;
      let blockedUntil = 0;
      for (const row of rows ?? []) {
        const values = row[1] as [string | null, string | null];
        failedAttempts = Math.max(failedAttempts, Number(values?.[0] ?? 0));
        blockedUntil = Math.max(blockedUntil, Number(values?.[1] ?? 0));
      }
      return this.toState(failedAttempts, blockedUntil);
    } catch {
      throw new ServiceUnavailableException('Administrator login is temporarily unavailable');
    }
  }

  async recordFailure(identity: AdminLoginIdentity): Promise<AdminLoginSecurityState> {
    try {
      await this.connect();
      const now = Date.now();
      const result = (await this.redis.eval(
        RECORD_FAILURE_SCRIPT,
        identity.keys.length,
        ...identity.keys,
        now,
        BLOCK_AFTER_FAILURES,
        INITIAL_BLOCK_MS,
        MAX_BLOCK_MS,
        STATE_TTL_MS,
      )) as [number | string, number | string];
      return this.toState(Number(result[0]), Number(result[1]), now);
    } catch {
      throw new ServiceUnavailableException('Administrator login is temporarily unavailable');
    }
  }

  async reset(identity: AdminLoginIdentity) {
    try {
      await this.connect();
      await this.redis.del(...identity.keys);
    } catch {
      throw new ServiceUnavailableException('Administrator login is temporarily unavailable');
    }
  }

  async onModuleDestroy() {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => this.redis.disconnect());
  }

  private fingerprint(value: string) {
    return createHash('sha256')
      .update(`${process.env.ADMIN_THROTTLE_PEPPER ?? process.env.SESSION_PEPPER ?? ''}:${value}`)
      .digest('hex');
  }

  private async connect() {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  private toState(failedAttempts: number, blockedUntil: number, now = Date.now()) {
    const retryAfterSeconds = Math.max(0, Math.ceil((blockedUntil - now) / 1000));
    return {
      failedAttempts,
      captchaRequired: failedAttempts >= CAPTCHA_AFTER_FAILURES,
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds,
    };
  }
}

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

@Injectable()
export class TurnstileService {
  get siteKey() {
    return process.env.TURNSTILE_SITE_KEY ?? '';
  }

  get configured() {
    return Boolean(this.siteKey && process.env.TURNSTILE_SECRET_KEY);
  }

  async verify(token: string | undefined, remoteIp: string) {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!this.configured || !secret || !token || token.length > 2048) return false;
    try {
      const body = new URLSearchParams({
        secret,
        response: token,
        remoteip: remoteIp,
        idempotency_key: randomUUID(),
      });
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const result = (await response.json()) as TurnstileResponse;
      const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
      return Boolean(
        result.success &&
        result.action === 'admin_login' &&
        (!expectedHostname || result.hostname === expectedHostname),
      );
    } catch {
      return false;
    }
  }
}
