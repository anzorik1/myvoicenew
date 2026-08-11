import { Injectable, Logger } from '@nestjs/common';
import { NotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

const copy = {
  en: {
    VOTE_STARTED: (title: string) => `A new MyVoice vote is open:\n${title}`,
    VOTE_ENDING: (title: string) => `One hour left to vote:\n${title}`,
    VOTE_RESULT: (title: string) => `The result is ready:\n${title}`,
    button: 'Open MyVoice',
  },
  ru: {
    VOTE_STARTED: (title: string) => `В MyVoice началось новое голосование:\n${title}`,
    VOTE_ENDING: (title: string) => `До конца голосования остался один час:\n${title}`,
    VOTE_RESULT: (title: string) => `Результат голосования готов:\n${title}`,
    button: 'Открыть MyVoice',
  },
} as const;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private preference(kind: NotificationKind) {
    if (kind === 'VOTE_STARTED') return 'notifyNewVotes' as const;
    if (kind === 'VOTE_ENDING') return 'notifyVoteEnding' as const;
    return 'notifyResults' as const;
  }

  async notifyVote(voteId: string, kind: NotificationKind) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const webAppUrl = process.env.WEB_APP_URL ?? process.env.VITE_WEB_APP_URL;
    if (!token || !webAppUrl) {
      this.logger.warn(`Skipped ${kind}: Telegram bot or web app URL is not configured`);
      return { sent: 0, failed: 0, skipped: true };
    }
    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId, deletedAt: null },
      include: { translations: true },
    });
    if (!vote) return { sent: 0, failed: 0, skipped: true };
    const preference = this.preference(kind);
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        registrationCompletedAt: { not: null },
        notificationsEnabled: true,
        [preference]: true,
      },
      select: { id: true, telegramId: true, languageCode: true },
      orderBy: { createdAt: 'asc' },
    });
    let sent = 0;
    let failed = 0;
    let transientFailure = false;
    for (let index = 0; index < users.length; index += 20) {
      const batch = users.slice(index, index + 20);
      const results = await Promise.all(
        batch.map(async (user) => {
          const language = user.languageCode === 'ru' ? 'ru' : 'en';
          const translation =
            vote.translations.find((item) => item.language === language) ??
            vote.translations.find((item) => item.language === 'en') ??
            vote.translations[0];
          const idempotencyKey = `notification:${kind}:${voteId}:${user.id}`;
          let record;
          try {
            record = await this.prisma.userNotification.create({
              data: { userId: user.id, voteId, kind, idempotencyKey },
            });
          } catch (error) {
            if (
              !(error instanceof Prisma.PrismaClientKnownRequestError) ||
              error.code !== 'P2002'
            ) {
              throw error;
            }
            record = await this.prisma.userNotification.findUniqueOrThrow({
              where: { idempotencyKey },
            });
          }
          if (record.status === 'SENT' || record.lastError?.startsWith('PERMANENT:')) return 'skip';
          try {
            const route = kind === 'VOTE_RESULT' ? `/results/${voteId}` : `/votes/${voteId}`;
            const targetUrl = new URL(route, webAppUrl).toString();
            const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                chat_id: user.telegramId.toString(),
                text: copy[language][kind](translation?.title ?? 'MyVoice'),
                reply_markup: {
                  inline_keyboard: [[{ text: copy[language].button, web_app: { url: targetUrl } }]],
                },
              }),
            });
            if (!response.ok) {
              const permanent = response.status === 400 || response.status === 403;
              throw new Error(
                `${permanent ? 'PERMANENT' : 'TRANSIENT'}:Telegram ${response.status}`,
              );
            }
            await this.prisma.userNotification.update({
              where: { id: record.id },
              data: {
                status: 'SENT',
                sentAt: new Date(),
                attempts: { increment: 1 },
                lastError: null,
              },
            });
            return 'sent';
          } catch (error) {
            const message =
              error instanceof Error ? error.message.slice(0, 950) : 'TRANSIENT:Unknown';
            await this.prisma.userNotification.update({
              where: { id: record.id },
              data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message },
            });
            if (!message.startsWith('PERMANENT:')) transientFailure = true;
            return 'failed';
          }
        }),
      );
      sent += results.filter((result) => result === 'sent').length;
      failed += results.filter((result) => result === 'failed').length;
      if (index + 20 < users.length) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    this.logger.log(`${kind} processed for vote ${voteId}: sent=${sent}, failed=${failed}`);
    if (transientFailure) throw new Error(`Transient Telegram delivery failure for ${voteId}`);
    return { sent, failed, skipped: false };
  }
}
