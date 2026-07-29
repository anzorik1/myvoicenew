import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { VOTE_QUEUE } from './jobs.service';
import { PrismaService } from './prisma.service';
import { VotesService } from './votes.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const votes = app.get(VotesService);
  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  const worker = new Worker(
    VOTE_QUEUE,
    async (job) => {
      const voteId = String(job.data.voteId);
      if (job.name === 'activate') {
        await prisma.vote.updateMany({
          where: { id: voteId, status: 'SCHEDULED', startsAt: { lte: new Date() } },
          data: { status: 'ACTIVE' },
        });
        return;
      }
      if (job.name === 'complete') await votes.complete(voteId);
    },
    { connection, concurrency: 4 },
  );
  const reconcile = async () => {
    await prisma.vote.updateMany({
      where: { status: 'SCHEDULED', startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
      data: { status: 'ACTIVE' },
    });
    const expired = await prisma.vote.findMany({
      where: { status: { in: ['ACTIVE', 'SCHEDULED'] }, endsAt: { lte: new Date() } },
      select: { id: true },
    });
    for (const vote of expired) await votes.complete(vote.id);
  };
  await reconcile();
  const timer = setInterval(() => void reconcile(), 60_000);
  const shutdown = async () => {
    clearInterval(timer);
    await worker.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
