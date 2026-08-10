import { HttpException, UnauthorizedException } from '@nestjs/common';
import { hash } from 'argon2';
import { AdminAuthController } from '../src/admin.controller';
import { TurnstileService } from '../src/admin-auth-security.service';
import { AdminAuthGuard, AuthRequest } from '../src/common';

type State = {
  failedAttempts: number;
  captchaRequired: boolean;
  blocked: boolean;
  retryAfterSeconds: number;
};

const stateFrom = (failedAttempts: number, blocked = false): State => ({
  failedAttempts,
  captchaRequired: failedAttempts >= 3,
  blocked,
  retryAfterSeconds: blocked ? 900 : 0,
});

describe('administrator login security', () => {
  const adminId = '00000000-0000-4000-8000-000000000001';
  const email = 'admin@myvoice.test';
  const password = 'CorrectPassword_123!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hash(password);
  });

  const setup = () => {
    let failures = 0;
    let blocked = false;
    const identity = {
      keys: ['ip', 'account', 'combo'],
      ipHash: 'a'.repeat(64),
      accountHash: 'b'.repeat(64),
    };
    const throttle = {
      identity: jest.fn(() => identity),
      getState: jest.fn(async () => stateFrom(failures, blocked)),
      recordFailure: jest.fn(async () => {
        failures += 1;
        if (failures >= 5) {
          blocked = true;
          failures = 0;
        }
        return stateFrom(failures, blocked);
      }),
      reset: jest.fn(async () => {
        failures = 0;
        blocked = false;
      }),
    };
    const captchaVerify = jest.fn(async (token?: string) => token === 'valid-captcha');
    const turnstile = {
      configured: true,
      siteKey: 'test-site-key',
      verify: captchaVerify,
    };
    const findUnique = jest.fn(async ({ where }: { where: { email: string } }) =>
      where.email === email ? { id: adminId, email, active: true, passwordHash } : null,
    );
    const prisma = {
      adminUser: {
        findUnique,
        update: jest.fn(async () => ({ id: adminId })),
      },
      adminAuditLog: { create: jest.fn(async () => ({ id: 'audit' })) },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const jwt = { signAsync: jest.fn(async () => 'admin-access-token') };
    const controller = new AdminAuthController(
      prisma as never,
      jwt as never,
      throttle as never,
      turnstile as never,
    );
    const request = {
      ip: '203.0.113.10',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as AuthRequest;
    const login = (enteredPassword: string, captchaToken?: string) =>
      controller.login(request, { email, password: enteredPassword, captchaToken });
    return {
      controller,
      throttle,
      turnstile,
      captchaVerify,
      prisma,
      jwt,
      request,
      login,
      failures: () => failures,
    };
  };

  test('requires a server-verified CAPTCHA after three incorrect passwords', async () => {
    const context = setup();
    await expect(context.login('wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(context.login('wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    const third = (await context
      .login('wrong-password')
      .catch((error: unknown) => error)) as HttpException;
    expect(third.getResponse()).toEqual(
      expect.objectContaining({
        message: 'Неверные данные для входа',
        captchaRequired: true,
        captchaSiteKey: 'test-site-key',
      }),
    );

    const beforeCaptchaLookupCount = context.prisma.adminUser.findUnique.mock.calls.length;
    const missingCaptcha = (await context
      .login(password)
      .catch((error: unknown) => error)) as HttpException;
    expect(missingCaptcha.getStatus()).toBe(403);
    expect(context.captchaVerify).toHaveBeenCalledWith(undefined, '203.0.113.10');
    expect(context.prisma.adminUser.findUnique).toHaveBeenCalledTimes(beforeCaptchaLookupCount);
  });

  test('blocks after five incorrect passwords and reload cannot bypass server state', async () => {
    const context = setup();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        context.login('wrong-password', attempt > 3 ? 'valid-captcha' : undefined),
      ).rejects.toBeInstanceOf(HttpException);
    }
    const fifth = (await context
      .login('wrong-password', 'valid-captcha')
      .catch((error: unknown) => error)) as HttpException;
    expect(fifth.getStatus()).toBe(429);
    expect(fifth.getResponse()).toEqual(
      expect.objectContaining({ blocked: true, retryAfterSeconds: 900 }),
    );

    const reloadedController = new AdminAuthController(
      context.prisma as never,
      context.jwt as never,
      context.throttle as never,
      context.turnstile as never,
    );
    await expect(
      reloadedController.login(context.request, { email, password, captchaToken: 'valid-captcha' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  test('successful login resets failures and creates an audit event', async () => {
    const context = setup();
    await expect(context.login('wrong-password')).rejects.toBeInstanceOf(HttpException);
    await expect(context.login(password)).resolves.toEqual({ accessToken: 'admin-access-token' });
    expect(context.throttle.reset).toHaveBeenCalledTimes(1);
    expect(context.failures()).toBe(0);
    expect(context.prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId,
        action: 'ADMIN_LOGIN',
        ipHash: 'a'.repeat(64),
      }),
    });
    expect(context.jwt.signAsync).toHaveBeenCalledWith(
      { sub: adminId, realm: 'admin' },
      expect.objectContaining({ expiresIn: 900 }),
    );
  });

  test('unknown and existing accounts receive the same generic error', async () => {
    const context = setup();
    const existing = (await context
      .login('wrong-password')
      .catch((error: unknown) => error)) as HttpException;
    const unknown = (await context.controller
      .login(context.request, {
        email: 'unknown@myvoice.test',
        password: 'wrong-password',
      })
      .catch((error: unknown) => error)) as HttpException;
    expect((existing.getResponse() as { message: string }).message).toBe(
      'Неверные данные для входа',
    );
    expect((unknown.getResponse() as { message: string }).message).toBe(
      'Неверные данные для входа',
    );
  });

  test('admin guard rejects a direct API request without a token', async () => {
    const guard = new AdminAuthGuard({} as never, {} as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    };
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Cloudflare Turnstile server validation', () => {
  const oldSiteKey = process.env.TURNSTILE_SITE_KEY;
  const oldSecret = process.env.TURNSTILE_SECRET_KEY;
  const oldHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;

  afterEach(() => {
    process.env.TURNSTILE_SITE_KEY = oldSiteKey;
    process.env.TURNSTILE_SECRET_KEY = oldSecret;
    process.env.TURNSTILE_EXPECTED_HOSTNAME = oldHostname;
    jest.restoreAllMocks();
  });

  test('sends the browser token to Siteverify and checks action and hostname', async () => {
    process.env.TURNSTILE_SITE_KEY = 'site-key';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    process.env.TURNSTILE_EXPECTED_HOSTNAME = 'myvoice24.com';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        action: 'admin_login',
        hostname: 'myvoice24.com',
      }),
    } as Response);

    await expect(new TurnstileService().verify('browser-token', '203.0.113.10')).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(String(request?.body)).toContain('response=browser-token');
    expect(String(request?.body)).toContain('secret=secret-key');
  });

  test('fails closed when Turnstile returns a mismatched action', async () => {
    process.env.TURNSTILE_SITE_KEY = 'site-key';
    process.env.TURNSTILE_SECRET_KEY = 'secret-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, action: 'different_action', hostname: 'myvoice24.com' }),
    } as Response);
    await expect(new TurnstileService().verify('browser-token', '203.0.113.10')).resolves.toBe(
      false,
    );
  });
});
