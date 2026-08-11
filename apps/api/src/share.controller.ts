import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import sharp from 'sharp';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character]!;
  });

const wrap = (value: string, width: number, maxLines: number) => {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (next.length <= width && lines.length) lines[lines.length - 1] = next;
    else if (lines.length < maxLines) lines.push(word);
    else break;
  }
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.slice(0, Math.max(1, width - 1))}…`;
  }
  return lines;
};

class ShareService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, voteId: string) {
    const vote = await this.prisma.vote.findUnique({ where: { id: voteId, deletedAt: null } });
    if (!vote || vote.status !== 'COMPLETED')
      throw new NotFoundException('Completed vote not found');
    const token = randomBytes(32).toString('base64url');
    await this.prisma.voteShare.create({
      data: {
        userId,
        voteId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const origin = (
      process.env.PUBLIC_APP_URL ??
      process.env.WEB_APP_URL ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    const url = `${origin}/api/share/votes/${token}`;
    return { url, imageUrl: `${url}/card.png`, expiresAt: new Date(Date.now() + 30 * 86_400_000) };
  }

  async data(token: string) {
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) throw new NotFoundException('Share not found');
    const share = await this.prisma.voteShare.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        user: { select: { languageCode: true } },
        vote: {
          include: {
            translations: true,
            options: { orderBy: { position: 'asc' }, include: { translations: true } },
            userVotes: {
              where: { user: { voteShares: { some: { tokenHash: this.hash(token) } } } },
              take: 1,
              include: { transactions: { select: { amount: true } } },
            },
          },
        },
      },
    });
    if (!share || share.expiresAt <= new Date() || share.vote.status !== 'COMPLETED') {
      throw new NotFoundException('Share not found');
    }
    const language = share.user.languageCode === 'ru' ? 'ru' : 'en';
    const translation =
      share.vote.translations.find((row) => row.language === language) ??
      share.vote.translations.find((row) => row.language === 'en') ??
      share.vote.translations[0];
    const total = share.vote.participantCount;
    const firstPercent = total
      ? Math.round(((share.vote.options[0]?.voteCount ?? 0) * 100) / total)
      : 0;
    const percents = [firstPercent, total ? 100 - firstPercent : 0];
    const options = share.vote.options.map((option, index) => ({
      id: option.id,
      text:
        option.translations.find((row) => row.language === language)?.text ??
        option.translations.find((row) => row.language === 'en')?.text ??
        option.translations[0]?.text ??
        '',
      count: option.voteCount,
      percent: percents[index] ?? 0,
    }));
    const own = share.vote.userVotes[0];
    return {
      title: translation?.title ?? 'MyVoice',
      language,
      total,
      resultStatus: share.vote.resultStatus,
      winner: options.find((option) => option.id === share.vote.winnerOptionId)?.text ?? null,
      options,
      choice: options.find((option) => option.id === own?.optionId)?.text ?? null,
      reward: own?.transactions.reduce((sum, transaction) => sum + transaction.amount, 0) ?? 0,
    };
  }
}

@Controller('votes')
@UseGuards(UserAuthGuard)
export class ShareActionsController {
  private readonly shares: ShareService;

  constructor(prisma: PrismaService) {
    this.shares = new ShareService(prisma);
  }

  @Post(':id/share')
  create(@Req() req: AuthRequest, @Param('id') voteId: string) {
    return this.shares.create(req.userId, voteId);
  }
}

@Controller('share')
export class ShareController {
  private readonly shares: ShareService;

  constructor(prisma: PrismaService) {
    this.shares = new ShareService(prisma);
  }

  @Get('votes/:token')
  async page(@Param('token') token: string, @Res() response: Response) {
    const data = await this.shares.data(token);
    const origin = (
      process.env.PUBLIC_APP_URL ??
      process.env.WEB_APP_URL ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    const pageUrl = `${origin}/api/share/votes/${token}`;
    const botUsername =
      process.env.BOT_USERNAME ?? process.env.VITE_BOT_USERNAME ?? 'MyVoice691_bot';
    const result =
      data.resultStatus === 'TIE'
        ? data.language === 'ru'
          ? 'Ничья'
          : 'Tie'
        : data.language === 'ru'
          ? `Победил вариант: ${data.winner}`
          : `Winner: ${data.winner}`;
    const description = `${result} · ${data.total} ${data.language === 'ru' ? 'участников' : 'participants'}`;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'private, max-age=300');
    response.send(
      `<!doctype html><html lang="${data.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.title)} · MyVoice</title><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(data.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(`${pageUrl}/card.png`)}"><meta property="og:url" content="${escapeHtml(pageUrl)}"><meta name="twitter:card" content="summary_large_image"><style>body{margin:0;background:#07131d;color:#f6fbff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100% - 32px));background:#102533;border:1px solid #2d5363;border-radius:28px;padding:28px;box-sizing:border-box}.brand{color:#63f5b3;font-weight:800;letter-spacing:.12em}.answer{background:#173443;border-radius:18px;padding:16px;margin-top:12px;display:flex;justify-content:space-between}.cta{display:block;margin-top:24px;padding:16px;text-align:center;border-radius:16px;background:#63f5b3;color:#07131d;text-decoration:none;font-weight:800}</style></head><body><main class="card"><div class="brand">MYVOICE</div><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(result)}</p>${data.options.map((option) => `<div class="answer"><span>${escapeHtml(option.text)}</span><strong>${option.percent}%</strong></div>`).join('')}<p>${data.choice ? `${data.language === 'ru' ? 'Мой выбор' : 'My choice'}: ${escapeHtml(data.choice)}` : data.language === 'ru' ? 'Я не участвовал' : 'I did not participate'}</p><a class="cta" href="https://t.me/${escapeHtml(botUsername)}">${data.language === 'ru' ? 'Открыть MyVoice' : 'Open MyVoice'}</a></main></body></html>`,
    );
  }

  @Get('votes/:token/card.png')
  async card(@Param('token') token: string, @Res() response: Response) {
    const data = await this.shares.data(token);
    const titleLines = wrap(data.title, 42, 3);
    const result =
      data.resultStatus === 'TIE'
        ? data.language === 'ru'
          ? 'НИЧЬЯ'
          : 'TIE'
        : data.language === 'ru'
          ? `ПОБЕДА: ${data.winner}`
          : `WINNER: ${data.winner}`;
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07131d"/><stop offset="1" stop-color="#154253"/></linearGradient></defs><rect width="1200" height="630" rx="36" fill="url(#bg)"/><circle cx="1050" cy="80" r="260" fill="#63f5b3" opacity=".1"/><text x="72" y="78" fill="#63f5b3" font-family="Arial" font-size="30" font-weight="800" letter-spacing="7">MYVOICE</text>${titleLines.map((line, index) => `<text x="72" y="${150 + index * 58}" fill="#f7fcff" font-family="Arial" font-size="47" font-weight="700">${escapeHtml(line)}</text>`).join('')}<text x="72" y="350" fill="#9ab8c5" font-family="Arial" font-size="27">${escapeHtml(result)}</text>${data.options.map((option, index) => `<rect x="72" y="${390 + index * 86}" width="1056" height="66" rx="20" fill="#173443"/><rect x="72" y="${390 + index * 86}" width="${Math.max(16, Math.round((1056 * option.percent) / 100))}" height="66" rx="20" fill="${index === 0 ? '#36c98f' : '#3a7f9e'}" opacity=".65"/><text x="96" y="${433 + index * 86}" fill="#ffffff" font-family="Arial" font-size="28" font-weight="700">${escapeHtml(option.text.slice(0, 38))}</text><text x="1060" y="${433 + index * 86}" text-anchor="end" fill="#ffffff" font-family="Arial" font-size="28" font-weight="800">${option.percent}%</text>`).join('')}<text x="1128" y="594" text-anchor="end" fill="#9ab8c5" font-family="Arial" font-size="24">${data.total} ${data.language === 'ru' ? 'участников' : 'participants'}</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    response.setHeader('content-type', 'image/png');
    response.setHeader('cache-control', 'private, max-age=86400');
    response.send(png);
  }
}
