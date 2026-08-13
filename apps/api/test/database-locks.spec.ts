import { acquireAdvisoryTransactionLock } from '../src/database-locks';

describe('PostgreSQL advisory transaction lock', () => {
  test('casts the PostgreSQL void result to a Prisma-safe text value', async () => {
    const queryRaw = jest.fn(async () => [{ lockResult: '' }]);

    await acquireAdvisoryTransactionLock({ $queryRaw: queryRaw } as never, 'task:user:task');

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [template, key] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(template.join('?')).toContain('::text AS "lockResult"');
    expect(key).toBe('task:user:task');
  });
});
