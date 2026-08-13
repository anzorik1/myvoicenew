import { Prisma } from '@prisma/client';

/**
 * Serializes a business operation for the supplied key until the surrounding
 * PostgreSQL transaction ends. PostgreSQL returns `void` from the lock
 * function, so cast it to text to keep Prisma's result deserializer happy.
 */
export async function acquireAdvisoryTransactionLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw<Array<{ lockResult: string }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lockResult"
  `;
}
