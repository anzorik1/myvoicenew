import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const VOTE_QUEUE = 'vote-lifecycle';

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  readonly queue = new Queue(VOTE_QUEUE, { connection: this.connection });

  async schedule(voteId: string, startsAt: Date, endsAt: Date) {
    const now = Date.now();
    const jobs = [
      this.queue.add(
        'activate',
        { voteId },
        {
          jobId: `activate-${voteId}`,
          delay: Math.max(0, startsAt.getTime() - now),
          attempts: 20,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 1000,
        },
      ),
      this.queue.add(
        'complete',
        { voteId },
        {
          jobId: `complete-${voteId}`,
          delay: Math.max(0, endsAt.getTime() - now),
          attempts: 20,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 1000,
        },
      ),
    ];
    const reminderAt = endsAt.getTime() - 60 * 60 * 1_000;
    if (reminderAt > now) {
      jobs.push(
        this.queue.add(
          'ending',
          { voteId },
          {
            jobId: `ending-${voteId}`,
            delay: reminderAt - now,
            attempts: 10,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 1000,
          },
        ),
      );
    }
    await Promise.all(jobs);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
