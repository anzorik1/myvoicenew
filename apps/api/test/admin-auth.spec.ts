import { BadRequestException } from '@nestjs/common';
import { hash, verify } from 'argon2';
import { AdminAuthController } from '../src/admin.controller';
import { AuthRequest } from '../src/common';

describe('admin password change', () => {
  const adminId = '00000000-0000-4000-8000-000000000001';

  test('stores a new hash and writes an audit event', async () => {
    const currentPassword = 'OldPassword_123';
    const newPassword = 'NewPassword_456!';
    const currentHash = await hash(currentPassword);
    let storedHash = currentHash;
    const auditCreate = jest.fn(async ({ data }: { data: unknown }) => data);
    const prisma = {
      adminUser: {
        findUniqueOrThrow: jest.fn(async () => ({ id: adminId, passwordHash: currentHash })),
        update: jest.fn(async ({ data }: { data: { passwordHash: string } }) => {
          storedHash = data.passwordHash;
          return { id: adminId };
        }),
      },
      adminAuditLog: { create: auditCreate },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const controller = new AdminAuthController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.changePassword({ adminId } as AuthRequest, { currentPassword, newPassword }),
    ).resolves.toEqual({ changed: true });

    expect(storedHash).not.toBe(currentHash);
    await expect(verify(storedHash, newPassword)).resolves.toBe(true);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId,
        action: 'ADMIN_PASSWORD_CHANGE',
        after: { changed: true },
      }),
    });
  });

  test('rejects an incorrect current password without updating', async () => {
    const currentHash = await hash('RealPassword_123');
    const update = jest.fn();
    const prisma = {
      adminUser: {
        findUniqueOrThrow: jest.fn(async () => ({ id: adminId, passwordHash: currentHash })),
        update,
      },
      adminAuditLog: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const controller = new AdminAuthController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.changePassword({ adminId } as AuthRequest, {
        currentPassword: 'WrongPassword_123',
        newPassword: 'NewPassword_456!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});
