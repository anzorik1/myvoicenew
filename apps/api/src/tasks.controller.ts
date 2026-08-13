import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthRequest, UserAuthGuard } from './common';
import { acquireAdvisoryTransactionLock } from './database-locks';
import { PrismaService } from './prisma.service';
import { VoxService } from './vox.service';

type TelegramMembership = {
  ok: boolean;
  result?: { status?: string; is_member?: boolean };
  description?: string;
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vox: VoxService,
  ) {}

  async list(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { languageCode: true },
    });
    const language = user.languageCode === 'ru' ? 'ru' : 'en';
    const tasks = await this.prisma.task.findMany({
      where: { status: 'ACTIVE' },
      include: {
        translations: true,
        completions: { where: { userId }, select: { completedAt: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: tasks.map((task) => {
        const translation =
          task.translations.find((item) => item.language === language) ??
          task.translations.find((item) => item.language === 'en') ??
          task.translations[0];
        return {
          id: task.id,
          type: task.type,
          title: translation?.title ?? '',
          description: translation?.description ?? '',
          actionLabel: translation?.actionLabel ?? '',
          rewardVox: task.rewardVox,
          targetUrl: task.targetUrl,
          completed: Boolean(task.completions[0]),
          completedAt: task.completions[0]?.completedAt ?? null,
        };
      }),
    };
  }

  async verify(userId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, status: 'ACTIVE' },
    });
    if (!task) throw new NotFoundException('Task not found');
    const existing = await this.prisma.userTaskCompletion.findUnique({
      where: { userId_taskId: { userId, taskId } },
      include: { transaction: true },
    });
    if (existing?.transaction) {
      return { completed: true, alreadyCompleted: true, reward: existing.transaction.amount };
    }
    if (task.type !== 'TELEGRAM_CHANNEL_SUBSCRIPTION' || !task.telegramChatId) {
      throw new BadRequestException('Unsupported task verification');
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { telegramId: true },
    });
    const subscribed = await this.verifyTelegramMembership(
      task.telegramChatId,
      user.telegramId.toString(),
    );
    if (!subscribed) throw new BadRequestException('Telegram channel subscription is required');

    return this.prisma.$transaction(
      async (tx) => {
        await acquireAdvisoryTransactionLock(tx, `task:${userId}:${taskId}`);
        let completion = await tx.userTaskCompletion.findUnique({
          where: { userId_taskId: { userId, taskId } },
          include: { transaction: true },
        });
        if (!completion) {
          completion = await tx.userTaskCompletion.create({
            data: { userId, taskId },
            include: { transaction: true },
          });
        }
        const transaction =
          completion.transaction ??
          (await this.vox.award(tx, {
            userId,
            type: 'TASK_REWARD',
            amount: task.rewardVox,
            idempotencyKey: `task:${task.id}:${userId}`,
            comment: `Completed task: ${task.slug}`,
            taskCompletionId: completion.id,
          }));
        return { completed: true, alreadyCompleted: false, reward: transaction.amount };
      },
      { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 },
    );
  }

  private async verifyTelegramMembership(chatId: string, telegramId: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new BadGatewayException('Telegram verification is unavailable');
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: telegramId }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      this.logger.warn(`Telegram membership request failed: ${String(error)}`);
      throw new BadGatewayException('Telegram verification is temporarily unavailable');
    }
    const payload = (await response.json().catch(() => ({}))) as TelegramMembership;
    if (!response.ok || !payload.ok) {
      this.logger.warn(
        `Telegram membership verification failed: ${payload.description ?? response.status}`,
      );
      throw new BadGatewayException(
        'Subscription check is unavailable. The bot must be an administrator of the channel.',
      );
    }
    const status = payload.result?.status;
    if (status === 'creator' || status === 'administrator' || status === 'member') return true;
    return status === 'restricted' && payload.result?.is_member === true;
  }
}

@Controller('tasks')
@UseGuards(UserAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    return this.tasks.list(req.userId);
  }

  @Post(':id/verify')
  verify(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.tasks.verify(req.userId, id);
  }
}
