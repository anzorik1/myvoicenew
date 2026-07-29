import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { RULES } from '@myvoice/config';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';

class SuggestionDto {
  @IsIn(['en', 'ru'])
  language!: string;
  @IsString()
  @Length(10, 240)
  title!: string;
  @IsString()
  @Length(30, 3000)
  description!: string;
  @IsString()
  @Length(1, 160)
  optionOne!: string;
  @IsString()
  @Length(1, 160)
  optionTwo!: string;
}

@Controller('suggestions')
@UseGuards(UserAuthGuard)
export class SuggestionsController {
  constructor(private readonly prisma: PrismaService) {}

  private async enabled() {
    const [flag, count] = await Promise.all([
      this.prisma.featureFlag.findUnique({ where: { key: 'SUGGESTIONS' } }),
      this.prisma.user.count({ where: { registrationCompletedAt: { not: null } } }),
    ]);
    return Boolean(
      flag?.enabled && count >= (flag.usersThreshold ?? RULES.SUGGESTIONS_USERS_THRESHOLD),
    );
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() dto: SuggestionDto) {
    if (!(await this.enabled())) throw new ForbiddenException('Suggestions are not enabled');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (user.suggestionBlocked) throw new ForbiddenException('Suggestions are blocked');
    const recent = await this.prisma.voteSuggestion.findFirst({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (recent) throw new ForbiddenException('Only one suggestion per 24 hours is allowed');
    return this.prisma.voteSuggestion.create({
      data: {
        userId: user.id,
        language: dto.language,
        translations: {
          create: {
            language: dto.language,
            title: dto.title,
            description: dto.description,
            optionOne: dto.optionOne,
            optionTwo: dto.optionTwo,
          },
        },
      },
      include: { translations: true },
    });
  }

  @Get('me')
  async mine(@Req() req: AuthRequest) {
    return this.prisma.voteSuggestion.findMany({
      where: { userId: req.userId },
      include: { translations: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
