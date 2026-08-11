import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { VOTE_QUEUE } from './jobs.service';
import { PrismaService } from './prisma.service';
import { NotificationService } from './notification.service';
import { VotesService } from './votes.service';
import { singleFlight } from './worker-utils';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const votes = app.get(VotesService);
  const notifications = app.get(NotificationService);
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  const worker = new Worker(
    VOTE_QUEUE,
    async (job) => {
      const voteId = String(job.data.voteId);
      if (job.name === 'activate') {
        const activated = await prisma.vote.updateMany({
          where: {
            id: voteId,
            status: 'SCHEDULED',
            startsAt: { lte: new Date() },
            deletedAt: null,
          },
          data: { status: 'ACTIVE' },
        });
        if (activated.count > 0) await notifications.notifyVote(voteId, 'VOTE_STARTED');
        return;
      }
      if (job.name === 'ending') {
        const vote = await prisma.vote.findUnique({ where: { id: voteId } });
        if (vote?.status === 'ACTIVE' && vote.endsAt > new Date()) {
          await notifications.notifyVote(voteId, 'VOTE_ENDING');
        }
        return;
      }
      if (job.name === 'complete') {
        await votes.complete(voteId);
        const completed = await prisma.vote.findUnique({ where: { id: voteId } });
        if (completed?.status === 'COMPLETED')
          await notifications.notifyVote(voteId, 'VOTE_RESULT');
      }
    },
    { connection, concurrency: 4 },
  );
  const reconcile = async () => {
    const due = await prisma.vote.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lte: new Date() },
        endsAt: { gt: new Date() },
        deletedAt: null,
      },
      select: { id: true },
    });
    for (const vote of due) {
      const activated = await prisma.vote.updateMany({
        where: { id: vote.id, status: 'SCHEDULED', deletedAt: null },
        data: { status: 'ACTIVE' },
      });
      if (activated.count > 0) await notifications.notifyVote(vote.id, 'VOTE_STARTED');
    }
    const reminderEnd = new Date(Date.now() + 60 * 60 * 1_000);
    const ending = await prisma.vote.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: { gt: new Date(), lte: reminderEnd },
        deletedAt: null,
      },
      select: { id: true },
    });
    for (const vote of ending) await notifications.notifyVote(vote.id, 'VOTE_ENDING');
    const expired = await prisma.vote.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        endsAt: { lte: new Date() },
        deletedAt: null,
      },
      select: { id: true },
    });
    for (const vote of expired) {
      await votes.complete(vote.id);
      await notifications.notifyVote(vote.id, 'VOTE_RESULT');
    }
  };
  const reconcileSafely = singleFlight(reconcile, (error) => {
    console.error('Vote reconciliation failed', error);
  });
  await reconcileSafely();
  const timer = setInterval(() => void reconcileSafely(), 60_000);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    await worker.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap().catch((error) => {
  console.error('Worker bootstrap failed', error);
  process.exit(1);
});
